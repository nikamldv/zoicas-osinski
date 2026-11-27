"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const BASE = "http://127.0.0.1:3001";
const TEST_DATABASE = "zoicas_osinski_test";
const results = [];

function check(name, pass, detail = "") { results.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`); }
function loadTestEnv() {
    const values = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.test"), "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#") && line.includes("=")).map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
    if (process.env.ENV_FILE !== ".env.test" || values.MYSQL_DATABASE !== TEST_DATABASE || values.PORT !== "3001") throw new Error("Refusing outside the isolated test environment.");
    return values;
}
function passwordHash(password) { return new Promise((resolve, reject) => { const salt = crypto.randomBytes(16); crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`)); }); }
async function request(route, { method = "GET", body, cookie, origin = BASE } = {}) {
    const headers = { Origin: origin }; if (cookie) headers.Cookie = cookie; if (body) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = {}; try { json = await response.json(); } catch {}
    return { status: response.status, json, cookie: String(response.headers.get("set-cookie") || "").split(";")[0] };
}

(async () => {
    const env = loadTestEnv();
    const db = await mysql.createConnection({ host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT), user: env.MYSQL_ADMIN_USER, password: env.MYSQL_ADMIN_PASSWORD, database: TEST_DATABASE });
    const stamp = Date.now(), password = "Phase1617DSynthetic!1", hash = await passwordHash(password);
    try {
        const [customer] = await db.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash,status) VALUES (?,?,?,?,?,?, 'ACTIVE')", [`TEST-P1617D-${stamp}`, "TEST", "Acceptance Customer", `p1617d.customer.${stamp}@example.test`, "+49123510001", hash]);
        const [employee] = await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)", [`TEST-P1617D-E-${stamp}`, "TEST", "Acceptance Employee", `p1617d.employee.${stamp}@example.test`, "+49123510002", hash, "Tester", "TEST DATA – Phase 16.17D"]);
        const [manager] = await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'MANAGER','ACTIVE',?,?)", [`TEST-P1617D-M-${stamp}`, "TEST", "Acceptance Manager", `p1617d.manager.${stamp}@example.test`, "+49123510003", hash, "Tester", "TEST DATA – Phase 16.17D"]);
        const [order] = await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,? ,?,'GEPLANT','NORMAL',?)", [`TEST-P1617D-${stamp}`, customer.insertId, "Reinigung", "TEST DATA – Phase 16.17D", "Synthetic acceptance test"]);
        const [assignment] = await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),'09:00','17:00','GEPLANT','TEST DATA – Phase 16.17D')", [order.insertId, employee.insertId]);

        const employeeLogin = await request("/api/employee/login", { method: "POST", body: { email: `p1617d.employee.${stamp}@example.test`, password } }); check("employee login", employeeLogin.status === 200, String(employeeLogin.status));
        const managerLogin = await request("/api/employee/login", { method: "POST", body: { email: `p1617d.manager.${stamp}@example.test`, password } }); check("manager login", managerLogin.status === 200, String(managerLogin.status));
        const customerLogin = await request("/api/customer/login", { method: "POST", body: { email: `p1617d.customer.${stamp}@example.test`, password } }); check("customer login", customerLogin.status === 200, String(customerLogin.status));
        const adminLogin = await request("/api/admin/login", { method: "POST", body: { username: env.ADMIN_USERNAME, password: env.PHASE168_TEST_ADMIN_PASSWORD } }); check("admin login", adminLogin.status === 200, String(adminLogin.status));

        check("anonymous map blocked", (await request("/api/admin/location-simulations")).status === 401);
        check("customer map blocked", (await request("/api/admin/location-simulations", { cookie: customerLogin.cookie })).status === 401);
        check("manager map blocked", (await request("/api/admin/location-simulations", { cookie: managerLogin.cookie })).status === 401);
        check("invalid employee session blocked", (await request("/api/employee/location-simulation", { cookie: "zo_employee_session=invalid-test-session" })).status === 401);
        check("foreign assignment blocked", [403, 404].includes((await request("/api/employee/attendance/check-in", { method: "POST", cookie: managerLogin.cookie, body: { assignment_id: assignment.insertId } })).status));
        check("same-origin required", (await request("/api/employee/attendance/check-in", { method: "POST", cookie: employeeLogin.cookie, origin: "https://invalid.example", body: { assignment_id: assignment.insertId } })).status === 403);

        const checkIn = await request("/api/employee/attendance/check-in", { method: "POST", cookie: employeeLogin.cookie, body: { assignment_id: assignment.insertId, check_in_note: "TEST DATA – Phase 16.17D" } }); check("check-in", checkIn.status === 201, String(checkIn.status));
        check("duplicate check-in blocked", (await request("/api/employee/attendance/check-in", { method: "POST", cookie: employeeLogin.cookie, body: { assignment_id: assignment.insertId } })).status === 409);
        const started = await request("/api/employee/location-simulation/start", { method: "POST", cookie: employeeLogin.cookie, body: {} }); check("simulation start", started.status === 201, String(started.status));
        const update = await request("/api/employee/location-simulation/update", { method: "POST", cookie: employeeLogin.cookie, body: { synthetic: true, latitude: 50.110924, longitude: 8.682127, accuracy_meters: 12 } }); check("synthetic update", update.status === 200, String(update.status));
        const map = await request("/api/admin/location-simulations", { cookie: adminLogin.cookie }); check("admin sees active simulation", map.status === 200 && map.json.rows.some(row => Number(row.employee_id) === Number(employee.insertId) && row.location_status === "ACTIVE"));

        // The first start and update consume two of the thirty accepted write requests.
        for (let index = 0; index < 28; index += 1) {
            const response = await request("/api/employee/location-simulation/update", { method: "POST", cookie: employeeLogin.cookie, body: { synthetic: true, latitude: 50.110924, longitude: 8.682127 } });
            check(`rate window accepted update ${index + 1}`, response.status === 200, String(response.status));
        }
        const limited = await request("/api/employee/location-simulation/update", { method: "POST", cookie: employeeLogin.cookie, body: { synthetic: true, latitude: 50.110924, longitude: 8.682127 } }); check("location update rate limit", limited.status === 429, String(limited.status));

        await db.execute("UPDATE employee_location_sharing_sessions SET started_at=DATE_SUB(NOW(), INTERVAL 31 MINUTE),expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id=?", [started.json.id]);
        const expired = await request("/api/employee/location-simulation", { cookie: employeeLogin.cookie }); check("expired sharing removed", expired.status === 200 && expired.json.sharing === null);
        const [[storedLocation]] = await db.execute("SELECT employee_id FROM employee_live_locations WHERE employee_id=?", [employee.insertId]); check("expired coordinates deleted", !storedLocation);
        const mapAfterExpiry = await request("/api/admin/location-simulations", { cookie: adminLogin.cookie }); check("admin no longer sees active location", mapAfterExpiry.status === 200 && !mapAfterExpiry.json.rows.some(row => Number(row.employee_id) === Number(employee.insertId) && row.location_status === "ACTIVE"));

        const checkOut = await request("/api/employee/attendance/check-out", { method: "POST", cookie: employeeLogin.cookie, body: { check_out_note: "TEST DATA – Phase 16.17D" } }); check("check-out", checkOut.status === 200, String(checkOut.status));
        check("duplicate check-out blocked", (await request("/api/employee/attendance/check-out", { method: "POST", cookie: employeeLogin.cookie, body: {} })).status === 409);
        const [[attendance]] = await db.execute("SELECT status,work_log_id FROM employee_attendance_sessions WHERE id=?", [checkIn.json.id]); check("attendance persisted", attendance && attendance.status !== "OPEN" && attendance.work_log_id);
        const [[workLog]] = await db.execute("SELECT employee_id,order_id FROM employee_work_logs WHERE id=?", [attendance.work_log_id]); check("work log relation", Number(workLog.employee_id) === Number(employee.insertId) && Number(workLog.order_id) === Number(order.insertId));
        const [auditRows] = await db.execute("SELECT metadata FROM audit_logs WHERE entity_type='LOCATION_SHARING_SESSION' AND entity_id=?", [started.json.id]); check("audit has no coordinates", auditRows.length > 0 && auditRows.every(row => !/latitude|longitude|50\.110924|8\.682127/i.test(String(row.metadata || ""))));
        check("health", (await request("/api/health")).status === 200);
    } finally { await db.end(); }
    console.log(JSON.stringify({ ok: true, executed: results.length, passed: results.filter(result => result.pass).length }, null, 2));
})().catch(error => { console.log(JSON.stringify({ ok: false, executed: results.length, passed: results.filter(result => result.pass).length, error: error.message }, null, 2)); process.exit(1); });
