"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_DATABASE = "zoicas_osinski_test";
const PRODUCTION_DATABASE = "zoicas_osinski";

function arg(name) { const prefix = `--${name}=`; return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length); }
function hasFlag(name) { return process.argv.includes(`--${name}`); }
function readEnv(file) {
    const values = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const index = line.indexOf("=");
        if (index > 0 && !line.trimStart().startsWith("#")) values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return values;
}
function safePath(candidate, base) { const resolved = path.resolve(candidate); return resolved === base || resolved.startsWith(base + path.sep); }
function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function fileHash(file) { return new Promise((resolve, reject) => { const hash = crypto.createHash("sha256"), stream = fs.createReadStream(file); stream.on("error", reject); stream.on("data", chunk => hash.update(chunk)); stream.on("end", () => resolve(hash.digest("hex"))); }); }
function run(executable, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve() : reject(new Error(`mysql_client_exit_${code}${stderr ? ": " + stderr.split(/\r?\n/)[0].replace(/password[^\s]*/ig, "[redacted]") : ""}`)));
    });
}
function executable(binDir, name) {
    const full = path.resolve(binDir, `${name}.exe`);
    if (!fs.existsSync(full)) throw new Error(`${name}.exe was not found in MYSQL_BIN_DIR.`);
    return full;
}
function ensureDatabaseName(name) { if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Invalid database name."); return name; }
function loadConfig() {
    const configArg = arg("config");
    if (!configArg) throw new Error("A dedicated configuration is required: --config=.env.backup or --config=.env.test --test.");
    const configPath = path.resolve(ROOT, configArg);
    if (!safePath(configPath, ROOT) || !fs.existsSync(configPath)) throw new Error("Backup configuration must be an existing file inside the project root.");
    const testMode = hasFlag("test");
    if (testMode && path.basename(configPath) !== ".env.test") throw new Error("Test mode accepts only .env.test.");
    if (!testMode && path.basename(configPath) !== ".env.backup") throw new Error("Production-capable backups require .env.backup.");
    const values = readEnv(configPath);
    const config = testMode ? {
        host: values.MYSQL_HOST, port: values.MYSQL_PORT || "3306", user: values.MYSQL_ADMIN_USER, password: values.MYSQL_ADMIN_PASSWORD,
        database: values.MYSQL_DATABASE, binDir: values.MYSQL_BIN_DIR || "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin",
        backupDirectory: values.BACKUP_DIRECTORY || "storage/database-backups", retentionDays: values.BACKUP_RETENTION_DAYS || "30", retentionApproved: values.BACKUP_RETENTION_DELETE_APPROVED === "true", includeEvents: values.BACKUP_INCLUDE_EVENTS === "true"
    } : {
        host: values.MYSQL_BACKUP_HOST, port: values.MYSQL_BACKUP_PORT || "3306", user: values.MYSQL_BACKUP_USER, password: values.MYSQL_BACKUP_PASSWORD,
        database: values.MYSQL_BACKUP_DATABASE, binDir: values.MYSQL_BIN_DIR || "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin",
        backupDirectory: values.BACKUP_DIRECTORY || "storage/database-backups", retentionDays: values.BACKUP_RETENTION_DAYS || "30", retentionApproved: values.BACKUP_RETENTION_DELETE_APPROVED === "true", includeEvents: values.BACKUP_INCLUDE_EVENTS !== "false"
    };
    if (![config.host, config.user, config.password, config.database].every(Boolean)) throw new Error("Backup configuration is incomplete.");
    ensureDatabaseName(config.database);
    if (testMode && config.database !== TEST_DATABASE) throw new Error(`Test mode is restricted to ${TEST_DATABASE}.`);
    if (!testMode && config.database === PRODUCTION_DATABASE && !hasFlag("allow-production")) throw new Error("Production backup requires the explicit --allow-production flag.");
    if (!testMode && config.database !== PRODUCTION_DATABASE) throw new Error("Non-test backups must target the configured production database.");
    config.retentionDays = Number(config.retentionDays);
    if (!Number.isInteger(config.retentionDays) || config.retentionDays < 1 || config.retentionDays > 3650) throw new Error("BACKUP_RETENTION_DAYS must be between 1 and 3650.");
    config.backupDirectory = path.resolve(ROOT, config.backupDirectory);
    const publicDirectory = path.resolve(ROOT, "public");
    if (!safePath(config.backupDirectory, ROOT) || safePath(config.backupDirectory, publicDirectory)) throw new Error("Backup directory must be private and inside the project root.");
    return { config, testMode };
}
async function temporaryDefaults(config) {
    const file = path.join(os.tmpdir(), `zoicas-backup-${process.pid}-${crypto.randomUUID()}.cnf`);
    const content = `[client]\nhost=${config.host}\nport=${config.port}\nuser=${config.user}\npassword=${config.password}\n`;
    await fsp.writeFile(file, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return file;
}
async function appendLog(directory, data) { await fsp.appendFile(path.join(directory, "backup.log.jsonl"), `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 }); }
async function retentionPreview(directory, retentionDays) {
    const cutoff = Date.now() - retentionDays * 86400000;
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) if (entry.isFile() && /^zoicas-osinski-[A-Za-z0-9_]+-\d{8}T\d{6}Z\.sql$/.test(entry.name)) {
        const file = path.join(directory, entry.name), stat = await fsp.stat(file);
        if (stat.mtimeMs < cutoff) candidates.push(entry.name);
    }
    return candidates;
}
async function main() {
    const { config, testMode } = loadConfig();
    await fsp.mkdir(config.backupDirectory, { recursive: true, mode: 0o700 });
    const lock = path.join(config.backupDirectory, "backup.lock");
    let lockHandle;
    let defaultsFile;
    try {
        lockHandle = await fsp.open(lock, "wx", 0o600);
        const dump = executable(config.binDir, "mysqldump");
        defaultsFile = await temporaryDefaults(config);
        const backupName = `zoicas-osinski-${config.database}-${timestamp()}.sql`;
        const backupFile = path.join(config.backupDirectory, backupName);
        const dumpArgs = [`--defaults-extra-file=${defaultsFile}`, "--single-transaction", "--quick", "--routines", "--triggers", "--no-tablespaces", "--set-gtid-purged=OFF", "--default-character-set=utf8mb4", `--result-file=${backupFile}`, config.database];
        if (config.includeEvents) dumpArgs.splice(4, 0, "--events");
        await run(dump, dumpArgs);
        const stat = await fsp.stat(backupFile);
        const firstChunk = await fsp.readFile(backupFile, { encoding: "utf8" });
        if (stat.size < 128 || !/MySQL dump|CREATE TABLE/i.test(firstChunk.slice(0, 32768))) throw new Error("Backup integrity check failed.");
        const sha256 = await fileHash(backupFile);
        await fsp.writeFile(`${backupFile}.sha256`, `${sha256}  ${backupName}\n`, { encoding: "utf8", mode: 0o600 });
        const retentionCandidates = await retentionPreview(config.backupDirectory, config.retentionDays);
        if (hasFlag("apply-retention")) {
            if (!config.retentionApproved) throw new Error("Retention deletion requires BACKUP_RETENTION_DELETE_APPROVED=true in the dedicated backup configuration.");
            for (const name of retentionCandidates) { await fsp.unlink(path.join(config.backupDirectory, name)); await fsp.unlink(path.join(config.backupDirectory, `${name}.sha256`)).catch(() => {}); }
        }
        await appendLog(config.backupDirectory, { timestamp: new Date().toISOString(), event: "BACKUP_SUCCESS", database: config.database, file: backupName, bytes: stat.size, sha256, test_mode: testMode, retention_candidates: retentionCandidates.length, retention_applied: hasFlag("apply-retention") });
        console.log(JSON.stringify({ ok: true, database: config.database, backup_file: backupFile, bytes: stat.size, sha256, retention_candidates: retentionCandidates.length, retention_applied: hasFlag("apply-retention") }));
    } catch (error) {
        if (config?.backupDirectory && fs.existsSync(config.backupDirectory)) await appendLog(config.backupDirectory, { timestamp: new Date().toISOString(), event: "BACKUP_FAILED", database: config.database, reason: String(error.message).replace(/password[^\s]*/ig, "[redacted]") }).catch(() => {});
        throw error;
    } finally {
        if (defaultsFile) await fsp.unlink(defaultsFile).catch(() => {});
        if (lockHandle) { await lockHandle.close().catch(() => {}); await fsp.unlink(lock).catch(() => {}); }
    }
}

main().catch(error => { console.error(`Backup failed: ${String(error.message).replace(/password[^\s]*/ig, "[redacted]")}`); process.exit(1); });
