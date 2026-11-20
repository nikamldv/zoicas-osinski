"use strict";

/*
 * Creates an isolated, synthetic-only database for integration tests.
 * It deliberately refuses the business database and never drops anything.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const TEST_DATABASE = "zoicas_osinski_test";
const TEST_USER = "zoicas_test_app";
const TEST_HOST = "127.0.0.1";
const TEST_ENV_PATH = path.join(ROOT, ".env.test");
const migrationNames = [
    "001_quote_requests.sql", "002_appointments.sql", "003_customer_portal.sql",
    "004_employee_management.sql", "005_employee_invitations.sql", "006_customer_numbers.sql",
    "007_order_management.sql", "007b_order_documentation.sql", "008_staff_availability.sql",
    "009_quotes_contracts.sql", "010_invoices_payments.sql", "011_recurring_orders_automation.sql",
    "012_documents_messages_notifications_audit.sql", "013_finance_cashbook.sql",
    "014_service_reports_quality.sql", "014b_service_report_employee_notifications.sql",
    "015_materials_inventory.sql", "016_quality_incidents.sql"
];

function loadEnv(file) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const index = line.indexOf("=");
        if (index > 0 && !process.env[line.slice(0, index)]) process.env[line.slice(0, index)] = line.slice(index + 1);
    }
}

function passwordHash(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`));
    });
}

function removeDatabaseDirectives(sql) {
    return sql
        .replace(/^\s*CREATE DATABASE[\s\S]*?;\s*/im, "")
        .replace(/^\s*USE\s+zoicas_osinski\s*;\s*/gim, "")
        .replace(/^\s*GRANT\s+[^;]+;\s*$/gim, "")
        .replace(/^\s*FLUSH PRIVILEGES\s*;\s*$/gim, "");
}

function splitTriggerBlocks(sql) {
    const triggers = [];
    const remaining = sql.replace(/DELIMITER \$\$\s*([\s\S]*?)DELIMITER ;/g, (_match, body) => {
        for (const trigger of body.split("$$").map(value => value.trim()).filter(Boolean)) triggers.push(trigger);
        return "";
    });
    return { remaining, triggers };
}

async function executeSqlFile(connection, filePath) {
    const source = removeDatabaseDirectives(fs.readFileSync(filePath, "utf8"));
    const { remaining, triggers } = splitTriggerBlocks(source);
    if (remaining.trim()) await connection.query(remaining);
    for (const trigger of triggers) await connection.query(trigger);
}

