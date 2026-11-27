"use strict";

const fs = require("node:fs");
const {parseEnv} = require("node:util");
const {randomUUID,randomBytes,scryptSync} = require("node:crypto");
const mysql = require("mysql2/promise");
const {berlinWallTime} = require("../attendance-punctuality");
const env = parseEnv(fs.readFileSync(".env.test","utf8"));
const base = "http://127.0.0.1:3001";
if (process.env.ENV_FILE !== ".env.test" || env.PORT !== "3001" ||
    env.MYSQL_HOST !== "127.0.0.1" || env.MYSQL_DATABASE !== "zoicas_osinski_test" ||
    env.PRIVATE_DOCUMENT_UPLOAD_DIR !== "storage/test-private-documents" || env.SMTP_HOST || process.env.SMTP_HOST) {
    throw Error("Isolation guard failed");
}
const results = [];
function check(label, pass) {
    results.push({label,pass:Boolean(pass)});
    if(!pass)throw Error(label);
}
async function req(route,cookie,method="GET",body,origin=base) {
    const headers={Origin:origin};
    if(cookie)headers.Cookie=cookie;
    if(body && !(body instanceof FormData))headers["Content-Type"]="application/json";
    const response=await fetch(base+route,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const type=response.headers.get("content-type")||"";
    const data=type.includes("json")?await response.json():Buffer.from(await response.arrayBuffer());
    return {status:response.status,data,type,cookie:response.headers.get("set-cookie")?.split(";")[0]};
}

async function browserRecovery(sessions,exceptionOrder) {
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    try {
        const sizes = [[375,812],[768,1024],[1440,900]];
        const portals = [
            ["admin","/public/admin.html","Heutige Aufträge"],
            ["employee","/public/mitarbeiterportal.html","Heutige Einsätze"],
            ["customer","/public/kundenbereich.html","Nächster Service"]
        ];
        for (const [width,height] of sizes) {
            for (const [role,path,heading] of portals) {
                const context = await browser.newContext({viewport:{width,height}});
                try {
                    await context.route(url=>url.origin!==base,route=>route.abort());
                    const cookie=sessions[role], at=cookie.indexOf("=");
                    await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:base}]);
                    const page=await context.newPage();
                    page.setDefaultTimeout(10000);
                    let release;
                    const held=new Promise(resolve=>{release=resolve;});
                    await page.route("**/api/"+role+"/home",async route=>{
                        await held;
                        await route.fulfill({status:503,json:{message:"Synthetic service temporarily unavailable"}});
                    },{times:1});
                    await page.goto(base+path,{waitUntil:"domcontentloaded"});
                    try {
                        const loading=page.getByText("Übersicht wird geladen …",{exact:true});
                        await loading.waitFor();
                        check(role+" "+width+" announces dashboard loading",await loading.getAttribute("role")==="status");
                    } finally {release();}
                    const retry=page.getByRole("button",{name:"Erneut versuchen",exact:true});
                    await retry.waitFor();
                    check(role+" "+width+" displays recoverable service error",await page.getByText("Übersicht konnte nicht geladen werden.",{exact:true}).isVisible());
                    await retry.focus();
                    await page.keyboard.press("Enter");
                    const cards=page.locator(".portal-home-grid");
                    await cards.getByRole("heading",{name:heading,exact:true}).waitFor();
                    check(role+" "+width+" recovers on keyboard and fits viewport",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
                    if (role==="admin" && width===1440) {
                        await page.locator('[data-type="order"]').click();
                        await page.locator("#search-input").fill(exceptionOrder);
                        await page.locator("#records-body tr").filter({hasText:exceptionOrder}).getByRole("button").first().click();
                        const team=page.getByRole("list",{name:"Teamnachweise"});
                        await team.getByRole("button",{name:"Ausnahme erfassen für Synthetic Crew"}).click();
                        const dialog=page.getByRole("dialog",{name:"Ausnahme zur Teamabrechnung"});
                        check("Admin billing exception form identifies the absence and requires a note",await dialog.getByLabel("Grund").inputValue()==="ABSENT"&&await dialog.getByLabel("Begründung").getAttribute("required")!==null);
                    }
                } finally {await context.close();}
            }
        }
    } finally {await browser.close();}
}

