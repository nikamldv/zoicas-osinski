"use strict";
const fs=require("node:fs"),{parseEnv}=require("node:util"),{randomUUID}=require("node:crypto");
const mysql=require("mysql2/promise"), {berlinWallTime}=require("../attendance-punctuality");
const env=parseEnv(fs.readFileSync(".env.test","utf8"));
if(process.env.ENV_FILE!==".env.test"||env.PORT!=="3001"||env.MYSQL_DATABASE!=="zoicas_osinski_test"||env.MYSQL_HOST!=="127.0.0.1"||env.SMTP_HOST)throw Error("Isolated test configuration required");
const base="http://127.0.0.1:3001", contracts="/api/admin/contracts", plans="/api/admin/recurring-orders", results=[];
function check(label,pass){results.push({label,pass:Boolean(pass)});if(!pass)throw Error(label);}
async function req(route,cookie,method="GET",body){
    const headers={Origin:base};
    if(cookie)headers.Cookie=cookie;
    if(body)headers["Content-Type"]="application/json";
    const r=await fetch(base+route,{headers,method,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
async function browserChecks(admin,owner,token){
    const browser=await require("playwright").chromium.launch();
    try{
        for(const [width,height] of [[375,812],[768,1024],[1440,900]]){
            const context=await browser.newContext({viewport:{width,height}});
            try {
                await context.route(url=>url.origin!==base,route=>route.abort());
                const i=admin.indexOf("=");
                await context.addCookies([{name:admin.slice(0,i),value:admin.slice(i+1),url:base}]);
                const page=await context.newPage();
                page.setDefaultTimeout(8000);
                await page.goto(base+"/public/admin.html",{waitUntil:"domcontentloaded"});
                await page.locator('[data-type="contract"]').click();
                await page.getByRole("button",{name:"Bestehenden Vertrag erfassen"}).click();
                const form=page.locator("#contract-form"), dialog=page.locator("#contract-dialog");
                const reference="BÜRO-"+token+"-"+width;
                await form.locator("#contract-customer-search").fill("Synthetic "+owner.name);
                await page.locator("#contract-customer-search-status").filter({hasText:"1 Ergebnis"}).waitFor();
                await form.locator("#contract-customer").locator('option[value="'+owner.id+'"]').waitFor({state:"attached"});
                await form.locator("#contract-customer").selectOption(String(owner.id));
                const values={external_contract_number:reference,start_date:"2021-04-12",service_type:"Büroreinigung",service_description:"Synthetische Büroreinigung",
                    net_amount:"220.50",tax_rate:"19",payment_interval:"monatlich",cancellation_notice_days:"30"};
                for(const [name,value] of Object.entries(values)) await form.locator('[name="'+name+'"]').fill(value);
                await form.locator('[name="interval_type"]').selectOption("WOECHENTLICH");
                check(width+" grouped contract form fits the viewport",await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)&&await form.getByText("Preis und Abrechnung",{exact:true}).isVisible());
                let writes=0;
                page.on("request",r=>{if(r.method()==="POST"&&r.url()===base+contracts)writes++;});
                await form.getByRole("button",{name:"Angaben prüfen"}).click();
                const review=page.locator("#contract-review-dialog");
                await review.getByText(reference,{exact:true}).waitFor();
                check(width+" review contains original terms before any write",writes===0&&await review.getByText("2021-04-12",{exact:true}).isVisible());
                await review.getByRole("button",{name:"Angaben korrigieren"}).click();
                await form.locator('[name="net_amount"]').fill("221.50");
                await form.getByRole("button",{name:"Angaben prüfen"}).click();
                check(width+" correction appears in final review",await review.getByText("221.50",{exact:true}).isVisible());
                const completed=page.waitForResponse(r=>r.url()===base+contracts&&r.request().method()==="POST");
                await review.getByRole("button",{name:"Vertrag verbindlich speichern"}).click();
                const reply=await completed,created=await reply.json();
                await page.getByRole("button",{name:"Einsatzplan anlegen"}).waitFor();
                const detail=(await req(contracts+"/"+created.id,admin)).data;
                check(width+" final save creates one silent historical contract without a plan",reply.status()===201&&writes===1&&detail.contract.external_contract_number===reference&&Number(detail.contract.net_amount)===221.5&&detail.email.status==="NONE"&&!detail.schedule);
                if(width===768){
                    await page.getByRole("button",{name:"Einsatzplan anlegen"}).click();
                    const plan=page.locator("#recurring-form");
                    await plan.locator('[name="start_date"]').fill(berlinWallTime(new Date()).slice(0,10));
                    await plan.locator('[name="weekdays"]').fill("1");
                    await plan.locator('[name="preferred_start_time"]').fill("09:00");
                    await plan.locator('[name="planned_end_time"]').fill("11:00");
                    await plan.locator('[name="service_address"]').fill("Synthetischer Weg 17");
                    await plan.locator('[name="service_postal_code"]').fill("10115");
                    await plan.locator('[name="service_city"]').fill("Berlin");
                    page.once("dialog",d=>d.dismiss());
                    await plan.getByRole("button",{name:"Einsatzplan speichern"}).click();
                    check("Dismissing schedule confirmation keeps the contract without a plan",!(await req(contracts+"/"+created.id,admin)).data.schedule);
                    page.once("dialog",d=>d.accept());
                    const planSaved=page.waitForResponse(r=>r.url()===base+plans&&r.request().method()==="POST");
                    await plan.getByRole("button",{name:"Einsatzplan speichern"}).click();
                    check("Browser saves time range and service location after confirmation",(await planSaved).status()===201);
                }
                await dialog.getByRole("button",{name:"Schließen"}).click();
                await page.locator("#search-input").fill(reference);
                await page.getByRole("row").filter({hasText:reference}).waitFor();
                check(width+" contract overview is searchable by original number",await page.getByRole("row").filter({hasText:reference}).getByText("Büroreinigung",{exact:true}).isVisible());
            }finally{await context.close();}
        }
    }finally{await browser.close();}
}
async function main(){
    const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database:env.MYSQL_DATABASE,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
    try{
        const [[actual]]=await db.query("SELECT DATABASE() AS db, @@port AS port");
        check("Isolated database and HTTP server verified",actual.db===env.MYSQL_DATABASE&&Number(actual.port)===Number(env.MYSQL_PORT)&&(await req("/api/health")).data.database==="connected");
        const stamp=randomUUID().slice(0,8),password="TestAa!"+randomUUID();
        const adminLogin=await req("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD});
        check("Admin login",adminLogin.status===200);
        const admin=adminLogin.cookie;
        async function customer(label){
            const name=label+"-"+stamp,email=name+"@example.test";
            const created=await req("/api/customer/register",null,"POST",{first_name:"Synthetic",last_name:name,email,password,password_confirmation:password,phone:"+49123456789"});
            const login=await req("/api/customer/login",null,"POST",{email,password});
            check(label+" synthetic customer",created.status===201&&login.status===200);
            return {id:created.data.id,cookie:login.cookie,name};
        }
        const owner=await customer("Owner"),other=await customer("Other");
        const current=berlinWallTime(new Date()), today=current.slice(0,10);
        const day=n=>new Date(Date.parse(today+"T12:00:00Z")+n*86400000).toISOString().slice(0,10);
        const baseContract={customer_id:owner.id,start_date:"2021-04-12",status:"AKTIV",historical_registration:true,service_description:"Synthetic service agreement",
            net_amount:120.75,tax_rate:19,payment_interval:"monatlich",cancellation_notice_days:30};
        async function add(label,fields){
            const payload={...baseContract,service_type:label,...fields,registration_key:randomUUID()};
            const response=await req(contracts,admin,"POST",payload);
            check(label+" registers without an email or schedule",response.status===201);
            const state=(await req(contracts+"/"+response.data.id,admin)).data;
            check(label+" remains silent and unplanned",state.email.status==="NONE"&&!state.schedule);
            return {id:response.data.id,number:response.data.contractNumber,payload};
        }
        const house=await add("Haushaltsreinigung",{interval_type:"WOECHENTLICH",external_contract_number:"WO-"+stamp});
        const building=await add("Gebäudereinigung",{interval_type:"MONATLICH",external_contract_number:"MO-"+stamp,status:"GEKUENDIGT",cancellation_date:today,termination_date:day(15)});
        const missing=await add("Optionale Angaben fehlen",{interval_type:"INDIVIDUELL",payment_interval:"",cancellation_notice_days:""});
        const incomplete=await req(contracts+"?schedule=incomplete&search="+encodeURIComponent(missing.number),admin);
        check("Missing-information filter returns incomplete historical contract",incomplete.status===200&&incomplete.data.rows.some(row=>row.id===missing.id&&!row.payment_interval&&!row.external_contract_number&&!row.has_documents));
        check("Duplicate external number per customer rejected",(await req(contracts,admin,"POST",{...house.payload,registration_key:randomUUID()})).status===409);
        for(const [field,value] of [["start_date","2024-02-30"],["net_amount","-1"],["payment_interval","X".repeat(81)],["cancellation_notice_days",3651],["interval_type","INVALID"]]){
            check("Invalid "+field+" rejected",(await req(contracts,admin,"POST",{...house.payload,external_contract_number:"",registration_key:randomUUID(),[field]:value})).status===400);
        }
        const weekday=(new Date(day(1)+"T12:00:00Z").getUTCDay()||7);
        const schedule={contract_id:house.id,start_date:day(1),recurrence_type:"WOECHENTLICH",weekdays:String(weekday),
            preferred_start_time:"09:00",planned_end_time:"10:30",duration_minutes:90,service_address:"Synthetischer Testweg 7",service_postal_code:"10115",service_city:"Berlin",active:1};
        check("Historical schedule requires explicit confirmation",(await req(plans,admin,"POST",schedule)).status===409);
        check("Invalid cleaning weekdays rejected",(await req(plans,admin,"POST",{...schedule,weekdays:"8",confirm_schedule_change:true})).status===400);
        check("Invalid or mismatched time range rejected",(await req(plans,admin,"POST",{...schedule,planned_end_time:"08:30",confirm_schedule_change:true})).status===400);
        check("Incomplete service site rejected",(await req(plans,admin,"POST",{...schedule,service_city:"",confirm_schedule_change:true})).status===400);
        const hex=randomUUID().replaceAll("-","");
        const [worker]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,'EMPLOYEE','ACTIVE')",
            ["TEST-"+stamp,"TEST","Staff",hex+"@example.test","+49123456789","disabled-synthetic-fixture"]);
        await db.execute("INSERT INTO employee_absences(employee_id,absence_type,start_date,end_date,created_by) VALUES(?,'URLAUB',?,?,'test')",[worker.insertId,day(1),day(1)]);
        const hp=await req(plans,admin,"POST",{...schedule,preferred_employee_id:worker.insertId,confirm_schedule_change:true});
        const mp=await req(plans,admin,"POST",{...schedule,contract_id:building.id,recurrence_type:"MONATLICH",end_date:day(15),confirm_schedule_change:true});
        check("Weekly household and monthly building plans saved",hp.status===201&&mp.status===201);
        const [[before]]=await db.execute("SELECT COUNT(*) n FROM orders WHERE contract_id IN (?,?)",[house.id,building.id]);
        check("Saving plans does not generate orders",Number(before.n)===0);
        const generation=await req(plans+"/generate",admin,"POST",{contract_id:house.id,days:3});
        const [orders]=await db.execute("SELECT address,postal_code,city,TIME(planned_start) AS starts,TIME(planned_end) AS ends,status FROM orders WHERE contract_id=?",[house.id]);
        check("Explicit generation uses service site and times without assigning absent staff",generation.status===201&&orders.length===1&&
            orders[0].address===schedule.service_address&&orders[0].postal_code==="10115"&&orders[0].city==="Berlin"&&orders[0].starts==="09:00:00"&&orders[0].ends==="10:30:00"&&orders[0].status==="GEPLANT");
        const list=await req(contracts+"?schedule=active&search="+encodeURIComponent(house.number)+"&page=1",admin);
        check("Overview shows active schedule and actual next cleaning appointment",list.data.total===1&&list.data.rows[0].schedule_active===1&&list.data.rows[0].next_cleaning===day(1)+" 09:00");
        check("Customer ownership preserved",(await req("/api/customer/contracts/"+house.id,owner.cookie)).status===200&&(await req("/api/customer/contracts/"+house.id,other.cookie)).status===404);
        check("Customer cannot configure a recurring plan",(await req(plans,owner.cookie,"POST",schedule)).status===401);
        await browserChecks(admin,owner,stamp);
    }finally{await db.end();}
}
main().catch(error=>{console.error(error.code||error.message);if(!results.some(row=>!row.pass))results.push({label:error.code||error.message,pass:false});process.exitCode=1;}).finally(()=>{
    console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,skipped:0,failures:results.filter(r=>!r.pass).map(r=>r.label)}));
});
