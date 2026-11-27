"use strict";
const fs=require("node:fs"),{parseEnv}=require("node:util"),{randomUUID,randomBytes,scryptSync}=require("node:crypto");
const mysql=require("mysql2/promise"), {berlinWallTime}=require("../attendance-punctuality");
const env=parseEnv(fs.readFileSync(".env.test","utf8"));
if(process.env.ENV_FILE!==".env.test"||env.PORT!=="3001"||env.MYSQL_DATABASE!=="zoicas_osinski_test"||env.MYSQL_HOST!=="127.0.0.1"||env.SMTP_HOST)throw Error("Isolated test configuration required");
const base="http://127.0.0.1:3001", api="/api/admin/contracts", plans="/api/admin/recurring-orders", results=[];
function check(label,pass){results.push({label,pass:Boolean(pass)});if(!pass)throw Error(label);}
async function req(route,cookie,method="GET",body,origin=base){
    const headers={Origin:origin};
    if(cookie)headers.Cookie=cookie;
    if(body && !(body instanceof FormData))headers["Content-Type"]="application/json";
    const r=await fetch(base+route,{headers,method,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
async function main(){
    const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database:env.MYSQL_DATABASE,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
    try {
        const [[config]]=await db.query("SELECT DATABASE() db,@@port port");
        check("Test database and server verified",config.db===env.MYSQL_DATABASE&&Number(config.port)===Number(env.MYSQL_PORT)&&(await req("/api/health")).data.database==="connected");
        const token=randomUUID().slice(0,8),password="TestAa!"+randomUUID();
        const auth=await req("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD});
        check("Admin login",auth.status===200&&auth.cookie);
        const admin=auth.cookie;
        async function customer(kind){
            const email=kind+"."+token+"@example.test";
            const r=await req("/api/customer/register",null,"POST",{first_name:"Test",last_name:kind,email,phone:"+49123456789",password,password_confirmation:password});
            const l=await req("/api/customer/login",null,"POST",{email,password});
            check(kind+" synthetic login",r.status===201&&l.status===200);
            return {id:r.data.id,cookie:l.cookie};
        }
        const owner=await customer("Owner"),other=await customer("Other");
        for(const role of ["EMPLOYEE","MANAGER"]){
            const salt=randomBytes(16),hash="scrypt$"+salt.toString("hex")+"$"+scryptSync(password,salt,64).toString("hex");
            const email=role+"."+token+"@example.test";
            await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')",["TEST-"+role+"-"+token,"TEST",role,email,"+49123456789",hash,role]);
            const login=await req("/api/employee/login",null,"POST",{email,password});
            check(role+" excluded from contract management",login.status===200&&(await req(api,login.cookie)).status===401);
        }
        const day=berlinWallTime(new Date()).slice(0,10);
        const offset=n=>new Date(Date.parse(day+"T12:00:00Z")+n*86400000).toISOString().slice(0,10);
        const draft={customer_id:owner.id,status:"ENTWURF",service_type:"Fensterreinigung",service_description:"Synthetic contract",start_date:"2020-01-10",
            interval_type:"WOECHENTLICH",interval_details:"Zweimal wöchentlich",payment_interval:"monatlich",net_amount:100,tax_rate:19,cancellation_notice_days:30};
        const historical={...draft,status:"BEENDET",end_date:"2022-08-17",historical_registration:true,external_contract_number:"EXT-"+token,cancellation_date:"2022-07-12",termination_date:"2022-08-17",termination_note:"Private synthetic reason"};
        check("Customer cannot manage contracts",(await req(api,owner.cookie,"POST",historical)).status===401);
        check("Cross-origin Admin write rejected",(await req(api,admin,"POST",historical,"https://other.example.test")).status===403);
        const h=await req(api,admin,"POST",historical);
        check("Historical ended contract registers directly",h.status===201);
        const historyPath=api+"/"+h.data.id;
        const history=(await req(historyPath,admin)).data;
        check("Original dates and separate contract numbers persisted",history.contract.start_date==="2020-01-10"&&history.contract.end_date==="2022-08-17"&&history.contract.external_contract_number===historical.external_contract_number&&history.contract.contract_number!==historical.external_contract_number&&history.email.status==="NONE");
        check("Duplicate external number rejected for one customer",(await req(api,admin,"POST",historical)).status===409);
        check("Same reference may be used by a different customer",(await req(api,admin,"POST",{...historical,customer_id:other.id})).status===201);
        const key=randomUUID(),keyed={...draft,registration_key:key};
        const repeats=await Promise.all([req(api,admin,"POST",keyed),req(api,admin,"POST",keyed)]);
        check("Concurrent registration key prevents duplicate draft",repeats.map(r=>r.status).sort().join(",")==="201,409");
        const draftId=repeats.find(r=>r.status===201).data.id;
        check("Draft is hidden even to its owner",(await req("/api/customer/contracts/"+draftId,owner.cookie)).status===404);
        const customerPath="/api/customer/contracts/"+h.data.id;
        const published=await req(customerPath,owner.cookie);
        check("Published history visible only to owner with safe date",published.status===200&&published.data.contract.start_date==="2020-01-10"&&(await req(customerPath,other.cookie)).status===404);
        check("Customer payload omits internal notes",!JSON.stringify(published.data).includes("Private synthetic reason")&&!JSON.stringify(published.data).includes("termination_note"));

        const document=new FormData();
        for(const [k,v] of Object.entries({customer_id:owner.id,contract_id:h.data.id,document_type:"VERTRAG",visibility:"ADMIN"}))document.set(k,String(v));
        document.set("file",new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==","base64")],{type:"image/png"}),"synthetic-cancellation.png");
        const upload=await req("/api/admin/documents",admin,"POST",document);
        check("Existing private document upload associates cancellation document",upload.status===201&&(await req(historyPath,admin)).data.documents.some(file=>file.file_name==="synthetic-cancellation.png"));
        check("Admin-only cancellation document is absent from customer listing",!(await req("/api/customer/documents",owner.cookie)).data.rows.some(file=>file.file_name==="synthetic-cancellation.png"));

        const active={...draft,status:"AKTIV",start_date:day};
        const created=await req(api,admin,"POST",active),path=api+"/"+created.data.id;
        check("Active contract created silently",created.status===201&&(await req(path,admin)).data.email.status==="NONE");
        const schedule={contract_id:created.data.id,start_date:offset(-1),end_date:offset(9),recurrence_type:"INDIVIDUELL",weekdays:"1,2,3,4,5,6,7",preferred_start_time:"13:00",duration_minutes:60,active:1};
        const plan=await req(plans,admin,"POST",schedule);
        check("Recurring plan associated and unique",plan.status===201&&(await req(path,admin)).data.schedule.id===plan.data.id&&(await req(plans,admin,"POST",schedule)).status===409);
        const importedDraft=await req(api,admin,"POST",{...active,status:"ENTWURF",historical_registration:true});
        const importedPath=api+"/"+importedDraft.data.id;
        const importedActive=await req(importedPath,admin,"PATCH",{...active,notify_on_activation:true});
        check("Previously registered historical draft remains silent even at a current start date",importedActive.status===200&&(await req(importedPath,admin)).data.email.status==="NONE");
        const note={...active,termination_note:"Private note only"};
        check("Cancellation note alone preserves status and schedule",(await req(path,admin,"PATCH",note)).status===200&&(await req(path,admin)).data.contract.status==="AKTIV");
        const existing=await req(plans+"/generate",admin,"POST",{contract_id:created.data.id,days:7});
        check("Recurring orders generated before cancellation",existing.status===201&&existing.data.summary.created===7);
        const record={...note,status:"GEKUENDIGT",cancellation_date:day,termination_date:offset(3)};
        check("Impossible effective termination rejected",(await req(path,admin,"PATCH",{...record,termination_date:"2024-02-30"})).status===400);
        check("Termination before notice rejected",(await req(path,admin,"PATCH",{...record,cancellation_date:offset(4)})).status===400);
        check("Date or status affecting recurring plan requires confirmation",(await req(path,admin,"PATCH",record)).status===409);
        check("Admin records cancellation with confirmation",(await req(path,admin,"PATCH",{...record,confirm_schedule_change:true})).status===200);
        const detail=(await req(path,admin)).data;
        check("Recorded cancellation flags schedule and existing orders without altering them",detail.contract.status==="GEKUENDIGT"&&detail.contract.end_date===null&&detail.contract.termination_date===offset(3)&&detail.scheduleConflict&&detail.ordersBeyondEnd.length>=2&&detail.email.status==="NONE");
        const secondRun=await req(plans+"/generate",admin,"POST",{contract_id:created.data.id,days:10});
        check("Generation stops at effective termination and retains scheduled orders",secondRun.data.summary.created===0&&(await req(path,admin)).data.ordersBeyondEnd.length===detail.ordersBeyondEnd.length);
        const planPath=plans+"/"+plan.data.id;
        check("Editing the future plan requires confirmation",(await req(planPath,admin,"PATCH",{...schedule,start_date:day,end_date:offset(3)})).status===409);
        check("Plan beyond cutoff rejected after confirmed cancellation",(await req(planPath,admin,"PATCH",{...schedule,confirm_schedule_change:true})).status===409);
        check("Confirmed correction clears plan warning but preserves existing orders",(await req(planPath,admin,"PATCH",{...schedule,start_date:day,end_date:offset(3),confirm_schedule_change:true})).status===200&&!(await req(path,admin)).data.scheduleConflict&&(await req(path,admin)).data.ordersBeyondEnd.length===detail.ordersBeyondEnd.length);
        const [[audit]]=await db.execute("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CONTRACT' AND entity_id=? AND action='CONTRACT_STATUS_CHANGED' AND JSON_EXTRACT(metadata,'$.cancellationRecorded')=true",[created.data.id]);
        check("Lifecycle changes audited",Number(audit.n)>0);
        await browse(admin,history.contract.contract_number,historical.external_contract_number);
    } finally {await db.end();}
}
async function browse(admin,number,external){
    const browser=await require("playwright").chromium.launch();
    try {
        for(const [width,height] of [[375,812],[768,1024],[1440,900]]){
            const context=await browser.newContext({viewport:{width,height}});
            try{
                await context.route(url=>url.origin!==base,route=>route.abort());
                const i=admin.indexOf("=");
                await context.addCookies([{name:admin.slice(0,i),value:admin.slice(i+1),url:base}]);
                const page=await context.newPage();
                page.setDefaultTimeout(10000);
                await page.goto(base+"/public/admin.html",{waitUntil:"domcontentloaded"});
                await page.locator('[data-type="contract"]').click();
                await page.getByRole("row").filter({hasText:number}).getByRole("button",{name:"Öffnen"}).click();
                const dialog=page.locator("#contract-dialog");
                await dialog.waitFor();
                check(width+" shows original contract reference and dates",await dialog.locator('[name="external_contract_number"]').inputValue()===external&&await dialog.locator('[name="start_date"]').inputValue()==="2020-01-10");
                check(width+" shows document and cancellation controls without dialog overflow",await dialog.getByText("synthetic-cancellation.png",{exact:true}).isVisible()&&
                    await dialog.getByLabel("Wirksames Vertragsende").inputValue()==="2022-08-17"&&await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
            } finally{await context.close();}
        }
    } finally{await browser.close();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>{
    console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,skipped:0,failures:results.filter(r=>!r.pass).map(r=>r.label)}));
});
