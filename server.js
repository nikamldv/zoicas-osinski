"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

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

const mysql = require("mysql2/promise");
const databaseConfigured = Boolean(
    process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE
);

const pool = databaseConfigured
    ? mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD || "",
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
    })
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

async function handleApi(request, response, pathname) {
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

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^[/\\]+/, "");
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
    let pathname;
    try {
        pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
    } catch {
        return sendJson(response, 400, { message: "Ung?ltige Anfrage." });
    }

    try {
        if (pathname.startsWith("/api/")) return await handleApi(request, response, pathname);
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
});

async function shutdown() {
    server.close(async () => {
        if (pool) await pool.end();
        process.exit(0);
    });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
