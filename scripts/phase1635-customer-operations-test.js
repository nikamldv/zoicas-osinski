"use strict";
const fs=require("node:fs"),{parseEnv}=require("node:util"),{randomUUID,randomBytes,scryptSync}=require("node:crypto");
const mysql=require("mysql2/promise"),{berlinWallTime}=require("../attendance-punctuality");
const env=parseEnv(fs.readFileSync(".env.test","utf8")),base="http://127.0.0.1:3001",results=[];
if(process.env.ENV_FILE!==".env.test"||env.PORT!=="3001"||env.MYSQL_HOST!=="127.0.0.1"||env.MYSQL_DATABASE!=="zoicas_osinski_test"||env.SMTP_HOST||process.env.SMTP_HOST)throw Error("Isolated environment required");
function check(name,pass){results.push({name,pass:Boolean(pass)});if(!pass)throw Error(name);}
async function req(path,cookie,method="GET",data){
 const headers={Origin:base};if(cookie)headers.Cookie=cookie;
 if(data&&!(data instanceof FormData))headers["Content-Type"]="application/json";
 const r=await fetch(base+path,{method,headers,body:data instanceof FormData?data:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
 const response=await r.text();
 let body;try{body=JSON.parse(response);}catch{}
 const set=r.headers.get("set-cookie");
 return {status:r.status,body,cookie:set?.split(";")[0],cleared:set?.includes("Max-Age=0")};
}
async function browserChecks(admin){
 const browser=await require("playwright").chromium.launch();
 try{
  for(const [width,height] of [[375,812],[768,1024],[1440,900]]){
   const context=await browser.newContext({viewport:{width,height}});
   try{
    await context.route(url=>url.origin!==base,route=>route.abort());
    const at=admin.indexOf("=");
    await context.addCookies([{name:admin.slice(0,at),value:admin.slice(at+1),url:base}]);
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(base+"/admin.html",{waitUntil:"domcontentloaded"});
    await page.locator('[data-type="customer"]').click();
    const create=page.getByRole("button",{name:"Neuen Kunden anlegen"});
    await create.focus();
    await page.keyboard.press("Enter");
    const dialog=page.getByRole("dialog",{name:"Neuen Kunden anlegen"}), form=dialog.locator("form#customer-create-form");
    await form.getByLabel("Vorname",{exact:true}).fill("Synthetic");
    await form.getByLabel("Nachname",{exact:true}).fill("Browser "+randomUUID().slice(0,8));
    check(width+" customer entry fits viewport",await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await form.getByRole("button",{name:"Kunden speichern"}).click();
    await form.getByRole("button",{name:"Bestehenden Vertrag erfassen"}).click();
    const contract=page.locator("#contract-dialog");
    await contract.waitFor();
    check(width+" new offline customer is preselected for a historical contract",Boolean(await contract.locator("#contract-customer").inputValue()));
   }finally{await context.close();}
  }
 }finally{await browser.close();}
}

async function main(){
 const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),database:env.MYSQL_DATABASE,user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD});
 try{
  const [[identity]]=await db.query("SELECT DATABASE() db,@@port port");
  check("Isolated database and server verified",identity.db===env.MYSQL_DATABASE&&Number(identity.port)===Number(env.MYSQL_PORT)&&(await req("/api/health")).body.database==="connected");
  const admin=(await req("/api/admin/login",null,"POST",{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD})).cookie;
  const stamp=randomUUID().slice(0,8),password="TestAa!"+randomUUID(),email="portal."+stamp+"@example.test";
  const customerPath="/api/admin/customers";
  const data={customer_type:"BUSINESS",company_name:"Synthetic office "+stamp,contact_name:"Test Contact",internal_notes:"Synthetic note "+stamp,registration_key:randomUUID()};
  const created=await Promise.all([req(customerPath,admin,"POST",data),req(customerPath,admin,"POST",data)]);
  check("Offline business creation succeeds once under concurrent submission",created.map(r=>r.status).sort().join(",")==="201,409");
  const id=created.find(r=>r.status===201).body.id;
  const record=(await req(customerPath+"/"+id,admin)).body.customer;
  check("Offline customer has no email or portal password",record.email===null&&Number(record.portal_enabled)===0&&record.company_name===data.company_name);
  const contract=await req("/api/admin/contracts",admin,"POST",{customer_id:id,external_contract_number:"TEST-"+stamp,start_date:"2022-03-04",status:"AKTIV",historical_registration:true,service_type:"Reinigung",service_description:"Synthetic",interval_type:"EINMALIG",net_amount:100,tax_rate:19});
  check("Offline customer can be used immediately for a silent historical contract",contract.status===201&&(await req("/api/admin/contracts/"+contract.body.id,admin)).body.email.status==="NONE");
  const [[noInvite]]=await db.execute("SELECT COUNT(*) n FROM customer_portal_invitations WHERE customer_id=?",[id]);
  check("Registration generated no invitation",Number(noInvite.n)===0);
  const invite=await req(customerPath+"/"+id+"/invitation",admin,"POST",{email});
  check("Admin explicitly issues a portal invitation",invite.status===201&&invite.body.invitationPath.includes("#einladung="));
  const token=invite.body.invitationPath.split("=")[1];
  const activation={token,password,password_confirmation:password};
  const accepted=await Promise.all([req("/api/customer/accept-invitation",null,"POST",activation),req("/api/customer/accept-invitation",null,"POST",activation)]);
  check("Customer invitation token works only once under concurrency",accepted.map(r=>r.status).sort().join(",")==="200,400");
  const login=()=>req("/api/customer/login",null,"POST",{email,password});
  const a=(await login()).cookie,b=(await login()).cookie;
  check("Activated customer signs in twice",Boolean(a&&b&&a!==b));
  check("Customer cannot create Admin records",(await req(customerPath,a,"POST",data)).status===401);
  check("Duplicate email safely rejected",(await req(customerPath,admin,"POST",{...data,registration_key:randomUUID(),email})).status===409);
  const profile=await req("/api/customer/profile",a);
  check("Admin notes and invitation material remain private",profile.status===200&&!JSON.stringify(profile.body).includes(data.internal_notes)&&!JSON.stringify(profile.body).includes(token));
  const form=new FormData();
  for(const [key,value] of Object.entries({customer_id:id,contract_id:contract.body.id,document_type:"VERTRAG",visibility:"CUSTOMER"}))form.set(key,String(value));
  form.set("file",new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/evoAAAAASUVORK5CYII=","base64")],{type:"image/png"}),"synthetic.png");
  const doc=await req("/api/admin/documents",admin,"POST",form);
  check("Customer can download own published document before deactivation",doc.status===201&&(await req("/api/customer/documents/"+doc.body.id,b)).status===200);
  const today=berlinWallTime(new Date()).slice(0,10);
  let day;
  for(let offset=12;offset<40;offset++){
   const date=new Date(Date.parse(today+"T12:00:00Z")+86400000*offset).toISOString().slice(0,10);
   const [[existing]]=await db.execute("SELECT id FROM appointments WHERE preferred_date=? AND start_time=\'01:13:00\'",[date]);
   if(!existing){day=date;break;}
  }
  if(!day)throw Error("No isolated booking slot available");
  const [c]=await db.execute("INSERT INTO appointment_customers(first_name,last_name,email,phone) VALUES('Synthetic','Fixture',?,'+49123456789')",[email]);
  const [slot]=await db.execute("INSERT INTO appointments(customer_id,portal_customer_id,service,object_type,address,postal_code,city,preferred_date,start_time,end_time,duration_minutes,status) VALUES(?,?,'Synthetic','Büro','Testweg 9','10115','Berlin',?,'01:13','02:13',60,'confirmed')",[c.insertId,id,day]);
  const home=(await req("/api/customer/home",a)).body,booking=home.next;
  check("Next appointment is not duplicated in additional bookings",home.bookings.length===0);
  check("Confirmed booking exposes Berlin date, both times and location",booking.kind==="APPOINTMENT"&&booking.day===day&&booking.start_time.startsWith("01:13")&&booking.end_time.startsWith("02:13")&&booking.city==="Berlin");
  const order=await req("/api/admin/orders",admin,"POST",{customer_id:id,appointment_id:slot.insertId,service_type:"Synthetic",title:"Converted booking",status:"GEPLANT",priority:"NORMAL",preferred_date:day});
  check("Order conversion replaces the dashboard booking",order.status===201&&(await req("/api/customer/home",a)).body.next?.kind==="ORDER"&&(await req("/api/customer/home",a)).body.bookings.length===0);
  check("Blocking customer succeeds",(await req(customerPath+"/"+id,admin,"PATCH",{status:"blocked"})).status===200);
  for(const [cookie,route] of [[a,"/api/customer/home"],[b,"/api/customer/documents/"+doc.body.id],[b,"/api/customer/notifications"],[a,"/api/customer/refresh"]]){
   const result=await req(route,cookie);
   check("Reload protected customer resource is denied and cookie cleared "+route,result.status===401&&result.cleared);
  }
  check("Customer reactivation requires new login",(await req(customerPath+"/"+id,admin,"PATCH",{status:"active"})).status===200&&(await req("/api/customer/home",a)).status===401&&(await login()).status===200);
  for(const role of ["EMPLOYEE","MANAGER"]){
   const mail=role.toLowerCase()+"."+stamp+"@example.test",salt=randomBytes(16),hash=["scrypt",salt.toString("hex"),scryptSync(password,salt,64).toString("hex")].join("$");
   const [staff]=await db.execute("INSERT INTO employees(employee_number,first_name,last_name,email,phone,password_hash,role,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')",["TEST-"+role+"-"+stamp,"Synthetic",role,mail,"+49123456789",hash,role]);
   const signIn=()=>req("/api/employee/login",null,"POST",{email:mail,password});
   const credentials=[(await signIn()).cookie,(await signIn()).cookie];
   check(role+" fixture authenticated",credentials.every(Boolean)&&(await req("/api/employee/attendance",credentials[0])).status===200);
   const endpoint="/api/admin/employees/"+staff.insertId+"/status";
   check(role+" disabled by Admin",(await req(endpoint,admin,"PATCH",{status:"INACTIVE"})).status===200);
   const [revoked,profile]=await Promise.all([req("/api/employee/attendance",credentials[0]),req("/api/employee/profile",credentials[1])]);
   check(role+" multiple sessions revoked",revoked.status===401&&profile.status===401&&revoked.cleared&&profile.cleared);
   check(role+" reactivation requires new login",(await req(endpoint,admin,"PATCH",{status:"ACTIVE"})).status===200&&(await req("/api/employee/profile",credentials[1])).status===401&&(await signIn()).status===200);
  }
  const expiredRecord=await req(customerPath,admin,"POST",{...data,email:"expires."+stamp+"@example.test",registration_key:randomUUID()});
  const expiredInvite=await req(customerPath+"/"+expiredRecord.body.id+"/invitation",admin,"POST",{});
  await db.execute("UPDATE customer_portal_invitations SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE customer_id=?",[expiredRecord.body.id]);
  check("Expired invitation cannot activate the portal",(await req("/api/customer/accept-invitation",null,"POST",{...activation,token:expiredInvite.body.invitationPath.split("=")[1]})).status===400);
  const [[audited]]=await db.execute("SELECT COUNT(*) n FROM audit_logs WHERE action='ACCOUNT_STATUS_CHANGED' AND entity_type='CUSTOMER' AND entity_id=?",[id]);
  check("Both Admin status changes recorded in audit history",Number(audited.n)===2);
  await browserChecks(admin);
 }finally{await db.end();}
}
main().catch(e=>{if(!results.some(r=>!r.pass))results.push({name:e.code||e.message,pass:false});}).finally(()=>{const failures=results.filter(r=>!r.pass).map(r=>r.name);console.log(JSON.stringify({passed:results.length-failures.length,failed:failures.length,skipped:0,failures}));if(failures.length)process.exitCode=1;});
