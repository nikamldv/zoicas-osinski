"use strict";

/*
 * Rotates only the synthetic credentials used by the isolated browser suite.
 * It fails closed for every database other than zoicas_osinski_test.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.test");
const TEST_DATABASE = "zoicas_osinski_test";
const EMPLOYEE_EMAILS = ["quality.employee.a@example.test", "quality.employee.b@example.test"];
const CUSTOMER_EMAIL = "quality.customer@example.test";

function parseEnvironment(text) {
    return new Map(text.split(/\r?\n/).filter(Boolean).map(line => {
        const index = line.indexOf("=");
        if (index < 1) throw new Error("Invalid isolated environment entry.");
        return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function securePassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_";
    const bytes = crypto.randomBytes(28);
    return `Z9a-${Array.from(bytes, value => alphabet[value % alphabet.length]).join("")}`;
}

function passwordHash(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.scrypt(password, salt, 64, (error, key) => {
            if (error) return reject(error);
            resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`);
        });
    });
}

async function main() {
    const original = fs.readFileSync(ENV_FILE, "utf8");
    const environment = parseEnvironment(original);
    if (environment.get("MYSQL_DATABASE") !== TEST_DATABASE || environment.get("PORT") !== "3001") {
        throw new Error("Refusing credential rotation outside the approved isolated environment.");
    }

    const adminPassword = securePassword();
    const employeePassword = securePassword();
    const customerPassword = securePassword();
    const [adminHash, employeeHash, customerHash] = await Promise.all([
        passwordHash(adminPassword), passwordHash(employeePassword), passwordHash(customerPassword)
    ]);

    const connection = await mysql.createConnection({
        host: environment.get("MYSQL_HOST"),
        port: Number(environment.get("MYSQL_PORT") || 3306),
        user: environment.get("MYSQL_ADMIN_USER"),
        password: environment.get("MYSQL_ADMIN_PASSWORD"),
        database: TEST_DATABASE
    });

    try {
        await connection.beginTransaction();
        const [employees] = await connection.execute(
            "UPDATE employees SET password_hash=? WHERE email IN (?, ?)",
            [employeeHash, ...EMPLOYEE_EMAILS]
        );
        const [customers] = await connection.execute(
            "UPDATE customers SET password_hash=? WHERE email=?",
            [customerHash, CUSTOMER_EMAIL]
        );
        if (employees.affectedRows !== EMPLOYEE_EMAILS.length || customers.affectedRows !== 1) {
            throw new Error("Expected synthetic test accounts were not found; transaction rolled back.");
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }

    environment.set("ADMIN_PASSWORD_HASH", adminHash);
    environment.set("PHASE168_TEST_ADMIN_PASSWORD", adminPassword);
    environment.set("PHASE168_TEST_EMPLOYEE_PASSWORD", employeePassword);
    environment.set("PHASE168_TEST_CUSTOMER_PASSWORD", customerPassword);
    fs.writeFileSync(ENV_FILE, `${Array.from(environment, ([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600 });

    console.log(JSON.stringify({ ok: true, database: TEST_DATABASE, accountsRotated: { admin: 1, employees: 2, customers: 1 } }));
}

main().catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
});
