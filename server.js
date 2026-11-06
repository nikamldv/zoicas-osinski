"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const ROOT = __dirname;
const STATIC_ROOTS = ["public", "assets", "Css", "js"]
    .map(directory => path.resolve(ROOT, directory));

if (fs.existsSync(path.join(ROOT, ".env")) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(path.join(ROOT, ".env"));
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 6;
const rateBuckets = new Map();
const ADMIN_SESSION_COOKIE = "zo_admin_session";
const configuredAdminSessionTtl = Number(process.env.ADMIN_SESSION_TTL_MINUTES || 480);
const ADMIN_SESSION_TTL_MINUTES = Number.isFinite(configuredAdminSessionTtl)
    ? Math.min(Math.max(configuredAdminSessionTtl, 15), 720)
    : 480;
const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_MINUTES * 60 * 1000;
const adminSessions = new Map();
const adminLoginBuckets = new Map();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_HASH_MATCH = ADMIN_PASSWORD_HASH.match(/^scrypt\$([a-f\d]{32})\$([a-f\d]{128})$/i);
const adminAuthConfigured = Boolean(ADMIN_USERNAME && ADMIN_HASH_MATCH);
const secureAdminCookie = process.env.COOKIE_SECURE === "true"
    || (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production");

const mysql = require("mysql2/promise");
const databaseConfigured = Boolean(
    process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE
);
const adminDatabaseConfigured = Boolean(
    process.env.MYSQL_HOST && process.env.MYSQL_ADMIN_USER && process.env.MYSQL_DATABASE
);

function createPool(user, password) {
    return mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user,
        password,
        database: process.env.MYSQL_DATABASE,
        charset: "utf8mb4",
        waitForConnections: true,
        connectionLimit: Math.min(Math.max(Number(process.env.MYSQL_CONNECTION_LIMIT || 10), 1), 30),
        queueLimit: 50,
        ssl: process.env.MYSQL_SSL === "true"
            ? {
                rejectUnauthorized: true,
                ...(process.env.MYSQL_SSL_CA
                    ? { ca: fs.readFileSync(path.resolve(process.env.MYSQL_SSL_CA), "utf8") }
                    : {})
            }
            : undefined
    });
}

const pool = databaseConfigured
    ? createPool(process.env.MYSQL_USER, process.env.MYSQL_PASSWORD || "")
    : null;
const adminPool = adminDatabaseConfigured
    ? createPool(process.env.MYSQL_ADMIN_USER, process.env.MYSQL_ADMIN_PASSWORD || "")
    : null;

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

const contactServices = new Set([
    "Haushaltshilfe",
    "Reinigungsservice",
    "Haushaltsaufl?sung",
    "Entr?mpelung",
    "Renovierung & Modernisierung",
    "Sonstiges"
]);
const careerAreas = new Set([
    "Reinigung",
    "Haushaltshilfe",
    "Entr?mpelung",
    "Renovierung",
    "Sonstiger Bereich"
]);

function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(body);
}

function isSameOriginRequest(request) {
    const origin = request.headers.origin;
    const host = String(request.headers.host || "").toLowerCase();
    if (!origin || !host) return false;
    try {
        return new URL(origin).host.toLowerCase() === host;
    } catch {
        return false;
    }
}

function setAdminCookie(response, token, maxAge) {
    const attributes = [
        `${ADMIN_SESSION_COOKIE}=${token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${maxAge}`
    ];
    if (secureAdminCookie) attributes.push("Secure");
    response.setHeader("Set-Cookie", attributes.join("; "));
}

function readAdminSession(request) {
    const header = String(request.headers.cookie || "");
    const entry = header.split(";").map(value => value.trim()).find(
        value => value.startsWith(`${ADMIN_SESSION_COOKIE}=`)
    );
    if (!entry) return null;

    const token = entry.slice(ADMIN_SESSION_COOKIE.length + 1);
    const session = adminSessions.get(token);
    if (!session || Date.now() >= session.expiresAt) {
        adminSessions.delete(token);
        return null;
    }
    return { token, ...session };
}

