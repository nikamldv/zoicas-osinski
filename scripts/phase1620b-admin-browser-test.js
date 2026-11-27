"use strict";

const {chromium} = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
const path = require("node:path");
const base = "http://127.0.0.1:3001";
const attendanceRoute = url => url.pathname === "/api/admin/attendance";
const viewports = [{width:375,height:812},{width:768,height:1024},{width:1440,height:900}];
const results = [];

function check(name, pass) {
    results.push({name, pass: Boolean(pass)});
}

async function main() {
    process.loadEnvFile(path.join(__dirname, "..", ".env.test"));
    const env = process.env;
    if (env.ENV_FILE !== ".env.test" || env.MYSQL_DATABASE !== "zoicas_osinski_test" || env.PORT !== "3001" || env.MYSQL_HOST !== "127.0.0.1") throw Error("Refusing outside isolated test configuration.");
    const health = await fetch(base + "/api/health").then(r => r.json());
    if (health.status !== "ok" || health.database !== "connected") throw Error("Test server unhealthy.");
    const login = await fetch(base + "/api/admin/login", {
        method:"POST", headers:{Origin:base,"Content-Type":"application/json"},
        body:JSON.stringify({username:env.ADMIN_USERNAME,password:env.PHASE168_TEST_ADMIN_PASSWORD})
    });
    if (!login.ok) throw Error("Admin test login failed: " + login.status);
    const [name,value] = login.headers.get("set-cookie").split(";")[0].split("=");
    const browser = await chromium.launch();
    try {
        for (const viewport of viewports) {
            const context = await browser.newContext({viewport});
            try {
                await context.route(url => url.origin !== base, route => route.abort());
                await context.addCookies([{name,value,url:base}]);
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                await page.goto(base + "/admin.html", {waitUntil:"domcontentloaded"});
                await page.locator('[data-type="attendance"]').click();
                const resultsRegion = page.getByRole("region", {name:"Anwesenheit & Check-ins", exact:true}).locator("table").first();
                await resultsRegion.locator("tbody tr").first().waitFor();
                check(viewport.width + " live overview", await resultsRegion.isVisible());
                check(viewport.width + " no page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                const tableRegion = page.locator("#attendance-results");
                await page.locator("#attendance-clear").focus();
                await page.keyboard.press("Tab");
                check(viewport.width + " keyboard reaches table", await tableRegion.evaluate(el => document.activeElement === el));
                check(viewport.width + " table focus visible", await tableRegion.evaluate(el => el.matches(":focus-visible") && getComputedStyle(el).outlineStyle !== "none"));
                const axe = await new AxeBuilder({page}).include("#attendance-panel").analyze();
                const serious = axe.violations.filter(v => ["serious","critical"].includes(v.impact));
                check(viewport.width + " axe" + (serious.length ? " " + JSON.stringify(serious.map(v=>({id:v.id, targets:v.nodes.map(n=>n.target)}))) : ""), !serious.length);
                if (viewport.width === 1440) {
                    let release;
                    const pending = new Promise(resolve => { release = resolve; });
                    await page.route(attendanceRoute, async route => {
                        await pending;
                        await route.fulfill({json:{rows:[],total:0,page:1,page_size:25,total_pages:1}});
                    });
                    const started = page.waitForRequest(r => attendanceRoute(new URL(r.url())));
                    const refresh = page.locator("#attendance-refresh");
                    const message = page.locator("#attendance-message");
                    await refresh.click();
                    await started;
                    try {
                        check("Loading is visible and announced", await message.isVisible() && /wird geladen/.test(await message.innerText()) && await tableRegion.getAttribute("aria-busy") === "true");
                    } finally { release(); }
                    await page.locator("#attendance-empty").waitFor();
                    check("Empty response clears loading state", await tableRegion.getAttribute("aria-busy") === null && !await message.isVisible());
                    await page.unroute(attendanceRoute);
                    await page.route(attendanceRoute, route => route.fulfill({status:500,json:{message:"Synthetischer Testfehler"}}));
                    await refresh.click();
                    await message.getByText("Synthetischer Testfehler").waitFor();
                    check("Error is announced and clears busy state", await message.getAttribute("aria-live") === "polite" && await tableRegion.getAttribute("aria-busy") === null);
                }
            } catch (error) {
                console.error(viewport.width, error.message);
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
}

main().catch(error => console.error(error.message)).finally(() => {
    const failed = results.filter(result => !result.pass);
    console.log(JSON.stringify({passed:results.length-failed.length, failed:failed.length, skipped:18-results.length, failures:failed.map(r=>r.name)}, null, 2));
    if (failed.length || results.length !== 18) process.exitCode = 1;
});

