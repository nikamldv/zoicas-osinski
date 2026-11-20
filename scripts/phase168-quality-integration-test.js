"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const TEST_ENV = path.join(ROOT, ".env.test");
const BASE = "http://127.0.0.1:3001";
const TEST_DATABASE = "zoicas_osinski_test";
const results = [];

function loadEnv(file) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const index = line.indexOf("=");
        if (index > 0 && !process.env[line.slice(0, index)]) process.env[line.slice(0, index)] = line.slice(index + 1);
    }
}

function check(name, pass, detail = "") {
    results.push({ name, pass, detail });
    if (!pass) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

async function request(route, { method = "GET", body, cookie, origin = BASE } = {}) {
    const headers = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* binary/body-less response is not expected here */ }
    return { status: response.status, json, cookie: String(response.headers.get("set-cookie") || "").split(";")[0] };
}

function incidentPayload(ids, suffix, overrides = {}) {
    return {
        customer_id: ids.customer_id,
        order_id: ids.order_id,
        assignment_id: ids.assignment_id,
        service_report_id: ids.service_report_id,
        assigned_employee_id: ids.employee_a_id,
        category: "TEST",
        severity: "NORMAL",
        title: `TEST DATA – Phase 16.8B ${suffix}`,
        description: "Synthetic isolated integration test incident.",
        internal_notes: "Admin-only synthetic test note.",
        root_cause: "Synthetic test root cause.",
        due_date: "2026-12-15",
        ...overrides
    };
}

function actionPayload(ids, suffix, status = "OPEN") {
    return {
        assigned_employee_id: ids.employee_a_id,
        title: `TEST DATA – corrective action ${suffix}`,
        description: "Synthetic isolated corrective action.",
        due_date: "2026-12-15",
        status
    };
}