function takeAdminLoginRateLimit(request) {
    const key = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = adminLoginBuckets.get(key);
    if (!bucket || now >= bucket.expiresAt) {
        bucket = { count: 0, expiresAt: now + RATE_WINDOW_MS };
        adminLoginBuckets.set(key, bucket);
    }
    if (bucket.count >= 8) return true;
    bucket.count += 1;

    if (adminLoginBuckets.size > 2000) {
        for (const [address, oldBucket] of adminLoginBuckets) {
            if (now >= oldBucket.expiresAt) adminLoginBuckets.delete(address);
        }
    }
    return false;
}

async function verifyAdminCredentials(username, password) {
    if (!adminAuthConfigured) return false;
    const expectedUsername = Buffer.from(ADMIN_USERNAME, "utf8");
    const providedUsername = Buffer.from(username, "utf8");
    const usernameMatches = expectedUsername.length === providedUsername.length
        && crypto.timingSafeEqual(expectedUsername, providedUsername);

    const salt = Buffer.from(ADMIN_HASH_MATCH[1], "hex");
    const expectedPasswordHash = Buffer.from(ADMIN_HASH_MATCH[2], "hex");
    const actualPasswordHash = await new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, expectedPasswordHash.length, (error, key) => {
            if (error) reject(error);
            else resolve(key);
        });
    });
    const passwordMatches = crypto.timingSafeEqual(expectedPasswordHash, actualPasswordHash);
    return usernameMatches && passwordMatches;
}

function adminSessionOrRespond(request, response) {
    const session = readAdminSession(request);
    if (!session) {
        sendJson(response, 401, { message: "Bitte melden Sie sich erneut an." });
        return null;
    }
    return session;
}

function adminDatabaseErrorMessage(error, fallback) {
    if (["ER_ACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR"].includes(error.code)) {
        return "Das MySQL-Dashboardkonto fehlt noch oder benötigt SELECT-Rechte auf die Anfrage-Tabellen.";
    }
    return fallback;
}

function takeRateLimit(request) {
    const key = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = rateBuckets.get(key);

    if (!bucket || now >= bucket.expiresAt) {
        bucket = { count: 0, expiresAt: now + RATE_WINDOW_MS };
        rateBuckets.set(key, bucket);
    }

    if (bucket.count >= RATE_LIMIT) {
        return Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
    }

    bucket.count += 1;

    if (rateBuckets.size > 2000) {
        for (const [ip, oldBucket] of rateBuckets) {
            if (now >= oldBucket.expiresAt) rateBuckets.delete(ip);
        }
    }

    return 0;
}

async function readJson(request) {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
        const error = new Error("Unsupported content type");
        error.statusCode = 415;
        throw error;
    }

    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            const error = new Error("Request body too large");
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }

    try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
        return value;
    } catch {
        const error = new Error("Invalid JSON");
        error.statusCode = 400;
        throw error;
    }
}

function readText(value, maxLength, { optional = false, multiline = false } = {}) {
    if (typeof value !== "string") return optional ? "" : null;
    const normalized = value.normalize("NFC").replace(/\u0000/g, "").trim();
    if (optional && normalized === "") return "";
    if (normalized.length > maxLength) return null;
    if (!multiline && /[\r\n]/.test(normalized)) return null;
    return normalized;
}

function validateEmail(value) {
    const email = readText(value, 254);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email)) return null;
    return email.toLowerCase();
}

function validateContact(body) {
    const name = readText(body.name, 120);
    const email = validateEmail(body.email);
    const service = readText(body.service, 80);
    const message = readText(body.message, 4000, { multiline: true });

    if (!name || name.length < 2 || !email || !contactServices.has(service) || !message || message.length < 5) {
        return null;
    }
    return { name, email, service, message };
}

