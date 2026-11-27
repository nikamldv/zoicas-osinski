"use strict";

const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const ROOT = path.resolve(__dirname, "..");
const BASE = "http://127.0.0.1:3001";
const TEST_DATABASE = "zoicas_osinski_test";
const viewports = [{ name:"mobile", width:375, height:812 }, { name:"tablet", width:768, height:1024 }, { name:"desktop", width:1440, height:900 }];
const results = [];
function check(name, pass, detail = "") { results.push({ name, pass:Boolean(pass) }); if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`); }
function env() { const values=Object.fromEntries(fs.readFileSync(path.join(ROOT,".env.test"),"utf8").split(/\r?\n/).filter(Boolean).map(line=>{const at=line.indexOf("=");return [line.slice(0,at),line.slice(at+1)];})); if (process.env.ENV_FILE !== ".env.test" || values.MYSQL_DATABASE !== TEST_DATABASE || values.PORT !== "3001") throw new Error("Refusing outside isolated test environment."); return values; }
async function employeeLogin(page, values) { await page.goto(`${BASE}/public/mitarbeiter-anmelden.html`,{waitUntil:"domcontentloaded"}); await page.fill("#employee-email-login","quality.employee.a@example.test"); await page.fill("#employee-password-login",values.PHASE168_TEST_EMPLOYEE_PASSWORD); await page.locator("#employee-login-form button[type=submit]").click(); await page.waitForSelector("#employee-dashboard:not([hidden])"); }
async function adminLogin(page, values) { await page.goto(`${BASE}/admin.html`,{waitUntil:"domcontentloaded"}); await page.fill("#login-username",values.ADMIN_USERNAME); await page.fill("#login-password",values.PHASE168_TEST_ADMIN_PASSWORD); await page.locator("#login-form button[type=submit]").click(); await page.waitForSelector("#dashboard-view:not([hidden])"); }

async function main() {
    const values=env();
    const db=await mysql.createConnection({host:values.MYSQL_HOST,port:Number(values.MYSQL_PORT||3306),user:values.MYSQL_USER,password:values.MYSQL_PASSWORD,database:values.MYSQL_DATABASE});
    const stamp=Date.now(), seconds=stamp%(20*60*60), clock=value=>new Date(value*1000).toISOString().slice(11,19), startTime=clock(seconds), endTime=clock(seconds+60*60);
    try {
        const [[fixture]]=await db.execute("SELECT c.id customer_id,e.id employee_id FROM customers c JOIN employees e ON e.employee_number='TEST-MA-000001' WHERE c.customer_number='TEST-KU-000001' LIMIT 1");
        check("synthetic browser fixture", Boolean(fixture?.customer_id && fixture?.employee_id));
        const [order]=await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,?,?, 'GEPLANT','NORMAL',?)",[`TEST-P1617B-${stamp}`,fixture.customer_id,"Reinigungsservice","TEST DATA – Phase 16.17A Browser","Synthetic isolated browser test"]);
        const [assignment]=await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),?,?, 'GEPLANT',?)",[order.insertId,fixture.employee_id,startTime,endTime,"TEST DATA – Phase 16.17A Browser"]);
        const browser=await chromium.launch({headless:true});
        try {
            for (const viewport of viewports) {
                const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}}), page=await context.newPage(); page.setDefaultTimeout(10000);
                await employeeLogin(page,values); await page.locator('[data-employee-view="work"]').click(); await page.waitForSelector("#employee-work:not([hidden])");
                check(`${viewport.name}: attendance visible`,await page.locator("#attendance-checkin-form:not([hidden])").count()===1);
                check(`${viewport.name}: no real geolocation API`,await page.evaluate(async()=>!(await fetch("/js/employee-portal.js").then(response=>response.text())).includes("navigator.geolocation")));
                check(`${viewport.name}: assignment selectable`,await page.locator(`#attendance-assignment option[value="${assignment.insertId}"]`).count()===1);
                check(`${viewport.name}: keyboard focus`,await page.locator("#attendance-assignment").evaluate(node=>{node.focus();return document.activeElement===node;}));
                check(`${viewport.name}: no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
                const axe=await new AxeBuilder({page}).include("#employee-work").analyze(); check(`${viewport.name}: attendance axe serious/critical`,!axe.violations.some(issue=>["serious","critical"].includes(issue.impact)));
                if (viewport.name === "desktop") { await page.selectOption("#attendance-assignment",String(assignment.insertId)); await page.locator("#attendance-checkin-form button[type=submit]").click(); await page.waitForSelector("#attendance-checkout-form:not([hidden])"); check("desktop: check-in UI state",await page.locator("#attendance-status").innerText().then(text=>/Eingecheckt/.test(text))); await page.locator("#attendance-checkout-form button[type=submit]").click(); await page.waitForSelector("#attendance-checkin-form:not([hidden])"); check("desktop: check-out UI state",await page.locator("#attendance-status").innerText().then(text=>/Nicht eingecheckt|kein aktiver/.test(text))); }
                await context.close();
            }
            const adminContext=await browser.newContext({viewport:{width:1440,height:900}}), adminPage=await adminContext.newPage(), adminErrors=[]; adminPage.on("pageerror",error=>adminErrors.push(error.message)); adminPage.setDefaultTimeout(10000); await adminLogin(adminPage,values); await adminPage.locator('[data-type="attendance"]').click(); await adminPage.waitForSelector("#attendance-panel:not([hidden])"); await adminPage.waitForTimeout(800); const adminRows=await adminPage.locator("#attendance-body tr").count(), adminMessage=await adminPage.locator("#attendance-message").innerText(), attendanceRequests=await adminPage.evaluate(()=>performance.getEntriesByType("resource").map(entry=>entry.name).filter(name=>name.includes("/api/admin/attendance")).length); check("admin: attendance overview",adminRows>0,`${adminMessage || "no message"}; requests=${attendanceRequests}; error=${adminErrors[0]||"none"}`); check("admin: no location columns",await adminPage.locator("#attendance-panel").innerText().then(text=>!/GPS|Koordinaten|Latitude|Longitude/.test(text))); check("admin: keyboard focus",await adminPage.locator("#attendance-refresh").evaluate(node=>{node.focus();return document.activeElement===node;})); await adminContext.close();
        } finally { await browser.close(); }
    } finally { await db.end(); }
    console.log(JSON.stringify({ok:true,executed:results.length,passed:results.filter(item=>item.pass).length},null,2));
}
main().catch(error=>{console.log(JSON.stringify({ok:false,executed:results.length,passed:results.filter(item=>item.pass).length,error:error.message},null,2));process.exit(1);});
