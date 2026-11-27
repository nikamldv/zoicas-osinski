"use strict";

const fs=require("node:fs");
const path=require("node:path");
const {randomBytes,randomUUID,scryptSync}=require("node:crypto");
const mysql=require("mysql2/promise");

const config=require("node:util").parseEnv(fs.readFileSync(path.resolve(__dirname,"../.env.test"),"utf8"));
const database="zoicas_osinski_test", base="http://127.0.0.1:3001";
if(process.env.ENV_FILE!==".env.test"||config.MYSQL_DATABASE!==database||config.MYSQL_HOST!=="127.0.0.1"||config.PORT!=="3001"||config.SMTP_HOST) throw Error("Isolation guard failed.");
const results=[];
function check(name,ok,status) {
    results.push({name,ok:Boolean(ok)});
    if(!ok) throw Error(name+(status===undefined?"":" (status "+status+")"));
}
async function api(route,cookie,method="GET",body,origin=base) {
    const headers={Origin:origin};
    if(cookie) headers.Cookie=cookie;
    if(body!==undefined) headers["Content-Type"]="application/json";
    const r=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    return {status:r.status,body:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
 
async function main(){
    const db=await mysql.createConnection({host:config.MYSQL_HOST,port:Number(config.MYSQL_PORT),database,user:config.MYSQL_ADMIN_USER,password:config.MYSQL_ADMIN_PASSWORD});
    try{
        const [[identity]]=await db.query("SELECT DATABASE() AS name");
        const health=await api("/api/health");
        check("Isolated database and server",identity.name===database&&health.body.database==="connected");
        const stamp=randomUUID().slice(0,12),password="TestAa!"+randomUUID();
        const offsetDay=days=>{const date=new Date();date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
        const day=offsetDay(5);
        async function employee(role,label){
            const salt=randomBytes(16),hash=["scrypt",salt.toString("hex"),scryptSync(password,salt,64).toString("hex")].join("$");
            const email="phase1625."+label+"."+stamp+"@example.test";
            const [result]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')",
                ["TEST-1625-"+label+"-"+stamp,"TEST",label+" "+stamp,email,"+49123456789",hash,role]);
            const login=await api("/api/employee/login",null,"POST",{email,password});
            check(label+" login",login.status===200&&login.cookie,login.status);
            return {id:result.insertId,cookie:login.cookie,name:"TEST "+label+" "+stamp};
        }
        const owner=await employee("EMPLOYEE","Owner"),other=await employee("EMPLOYEE","Other"),manager=await employee("MANAGER","Manager");
        const email="phase1625.customer."+stamp+"@example.test";
        const registered=await api("/api/customer/register",null,"POST",{first_name:"TEST",last_name:"Customer",email,phone:"+49123456789",password,password_confirmation:password});
        check("Synthetic customer registration",registered.status===201,registered.status);
        const customer=await api("/api/customer/login",null,"POST",{email,password});
        check("Customer login",customer.status===200&&customer.cookie,customer.status);
        const login=await api("/api/admin/login",null,"POST",{username:config.ADMIN_USERNAME,password:config.PHASE168_TEST_ADMIN_PASSWORD});
        check("Admin login",login.status===200&&login.cookie,login.status);
        const admin=login.cookie, employeePath="/api/employee/absence-requests",adminPath="/api/admin/absence-requests";
        const hours=Array.from({length:7},(_,i)=>({weekday:i+1,start_time:"08:00",end_time:"18:00"}));
        check("Configured working hours",(await api("/api/admin/employees/"+owner.id+"/work-hours",admin,"PATCH",{hours})).status===200);
        async function order(){
            const r=await api("/api/admin/orders",admin,"POST",{customer_id:registered.body.id,service_type:"Reinigung",title:"Synthetic absence scheduling",status:"NEU",priority:"NORMAL"});
            check("Synthetic order created",r.status===201,r.status);
            return {id:r.body.id,number:r.body.orderNumber};
        }
        const existing=await order(), future=await order();
        const assign=(id,date,start="09:00",end="10:00")=>api("/api/admin/orders/"+id+"/assignments",admin,"POST",{employee_id:owner.id,assignment_date:date,start_time:start,end_time:end,status:"GEPLANT"});
        const assignment=await assign(existing.id,day);
        check("Assignment existed before request",assignment.status===201,assignment.status);
        const assignmentId=assignment.body.id;
        const requestData={absence_type:"URLAUB",start_date:day,end_date:offsetDay(6),note:"Synthetic vacation"};
        check("Reversed dates rejected",(await api(employeePath,owner.cookie,"POST",{...requestData,end_date:offsetDay(4)})).status===400);
        check("Impossible date rejected",(await api(employeePath,owner.cookie,"POST",{...requestData,start_date:"2080-02-31",end_date:"2080-03-01"})).status===400);
        check("Employee submission requires same origin",(await api(employeePath,owner.cookie,"POST",requestData,"https://example.test")).status===403);
        const submitted=await Promise.all([api(employeePath,owner.cookie,"POST",requestData),api(employeePath,owner.cookie,"POST",requestData)]);
        check("Concurrent overlapping requests create exactly one",submitted.map(r=>r.status).sort().join(",")==="201,409");
        const pending=submitted.find(r=>r.status===201),id=pending.body.id;
        check("Vacation starts PENDING",pending.body.status==="PENDING");
        check("Employee sees own request",(await api(employeePath,owner.cookie)).body.rows.some(row=>row.id===id));
        check("Other employee list excludes request",!(await api(employeePath,other.cookie)).body.rows.some(row=>row.id===id));
        check("Cross-employee detail denied",(await api(employeePath+"/"+id,other.cookie)).status===404);
        check("Cross-employee withdrawal denied",(await api(employeePath+"/"+id,other.cookie,"PATCH",{status:"WITHDRAWN"})).status===404);
        check("Employee cannot self approve",(await api(employeePath+"/"+id,owner.cookie,"PATCH",{status:"APPROVED"})).status===403);
        for(const [name,cookie] of [["Employee",owner.cookie],["MANAGER",manager.cookie],["Customer",customer.cookie],["Anonymous",null]]){
            check(name+" cannot open Admin queue",(await api(adminPath,cookie)).status===401);
            check(name+" cannot approve",(await api(adminPath+"/"+id,cookie,"PATCH",{status:"APPROVED"})).status===401);
        }
        check("Customer cannot open employee requests",(await api(employeePath,customer.cookie)).status===401);
        check("Admin pending list contains request",(await api(adminPath+"?status=PENDING",admin)).body.rows.some(row=>row.id===id));
        const reviewed=await api(adminPath+"/"+id,admin);
        check("Review identifies existing order and scheduled date",reviewed.status===200&&reviewed.body.conflicts.some(c=>c.id===assignmentId&&c.order_id===existing.id&&c.assignment_date===day));
        check("Approval without acknowledgement blocked",(await api(adminPath+"/"+id,admin,"PATCH",{status:"APPROVED"})).status===409);
        check("Admin decision requires same origin",(await api(adminPath+"/"+id,admin,"PATCH",{status:"APPROVED",conflict_ids:[assignmentId]},"https://example.test")).status===403);
        const approved=await Promise.all([1,2].map(()=>api(adminPath+"/"+id,admin,"PATCH",{status:"APPROVED",decision_note:"Synthetic approved note",conflict_ids:[assignmentId]})));
        check("Repeated parallel approval applies once",approved.map(r=>r.status).sort().join(",")==="200,409");
        const decision=await api(employeePath+"/"+id,owner.cookie);
        check("Approved decision and note visible to owner",decision.body.request.status==="APPROVED"&&decision.body.request.decision_note==="Synthetic approved note");
        const orderDetail=await api("/api/admin/orders/"+existing.id,admin);
        const stillThere=orderDetail.body.assignments.find(row=>row.id===assignmentId);
        check("Existing assignment preserved and flagged",stillThere?.employee_id===owner.id&&stillThere.status==="GEPLANT"&&Number(stillThere.absence_review_required)===1);
        const schedule=await api("/api/admin/employee-schedules?date="+day,admin);
        check("Schedule includes absence and review flag",schedule.body.employees.some(row=>row.id===owner.id&&row.absence?.absence_type==="URLAUB"&&row.assignments.some(a=>a.id===assignmentId&&Number(a.absence_review_required)===1)));
        check("New conflict blocked by availability",(await assign(future.id,day,"11:00","12:00")).status===409);
        check("Request overlapping approved absence blocked",(await api(employeePath,owner.cookie,"POST",requestData)).status===409);
        check("Approved request cannot be withdrawn",(await api(employeePath+"/"+id,owner.cookie,"PATCH",{status:"WITHDRAWN"})).status===409);
        check("Non-conflicting assignment still permitted",(await assign(future.id,offsetDay(9))).status===201);
        const rejected=await api(employeePath,owner.cookie,"POST",{absence_type:"FREI",start_date:offsetDay(10),end_date:offsetDay(10)});
        check("Other supported absence submitted",rejected.status===201,rejected.status);
        check("Admin rejected request",(await api(adminPath+"/"+rejected.body.id,admin,"PATCH",{status:"REJECTED",decision_note:"Synthetic rejection"})).status===200);
        check("Rejected decision displayed",(await api(employeePath+"/"+rejected.body.id,owner.cookie)).body.request.status==="REJECTED");
        const withdrawn=await api(employeePath,owner.cookie,"POST",{absence_type:"SONSTIGE",start_date:offsetDay(11),end_date:offsetDay(11)});
        check("Employee withdrew pending request",withdrawn.status===201&&(await api(employeePath+"/"+withdrawn.body.id,owner.cookie,"PATCH",{status:"WITHDRAWN"})).status===200);
        check("Withdrawn request retained in history",(await api(adminPath+"?status=WITHDRAWN",admin)).body.rows.some(row=>row.id===withdrawn.body.id));
        check("Withdrawn request cannot be approved",(await api(adminPath+"/"+withdrawn.body.id,admin,"PATCH",{status:"APPROVED"})).status===409);
        const [[records]]=await db.execute("SELECT COUNT(*) total FROM employee_absences WHERE employee_id=?",[owner.id]);
        check("Only approval created a scheduling absence",Number(records.total)===1);
        const notices=await api("/api/employee/notifications",owner.cookie);
        check("Owner receives exactly one notification per decision",notices.status===200&&[id,rejected.body.id].every(entity=>notices.body.rows.filter(row=>row.entity_type==="ABSENCE_REQUEST"&&row.entity_id===entity).length===1));
        const [adminNotices]=await db.execute("SELECT entity_id FROM notifications WHERE recipient_type='ADMIN' AND entity_type='ABSENCE_REQUEST' AND entity_id IN (?,?,?)",[id,rejected.body.id,withdrawn.body.id]);
        check("One Admin notification per submission",adminNotices.length===3&&new Set(adminNotices.map(r=>r.entity_id)).size===3);
        const [audits]=await db.execute("SELECT action FROM audit_logs WHERE entity_type='ABSENCE_REQUEST' AND entity_id IN (?,?,?)",[id,rejected.body.id,withdrawn.body.id]);
        check("Submit, approve, reject and withdraw audited",["SUBMITTED","APPROVED","REJECTED","WITHDRAWN"].every(state=>audits.some(row=>row.action==="ABSENCE_REQUEST_"+state)));
        const managerRequest=await api(employeePath,manager.cookie,"POST",{absence_type:"URLAUB",start_date:offsetDay(8),end_date:offsetDay(8)});
        check("MANAGER can submit own request",managerRequest.status===201,managerRequest.status);
        if(process.argv.includes("--browser")) {
            const browserDate=offsetDay(9);
            const pendingConflict=await api(employeePath,owner.cookie,"POST",{absence_type:"URLAUB",start_date:browserDate,end_date:browserDate});
            check("Prepared pending browser conflict",pendingConflict.status===201,pendingConflict.status);
            await browserChecks({admin,owner,day,id,offsetDay,pendingId:pendingConflict.body.id,browserDate});
        }
    }finally{await db.end();}
}

async function browserChecks({admin,owner,day,id,offsetDay,pendingId,browserDate}){
    const browser=await require("playwright").chromium.launch();
    try{
        for(const [width,height] of [[375,812],[768,1024],[1440,900]]){
            async function open(cookie,url){
                const context=await browser.newContext({viewport:{width,height}});
                await context.route(u=>u.origin!==base,r=>r.abort());
                const at=cookie.indexOf("=");
                await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:base}]);
                const page=await context.newPage();
                page.setDefaultTimeout(8000);
                await page.goto(base+url,{waitUntil:"domcontentloaded"});
                return page;
            }
            const employeePage=await open(owner.cookie,"/public/mitarbeiterportal.html");
            await employeePage.locator('[data-employee-view="absence"]').click();
            const form=employeePage.locator("#employee-absence-form");
            await employeePage.locator("#employee-absence-list").getByText("Synthetic approved note",{exact:true}).waitFor();
            check(width+" employee request form and history",await form.isVisible()&&await employeePage.getByText("Synthetic approved note",{exact:true}).isVisible());
            check(width+" employee fits viewport",await employeePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            if(width===375){
                await form.locator('[name=start_date]').fill(offsetDay(14));
                await form.locator('[name=end_date]').fill(offsetDay(14));
                await form.getByRole("button",{name:"Antrag einreichen"}).click();
                await employeePage.getByText("Antrag eingereicht.",{exact:true}).waitFor();
                const submitted=employeePage.locator("#employee-absence-list").getByText(offsetDay(14),{exact:false});
                await submitted.waitFor();
                check("Employee submitted request in mobile browser",await submitted.isVisible());
            }
            await employeePage.context().close();
            const adminPage=await open(admin,"/admin.html");
            await adminPage.locator('[data-type="schedule"]').click();
            if(width===375){
                await adminPage.locator('[data-absence-request-id="'+pendingId+'"]').click();
                const review=adminPage.locator("#absence-request-dialog");
                await review.locator("#absence-request-conflict-list").getByText(browserDate,{exact:false}).waitFor();
                await review.getByRole("button",{name:"Genehmigen"}).click();
                check("Mobile Admin must acknowledge conflicting assignment",await review.getByText("Bitte bestätigen Sie, dass Sie die betroffenen Einsätze geprüft haben.",{exact:true}).isVisible());
                await review.locator("#absence-request-confirm").check();
                const saved=adminPage.waitForResponse(r=>r.request().method()==="PATCH"&&r.url()===base+"/api/admin/absence-requests/"+pendingId);
                await review.getByRole("button",{name:"Genehmigen"}).click();
                check("Admin approved request in mobile browser",(await saved).status()===200);
                await review.waitFor({state:"hidden"});
            }
            await adminPage.locator("#absence-request-filter").selectOption("APPROVED");
            await adminPage.locator('[data-absence-request-id="'+id+'"]').click();
            const dialog=adminPage.locator("#absence-request-dialog");
            await dialog.waitFor();
            check(width+" Admin history and conflict details",await dialog.getByText(day,{exact:false}).count()>=2);
            check(width+" Admin fits viewport",await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await adminPage.context().close();
        }
    }finally{await browser.close();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>{
    console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,failures:results.filter(r=>!r.ok).map(r=>r.name)}));
});

