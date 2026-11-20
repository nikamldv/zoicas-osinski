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

function loadEnv() {
    if (process.env.ENV_FILE !== ENV_FILE) throw new Error("Refusing to run outside .env.test.");
    for (const line of fs.readFileSync(path.join(ROOT, ENV_FILE), "utf8").split(/\r?\n/)) {
        const at = line.indexOf("=");
        if (at > 0) process.env[line.slice(0, at)] = line.slice(at + 1);
    }
    if (process.env.MYSQL_DATABASE !== DATABASE || process.env.PORT !== "3001") throw new Error("Refusing non-isolated environment.");
}
function check(name, pass) { results.push({ name, pass: Boolean(pass) }); if (!pass) throw new Error(name); }
async function request(route, { method = "GET", body, cookie, origin = BASE } = {}) {
    const headers = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json, cookie: String(response.headers.get("set-cookie") || "").split(";")[0] };
}
async function main() {
    loadEnv();
    const health = await fetch(`${BASE}/api/health`).then(response => response.json());
    check("isolated health", health.status === "ok" && health.database === "connected");
    const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_ADMIN_USER, password: process.env.MYSQL_ADMIN_PASSWORD, database: DATABASE });
    const stamp = Date.now();
    try {
        const [[identity]] = await db.execute("SELECT DATABASE() database_name");
        check("isolated database", identity.database_name === DATABASE);
        const [[employeeA]] = await db.execute("SELECT id FROM employees WHERE email=? AND status='ACTIVE'", ["quality.employee.a@example.test"]);
        const [[employeeB]] = await db.execute("SELECT id FROM employees WHERE email=? AND status='ACTIVE'", ["quality.employee.b@example.test"]);
        const [[assignment]] = await db.execute("SELECT a.order_id FROM order_assignments a WHERE a.employee_id=? AND a.status<>'STORNIERT' ORDER BY a.id LIMIT 1", [employeeA.id]);
        check("synthetic employee fixture", Boolean(employeeA && employeeB && assignment));

        const [ownNotice] = await db.execute("INSERT INTO notifications(recipient_type,recipient_id,notification_type,title,body,entity_type,entity_id) VALUES ('EMPLOYEE',?,'TEST','TEST DATA – Phase 16.11B','Synthetic employee notification','TEST',?)", [employeeA.id, stamp]);
        const [otherNotice] = await db.execute("INSERT INTO notifications(recipient_type,recipient_id,notification_type,title,body,entity_type,entity_id) VALUES ('EMPLOYEE',?,'TEST','TEST DATA – Phase 16.11B','Synthetic other employee notification','TEST',?)", [employeeB.id, stamp]);
        const [material] = await db.execute("INSERT INTO materials(material_number,name,description,unit,minimum_stock,default_unit_cost,status) VALUES (?,?,?,?,?,?,'ACTIVE')", [`TEST-P1611B-${stamp}`, "TEST DATA – Materialverbrauch", "Synthetic isolated material", "STUECK", 0, 2.5]);
        const [receipt] = await db.execute("INSERT INTO material_stock_movements(movement_number,material_id,movement_type,quantity,unit_cost_snapshot,movement_date,status,reference,notes) VALUES (?,?, 'RECEIPT', ?, ?, CURDATE(), 'APPROVED', ?, ?)", [`TEST-P1611B-RECEIPT-${stamp}`, material.insertId, 10, 2.5, "TEST DATA – Phase 16.11B", "Synthetic inventory receipt"]);
        check("synthetic notification and material setup", Boolean(ownNotice.insertId && otherNotice.insertId && material.insertId && receipt.insertId));

        const noLogin = await request("/api/employee/notifications");
        check("notifications unauthenticated blocked", noLogin.status === 401);
        const loginA = await request("/api/employee/login", { method:"POST", body:{ email:"quality.employee.a@example.test", password:process.env.PHASE168_TEST_EMPLOYEE_PASSWORD } });
        const loginB = await request("/api/employee/login", { method:"POST", body:{ email:"quality.employee.b@example.test", password:process.env.PHASE168_TEST_EMPLOYEE_PASSWORD } });
        check("employee sessions", loginA.status === 200 && loginB.status === 200 && loginA.cookie.startsWith("zo_employee_session=") && loginB.cookie.startsWith("zo_employee_session="));

        const notifications = await request("/api/employee/notifications", { cookie:loginA.cookie });
        check("own notifications visible", notifications.status === 200 && notifications.json.rows.some(row => row.id === ownNotice.insertId) && !notifications.json.rows.some(row => row.id === otherNotice.insertId));
        check("own notification read", (await request(`/api/employee/notifications/${ownNotice.insertId}/read`, { method:"PATCH", body:{}, cookie:loginA.cookie })).status === 200);
        check("foreign notification blocked", (await request(`/api/employee/notifications/${ownNotice.insertId}/read`, { method:"PATCH", body:{}, cookie:loginB.cookie })).status === 404);
        check("notification same-origin", (await request(`/api/employee/notifications/${ownNotice.insertId}/read`, { method:"PATCH", body:{}, cookie:loginA.cookie, origin:"https://invalid.example" })).status === 403);

        const materials = await request("/api/employee/material-consumptions", { cookie:loginA.cookie });
        check("material form data is scoped", materials.status === 200 && materials.json.materials.some(row => row.id === material.insertId));
        const payload = { material_id:material.insertId, order_id:assignment.order_id, movement_type:"CONSUMPTION", quantity:1, movement_date:new Date().toISOString().slice(0,10), notes:"TEST DATA – Phase 16.11B" };
        const created = await request("/api/employee/material-consumptions", { method:"POST", body:payload, cookie:loginA.cookie });
        check("assigned order consumption created", created.status === 201 && created.json.status === "RECORDED");
        const duplicate = await request("/api/employee/material-consumptions", { method:"POST", body:payload, cookie:loginA.cookie });
        check("duplicate consumption blocked", duplicate.status === 409);
        const foreignOrder = await request("/api/employee/material-consumptions", { method:"POST", body:payload, cookie:loginB.cookie });
        check("unassigned order blocked", foreignOrder.status === 404);
        const invalidQuantity = await request("/api/employee/material-consumptions", { method:"POST", body:{ ...payload, quantity:0 }, cookie:loginA.cookie });
        check("invalid quantity blocked", invalidQuantity.status === 400);
        const noStock = await request("/api/employee/material-consumptions", { method:"POST", body:{ ...payload, quantity:999999 }, cookie:loginA.cookie });
        check("inventory constraint enforced", noStock.status === 409);
        const [[movement]] = await db.execute("SELECT id FROM material_stock_movements WHERE id=? AND employee_id=? AND order_id=?", [created.json.id, employeeA.id, assignment.order_id]);
        const [[audit]] = await db.execute("SELECT id FROM audit_logs WHERE action='STOCK_MOVEMENT_CREATED' AND entity_type='MATERIAL_STOCK_MOVEMENT' AND entity_id=?", [created.json.id]);
        check("movement ownership persisted", Boolean(movement));
        check("material audit recorded", Boolean(audit));
        console.log(JSON.stringify({ ok:true, executed:results.length, passed:results.filter(result => result.pass).length }, null, 2));
    } finally { await db.end(); }
}
main().catch(error => { console.log(JSON.stringify({ ok:false, executed:results.length, passed:results.filter(result => result.pass).length, failed:error.message }, null, 2)); process.exit(1); });
