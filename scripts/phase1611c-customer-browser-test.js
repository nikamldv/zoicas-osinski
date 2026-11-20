"use strict";

// Controlled browser validation for Phase 16.11C. Uses only .env.test / port 3001.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const ROOT = path.resolve(__dirname, "..");
const BASE = "http://127.0.0.1:3001";
const DATABASE = "zoicas_osinski_test";
const PASSWORD = "Phase1611C-Browser-Password!2026";
const results = [];
function check(name, pass, detail = "") { results.push({ name, pass: Boolean(pass), detail }); if (!pass) throw new Error(name); }
function env() {
    if (process.env.ENV_FILE !== ".env.test") throw new Error("Refusing outside .env.test.");
    for (const line of fs.readFileSync(path.join(ROOT, ".env.test"), "utf8").split(/\r?\n/)) { const at = line.indexOf("="); if (at > 0) process.env[line.slice(0, at)] = line.slice(at + 1); }
    if (process.env.MYSQL_DATABASE !== DATABASE || process.env.PORT !== "3001") throw new Error("Refusing non-isolated browser test.");
}
function hash(password) { return new Promise((resolve, reject) => { const salt = crypto.randomBytes(16); crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`)); }); }
async function setup() {
    const db = await mysql.createConnection({ host:process.env.MYSQL_HOST, port:Number(process.env.MYSQL_PORT || 3306), user:process.env.MYSQL_ADMIN_USER, password:process.env.MYSQL_ADMIN_PASSWORD, database:DATABASE });
    const stamp = Date.now(), email = `phase1611c-browser-${stamp}@example.test`;
    const [customer] = await db.execute("INSERT INTO customers(customer_number,first_name,last_name,email,phone,password_hash,status,address,postal_code,city) VALUES (?,?,?,?,?,?,'active',?,?,?)", [`TEST-P1611C-B-${stamp}`,"Browser","Customer",email,"+493333333",await hash(PASSWORD),"Browserweg 1","12345","Teststadt"]);
    for (let i = 1; i <= 3; i += 1) await db.execute("INSERT INTO quotes(quote_number,customer_id,service_description,service_type,net_amount,tax_amount,gross_amount,status) VALUES (?,?,?,?,?,?,?,'GESENDET')", [`TEST-P1611C-BQ-${stamp}-${i}`,customer.insertId,"TEST DATA – Phase 16.11C Browser","Reinigung",100,19,119]);
    const [invoice] = await db.execute("INSERT INTO invoices(invoice_number,customer_id,customer_name_snapshot,invoice_date,due_date,status,net_amount,tax_amount,gross_amount,paid_amount,outstanding_amount,notes) VALUES (?,?,?,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 14 DAY),'GESENDET',100,19,119,0,119,?)", [`TEST-P1611C-BI-${stamp}`,customer.insertId,"Browser Customer","TEST DATA – Phase 16.11C Browser"]);
    await db.execute("INSERT INTO invoice_items(invoice_id,sort_order,title,quantity,unit,unit_price,discount_amount,net_amount,tax_rate,tax_amount,gross_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [invoice.insertId,1,"TEST DATA – Reinigung",1,"Pauschale",100,0,100,19,19,119]);
    await db.end(); return { email };
}
async function login(page, email) {
    await page.goto(`${BASE}/public/kunden-anmelden.html`, { waitUntil:"domcontentloaded" });
    await page.locator('#customer-login input[name="email"]').fill(email);
    await page.locator('#customer-login input[name="password"]').fill(PASSWORD);
    await page.locator("#customer-login button").click();
    await page.waitForSelector("#customer-dashboard", { timeout:8000 });
}
async function noOverflow(page, name) { const size = await page.evaluate(() => ({ width:document.documentElement.scrollWidth, client:document.documentElement.clientWidth })); check(`${name}: no horizontal overflow`, size.width <= size.client + 1, `${size.width}/${size.client}`); }
async function main() {
    env(); const fixture = await setup();
    const browser = await chromium.launch({ headless:true });
    try {
        for (const viewport of [{name:"mobile",width:375,height:812},{name:"tablet",width:768,height:1024},{name:"desktop",width:1440,height:900}]) {
            const context = await browser.newContext({ viewport:{width:viewport.width,height:viewport.height}, acceptDownloads:true });
            const page = await context.newPage(); page.setDefaultTimeout(8000);
            await login(page, fixture.email); check(`${viewport.name}: portal login`, true); await noOverflow(page, viewport.name);
            await page.locator('[data-portal-view="quotes"]').click(); await page.waitForSelector("[data-quote-id]");
            await page.locator("[data-quote-id]").first().click(); await page.waitForSelector("[data-reject-quote]");
            check(`${viewport.name}: rejection control visible`, await page.locator("[data-reject-quote]").count() === 1);
            if (viewport.name === "mobile") {
                page.on("dialog", async dialog => { if (dialog.type() === "confirm") await dialog.accept(); else await dialog.accept("TEST DATA – browser rejection"); });
                await page.locator("[data-reject-quote]").click(); await page.waitForFunction(() => document.querySelector("#portal-description")?.textContent.includes("abgelehnt"));
                check("mobile: quote rejection status updated", await page.locator("#portal-data").textContent().then(text => text.includes("ABGELEHNT")));
            }
            await page.locator('[data-portal-view="invoices"]').click(); await page.waitForSelector("[data-invoice-id]"); await page.locator("[data-invoice-id]").click();
            const downloadPromise = page.waitForEvent("download"); await page.getByText("Rechnung herunterladen").click(); const download = await downloadPromise;
            check(`${viewport.name}: private invoice PDF download`, (await download.suggestedFilename()).endsWith(".pdf"));
            await page.locator('[data-portal-view="profile"]').click(); await page.waitForSelector("#customer-password-form");
            check(`${viewport.name}: password form labels`, await page.locator("#customer-password-form label").count() === 3);
            const axe = await new AxeBuilder({ page }).analyze();
            check(`${viewport.name}: no serious axe issues`, !axe.violations.some(v => ["serious","critical"].includes(v.impact)), axe.violations.map(v => v.id).join(","));
            await context.close();
        }
        console.log(JSON.stringify({ ok:true, executed:results.length, passed:results.filter(result=>result.pass).length },null,2));
    } finally { await browser.close(); }
}
main().catch(error => { console.log(JSON.stringify({ ok:false, executed:results.length, passed:results.filter(result=>result.pass).length, failed:error.message },null,2)); process.exit(1); });
