"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const mysql = require("mysql2/promise");

const ROOT = path.resolve(__dirname, "..");
const TEST_DATABASE = "zoicas_osinski_test";
const PRODUCTION_DATABASE = "zoicas_osinski";
function arg(name) { const prefix = `--${name}=`; return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length); }
function readEnv(file) { const values = {}; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const i = line.indexOf("="); if (i > 0 && !line.trimStart().startsWith("#")) values[line.slice(0, i).trim()] = line.slice(i + 1).trim(); } return values; }
function inside(candidate, base) { const resolved = path.resolve(candidate); return resolved === base || resolved.startsWith(base + path.sep); }
function dbName(value) { if (!/^[A-Za-z0-9_]+$/.test(value || "")) throw new Error("Invalid database name."); return value; }
function client(binDir, name) { const full = path.resolve(binDir, `${name}.exe`); if (!fs.existsSync(full)) throw new Error(`${name}.exe was not found in MYSQL_BIN_DIR.`); return full; }
function run(executable, args, input) { return new Promise((resolve, reject) => { const child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] }); let stderr = ""; child.stderr.on("data", data => { stderr += data.toString("utf8"); }); child.on("error", reject); if (input) input.pipe(child.stdin); else child.stdin.end(); child.on("close", code => code === 0 ? resolve() : reject(new Error(`mysql_client_exit_${code}${stderr ? ": " + stderr.split(/\r?\n/)[0].replace(/password[^\s]*/ig, "[redacted]") : ""}`))); }); }
async function temporaryDefaults(config) { const file = path.join(os.tmpdir(), `zoicas-restore-${process.pid}-${crypto.randomUUID()}.cnf`); await fsp.writeFile(file, `[client]\nhost=${config.host}\nport=${config.port}\nuser=${config.user}\npassword=${config.password}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); return file; }
async function main() {
    const configArg = arg("config"), adminConfigArg = arg("recovery-admin-config"), sourceArg = arg("source"), recoveryDatabase = dbName(arg("recovery-database"));
    if (!configArg || !adminConfigArg || !sourceArg || !recoveryDatabase) throw new Error("Required: --config=.env.test --recovery-admin-config=.env.recovery.test --test --source=<backup.sql> --recovery-database=<new_database>.");
    if (!process.argv.includes("--test") || path.basename(configArg) !== ".env.test") throw new Error("Restore is restricted to the isolated .env.test environment.");
    if ([PRODUCTION_DATABASE, TEST_DATABASE].includes(recoveryDatabase) || !recoveryDatabase.startsWith("zoicas_osinski_recovery_")) throw new Error("Recovery database must be a new zoicas_osinski_recovery_* database.");
    const configPath = path.resolve(ROOT, configArg); if (!inside(configPath, ROOT) || !fs.existsSync(configPath)) throw new Error("Invalid isolated configuration.");
    const adminConfigPath = path.resolve(ROOT, adminConfigArg); if (!inside(adminConfigPath, ROOT) || path.basename(adminConfigPath) !== ".env.recovery.test" || !fs.existsSync(adminConfigPath)) throw new Error("An isolated .env.recovery.test administrator configuration is required.");
    const values = readEnv(configPath);
    const adminValues = readEnv(adminConfigPath);
    if (values.MYSQL_DATABASE !== TEST_DATABASE || !adminValues.MYSQL_RECOVERY_USER || !adminValues.MYSQL_RECOVERY_PASSWORD) throw new Error("Restore requires isolated test source settings and recovery administrator settings.");
    const backupDir = path.resolve(ROOT, values.BACKUP_DIRECTORY || "storage/database-backups"), source = path.resolve(ROOT, sourceArg);
    if (!inside(source, backupDir) || !fs.existsSync(source) || path.extname(source).toLowerCase() !== ".sql") throw new Error("Source backup must be an existing .sql file in the private backup directory.");
    const binDir = adminValues.MYSQL_BIN_DIR || values.MYSQL_BIN_DIR || "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin", config = { host: adminValues.MYSQL_RECOVERY_HOST, port: adminValues.MYSQL_RECOVERY_PORT || "3306", user: adminValues.MYSQL_RECOVERY_USER, password: adminValues.MYSQL_RECOVERY_PASSWORD };
    const connection = await mysql.createConnection({ host: config.host, port: Number(config.port), user: config.user, password: config.password, charset: "utf8mb4" });
    let defaultsFile;
    try {
        const [exists] = await connection.execute("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [recoveryDatabase]);
        if (exists[0]) throw new Error("Recovery database already exists; refusing to overwrite it.");
        await connection.query(`CREATE DATABASE \`${recoveryDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        defaultsFile = await temporaryDefaults(config);
        await run(client(binDir, "mysql"), [`--defaults-extra-file=${defaultsFile}`, `--database=${recoveryDatabase}`, "--default-character-set=utf8mb4"], fs.createReadStream(source));
        const [[sourceTables]] = await connection.execute("SELECT COUNT(*) total FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'", [TEST_DATABASE]);
        const [[recoveryTables]] = await connection.execute("SELECT COUNT(*) total FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'", [recoveryDatabase]);
        if (Number(sourceTables.total) !== Number(recoveryTables.total) || !Number(recoveryTables.total)) throw new Error("Restore integrity check failed: table count mismatch.");
        const [sourceRows] = await connection.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [TEST_DATABASE]);
        const [recoveryRows] = await connection.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [recoveryDatabase]);
        const recoveryNames = new Set(recoveryRows.map(row => row.TABLE_NAME));
        if (sourceRows.some(row => !recoveryNames.has(row.TABLE_NAME))) throw new Error("Restore integrity check failed: table names mismatch.");
        for (const row of sourceRows) {
            const table = row.TABLE_NAME.replace(/`/g, "``");
            const [[sourceCount]] = await connection.query(`SELECT COUNT(*) total FROM \`${TEST_DATABASE}\`.\`${table}\``);
            const [[recoveryCount]] = await connection.query(`SELECT COUNT(*) total FROM \`${recoveryDatabase}\`.\`${table}\``);
            if (Number(sourceCount.total) !== Number(recoveryCount.total)) throw new Error("Restore integrity check failed: row count mismatch.");
        }
        console.log(JSON.stringify({ ok: true, source_database: TEST_DATABASE, recovery_database: recoveryDatabase, table_count: Number(recoveryTables.total), row_count_integrity: true }));
    } finally { if (defaultsFile) await fsp.unlink(defaultsFile).catch(() => {}); await connection.end(); }
}
main().catch(error => { console.error(`Restore failed: ${String(error.message).replace(/password[^\s]*/ig, "[redacted]")}`); process.exit(1); });
