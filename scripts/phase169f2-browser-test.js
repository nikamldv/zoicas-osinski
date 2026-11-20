"use strict";

/* Controlled browser verification: test server/database only, no screenshots. */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.test");
const BASE_URL = "http://127.0.0.1:3001";
const VIEWPORTS = [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 }
];

function loadTestEnvironment() {
    const values = Object.fromEntries(fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/).filter(Boolean).map(line => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
    }));
    if (values.MYSQL_DATABASE !== "zoicas_osinski_test" || values.PORT !== "3001") {
        throw new Error("Refusing browser checks outside zoicas_osinski_test on port 3001.");
    }
    for (const key of ["ADMIN_USERNAME", "PHASE168_TEST_ADMIN_PASSWORD", "PHASE168_TEST_EMPLOYEE_PASSWORD", "PHASE168_TEST_CUSTOMER_PASSWORD"]) {
        if (!values[key]) throw new Error(`Missing isolated test configuration: ${key}`);
    }
    return values;
}

const results = [];
function check(label, condition, details = "") {
    results.push({ label, pass: Boolean(condition), details: String(details || "") });
}

async function noHorizontalOverflow(page, label) {
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    check(`${label}: no horizontal overflow`, dimensions.scrollWidth <= dimensions.clientWidth + 1, `${dimensions.scrollWidth}/${dimensions.clientWidth}`);
}