async function main() {
    check("test env file", fs.existsSync(TEST_ENV));
    loadEnv(TEST_ENV);
    check("approved test database name", process.env.MYSQL_DATABASE === TEST_DATABASE);
    check("approved test port", process.env.PORT === "3001");
    const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
    try {
        const [[identity]] = await db.execute("SELECT DATABASE() AS database_name");
        check("actual MySQL target", identity.database_name === TEST_DATABASE, identity.database_name || "none");
        const [[fixture]] = await db.execute("SELECT c.id customer_id,o.id order_id,a.id assignment_id,r.id service_report_id,e.id employee_a_id,(SELECT id FROM employees WHERE employee_number='TEST-MA-000002') employee_b_id FROM customers c JOIN orders o ON o.customer_id=c.id JOIN order_assignments a ON a.order_id=o.id JOIN service_reports r ON r.assignment_id=a.id JOIN employees e ON e.id=a.employee_id WHERE c.customer_number='TEST-KU-000001' AND e.employee_number='TEST-MA-000001' LIMIT 1");
        check("synthetic fixture", Boolean(fixture && fixture.employee_b_id));

        const testHealth = await fetch(`${BASE}/api/health`).then(response => response.json());
        check("test health", testHealth.status === "ok" && testHealth.database === "connected");
        // This suite is intentionally isolated. Do not contact the production listener.
        check("isolated API base", BASE === "http://127.0.0.1:3001");

        const adminLogin = await request("/api/admin/login", { method: "POST", body: { username: process.env.ADMIN_USERNAME, password: process.env.PHASE168_TEST_ADMIN_PASSWORD } });
        check("admin login", adminLogin.status === 200 && adminLogin.cookie.startsWith("zo_admin_session="), String(adminLogin.status));
        const employeeALogin = await request("/api/employee/login", { method: "POST", body: { email: "quality.employee.a@example.test", password: process.env.PHASE168_TEST_EMPLOYEE_PASSWORD } });
        check("employee A login", employeeALogin.status === 200 && employeeALogin.cookie.startsWith("zo_employee_session="), String(employeeALogin.status));
        const employeeBLogin = await request("/api/employee/login", { method: "POST", body: { email: "quality.employee.b@example.test", password: process.env.PHASE168_TEST_EMPLOYEE_PASSWORD } });
        check("employee B login", employeeBLogin.status === 200 && employeeBLogin.cookie.startsWith("zo_employee_session="), String(employeeBLogin.status));
        const customerLogin = await request("/api/customer/login", { method: "POST", body: { email: "quality.customer@example.test", password: process.env.PHASE168_TEST_CUSTOMER_PASSWORD } });
        check("customer login", customerLogin.status === 200 && customerLogin.cookie.startsWith("zo_customer_session="), String(customerLogin.status));
        const admin = adminLogin.cookie, employeeA = employeeALogin.cookie, employeeB = employeeBLogin.cookie, customer = customerLogin.cookie;

        check("unauthenticated admin route", (await request("/api/admin/quality-incidents")).status === 401);
        check("employee blocked from admin route", (await request("/api/admin/quality-incidents", { cookie: employeeA })).status === 401);
        check("customer blocked from admin route", (await request("/api/admin/quality-incidents", { cookie: customer })).status === 401);
        check("admin list", (await request("/api/admin/quality-incidents?page=1&page_size=10", { cookie: admin })).status === 200);
        check("invalid pagination", (await request("/api/admin/quality-incidents?page=1&page_size=101", { cookie: admin })).status === 400);
        check("invalid filter", (await request("/api/admin/quality-incidents?status=INVALID", { cookie: admin })).status === 400);
        const injection = await request("/api/admin/quality-incidents?search=%27%20OR%201%3D1--", { cookie: admin });
        check("SQL injection filter safety", injection.status === 200 && Array.isArray(injection.json?.rows));
        check("invalid incident detail", (await request("/api/admin/quality-incidents/999999999", { cookie: admin })).status === 404);
        check("same-origin protection", (await request("/api/admin/quality-incidents", { method: "POST", cookie: admin, origin: "https://invalid.example", body: incidentPayload(fixture, "origin") })).status === 403);
        check("relationship validation", (await request("/api/admin/quality-incidents", { method: "POST", cookie: admin, body: incidentPayload(fixture, "relation", { order_id: 999999999 }) })).status === 400);

        const stamp = Date.now();
        const create = await request("/api/admin/quality-incidents", { method: "POST", cookie: admin, body: incidentPayload(fixture, stamp) });
        check("incident create", create.status === 201 && Number.isInteger(create.json?.id), String(create.status));
        const incidentId = create.json.id;
        let detail = await request(`/api/admin/quality-incidents/${incidentId}`, { cookie: admin });
        check("incident detail and persistence", detail.status === 200 && detail.json?.incident?.status === "OPEN" && detail.json.incident.internal_notes === "Admin-only synthetic test note.");
        const listByCustomer = await request(`/api/admin/quality-incidents?customer_id=${fixture.customer_id}&employee_id=${fixture.employee_a_id}&order_id=${fixture.order_id}&status=OPEN&page=1&page_size=1`, { cookie: admin });
        check("pagination and combined filters", listByCustomer.status === 200 && listByCustomer.json.total >= 1 && listByCustomer.json.rows.length === 1);

        let payload = incidentPayload(fixture, stamp, { status: "IN_REVIEW" });
        check("incident OPEN to IN_REVIEW", (await request(`/api/admin/quality-incidents/${incidentId}`, { method: "PATCH", cookie: admin, body: payload })).status === 200);
        payload = incidentPayload(fixture, stamp, { status: "IN_PROGRESS" });
        check("incident IN_REVIEW to IN_PROGRESS", (await request(`/api/admin/quality-incidents/${incidentId}`, { method: "PATCH", cookie: admin, body: payload })).status === 200);
        check("invalid incident transition", (await request(`/api/admin/quality-incidents/${incidentId}`, { method: "PATCH", cookie: admin, body: incidentPayload(fixture, stamp, { status: "INVALID" }) })).status === 400);

        const createdAction = await request(`/api/admin/quality-incidents/${incidentId}/actions`, { method: "POST", cookie: admin, body: actionPayload(fixture, stamp) });
        check("corrective action create", createdAction.status === 201 && Number.isInteger(createdAction.json?.id), String(createdAction.status));
        const actionId = createdAction.json.id;
        check("resolve blocked by incomplete action", (await request(`/api/admin/quality-incidents/${incidentId}/resolve`, { method: "POST", cookie: admin, body: {} })).status === 409);
        const ownAction = await request(`/api/employee/quality-actions/${actionId}`, { cookie: employeeA });
        check("employee A action detail", ownAction.status === 200 && !Object.prototype.hasOwnProperty.call(ownAction.json?.action || {}, "internal_notes"));
        check("employee B IDOR detail", (await request(`/api/employee/quality-actions/${actionId}`, { cookie: employeeB })).status === 404);
        check("employee B IDOR update", (await request(`/api/employee/quality-actions/${actionId}`, { method: "PATCH", cookie: employeeB, body: { status: "COMPLETED" } })).status === 404);
        check("employee same-origin", (await request(`/api/employee/quality-actions/${actionId}`, { method: "PATCH", cookie: employeeA, origin: "https://invalid.example", body: { status: "IN_PROGRESS" } })).status === 403);
        const ownershipUpdate = await request(`/api/employee/quality-actions/${actionId}`, { method: "PATCH", cookie: employeeA, body: { status: "IN_PROGRESS", assigned_employee_id: fixture.employee_b_id } });
        check("employee action progress", ownershipUpdate.status === 200 && ownershipUpdate.json?.status === "IN_PROGRESS");
        const [[ownership]] = await db.execute("SELECT assigned_employee_id,status FROM quality_corrective_actions WHERE id=?", [actionId]);
        check("employee cannot change ownership", Number(ownership.assigned_employee_id) === Number(fixture.employee_a_id) && ownership.status === "IN_PROGRESS");
        const completion = await request(`/api/employee/quality-actions/${actionId}`, { method: "PATCH", cookie: employeeA, body: { status: "COMPLETED" } });
        check("employee action completion", completion.status === 200 && completion.json?.status === "COMPLETED");
        const [[completed]] = await db.execute("SELECT status,completed_at FROM quality_corrective_actions WHERE id=?", [actionId]);
        check("action completion persisted", completed.status === "COMPLETED" && Boolean(completed.completed_at));
        check("incident resolve", (await request(`/api/admin/quality-incidents/${incidentId}/resolve`, { method: "POST", cookie: admin, body: {} })).status === 200);
        check("incident close", (await request(`/api/admin/quality-incidents/${incidentId}/close`, { method: "POST", cookie: admin, body: {} })).status === 200);
        detail = await request(`/api/admin/quality-incidents/${incidentId}`, { cookie: admin });
        check("resolution and closure timestamps", detail.status === 200 && detail.json.incident.status === "CLOSED" && Boolean(detail.json.incident.resolved_at) && Boolean(detail.json.incident.closed_at));
        check("closed incident immutable", (await request(`/api/admin/quality-incidents/${incidentId}`, { method: "PATCH", cookie: admin, body: incidentPayload(fixture, stamp, { status: "IN_PROGRESS" }) })).status === 409);

        const cancelCreate = await request("/api/admin/quality-incidents", { method: "POST", cookie: admin, body: incidentPayload(fixture, `${stamp}-cancel`, { severity: "LOW" }) });
        check("second incident create", cancelCreate.status === 201);
        const cancelId = cancelCreate.json.id;
        for (const status of ["IN_REVIEW", "IN_PROGRESS", "WAITING_CUSTOMER", "IN_PROGRESS", "CANCELLED"]) {
            const transition = await request(`/api/admin/quality-incidents/${cancelId}`, { method: "PATCH", cookie: admin, body: incidentPayload(fixture, `${stamp}-cancel`, { severity: "LOW", status }) });
            check(`supported transition ${status}`, transition.status === 200, String(transition.status));
        }

        const actionCenter = await request("/api/admin/action-center?area=quality&page=1&page_size=50", { cookie: admin });
        check("quality action center", actionCenter.status === 200 && actionCenter.json?.items?.some(item => item.area === "quality"));
        const keys = actionCenter.json.items.map(item => `${item.entity_type}:${item.entity_id}`);
        check("no duplicate quality alerts", new Set(keys).size === keys.length);
        check("quality action center priority", (await request("/api/admin/action-center?area=quality&priority=critical", { cookie: admin })).status === 200);

        const [audits] = await db.execute("SELECT action,entity_id FROM audit_logs WHERE (entity_type='QUALITY_INCIDENT' AND entity_id=?) OR (entity_type='QUALITY_CORRECTIVE_ACTION' AND entity_id=?)", [incidentId, actionId]);
        const auditActions = new Set(audits.map(row => row.action));
        for (const event of ["QUALITY_INCIDENT_CREATED", "QUALITY_INCIDENT_UPDATED", "QUALITY_INCIDENT_ASSIGNED", "QUALITY_ACTION_CREATED", "QUALITY_ACTION_COMPLETED", "QUALITY_INCIDENT_RESOLVED", "QUALITY_INCIDENT_CLOSED"]) check(`audit ${event}`, auditActions.has(event));
        const [notifications] = await db.execute("SELECT recipient_type,recipient_id,notification_type,entity_type,entity_id FROM notifications WHERE (entity_type='QUALITY_INCIDENT' AND entity_id=?) OR (entity_type='QUALITY_CORRECTIVE_ACTION' AND entity_id=?)", [incidentId, actionId]);
        check("employee assignment notification", notifications.some(row => row.recipient_type === "EMPLOYEE" && Number(row.recipient_id) === Number(fixture.employee_a_id) && row.entity_type === "QUALITY_INCIDENT"));
        check("admin completion notification", notifications.some(row => row.recipient_type === "ADMIN" && row.entity_type === "QUALITY_CORRECTIVE_ACTION"));
        check("no customer notification", !notifications.some(row => row.recipient_type === "CUSTOMER"));
        const notificationKeys = notifications.map(row => `${row.recipient_type}:${row.recipient_id || ""}:${row.notification_type}:${row.entity_type}:${row.entity_id}`);
        check("no duplicate notifications", new Set(notificationKeys).size === notificationKeys.length);

        for (const route of ["/api/admin/orders", "/api/admin/service-reports", "/api/admin/notifications", "/api/admin/audit-logs", "/api/admin/action-center", "/api/admin/reports/dashboard?period=month"]) {
            const response = await request(route, { cookie: admin });
            check(`regression ${route}`, response.status === 200, String(response.status));
        }
        check("employee action list", (await request("/api/employee/quality-actions", { cookie: employeeA })).status === 200);
        console.log(JSON.stringify({ ok: true, executed: results.length, passed: results.filter(result => result.pass).length, failed: 0, pending: 0 }, null, 2));
    } finally { await db.end(); }
}

main().catch(error => { console.error(JSON.stringify({ ok: false, executed: results.length, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length + 1, pending: 0, error: error.message, results }, null, 2)); process.exit(1); });
