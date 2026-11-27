"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const ROOT=path.resolve(__dirname,".."), BASE="http://127.0.0.1:3001", TEST_DATABASE="zoicas_osinski_test";
const results=[];
function check(name,pass,detail=""){results.push({name,pass:Boolean(pass)});if(!pass)throw new Error(`${name}${detail?`: ${detail}`:""}`);}
function env(){const value=Object.fromEntries(fs.readFileSync(path.join(ROOT,".env.test"),"utf8").split(/\r?\n/).filter(Boolean).map(line=>{const index=line.indexOf("=");return[line.slice(0,index),line.slice(index+1)];}));if(process.env.ENV_FILE!==".env.test"||value.MYSQL_DATABASE!==TEST_DATABASE||value.PORT!=="3001")throw new Error("Refusing outside isolated test environment.");return value;}
function passwordHash(password){return new Promise((resolve,reject)=>{const salt=crypto.randomBytes(16);crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`));});}
async function request(route,{method="GET",body,cookie,origin=BASE}={}){const headers={Origin:origin};if(cookie)headers.Cookie=cookie;if(body)headers["Content-Type"]="application/json";const response=await fetch(BASE+route,{method,headers,body:body?JSON.stringify(body):undefined});let json={};try{json=await response.json();}catch{}return{status:response.status,json,cookie:String(response.headers.get("set-cookie")||"").split(";")[0]};}
async function adminLogin(page,values){await page.goto(`${BASE}/admin.html`,{waitUntil:"domcontentloaded"});await page.fill("#login-username",values.ADMIN_USERNAME);await page.fill("#login-password",values.PHASE168_TEST_ADMIN_PASSWORD);await page.locator("#login-form button[type=submit]").click();await page.waitForSelector("#dashboard-view:not([hidden])");}

(async()=>{
 const values=env(),db=await mysql.createConnection({host:values.MYSQL_HOST,port:Number(values.MYSQL_PORT),user:values.MYSQL_ADMIN_USER,password:values.MYSQL_ADMIN_PASSWORD,database:TEST_DATABASE});
 const stamp=Date.now(),password="Phase1617CMap!1",email=`p1617c.map.${stamp}@example.test`,hash=await passwordHash(password);
 try{
  const [customer]=await db.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash,status) VALUES (?,?,?,?,?,?, 'ACTIVE')",[`TEST-P1617C-${stamp}`,"TEST","Map Customer",`p1617c.customer.${stamp}@example.test`,"+49123458001",hash]);
  const [employee]=await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)",[`TEST-P1617C-${stamp}`,"TEST","Map Employee",email,"+49123458002",hash,"Tester","TEST DATA – Phase 16.17C"]);
  const [order]=await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,? ,?,'GEPLANT','NORMAL',?)",[`TEST-P1617C-${stamp}`,customer.insertId,"Reinigung","TEST DATA – Phase 16.17C Map","Synthetic isolated map test"]);
  const [assignment]=await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),'09:00','17:00','GEPLANT','TEST DATA – Phase 16.17C')",[order.insertId,employee.insertId]);
  const employeeLogin=await request("/api/employee/login",{method:"POST",body:{email,password}});check("employee login",employeeLogin.status===200,String(employeeLogin.status));
  const checkin=await request("/api/employee/attendance/check-in",{method:"POST",cookie:employeeLogin.cookie,body:{assignment_id:assignment.insertId}});check("check-in",checkin.status===201,String(checkin.status));
  const sharing=await request("/api/employee/location-simulation/start",{method:"POST",cookie:employeeLogin.cookie,body:{}});check("simulation start",sharing.status===201,String(sharing.status));
  const update=await request("/api/employee/location-simulation/update",{method:"POST",cookie:employeeLogin.cookie,body:{synthetic:true,latitude:50.110924,longitude:8.682127,accuracy_meters:15}});check("synthetic update",update.status===200,String(update.status));
  const browser=await chromium.launch({headless:true});
  try{
   for(const viewport of [{name:"mobile",width:375,height:812},{name:"tablet",width:768,height:1024},{name:"desktop",width:1440,height:900}]){
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}}),page=await context.newPage();page.setDefaultTimeout(10000);const pageErrors=[];page.on("pageerror",error=>pageErrors.push(error.message));await adminLogin(page,values);await page.locator('[data-type="live-locations"]').click();await page.waitForSelector("#live-locations-panel:not([hidden])");
    check(`${viewport.name}: banner`,await page.locator(".simulation-banner").isVisible());
    check(`${viewport.name}: marker`,await page.locator("[data-live-location-marker]").count()>0);
    check(`${viewport.name}: accessible list`,await page.locator("#live-locations-list-body tr").count()>0);
    check(`${viewport.name}: no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
    check(`${viewport.name}: marker keyboard focus`,await page.locator("[data-live-location-marker]").first().evaluate(node=>{node.focus();return document.activeElement===node;}));
    await page.locator("[data-live-location-marker]").first().click();check(`${viewport.name}: marker details`,await page.locator("#live-location-marker-detail").innerText().then(text=>/TEST Map Employee|Map Employee/.test(text)&&/Auftrag/.test(text)));
    const axe=await new AxeBuilder({page}).include("#live-locations-panel").analyze(), serious=axe.violations.filter(issue=>["serious","critical"].includes(issue.impact));check(`${viewport.name}: axe serious/critical`,!serious.length,serious.map(issue=>`${issue.id}:${issue.nodes.map(node=>node.target.join(" ")).join("|")}`).join(","));
    check(`${viewport.name}: no browser errors`,pageErrors.length===0,pageErrors[0]||"");await context.close();
   }
  }finally{await browser.close();}
  const admin=await request("/api/admin/login",{method:"POST",body:{username:values.ADMIN_USERNAME,password:values.PHASE168_TEST_ADMIN_PASSWORD}});check("admin api login",admin.status===200,String(admin.status));
  const rows=await request("/api/admin/location-simulations",{cookie:admin.cookie});check("admin API map data",rows.status===200&&rows.json.rows.some(row=>Number(row.id)===Number(sharing.json.id)&&row.location_status==="ACTIVE"),String(rows.status));
  const customerApi=await request("/api/admin/location-simulations",{cookie:employeeLogin.cookie});check("employee blocked from admin map",customerApi.status===401,String(customerApi.status));
  await request("/api/employee/location-simulation/stop",{method:"POST",cookie:employeeLogin.cookie,body:{}});await request("/api/employee/attendance/check-out",{method:"POST",cookie:employeeLogin.cookie,body:{}});
 }finally{await db.end();}
 console.log(JSON.stringify({ok:true,executed:results.length,passed:results.filter(result=>result.pass).length},null,2));
})().catch(error=>{console.log(JSON.stringify({ok:false,executed:results.length,passed:results.filter(result=>result.pass).length,error:error.message},null,2));process.exit(1);});