async function adminLogin(page, env) {
    await page.goto(`${BASE_URL}/admin.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#login-username", env.ADMIN_USERNAME);
    await page.fill("#login-password", env.PHASE168_TEST_ADMIN_PASSWORD);
    await page.locator("#login-form button[type=submit]").click();
    await page.waitForSelector("#dashboard-view:not([hidden])", { timeout: 8000 });
}

async function employeeLogin(page, env) {
    await page.goto(`${BASE_URL}/public/mitarbeiter-anmelden.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#employee-email-login", "quality.employee.a@example.test");
    await page.fill("#employee-password-login", env.PHASE168_TEST_EMPLOYEE_PASSWORD);
    await page.locator("#employee-login-form button[type=submit]").click();
    await page.waitForSelector("#employee-dashboard:not([hidden])", { timeout: 8000 });
}

async function customerLogin(page, env) {
    await page.goto(`${BASE_URL}/public/kunden-anmelden.html`, { waitUntil: "domcontentloaded" });
    await page.fill("#customer-login input[name=email]", "quality.customer@example.test");
    await page.fill("#customer-login input[name=password]", env.PHASE168_TEST_CUSTOMER_PASSWORD);
    await page.locator("#customer-login button").click();
    await page.waitForSelector("#customer-dashboard", { timeout: 8000 });
}

async function assessAxe(page, label) {
    const report = await new AxeBuilder({ page }).analyze();
    check(`${label}: axe critical/serious violations`, !report.violations.some(item => ["critical", "serious"].includes(item.impact)), report.violations.map(item => `${item.id}:${item.impact}`).join(", "));
}

async function testAdmin(browser, env, viewport) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    try {
        await adminLogin(page, env);
        console.error(`admin ${viewport.name}: logged in`);
        check(`admin ${viewport.name}: dashboard`, await page.locator("#dashboard-view:not([hidden])").count() === 1);
        await noHorizontalOverflow(page, `admin ${viewport.name}`);
        const types = ["customer", "employee", "order", "recurring", "appointment", "quote", "invoice", "materials", "document", "quality", "action-center", "reporting"];
        for (const type of types) {
            const item = page.locator(`[data-type="${type}"]`);
            const present = await item.count() === 1;
            check(`admin ${viewport.name}: navigation ${type}`, present);
            if (present) {
                console.error(`admin ${viewport.name}: ${type}`);
                await item.click();
                await page.waitForTimeout(80);
                check(`admin ${viewport.name}: active ${type}`, await item.evaluate(node => node.classList.contains("is-active")));
            }
        }
        console.error(`admin ${viewport.name}: material modal`);
        await page.locator('[data-type="materials"]').click();
        await page.waitForSelector("#create-material-button:not([hidden])", { timeout: 8000 });
        await page.locator("#create-material-button").click();
        check(`admin ${viewport.name}: material modal opens`, await page.locator("#material-dialog[open]").count() === 1);
        await page.locator("#material-form button[type=submit]").click();
        check(`admin ${viewport.name}: required validation`, await page.locator("#material-dialog :invalid").count() > 0);
        await page.keyboard.press("Escape");
        check(`admin ${viewport.name}: modal closes with Escape`, await page.locator("#material-dialog[open]").count() === 0);
        check(`admin ${viewport.name}: focus returns after modal`, await page.evaluate(() => document.activeElement?.id === "create-material-button"));
        await page.keyboard.press("Tab");
        check(`admin ${viewport.name}: keyboard focus`, await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
        if (viewport.name === "desktop") await assessAxe(page, "admin desktop");
        await page.locator("#logout-button").click();
        await page.waitForSelector("#login-view:not([hidden])", { timeout: 5000 });
        check(`admin ${viewport.name}: logout`, true);
    } finally { await context.close(); }
}

async function testEmployee(browser, env, viewport) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    try {
        await employeeLogin(page, env);
        await noHorizontalOverflow(page, `employee ${viewport.name}`);
        for (const view of ["tasks", "appointments", "orders", "service-reports", "quality-actions", "schedule", "work", "documents", "cash-payments", "profile"]) {
            const item = page.locator(`[data-employee-view="${view}"]`);
            check(`employee ${viewport.name}: navigation ${view}`, await item.count() === 1);
            await item.click();
            await page.waitForTimeout(80);
            check(`employee ${viewport.name}: view ${view}`, await page.locator(`#employee-${view}:not([hidden])`).count() === 1);
        }
        await page.locator('[data-employee-view="work"]').click();
        await page.locator("#work-log-form button[type=submit]").click();
        check(`employee ${viewport.name}: required validation`, await page.locator("#work-log-form :invalid").count() > 0);
        await page.keyboard.press("Tab");
        check(`employee ${viewport.name}: keyboard focus`, await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
        if (viewport.name === "desktop") await assessAxe(page, "employee desktop");
        await page.locator("#employee-logout").click();
        await page.waitForURL(/mitarbeiter-anmelden\.html/, { timeout: 5000 });
        check(`employee ${viewport.name}: logout`, true);
    } finally { await context.close(); }
}

async function testCustomer(browser, env, viewport) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    try {
        await customerLogin(page, env);
        await noHorizontalOverflow(page, `customer ${viewport.name}`);
        for (const view of ["appointments", "quotes", "orders", "invoices", "documents", "messages", "notifications", "profile"]) {
            const item = page.locator(`[data-portal-view="${view}"]`);
            check(`customer ${viewport.name}: navigation ${view}`, await item.count() === 1);
            await item.click();
            await page.waitForTimeout(80);
            check(`customer ${viewport.name}: view ${view}`, await page.locator("#portal-title").textContent().then(Boolean));
        }
        await page.keyboard.press("Tab");
        check(`customer ${viewport.name}: keyboard focus`, await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
        if (viewport.name === "desktop") await assessAxe(page, "customer desktop");
        await page.locator("#customer-logout").click();
        await page.waitForURL(/kundenportal\.html/, { timeout: 5000 });
        check(`customer ${viewport.name}: logout`, true);
    } finally { await context.close(); }
}

async function main() {
    const env = loadTestEnvironment();
    const health = await fetch(`${BASE_URL}/api/health`).then(response => response.json());
    check("test server health", health.status === "ok" && health.database === "connected");
    const browser = await chromium.launch({ headless: true });
    try {
        for (const viewport of VIEWPORTS) {
            console.error(`Running ${viewport.name} browser checks`);
            console.error(`Running ${viewport.name} admin`);
            await testAdmin(browser, env, viewport);
            console.error(`Running ${viewport.name} employee`);
            await testEmployee(browser, env, viewport);
            console.error(`Running ${viewport.name} customer`);
            await testCustomer(browser, env, viewport);
        }
    } finally { await browser.close(); }
    const failed = results.filter(result => !result.pass);
    console.log(JSON.stringify({ ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed, results }, null, 2));
    if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exit(1); });