async function testExceptionAndCrew({db,admin,lead,crew,manager,owner,today,day,stamp,assign,contractBody,contracts,plans}) {
    const work=await req("/api/admin/orders",admin,"POST",{customer_id:owner.id,service_type:"Reinigung",title:"Synthetic attendance exception",status:"NEU",priority:"NORMAL"});
    const service=work.data.id,order="/api/admin/orders/"+service;
    const first=await assign(work.data,lead,today,"14:00","15:00"),second=await assign(work.data,crew,today,"14:00","15:00");
    check("Exception fixture has two planned team members",first.status===201&&second.status===201);
    const requested=await req("/api/employee/absence-requests",crew.cookie,"POST",{absence_type:"URLAUB",start_date:today,end_date:today,note:"Synthetic exception"});
    const approve="/api/admin/absence-requests/"+requested.data.id;
    const review=(await req(approve,admin)).data;
    check("Approved absence is backed by an explicit team conflict",requested.status===201&&review.conflicts.some(x=>x.id===second.data.id)&&
        (await req(approve,admin,"PATCH",{status:"APPROVED",conflict_ids:review.conflicts.map(x=>x.id)})).status===200);
    const route=order+"/assignments/"+second.data.id+"/billing-exception";
    check("Exception rejects Employee, MANAGER, Customer and foreign origin",
        (await req(route,lead.cookie,"PUT",{reason:"ABSENT",note:"test"})).status===401&&
        (await req(route,manager.cookie,"PUT",{reason:"ABSENT",note:"test"})).status===401&&
        (await req(route,owner.cookie,"PUT",{reason:"ABSENT",note:"test"})).status===401&&
        (await req(route,admin,"PUT",{reason:"ABSENT",note:"test"},"https://example.test")).status===403);
    check("Exception requires a reason and note",(await req(route,admin,"PUT",{reason:"ABSENT",note:""})).status===400);
    check("Exception cannot delete the unfinished team record",(await req(order+"/assignments/"+second.data.id,admin,"DELETE")).status===409);
    check("Explicit absence exception is recorded once",(await req(route,admin,"PUT",{reason:"ABSENT",note:"Approved absence recorded by dispatch."})).status===200&&
        (await req(route,admin,"PUT",{reason:"ABSENT",note:"Second request"})).status===409);
    const [[record]]=await db.execute("SELECT a.status,x.reason,EXISTS(SELECT 1 FROM audit_logs l WHERE l.entity_type='ORDER_ASSIGNMENT' AND l.entity_id=a.id AND l.action='BILLING_EXCEPTION_RECORDED') AS audited FROM order_assignments a JOIN order_billing_exceptions x ON x.assignment_id=a.id WHERE a.id=?",[second.data.id]);
    check("Exception is audited and does not mark work complete",record.reason==="ABSENT"&&record.status==="GEPLANT"&&Number(record.audited)===1);
    check("An exception alone still does not qualify for billing",!(await req(order,admin)).data.billing.eligible);
    check("Present crew member checks in", (await req("/api/employee/attendance/check-in",lead.cookie,"POST",{assignment_id:first.data.id})).status===201);
    await new Promise(resolve=>setTimeout(resolve,1100));
    check("Present crew member closes attendance",(await req("/api/employee/attendance/check-out",lead.cookie,"POST",{})).data.status==="CLOSED");
    const workReport=await req("/api/employee/service-reports",lead.cookie,"POST",{order_id:service,assignment_id:first.data.id,
        service_date:today,started_at:today+"T14:00",finished_at:today+"T15:00",summary:"Synthetic completed visit"});
    check("Present crew member submits reviewed work",workReport.status===201&&
        (await req("/api/employee/service-reports/"+workReport.data.id+"/submit",lead.cookie,"POST",{})).status===200&&
        (await req("/api/admin/service-reports/"+workReport.data.id+"/review",admin,"PATCH",{status:"REVIEWED"})).status===200);
    const draft=await req(order+"/create-invoice",admin,"POST",{});
    check("Reviewed work plus audited absence qualifies for an invoice draft",draft.status===201);
    check("Revoking the exception blocks publication of the existing draft",(await req(route,admin,"DELETE")).status===200&&
        (await req("/api/admin/invoices/"+draft.data.id,admin,"PATCH",{customer_id:owner.id,order_id:service,invoice_date:today,due_date:day(14),status:"GESENDET"})).status===409);

    const crewDay=day(6), weekday=new Date(crewDay+"T12:00:00Z").getUTCDay()||7;
    const [occupiedHours]=await db.execute("SELECT h.start_time,h.end_time FROM employee_work_hours h JOIN employees e ON e.id=h.employee_id WHERE e.status='ACTIVE' AND h.weekday=?",[weekday]);
    const clock=minutes=>String(Math.floor(minutes/60)).padStart(2,"0")+":"+String(minutes%60).padStart(2,"0");
    const slot=Array.from({length:20},(_,index)=>[clock(index*15),clock(index*15+30)]).find(([start,end])=>!occupiedHours.some(row=>row.start_time.slice(0,5)<=start&&row.end_time.slice(0,5)>=end));
    check("Isolated early slot has no other employees in working hours",Boolean(slot));
    for (const member of [lead,crew]) {
        const hours=Array.from({length:7},(_,index)=>({weekday:index+1,start_time:index+1===weekday?slot[0]:"08:00",end_time:index+1===weekday?slot[1]:"18:00"}));
        check("Early-shift fixture working hours for employee "+member.id,(await req("/api/admin/employees/"+member.id+"/work-hours",admin,"PATCH",{hours})).status===200);
    }
    const contract=await req(contracts,admin,"POST",{...contractBody,registration_key:randomUUID(),external_contract_number:"CREW-"+stamp});
    const recurring={contract_id:contract.data.id,start_date:crewDay,end_date:crewDay,recurrence_type:"EINMALIG",
        preferred_start_time:slot[0],duration_minutes:30,preferred_employee_ids:[lead.id,crew.id],required_crew_size:3,confirm_schedule_change:true};
    const saved=await req(plans,admin,"POST",recurring);
    check("Three-person crew plan with two preferred employees saved",contract.status===201&&saved.status===201);
    const legacyFields={...recurring};
    delete legacyFields.required_crew_size;
    delete legacyFields.preferred_employee_ids;
    const patched=await req(plans+"/"+saved.data.id,admin,"PATCH",legacyFields);
    const savedCrew=(await req(plans+"/"+saved.data.id,admin)).data.schedule;
    check("An edit without crew fields preserves required size and preferences",patched.status===200&&Number(savedCrew.required_crew_size)===3&&savedCrew.preferred_employee_ids.length===2);
    const result=await req(plans+"/generate",admin,"POST",{contract_id:contract.data.id,days:10});
    const [orders]=await db.execute("SELECT id,required_crew_size,status,(SELECT COUNT(*) FROM order_assignments a WHERE a.order_id=o.id) AS assigned FROM orders o WHERE contract_id=?",[contract.data.id]);
    check("One occurrence requires three people and records two as understaffed",result.status===201&&result.data.summary.understaffed===1&&orders.length===1&&
         Number(orders[0].required_crew_size)===3&&Number(orders[0].assigned)===2&&orders[0].status==="GEPLANT");
    let warning;
    for(let page=1;page<=40&&!warning;page++){
        const exceptions=await req(plans+"/exceptions?page="+page,admin);
        warning=exceptions.data.rows?.find(item=>item.type==="UNDERSTAFFED"&&item.order_id===orders[0].id);
        if(!exceptions.data.hasMore)break;
    }
    check("Recurring exception reports the exact crew shortfall",warning?.assigned_crew===2&&warning?.required_crew===3);
    const repeated=await req(plans+"/generate",admin,"POST",{contract_id:contract.data.id,days:10});
    check("Repeating crew generation creates no duplicate occurrence",repeated.status===201&&repeated.data.summary.created===0&&repeated.data.summary.existing===1);
    return work.data.orderNumber;
}

