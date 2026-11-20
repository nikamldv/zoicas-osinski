"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = ".env.test";
const BASE = "http://127.0.0.1:3001";
const DATABASE = "zoicas_osinski_test";
const results = [];

function loadTestEnv() {
    if (process.env.ENV_FILE !== ENV_FILE) throw new Error("Refusing to run outside .env.test.");
    const file = path.join(ROOT, ENV_FILE);
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const at = line.indexOf("=");
        if (at > 0) process.env[line.slice(0, at)] = line.slice(at + 1);
    }
    if (process.env.MYSQL_DATABASE !== DATABASE || process.env.PORT !== "3001") throw new Error("Refusing to use a non-isolated database or server.");
}

function check(name, pass) {
    results.push({ name, pass: Boolean(pass) });
    if (!pass) throw new Error(name);
}

function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`));
    });
}

async function request(route, { method = "GET", body, cookie, origin = BASE } = {}) {
    const headers = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json, cookie: String(response.headers.get("set-cookie") || "").split(";")[0] };
}

async function main() {
    loadTestEnv();
    const health = await fetch(`${BASE}/api/health`).then(response => response.json());
    check("isolated health", health.status === "ok" && health.database === "connected");
    const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_ADMIN_USER, password: process.env.MYSQL_ADMIN_PASSWORD, database: DATABASE });
    const stamp = Date.now();
    try {
        const [[identity]] = await db.execute("SELECT DATABASE() AS database_name");
        check("isolated database", identity.database_name === DATABASE);
        const [[customerA]] = await db.execute("SELECT id FROM customers WHERE email=? AND status='active'", ["quality.customer@example.test"]);
        check("existing synthetic customer", Boolean(customerA));
        const passwordB = `P1611-${crypto.randomBytes(18).toString("base64url")}Aa1`;
        const [customerB] = await db.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash,status,address,postal_code,city) VALUES (?,?,?,?,?,?, 'active',?,?,?)", [`TEST-P1611-B-${stamp}`, "TEST DATA", "Customer B", `p1611.b.${stamp}@example.test`, "+49100000161", await hashPassword(passwordB), "Teststraße 161", "00161", "Teststadt"]);
        const [employee] = await db.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)", [`TEST-P1611-E-${stamp}`, "TEST DATA", "Employee", `p1611.e.${stamp}@example.test`, "+49100000162", await hashPassword(`P1611-${stamp}Aa1!`), "Test", "TEST DATA – Phase 16.11A"]);

        let nextSlotHour = 11;
        async function createReport(customerId, tag, status) {
            const startHour = String(nextSlotHour++).padStart(2, "0");
            const endHour = String(nextSlotHour).padStart(2, "0");
            const [order] = await db.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,? ,?,'GEPLANT','NORMAL',?)", [`TEST-P1611-O-${tag}-${stamp}`, customerId, "Reinigungsservice", "TEST DATA – Phase 16.11A", "TEST DATA – Phase 16.11A"]);
            const [assignment] = await db.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),?,?,'GEPLANT',?)", [order.insertId, employee.insertId, `${startHour}:00`, `${endHour}:00`, "TEST DATA – Phase 16.11A"]);
            const [report] = await db.execute("INSERT INTO service_reports (report_number,order_id,assignment_id,customer_id,employee_id,service_date,started_at,finished_at,summary,internal_notes,customer_notes,status,shared_with_customer_at) VALUES (?,?,?,?,?,CURDATE(),CONCAT(CURDATE(),' ',?,':00'),CONCAT(CURDATE(),' ',?,':00'),?,?,?,?,?)", [`TEST-P1611-${tag}-${stamp}`, order.insertId, assignment.insertId, customerId, employee.insertId, `${startHour}:00`, `${endHour}:00`, "TEST DATA – customer-visible service report", "PRIVATE INTERNAL NOTE", "Hinweis für den Kunden", status, status === "SHARED" ? new Date() : null]);
            return report.insertId;
        }

        const browserReportId = await createReport(customerA.id, "BROWSER", "SHARED");
        const confirmReportId = await createReport(customerA.id, "CONFIRM", "SHARED");
        const hiddenReportId = await createReport(customerA.id, "HIDDEN", "DRAFT");
        const foreignReportId = await createReport(customerB.insertId, "FOREIGN", "SHARED");
        check("synthetic reports created", Boolean(browserReportId && confirmReportId && hiddenReportId && foreignReportId));

        const noLogin = await request("/api/customer/service-reports");
        check("unauthenticated blocked", noLogin.status === 401);
        const customerALogin = await request("/api/customer/login", { method: "POST", body: { email: "quality.customer@example.test", password: process.env.PHASE168_TEST_CUSTOMER_PASSWORD } });
        const customerBLogin = await request("/api/customer/login", { method: "POST", body: { email: `p1611.b.${stamp}@example.test`, password: passwordB } });
        check("customer A login", customerALogin.status === 200 && customerALogin.cookie.startsWith("zo_customer_session="));
        check("customer B login", customerBLogin.status === 200 && customerBLogin.cookie.startsWith("zo_customer_session="));

        const list = await request("/api/customer/service-reports", { cookie: customerALogin.cookie });
        check("shared list accessible", list.status === 200 && list.json.rows.some(row => row.id === browserReportId) && list.json.rows.some(row => row.id === confirmReportId));
        check("unshared report hidden", !list.json.rows.some(row => row.id === hiddenReportId));
        check("foreign report hidden", !list.json.rows.some(row => row.id === foreignReportId));
        const detail = await request(`/api/customer/service-reports/${confirmReportId}`, { cookie: customerALogin.cookie });
        check("shared detail accessible", detail.status === 200 && detail.json.report.id === confirmReportId);
        check("internal notes hidden", !Object.prototype.hasOwnProperty.call(detail.json.report, "internal_notes"));
        check("foreign detail blocked", (await request(`/api/customer/service-reports/${confirmReportId}`, { cookie: customerBLogin.cookie })).status === 404);
        check("unshared detail blocked", (await request(`/api/customer/service-reports/${hiddenReportId}`, { cookie: customerALogin.cookie })).status === 404);
        check("same-origin enforced", (await request(`/api/customer/service-reports/${confirmReportId}/confirm`, { method: "POST", cookie: customerALogin.cookie, body: {}, origin: "https://invalid.example" })).status === 403);
        const confirmation = await request(`/api/customer/service-reports/${confirmReportId}/confirm`, { method: "POST", cookie: customerALogin.cookie, body: {} });
        check("confirmation succeeds", confirmation.status === 200 && confirmation.json.status === "CUSTOMER_CONFIRMED");
        const [[confirmed]] = await db.execute("SELECT status,customer_confirmed_at FROM service_reports WHERE id=?", [confirmReportId]);
        check("confirmation persisted", confirmed.status === "CUSTOMER_CONFIRMED" && Boolean(confirmed.customer_confirmed_at));
        check("duplicate confirmation blocked", (await request(`/api/customer/service-reports/${confirmReportId}/confirm`, { method: "POST", cookie: customerALogin.cookie, body: {} })).status === 400);
        const [[audit]] = await db.execute("SELECT id FROM audit_logs WHERE action='SERVICE_REPORT_CUSTOMER_CONFIRMED' AND entity_type='SERVICE_REPORT' AND entity_id=?", [confirmReportId]);
        check("confirmation audit", Boolean(audit));
        console.log(JSON.stringify({ ok: true, executed: results.length, passed: results.filter(result => result.pass).length, browserReportId }, null, 2));
    } finally {
        await db.end();
    }
}

main().catch(error => {
    console.log(JSON.stringify({ ok: false, executed: results.length, passed: results.filter(result => result.pass).length, failed: error.message }, null, 2));
    process.exit(1);
});
