"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, ".."), BASE = "http://127.0.0.1:3001", TEST_DATABASE = "zoicas_osinski_test";
const results = [];
function check(name, pass, detail = "") { results.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`); }
function env() { const values=Object.fromEntries(fs.readFileSync(path.join(ROOT,".env.test"),"utf8").split(/\r?\n/).filter(line=>line && !line.startsWith("#") && line.includes("=")).map(line=>{const at=line.indexOf("=");return[line.slice(0,at),line.slice(at+1)];})); if(process.env.ENV_FILE!==".env.test"||values.MYSQL_DATABASE!==TEST_DATABASE||values.PORT!=="3001") throw new Error("Refusing outside the isolated test environment."); return values; }
function hash(password) { return new Promise((resolve,reject)=>{const salt=crypto.randomBytes(16);crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`));}); }
async function request(route,{method="GET",body,cookie}={}) { const headers={Origin:BASE};if(cookie)headers.Cookie=cookie;if(body)headers["Content-Type"]="application/json";const response=await fetch(BASE+route,{method,headers,body:body?JSON.stringify(body):undefined});let json={};try{json=await response.json();}catch{}return{status:response.status,json,cookie:String(response.headers.get("set-cookie")||"").split(";")[0]}; }
async function loginAdmin(page,values) { await page.goto(`${BASE}/admin.html`,{waitUntil:"domcontentloaded"});await page.fill("#login-username",values.ADMIN_USERNAME);await page.fill("#login-password",values.PHASE168_TEST_ADMIN_PASSWORD);await page.locator("#login-form button[type=submit]").click();await page.waitForSelector("#dashboard-view:not([hidden])"); }

(async()=>{
 const values=env(), db=await mysql.createConnection({host:values.MYSQL_HOST,port:Number(values.MYSQL_PORT),user:values.MYSQL_ADMIN_USER,password:values.MYSQL_ADMIN_PASSWORD,database:TEST_DATABASE});
 const stamp=Date.now(),password="Phase1617DMap!1",credential=await hash(password),email=`p1617d.map.${stamp}@example.test`;
 try {
  const [customer]=await db.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash,status) VALUES (?,?,?,?,?,?, 'ACTIVE')",[`TEST-P1617D-MAP-${stamp}`,"TEST","Map State Customer",`p1617d.map.customer.${stamp}@example.test`,"+49123520001",credential]);
  const [employee]=await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)",[`TEST-P1617D-MAP-${stamp}`,"TEST","Map State Employee",email,"+49123520002",credential,"Tester","TEST DATA – Phase 16.17D"]);
  const [order]=await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,? ,?,'GEPLANT','NORMAL',?)",[`TEST-P1617D-MAP-${stamp}`,customer.insertId,"Reinigung","TEST DATA – Phase 16.17D map states","Synthetic map state test"]);
  const [assignment]=await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),'09:00','17:00','GEPLANT','TEST DATA – Phase 16.17D')",[order.insertId,employee.insertId]);
  const employeeLogin=await request("/api/employee/login",{method:"POST",body:{email,password}});check("employee login",employeeLogin.status===200);
  const checkin=await request("/api/employee/attendance/check-in",{method:"POST",cookie:employeeLogin.cookie,body:{assignment_id:assignment.insertId}});check("check-in",checkin.status===201);
  const sharing=await request("/api/employee/location-simulation/start",{method:"POST",cookie:employeeLogin.cookie,body:{}});check("sharing start",sharing.status===201);
  const update=await request("/api/employee/location-simulation/update",{method:"POST",cookie:employeeLogin.cookie,body:{synthetic:true,latitude:50.110924,longitude:8.682127}});check("sharing update",update.status===200);
  await db.execute("UPDATE employee_live_locations SET updated_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE employee_id=?",[employee.insertId]);
  const browser=await chromium.launch({headless:true});
  try {
   const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);await loginAdmin(page,values);await page.locator('[data-type="live-locations"]').click();await page.waitForSelector(".simulation-marker-STALE");check("stale marker",await page.locator(".simulation-marker-STALE").count()>0);
   await db.execute("DELETE FROM employee_live_locations WHERE employee_id=?",[employee.insertId]);await page.locator("#live-locations-refresh").click();await page.waitForSelector(".live-location-state-OFFLINE");check("offline state",await page.locator(".live-location-state-OFFLINE").count()>0);
   await page.route("**/api/admin/location-simulations",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({simulation:true,rows:[]})}));await page.locator("#live-locations-refresh").click();await page.waitForSelector("#live-locations-empty:not([hidden])");check("empty state",await page.locator("#live-locations-empty").isVisible());await page.unroute("**/api/admin/location-simulations");
   await page.route("**/api/admin/location-simulations",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({message:"Test service unavailable"})}));await page.locator("#live-locations-refresh").click();await page.waitForSelector("#live-locations-message:not([hidden])");check("error state",await page.locator("#live-locations-message").isVisible());await context.close();
  } finally { await browser.close(); }
  await request("/api/employee/location-simulation/stop",{method:"POST",cookie:employeeLogin.cookie,body:{}});await request("/api/employee/attendance/check-out",{method:"POST",cookie:employeeLogin.cookie,body:{}});
 } finally { await db.end(); }
 console.log(JSON.stringify({ok:true,executed:results.length,passed:results.filter(result=>result.pass).length},null,2));
})().catch(error=>{console.log(JSON.stringify({ok:false,executed:results.length,passed:results.filter(result=>result.pass).length,error:error.message},null,2));process.exit(1);});
