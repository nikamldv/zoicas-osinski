"use strict";

const fs = require("node:fs");
const tls = require("node:tls");
const {spawn} = require("node:child_process");
const {once} = require("node:events");
const {randomUUID} = require("node:crypto");
const {parseEnv} = require("node:util");
const mysql = require("mysql2/promise");
const {berlinWallTime} = require("../attendance-punctuality");
const env = parseEnv(fs.readFileSync(".env.test","utf8"));
const base = "http://127.0.0.1:3001";
if (process.env.ENV_FILE !== ".env.test" || env.PORT !== "3001" || env.MYSQL_HOST !== "127.0.0.1" ||
    env.MYSQL_DATABASE !== "zoicas_osinski_test" || env.NODE_ENV === "production" || env.SMTP_HOST) {
    throw new Error("Isolated mail test configuration required");
}

const results = [];
function assert(label,condition) {
    results.push({label,status:condition?"PASS":"FAIL"});
    if (!condition) throw new Error(label);
}

function captureMail(cert,key) {
    let rejectFailure = true;
    const messages = [];
    const server = tls.createServer({cert,key},socket=>{
        let buffer="", recipient, writing=false;
        socket.on("error",()=>{});
        socket.write("220 localhost synthetic capture\r\n");
        socket.on("data",data=>{
            buffer+=data.toString("utf8");
            for (let end; (end=buffer.indexOf("\r\n"))>=0;) {
                if (writing) {
                    const terminator=buffer.indexOf("\r\n.\r\n");
                    if (terminator<0) return;
                    messages.push({recipient,raw:buffer.slice(0,terminator)});
                    buffer=buffer.slice(terminator+5);
                    writing=false;
                    if (recipient.startsWith("unknown.")) { socket.destroy(); return; }
                    socket.write("250 accepted\r\n");
                    continue;
                }
                const line=buffer.slice(0,end);
                buffer=buffer.slice(end+2);
                if (line.startsWith("EHLO ")) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
                else if (line.startsWith("AUTH PLAIN ")) socket.write("235 authenticated\r\n");
                else if (line.startsWith("MAIL FROM:")) socket.write("250 sender accepted\r\n");
                else if (line.startsWith("RCPT TO:")) {
                    recipient=line.match(/^RCPT TO:<([^>]+@example\.test)>$/)?.[1];
                    socket.write(!recipient||(rejectFailure && recipient.startsWith("fail."))?"550 refused\r\n":"250 recipient accepted\r\n");
                } else if (line==="DATA" && recipient) { writing=true; socket.write("354 send message\r\n"); }
                else if (line==="QUIT") socket.end("221 goodbye\r\n");
                else socket.write("500 command unrecognized\r\n");
            }
        });
    });
    return {server,messages,setRejectFailure:value=>{rejectFailure=value;}};
}

async function request(url,cookie,method="GET",body,origin=base) {
    const headers={Origin:origin};
    if (cookie) headers.Cookie=cookie;
    if (body) headers["Content-Type"]="application/json";
    const response=await fetch(base+url,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    return {status:response.status,body:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]};
}

function mimePart(message,type) {
    const block=message.split("\r\n\r\n").findIndex(part=>part.includes("Content-Type: "+type));
    const content=message.split("\r\n\r\n")[block+1]?.split(/\r\n--/)[0];
    return Buffer.from(content||"","base64");
}

