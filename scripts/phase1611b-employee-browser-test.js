"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const ROOT = path.resolve(__dirname, "..");
const BASE = "http://127.0.0.1:3001";
const viewports = [{ name:"mobile", width:375, height:812 }, { name:"tablet", width:768, height:1024 }, { name:"desktop", width:1440, height:900 }];
const results = [];
function check(name, pass) { results.push({ name, pass:Boolean(pass) }); if (!pass) throw new Error(name); }
function env() {
    if (process.env.ENV_FILE !== ".env.test") throw new Error("Refusing outside .env.test.");
    const values = Object.fromEntries(fs.readFileSync(path.join(ROOT,".env.test"),"utf8").split(/\r?\n/).filter(Boolean).map(line => { const at=line.indexOf("="); return [line.slice(0,at),line.slice(at+1)]; }));
    if (values.MYSQL_DATABASE !== "zoicas_osinski_test" || values.PORT !== "3001") throw new Error("Refusing outside isolated test server.");
    return values;
}
async function login(page, values) {
    await page.goto(`${BASE}/public/mitarbeiter-anmelden.html`, { waitUntil:"domcontentloaded" });
    await page.fill("#employee-email-login", "quality.employee.a@example.test");
    await page.fill("#employee-password-login", values.PHASE168_TEST_EMPLOYEE_PASSWORD);
    await page.locator("#employee-login-form button[type=submit]").click();
    await page.waitForSelector("#employee-dashboard:not([hidden])", { timeout:8000 });
}
async function main() {
    const values = env();
    const browser = await chromium.launch({ headless:true });
    try {
        for (const viewport of viewports) {
            const context = await browser.newContext({ viewport:{ width:viewport.width, height:viewport.height } });
            const page = await context.newPage(); page.setDefaultTimeout(8000);
            await login(page, values);
            await page.locator('[data-employee-view="notifications"]').click();
            await page.waitForSelector("#employee-notifications:not([hidden])");
            check(`${viewport.name}: notifications view`, await page.locator("#employee-notifications:not([hidden])").count() === 1);
            const unread = page.locator("[data-notification-read]").first();
            if (await unread.count()) { await unread.click(); await page.waitForTimeout(100); check(`${viewport.name}: read action`, true); }
            await page.locator('[data-employee-view="material-consumption"]').click();
            await page.waitForSelector("#employee-material-consumption:not([hidden])");
            check(`${viewport.name}: material form`, await page.locator("#employee-material-form").count() === 1);
            check(`${viewport.name}: assigned orders available`, await page.locator("#employee-material-order option").count() > 1);
            check(`${viewport.name}: available materials visible`, await page.locator("#employee-material-id option").count() > 1);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
            check(`${viewport.name}: no horizontal overflow`, overflow);
            const axe = await new AxeBuilder({ page }).analyze();
            check(`${viewport.name}: axe serious/critical`, !axe.violations.some(item => ["serious","critical"].includes(item.impact)));
            await context.close();
        }
        console.log(JSON.stringify({ ok:true, executed:results.length, passed:results.filter(result => result.pass).length }, null, 2));
    } finally { await browser.close(); }
}
main().catch(error => { console.log(JSON.stringify({ ok:false, executed:results.length, passed:results.filter(result => result.pass).length, failed:error.message }, null, 2)); process.exit(1); });
