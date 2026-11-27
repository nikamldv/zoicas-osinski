"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const TEST_ENV = path.join(ROOT, ".env.test");
const MIGRATION = path.join(ROOT, "database", "migrations", "018_live_location_simulation.sql");
const TEST_DATABASE = "zoicas_osinski_test";
const BASE = "http://127.0.0.1:3001";
const results = [];

function readEnv(file) {
    return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#") && line.includes("=")).map(line => { const index=line.indexOf("="); return [line.slice(0,index),line.slice(index+1)]; }));
}
Object.assign(process.env, readEnv(TEST_ENV));
function check(name, pass, detail = "") { results.push({ name, pass, detail }); if (!pass) throw new Error(`${name}: ${detail}`); }
function isolatedConfig() {
    const env=readEnv(TEST_ENV);
    check("test env database", env.MYSQL_DATABASE===TEST_DATABASE, "wrong database");
    check("test env port", Number(env.PORT)===3001, "wrong port");
    check("runtime env database", process.env.MYSQL_DATABASE===TEST_DATABASE, "wrong runtime database");
    check("runtime env port", Number(process.env.PORT)===3001, "wrong runtime port");
    return env;
}
function scrypt(password) { return new Promise((resolve,reject)=>{ const salt=crypto.randomBytes(16); crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`)); }); }
async function request(route,{method="GET",body,cookie,origin=BASE}={}) { const headers={ Origin:origin }; if(cookie)headers.Cookie=cookie; if(body)headers["Content-Type"]="application/json"; const response=await fetch(BASE+route,{method,headers,body:body?JSON.stringify(body):undefined}); let json={}; try{json=await response.json();}catch{} return { status:response.status,json,cookie:String(response.headers.get("set-cookie")||"").split(";")[0] }; }

(async()=>{
    const env=isolatedConfig();
    const migrationUser=process.env.PHASE1617B_TEST_MIGRATION_ADMIN_USER;
    const migrationPassword=process.env.PHASE1617B_TEST_MIGRATION_ADMIN_PASSWORD;
    if(!migrationUser || !migrationPassword) throw new Error("Refusing to run: explicit isolated migration administrator credentials are required.");
    const adminDb=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),user:migrationUser,password:migrationPassword,database:TEST_DATABASE,multipleStatements:true});
    try {
        const sql=fs.readFileSync(MIGRATION,"utf8");
        check("migration has no USE", !/^\s*USE\s+/im.test(sql), "unsafe database selector");
        check("migration does not mention production", !/zoicas_osinski(?!_test)/i.test(sql), "unsafe database reference");
        await adminDb.query(sql);
        const [tables]=await adminDb.query("SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema=? AND table_name IN ('employee_location_sharing_sessions','employee_live_locations')",[TEST_DATABASE]);
        check("location tables exist", tables.length===2, String(tables.length));
        const [columns]=await adminDb.query("SELECT table_name AS table_name,column_name AS column_name FROM information_schema.columns WHERE table_schema=? AND table_name IN ('employee_location_sharing_sessions','employee_live_locations')",[TEST_DATABASE]);
        const names=new Set(columns.map(row=>`${row.table_name}.${row.column_name}`));
        ["employee_location_sharing_sessions.attendance_session_id","employee_location_sharing_sessions.active_employee_id","employee_live_locations.latitude","employee_live_locations.longitude","employee_live_locations.is_synthetic"].forEach(name=>check(`column ${name}`,names.has(name),"missing"));
        const [foreignKeys]=await adminDb.query("SELECT constraint_name FROM information_schema.referential_constraints WHERE constraint_schema=? AND table_name IN ('employee_location_sharing_sessions','employee_live_locations')",[TEST_DATABASE]);
        check("location foreign keys", foreignKeys.length>=6, String(foreignKeys.length));
    } finally { await adminDb.end(); }

    const db=await mysql.createConnection({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT),user:env.MYSQL_ADMIN_USER,password:env.MYSQL_ADMIN_PASSWORD,database:TEST_DATABASE});
    const stamp=Date.now(), employeePassword="Phase1617BEmployee!1", hash=await scrypt(employeePassword);
    const employeeEmail=`p1617b.a.${stamp}@example.test`, otherEmail=`p1617b.b.${stamp}@example.test`;
    const [a]=await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)",[`TEST-P1617B-A-${stamp}`,"TEST","Location A",employeeEmail,"+49123456001",hash,"Tester","TEST DATA – Phase 16.17B"]);
    const [b]=await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)",[`TEST-P1617B-B-${stamp}`,"TEST","Location B",otherEmail,"+49123456002",hash,"Tester","TEST DATA – Phase 16.17B"]);
    const [customer]=await db.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash,status) VALUES (?,?,?,?,?,?, 'ACTIVE')",[`TEST-P1617B-${stamp}`,"TEST","Location Customer",`p1617b.customer.${stamp}@example.test`,"+49123456003",hash]);
    const [order]=await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,? ,?,'GEPLANT','NORMAL',?)",[`TEST-P1617B-${stamp}`,customer.insertId,"Reinigung","TEST DATA – Phase 16.17B Auftrag","TEST DATA – Phase 16.17B"]);
    const [assignment]=await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),'09:00','17:00','GEPLANT','TEST DATA – Phase 16.17B')",[order.insertId,a.insertId]);
    const adminLogin=await request("/api/admin/login",{method:"POST",body:{username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD}}); check("admin login",adminLogin.status===200,String(adminLogin.status));
    const employeeLogin=await request("/api/employee/login",{method:"POST",body:{email:employeeEmail,password:employeePassword}}); check("employee A login",employeeLogin.status===200,String(employeeLogin.status));
    const otherLogin=await request("/api/employee/login",{method:"POST",body:{email:otherEmail,password:employeePassword}}); check("employee B login",otherLogin.status===200,String(otherLogin.status));
    const customerLogin=await request("/api/customer/login",{method:"POST",body:{email:`p1617b.customer.${stamp}@example.test`,password:employeePassword}}); check("customer login",customerLogin.status===200,String(customerLogin.status));
    check("location unauthenticated",(await request("/api/employee/location-simulation")).status===401,"expected 401");
    check("location customer forbidden",(await request("/api/employee/location-simulation",{cookie:customerLogin.cookie})).status===401,"expected 401");
    check("admin location employee forbidden",(await request("/api/admin/location-simulations",{cookie:employeeLogin.cookie})).status===401,"expected 401");
    const checkin=await request("/api/employee/attendance/check-in",{method:"POST",cookie:employeeLogin.cookie,body:{assignment_id:assignment.insertId,check_in_note:"TEST DATA – Phase 16.17B"}}); check("attendance check-in",checkin.status===201,String(checkin.status));
    const started=await request("/api/employee/location-simulation/start",{method:"POST",cookie:employeeLogin.cookie,body:{}}); check("simulation start",started.status===201,String(started.status));
    const duplicateStart=await request("/api/employee/location-simulation/start",{method:"POST",cookie:employeeLogin.cookie,body:{}}); check("duplicate start prevention",duplicateStart.status===409,String(duplicateStart.status));
    const sameOrigin=await request("/api/employee/location-simulation/update",{method:"POST",cookie:employeeLogin.cookie,origin:"https://invalid.example",body:{synthetic:true,latitude:50,longitude:8}}); check("same origin protection",sameOrigin.status===403,String(sameOrigin.status));
    const invalidCoords=await request("/api/employee/location-simulation/update",{method:"POST",cookie:employeeLogin.cookie,body:{synthetic:true,latitude:100,longitude:8}}); check("invalid coordinates",invalidCoords.status===400,String(invalidCoords.status));
    const update=await request("/api/employee/location-simulation/update",{method:"POST",cookie:employeeLogin.cookie,body:{synthetic:true,latitude:50.110924,longitude:8.682127,accuracy_meters:12}}); check("synthetic update",update.status===200,String(update.status));
    const ownStatus=await request("/api/employee/location-simulation",{cookie:employeeLogin.cookie}); check("employee status",ownStatus.status===200 && ownStatus.json.sharing?.status==="ACTIVE" && !Object.hasOwn(ownStatus.json.sharing,"latitude"),"status or coordinate leak");
    const otherUpdate=await request("/api/employee/location-simulation/update",{method:"POST",cookie:otherLogin.cookie,body:{synthetic:true,latitude:50,longitude:8,employee_id:a.insertId}}); check("employee ownership",otherUpdate.status===409,String(otherUpdate.status));
    const adminOverview=await request("/api/admin/location-simulations",{cookie:adminLogin.cookie}); check("admin overview",adminOverview.status===200 && adminOverview.json.rows?.some(row=>Number(row.employee_id)===a.insertId && Number(row.latitude)===50.110924),"missing synthetic location");
    await db.execute("UPDATE employee_location_sharing_sessions SET started_at=DATE_SUB(NOW(), INTERVAL 31 MINUTE),expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id=?",[started.json.id]);
    const expired=await request("/api/employee/location-simulation",{cookie:employeeLogin.cookie}); check("automatic expiry",expired.status===200 && expired.json.sharing===null,"session still active");
    const [[locationAfterExpiry]]=await db.execute("SELECT employee_id FROM employee_live_locations WHERE employee_id=?",[a.insertId]); check("expiry deletes current coordinates",!locationAfterExpiry,"coordinates remain");
    const restart=await request("/api/employee/location-simulation/start",{method:"POST",cookie:employeeLogin.cookie,body:{}}); check("start after expiry",restart.status===201,String(restart.status));
    const stopped=await request("/api/employee/location-simulation/stop",{method:"POST",cookie:employeeLogin.cookie,body:{}}); check("simulation stop",stopped.status===200,String(stopped.status));
    const [[attendance]]=await db.execute("SELECT status FROM employee_attendance_sessions WHERE id=?",[checkin.json.id]); check("attendance independence",attendance.status==="OPEN",attendance.status);
    const [[coordinatesAfterStop]]=await db.execute("SELECT employee_id FROM employee_live_locations WHERE employee_id=?",[a.insertId]); check("stop deletes current coordinates",!coordinatesAfterStop,"coordinates remain");
    const [[audit]]=await db.execute("SELECT metadata FROM audit_logs WHERE entity_type='LOCATION_SHARING_SESSION' AND entity_id=? ORDER BY id DESC LIMIT 1",[stopped.json.id]); check("audit omits coordinates",audit && !/latitude|longitude|50\.110924|8\.682127/i.test(String(audit.metadata||"")),"coordinate metadata");
    const checkout=await request("/api/employee/attendance/check-out",{method:"POST",cookie:employeeLogin.cookie,body:{check_out_note:"TEST DATA – Phase 16.17B"}}); check("attendance check-out",checkout.status===200,String(checkout.status));
    const health=await request("/api/health"); check("health",health.status===200 && health.json.database==="connected",String(health.status));
    await db.end();
    console.log(JSON.stringify({ok:true,database:TEST_DATABASE,executed:results.length,passed:results.filter(result=>result.pass).length},null,2));
})().catch(error=>{ console.error(JSON.stringify({ok:false,error:error.message,executed:results.length,passed:results.filter(result=>result.pass).length,results},null,2)); process.exit(1); });