async function browserChecks(html,logo,adminCookie,acceptedNumber,failedNumber) {
    const browser=await require("playwright").chromium.launch();
    try {
        for (const width of [320,375,768]) {
            const page=await browser.newPage({viewport:{width,height:800}});
            await page.route("**/*",route=>route.abort());
            // Model the mail client's resolution of the MIME Content-ID.
            await page.setContent(html.replace("cid:zoicas-logo","data:image/png;base64,"+logo.toString("base64")));
            assert("Logo renders with no overflow at "+width,await page.locator("img").evaluate(img=>img.complete && img.naturalWidth>0 && document.documentElement.scrollWidth<=innerWidth));
            assert("German contract message is visible at "+width,await page.getByRole("heading",{name:"Guten Tag Test & Probe Kunde,"}).isVisible());
            await page.close();
        }
        const context=await browser.newContext();
        await context.route(url=>url.origin!==base,route=>route.abort());
        const separator=adminCookie.indexOf("=");
        await context.addCookies([{name:adminCookie.slice(0,separator),value:adminCookie.slice(separator+1),url:base}]);
        const adminPage=await context.newPage();
        await adminPage.goto(base+"/public/admin.html",{waitUntil:"domcontentloaded"});
        await adminPage.locator('[data-type="contract"]').click();
        for (const [number,accepted] of [[failedNumber,false],[acceptedNumber,true]]) {
            await adminPage.getByRole("row").filter({hasText:number}).getByRole("button",{name:"Öffnen"}).click();
            const expected=accepted?"Vom Mailserver angenommen. Zustellung beim Kunden ist nicht bestätigt.":"Versand fehlgeschlagen.";
            await adminPage.getByText(expected,{exact:true}).waitFor();
            assert(accepted?"Admin UI labels SMTP acceptance and hides retry":"Admin UI shows failure and retry control",
                (await adminPage.locator("#contract-email-retry").isVisible())===!accepted);
            await adminPage.locator("#contract-dialog").getByRole("button",{name:"Schließen"}).click();
        }
        await context.close();
    } finally { await browser.close(); }
}

