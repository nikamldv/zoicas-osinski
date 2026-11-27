"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {randomUUID, randomBytes, scryptSync} = require("node:crypto");
const mysql = require("mysql2/promise");

const root = path.resolve(__dirname, "..");
const config = require("node:util").parseEnv(fs.readFileSync(path.join(root, ".env.test"), "utf8"));
const base = "http://127.0.0.1:3001";
const database = "zoicas_osinski_test";
if (process.env.ENV_FILE !== ".env.test" || config.MYSQL_DATABASE !== database || config.PORT !== "3001" ||
    config.MYSQL_HOST !== "127.0.0.1" || config.SMTP_HOST || config.PRIVATE_DOCUMENT_UPLOAD_DIR !== "storage/test-private-documents") {
    throw Error("Refusing outside the isolated environment.");
}
const results = [];
function verify(label, pass, actual) {
    results.push({label, pass: Boolean(pass)});
    if (!pass) throw Error(label + (actual === undefined ? "" : " (status " + actual + ")"));
}

async function request(route, {method = "GET", body, cookie, origin = base} = {}) {
    const headers = {Origin: origin};
    if (cookie) headers.Cookie = cookie;
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(base + route, {
        method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : await response.arrayBuffer();
    return {status:response.status, data, type, cookie:response.headers.get("set-cookie")?.split(";")[0]};
}

async function main() {
    const db = await mysql.createConnection({host:config.MYSQL_HOST,port:Number(config.MYSQL_PORT),database,user:config.MYSQL_ADMIN_USER,password:config.MYSQL_ADMIN_PASSWORD});
    try {
        const [[identity]] = await db.query("SELECT DATABASE() AS name, DATE_FORMAT(CURDATE(),'%Y-%m-%d') AS day");
        const health = await request("/api/health");
        if (identity.name !== database || health.data.database !== "connected") throw Error("Wrong test environment.");
        const day = identity.day;
        const stamp = randomUUID().slice(0,12);
        const password = "TestAa!" + randomUUID();
        async function registerCustomer(suffix) {
            const email = "phase1624." + suffix + "." + stamp + "@example.test";
            const created = await request("/api/customer/register", {method:"POST",body:{first_name:"TEST",last_name:"Commercial " + suffix,email,phone:"+49123456789",password,password_confirmation:password}});
            verify(suffix + " synthetic customer registration", created.status === 201, created.status);
            const login = await request("/api/customer/login",{method:"POST",body:{email,password}});
            verify(suffix + " customer login", login.status === 200 && login.cookie, login.status);
            return {id:login.data.customer.id,cookie:login.cookie,email};
        }
        async function createEmployee(role) {
            const email = "phase1624." + role.toLowerCase() + "." + stamp + "@example.test";
            const salt = randomBytes(16);
            const hash = ["scrypt",salt.toString("hex"),scryptSync(password,salt,64).toString("hex")].join("$");
            const [row] = await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES (?,?,?,?,?,?,?,'ACTIVE')",
                ["TEST-1624-"+role+"-"+stamp,"TEST",role,email,"+49123456789",hash,role]);
            const login = await request("/api/employee/login",{method:"POST",body:{email,password}});
            verify(role + " employee portal login", login.status === 200 && login.cookie, login.status);
            return {id:row.insertId,cookie:login.cookie};
        }
        const customer = await registerCustomer("owner"), foreign = await registerCustomer("other");
        const employee = await createEmployee("EMPLOYEE"), manager = await createEmployee("MANAGER");
        const adminLogin = await request("/api/admin/login",{method:"POST",body:{username:config.ADMIN_USERNAME,password:config.PHASE168_TEST_ADMIN_PASSWORD}});
        verify("Admin login", adminLogin.status === 200 && adminLogin.cookie, adminLogin.status);
        const admin = adminLogin.cookie;
        const get = (route,cookie=admin) => request(route,{cookie});
        const send = (route,body,cookie=admin,method="POST") => request(route,{method,cookie,body});
        const listIncludes = async (resource,id,cookie=customer.cookie) => (await get("/api/customer/"+resource,cookie)).data.rows.some(row=>Number(row.id)===Number(id));
        const noticeCount = async (kind,id) => {
            const [[row]] = await db.execute("SELECT COUNT(*) AS total FROM notifications WHERE recipient_type='CUSTOMER' AND recipient_id=? AND entity_type=? AND entity_id=?",[customer.id,kind,id]);
            return Number(row.total);
        };
        const form = new FormData();
        for (const [key,value] of Object.entries({first_name:"TEST",last_name:"Commercial",email:customer.email,phone:"+49123456789",object_type:"Privathaushalt",address:"Testweg 8",postal_code:"97421",city:"Teststadt",service:"Reinigung",message:"Synthetic request "+stamp})) form.set(key,value);
        const serviceRequest = await send("/api/quotes",form,customer.cookie);
        verify("Customer submitted service request",serviceRequest.status===201,serviceRequest.status);
        const requestId=serviceRequest.data.id;
        const [[linkedRequest]]=await db.execute("SELECT customer_id FROM quote_requests WHERE id=?",[requestId]);
        verify("Quote request linked to signed-in customer",Number(linkedRequest.customer_id)===customer.id);
        const quoteData={customer_id:customer.id,quote_request_id:requestId,service_description:"Synthetic cleaning "+stamp,service_type:"Reinigung",start_date:day,items:[{title:"Cleaning",quantity:1,unit:"Pauschale",unit_price:100,discount_amount:0,tax_rate:19}]};
        const quote=await send("/api/admin/quotes",{...quoteData,status:"ENTWURF"});
        verify("Admin created quote draft",quote.status===201,quote.status);
        const quoteId=quote.data.id;
        const contractData={customer_id:customer.id,quote_id:quoteId,start_date:day,service_description:"Synthetic cleaning",service_type:"Reinigung",interval_type:"EINMALIG",net_amount:100,tax_rate:19};
        const contract=await send("/api/admin/contracts",{...contractData,status:"ENTWURF"});
        verify("Admin created contract draft",contract.status===201,contract.status);
        const contractId=contract.data.id;
        for(const [resource,id,type] of [["quotes",quoteId,"QUOTE"],["contracts",contractId,"CONTRACT"]]){
            verify(type+" draft visible to Admin",(await get("/api/admin/"+resource+"/"+id)).status===200);
            verify(type+" draft absent from customer list",!await listIncludes(resource,id));
            verify(type+" draft detail denied",(await get("/api/customer/"+resource+"/"+id,customer.cookie)).status===404);
            verify(type+" draft created no customer notification",await noticeCount(type,id)===0);
        }
        verify("Draft quote cannot be accepted",(await send("/api/customer/quotes/"+quoteId+"/accept",{},customer.cookie)).status===404);
        const publishedQuote=await send("/api/admin/quotes/"+quoteId,{...quoteData,status:"GESENDET"},admin,"PATCH");
        verify("Admin sent quote",publishedQuote.status===200,publishedQuote.status);
        verify("Sent quote visible in owner list and detail",await listIncludes("quotes",quoteId)&&(await get("/api/customer/quotes/"+quoteId,customer.cookie)).status===200);
        verify("Other customer cannot open sent quote",(await get("/api/customer/quotes/"+quoteId,foreign.cookie)).status===404);
        verify("Quote publication creates one notice",await noticeCount("QUOTE",quoteId)===1);
        const publishedContract=await send("/api/admin/contracts/"+contractId,{...contractData,status:"AKTIV"},admin,"PATCH");
        verify("Active contract visible only to owner",publishedContract.status===200&&await listIncludes("contracts",contractId)&&(await get("/api/customer/contracts/"+contractId,customer.cookie)).status===200&&(await get("/api/customer/contracts/"+contractId,foreign.cookie)).status===404,publishedContract.status);
        verify("Contract publication creates one notice",await noticeCount("CONTRACT",contractId)===1);
        const accept=await send("/api/customer/quotes/"+quoteId+"/accept",{},customer.cookie);
        verify("Customer accepted sent quote",accept.status===200,accept.status);
        const converted=await send("/api/admin/quotes/"+quoteId+"/create-order",{});
        verify("Admin converted accepted quote to order",converted.status===201,converted.status);
        const orderId=converted.data.id, billing="/api/admin/orders/"+orderId+"/create-invoice";
        const order=await get("/api/admin/orders/"+orderId);
        verify("Order preserves customer, quote and pricing",Number(order.data.order.customer_id)===customer.id&&Number(order.data.order.sales_quote_id)===quoteId&&Number(order.data.order.price_gross_snapshot)===119);
        const hours=Array.from({length:7},(_,i)=>({weekday:i+1,start_time:"08:00",end_time:"18:00"}));
        verify("Working hours saved",(await send("/api/admin/employees/"+employee.id+"/work-hours",{hours},admin,"PATCH")).status===200);
        const assignment=await send("/api/admin/orders/"+orderId+"/assignments",{employee_id:employee.id,assignment_date:day,start_time:"09:00",end_time:"10:00",status:"GEPLANT"});
        verify("Admin assigned converted order",assignment.status===201,assignment.status);
        const assignmentId=assignment.data.id;
        verify("Assigned employee checked in",(await send("/api/employee/attendance/check-in",{assignment_id:assignmentId},employee.cookie)).status===201);
        verify("Assigned employee checked out",(await send("/api/employee/attendance/check-out",{},employee.cookie)).status===200);
        verify("Check-out alone cannot create invoice",(await send(billing,{})).status===409);
        const report=await send("/api/employee/service-reports",{order_id:orderId,assignment_id:assignmentId,service_date:day,started_at:day+"T09:00",finished_at:day+"T10:00",summary:"Synthetic work completed"},employee.cookie);
        verify("Employee created service report",report.status===201,report.status);
        const reportId=report.data.id;
        verify("Employee submitted service report",(await send("/api/employee/service-reports/"+reportId+"/submit",{},employee.cookie)).status===200);
        verify("Submitted report without review cannot create invoice",(await send(billing,{})).status===409);
        verify("Admin reviewed report",(await send("/api/admin/service-reports/"+reportId+"/review",{status:"REVIEWED"},admin,"PATCH")).status===200);
        for (const [name,cookie] of [["Employee",employee.cookie],["MANAGER",manager.cookie],["Customer",customer.cookie]]) {
            verify(name+" cannot create invoice",(await send(billing,{},cookie)).status===401);
            verify(name+" cannot manage commercial drafts",(await get("/api/admin/quotes/"+quoteId,cookie)).status===401);
        }
        verify("Billing handoff rejects foreign origin",(await request(billing,{method:"POST",body:{},cookie:admin,origin:"https://example.test"})).status===403);
        const simultaneous=await Promise.all([send(billing,{}),send(billing,{})]);
        verify("Concurrent billing produces exactly one draft",simultaneous.map(r=>r.status).sort().join(",")==="201,409");
        const invoiceId=simultaneous.find(r=>r.status===201).data.id;
        const invoice=(await get("/api/admin/invoices/"+invoiceId)).data.invoice;
        verify("Invoice draft preserves order price snapshot",invoice.status==="ENTWURF"&&Number(invoice.net_amount)===100&&Number(invoice.tax_amount)===19&&Number(invoice.gross_amount)===119);
        verify("Invoice draft absent from owner list",!await listIncludes("invoices",invoiceId));
        verify("Invoice draft detail denied",(await get("/api/customer/invoices/"+invoiceId,customer.cookie)).status===404);
        verify("Invoice draft PDF denied",(await get("/api/customer/invoices/"+invoiceId+"/pdf",customer.cookie)).status===404);
        verify("Invoice draft created no customer notification",await noticeCount("INVOICE",invoiceId)===0);
        verify("Invoice draft absent from employee invoice list",!(await get("/api/employee/orders/"+orderId+"/invoices",employee.cookie)).data.rows.some(row=>row.id===invoiceId));
        const attachment=new FormData();
        attachment.set("customer_id",String(customer.id));attachment.set("invoice_id",String(invoiceId));attachment.set("document_type","RECHNUNG");attachment.set("visibility","CUSTOMER");
        attachment.set("file",new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/evoAAAAASUVORK5CYII=","base64")],{type:"image/png"}),"TEST-1624-"+stamp+".png");
        const document=await send("/api/admin/documents",attachment);
        verify("Linked document uploaded by Admin",document.status===201,document.status);
        const documentId=document.data.id;
        verify("Draft-linked document absent from list and download",!await listIncludes("documents",documentId)&&(await get("/api/customer/documents/"+documentId,customer.cookie)).status===404);
        const invoiceData={customer_id:customer.id,order_id:orderId,sales_quote_id:quoteId,invoice_date:day,due_date:"2090-12-31",status:"GESENDET"};
        const published=process.argv.includes("--browser")
            ? await browserChecks({admin,customer,order:converted.data.orderNumber,invoice:invoice.invoice_number,invoiceId})
            : await send("/api/admin/invoices/"+invoiceId,invoiceData,admin,"PATCH");
        verify("Admin published invoice",published.status===200,published.status);
        const [[reportRow]]=await db.execute("SELECT customer_confirmed_at FROM service_reports WHERE id=?",[reportId]);
        verify("Invoice published without customer confirmation",reportRow.customer_confirmed_at===null);
        const [[publishedLink]]=await db.execute("SELECT sales_quote_id,order_id,gross_amount FROM invoices WHERE id=?",[invoiceId]);
        verify("Publication preserves commercial links and pricing",Number(publishedLink.sales_quote_id)===quoteId&&Number(publishedLink.order_id)===orderId&&Number(publishedLink.gross_amount)===119);
        verify("Published invoice visible in owner list and detail",await listIncludes("invoices",invoiceId)&&(await get("/api/customer/invoices/"+invoiceId,customer.cookie)).status===200);
        const pdf=await get("/api/customer/invoices/"+invoiceId+"/pdf",customer.cookie);
        verify("Published PDF available to owner",pdf.status===200&&pdf.type.includes("application/pdf"));
        verify("Other customer cannot access invoice detail or PDF",(await get("/api/customer/invoices/"+invoiceId,foreign.cookie)).status===404&&(await get("/api/customer/invoices/"+invoiceId+"/pdf",foreign.cookie)).status===404);
        verify("Employee and manager cannot download customer PDF",(await get("/api/customer/invoices/"+invoiceId+"/pdf",employee.cookie)).status===401&&(await get("/api/customer/invoices/"+invoiceId+"/pdf",manager.cookie)).status===401);
        verify("Published linked document belongs to owner only",await listIncludes("documents",documentId)&&(await get("/api/customer/documents/"+documentId,customer.cookie)).status===200&&(await get("/api/customer/documents/"+documentId,foreign.cookie)).status===404);
        verify("Invoice publication created one notification",await noticeCount("INVOICE",invoiceId)===1);

    } finally {await db.end();}
}

async function browserChecks({admin,customer,order,invoice,invoiceId}) {
    const browser=await require("playwright").chromium.launch();
    try {
        async function signedIn(cookie,url) {
            const context=await browser.newContext({viewport:{width:1440,height:900}});
            await context.route(u=>u.origin!==base,r=>r.abort());
            const at=cookie.indexOf("=");
            await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:base}]);
            const page=await context.newPage();
            page.setDefaultTimeout(8000);
            await page.goto(base+url,{waitUntil:"domcontentloaded"});
            return page;
        }
        const adminPage=await signedIn(admin,"/admin.html");
        await adminPage.locator('[data-type="order"]').click();
        const row=adminPage.locator("#records-body tr").filter({hasText:order});
        await row.getByRole("button").first().click();
        const billing=adminPage.locator("#order-billing");
        await billing.getByText(invoice,{exact:false}).waitFor();
        verify("Admin browser displays linked billing status",await billing.getByRole("button",{name:"Rechnung öffnen"}).isVisible());
        await billing.getByRole("button",{name:"Rechnung öffnen"}).click();
        await adminPage.locator("#invoice-dialog[open]").waitFor();
        verify("Admin can open the linked invoice",await adminPage.locator("#invoice-dialog-title").innerText()==="Rechnung "+invoice);
        adminPage.once("dialog", dialog=>dialog.accept());
        const saved=adminPage.waitForResponse(response=>response.request().method()==="PATCH"&&response.url()===base+"/api/admin/invoices/"+invoiceId);
        await adminPage.getByRole("button",{name:"Rechnung veröffentlichen"}).click();
        const response=await saved;
        verify("Explicit Admin browser publication succeeds",response.status()===200,response.status());
        const customerPage=await signedIn(customer.cookie,"/public/kundenbereich.html");
        await customerPage.locator('[data-portal-view="invoices"]').click();
        const card=customerPage.locator("article").filter({hasText:invoice});
        await card.waitFor();
        verify("Customer browser displays published invoice",await card.isVisible());
        return {status:response.status()};
    } finally {await browser.close();}
}

main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>{
    console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,failures:results.filter(r=>!r.pass).map(r=>r.label)}));
});

