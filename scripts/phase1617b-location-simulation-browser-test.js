"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const ROOT = path.resolve(__dirname, "..");
const BASE = "http://127.0.0.1:3001";
const TEST_DATABASE = "zoicas_osinski_test";
const viewports = [{name:"mobile",width:375,height:812},{name:"tablet",width:768,height:1024},{name:"desktop",width:1440,height:900}];
const results=[];
function check(name,pass,detail="") { results.push({name,pass:Boolean(pass)}); if(!pass)throw new Error(`${name}${detail?`: ${detail}`:""}`); }
function env(){const values=Object.fromEntries(fs.readFileSync(path.join(ROOT,".env.test"),"utf8").split(/\r?\n/).filter(Boolean).map(line=>{const at=line.indexOf("=");return[line.slice(0,at),line.slice(at+1)];}));if(process.env.ENV_FILE!==".env.test"||values.MYSQL_DATABASE!==TEST_DATABASE||values.PORT!=="3001")throw new Error("Refusing outside isolated test environment.");return values;}
function hash(password){return new Promise((resolve,reject)=>{const salt=crypto.randomBytes(16);crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`));});}
async function employeeLogin(page,email,password){await page.goto(`${BASE}/public/mitarbeiter-anmelden.html`,{waitUntil:"domcontentloaded"});await page.fill("#employee-email-login",email);await page.fill("#employee-password-login",password);await page.locator("#employee-login-form button[type=submit]").click();await page.waitForSelector("#employee-dashboard:not([hidden])");}
async function adminLogin(page,values){await page.goto(`${BASE}/admin.html`,{waitUntil:"domcontentloaded"});await page.fill("#login-username",values.ADMIN_USERNAME);await page.fill("#login-password",values.PHASE168_TEST_ADMIN_PASSWORD);await page.locator("#login-form button[type=submit]").click();await page.waitForSelector("#dashboard-view:not([hidden])");}

(async()=>{
    const values=env(),db=await mysql.createConnection({host:values.MYSQL_HOST,port:Number(values.MYSQL_PORT),user:values.MYSQL_ADMIN_USER,password:values.MYSQL_ADMIN_PASSWORD,database:TEST_DATABASE});
    const stamp=Date.now(), password="Phase1617BBrowser!1", email=`p1617b.browser.${stamp}@example.test`, credential=await hash(password);
    try {
        const [customer]=await db.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash,status) VALUES (?,?,?,?,?,?, 'ACTIVE')",[`TEST-P1617B-B-${stamp}`,"TEST","Browser Customer",`p1617b.browser.customer.${stamp}@example.test`,"+49123457001",credential]);
        const [employee]=await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)",[`TEST-P1617B-B-${stamp}`,"TEST","Browser Employee",email,"+49123457002",credential,"Tester","TEST DATA – Phase 16.17B Browser"]);
        const [order]=await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,? ,?,'GEPLANT','NORMAL',?)",[`TEST-P1617B-B-${stamp}`,customer.insertId,"Reinigung","TEST DATA – Phase 16.17B Browser","Synthetic isolated browser test"]);
        const [assignment]=await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),'09:00','17:00','GEPLANT','TEST DATA – Phase 16.17B Browser')",[order.insertId,employee.insertId]);
        const browser=await chromium.launch({headless:true});
        try {
            let desktopPage;
            for(const viewport of viewports){
                const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}}),page=await context.newPage();page.setDefaultTimeout(10000);
                await employeeLogin(page,email,password);await page.locator('[data-employee-view="work"]').click();await page.waitForSelector("#employee-work:not([hidden])");
                check(`${viewport.name}: simulation panel visible`,await page.locator("#location-simulation-heading").isVisible());
                check(`${viewport.name}: simulation label`,await page.locator("#employee-work").innerText().then(text=>/NUR TESTMODUS/.test(text)));
                check(`${viewport.name}: no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
                check(`${viewport.name}: keyboard focus`,await page.locator("#attendance-assignment").evaluate(node=>{node.focus();return document.activeElement===node;}));
                check(`${viewport.name}: no geolocation api call`,await page.evaluate(()=>!document.documentElement.innerHTML.includes("navigator.geolocation")));
                const axe=await new AxeBuilder({page}).include("#employee-work").analyze();check(`${viewport.name}: axe serious/critical`,!axe.violations.some(issue=>["serious","critical"].includes(issue.impact)));
                if(viewport.name!=="desktop")await context.close();else desktopPage={page,context};
            }
            const page=desktopPage.page;
            await page.selectOption("#attendance-assignment",String(assignment.insertId));await page.locator("#attendance-checkin-form button[type=submit]").click();await page.waitForSelector("#attendance-checkout-form:not([hidden])");
            await page.locator("#location-simulation-start").click();await page.waitForSelector("#location-simulation-stop:not([hidden])");check("desktop: simulation starts",await page.locator("#location-simulation-status").innerText().then(text=>/Simulation aktiv/.test(text)));
            await page.locator("#location-simulation-update-form input[name=latitude]").fill("50.110924");await page.locator("#location-simulation-update-form input[name=longitude]").fill("8.682127");await page.locator("#location-simulation-update-form button[type=submit]").click();await page.waitForTimeout(300);check("desktop: synthetic update",await page.locator("#employee-notice").innerText().then(text=>/Testkoordinaten aktualisiert/.test(text)));
            const adminContext=await browser.newContext({viewport:{width:1440,height:900}}),adminPage=await adminContext.newPage();adminPage.setDefaultTimeout(10000);await adminLogin(adminPage,values);await adminPage.locator('[data-type="attendance"]').click();await adminPage.waitForSelector("#attendance-panel:not([hidden])");await adminPage.waitForSelector("#location-simulation-admin:not([hidden])");check("admin: simulation overview",await adminPage.locator("#location-simulation-admin-body tr").count()>0);check("admin: synthetic-only copy",await adminPage.locator("#location-simulation-admin").innerText().then(text=>/synthetische Testkoordinaten/i.test(text)));await adminContext.close();
            await page.locator("#location-simulation-stop").click();await page.waitForSelector("#location-simulation-start:not([hidden])");check("desktop: simulation stops",await page.locator("#location-simulation-status").innerText().then(text=>/inaktiv/.test(text)));
            await page.locator("#attendance-checkout-form button[type=submit]").click();await page.waitForSelector("#attendance-checkin-form:not([hidden])");await desktopPage.context.close();
        } finally {await browser.close();}
    } finally {await db.end();}
    console.log(JSON.stringify({ok:true,executed:results.length,passed:results.filter(result=>result.pass).length},null,2));
})().catch(error=>{console.log(JSON.stringify({ok:false,executed:results.length,passed:results.filter(result=>result.pass).length,error:error.message},null,2));process.exit(1);});
