"use strict";

// Phase 16.11C: isolated integration checks only. Refuses production by design.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = ".env.test";
const DATABASE = "zoicas_osinski_test";
const BASE = "http://127.0.0.1:3001";
const results = [];

function check(name, condition) {
    results.push({ name, pass: Boolean(condition) });
    if (!condition) throw new Error(name);
}

function loadTestEnvironment() {
    if (process.env.ENV_FILE !== ENV_FILE) throw new Error("Refusing outside .env.test.");
    for (const line of fs.readFileSync(path.join(ROOT, ENV_FILE), "utf8").split(/\r?\n/)) {
        const index = line.indexOf("=");
        if (index > 0) process.env[line.slice(0, index)] = line.slice(index + 1);
    }
    if (process.env.MYSQL_DATABASE !== DATABASE || process.env.PORT !== "3001") throw new Error("Refusing non-isolated environment.");
}

function passwordHash(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`));
    });
}

async function request(route, { method = "GET", body, cookie, origin = BASE, binary = false } = {}) {
    const headers = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${BASE}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = binary ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => ({}));
    return { status: response.status, headers: response.headers, payload, cookie: String(response.headers.get("set-cookie") || "").split(";")[0] };
}

async function main() {
    loadTestEnvironment();
    const health = await fetch(`${BASE}/api/health`).then(response => response.json());
    check("isolated health", health.status === "ok" && health.database === "connected");
    const db = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_ADMIN_USER, password: process.env.MYSQL_ADMIN_PASSWORD, database: DATABASE
    });
    const stamp = Date.now();
    const oldPassword = `Phase1611C-old-${stamp}!`;
    const newPassword = `Phase1611C-new-${stamp}!`;
    try {
        const [[identity]] = await db.execute("SELECT DATABASE() AS database_name");
        check("test database identity", identity.database_name === DATABASE);
        const [customerA] = await db.execute(
            "INSERT INTO customers(customer_number,first_name,last_name,email,phone,password_hash,status,address,postal_code,city) VALUES (?,?,?,?,?,?,'active',?,?,?)",
            [`TEST-P1611C-A-${stamp}`, "Test", "Customer A", `phase1611c-a-${stamp}@example.test`, "+491111111", await passwordHash(oldPassword), "Testweg 1", "12345", "Teststadt"]
        );
        const [customerB] = await db.execute(
            "INSERT INTO customers(customer_number,first_name,last_name,email,phone,password_hash,status,address,postal_code,city) VALUES (?,?,?,?,?,?,'active',?,?,?)",
            [`TEST-P1611C-B-${stamp}`, "Test", "Customer B", `phase1611c-b-${stamp}@example.test`, "+492222222", await passwordHash(oldPassword), "Testweg 2", "12345", "Teststadt"]
        );
        const customerAId = customerA.insertId, customerBId = customerB.insertId;
        const [sentQuote] = await db.execute(
            "INSERT INTO quotes(quote_number,customer_id,service_description,service_type,net_amount,tax_amount,gross_amount,status,customer_notes) VALUES (?,?,?,?,?,?,?,'GESENDET',?)",
            [`TEST-P1611C-Q-${stamp}`, customerAId, "TEST DATA – Phase 16.11C", "Reinigung", 100, 19, 119, "Synthetic quote"]
        );
        const [acceptedQuote] = await db.execute(
            "INSERT INTO quotes(quote_number,customer_id,service_description,service_type,net_amount,tax_amount,gross_amount,status) VALUES (?,?,?,?,?,?,?,'ANGENOMMEN')",
            [`TEST-P1611C-QA-${stamp}`, customerAId, "TEST DATA – already accepted", "Reinigung", 100, 19, 119]
        );
        const [invoice] = await db.execute(
            "INSERT INTO invoices(invoice_number,customer_id,customer_name_snapshot,invoice_date,due_date,status,net_amount,tax_amount,gross_amount,paid_amount,outstanding_amount,notes) VALUES (?,?,?,CURDATE(),DATE_ADD(CURDATE(), INTERVAL 14 DAY),'GESENDET',100,19,119,0,119,?)",
            [`TEST-P1611C-I-${stamp}`, customerAId, "Test Customer A", "TEST DATA – Phase 16.11C"]
        );
        await db.execute(
            "INSERT INTO invoice_items(invoice_id,sort_order,title,quantity,unit,unit_price,discount_amount,net_amount,tax_rate,tax_amount,gross_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [invoice.insertId, 1, "TEST DATA – Reinigung", 1, "Pauschale", 100, 0, 100, 19, 19, 119]
        );
        check("synthetic fixtures created", Boolean(customerAId && customerBId && sentQuote.insertId && acceptedQuote.insertId && invoice.insertId));

        const noLogin = await request(`/api/customer/invoices/${invoice.insertId}/pdf`, { binary: true });
        check("invoice pdf unauthenticated blocked", noLogin.status === 401);
        const loginA = await request("/api/customer/login", { method: "POST", body: { email: `phase1611c-a-${stamp}@example.test`, password: oldPassword } });
        const loginB = await request("/api/customer/login", { method: "POST", body: { email: `phase1611c-b-${stamp}@example.test`, password: oldPassword } });
        check("customer sessions", loginA.status === 200 && loginB.status === 200 && loginA.cookie.startsWith("zo_customer_session=") && loginB.cookie.startsWith("zo_customer_session="));

        const foreignPdf = await request(`/api/customer/invoices/${invoice.insertId}/pdf`, { cookie: loginB.cookie, binary: true });
        check("foreign invoice pdf blocked", foreignPdf.status === 404);
        const pdf = await request(`/api/customer/invoices/${invoice.insertId}/pdf`, { cookie: loginA.cookie, binary: true });
        check("own invoice pdf returned", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdf.payload.subarray(0, 4).toString() === "%PDF");
        check("invoice pdf private headers", pdf.headers.get("cache-control") === "private, no-store" && pdf.headers.get("x-content-type-options") === "nosniff" && /attachment/.test(pdf.headers.get("content-disposition") || ""));

        const crossOrigin = await request(`/api/customer/quotes/${sentQuote.insertId}/reject`, { method: "POST", cookie: loginA.cookie, body: { reason: "TEST DATA – wrong origin" }, origin: "https://invalid.example" });
        check("quote rejection same-origin", crossOrigin.status === 403);
        const foreignQuote = await request(`/api/customer/quotes/${sentQuote.insertId}/reject`, { method: "POST", cookie: loginB.cookie, body: { reason: "TEST DATA – foreign" } });
        check("foreign quote rejection blocked", foreignQuote.status === 409);
        const rejected = await request(`/api/customer/quotes/${sentQuote.insertId}/reject`, { method: "POST", cookie: loginA.cookie, body: { reason: "TEST DATA – customer rejects quote" } });
        check("own sent quote rejected", rejected.status === 200 && rejected.payload.status === "ABGELEHNT");
        const duplicate = await request(`/api/customer/quotes/${sentQuote.insertId}/reject`, { method: "POST", cookie: loginA.cookie, body: { reason: "duplicate" } });
        check("duplicate quote rejection blocked", duplicate.status === 409);
        const invalidState = await request(`/api/customer/quotes/${acceptedQuote.insertId}/reject`, { method: "POST", cookie: loginA.cookie, body: { reason: "invalid state" } });
        check("non-sent quote rejection blocked", invalidState.status === 409);

        const wrongCurrent = await request("/api/customer/change-password", { method: "POST", cookie: loginA.cookie, body: { current_password: "wrong password", new_password: newPassword, password_confirmation: newPassword } });
        check("wrong current password rejected", wrongCurrent.status === 400);
        const changed = await request("/api/customer/change-password", { method: "POST", cookie: loginA.cookie, body: { current_password: oldPassword, new_password: newPassword, password_confirmation: newPassword } });
        check("customer password changed", changed.status === 200);
        const newLogin = await request("/api/customer/login", { method: "POST", body: { email: `phase1611c-a-${stamp}@example.test`, password: newPassword } });
        check("new password accepted", newLogin.status === 200 && newLogin.cookie.startsWith("zo_customer_session="));

        const [[audit]] = await db.execute("SELECT id FROM audit_logs WHERE action='QUOTE_REJECTED' AND entity_type='QUOTE' AND entity_id=?", [sentQuote.insertId]);
        const [[notification]] = await db.execute("SELECT id FROM notifications WHERE recipient_type='ADMIN' AND notification_type='QUOTE' AND entity_id=?", [sentQuote.insertId]);
        const [[downloadAudit]] = await db.execute("SELECT id FROM audit_logs WHERE action='INVOICE_PDF_DOWNLOADED' AND entity_type='INVOICE' AND entity_id=?", [invoice.insertId]);
        check("quote rejection audit recorded", Boolean(audit));
        check("admin rejection notification recorded", Boolean(notification));
        check("invoice download audit recorded", Boolean(downloadAudit));
        console.log(JSON.stringify({ ok: true, executed: results.length, passed: results.filter(result => result.pass).length }, null, 2));
    } finally {
        await db.end();
    }
}

main().catch(error => {
    console.log(JSON.stringify({ ok: false, executed: results.length, passed: results.filter(result => result.pass).length, failed: error.message }, null, 2));
    process.exit(1);
});