async function main(){
    const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database:env.MYSQL_DATABASE,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
    try {
        const [[target]]=await db.query("SELECT DATABASE() AS name,@@port AS port");
        check("Isolated target and HTTP server verified",target.name===env.MYSQL_DATABASE&&Number(target.port)===Number(env.MYSQL_PORT)&&(await req("/api/health")).data.database==="connected");
        const stamp=randomUUID().slice(0,8),password="TestAa!"+randomUUID();
        const berlin=berlinWallTime(new Date()),today=berlin.slice(0,10);
        const day=n=>new Date(Date.parse(today+"T12:00:00Z")+n*86400000).toISOString().slice(0,10);
        const a=await req("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD});
        check("Admin login",a.status===200);
        const admin=a.cookie;
        async function customer(label){
            const email="daily."+label+"."+stamp+"@example.test";
            const created=await req("/api/customer/register",null,"POST",{first_name:"Synthetic",last_name:label,email,phone:"+49123456789",password,password_confirmation:password});
            const login=await req("/api/customer/login",null,"POST",{email,password});
            check(label+" customer creates account and signs in",created.status===201&&login.status===200);
            return {id:created.data.id,cookie:login.cookie};
        }
        async function employee(label,role="EMPLOYEE"){
            const salt=randomBytes(16),hash=["scrypt",salt.toString("hex"),scryptSync(password,salt,64).toString("hex")].join("$");
            const email="daily."+label+"."+stamp+"@example.test";
            const [created]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')",["TEST-DAILY-"+label+"-"+stamp,"Synthetic",label,email,"+49123456789",hash,role]);
            const login=await req("/api/employee/login",null,"POST",{email,password});
            check(label+" Employee Portal login",login.status===200);
            return {id:created.insertId,cookie:login.cookie};
        }
        const owner=await customer("Owner"),foreign=await customer("Foreign");
        const lead=await employee("Lead"),crew=await employee("Crew"),manager=await employee("Manager","MANAGER");
        const hours=Array.from({length:7},(_,i)=>({weekday:i+1,start_time:"08:00",end_time:"18:00"}));
        check("Separate working hours configured for both staff members", (await req("/api/admin/employees/"+lead.id+"/work-hours",admin,"PATCH",{hours})).status===200&&(await req("/api/admin/employees/"+crew.id+"/work-hours",admin,"PATCH",{hours})).status===200);

        const contracts="/api/admin/contracts", plans="/api/admin/recurring-orders";
        const original="DAILY-EXT-"+stamp;
        const contractBody={customer_id:owner.id,external_contract_number:original,start_date:"2022-04-04",end_date:day(7),status:"AKTIV",historical_registration:true,
            service_type:"Büroreinigung",service_description:"Synthetic daily service "+stamp,interval_type:"INDIVIDUELL",interval_details:"Täglich",net_amount:100,tax_rate:19,payment_interval:"monatlich",registration_key:randomUUID()};
        const concurrent=await Promise.all([req(contracts,admin,"POST",contractBody),req(contracts,admin,"POST",contractBody)]);
        check("Duplicate historical registration produces one contract",concurrent.map(r=>r.status).sort().join(",")==="201,409");
        const contractId=concurrent.find(r=>r.status===201).data.id, contractPath=contracts+"/"+contractId;
        const details=(await req(contractPath,admin)).data;
        check("Contract retains original reference and dates and has no email attempt",details.contract.external_contract_number===original&&details.contract.start_date==="2022-04-04"&&details.contract.end_date===day(7)&&details.email.status==="NONE"&&!details.schedule);
        const attachment=new FormData();
        for(const [key,value] of Object.entries({customer_id:owner.id,contract_id:contractId,document_type:"VERTRAG",visibility:"CUSTOMER"})) attachment.set(key,String(value));
        attachment.set("file",new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/evoAAAAASUVORK5CYII=","base64")],{type:"image/png"}),"synthetic-"+stamp+".png");
        const doc=await req("/api/admin/documents",admin,"POST",attachment);
        check("Contract document is linked and downloadable only by its owner",doc.status===201&&(await req(contractPath,admin)).data.documents.some(item=>item.id===doc.data.id)&&
            (await req("/api/customer/documents/"+doc.data.id,owner.cookie)).status===200&&(await req("/api/customer/documents/"+doc.data.id,foreign.cookie)).status===404);
        const plan={contract_id:contractId,start_date:today,end_date:day(7),weekdays:"1,2,3,4,5,6,7",recurrence_type:"INDIVIDUELL",preferred_start_time:"09:00",
            duration_minutes:60,preferred_employee_id:lead.id,service_address:"Synthetischer Weg 2",service_postal_code:"10115",service_city:"Berlin"};
        check("Historical plan requires Admin confirmation",(await req(plans,admin,"POST",plan)).status===409);
        const schedule=await req(plans,admin,"POST",{...plan,confirm_schedule_change:true});
        const [[initial]]=await db.execute("SELECT COUNT(*) n FROM orders WHERE contract_id=?",[contractId]);
        check("Plan saved without automatically creating an order",schedule.status===201&&Number(initial.n)===0);
        const generated=await req(plans+"/generate",admin,"POST",{contract_id:contractId,days:3});
        const [orders]=await db.execute("SELECT id,order_number,status,address,DATE_FORMAT(planned_start,'%Y-%m-%d') AS day FROM orders WHERE contract_id=? ORDER BY planned_start",[contractId]);
        check("Generation creates three orders with the configured service site",generated.status===201&&generated.data.summary.created===3&&orders.length===3&&orders.every(r=>r.address===plan.service_address));
        const service=orders[0], next=orders[1], later=orders[2];
        const orderPath="/api/admin/orders/"+service.id,billing=orderPath+"/create-invoice";
        const initialStaff=(await req(orderPath+"/assignments",admin)).data.rows;
        check("Generator creates one preferred-employee assignment per occurrence",initialStaff.length===1&&initialStaff[0].employee_id===lead.id);
        const assign=(order,staff,when,start,end)=>req("/api/admin/orders/"+order.id+"/assignments",admin,"POST",{employee_id:staff.id,assignment_date:when,start_time:start,end_time:end,status:"GEPLANT"});
        check("Assignment outside employee hours rejected",(await assign(service,crew,today,"06:00","07:00")).status===409);
        const added=await assign(service,crew,today,"09:00","10:00");
        check("Admin can assign a second employee to the same order and time",added.status===201&&(await req(orderPath+"/assignments",admin)).data.rows.length===2);
        check("Overlapping assignment for the same employee rejected",(await assign(next,crew,today,"09:30","10:30")).status===409);
        check("Both employees see the same order in their own daily schedule",[await req("/api/employee/home",lead.cookie),await req("/api/employee/home",crew.cookie)].every(r=>r.status===200&&r.data.today.some(item=>item.order_number===service.order_number)));
        check("Unassigned manager cannot check in and has no Admin access",(await req("/api/employee/attendance/check-in",manager.cookie,"POST",{assignment_id:initialStaff[0].id})).status===404&&(await req(orderPath,manager.cookie)).status===401);

        const absent=await req("/api/employee/absence-requests",lead.cookie,"POST",{absence_type:"URLAUB",start_date:day(1),end_date:day(1),note:"Synthetic absence"});
        const absencePath="/api/admin/absence-requests/"+absent.data.id;
        const conflict=await req(absencePath,admin);
        const conflictIds=conflict.data.conflicts?.map(item=>item.id)||[];
        check("Absence review finds existing assignment without silently changing it",absent.status===201&&conflict.data.conflicts?.some(c=>c.order_id===next.id)&&
            (await req(absencePath,admin,"PATCH",{status:"APPROVED"})).status===409);
        check("Confirmed approval flags original assignment and blocks new conflicting assignment",
            (await req(absencePath,admin,"PATCH",{status:"APPROVED",conflict_ids:conflictIds})).status===200&&
            (await req("/api/admin/orders/"+next.id+"/assignments",admin)).data.rows.some(item=>Number(item.absence_review_required)===1)&&
            (await assign(later,lead,day(1),"13:00","14:00")).status===409);
        const exceptions=await req(plans+"/exceptions",admin);
        check("Admin exception queue exposes the absence conflict",exceptions.status===200&&exceptions.data.rows.some(item=>item.type==="ABSENCE_CONFLICT"&&item.order_id===next.id));

        const materialName="TEST DAILY "+stamp;
        const [material]=await db.execute("INSERT INTO materials(material_number,name,unit,minimum_stock) VALUES(?,?,'STUECK',1)",["TEST-MAT-"+stamp,materialName]);
        await db.execute("INSERT INTO material_stock_movements(movement_number,material_id,movement_type,quantity,movement_date,status) VALUES(?,?,'RECEIPT',10,?,'APPROVED')",["TEST-RECEIPT-"+stamp,material.insertId,today]);
        const before=(await req("/api/admin/home",admin)).data.finance;
        check("Both employees check in under separate attendance sessions",(await req("/api/employee/attendance/check-in",lead.cookie,"POST",{assignment_id:initialStaff[0].id})).status===201&&
            (await req("/api/employee/attendance/check-in",crew.cookie,"POST",{assignment_id:added.data.id})).status===201);
        const consumption={material_id:material.insertId,order_id:service.id,movement_type:"CONSUMPTION",quantity:2,movement_date:today};
        const movement=await req("/api/employee/material-consumptions",lead.cookie,"POST",consumption);
        check("Employee records material use and duplicate submission is blocked",movement.status===201&&movement.data.status==="RECORDED"&&(await req("/api/employee/material-consumptions",lead.cookie,"POST",consumption)).status===409);
        const approved=await req("/api/admin/material-stock-movements/"+movement.data.id,admin,"PATCH",{status:"APPROVED"});
        check("Admin approves material consumption",approved.status===200);
        const [[stock]]=await db.execute("SELECT SUM(CASE movement_type WHEN 'RECEIPT' THEN quantity WHEN 'CONSUMPTION' THEN -quantity ELSE 0 END) balance FROM material_stock_movements WHERE material_id=? AND status='APPROVED'",[material.insertId]);
        check("Approved stock reconciles ten received minus two used",Number(stock.balance)===8);
        await new Promise(resolve=>setTimeout(resolve,1100));
        check("Lead checks out but check-out alone cannot start billing",(await req("/api/employee/attendance/check-out",lead.cookie,"POST",{})).data.status==="CLOSED"&&(await req(billing,admin,"POST",{})).status===409);
        async function report(staff,assignment){
            const created=await req("/api/employee/service-reports",staff.cookie,"POST",{order_id:service.id,assignment_id:assignment,service_date:today,started_at:today+"T09:00",finished_at:today+"T10:00",summary:"Synthetic cleaning performed"});
            check("Work report can be created for assigned visit "+assignment,created.status===201);
            check("Work report can be submitted "+assignment,(await req("/api/employee/service-reports/"+created.data.id+"/submit",staff.cookie,"POST",{})).status===200);
            return created.data.id;
        }
        const leadReport=await report(lead,initialStaff[0].id);
        check("Submitted report without Admin review does not qualify for billing",(await req(billing,admin,"POST",{})).status===409);
        const review=id=>req("/api/admin/service-reports/"+id+"/review",admin,"PATCH",{status:"REVIEWED"});
        check("Admin reviews lead report",(await review(leadReport)).status===200);
        const gate=(await req(orderPath,admin)).data.billing;
        check("One reviewed report never makes an unfinished crew billable",!gate.eligible&&gate.team.length===2&&(await req(billing,admin,"POST",{})).status===409);
        check("An open attendance session cannot be waived",(await req(orderPath+"/assignments/"+added.data.id+"/billing-exception",admin,"PUT",{reason:"UNABLE_TO_COMPLETE",note:"Synthetic open attendance"})).status===409);
        const crewReport=await report(crew,added.data.id);
        check("Second employee submits an independent report and checks out",(await req("/api/employee/attendance/check-out",crew.cookie,"POST",{})).data.status==="CLOSED"&&(await review(crewReport)).status===200);
        check("Both attended and reviewed team assignments become eligible",(await req(orderPath,admin)).data.billing.eligible===true);
        const createdInvoice=await req(billing,admin,"POST",{});
        check("Reviewed work becomes exactly one invoice draft",createdInvoice.status===201&&(await req(billing,admin,"POST",{})).status===409);
        const invoiceId=createdInvoice.data.id, invoice="/api/admin/invoices/"+invoiceId, customerInvoice="/api/customer/invoices/"+invoiceId;
        const hidden=await req(customerInvoice,owner.cookie);
        const draftFinance=(await req("/api/admin/home",admin)).data.finance;
        check("Draft is invisible to owner and excluded from issued amounts",hidden.status===404&&(await req(customerInvoice+"/pdf",owner.cookie)).status===404&&draftFinance.issued_amount===before.issued_amount);
        const invoicePayload={customer_id:owner.id,order_id:service.id,contract_id:contractId,invoice_date:today,due_date:day(14),status:"GESENDET"};
        const savedAssignment={employee_id:crew.id,assignment_date:today,start_time:"09:00",end_time:"10:00"};
        const assignmentPath=orderPath+"/assignments/"+added.data.id;
        check("An order invoice cannot be detached while still a draft",(await req(invoice,admin,"PATCH",{...invoicePayload,order_id:null,status:"ENTWURF"})).status===409);
        check("Cancellation of required work cannot bypass team billing",(await req(assignmentPath,admin,"PATCH",{...savedAssignment,status:"STORNIERT"})).status===200&&
            (await req(invoice,admin,"PATCH",invoicePayload)).status===409);
        check("Restoring the completed assignment permits publication without customer confirmation",
            (await req(assignmentPath,admin,"PATCH",{...savedAssignment,status:"ERLEDIGT"})).status===200&&(await req(invoice,admin,"PATCH",invoicePayload)).status===200);
        const pdf=await req(customerInvoice+"/pdf",owner.cookie);
        check("Owner views published invoice and gets a real PDF",(await req(customerInvoice,owner.cookie)).status===200&&pdf.status===200&&pdf.type.includes("application/pdf")&&pdf.data.subarray(0,5).toString()==="%PDF-");
        check("Foreign customer and Employee cannot download invoice",(await req(customerInvoice+"/pdf",foreign.cookie)).status===404&&(await req(customerInvoice+"/pdf",lead.cookie)).status===401);
        check("Admin records partial payment",(await req(invoice+"/payments",admin,"POST",{payment_date:today,payment_method:"BAR",amount:40})).status===201);
        const after=(await req("/api/admin/home",admin)).data.finance;
        const [[ledger]]=await db.execute("SELECT i.gross_amount AS gross,SUM(p.amount) AS paid FROM invoices i JOIN invoice_payments p ON p.invoice_id=i.id WHERE i.id=? GROUP BY i.id",[invoiceId]);
        const cents=number=>Math.round(Number(number)*100);
        check("Finance reconciles invoice €119, payment €40 and receivable €79",cents(ledger.gross)===11900&&cents(ledger.paid)===4000&&
            cents(after.issued_amount)-cents(before.issued_amount)===11900&&cents(after.monthly_payments)-cents(before.monthly_payments)===4000&&
            cents(after.outstanding_amount)-cents(before.outstanding_amount)===7900);
        check("Admin shares reviewed report",(await req("/api/admin/service-reports/"+leadReport+"/share",admin,"PATCH",{})).status===200);
        const confirm="/api/customer/service-reports/"+leadReport+"/confirm";
        check("Customer confirmation is optional and owner-only",(await req(confirm,foreign.cookie,"POST",{})).status===404&&(await req(confirm,owner.cookie,"POST",{})).status===200);

        const complaintBody={submission_key:randomUUID(),order_id:service.id,description:"Synthetic linked complaint"};
        const complaint=await req("/api/customer/complaints",owner.cookie,"POST",complaintBody);
        const repeated=await req("/api/customer/complaints",owner.cookie,"POST",complaintBody);
        check("Linked customer complaint and duplicate protection",complaint.status===201&&repeated.status===200&&repeated.data.id===complaint.data.id);
        const complaintAdmin="/api/admin/complaints/"+complaint.data.id;
        const incident=await req(complaintAdmin+"/convert",admin,"POST",{});
        const quality="/api/admin/quality-incidents/"+incident.data.incidentId;
        const started=await req(quality,admin,"PATCH",{customer_id:owner.id,order_id:service.id,category:"Kundenbeschwerde",severity:"NORMAL",title:"Synthetic complaint",description:complaintBody.description,status:"IN_PROGRESS",internal_notes:"Synthetic internal detail"});
        check("Admin opens the corrective workflow",started.status===200);
        const action=await req(quality+"/actions",admin,"POST",{assigned_employee_id:lead.id,title:"Synthetic follow-up"});
        check("Admin converts complaint and employee completes corrective action",incident.status===201&&action.status===201&&
            (await req("/api/employee/quality-actions/"+action.data.id,lead.cookie,"PATCH",{status:"COMPLETED"})).status===200);
        check("Admin publishes a customer-visible resolution",(await req(quality+"/resolve",admin,"POST",{})).status===200&&
            (await req(complaintAdmin+"/publish",admin,"POST",{publication_key:randomUUID(),status:"RESOLVED",response:"Synthetic resolution"})).status===200&&
            (await req("/api/customer/complaints/"+complaint.data.id,owner.cookie)).data.record.status==="RESOLVED");
        check("Confirmed termination keeps future scheduled orders",(await req(contractPath,admin,"PATCH",{...contractBody,status:"GEKUENDIGT",cancellation_date:today,termination_date:today,confirm_schedule_change:true})).status===200&&
            (await req(contractPath,admin)).data.ordersBeyondEnd.some(item=>item.id===later.id));
        check("Generation cannot add orders after effective termination",(await req(plans+"/generate",admin,"POST",{contract_id:contractId,days:7})).data.summary.created===0);
        const manual=await req("/api/admin/orders",admin,"POST",{customer_id:owner.id,service_type:"Reinigung",title:"Synthetic manual crew order",status:"NEU",priority:"NORMAL"});
        const team=await Promise.all([assign(manual.data,lead,day(4),"11:00","12:00"),assign(manual.data,crew,day(4),"11:00","12:00")]);
        check("Concurrent team assignment creates both assignments",manual.status===201&&team.every(result=>result.status===201));
        const [[notices]]=await db.execute("SELECT COUNT(*) n FROM notifications WHERE recipient_type='CUSTOMER' AND recipient_id=? AND entity_type='ORDER' AND entity_id=? AND title='Einsatz geplant'",[owner.id,manual.data.id]);
        check("Concurrent team assignment sends one customer schedule notice",Number(notices.n)===1);
        const [[individual]]=await db.execute("SELECT COUNT(DISTINCT recipient_id) n FROM notifications WHERE recipient_type='EMPLOYEE' AND entity_type='ORDER' AND entity_id=?",[manual.data.id]);
        check("Both employees receive their own notification independently",Number(individual.n)===2);
        await req("/api/admin/orders/"+manual.data.id+"/assignments/"+team[1].data.id,admin,"PATCH",
            {employee_id:crew.id,assignment_date:day(5),start_time:"11:00",end_time:"12:00",status:"GEPLANT"});
        const [[noticeAfter]]=await db.execute("SELECT COUNT(*) n FROM notifications WHERE recipient_type='CUSTOMER' AND recipient_id=? AND entity_type='ORDER' AND entity_id=? AND title='Einsatz geplant'",[owner.id,manual.data.id]);
        check("A later distinct schedule change produces another customer notice",Number(noticeAfter.n)===2);
        const exceptionOrder=await testExceptionAndCrew({db,admin,lead,crew,manager,owner,today,day,stamp,assign,contractBody,contracts,plans});
        await browserRecovery({admin,employee:lead.cookie,customer:owner.cookie},exceptionOrder);
        console.log(JSON.stringify({reconciliation:{gross:Number(ledger.gross),received:Number(ledger.paid),outstanding:Number(ledger.gross)-Number(ledger.paid)}}));
    } finally { await db.end(); }
}
main().catch(error=>{
    if (!results.some(result=>!result.pass)) results.push({label:error.code||error.message,pass:false});
    process.exitCode=1;
}).finally(()=>{
    console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,skipped:0,failures:results.filter(r=>!r.pass).map(r=>r.label)}));
});
