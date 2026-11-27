"use strict";

const fs=require("node:fs"), path=require("node:path");
const {randomBytes,randomUUID,scryptSync}=require("node:crypto");
const mysql=require("mysql2/promise");
const env=require("node:util").parseEnv(fs.readFileSync(path.resolve(__dirname,"../.env.test"),"utf8"));
const base="http://127.0.0.1:3001", database="zoicas_osinski_test";
if(process.env.ENV_FILE!==".env.test"||env.MYSQL_DATABASE!==database||env.MYSQL_HOST!=="127.0.0.1"||env.PORT!=="3001"||env.SMTP_HOST)throw Error("Isolation guard failed");
const results=[];
function check(label,ok,status){results.push({label,ok:Boolean(ok)});if(!ok)throw Error(label+(status===undefined?"":" (status "+status+")"));}
async function api(route,cookie,method="GET",body,origin=base){
    const headers={Origin:origin};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers["Content-Type"]="application/json";
    const r=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    return {status:r.status,body:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}

async function main(){
    const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
    try{
        const [[identity]]=await db.query("SELECT DATABASE() AS name, DATE_FORMAT(DATE_ADD(CURDATE(),INTERVAL 7 DAY),'%Y-%m-%d') AS day");
        check("Isolated test system",identity.name===database&&(await api("/api/health")).body.database==="connected");
        const day=identity.day,stamp=randomUUID().slice(0,10),password="TestAa!"+randomUUID();
        const login=await api("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD});
        check("Admin login",login.status===200&&login.cookie,login.status);
        const admin=login.cookie;
        async function customer(label){
            const email="phase1627."+label+"."+stamp+"@example.test";
            const reg=await api("/api/customer/register",null,"POST",{first_name:"TEST",last_name:label,email,phone:"+49123456789",password,password_confirmation:password});
            check(label+" registration",reg.status===201,reg.status);
            const session=await api("/api/customer/login",null,"POST",{email,password});
            check(label+" login",session.status===200&&session.cookie,session.status);
            return {id:reg.body.id,cookie:session.cookie};
        }
        async function employee(role){
            const salt=randomBytes(16),hash=["scrypt",salt.toString("hex"),scryptSync(password,salt,64).toString("hex")].join("$");
            const email="phase1627."+role.toLowerCase()+"."+stamp+"@example.test";
            const [created]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')",
                ["TEST-1627-"+role+"-"+stamp,"TEST",role,email,"+49123456789",hash,role]);
            const session=await api("/api/employee/login",null,"POST",{email,password});
            check(role+" login",session.status===200&&session.cookie,session.status);
            return {id:created.insertId,cookie:session.cookie};
        }
        const owner=await customer("Owner"), other=await customer("Other"), staff=await employee("EMPLOYEE"), manager=await employee("MANAGER");
        const service="/api/customer/service-requests", complaint="/api/customer/complaints", manage="/api/admin/complaints";
        const services=await api(service,owner.cookie);
        check("Supported category provided by server",services.status===200&&services.body.services.includes("Fensterreinigung"));
        const requestData={submission_key:randomUUID(),service:"Fensterreinigung",description:"Synthetic service request "+stamp,preferred_date:day};
        check("Unsupported service rejected",(await api(service,owner.cookie,"POST",{...requestData,service:"unsupported"})).status===400);
        check("Impossible date rejected",(await api(service,owner.cookie,"POST",{...requestData,preferred_date:"2080-02-31"})).status===400);
        check("Service submission requires same origin",(await api(service,owner.cookie,"POST",requestData,"https://example.test")).status===403);
        const parallel=await Promise.all([api(service,owner.cookie,"POST",requestData),api(service,owner.cookie,"POST",requestData)]);
        check("Parallel retries create one request",parallel.map(r=>r.status).sort().join(",")==="200,201"&&parallel[0].body.id===parallel[1].body.id,parallel.map(r=>r.status).join(","));
        const requestId=parallel[0].body.id;
        check("Retry key cannot replace earlier content",(await api(service,owner.cookie,"POST",{...requestData,description:"Different content"})).status===409);
        check("Owner request list shows saved request",(await api(service,owner.cookie)).body.rows.some(r=>r.id===requestId&&r.status==="new"));
        check("Other customer cannot list or open request",!(await api(service,other.cookie)).body.rows.some(r=>r.id===requestId)&&(await api(service+"/"+requestId,other.cookie)).status===404);
        const requestAdmin="/api/admin/quote-requests/"+requestId;
        check("Admin opens request and status filter includes it",(await api(requestAdmin,admin)).status===200&&(await api("/api/admin/quote-requests?status=new",admin)).body.rows.some(r=>r.id===requestId));
        check("Admin updates operational status",(await api(requestAdmin,admin,"PATCH",{status:"in_progress"})).status===200&&(await api(service+"/"+requestId,owner.cookie)).body.record.status==="in_progress");
        const offer={customer_id:owner.id,quote_request_id:requestId,service_description:"Synthetic window work",service_type:"Fensterreinigung",start_date:day,items:[{title:"Windows",quantity:1,unit:"Pauschale",unit_price:100,discount_amount:0,tax_rate:19}]};
        const draft=await api("/api/admin/quotes",admin,"POST",{...offer,status:"ENTWURF"});
        check("Admin creates linked quote draft",draft.status===201,draft.status);
        const quoteId=draft.body.id, quotePath="/api/customer/quotes/"+quoteId;
        const notifyCount=async (recipient,kind,id)=>{
            const [[row]]=await db.execute("SELECT COUNT(*) AS n FROM notifications WHERE recipient_type=? AND notification_type=? AND entity_id=?",[recipient,kind,id]);
            return Number(row.n);
        };
        check("Draft link hidden in request list and detail",(await api(service,owner.cookie)).body.rows.find(r=>r.id===requestId)?.quote_id===null&&(await api(service+"/"+requestId,owner.cookie)).body.record.quote_id===null);
        check("Draft quote detail and notification unavailable",(await api(quotePath,owner.cookie)).status===404&&await notifyCount("CUSTOMER","QUOTE",quoteId)===0);
        const published=await api("/api/admin/quotes/"+quoteId,admin,"PATCH",{...offer,status:"GESENDET"});
        check("Published quote linked to owner request",published.status===200&&(await api(service+"/"+requestId,owner.cookie)).body.record.quote_id===quoteId&&(await api(service+"/"+requestId,owner.cookie)).body.record.status==="offer_sent");
        check("Published quote opens only for owner",(await api(quotePath,owner.cookie)).status===200&&(await api(quotePath,other.cookie)).status===404);
        check("Re-saving quote does not duplicate customer notification",(await api("/api/admin/quotes/"+quoteId,admin,"PATCH",{...offer,status:"GESENDET"})).status===200&&await notifyCount("CUSTOMER","QUOTE",quoteId)===1);
        check("Acceptance updates tracked request",(await api(quotePath+"/accept",owner.cookie,"POST",{})).status===200&&(await api(service+"/"+requestId,owner.cookie)).body.record.status==="accepted");
        const convertedOrder=await api("/api/admin/quotes/"+quoteId+"/create-order",admin,"POST",{});
        check("Accepted quote still converts to order",convertedOrder.status===201,convertedOrder.status);
        const orderId=convertedOrder.body.id;

        const payload={submission_key:randomUUID(),order_id:orderId,description:"Synthetic complaint "+stamp};
        check("Foreign order cannot be attached",(await api(complaint,other.cookie,"POST",payload)).status===404);
        check("Complaint submission requires same origin",(await api(complaint,owner.cookie,"POST",payload,"https://example.test")).status===403);
        const incoming=await api(complaint,owner.cookie,"POST",payload);
        check("Owner submits linked complaint",incoming.status===201,incoming.status);
        const complaintId=incoming.body.id, adminItem=manage+"/"+complaintId;
        check("Complaint retry does not duplicate",await notifyCount("ADMIN","COMPLAINT",complaintId)===1&&(await api(complaint,owner.cookie,"POST",payload)).body.id===complaintId&&await notifyCount("ADMIN","COMPLAINT",complaintId)===1);
        check("Unlinked complaint is supported",(await api(complaint,other.cookie,"POST",{submission_key:randomUUID(),description:"Synthetic unlinked complaint"})).status===201);
        check("Foreign complaint detail and list protected",(await api(complaint+"/"+complaintId,other.cookie)).status===404&&!(await api(complaint,other.cookie)).body.rows.some(r=>r.id===complaintId));
        for(const [role,cookie] of [["Employee",staff.cookie],["MANAGER",manager.cookie],["Anonymous",null]]){
            check(role+" cannot read customer request or complaint",(await api(service+"/"+requestId,cookie)).status===401&&(await api(complaint+"/"+complaintId,cookie)).status===401);
        }
        for(const [role,cookie] of [["Employee",staff.cookie],["MANAGER",manager.cookie],["Customer",owner.cookie],["Anonymous",null]]){
            check(role+" cannot manage, convert or publish complaint",(await api(manage,cookie)).status===401&&(await api(adminItem+"/convert",cookie,"POST",{})).status===401&&(await api(adminItem+"/publish",cookie,"POST",{})).status===401);
        }
        check("Admin queue includes complaint",(await api(manage+"?status=RECEIVED",admin)).body.rows.some(r=>r.id===complaintId));
        check("Complaint conversion requires same origin",(await api(adminItem+"/convert",admin,"POST",{},"https://example.test")).status===403);
        const converted=await Promise.all([api(adminItem+"/convert",admin,"POST",{}),api(adminItem+"/convert",admin,"POST",{})]);
        check("Concurrent conversion creates exactly one incident",converted.map(r=>r.status).sort().join(",")==="200,201"&&converted[0].body.incidentId===converted[1].body.incidentId,converted.map(r=>r.status).join(","));
        const incidentId=converted[0].body.incidentId, quality="/api/admin/quality-incidents/"+incidentId;
        const internal="Internal quality fixture "+stamp;
        const edited=await api(quality,admin,"PATCH",{customer_id:owner.id,order_id:orderId,category:"Kundenbeschwerde",severity:"NORMAL",title:"Synthetic complaint",description:payload.description,status:"IN_PROGRESS",internal_notes:internal});
        check("Internal quality workflow still editable",edited.status===200,edited.status);
        const action=await api(quality+"/actions",admin,"POST",{assigned_employee_id:staff.id,title:"Synthetic corrective action"});
        check("Existing corrective action assigned",action.status===201,action.status);
        const actionPath="/api/employee/quality-actions/"+action.body.id;
        check("Assigned employee completes corrective action",(await api(actionPath,staff.cookie,"PATCH",{status:"COMPLETED"})).status===200);
        check("Admin resolves incident internally",(await api(quality+"/resolve",admin,"POST",{})).status===200);
        const before=await api(complaint+"/"+complaintId,owner.cookie);
        check("Internal resolution and notes stay private",before.body.record.status==="RECEIVED"&&before.body.updates.length===0&&await notifyCount("CUSTOMER","COMPLAINT",complaintId)===0&&!JSON.stringify(before.body).includes(internal)&&!("incident_id" in before.body.record));
        const publication={publication_key:randomUUID(),status:"RESOLVED",response:"Synthetic public resolution "+stamp};
        check("Public update requires same origin",(await api(adminItem+"/publish",admin,"POST",publication,"https://example.test")).status===403);
        const outgoing=await api(adminItem+"/publish",admin,"POST",publication);
        check("Admin deliberately publishes safe update",outgoing.status===200,outgoing.status);
        const after=await api(complaint+"/"+complaintId,owner.cookie);
        check("Only public status and response visible",after.body.record.status==="RESOLVED"&&after.body.updates.length===1&&after.body.updates[0].response===publication.response&&!JSON.stringify(after.body).includes(internal));
        check("Replay and duplicate publication do not notify twice",(await api(adminItem+"/publish",admin,"POST",publication)).status===200&&(await api(adminItem+"/publish",admin,"POST",{...publication,publication_key:randomUUID()})).status===200&&await notifyCount("CUSTOMER","COMPLAINT",complaintId)===1);
        check("Exactly one Admin request notice",await notifyCount("ADMIN","SERVICE_REQUEST",requestId)===1);
        const [audits]=await db.execute("SELECT action FROM audit_logs WHERE entity_type='COMPLAINT' AND entity_id=?",[complaintId]);
        check("Submit, conversion and publication audited",["COMPLAINT_SUBMITTED","COMPLAINT_CONVERTED","COMPLAINT_UPDATE_PUBLISHED"].every(type=>audits.filter(r=>r.action===type).length===1));
        if(process.argv.includes("--browser"))await browserChecks({admin,owner,complaintId,requestData,publication,day,stamp});
    }finally{await db.end();}
}

async function browserChecks({admin,owner,complaintId,requestData,publication,day,stamp}){
    const browser=await require("playwright").chromium.launch();
    try{
        for(const [width,height] of [[375,812],[768,1024],[1440,900]]){
            async function open(cookie,url){
                const context=await browser.newContext({viewport:{width,height}});
                await context.route(u=>u.origin!==base,r=>r.abort());
                const at=cookie.indexOf("=");
                await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:base}]);
                const page=await context.newPage();page.setDefaultTimeout(8000);
                await page.goto(base+url,{waitUntil:"domcontentloaded"});return page;
            }
            const customerPage=await open(owner.cookie,"/public/kundenbereich.html");
            await customerPage.locator('[data-portal-view="service-requests"]').click();
            const card=customerPage.locator("#customer-intake-list article").filter({hasText:requestData.description});
            await card.getByRole("button",{name:"Angebot öffnen"}).waitFor();
            check(width+" service request and published quote link visible",await card.isVisible());
            if(width===375){
                const form=customerPage.locator("#customer-intake-form");
                await form.locator("[name=preferred_date]").fill(day);
                await form.locator("[name=description]").fill("Synthetic mobile request "+stamp);
                await form.getByRole("button",{name:"Absenden"}).click();
                await customerPage.locator("#customer-intake-list").getByText("Synthetic mobile request "+stamp,{exact:true}).waitFor();
                check("Customer submitted a request on mobile",true);
                await card.getByRole("button",{name:"Angebot öffnen"}).click();
                const quote=customerPage.locator("#portal-data").getByText("Synthetic window work",{exact:true});
                await quote.waitFor();
                check("Customer opens published quote from service request",await quote.isVisible());
            }
            await customerPage.locator('[data-portal-view="complaints"]').click();
            await customerPage.locator("#customer-intake-list article").filter({hasText:"Synthetic complaint "+stamp}).getByRole("button",{name:"Details ansehen"}).click();
            await customerPage.getByText(publication.response,{exact:false}).waitFor();
            check(width+" public complaint history visible without horizontal overflow",await customerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            await customerPage.context().close();
            const adminPage=await open(admin,"/admin.html");
            await adminPage.locator('[data-type="quality"]').click();
            await adminPage.locator('[data-complaint-id="'+complaintId+'"]').click();
            const detail=adminPage.locator("#complaint-dialog");
            await detail.getByText(publication.response,{exact:false}).waitFor();
            check(width+" Admin can review complaint and linked quality action",await detail.getByRole("button",{name:"Qualitätsvorfall öffnen"}).isVisible());
            check(width+" Admin complaint view fits viewport",await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
            if(width===1440){
                await detail.getByRole("button",{name:"Qualitätsvorfall öffnen"}).click();
                const quality=adminPage.locator("#quality-detail-dialog");
                await quality.waitFor();
                check("Admin opens existing corrective-action workspace from complaint",await quality.getByText("Synthetic corrective action",{exact:false}).isVisible());
            }
            await adminPage.context().close();
        }
    }finally{await browser.close();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>console.log(JSON.stringify({
    passed:results.filter(row=>row.ok).length,failed:results.filter(row=>!row.ok).length,failures:results.filter(row=>!row.ok).map(row=>row.label)
})));

