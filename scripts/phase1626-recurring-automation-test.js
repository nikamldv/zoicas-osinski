"use strict";
const fs=require("node:fs"), path=require("node:path");
const {randomBytes,randomUUID,scryptSync}=require("node:crypto");
const mysql=require("mysql2/promise");
const env=require("node:util").parseEnv(fs.readFileSync(path.resolve(__dirname,"../.env.test"),"utf8"));
const base="http://127.0.0.1:3001", database="zoicas_osinski_test";
if(process.env.ENV_FILE!==".env.test"||env.MYSQL_DATABASE!==database||env.MYSQL_HOST!=="127.0.0.1"||env.PORT!=="3001"||env.SMTP_HOST) throw Error("Isolation guard failed");
const results=[];
function check(name,ok,status){results.push({name,ok:Boolean(ok)});if(!ok)throw Error(name+(status===undefined?"":" (status "+status+")"));}
async function api(route,cookie,method="GET",body,origin=base){
 const headers={Origin:origin};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 return {status:r.status,body:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
const datePlus=(day,n)=>new Date(Date.parse(day+"T00:00Z")+n*86400000).toISOString().slice(0,10);
const millis=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
 const automation="/api/admin/recurring-orders/automation", generation="/api/admin/recurring-orders/generate", exceptions="/api/admin/recurring-orders/exceptions";
 let admin,enabled=false;
 try{
  const [[identity]]=await db.query("SELECT DATABASE() AS name");
  check("Isolated database and server",identity.name===database&&(await api("/api/health")).body.database==="connected");
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const day=n=>datePlus(today,n), stamp=randomUUID().slice(0,12), password="TestAa!"+randomUUID();
  const login=await api("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD});
  check("Admin login",login.status===200&&login.cookie,login.status);admin=login.cookie;
  const cfg=await api(automation,admin);
  check("Automatic generation starts disabled",cfg.status===200&&cfg.body.allowed&&!cfg.body.enabled);
  const email="phase1626.customer."+stamp+"@example.test";
  const registered=await api("/api/customer/register",null,"POST",{first_name:"TEST",last_name:"Recurring",email,phone:"+49123456789",password,password_confirmation:password});
  check("Synthetic customer created",registered.status===201,registered.status);
  const customer=await api("/api/customer/login",null,"POST",{email,password});
  check("Customer login",customer.status===200&&customer.cookie);
  const customerId=registered.body.id;
  async function employee(role){
   const salt=randomBytes(16), hash=["scrypt",salt.toString("hex"),scryptSync(password,salt,64).toString("hex")].join("$");
   const emailAddress="phase1626."+role.toLowerCase()+"."+stamp+"@example.test";
   const [created]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')",
    ["TEST-1626-"+role+"-"+stamp,"TEST",role,emailAddress,"+49123456789",hash,role]);
   const session=await api("/api/employee/login",null,"POST",{email:emailAddress,password});
   check(role+" login",session.status===200&&session.cookie);
   const hours=Array.from({length:7},(_,i)=>({weekday:i+1,start_time:"08:00",end_time:"18:00"}));
   check(role+" working hours configured",(await api("/api/admin/employees/"+created.insertId+"/work-hours",admin,"PATCH",{hours})).status===200);
   return {id:created.insertId,cookie:session.cookie};
  }
  const preferred=await employee("EMPLOYEE"), backup=await employee("MANAGER");
  for(const [name,cookie] of [["Employee",preferred.cookie],["MANAGER",backup.cookie],["Customer",customer.cookie],["Anonymous",null]]){
   check(name+" cannot generate",(await api(generation,cookie,"POST",{days:1})).status===401);
   check(name+" cannot configure automation",(await api(automation,cookie,"PATCH",{enabled:true,days:1})).status===401);
   check(name+" cannot read exceptions",(await api(exceptions,cookie)).status===401);
  }
  check("Admin trigger requires same origin",(await api(generation,admin,"POST",{days:1},"https://example.test")).status===403);
  check("Automation configuration requires same origin",(await api(automation,admin,"PATCH",{enabled:true,days:1},"https://example.test")).status===403);
  check("Invalid planning horizon rejected",(await api(automation,admin,"PATCH",{enabled:true,days:31})).status===400);

  async function approveAbsence(date){
   const created=await api("/api/employee/absence-requests",preferred.cookie,"POST",{absence_type:"URLAUB",start_date:date,end_date:date});
   check("Employee requested absence "+date,created.status===201,created.status);
   const route="/api/admin/absence-requests/"+created.body.id, review=await api(route,admin);
   const approved=await api(route,admin,"PATCH",{status:"APPROVED",conflict_ids:review.body.conflicts.map(row=>row.id)});
   check("Admin approved absence "+date,approved.status===200,approved.status);
  }
  await approveAbsence(day(1));
  const ordinary=await api("/api/admin/orders",admin,"POST",{customer_id:customerId,title:"Synthetic overlapping order",service_type:"Reinigung",status:"NEU",priority:"NORMAL"});
  check("Ordinary order fixture created",ordinary.status===201);
  const overlapping=await api("/api/admin/orders/"+ordinary.body.id+"/assignments",admin,"POST",{employee_id:preferred.id,assignment_date:day(2),start_time:"09:15",end_time:"09:45",status:"GEPLANT"});
  check("Overlapping assignment fixture created",overlapping.status===201,overlapping.status);
  async function schedule(label,recurrence_type,start_date,end_date,extra={}){
   const contractData={customer_id:customerId,start_date:day(-80),service_description:"Synthetic "+label+" "+stamp,service_type:"Reinigung",interval_type:"INDIVIDUELL",net_amount:100,tax_rate:19,status:"AKTIV"};
   const contract=await api("/api/admin/contracts",admin,"POST",{...contractData,...extra.contract});
   check(label+" contract created",contract.status===201,contract.status);
   const input={contract_id:contract.body.id,start_date,end_date,recurrence_type,preferred_start_time:"09:00",duration_minutes:60,preferred_employee_id:preferred.id,...extra.schedule};
   const record=await api("/api/admin/recurring-orders",admin,"POST",input);
   check(label+" schedule created",record.status===201,record.status);
   return {id:record.body.id,contract:contract.body.id,input};
  }
  const rows=async schedule=>{
   const [data]=await db.execute("SELECT o.id,o.order_number,DATE_FORMAT(o.planned_start,'%Y-%m-%d') AS day,a.id AS assignment_id,a.employee_id FROM orders o LEFT JOIN order_assignments a ON a.order_id=o.id AND a.status<>'STORNIERT' WHERE o.automation_schedule_id=? ORDER BY o.planned_start",[schedule.id]);return data;
  };
  const run=(schedule,days=10)=>api(generation,admin,"POST",{days,contract_id:schedule.contract});
  const daily=await schedule("Daily","INDIVIDUELL",day(1),day(3),{schedule:{weekdays:"1,2,3,4,5,6,7"}});
  const parallel=await Promise.all([run(daily),run(daily)]);
  check("Manual fallback generated daily occurrences",parallel.every(r=>r.status===201)&&parallel.reduce((n,r)=>n+r.body.summary.created,0)===3,parallel.map(r=>r.status).join(","));
  const generated=await rows(daily);
  check("Concurrent runs create exactly one occurrence per date",generated.map(row=>row.day).join(",")===[day(1),day(2),day(3)].join(","));
  check("Approved absence prevents assignment",generated[0].employee_id===null);
  check("Overlapping assignment prevents assignment",generated[1].employee_id===null);
  check("Available employee was assigned",generated[2].employee_id===preferred.id);
  check("Repeated manual run creates no further orders",(await run(daily)).body.summary.created===0);
  const changed=await api("/api/admin/recurring-orders/"+daily.id,admin,"PATCH",{...daily.input,preferred_start_time:"10:00",confirm_schedule_change:true});
  check("Changing slot time does not duplicate existing occurrences",changed.status===200&&(await run(daily)).body.summary.created===0&&(await rows(daily)).length===3);
  const weekly=await schedule("Weekly","WOECHENTLICH",day(1),day(9),{schedule:{preferred_start_time:"11:00"}});
  check("Weekly cadence generates dates seven days apart",(await run(weekly)).body.summary.created===2&&(await rows(weekly)).map(r=>r.day).join(",")===[day(1),day(8)].join(","));
  const monthly=await schedule("Monthly","MONATLICH",day(4),day(15),{schedule:{preferred_start_time:"12:00"}});
  check("Monthly schedule generates its calendar day",(await run(monthly)).body.summary.created===1&&(await rows(monthly))[0].day===day(4));
  const inactive=await schedule("Inactive","EINMALIG",day(1),day(1),{schedule:{active:false}});
  check("Inactive recurrence does not generate",(await run(inactive)).body.summary.created===0&&(await rows(inactive)).length===0);
  const ended=await schedule("Ended","EINMALIG",day(-3),day(-3));
  check("Ended recurrence does not generate",(await run(ended)).body.summary.created===0&&(await rows(ended)).length===0);
  const clipped=await schedule("Contract window","INDIVIDUELL",day(1),day(4),{contract:{start_date:day(2),end_date:day(3)},schedule:{weekdays:"1,2,3,4,5,6,7",preferred_start_time:"14:00"}});
  check("Contract date bounds clip recurrence",(await run(clipped)).body.summary.created===2&&(await rows(clipped)).map(r=>r.day).join(",")===[day(2),day(3)].join(","));
  const bad=await schedule("Invalid stored slot","EINMALIG",day(1),day(1));
  await db.execute("UPDATE recurring_schedules SET preferred_start_time='23:55:00' WHERE id=?",[bad.id]);
  const failed=await run(bad);
  check("Failed generation recorded without counting rolled-back orders",failed.status===201&&failed.body.summary.failed===1&&failed.body.summary.created===0&&(await rows(bad)).length===0);
  await approveAbsence(day(3));
  await db.execute("INSERT INTO order_assignments(order_id,employee_id,assignment_date,start_time,end_time,status) VALUES (?,?,?,'09:20:00','09:40:00','GEPLANT')",[ordinary.body.id,preferred.id,day(3)]);
  await db.execute("UPDATE employee_work_hours SET start_time='10:00:00' WHERE employee_id=?", [preferred.id]);
  const issues=await api(exceptions,admin);
  const allIssues=[...issues.body.rows];
  for(let page=2,more=issues.body.hasMore;more;page++) {
   const next=(await api(exceptions+"?page="+page,admin)).body;
   allIssues.push(...next.rows);more=next.hasMore;
  }
  const match=(type,id)=>allIssues.some(row=>row.type===type&&(row.order_id===id||row.schedule_id===id));
  check("Overview shows unstaffed recurring order",match("UNSTAFFED",generated[0].id));
  check("Overview shows approved-absence conflict",match("ABSENCE_CONFLICT",generated[2].id));
  check("Overview shows overlap conflict",match("ASSIGNMENT_CONFLICT",generated[2].id));
  check("Overview shows manual review",match("MANUAL_REVIEW",generated[2].id));
  check("Overview shows failed generation and run history",match("GENERATION_FAILED",bad.id)&&issues.body.runs.some(row=>row.result==="FAILED"));
  await run(daily);await run(daily);
  const [[dedup]]=await db.execute("SELECT COUNT(*) AS n FROM notifications WHERE recipient_type='ADMIN' AND notification_type='RECURRING_UNSTAFFED' AND entity_type='ORDER' AND entity_id=?",[generated[0].id]);
  check("Repeated detection creates one Admin notice per issue",Number(dedup.n)===1);
  const manual=await api("/api/admin/orders/"+generated[0].id+"/assignments",admin,"POST",{employee_id:backup.id,assignment_date:day(1),start_time:"09:00",end_time:"10:00",status:"GEPLANT"});
  check("Admin resolves unstaffed issue through existing assignment controls",manual.status===201,manual.status);
  check("Resolved issue leaves exception overview",!(await api(exceptions,admin)).body.rows.some(row=>row.type==="UNSTAFFED"&&row.order_id===generated[0].id));
  const [[notified]]=await db.execute("SELECT COUNT(*) AS n FROM notifications WHERE recipient_type='CUSTOMER' AND entity_type='ORDER' AND entity_id IN (?,?,?)",generated.map(row=>row.id));
  check("Generation and unconfirmed staffing send no customer notices",Number(notified.n)===0);
  const after=await rows(daily);
  check("Original absence-conflicted assignment remains intact",after[2].assignment_id===generated[2].assignment_id&&after[2].employee_id===preferred.id);
  const auto=await schedule("Automatic","EINMALIG",day(1),day(4),{schedule:{preferred_employee_id:backup.id,preferred_start_time:"15:00"}});
  const configured=await api(automation,admin,"PATCH",{enabled:true,days:2});enabled=configured.status===200;
  check("Admin enables test-only timer with two-day horizon",enabled&&configured.body.days===2);
  const deadline=Date.now()+20000;
  let autoOrders=[];
  do {await millis(250);autoOrders=await rows(auto);}while(!autoOrders.length&&Date.now()<deadline);
  check("Timer generated eligible order without manual trigger",autoOrders.length===1&&autoOrders[0].day===day(1));
  let history;
  do {history=await api(exceptions,admin);if(!history.body.runs.some(row=>row.action==="RUN_AUTOMATIC"))await millis(200);else break;}while(Date.now()<deadline);
  check("Automatic run is recorded",(history.body.runs||[]).some(row=>row.action==="RUN_AUTOMATIC"&&["SUCCESS","FAILED"].includes(row.result)));
  const disabled=await api(automation,admin,"PATCH",{enabled:false,days:2});enabled=disabled.status!==200;
  check("Admin can disable timer",disabled.status===200&&!disabled.body.enabled);
  const [audit]=await db.execute("SELECT action FROM audit_logs WHERE entity_type='RECURRING_SCHEDULE' AND entity_id=? AND action='RECURRING_ORDER_GENERATED'",[daily.id]);
  check("Generated occurrence audit preserved",audit.length===1);
  if(process.argv.includes("--browser"))await browserChecks(admin,generated[1].order_number,bad.id);
 }finally{
  if(enabled)await api(automation,admin,"PATCH",{enabled:false,days:7}).catch(()=>{});
  await db.end();
 }
}

async function browserChecks(cookie,unstaffedOrder){
 const browser=await require("playwright").chromium.launch();
 try{
  for(const [width,height] of [[375,812],[768,1024],[1440,900]]){
   const context=await browser.newContext({viewport:{width,height}});
   await context.route(url=>url.origin!==base,route=>route.abort());
   const at=cookie.indexOf("=");
   await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:base}]);
   const page=await context.newPage();page.setDefaultTimeout(8000);
   await page.goto(base+"/admin.html",{waitUntil:"domcontentloaded"});
   await page.locator('[data-type="recurring"]').click();
   const panel=page.locator("#recurring-operations-panel");
   const issue=panel.locator("article").filter({hasText:unstaffedOrder});
   await panel.locator("#recurring-exceptions-list article").first().waitFor();
   const next=panel.locator("#recurring-exceptions-next");
   while(!await issue.count() && await next.isEnabled()) {
    const refreshed=page.waitForResponse(r=>r.url().includes("/api/admin/recurring-orders/exceptions?page="));
    await next.click();await refreshed;
    await panel.locator("#recurring-operations-status").getByText("Automatische Generierung aus.",{exact:true}).waitFor();
   }
   await issue.waitFor();
   check(width+" exceptions, run history and automation controls are visible",await panel.locator("#recurring-automation-form").isVisible()&&await panel.locator("#recurring-runs-list p").first().isVisible());
   check(width+" no page overflow",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await issue.getByRole("button").click();
   await page.locator("#order-dialog[open]").waitFor();
   check(width+" exception opens existing order assignment controls",await page.locator("#order-assignment-section").isVisible());
   await context.close();
  }
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,failures:results.filter(r=>!r.ok).map(r=>r.name)})));

