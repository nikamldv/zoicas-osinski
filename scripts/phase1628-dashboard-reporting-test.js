"use strict";

const fs = require("node:fs");
const {parseEnv} = require("node:util");
const {randomUUID, randomBytes, scryptSync} = require("node:crypto");
const {inflateSync} = require("node:zlib");
const {berlinWallTime} = require("../attendance-punctuality");
const mysql = require("mysql2/promise");
const env = parseEnv(fs.readFileSync(".env.test","utf8"));
const database = "zoicas_osinski_test";
const base = "http://127.0.0.1:3001";
if (process.env.ENV_FILE !== ".env.test" || env.PORT !== "3001" || env.MYSQL_HOST !== "127.0.0.1" || env.MYSQL_DATABASE !== database || env.SMTP_HOST) throw Error("Isolation guard failed");
const results = [];
function check(label, pass) { results.push({label,status:pass?"PASS":"FAIL"}); }
function requireStatus(response, expected, label) {
    check(label,response.status===expected);
    if (response.status!==expected) throw Error(label+" returned "+response.status);
}
async function fetchTest(route, cookie, method="GET", body, origin=base) {
    const headers={Origin:origin};
    if(cookie) headers.Cookie=cookie;
    if(body) headers["Content-Type"]="application/json";
    return fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
}
const cookieOf = response => response.headers.get("set-cookie").split(";")[0];
function pdfText(buffer) {
    const source=buffer.toString("latin1"), lines=[];
    for (const match of source.matchAll(/\bstream\r?\n/g)) {
        const end=source.indexOf("\nendstream",match.index+match[0].length);
        if(end<0) continue;
        let stream;
        try {stream=inflateSync(buffer.subarray(match.index+match[0].length,end)).toString("latin1");} catch {continue;}
        for(const line of stream.matchAll(/\[([^\n]*?)\]\s*TJ/g)) {
            lines.push(Array.from(line[1].matchAll(/<([a-f\d]+)>/gi),piece=>Buffer.from(piece[1],"hex").toString("latin1")).join(""));
        }
    }
    return lines;
}
async function main() {
    const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
    try {
        const [[identity]]=await db.query("SELECT DATABASE() db,@@port port");
        const health=await (await fetchTest("/api/health")).json();
        if(identity.db!==database || Number(identity.port)!==Number(env.MYSQL_PORT) || health.database!=="connected") throw Error("Wrong test system");
        check("Test database, SQL port and HTTP health verified",true);
        await db.query("SET time_zone='+00:00'");
        const token=randomUUID().slice(0,8), password="TestAa!"+randomUUID();
        const day=berlinWallTime(new Date()).slice(0,10), tomorrow=berlinWallTime(new Date(Date.now()+86400000)).slice(0,10);
        const first=await fetchTest("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD});
        requireStatus(first,200,"Admin signs in");
        const admin=cookieOf(first);
        async function customer(name) {
            const email="phase1628."+name+"."+token+"@example.test";
            const reg=await fetchTest("/api/customer/register",null,"POST",{first_name:"TEST",last_name:name,email,password,password_confirmation:password,phone:"+49123456789"});
            requireStatus(reg,201,name+" registration");
            const {id}=await reg.json();
            const login=await fetchTest("/api/customer/login",null,"POST",{email,password});
            requireStatus(login,200,name+" signs in");
            return {id,cookie:cookieOf(login)};
        }
        async function employee(role) {
            const salt=randomBytes(16);
            const hash=["scrypt",salt.toString("hex"),scryptSync(password,salt,64).toString("hex")].join("$");
            const email="phase1628."+role+"."+token+"@example.test";
            const [row]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')",["TEST-"+role+"-"+token,"TEST",role,email,"+49123456789",hash,role]);
            const login=await fetchTest("/api/employee/login",null,"POST",{email,password});
            requireStatus(login,200,role+" signs in");
            return {id:row.insertId,cookie:cookieOf(login),number:"TEST-"+role+"-"+token};
        }
        const owner=await customer("Owner"), other=await customer("Other"), staff=await employee("EMPLOYEE"), manager=await employee("MANAGER");
        const home=async (role,cookie)=>{
            const response=await fetchTest("/api/"+role+"/home",cookie), data=await response.json();
            requireStatus(response,200,role+" dashboard response");
            return data;
        };
        const baseline=await home("admin",admin);
        async function order(label,customerId,status,planned,created) {
            const number="TEST-1628-"+token+"-"+label;
            const [row]=await db.execute("INSERT INTO orders(order_number,customer_id,service_type,title,status,planned_start,created_at) VALUES(?,?,'Fensterreinigung',?,?,?,COALESCE(?,NOW()))",[number,customerId,label,status,planned,created]);
            return {id:row.insertId,number};
        }
        const scheduled=await order("today",owner.id,"ZUGEWIESEN",day+" 10:00:00",null);
        await order("complete",owner.id,"ERLEDIGT",day+" 11:00:00",null);
        await order("unassigned",owner.id,"NEU",day+" 13:00:00",null);
        const foreign=await order("foreign",other.id,"ZUGEWIESEN",tomorrow+" 08:00:00",null);
        const [assignment]=await db.execute("INSERT INTO order_assignments(order_id,employee_id,assignment_date,start_time,end_time) VALUES(?,?,?,'10:00','11:00')",[scheduled.id,staff.id,day]);
        await db.execute("INSERT INTO order_assignments(order_id,employee_id,assignment_date,start_time,end_time) VALUES(?,?,?,'10:30','11:30'),(?,?,?,'08:00','09:00')",[scheduled.id,staff.id,day,foreign.id,manager.id,tomorrow]);
        await db.execute("INSERT INTO employee_attendance_sessions(employee_id,order_id,assignment_id,check_in_at,status) VALUES(?,?,?,NOW(),'OPEN')",[staff.id,scheduled.id,assignment.insertId]);
        await db.execute("INSERT INTO employee_absences(employee_id,absence_type,start_date,end_date,created_by) VALUES(?,'URLAUB',?,?,'synthetic')",[staff.id,day,day]);
        await db.execute("INSERT INTO employee_absence_requests(employee_id,absence_type,start_date,end_date) VALUES(?,'URLAUB',?,?)",[staff.id,tomorrow,tomorrow]);
        await db.execute("INSERT INTO materials(material_number,name,unit,minimum_stock) VALUES(?,?,'STUECK',2)",["TEST-1628-"+token,"Synthetic Low Stock"]);
        await db.execute("INSERT INTO service_reports(report_number,order_id,assignment_id,customer_id,employee_id,service_date,summary,status) VALUES(?,?,?,?,?,?,'Synthetic draft report','DRAFT')",["TEST-1628-"+token,scheduled.id,assignment.insertId,owner.id,staff.id,day]);
        const request=await fetchTest("/api/customer/service-requests",owner.cookie,"POST",{service:"Fensterreinigung",description:"Synthetic dashboard test request",preferred_date:tomorrow,submission_key:randomUUID()});
        requireStatus(request,201,"Customer creates service request");
        const complaint=await fetchTest("/api/customer/complaints",owner.cookie,"POST",{description:"Synthetic dashboard test complaint",order_id:scheduled.id,submission_key:randomUUID()});
        requireStatus(complaint,201,"Customer creates complaint");

        const dateRange = "period=custom&from=2024-03-31&to=2024-03-31";
        const offer={customer_id:owner.id,service_description:"Synthetic dashboard offer",service_type:"Fensterreinigung",start_date:tomorrow,items:[{title:"Synthetic service",quantity:1,unit:"Pauschale",unit_price:80,tax_rate:19}]};
        const quote=await fetchTest("/api/admin/quotes",admin,"POST",{...offer,status:"ENTWURF"});
        requireStatus(quote,201,"Admin creates hidden quote");
        const draftOffer=await fetchTest("/api/admin/quotes",admin,"POST",{...offer,status:"ENTWURF"});
        requireStatus(draftOffer,201,"Admin creates quote to publish");
        const quoteId=(await draftOffer.json()).id;
        requireStatus(await fetchTest("/api/admin/quotes/"+quoteId,admin,"PATCH",{...offer,status:"GESENDET"}),200,"Admin publishes one quote");
        const historicalBefore=(await (await fetchTest("/api/admin/reports/dashboard?"+dateRange,admin)).json()).data;
        const historical="2024-03-31";
        const before=await order("before",owner.id,"NEU",null,"2024-03-30 22:59:59");
        const start=await order("start",owner.id,"ERLEDIGT",null,"2024-03-30 23:00:00");
        const end=await order("end",owner.id,"GEPLANT",null,"2024-03-31 21:59:59");
        const after=await order("after",owner.id,"NEU",null,"2024-03-31 22:00:00");
        await db.execute("INSERT INTO employee_work_logs(employee_id,order_id,work_date,start_time,end_time,break_minutes) VALUES(?,?,?,'08:00','11:30',30),(?,?,?,'12:00','13:30',0)",[staff.id,start.id,historical,staff.id,end.id,historical]);
        async function invoice(customerId,label,status,invoiceDate,due,gross,payments=[]) {
            const numer="TEST-1628-"+token+"-"+label;
            const [row]=await db.execute("INSERT INTO invoices(invoice_number,customer_id,customer_number_snapshot,customer_name_snapshot,invoice_date,due_date,status,net_amount,gross_amount) VALUES(?,?,'TEST','Synthetic',?,?,?,?,?)",[numer,customerId,invoiceDate,due,status,gross,gross]);
            for(const [date,amount] of payments) await db.execute("INSERT INTO invoice_payments(invoice_id,payment_date,amount,payment_method) VALUES(?,?,?,'BAR')",[row.insertId,date,amount]);
            return {number:numer,id:row.insertId};
        }
        const issued=await invoice(owner.id,"issued","GESENDET",historical,"2024-04-01",120,[[historical,30],[day,20]]);
        await invoice(owner.id,"due-today","GESENDET",day,day,90);
        const draft=await invoice(owner.id,"draft","ENTWURF",historical,"2024-04-01",999,[[historical,99],[day,88]]);
        await invoice(owner.id,"cancelled","STORNIERT",historical,"2024-04-01",777,[[historical,77]]);
        await invoice(other.id,"foreign","GESENDET",day,tomorrow,200);
        await db.execute("INSERT INTO notifications(recipient_type,recipient_id,notification_type,title,body,entity_type,entity_id) VALUES('CUSTOMER',?,'INVOICE','Published synthetic','TEST','INVOICE',?),('CUSTOMER',?,'INVOICE','Draft synthetic','TEST','INVOICE',?),('EMPLOYEE',?,'TEST','Employee synthetic','TEST',NULL,NULL)",[owner.id,issued.id,owner.id,draft.id,staff.id]);

        const a=await home("admin",admin), e=await home("employee",staff.cookie), c=await home("customer",owner.cookie), otherHome=await home("customer",other.cookie), m=await home("employee",manager.cookie);
        check("Today's orders counted once despite multiple assignments",a.operations.scheduled-baseline.operations.scheduled===3 && a.operations.completed-baseline.operations.completed===1 && a.operations.pending-baseline.operations.pending===2);
        check("Overlap and absence exceptions reconcile",a.operations.overlaps-baseline.operations.overlaps===2 && a.operations.absence_conflicts-baseline.operations.absence_conflicts===2);
        check("Check-in and work queues reconcile",a.operations.checked_in-baseline.operations.checked_in===1 && a.operations.vacation_requests-baseline.operations.vacation_requests===1 && a.operations.service_requests-baseline.operations.service_requests===1 && a.operations.complaints-baseline.operations.complaints===1);
        check("Unassigned work, draft queues and low-stock alert reconcile",a.operations.unassigned-baseline.operations.unassigned===4 && a.operations.invoice_drafts-baseline.operations.invoice_drafts===1 && a.operations.quotes-baseline.operations.quotes===1 && a.operations.low_stock-baseline.operations.low_stock===1);
        check("Financial balances exclude cancelled invoices and drafts",a.finance.issued_amount-baseline.finance.issued_amount===410 && a.finance.paid_amount-baseline.finance.paid_amount===50 && a.finance.outstanding_amount-baseline.finance.outstanding_amount===360);
        check("Due today is excluded from overdue balances",a.finance.overdue_amount-baseline.finance.overdue_amount===70 && a.finance.overdue_count-baseline.finance.overdue_count===1);
        check("Monthly receipts use the payment date and issued invoices",a.finance.monthly_payments-baseline.finance.monthly_payments===20);
        check("Employee sees own assignments, attendance and vacation",e.today.length===2 && e.today.every(item=>item.order_number===scheduled.number) && e.attendance?.order_number===scheduled.number && e.vacation?.status==="PENDING" && e.notifications===1 && e.reports===1);
        check("Manager accesses own Employee dashboard only",m.next?.order_number===foreign.number && m.today.length===0 && m.attendance===null && (await fetchTest("/api/admin/home",manager.cookie)).status===401);
        check("Customer sees own requests, complaints and issued unpaid invoices",c.requests===1 && c.quotes===1 && otherHome.quotes===0 && c.complaints===1 && c.invoices===2 && otherHome.requests===0 && otherHome.complaints===0 && otherHome.invoices===1 && otherHome.next?.order_number===foreign.number);
        check("Customer dashboard excludes draft notification",c.notifications.some(n=>n.title==="Published synthetic") && !c.notifications.some(n=>n.title==="Draft synthetic") && otherHome.notifications.length===0);
        check("Role guards protect all home APIs", (await fetchTest("/api/admin/home",owner.cookie)).status===401 && (await fetchTest("/api/employee/home",owner.cookie)).status===401 && (await fetchTest("/api/customer/home",staff.cookie)).status===401 && (await fetchTest("/api/admin/home")).status===401);
        check("Dashboard is read-only and existing customer mutations enforce same-origin",(await fetchTest("/api/admin/home",admin,"POST",{})).status===405 && (await fetchTest("/api/customer/service-requests",owner.cookie,"POST",{},"https://foreign.example.test")).status===403);
        const range="period=custom&from="+historical+"&to="+historical;
        const summaryResponse=await fetchTest("/api/admin/reports/dashboard?"+range,admin);
        requireStatus(summaryResponse,200,"Reporting summary loads");
        const summary=(await summaryResponse.json()).data;
        check("23-hour Berlin day reconciles order counts and completion",summary.orders.total===historicalBefore.orders.total+2 && summary.orders.completed_orders===historicalBefore.orders.completed_orders+1 && summary.orders.completion_rate===100*summary.orders.completed_orders/summary.orders.total);
        check("Work logs reconcile hours and breaks",summary.employees.work_hours===historicalBefore.employees.work_hours+4.5);
        check("Report distinguishes payments in period from payments against invoice cohort",summary.finance.invoiced.gross===historicalBefore.finance.invoiced.gross+120 && summary.finance.invoice_payments===historicalBefore.finance.invoice_payments+30 && summary.finance.paid_amount===historicalBefore.finance.paid_amount+50 && summary.finance.outstanding_amount===historicalBefore.finance.outstanding_amount+70);
        const performance=await (await fetchTest("/api/admin/reports/performance/operations?"+range,admin)).json();
        check("Operational report reconciles order count and hours",performance.data?.order_count===summary.orders.total && performance.data?.actual_hours===summary.employees.work_hours);
        const trend=await (await fetchTest("/api/admin/reports/trends?metric=orders&"+range,admin)).json();
        check("Order trend uses Berlin day",trend.data?.series.length===1 && trend.data.series[0].date===historical && Number(trend.data.series[0].new_orders)===summary.orders.total);
        const invoiceTrend=await (await fetchTest("/api/admin/reports/trends?metric=invoices&"+range,admin)).json();
        check("Invoice trend uses recorded balance and due date",Number(invoiceTrend.data?.series[0]?.issued)===summary.finance.invoice_count && Number(invoiceTrend.data?.series[0]?.overdue)===summary.finance.overdue_count);
        const fallDay="2024-10-27", fallRange="period=custom&from="+fallDay+"&to="+fallDay;
        const firstFold=await order("first-fold",owner.id,"NEU",null,"2024-10-27 00:30:00");
        const secondFold=await order("second-fold",owner.id,"NEU",null,"2024-10-27 01:30:00");
        const pastFold=await order("after-fall",owner.id,"NEU",null,"2024-10-27 23:00:00");
        const fallCsv=await (await fetchTest("/api/admin/reports/export?format=csv&type=orders&"+fallRange,admin)).text();
        check("25-hour Berlin day keeps both repeated-hour records",fallCsv.includes(firstFold.number)&&fallCsv.includes(secondFold.number)&&!fallCsv.includes(pastFold.number));
        const exportReport=(type,format)=>fetchTest("/api/admin/reports/export?"+range+"&type="+type+"&format="+format,admin);
        const orderCsv=await (await exportReport("orders","csv")).text();
        check("Order CSV matches both date boundaries",orderCsv.includes(start.number)&&orderCsv.includes(end.number)&&!orderCsv.includes(before.number)&&!orderCsv.includes(after.number));
        const employeeCsv=await (await exportReport("employees","csv")).text();
        check("Employee CSV hours match records",employeeCsv.split(/\r?\n/).filter(row=>row.includes(staff.number)).some(row=>row.split(";").some(cell=>Number(cell.replaceAll('"',""))===4.5)));
        const invoiceCsv=await (await exportReport("invoices","csv")).text();
        check("Invoice CSV matches issued, paid and open amounts",invoiceCsv.includes(issued.number)&&!invoiceCsv.includes(draft.number)&&/120\.00;50\.00;70(?:\r|\n)/.test(invoiceCsv));
        const pdf=await fetchTest("/api/admin/reports/pdf?"+range,admin);
        const pdfBuffer=Buffer.from(await pdf.arrayBuffer());
        const lines=pdfText(pdfBuffer);
        const euro=amount=>amount.toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2})+" EUR";
        const metric=(name,value)=>lines[lines.indexOf(name)+1]===value && lines.includes(name);
        check("PDF numbers match invoice, payment, receivable and working-hour totals",pdf.status===200&&metric("Fakturiert brutto",euro(summary.finance.invoiced.gross))&&metric("Erhaltene Rechnungszahlungen",euro(summary.finance.invoice_payments))&&metric("Offene Forderungen",euro(summary.finance.outstanding_amount))&&metric("Erfasste Arbeitsstunden",summary.employees.work_hours.toFixed(2)+" h"));
        const planned=await order("planned",other.id,"GEPLANT",tomorrow+" 07:00:00",null);
        check("Customer sees a confirmed planning slot before staff assignment",(await home("customer",other.cookie)).next?.order_number===planned.number);
        await browserTests({admin,staff,owner});
    } finally { await db.end(); }
}

