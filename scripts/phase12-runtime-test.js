"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const TEST_ENV_FILE = process.env.ENV_FILE;
let base = "";
const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); if (!pass) throw new Error(`${name}: ${detail}`); };
function loadIsolatedTestEnv() {
  if (TEST_ENV_FILE !== ".env.test") throw new Error("Refusing to run: set ENV_FILE=.env.test for the isolated test environment.");
  const envPath = path.resolve(ROOT, TEST_ENV_FILE);
  if (envPath !== path.join(ROOT, ".env.test") || !fs.existsSync(envPath)) throw new Error("Refusing to run: the isolated .env.test configuration is unavailable.");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
}
function requireIsolatedTestEnvironment() {
  if (process.env.MYSQL_DATABASE !== "zoicas_osinski_test") throw new Error("Refusing to run: MYSQL_DATABASE must be zoicas_osinski_test.");
  if (Number(process.env.PORT) !== 3001) throw new Error("Refusing to run: PORT must be 3001.");
  const configuredBase = process.env.PHASE12_TEST_BASE || "http://127.0.0.1:3001";
  if (configuredBase !== "http://127.0.0.1:3001") throw new Error("Refusing to run: PHASE12_TEST_BASE must be http://127.0.0.1:3001.");
  return configuredBase;
}
function passwordHash(password) { return new Promise((resolve, reject) => { const salt = crypto.randomBytes(16); crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`)); }); }
function cookieOf(response) { return String(response.headers.get("set-cookie") || "").split(";")[0]; }
async function request(route, { method = "GET", body, cookie, form = false } = {}) {
  const headers = { Origin: base }; if (cookie) headers.Cookie = cookie;
  if (body && !form) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${route}`, { method, headers, body: body && !form ? JSON.stringify(body) : body });
  let json = null; try { json = await response.clone().json(); } catch {}
  return { status: response.status, json, headers: response.headers, response };
}
function documentForm({ customerId, name, bytes, mime = "image/png", type = "SONSTIGES" }) { const form = new FormData(); form.set("customer_id", String(customerId)); form.set("document_type", type); form.set("visibility", "CUSTOMER"); form.set("file", new Blob([bytes], { type: mime }), name); return form; }

(async () => {
  loadIsolatedTestEnv();
  base = requireIsolatedTestEnvironment();
  // Reuse the existing isolated Phase 16.8 admin credential when dedicated
  // Phase 12 aliases are not configured. Both values still come only from
  // .env.test and the script remains fail-closed without either pair.
  const adminUser = process.env.PHASE12_TEST_ADMIN_USER || process.env.ADMIN_USERNAME;
  const adminPassword = process.env.PHASE12_TEST_ADMIN_PASSWORD || process.env.PHASE168_TEST_ADMIN_PASSWORD;
  check("test admin configuration", Boolean(adminUser && adminPassword));
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306), user: process.env.MYSQL_ADMIN_USER, password: process.env.MYSQL_ADMIN_PASSWORD, database: process.env.MYSQL_DATABASE, charset: "utf8mb4" });
  const stamp = `${Date.now()}${crypto.randomInt(100, 999)}`;
  const adminLogin = await request("/api/admin/login", { method: "POST", body: { username: adminUser, password: adminPassword } });
  check("admin login", adminLogin.status === 200, `${adminLogin.status} ${adminLogin.json?.message || ""}`);
  const admin = cookieOf(adminLogin.response); check("admin session cookie", admin.startsWith("zo_admin_session="));
  for (const route of ["/api/admin/documents", "/api/admin/messages", "/api/admin/notifications", "/api/admin/audit-logs"]) { const res = await request(route, { cookie: admin }); check(`admin ${route}`, res.status === 200, String(res.status)); }
  const customerPassword = "Phase12TestPass1";
  async function createCustomer(suffix) { const email = `phase12.${suffix}.${stamp}@example.test`; const reg = await request("/api/customer/register", { method: "POST", body: { first_name: "TEST DATA", last_name: `Phase 12 ${suffix}`, email, phone: "+49123456789", password: customerPassword, password_confirmation: customerPassword } }); check(`customer ${suffix} register`, reg.status === 201, `${reg.status} ${reg.json?.message || ""}`); const login = await request("/api/customer/login", { method: "POST", body: { email, password: customerPassword } }); check(`customer ${suffix} login`, login.status === 200, String(login.status)); return { id: login.json.customer.id, cookie: cookieOf(login.response), email }; }
  const customerA = await createCustomer("a"), customerB = await createCustomer("b");
  for (const [name, cookie] of [["A", customerA.cookie], ["B", customerB.cookie]]) for (const route of ["/api/customer/documents", "/api/customer/messages", "/api/customer/notifications"]) { const res = await request(route, { cookie }); check(`customer ${name} ${route}`, res.status === 200, String(res.status)); }
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  const uploaded = [];
  for (const [name, bytes, mime] of [["phase12.png", png, "image/png"], ["phase12.jpg", jpg, "image/jpeg"], ["phase12.pdf", pdf, "application/pdf"]]) { const res = await request("/api/admin/documents", { method: "POST", cookie: admin, form: true, body: documentForm({ customerId: customerA.id, name, bytes, mime }) }); check(`valid ${name} upload`, res.status === 201, `${res.status} ${res.json?.message || ""}`); uploaded.push(res.json.id); }
  const docId = uploaded[0];
  const [[doc]] = await db.execute("SELECT * FROM documents WHERE id=?", [docId]); check("document database row", Boolean(doc && doc.customer_id === customerA.id && /^[0-9a-f-]{36}$/.test(doc.stored_file_name)), "missing/unsafe stored filename"); check("private storage", !doc.storage_path.includes("public"), doc.storage_path);
  const auditDoc = await request("/api/admin/audit-logs?search=DOCUMENT_CREATED", { cookie: admin }); check("document audit", auditDoc.status === 200 && auditDoc.json.rows.some(row => row.entity_id === docId && row.action === "DOCUMENT_CREATED"), "missing audit");
  const patch = await request(`/api/admin/documents/${docId}`, { method: "PATCH", cookie: admin, body: { document_type: "VORHER_FOTO", visibility: "CUSTOMER" } }); check("document patch", patch.status === 200, String(patch.status));
  const adminDownload = await request(`/api/admin/documents/${docId}`, { cookie: admin }); check("admin document download", adminDownload.status === 200 && String(adminDownload.headers.get("cache-control")).includes("private, no-store"), String(adminDownload.status));
  const customerDocs = await request("/api/customer/documents", { cookie: customerA.cookie }); check("customer A document list", customerDocs.status === 200 && customerDocs.json.rows.some(row => row.id === docId), "document absent");
  const customerDownload = await request(`/api/customer/documents/${docId}`, { cookie: customerA.cookie }); check("customer document download", customerDownload.status === 200 && customerDownload.headers.get("content-type") === "image/png" && String(customerDownload.headers.get("content-disposition")).includes("attachment"), String(customerDownload.status));
  const otherDownload = await request(`/api/customer/documents/${docId}`, { cookie: customerB.cookie }); check("customer document IDOR", otherDownload.status === 404, String(otherDownload.status));
  const badUploads = [
    ["invalid signature", "fake.png", Buffer.from("not an image"), "image/png"],
    ["oversized", "large.png", Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), "image/png"],
    ["path traversal", "../outside.png", png, "image/png"],
    ["invalid MIME", "wrong-type.png", png, "text/plain"]
  ];
  for (const [label, name, bytes, mime] of badUploads) { const res = await request("/api/admin/documents", { method: "POST", cookie: admin, form: true, body: documentForm({ customerId: customerA.id, name, bytes, mime }) }); check(`upload reject ${label}`, res.status >= 400 && res.status < 500, String(res.status)); }
  const sendMessage = await request("/api/admin/messages", { method: "POST", cookie: admin, body: { customer_id: customerA.id, subject: "TEST DATA – Phase 12", message: "TEST DATA – Phase 12 sichere Nachricht" } }); check("admin customer message", sendMessage.status === 201, `${sendMessage.status} ${sendMessage.json?.message || ""}`); const messageId = sendMessage.json.id;
  const customerMessages = await request("/api/customer/messages", { cookie: customerA.cookie }); check("customer receives message", customerMessages.status === 200 && customerMessages.json.rows.some(row => row.id === messageId), "message missing");
  const markMessage = await request(`/api/customer/messages/${messageId}/read`, { method: "PATCH", cookie: customerA.cookie, body: {} }); check("customer reads message", markMessage.status === 200, String(markMessage.status));
  const customerNotifications = await request("/api/customer/notifications", { cookie: customerA.cookie }); const notification = customerNotifications.json.rows.find(row => row.entity_type === "MESSAGE" && row.entity_id === messageId); check("message notification", customerNotifications.status === 200 && Boolean(notification), "notification missing");
  const markNote = await request(`/api/customer/notifications/${notification.id}/read`, { method: "PATCH", cookie: customerA.cookie, body: {} }); check("customer reads notification", markNote.status === 200, String(markNote.status));
  check("message IDOR", (await request(`/api/customer/messages/${messageId}`, { cookie: customerB.cookie })).status === 404, "message route did not deny");
  check("notification IDOR", (await request(`/api/customer/notifications/${notification.id}`, { cookie: customerB.cookie })).status === 404, "notification route did not deny");
  const auditMessage = await request("/api/admin/audit-logs?search=MESSAGE", { cookie: admin }); check("message audits", auditMessage.status === 200 && auditMessage.json.rows.some(row => String(row.entity_id) === String(messageId) && row.action === "MESSAGE_CREATED") && auditMessage.json.rows.some(row => String(row.entity_id) === String(messageId) && row.action === "MESSAGE_READ"), "message audit missing");
  const quotePayload = { customer_id: customerA.id, contact_person: "TEST DATA – Phase 12", service_description: "TEST DATA – Phase 12 Angebot", object_address: "Teststraße 12", postal_code: "97421", city: "Schweinfurt", service_type: "Reinigungsservice", area_sqm: 10, frequency: "einmalig", start_date: "2026-12-01", valid_until: "2026-12-31", internal_notes: "TEST DATA – Phase 12", customer_notes: "TEST DATA – Phase 12", status: "GESENDET", items: [{ title: "TEST DATA – Phase 12 Position", quantity: 1, unit: "Pauschale", unit_price: 100, discount_amount: 0, tax_rate: 19 }] };
  const quoteCreate = await request("/api/admin/quotes", { method: "POST", cookie: admin, body: quotePayload }); check("quote create and notification", quoteCreate.status === 201, `${quoteCreate.status} ${quoteCreate.json?.message || ""}`); const quoteId = quoteCreate.json.id;
  const quoteUpdate = await request(`/api/admin/quotes/${quoteId}`, { method: "PATCH", cookie: admin, body: { ...quotePayload, status: "ANGENOMMEN" } }); check("quote status change", quoteUpdate.status === 200, String(quoteUpdate.status));
  const orderFromQuote = await request(`/api/admin/quotes/${quoteId}/create-order`, { method: "POST", cookie: admin, body: {} }); check("quote to order", orderFromQuote.status === 201, String(orderFromQuote.status)); const orderId = orderFromQuote.json.id;
  const contractCreate = await request("/api/admin/contracts", { method: "POST", cookie: admin, body: { customer_id: customerA.id, quote_id: quoteId, start_date: "2026-11-16", service_description: "TEST DATA – Phase 12 Vertrag", service_type: "Reinigungsservice", interval_type: "EINMALIG", net_amount: 100, tax_rate: 19, status: "AKTIV", internal_notes: "TEST DATA – Phase 12" } }); check("contract create", contractCreate.status === 201, String(contractCreate.status));
  const employeePassword = "Phase12Employee1"; const employeeEmail = `phase12.employee.${stamp}@example.test`; const employeeHash = await passwordHash(employeePassword); const employeeNumber = `TEST-P12-${stamp}`;
  const [employeeInsert] = await db.execute("INSERT INTO employees (first_name,last_name,email,phone,password_hash,role,status,employee_number,position,notes) VALUES (?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?,?)", ["TEST DATA", "Phase 12 Employee", employeeEmail, "+49123456788", employeeHash, employeeNumber, "Phase 12 Test", "TEST DATA – Phase 12"]); const employeeId = employeeInsert.insertId;
  const hours = [1,2,3,4,5,6,7].map(weekday => ({ weekday, start_time: "08:00", end_time: "18:00" })); const hoursResult = await request(`/api/admin/employees/${employeeId}/work-hours`, { method: "PATCH", cookie: admin, body: { hours } }); check("employee working hours", hoursResult.status === 200, String(hoursResult.status));
  const assignment = await request(`/api/admin/orders/${orderId}/assignments`, { method: "POST", cookie: admin, body: { employee_id: employeeId, assignment_date: "2026-12-01", start_time: "09:00", end_time: "10:00", status: "GEPLANT", notes: "TEST DATA – Phase 12" } }); check("employee assignment", assignment.status === 201, String(assignment.status));
  await db.execute("INSERT INTO service_reports (report_number,order_id,assignment_id,customer_id,employee_id,service_date,summary,status,reviewed_at) VALUES (?,?,?,?,?,?,?,'REVIEWED',NOW())", ["TEST-P12-REPORT-"+stamp,orderId,assignment.json.id,customerA.id,employeeId,"2026-12-01","Synthetic reviewed work"]);
  const invoiceFromOrder = await request(`/api/admin/orders/${orderId}/create-invoice`, { method: "POST", cookie: admin, body: {} }); check("invoice created", invoiceFromOrder.status === 201, `${invoiceFromOrder.status} ${invoiceFromOrder.json?.message || ""}`); const invoiceId = invoiceFromOrder.json.id;
  const invoiceDetail = await request(`/api/admin/invoices/${invoiceId}`, { cookie: admin }); const invoiceUpdatePayload = { customer_id: customerA.id, order_id: orderId, sales_quote_id: quoteId, invoice_date: "2026-12-01", due_date: "2026-12-15", status: "GESENDET", notes: "TEST DATA – Phase 12" }; const invoiceStatus = await request(`/api/admin/invoices/${invoiceId}`, { method: "PATCH", cookie: admin, body: invoiceUpdatePayload }); check("invoice status change", invoiceStatus.status === 200, String(invoiceStatus.status));
  const payment = await request(`/api/admin/invoices/${invoiceId}/payments`, { method: "POST", cookie: admin, body: { payment_date: "2026-12-02", amount: 119, payment_method: "BANKÜBERWEISUNG", payment_reference: "TEST DATA – Phase 12", notes: "TEST DATA – Phase 12" } }); check("payment create", payment.status === 201, String(payment.status));
  const customerInvoices = await request("/api/customer/invoices", { cookie: customerA.cookie }); check("customer invoice visibility", customerInvoices.status === 200 && customerInvoices.json.rows.some(row => String(row.id) === String(invoiceId)), "invoice missing");
  const audits = await request("/api/admin/audit-logs", { cookie: admin }); const actions = new Set(audits.json.rows.map(row => row.action)); for (const action of ["QUOTE_STATUS_CHANGED", "CONTRACT_STATUS_CHANGED", "ORDER_STATUS_CHANGED", "INVOICE_CREATED", "INVOICE_STATUS_CHANGED", "PAYMENT_CREATED"]) check(`audit ${action}`, actions.has(action), "missing");
  const autoNotes = await request("/api/customer/notifications", { cookie: customerA.cookie }); const types = new Set(autoNotes.json.rows.map(row => row.notification_type)); for (const type of ["QUOTE", "ORDER", "INVOICE", "PAYMENT"]) check(`notification ${type}`, types.has(type), "missing");
  // Keep the one-time schedule inside the generator's forward-looking window.
  // The former fixed date had already passed, so zero generated orders was the
  // correct application result rather than a regression.
  const generatorDate = new Date(); generatorDate.setDate(generatorDate.getDate() + 1);
  const generatorStartDate = generatorDate.toISOString().slice(0, 10);
  const schedule = await request("/api/admin/recurring-orders", { method: "POST", cookie: admin, body: { contract_id: contractCreate.json.id, start_date: generatorStartDate, recurrence_type: "EINMALIG", weekdays: "1", preferred_start_time: "09:00", duration_minutes: 60, preferred_employee_id: employeeId, active: "1" } }); check("recurring schedule", schedule.status === 201, String(schedule.status));
  const generated = await request("/api/admin/recurring-orders/generate", { method: "POST", cookie: admin, body: { days: 7 } }); check("recurring order generation", generated.status >= 200 && generated.status < 300 && Number(generated.json.summary.created) >= 1, `${generated.status} ${JSON.stringify(generated.json)}`);
  const scheduledAudits = await request("/api/admin/audit-logs", { cookie: admin }); for (const action of ["EMPLOYEE_ASSIGNED", "RECURRING_ORDER_GENERATED"]) check(`audit ${action}`, scheduledAudits.json.rows.some(row => row.action === action), "missing");
  await db.execute("INSERT INTO employee_tasks (employee_id,title,description,status,priority,created_by) VALUES (?,?,'TEST DATA – Phase 12','OPEN','NORMAL','phase12-runtime-test')", [employeeId, "TEST DATA – Phase 12 Task"]);
  const employeeLogin = await request("/api/employee/login", { method: "POST", body: { email: employeeEmail, password: employeePassword } }); check("employee login", employeeLogin.status === 200, String(employeeLogin.status)); const employeeCookie = cookieOf(employeeLogin.response);
  check("employee session", (await request("/api/employee/session", { cookie: employeeCookie })).status === 200, "no employee session");
  check("employee own tasks", (await request("/api/employee/tasks", { cookie: employeeCookie })).status === 200, "tasks inaccessible");
  check("employee admin isolation", (await request("/api/admin/documents", { cookie: employeeCookie })).status === 401, "admin access allowed");
  check("employee audit isolation", (await request("/api/admin/audit-logs", { cookie: employeeCookie })).status === 401, "audit access allowed");
  check("employee task IDOR", (await request("/api/employee/tasks/999999999", { cookie: employeeCookie })).status === 404, "foreign task accepted");
  for (const route of ["/api/contact", "/api/career", "/api/quotes", "/api/appointments"]) { const res = await request(route); check(`public route ${route}`, [404, 405].includes(res.status) || res.status === 200, String(res.status)); }
  await db.end();
  console.log(JSON.stringify({ ok: true, results }, null, 2));
})().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message, results }, null, 2)); process.exit(1); });