async function main() {
    const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database:env.MYSQL_DATABASE,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
    const {CONTRACT_TEST_TLS_CERT:cert,CONTRACT_TEST_TLS_KEY:key,CONTRACT_TEST_TLS_CA:ca}=process.env;
    if (!cert || !key || !ca) throw new Error("Supply paths for the synthetic SMTP TLS certificate, key and CA.");
    const {server,messages,setRejectFailure}=captureMail(fs.readFileSync(cert),fs.readFileSync(key));
    const pipe = process.platform==="win32" ? "\\\\.\\pipe\\zo-contract-"+randomUUID() : require("node:path").join(require("node:os").tmpdir(),"zo-"+randomUUID()+".sock");
    let app;
    try {
        const [[identity]]=await db.query("SELECT DATABASE() db,@@port port");
        assert("Isolated SQL database verified",identity.db==="zoicas_osinski_test"&&Number(identity.port)===Number(env.MYSQL_PORT));
        server.listen(pipe);
        await once(server,"listening");
        const verifyCertificate = async (ca,servername) => {
            const socket=require("node:net").connect(pipe);
            const client=tls.connect({socket,ca,servername,rejectUnauthorized:true});
            try { await once(client,"secureConnect"); return client.authorized; }
            catch (error) { return error.code; }
            finally { client.destroy(); }
        };
        assert("TLS accepts the trusted localhost certificate",await verifyCertificate(fs.readFileSync(ca),"localhost")===true);
        assert("TLS rejects an untrusted certificate",await verifyCertificate(undefined,"localhost")==="UNABLE_TO_VERIFY_LEAF_SIGNATURE");
        assert("TLS rejects a mismatched certificate hostname",await verifyCertificate(fs.readFileSync(ca),"wrong.example.test")==="ERR_TLS_CERT_ALTNAME_INVALID");
        // Use real TLS over local IPC so desktop mail scanners cannot replace the test certificate.
        const bootstrap = `
            const tls = require("node:tls"), net = require("node:net"), connect = tls.connect;
            tls.setDefaultCACertificates([require("node:fs").readFileSync(process.env.CONTRACT_TEST_TLS_CA,"utf8")]);
            tls.connect = options => {
                if (options.host !== "localhost" || options.port !== 24650) return connect(options);
                const socket = net.connect(process.env.CONTRACT_TEST_PIPE);
                const {host,port,...tlsOptions} = options;
                return connect({...tlsOptions,socket});
            };
            require("./server.js");
        `;
        app=spawn(process.execPath,["-e",bootstrap],{env:{...process.env,ENV_FILE:".env.test",PORT:"3001",HOST:"127.0.0.1",MYSQL_DATABASE:env.MYSQL_DATABASE,MYSQL_HOST:env.MYSQL_HOST,MYSQL_PORT:env.MYSQL_PORT,
            SMTP_HOST:"localhost",SMTP_PORT:"24650",SMTP_IMPLICIT_TLS:"true",SMTP_USER:"capture",SMTP_PASSWORD:"synthetic-only",SMTP_FROM:"sender@example.test",CONTRACT_TEST_PIPE:pipe},stdio:["ignore","pipe","pipe"],windowsHide:true});
        let ready=false;
        app.stdout.on("data",chunk=>{if (chunk.toString().includes("server listening")) ready=true;});
        app.stderr.resume();
        for(let n=0;n<50&&!ready&&app.exitCode===null;n++) await new Promise(resolve=>setTimeout(resolve,200));
        assert("Isolated HTTP server and database ready",ready&&(await request("/api/health")).body.database==="connected");

        const stamp=randomUUID().slice(0,8),password="TestAa!"+randomUUID();
        const admin=await request("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD});
        assert("Admin authorized",admin.status===200&&admin.cookie);
        async function customer(prefix) {
            const email=prefix+"."+stamp+"@example.test";
            const registration=await request("/api/customer/register",null,"POST",{first_name:"Test & Probe",last_name:"Kunde",phone:"+49123456789",email,password,password_confirmation:password});
            const login=await request("/api/customer/login",null,"POST",{email,password});
            assert("Synthetic "+prefix+" customer session",registration.status===201&&login.status===200);
            return {id:registration.body.id,cookie:login.cookie,email};
        }
        const owner=await customer("owner"), other=await customer("other"), failure=await customer("fail");
        const date=berlinWallTime(new Date()).slice(0,10);
        const privateMarker="Private fixture "+stamp;
        const payload={customer_id:owner.id,start_date:date,service_description:privateMarker,service_type:"Synthetische Reinigung",interval_type:"EINMALIG",net_amount:123,tax_rate:19,internal_notes:privateMarker};
        const contracts="/api/admin/contracts";
        const audit=async id=>{
            const [rows]=await db.execute("SELECT action,metadata FROM audit_logs WHERE entity_type='CONTRACT' AND entity_id=? AND action LIKE 'CONTRACT_EMAIL_%' ORDER BY id",[id]);
            return rows;
        };
        const draft=await request(contracts,admin.cookie,"POST",payload);
        assert("Saving a draft sends no email",draft.status===201&&messages.length===0&&(await audit(draft.body.id)).length===0);
        const url=contracts+"/"+draft.body.id,customerUrl="/api/customer/contracts/"+draft.body.id;
        assert("Draft hidden from the owner", (await request(customerUrl,owner.cookie)).status===404);
        const activate={...payload,status:"AKTIV",notify_on_activation:true};
        assert("Customer cannot activate a contract", (await request(url,owner.cookie,"PATCH",activate)).status===401);
        assert("Cross-origin activation rejected", (await request(url,admin.cookie,"PATCH",activate,"https://example.test")).status===403);
        assert("Email activation requires a saved draft", (await request(contracts,admin.cookie,"POST",activate)).status===409);
        assert("Activation cannot change the draft's recipient", (await request(url,admin.cookie,"PATCH",{...activate,customer_id:other.id})).status===409);
        const attempts=await Promise.all([request(url,admin.cookie,"PATCH",activate),request(url,admin.cookie,"PATCH",activate)]);
        assert("Concurrent activation sends exactly one message",attempts.every(reply=>reply.status===200)&&attempts.filter(reply=>reply.body.emailDelivery==="ACCEPTED").length===1&&messages.length===1);
        assert("One attempt and SMTP acceptance recorded",(await audit(draft.body.id)).map(row=>row.action).join(",")==="CONTRACT_EMAIL_ATTEMPTED,CONTRACT_EMAIL_ACCEPTED");
        assert("Owner sees active contract and another customer cannot", (await request(customerUrl,owner.cookie)).status===200&&(await request(customerUrl,other.cookie)).status===404);
        await request(url,admin.cookie,"PATCH",activate);
        assert("Repeated activation remains silent",messages.length===1);
        const captured=messages[0],html=mimePart(captured.raw,"text/html").toString("utf8"),plain=mimePart(captured.raw,"text/plain").toString("utf8");
        const logo=mimePart(captured.raw,"image/png");
        assert("Correct recipient and German subject",captured.recipient===owner.email&&captured.raw.includes("\r\nSubject: Ihr Vertrag bei Zoicas & Osinski\r\n"));
        assert("Plain text and HTML contain German contract details",plain.includes("Guten Tag Test & Probe Kunde,")&&html.includes("Guten Tag Test &amp; Probe Kunde,")&&plain.includes(draft.body.contractNumber)&&html.includes(draft.body.contractNumber)&&plain.includes(date.split("-").reverse().join("."))&&html.includes("freigegebenen Vertragsinformationen"));
        assert("Branded shell and exact inline logo",html.includes("#102f50")&&html.includes("#a6d936")&&html.includes("Arial,sans-serif")&&html.includes("cid:zoicas-logo")&&captured.raw.includes("Content-ID: <zoicas-logo>")&&logo.equals(fs.readFileSync("assets/images/Logo/zoicas-osinski.png")));
        assert("No internal details or remote image references",![html,plain].some(body=>body.includes(privateMarker)||body.includes("146.37"))&&!/<img\b[^>]*src=["']https?:/i.test(html));

        const historical=await request(contracts,admin.cookie,"POST",{...payload,start_date:"2020-01-10",status:"AKTIV"});
        assert("Historical active entry is silent",historical.status===201&&messages.length===1&&(await audit(historical.body.id)).length===0);
        const historicalDraft=await request(contracts,admin.cookie,"POST",{...payload,start_date:"2020-01-10"});
        const historicalActivation=await request(contracts+"/"+historicalDraft.body.id,admin.cookie,"PATCH",{...activate,start_date:"2020-01-10"});
        assert("Explicit backdated activation is silent",historicalActivation.status===200&&messages.length===1&&(await audit(historicalDraft.body.id)).length===0);
        const silent=await request(contracts,admin.cookie,"POST",{...payload,status:"AKTIV"});
        assert("Ordinary save of an active record is silent",silent.status===201&&messages.length===1);
        await request(contracts+"/"+silent.body.id,admin.cookie,"PATCH",{...payload,status:"ENTWURF"});
        await request(contracts+"/"+silent.body.id,admin.cookie,"PATCH",activate);
        assert("Import remains silent after draft and reactivation",messages.length===1&&(await audit(silent.body.id)).length===0);
        const failedDraft=await request(contracts,admin.cookie,"POST",{...payload,customer_id:failure.id});
        const failedUrl=contracts+"/"+failedDraft.body.id;
        const rejected=await request(failedUrl,admin.cookie,"PATCH",{...activate,customer_id:failure.id});
        const failureEvents=await audit(failedDraft.body.id);
        assert("SMTP rejection preserves activation and records a safe failure",rejected.status===200&&rejected.body.emailDelivery==="FAILED"&&
            failureEvents.map(row=>row.action).join(",")==="CONTRACT_EMAIL_ATTEMPTED,CONTRACT_EMAIL_FAILED"&&!JSON.stringify(failureEvents).includes(failure.email)&&
            (await request("/api/customer/contracts/"+failedDraft.body.id,failure.cookie)).status===200);
        await request(failedUrl,admin.cookie,"PATCH",{...activate,customer_id:failure.id});
        assert("Failed send is not retried by repeat activation",(await audit(failedDraft.body.id)).length===2&&messages.length===1);
        const [employee]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,'EMPLOYEE','ACTIVE')",
            ["TEST-MAIL-"+stamp,"Probe","Mitarbeiter","employee."+stamp+"@example.test","+49123456789","disabled-synthetic-fixture"]);
        const invitation=await request("/api/admin/employees/"+employee.insertId+"/invitation",admin.cookie,"POST",{});
        assert("Employee invitation still uses the shared branded email",invitation.status===201&&invitation.body.emailSent&&messages.length===2&&
            mimePart(messages[1].raw,"text/html").toString("utf8").includes("MITARBEITERPORTAL")&&mimePart(messages[1].raw,"image/png").equals(logo));
        const endpoint=failedUrl+"/email/retry";
        assert("Admin sees a retryable failure", (await request(failedUrl,admin.cookie)).body.email.canRetry===true);
        assert("Retry requires Admin and same origin",(await request(endpoint,failure.cookie,"POST",{})).status===401&&
            (await request(endpoint,admin.cookie,"POST",{},"https://other.example.test")).status===403);
        setRejectFailure(false);
        const retries=await Promise.all([request(endpoint,admin.cookie,"POST",{}),request(endpoint,admin.cookie,"POST",{})]);
        assert("Retry concurrency yields one SMTP submission",retries.map(row=>row.status).sort().join(",")==="200,409"&&messages.length===3);
        assert("Admin sees acceptance and full history", (await request(failedUrl,admin.cookie)).body.email.status==="ACCEPTED"&&
            (await audit(failedDraft.body.id)).map(row=>row.action).join(",")==="CONTRACT_EMAIL_ATTEMPTED,CONTRACT_EMAIL_FAILED,CONTRACT_EMAIL_ATTEMPTED,CONTRACT_EMAIL_ACCEPTED");
        assert("Accepted contracts cannot be resent",(await request(endpoint,admin.cookie,"POST",{})).status===409&&
            (await request(url+"/email/retry",admin.cookie,"POST",{})).status===409&&messages.length===3);
        assert("Historical import cannot be retried",(await request(contracts+"/"+historical.body.id+"/email/retry",admin.cookie,"POST",{})).status===409);
        await db.execute("UPDATE customers SET email=? WHERE id=?",["unknown."+stamp+"@example.test",other.id]);
        const unknownDraft=await request(contracts,admin.cookie,"POST",{...payload,customer_id:other.id});
        const unknownUrl=contracts+"/"+unknownDraft.body.id;
        const unknown=await request(unknownUrl,admin.cookie,"PATCH",{...activate,customer_id:other.id});
        assert("Lost SMTP response is recorded as unknown and cannot be retried",unknown.body.emailDelivery==="UNKNOWN"&&
            (await request(unknownUrl+"/email/retry",admin.cookie,"POST",{})).status===409);
        assert("Historical start date preserved in Admin contract",(await request(contracts+"/"+historical.body.id,admin.cookie)).body.contract.start_date.slice(0,10)==="2020-01-10");
        const uiFailure=await request(contracts,admin.cookie,"POST",{...payload,customer_id:failure.id});
        setRejectFailure(true);
        await request(contracts+"/"+uiFailure.body.id,admin.cookie,"PATCH",{...activate,customer_id:failure.id});
        await browserChecks(html,logo,admin.cookie,draft.body.contractNumber,uiFailure.body.contractNumber);
    } finally {
        if (app && app.exitCode===null) { app.kill(); await once(app,"close"); }
        if(server.listening) await new Promise(resolve=>server.close(resolve));
        await db.end();
    }
}
main().catch(error=>{
    if (!results.some(row=>row.status==="FAIL")) results.push({label:error.code||error.message,status:"FAIL"});
    process.exitCode=1;
}).finally(()=>{
    const totals={PASS:0,FAIL:0,SKIPPED:0};
    for(const result of results) totals[result.status]++;
    console.log(JSON.stringify({totals,results},null,2));
});
