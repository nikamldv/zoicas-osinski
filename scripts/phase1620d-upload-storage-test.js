"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");

const root = path.resolve(__dirname, "..");
const base = "http://127.0.0.1:3001";
const database = "zoicas_osinski_test";
const event = "DOCUMENT_UPLOAD_STORAGE_ERROR";
const codes = ["EACCES", "ENOSPC"];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/evoAAAAASUVORK5CYII=", "base64");
const marker = "phase1620d-private-synthetic-content:";
const results = [];
const expectedChecks = 13;

process.loadEnvFile(path.join(root, ".env.test"));
const env = process.env;
if (env.ENV_FILE !== ".env.test" || env.MYSQL_DATABASE !== database || env.PORT !== "3001" ||
    env.MYSQL_HOST !== "127.0.0.1" || (env.HOST && env.HOST !== "127.0.0.1") || env.SMTP_HOST ||
    env.PRIVATE_DOCUMENT_UPLOAD_DIR !== "storage/test-private-documents") {
    throw Error("Refusing outside the isolated upload test environment.");
}

if (process.argv.includes("--test-server")) {
    const writeFile = fs.writeFile;
    const directory = path.resolve(root, env.PRIVATE_DOCUMENT_UPLOAD_DIR);
    fs.writeFile = async (file, buffer, options) => {
        if (path.dirname(String(file)) === directory && Buffer.isBuffer(buffer)) {
            const suffix = buffer.subarray(png.length).toString();
            const code = codes.find(candidate => suffix === marker + candidate);
            if (code) {
                throw Object.assign(new Error(marker + " " + file), { code, path: file });
            }
        }
        return writeFile(file, buffer, options);
    };
    require("../server.js");
} else {
    main().catch(error => {
        console.error("Storage acceptance aborted:", error.code || error.message);
        process.exitCode = 1;
    }).finally(() => {
        const passed = results.filter(r => r.pass).length;
        console.log(JSON.stringify({ passed, failed: results.length - passed, skipped: expectedChecks - results.length, failures: results.filter(r => !r.pass).map(r => r.name) }, null, 2));
        if (passed !== expectedChecks) process.exitCode = 1;
    });
}

function check(name, pass) {
    results.push({ name, pass: Boolean(pass) });
}

async function main() {
    // Refuse to run against an existing listener. Only the child below injects faults.
    let occupied = false;
    try { await fetch(base + "/api/health", {signal: AbortSignal.timeout(1500)}); occupied = true; }
    catch (error) { if (error.cause?.code !== "ECONNREFUSED") throw error; }
    assert.equal(occupied, false, "Port 3001 must be free before starting the fault-test server.");
    const db = await mysql.createConnection({
        host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306), database,
        user: env.MYSQL_ADMIN_USER, password: env.MYSQL_ADMIN_PASSWORD
    });
    try {
        const [[identity]] = await db.query("SELECT DATABASE() AS name");
        assert.equal(identity.name, database);
        const [[customer]] = await db.execute("SELECT id FROM customers WHERE customer_number=?", ["TEST-KU-000001"]);
        assert.ok(customer, "Synthetic customer fixture unavailable.");
        const child = spawn(process.execPath, [__filename, "--test-server"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        const closed = new Promise(resolve => child.once("close", resolve));
        let logs = "";
        child.stderr.on("data", chunk => { logs += chunk; });
        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(Error("Isolated server startup timed out.")), 8000);
                child.once("exit", () => { clearTimeout(timeout); reject(Error("Isolated server exited.")); });
                child.once("error", error => { clearTimeout(timeout); reject(error); });
                child.stdout.on("data", chunk => {
                    if (String(chunk).includes("Website server listening at " + base)) { clearTimeout(timeout); resolve(); }
                });
            });
            const health = await fetch(base + "/api/health").then(response => response.json());
            assert.equal(health.database, "connected");
            const login = await fetch(base + "/api/admin/login", {
                method: "POST", headers: { Origin: base, "Content-Type": "application/json" },
                body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.PHASE168_TEST_ADMIN_PASSWORD })
            });
            assert.equal(login.status, 200, "Synthetic administrator login failed.");
            const cookie = login.headers.get("set-cookie").split(";")[0];
            const names = [];
            async function upload(buffer) {
                const filename = "TEST-P1620D-" + randomUUID() + ".png";
                names.push(filename);
                const form = new FormData();
                form.set("customer_id", String(customer.id));
                form.set("document_type", "SONSTIGES");
                form.set("visibility", "ADMIN");
                form.set("file", new Blob([buffer], { type: "image/png" }), filename);
                const response = await fetch(base + "/api/admin/documents", {
                    method: "POST", headers: { Origin: base, Cookie: cookie }, body: form
                });
                return { filename, status: response.status, body: await response.json() };
            }
            const badSignature = await upload(Buffer.from("synthetic invalid signature"));
            check("Invalid signature rejected", badSignature.status === 400);
            const limit = Math.min(Math.max(Number(env.EMPLOYEE_MAX_FILE_BYTES || 5 * 1024 * 1024), 1024), 10 * 1024 * 1024);
            const oversized = await upload(Buffer.concat([png, Buffer.alloc(limit)]));
            check("Oversized document rejected", oversized.status === 400);
            for (const code of codes) {
                const result = await upload(Buffer.concat([png, Buffer.from(marker + code)]));
                check(code + " returns 500", result.status === 500);
                check(code + " returns only the generic response", Object.keys(result.body).length === 1 &&
                    result.body.message === "Dokument konnte nicht gespeichert werden.");
                const [[row]] = await db.execute("SELECT COUNT(*) AS total FROM documents WHERE file_name=?", [result.filename]);
                check(code + " leaves no document record", Number(row.total) === 0);
            }
            child.kill();
            await closed;
            const entries = logs.split(/\r?\n/).filter(line => line.includes(event)).map(line => JSON.parse(line));
            for (const code of codes) {
                const matches = entries.filter(entry => entry.code === code);
                const entry = matches[0];
                check(code + " logs exactly one sanitized event", matches.length === 1 && entry.event === event &&
                    entry.operation === "write_file" && entry.storage === "private-documents" &&
                    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.correlationId) &&
                    typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)) &&
                    Object.keys(entry).sort().join(",") === "code,correlationId,event,operation,storage,timestamp");
            }
            check("Only storage failures were logged", entries.length === codes.length);
            check("Separate uploads get distinct correlations", new Set(entries.map(entry => entry.correlationId)).size === codes.length);
            check("Logs disclose no secrets, filenames, payloads or paths", [cookie, cookie.split("=")[1], env.PHASE168_TEST_ADMIN_PASSWORD,
                marker, png.toString("base64"), path.resolve(root, env.PRIVATE_DOCUMENT_UPLOAD_DIR), ...names]
                .every(value => value && !logs.includes(value)));
        } finally {
            if (child.exitCode === null && child.signalCode === null) child.kill();
            await closed;
        }
    } finally { await db.end(); }
}