async function main() {
    const sourceEnv = path.join(ROOT, ".env");
    if (!fs.existsSync(sourceEnv)) throw new Error("The local .env configuration is required for administrative setup.");
    if (fs.existsSync(TEST_ENV_PATH)) throw new Error(".env.test already exists; refusing to overwrite it.");
    loadEnv(sourceEnv);
    if (process.env.MYSQL_DATABASE !== "zoicas_osinski") throw new Error("The source configuration is not the expected business database.");
    if (TEST_DATABASE === process.env.MYSQL_DATABASE) throw new Error("Safety guard rejected the business database.");
    const setupAdminUser = process.env.TEST_SETUP_ADMIN_USER || process.env.MYSQL_ADMIN_USER;
    const setupAdminPassword = process.env.TEST_SETUP_ADMIN_PASSWORD ?? process.env.MYSQL_ADMIN_PASSWORD;
    if (!setupAdminUser) throw new Error("An existing administrative MySQL account is required.");

    const adminConfig = {
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: setupAdminUser,
        password: setupAdminPassword || "",
        multipleStatements: true
    };
    const admin = await mysql.createConnection(adminConfig);
    try {
        const [[database]] = await admin.execute("SELECT SCHEMA_NAME name FROM information_schema.schemata WHERE SCHEMA_NAME=?", [TEST_DATABASE]);
        const [[account]] = await admin.execute("SELECT User user_name FROM mysql.user WHERE User=? AND Host=?", [TEST_USER, TEST_HOST]);
        if (database || account) throw new Error("Test database or dedicated test account already exists; refusing to overwrite existing test infrastructure.");

        await admin.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        const setup = await mysql.createConnection({ ...adminConfig, database: TEST_DATABASE });
        try {
            await executeSqlFile(setup, path.join(ROOT, "database", "schema.sql"));
            for (const name of migrationNames) await executeSqlFile(setup, path.join(ROOT, "database", "migrations", name));

            const testDbPassword = crypto.randomBytes(30).toString("base64url");
            const testAdminPassword = crypto.randomBytes(24).toString("base64url");
            const employeePassword = crypto.randomBytes(24).toString("base64url");
            const customerPassword = crypto.randomBytes(24).toString("base64url");
            const testAdminHash = await passwordHash(testAdminPassword);
            const employeeHash = await passwordHash(employeePassword);
            const customerHash = await passwordHash(customerPassword);

            const [customer] = await setup.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash,status,address,postal_code,city) VALUES (?,?,?,?,?,?, 'active',?,?,?)", ["TEST-KU-000001", "Test", "Customer", "quality.customer@example.test", "+49100000001", customerHash, "Teststraße 1", "00000", "Teststadt"]);
            const [employeeA] = await setup.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)", ["TEST-MA-000001", "Test", "Employee A", "quality.employee.a@example.test", "+49100000002", employeeHash, "Integration Test", "TEST DATA – Phase 16.8B"]);
            const [employeeB] = await setup.execute("INSERT INTO employees (employee_number,first_name,last_name,email,phone,password_hash,role,status,position,notes) VALUES (?,?,?,?,?,?,'EMPLOYEE','ACTIVE',?,?)", ["TEST-MA-000002", "Test", "Employee B", "quality.employee.b@example.test", "+49100000003", employeeHash, "Integration Test", "TEST DATA – Phase 16.8B"]);
            const [order] = await setup.execute("INSERT INTO orders (order_number,customer_id,service_type,title,status,priority,notes) VALUES (?,?,? ,?,'GEPLANT','NORMAL',?)", ["TEST-P168-ORDER-001", customer.insertId, "Reinigungsservice", "TEST DATA – Phase 16.8B Auftrag", "Synthetic isolated integration test record"]);
            const [assignment] = await setup.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,CURDATE(),'09:00','10:00','GEPLANT',?)", [order.insertId, employeeA.insertId, "TEST DATA – Phase 16.8B"]);
            const [report] = await setup.execute("INSERT INTO service_reports (report_number,order_id,assignment_id,customer_id,employee_id,service_date,started_at,finished_at,summary,status) VALUES (?,?,?,?,?,CURDATE(),CONCAT(CURDATE(),' 09:00:00'),CONCAT(CURDATE(),' 10:00:00'),?,'DRAFT')", ["TEST-P168-REPORT-001", order.insertId, assignment.insertId, customer.insertId, employeeA.insertId, "TEST DATA – Phase 16.8B service report"]);
            const [incident] = await setup.execute("INSERT INTO quality_incidents (incident_number,customer_id,order_id,assignment_id,service_report_id,created_by_type,assigned_employee_id,category,severity,status,title,description,due_date) VALUES (?,?,?,?,?,'ADMIN',?,'TEST','CRITICAL','IN_PROGRESS',?,?,DATE_SUB(CURDATE(),INTERVAL 1 DAY))", ["TEST-P168-INCIDENT-001", customer.insertId, order.insertId, assignment.insertId, report.insertId, employeeA.insertId, "TEST DATA – Phase 16.8B incident", "Synthetic critical isolated test incident"]);
            const [action] = await setup.execute("INSERT INTO quality_corrective_actions (incident_id,assigned_employee_id,title,description,due_date,status) VALUES (?,?,?,?,DATE_SUB(CURDATE(),INTERVAL 1 DAY),'OPEN')", [incident.insertId, employeeA.insertId, "TEST DATA – corrective action", "Synthetic isolated corrective action"]);

            await admin.query(`CREATE USER '${TEST_USER}'@'${TEST_HOST}' IDENTIFIED BY ${admin.escape(testDbPassword)}`);
            await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${TEST_DATABASE}\`.* TO '${TEST_USER}'@'${TEST_HOST}'`);
            await admin.query("FLUSH PRIVILEGES");

            const testEnv = [
                "HOST=127.0.0.1", "PORT=3001", `MYSQL_HOST=${process.env.MYSQL_HOST}`, `MYSQL_PORT=${process.env.MYSQL_PORT || 3306}`,
                `MYSQL_USER=${TEST_USER}`, `MYSQL_PASSWORD=${testDbPassword}`, `MYSQL_DATABASE=${TEST_DATABASE}`,
                `MYSQL_ADMIN_USER=${TEST_USER}`, `MYSQL_ADMIN_PASSWORD=${testDbPassword}`, "MYSQL_SSL=false", "MYSQL_CONNECTION_LIMIT=5",
                "ADMIN_USERNAME=test-phase168-admin", `ADMIN_PASSWORD_HASH=${testAdminHash}`, "COOKIE_SECURE=false",
                "ADMIN_SESSION_TTL_MINUTES=60", "CUSTOMER_SESSION_TTL_MINUTES=60", "EMPLOYEE_SESSION_TTL_MINUTES=60",
                "PUBLIC_BASE_URL=http://127.0.0.1:3001", "QUOTE_UPLOAD_DIR=storage/test-quote-uploads",
                "EMPLOYEE_UPLOAD_DIR=storage/test-employee-documents", "PRIVATE_DOCUMENT_UPLOAD_DIR=storage/test-private-documents",
                `PHASE168_TEST_ADMIN_PASSWORD=${testAdminPassword}`, `PHASE168_TEST_EMPLOYEE_PASSWORD=${employeePassword}`,
                `PHASE168_TEST_CUSTOMER_PASSWORD=${customerPassword}`, ""
            ].join("\n");
            fs.writeFileSync(TEST_ENV_PATH, testEnv, { encoding: "utf8", flag: "wx", mode: 0o600 });

            const [[target]] = await setup.execute("SELECT DATABASE() database_name");
            if (target.database_name !== TEST_DATABASE) throw new Error("Safety guard: setup connection did not target the approved test database.");
            const counts = await Promise.all(["customers", "employees", "orders", "order_assignments", "service_reports", "quality_incidents", "quality_corrective_actions"].map(async table => {
                const [[row]] = await setup.query(`SELECT COUNT(*) total FROM \`${table}\``);
                return [table, Number(row.total)];
            }));
            console.log(JSON.stringify({ success: true, database: TEST_DATABASE, port: 3001, syntheticCounts: Object.fromEntries(counts), ids: { customer: customer.insertId, employeeA: employeeA.insertId, employeeB: employeeB.insertId, order: order.insertId, assignment: assignment.insertId, serviceReport: report.insertId, incident: incident.insertId, action: action.insertId } }));
        } finally { await setup.end(); }
    } finally { await admin.end(); }
}

main().catch(error => { console.error(JSON.stringify({ success: false, message: error.message })); process.exit(1); });
