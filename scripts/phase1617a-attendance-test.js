"use strict";

// Isolated Phase 16.17A integration test. It refuses every non-test database.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const TEST_ENV = path.join(ROOT, ".env.test");
const TEST_DATABASE = "zoicas_osinski_test";
const BASE = "http://127.0.0.1:3001";
const results = [];

function readEnv(file) {
    const values = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const index = line.indexOf("=");
        if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
    }
    return values;
}
function check(name, pass, detail = "") { results.push({ name, pass }); if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`); }
async function request(route, { method = "GET", body, cookie, origin = BASE } = {}) {
    const headers = { Origin: origin }; if (cookie) headers.Cookie = cookie; if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json, cookie: String(response.headers.get("set-cookie") || "").split(";")[0] };
}

async function main() {
    check("test env exists", fs.existsSync(TEST_ENV));
    check("explicit test environment", process.env.ENV_FILE === ".env.test");
    const test = readEnv(TEST_ENV);
    check("test database configuration", test.MYSQL_DATABASE === TEST_DATABASE);
    check("test port configuration", test.PORT === "3001");
    check("test host configuration", test.MYSQL_HOST === "127.0.0.1");
    const health = await fetch(BASE + "/api/health").then(response => response.json());
    check("test server health", health.status === "ok" && health.database === "connected");

    const db = await mysql.createConnection({ host: test.MYSQL_HOST, port: Number(test.MYSQL_PORT || 3306), user: test.MYSQL_USER, password: test.MYSQL_PASSWORD, database: TEST_DATABASE });
    try {
        const [[identity]] = await db.execute("SELECT DATABASE() AS database_name");
        check("application test database target", identity.database_name === TEST_DATABASE);
        // Validate the installed schema without DDL or migration credentials.
        const [columns] = await db.execute("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=? AND table_name='employee_attendance_sessions'", [TEST_DATABASE]);
        const names = new Set(columns.map(row => row.name));
        for (const name of ["employee_id","order_id","assignment_id","work_log_id","check_in_at","check_out_at","status","review_required"]) check(`required column ${name}`, names.has(name));
        check("no GPS columns", ![...names].some(name => /^(latitude|longitude|location|gps|accuracy)/i.test(name)));
        const [fks] = await db.execute("SELECT referenced_table_name AS name FROM information_schema.key_column_usage WHERE table_schema=? AND table_name='employee_attendance_sessions' AND referenced_table_name IS NOT NULL", [TEST_DATABASE]);
        for (const tableName of ["employees","orders","order_assignments","employee_work_logs"]) check(`foreign key ${tableName}`, fks.some(row => row.name === tableName));
        const [indexes] = await db.execute("SHOW INDEX FROM employee_attendance_sessions");
        check("open attendance unique index", indexes.some(row => row.Key_name === "uq_attendance_open_employee" && Number(row.Non_unique) === 0));

        const [[fixture]] = await db.execute("SELECT c.id customer_id,e.id employee_a_id,(SELECT id FROM employees WHERE employee_number='TEST-MA-000002') employee_b_id FROM customers c JOIN employees e ON e.employee_number='TEST-MA-000001' WHERE c.customer_number='TEST-KU-000001' LIMIT 1");
        check("synthetic base fixture", Boolean(fixture?.employee_a_id && fixture?.employee_b_id));
        const stamp = Date.now(), seconds = stamp % (20 * 60 * 60), clock = value => new Date(value * 1000).toISOString().slice(11,19), startTime = clock(seconds), endTime = clock(seconds + 60 * 60);
        const [order] = await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,?,?, 'GEPLANT','NORMAL',?)", [`TEST-P1617-ORDER-${stamp}`, fixture.customer_id, "Reinigungsservice", "TEST DATA – Phase 16.17A Attendance", "Synthetic isolated attendance test record"]);
        const [assignment] = await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),?,?, 'GEPLANT',?)", [order.insertId, fixture.employee_a_id, startTime, endTime, "TEST DATA – Phase 16.17A"]);

        const adminLogin = await request("/api/admin/login", { method:"POST", body:{ username:test.ADMIN_USERNAME, password:test.PHASE168_TEST_ADMIN_PASSWORD } });
        const employeeALogin = await request("/api/employee/login", { method:"POST", body:{ email:"quality.employee.a@example.test", password:test.PHASE168_TEST_EMPLOYEE_PASSWORD } });
        const employeeBLogin = await request("/api/employee/login", { method:"POST", body:{ email:"quality.employee.b@example.test", password:test.PHASE168_TEST_EMPLOYEE_PASSWORD } });
        const customerLogin = await request("/api/customer/login", { method:"POST", body:{ email:"quality.customer@example.test", password:test.PHASE168_TEST_CUSTOMER_PASSWORD } });
        check("admin session", adminLogin.status === 200 && adminLogin.cookie.startsWith("zo_admin_session="));
        check("employee A session", employeeALogin.status === 200 && employeeALogin.cookie.startsWith("zo_employee_session="));
        check("employee B session", employeeBLogin.status === 200 && employeeBLogin.cookie.startsWith("zo_employee_session="));
        check("customer session", customerLogin.status === 200 && customerLogin.cookie.startsWith("zo_customer_session="));
        const admin = adminLogin.cookie, employeeA = employeeALogin.cookie, employeeB = employeeBLogin.cookie, customer = customerLogin.cookie;
        const priorAttendance = await request("/api/employee/attendance", { cookie: employeeA });
        if (priorAttendance.json?.current?.order_number?.startsWith("TEST-P1617")) await request("/api/employee/attendance/check-out", { method:"POST", cookie:employeeA, body:{ check_out_note:"TEST DATA – cleanup before isolated verification" } });
        check("unauthenticated attendance rejected", (await request("/api/employee/attendance")).status === 401);
        check("employee cannot access admin attendance", (await request("/api/admin/attendance", { cookie:employeeA })).status === 401);
        check("customer cannot access employee attendance", (await request("/api/employee/attendance", { cookie:customer })).status === 401);
        const before = await request("/api/employee/attendance", { cookie:employeeA });
        check("employee own assignment list", before.status === 200 && before.json.assignments.some(row => Number(row.assignment_id) === Number(assignment.insertId)) && !before.json.assignments.some(row => Number(row.employee_id) === Number(fixture.employee_b_id)));
        check("cross employee check-in blocked", (await request("/api/employee/attendance/check-in", { method:"POST", cookie:employeeB, body:{ assignment_id:assignment.insertId } })).status === 404);
        check("same-origin check-in required", (await request("/api/employee/attendance/check-in", { method:"POST", cookie:employeeA, origin:"https://invalid.example", body:{ assignment_id:assignment.insertId } })).status === 403);
        const checkIn = await request("/api/employee/attendance/check-in", { method:"POST", cookie:employeeA, body:{ assignment_id:assignment.insertId, check_in_note:"TEST DATA – manual confirmation" } });
        check("check-in", checkIn.status === 201 && checkIn.json.status === "OPEN", String(checkIn.status));
        check("duplicate check-in prevented", (await request("/api/employee/attendance/check-in", { method:"POST", cookie:employeeA, body:{ assignment_id:assignment.insertId } })).status === 409);
        const active = await request("/api/employee/attendance", { cookie:employeeA });
        check("active attendance visible only to owner", active.status === 200 && Number(active.json.current?.id) === Number(checkIn.json.id));
        const adminList = await request("/api/admin/attendance?status=OPEN&page=1&page_size=25", { cookie:admin });
        check("admin overview", adminList.status === 200 && adminList.json.rows.some(row => Number(row.id) === Number(checkIn.json.id)));
        check("invalid admin filter", (await request("/api/admin/attendance?status=INVALID", { cookie:admin })).status === 400);
        check("admin SQL injection safe", (await request("/api/admin/attendance?status=OPEN%27%20OR%201=1--", { cookie:admin })).status === 400);
        const checkOut = await request("/api/employee/attendance/check-out", { method:"POST", cookie:employeeA, body:{ check_out_note:"TEST DATA – checkout" } });
        check("check-out", checkOut.status === 200 && ["CLOSED","REVIEW_REQUIRED"].includes(checkOut.json.status), String(checkOut.status));
        check("duplicate check-out prevented", (await request("/api/employee/attendance/check-out", { method:"POST", cookie:employeeA, body:{} })).status === 409);
        const [[persisted]] = await db.execute("SELECT status,work_log_id,check_in_at,check_out_at FROM employee_attendance_sessions WHERE id=?", [checkIn.json.id]);
        check("attendance persistence", Boolean(persisted?.check_in_at && persisted?.check_out_at) && persisted.status !== "OPEN");
        if (persisted.work_log_id) { const [[workLog]] = await db.execute("SELECT employee_id,order_id FROM employee_work_logs WHERE id=?", [persisted.work_log_id]); check("work log compatibility", Number(workLog.employee_id) === Number(fixture.employee_a_id) && Number(workLog.order_id) === Number(order.insertId)); }
        const [audits] = await db.execute("SELECT action,metadata FROM audit_logs WHERE entity_type='ATTENDANCE_SESSION' AND entity_id=? ORDER BY id", [checkIn.json.id]);
        check("attendance audit events", audits.some(row => row.action === "ATTENDANCE_CHECKED_IN") && audits.some(row => row.action === "ATTENDANCE_CHECKED_OUT"));
        check("audit stores no GPS", audits.every(row => !/(latitude|longitude|gps|accuracy)/i.test(String(row.metadata || ""))));
        const regressions = ["/api/employee/work-logs", "/api/employee/orders", "/api/admin/orders", "/api/admin/service-reports", "/api/admin/action-center", "/api/admin/reports/dashboard?period=month"];
        for (const route of regressions) check(`regression ${route}`, (await request(route, { cookie: route.startsWith("/api/admin") ? admin : employeeA })).status === 200);
        console.log(JSON.stringify({ ok:true, database:TEST_DATABASE, executed:results.length, passed:results.filter(item=>item.pass).length }, null, 2));
    } finally { await db.end(); }
}

main().catch(error => { console.error(JSON.stringify({ ok:false, executed:results.length, passed:results.filter(item=>item.pass).length, error:error.message }, null, 2)); process.exit(1); });