async function browserTests({admin,staff,owner}) {
    let browser;
    try { browser=await require("playwright").chromium.launch(); }
    catch(error) { results.push({label:"Chromium",status:"SKIPPED",reason:error.code||"browser launch unavailable"}); return; }
    try {
        for (const [width,height] of [[375,812],[768,1024],[1440,900]]) {
            for(const [role,cookie,file,first] of [
                ["admin",admin,"admin.html","Heutige Aufträge"],
                ["employee",staff.cookie,"mitarbeiterportal.html","Heutige Einsätze"],
                ["customer",owner.cookie,"kundenbereich.html","Nächster Service"]
            ]) {
                const context=await browser.newContext({viewport:{width,height}});
                try {
                    await context.route(url=>url.origin!==base,route=>route.abort());
                    const at=cookie.indexOf("=");
                    await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:base}]);
                    const page=await context.newPage();
                    page.setDefaultTimeout(7000);
                    let release;
                    const gate=new Promise(resolve=>release=resolve);
                    if(width===375) await page.route("**/api/"+role+"/home",async route=>{await gate;await route.continue();},{times:1});
                    await page.goto(base+"/public/"+file,{waitUntil:"domcontentloaded"});
                    if(width===375) {
                        try {
                            await page.getByText("Übersicht wird geladen …",{exact:true}).waitFor();
                            check(role+" mobile exposes loading status",true);
                        } finally { release(); }
                    }
                    const grid=page.locator(".portal-home-grid");
                    await grid.getByRole("heading",{name:first,exact:true}).waitFor();
                    check(role+" "+width+" fits viewport",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
                    const axe=await new (require("@axe-core/playwright").default)({page}).include(".portal-home-grid").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
                    check(role+" "+width+" dashboard axe checks ("+axe.violations.map(item=>item.id).join(",")+")",axe.violations.length===0);
                    const action=grid.getByRole("button").first();
                    await action.focus();
                    await page.keyboard.press("Tab");
                    check(role+" "+width+" keyboard focus visible",await grid.getByRole("button").nth(1).evaluate(el=>el===document.activeElement && el.matches(":focus-visible") && getComputedStyle(el).outlineStyle!=="none"));
                    if(width===375 && role==="customer"){
                        await page.route("**/api/customer/home",route=>route.fulfill({status:503,body:"{}"}),{times:1});
                        await page.locator('[data-portal-view="home"]').click();
                        await page.getByText("Übersicht konnte nicht geladen werden.",{exact:true}).waitFor();
                        await page.route("**/api/customer/home",async route=>{const response=await route.fetch(); await route.fulfill({response,json:{...await response.json(),next:null}});},{times:1});
                        await page.getByRole("button",{name:"Erneut versuchen"}).click();
                        await grid.getByRole("heading",{name:first,exact:true}).waitFor();
                        check("Customer dashboard error and retry",true);
                        check("Customer dashboard shows an empty next-service state",await grid.getByRole("article").filter({hasText:"Nächster Service"}).getByText("Keine Einträge vorhanden.",{exact:true}).count()>0);
                    }
                    await action.focus();
                    await page.keyboard.press("Enter");
                    await grid.waitFor({state:"hidden"});
                    check(role+" "+width+" card navigates to management section",await grid.isHidden() || await grid.count()===0);
                } catch(error) { check(role+" "+width+" browser flow: "+error.message.split("\n").slice(0,4).join(" "),false); }
                finally { await context.close(); }
            }
        }
    } finally { await browser.close(); }
}
main().catch(error=>{
    const errorType=error.code||error.message;
    check("Suite completed ("+errorType+")",false);
}).finally(()=>{
    const totals={PASS:0,FAIL:0,SKIPPED:0};
    for(const item of results) totals[item.status]++;
    console.log(JSON.stringify({totals,results},null,2));
    if(totals.FAIL)process.exitCode=1;
});