function validateCareer(body) {
    const name = readText(body.name, 120);
    const email = validateEmail(body.email);
    const phone = readText(body.phone, 40, { optional: true });
    const area = readText(body.area, 80);
    const message = readText(body.message, 4000, { multiline: true });

    if (!name || name.length < 2 || !email || !careerAreas.has(area) || !message || message.length < 5) {
        return null;
    }
    if (phone && !/^[+0-9()\/ .-]{5,40}$/.test(phone)) return null;
    return { name, email, phone: phone || null, area, message };
}

async function handleAdminApi(request, response, pathname, searchParams) {
    if (pathname === "/api/admin/login") {
        if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            return sendJson(response, 405, { message: "Methode nicht erlaubt." });
        }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        if (!adminAuthConfigured) {
            return sendJson(response, 503, { message: "Der Administratorzugang ist noch nicht eingerichtet." });
        }
        if (takeAdminLoginRateLimit(request)) {
            response.setHeader("Retry-After", String(Math.ceil(RATE_WINDOW_MS / 1000)));
            return sendJson(response, 429, { message: "Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut." });
        }

        let body;
        try {
            body = await readJson(request);
        } catch (error) {
            return sendJson(response, error.statusCode || 400, { message: "Die Anmeldedaten konnten nicht gelesen werden." });
        }

        const username = readText(body.username, 80);
        const password = typeof body.password === "string" && body.password.length <= 256
            ? body.password
            : null;
        if (!username || !password) return sendJson(response, 401, { message: "Benutzername oder Passwort ist falsch." });

        let validCredentials = false;
        try {
            validCredentials = await verifyAdminCredentials(username, password);
        } catch (error) {
            console.error("[admin] password verification failed:", error.code || "verification_error");
            return sendJson(response, 503, { message: "Die Anmeldung ist derzeit nicht verfügbar." });
        }
        if (!validCredentials) return sendJson(response, 401, { message: "Benutzername oder Passwort ist falsch." });

        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
        adminSessions.set(token, { username: ADMIN_USERNAME, expiresAt });
        if (request.socket.remoteAddress) adminLoginBuckets.delete(request.socket.remoteAddress);
        setAdminCookie(response, token, Math.floor(ADMIN_SESSION_TTL_MS / 1000));
        return sendJson(response, 200, { authenticated: true, username: ADMIN_USERNAME });
    }

    if (pathname === "/api/admin/session") {
        if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            return sendJson(response, 405, { message: "Methode nicht erlaubt." });
        }
        const session = readAdminSession(request);
        if (!session) return sendJson(response, 401, { authenticated: false });
        return sendJson(response, 200, { authenticated: true, username: session.username });
    }

    if (pathname === "/api/admin/logout") {
        if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            return sendJson(response, 405, { message: "Methode nicht erlaubt." });
        }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        const session = readAdminSession(request);
        if (session) adminSessions.delete(session.token);
        const clearCookie = [
            `${ADMIN_SESSION_COOKIE}=`,
            "Path=/",
            "HttpOnly",
            "SameSite=Strict",
            "Max-Age=0"
        ];
        if (secureAdminCookie) clearCookie.push("Secure");
        response.setHeader("Set-Cookie", clearCookie.join("; "));
        return sendJson(response, 200, { authenticated: false });
    }

    const session = adminSessionOrRespond(request, response);
    if (!session) return;

    if (pathname !== "/api/admin/summary" && pathname !== "/api/admin/submissions") {
        return sendJson(response, 404, { message: "API-Endpunkt nicht gefunden." });
    }
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return sendJson(response, 405, { message: "Methode nicht erlaubt." });
    }
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für das Dashboard sind noch nicht eingerichtet." });

    if (pathname === "/api/admin/summary") {
        try {
            const [contacts, newContacts, applications, newApplications] = await Promise.all([
                adminPool.execute("SELECT COUNT(*) AS total FROM contact_submissions"),
                adminPool.execute("SELECT COUNT(*) AS total FROM contact_submissions WHERE status = 'new'"),
                adminPool.execute("SELECT COUNT(*) AS total FROM career_applications"),
                adminPool.execute("SELECT COUNT(*) AS total FROM career_applications WHERE status = 'new'")
            ]);
            return sendJson(response, 200, {
                contacts: Number(contacts[0][0].total),
                newContacts: Number(newContacts[0][0].total),
                applications: Number(applications[0][0].total),
                newApplications: Number(newApplications[0][0].total)
            });
        } catch (error) {
            console.error("[admin] summary query failed:", error.code || "database_error");
            return sendJson(response, 503, {
                message: adminDatabaseErrorMessage(error, "Die Statistiken konnten nicht geladen werden.")
            });
        }
    }

    const type = searchParams.get("type") || "contact";
    const queryConfig = {
        contact: {
            table: "contact_submissions",
            columns: "id, full_name, email, requested_service, message, status, created_at",
            searchColumns: ["full_name", "email", "requested_service", "message"]
        },
        career: {
            table: "career_applications",
            columns: "id, full_name, email, phone, area, message, status, created_at",
            searchColumns: ["full_name", "email", "phone", "area", "message"]
        }
    }[type];
    const status = searchParams.get("status") || "all";
    const allowedStatuses = new Set(["new", "in_progress", "done"]);
    if (!queryConfig || (status !== "all" && !allowedStatuses.has(status))) {
        return sendJson(response, 400, { message: "Ungültige Filter." });
    }

    const pageValue = Number(searchParams.get("page") || 1);
    const page = Number.isSafeInteger(pageValue) ? Math.min(Math.max(pageValue, 1), 10000) : 1;
    const pageSize = 25;
    const search = (searchParams.get("search") || "").trim().slice(0, 100);
    const conditions = [];
    const values = [];
    if (status !== "all") {
        conditions.push("status = ?");
        values.push(status);
    }
    if (search) {
        conditions.push(`(${queryConfig.searchColumns.map(column => `${column} LIKE ?`).join(" OR ")})`);
        for (const _column of queryConfig.searchColumns) values.push(`%${search}%`);
    }
    const whereSql = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

    try {
        const [countRows] = await adminPool.execute(
            `SELECT COUNT(*) AS total FROM ${queryConfig.table}${whereSql}`,
            values
        );
        const [rows] = await adminPool.execute(
            `SELECT ${queryConfig.columns} FROM ${queryConfig.table}${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
            [...values, pageSize, (page - 1) * pageSize]
        );
        return sendJson(response, 200, {
            rows,
            total: Number(countRows[0].total),
            page,
            pageSize
        });
    } catch (error) {
        console.error("[admin] submission query failed:", error.code || "database_error");
        return sendJson(response, 503, {
            message: adminDatabaseErrorMessage(error, "Die Einträge konnten nicht geladen werden.")
        });
    }
}

async function handleApi(request, response, pathname, searchParams) {
    if (pathname.startsWith("/api/admin/")) {
        return await handleAdminApi(request, response, pathname, searchParams);
    }

    if (pathname === "/api/health" && request.method === "GET") {
        if (!pool) return sendJson(response, 503, { status: "degraded", database: "not_configured" });
        try {
            await pool.query("SELECT 1");
            return sendJson(response, 200, { status: "ok", database: "connected" });
        } catch (error) {
            console.error("[api] health check failed:", error.code || "database_error");
            return sendJson(response, 503, { status: "degraded", database: "unavailable" });
        }
    }

    const routes = {
        "/api/contact": {
            message: "Ihre Anfrage wurde übermittelt. Vielen Dank.",
            validate: validateContact,
            sql: "INSERT INTO contact_submissions (full_name, email, requested_service, message) VALUES (?, ?, ?, ?)",
            values: (data) => [data.name, data.email, data.service, data.message]
        },
        "/api/career": {
            message: "Ihre Bewerbung wurde übermittelt. Vielen Dank.",
            validate: validateCareer,
            sql: "INSERT INTO career_applications (full_name, email, phone, area, message) VALUES (?, ?, ?, ?, ?)",
            values: (data) => [data.name, data.email, data.phone, data.area, data.message]
        }
    };
    const route = routes[pathname];

    if (!route) return sendJson(response, 404, { message: "API-Endpunkt nicht gefunden." });
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return sendJson(response, 405, { message: "Methode nicht erlaubt." });
    }

    const retryAfter = takeRateLimit(request);
    if (retryAfter) {
        response.setHeader("Retry-After", String(retryAfter));
        return sendJson(response, 429, { message: "Zu viele Anfragen. Bitte versuchen Sie es später erneut." });
    }

    let body;
    try {
        body = await readJson(request);
    } catch (error) {
        return sendJson(response, error.statusCode || 400, { message: "Die übermittelten Daten konnten nicht gelesen werden." });
    }

    // A filled honeypot is treated like a successful submission but is not stored.
    if (typeof body.website === "string" && body.website.trim() !== "") {
        return sendJson(response, 202, { message: route.message });
    }

    const data = route.validate(body);
    if (!data) return sendJson(response, 400, { message: "Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut." });
    if (!pool) {
        return sendJson(response, 503, { message: "Der Formularversand ist noch nicht eingerichtet. Bitte schreiben Sie an zoicasundosinski@gmail.com." });
    }

    try {
        await pool.execute(route.sql, route.values(data));
        return sendJson(response, 201, { message: route.message });
    } catch (error) {
        console.error("[api] form insert failed:", error.code || "database_error");
        return sendJson(response, 503, { message: "Der Versand ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut oder schreiben Sie an zoicasundosinski@gmail.com." });
    }
}

async function serveStatic(request, response, pathname) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        response.writeHead(405);
        return response.end("Method not allowed");
    }

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        response.writeHead(400);
        return response.end("Bad request");
    }

    const relativePath = decodedPath === "/"
        ? "index.html"
        : decodedPath === "/admin.html"
            ? "public/admin.html"
            : decodedPath.replace(/^[/\\]+/, "");
    let filePath = path.resolve(ROOT, relativePath);
    const isAllowedStaticPath = candidate => STATIC_ROOTS.some(
        base => candidate === base || candidate.startsWith(base + path.sep)
    ) || candidate === path.join(ROOT, "index.html");
    if (!isAllowedStaticPath(filePath)) {
        response.writeHead(404);
        return response.end("Not found");
    }

    try {
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
        filePath = await fs.promises.realpath(filePath);
        if (!isAllowedStaticPath(filePath)) {
            response.writeHead(404);
            return response.end("Not found");
        }
        const data = await fs.promises.readFile(filePath);
        response.writeHead(200, {
            "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
            "Content-Length": data.length,
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin"
        });
        return response.end(request.method === "HEAD" ? undefined : data);
    } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        return response.end("Not found");
    }
}

const server = http.createServer(async (request, response) => {
    let requestUrl;
    let pathname;
    try {
        requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
        pathname = requestUrl.pathname;
    } catch {
        return sendJson(response, 400, { message: "Ung?ltige Anfrage." });
    }

    try {
        if (pathname.startsWith("/api/")) {
            return await handleApi(request, response, pathname, requestUrl.searchParams);
        }
        return await serveStatic(request, response, pathname);
    } catch (error) {
        console.error("[server] request failed:", error.code || "request_error");
        if (!response.headersSent) sendJson(response, 500, { message: "Ein unerwarteter Fehler ist aufgetreten." });
        else response.destroy();
    }
});

server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
    console.log(`Website server listening at http://${HOST}:${PORT}`);
    if (!pool) console.warn("MySQL is not configured; form submissions will return HTTP 503 until .env is set.");
    if (!adminAuthConfigured) console.warn("Admin dashboard login is disabled until ADMIN_USERNAME and ADMIN_PASSWORD_HASH are configured.");
    if (!adminPool) console.warn("Admin dashboard data access is disabled until MYSQL_ADMIN_USER and MYSQL_ADMIN_PASSWORD are configured.");
});

async function shutdown() {
    server.close(async () => {
        await Promise.all([pool, adminPool].filter(Boolean).map(connectionPool => connectionPool.end()));
        process.exit(0);
    });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
