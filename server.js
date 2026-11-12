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
const MAX_MULTIPART_BODY_BYTES = Number(process.env.QUOTE_MAX_FILE_BYTES || 5 * 1024 * 1024) * Math.min(Math.max(Number(process.env.QUOTE_MAX_FILES || 5), 1), 5) + 128 * 1024;
const QUOTE_MAX_FILE_BYTES = Math.min(Math.max(Number(process.env.QUOTE_MAX_FILE_BYTES || 5 * 1024 * 1024), 1024), 10 * 1024 * 1024);
const QUOTE_MAX_FILES = Math.min(Math.max(Number(process.env.QUOTE_MAX_FILES || 5), 1), 5);
const QUOTE_UPLOAD_DIR = path.resolve(ROOT, process.env.QUOTE_UPLOAD_DIR || "storage/quote-uploads");
const EMPLOYEE_UPLOAD_DIR = path.resolve(ROOT, process.env.EMPLOYEE_UPLOAD_DIR || "storage/employee-documents");
const EMPLOYEE_MAX_FILE_BYTES = Math.min(Math.max(Number(process.env.EMPLOYEE_MAX_FILE_BYTES || 5 * 1024 * 1024), 1024), 10 * 1024 * 1024);
const BOOKING_SLOT_DURATION_MINUTES = Math.min(Math.max(Number(process.env.BOOKING_SLOT_DURATION_MINUTES || 60), 15), 480);
const BOOKING_SLOT_TIMES = String(process.env.BOOKING_SLOT_TIMES || "").split(",").map(value => value.trim()).filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 6;
const rateBuckets = new Map();
const ADMIN_SESSION_COOKIE = "zo_admin_session";
const CUSTOMER_SESSION_COOKIE = "zo_customer_session";
const EMPLOYEE_SESSION_COOKIE = "zo_employee_session";
const configuredAdminSessionTtl = Number(process.env.ADMIN_SESSION_TTL_MINUTES || 480);
const ADMIN_SESSION_TTL_MINUTES = Number.isFinite(configuredAdminSessionTtl)
    ? Math.min(Math.max(configuredAdminSessionTtl, 15), 720)
    : 480;
const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_MINUTES * 60 * 1000;
const adminSessions = new Map();
const customerSessions = new Map();
const employeeSessions = new Map();
const CUSTOMER_SESSION_TTL_MS = Math.min(Math.max(Number(process.env.CUSTOMER_SESSION_TTL_MINUTES || 480), 15), 720) * 60 * 1000;
const EMPLOYEE_SESSION_TTL_MS = Math.min(Math.max(Number(process.env.EMPLOYEE_SESSION_TTL_MINUTES || 480), 15), 720) * 60 * 1000;
const customerLoginBuckets = new Map();
const adminLoginBuckets = new Map();
const employeeLoginBuckets = new Map();
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
    ".ico": "image/x-icon",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
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
const quoteObjectTypes = new Set(["Privathaushalt", "Büro", "Praxis", "Gewerbe", "Gebäude", "Baustelle", "Sonstiges"]);
const quoteStatuses = new Set(["new", "in_progress", "offer_sent", "accepted", "declined", "completed"]);
const appointmentStatuses = new Set(["pending", "confirmed", "in_progress", "completed", "cancelled"]);
const appointmentServices = new Set(["Reinigungsservice", "Büroreinigung", "Fensterreinigung", "Grundreinigung", "Treppenhausreinigung", "Bauendreinigung", "Praxis-/Gewerbereinigung", "Haushaltshilfe", "Haushaltsauflösung", "Entrümpelung", "Renovierung", "Sonstiges"]);
const quoteStatusLabels = {
    new: "Neu", in_progress: "In Bearbeitung", offer_sent: "Angebot gesendet",
    accepted: "Angenommen", declined: "Abgelehnt", completed: "Abgeschlossen"
};
const allowedQuoteMimes = new Map([
    ["image/jpeg", ".jpg"], ["image/png", ".png"], ["application/pdf", ".pdf"]
]);
const employeeRoles = new Set(["EMPLOYEE", "MANAGER", "ADMIN"]);
const employeeStatuses = new Set(["ACTIVE", "INACTIVE"]);
const employeeTaskStatuses = new Set(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const employeeTaskPriorities = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);

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

function setCustomerCookie(response, token, maxAge) {
    const attributes = [`${CUSTOMER_SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
    if (secureAdminCookie) attributes.push("Secure");
    response.setHeader("Set-Cookie", attributes.join("; "));
}

function readCustomerSession(request) {
    const entry = String(request.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
    if (!entry) return null;
    const token = entry.slice(CUSTOMER_SESSION_COOKIE.length + 1), session = customerSessions.get(token);
    if (!session || Date.now() >= session.expiresAt) { customerSessions.delete(token); return null; }
    return { token, ...session };
}

function customerSessionOrRespond(request, response) {
    const session = readCustomerSession(request);
    if (!session) { sendJson(response, 401, { message: "Bitte melden Sie sich an." }); return null; }
    return session;
}

function setEmployeeCookie(response, token, maxAge) {
    const attributes = [`${EMPLOYEE_SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
    if (secureAdminCookie) attributes.push("Secure");
    response.setHeader("Set-Cookie", attributes.join("; "));
}

function readEmployeeSession(request) {
    const entry = String(request.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${EMPLOYEE_SESSION_COOKIE}=`));
    if (!entry) return null;
    const token = entry.slice(EMPLOYEE_SESSION_COOKIE.length + 1);
    const session = employeeSessions.get(token);
    if (!session || Date.now() >= session.expiresAt) { employeeSessions.delete(token); return null; }
    return { token, ...session };
}

function employeeSessionOrRespond(request, response) {
    const session = readEmployeeSession(request);
    if (!session) { sendJson(response, 401, { message: "Bitte melden Sie sich an." }); return null; }
    return session;
}

function takeEmployeeLoginRateLimit(request) {
    const key = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = employeeLoginBuckets.get(key);
    if (!bucket || now >= bucket.expiresAt) {
        bucket = { count: 0, expiresAt: now + RATE_WINDOW_MS };
        employeeLoginBuckets.set(key, bucket);
    }
    if (bucket.count >= 8) return true;
    bucket.count += 1;
    if (employeeLoginBuckets.size > 2000) for (const [address, oldBucket] of employeeLoginBuckets) if (now >= oldBucket.expiresAt) employeeLoginBuckets.delete(address);
    return false;
}

function makePasswordHash(password) {
    return new Promise((resolve, reject) => { const salt = crypto.randomBytes(16); crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(`scrypt$${salt.toString("hex")}$${key.toString("hex")}`)); });
}

async function verifyPassword(password, storedHash) {
    const match = String(storedHash || "").match(/^scrypt\$([a-f\d]{32})\$([a-f\d]{128})$/i); if (!match) return false;
    const expected = Buffer.from(match[2], "hex"), actual = await new Promise((resolve, reject) => crypto.scrypt(password, Buffer.from(match[1], "hex"), expected.length, (error, key) => error ? reject(error) : resolve(key)));
    return crypto.timingSafeEqual(expected, actual);
}

function validCustomerPassword(value) { return typeof value === "string" && value.length >= 12 && value.length <= 256 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value); }

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

function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function minutesToTime(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function isValidBookingDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = new Date(`${value}T00:00:00Z`);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    return !Number.isNaN(date.getTime()) && date >= today;
}

function bookingEndTime(startTime) {
    const start = timeToMinutes(startTime), end = start + BOOKING_SLOT_DURATION_MINUTES;
    return Number.isFinite(start) && end <= 1440 ? minutesToTime(end) : null;
}

async function handleAdminAppointments(request, response, pathname, searchParams) {
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für das Dashboard sind noch nicht eingerichtet." });
    const match = pathname.match(/^\/api\/admin\/appointments(?:\/(\d+))?$/), appointmentId = match?.[1] ? Number(match[1]) : null;
    if (appointmentId && request.method === "GET") {
        try { const [rows] = await adminPool.execute("SELECT a.*, c.first_name, c.last_name, c.email, c.phone FROM appointments a JOIN appointment_customers c ON c.id = a.customer_id WHERE a.id = ?", [appointmentId]); return rows[0] ? sendJson(response, 200, { appointment: rows[0] }) : sendJson(response, 404, { message: "Termin nicht gefunden." }); } catch (error) { console.error("[admin] appointment detail failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Der Termin konnte nicht geladen werden." }); }
    }
    if (appointmentId && request.method === "PATCH") {
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Die Statusdaten konnten nicht gelesen werden." }); }
        const status = readText(body.status, 20); if (!appointmentStatuses.has(status)) return sendJson(response, 400, { message: "Ungültiger Status." });
        try { const [result] = await adminPool.execute("UPDATE appointments SET status = ? WHERE id = ?", [status, appointmentId]); return result.affectedRows ? sendJson(response, 200, { id: appointmentId, status }) : sendJson(response, 404, { message: "Termin nicht gefunden." }); } catch (error) { console.error("[admin] appointment update failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Der Status konnte nicht gespeichert werden." }); }
    }
    if (!appointmentId && request.method === "GET") {
        const status = searchParams.get("status") || "all", service = (searchParams.get("service") || "").trim().slice(0, 100), date = searchParams.get("date") || "", search = (searchParams.get("search") || "").trim().slice(0, 100);
        if ((status !== "all" && !appointmentStatuses.has(status)) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return sendJson(response, 400, { message: "Ungültige Filter." });
        const conditions = [], values = [];
        if (status !== "all") { conditions.push("a.status = ?"); values.push(status); } if (service) { conditions.push("a.service = ?"); values.push(service); } if (date) { conditions.push("a.preferred_date = ?"); values.push(date); }
        if (search) { conditions.push("(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR a.service LIKE ?)"); for (let i = 0; i < 5; i += 1) values.push(`%${search}%`); }
        const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
        try { const [rows] = await adminPool.execute(`SELECT a.id, a.service, a.city, a.preferred_date, a.start_time, a.status, a.created_at, c.first_name, c.last_name, c.email, c.phone FROM appointments a JOIN appointment_customers c ON c.id = a.customer_id${where} ORDER BY a.preferred_date, a.start_time LIMIT 100`, values); return sendJson(response, 200, { rows, total: rows.length }); } catch (error) { console.error("[admin] appointment list failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Die Termine konnten nicht geladen werden." }); }
    }
    response.setHeader("Allow", "GET, PATCH"); return sendJson(response, 405, { message: "Methode nicht erlaubt." });
}

async function handleAdminCustomers(request, response, pathname, searchParams) {
    if (!adminPool) return sendJson(response,503,{message:"Die Datenbankrechte für das Dashboard sind noch nicht eingerichtet."});
    const match=pathname.match(/^\/api\/admin\/customers(?:\/(\d+))?$/),id=match?.[1]?Number(match[1]):null;
    if(id&&request.method==="GET"){const [r]=await adminPool.execute("SELECT id,first_name,last_name,email,phone,address,postal_code,city,status,created_at,last_login_at FROM customers WHERE id=?",[id]);return r[0]?sendJson(response,200,{customer:r[0]}):sendJson(response,404,{message:"Kunde nicht gefunden."});}
    if(id&&request.method==="PATCH"){if(!isSameOriginRequest(request))return sendJson(response,403,{message:"Anfrage nicht erlaubt."});let b;try{b=await readJson(request)}catch{return sendJson(response,400,{message:"Ungültige Daten."})};if(!["active","inactive","blocked"].includes(readText(b.status,20)))return sendJson(response,400,{message:"Ungültiger Status."});await adminPool.execute("UPDATE customers SET status=? WHERE id=?",[b.status,id]);return sendJson(response,200,{id,status:b.status});}
    if(!id&&request.method==="GET"){const search=(searchParams.get("search")||"").trim().slice(0,100),status=searchParams.get("status")||"all";if(status!=="all"&&!["active","inactive","blocked"].includes(status))return sendJson(response,400,{message:"Ungültige Filter."});const c=[],v=[];if(status!=="all"){c.push("status=?");v.push(status)}if(search){c.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR city LIKE ?)");for(let i=0;i<5;i++)v.push(`%${search}%`)}const w=c.length?` WHERE ${c.join(" AND ")}`:"";const [rows]=await adminPool.execute(`SELECT id,first_name,last_name,email,phone,city,status,created_at,last_login_at FROM customers${w} ORDER BY created_at DESC LIMIT 100`,v);return sendJson(response,200,{rows,total:rows.length});}
    return sendJson(response,405,{message:"Methode nicht erlaubt."});
}

async function handleAdminQuotes(request, response, pathname, searchParams) {
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für das Dashboard sind noch nicht eingerichtet." });
    const match = pathname.match(/^\/api\/admin\/quotes(?:\/(\d+))?(?:\/files\/(\d+))?$/);
    const quoteId = match?.[1] ? Number(match[1]) : null;
    const fileId = match?.[2] ? Number(match[2]) : null;

    if (fileId && request.method === "GET") {
        try {
            const [rows] = await adminPool.execute(
                "SELECT f.id, f.original_name, f.stored_name, f.mime_type FROM quote_request_files f WHERE f.id = ? AND f.quote_request_id = ?",
                [fileId, quoteId]
            );
            const file = rows[0];
            if (!file) return sendJson(response, 404, { message: "Datei nicht gefunden." });
            const extension = allowedQuoteMimes.get(file.mime_type);
            const safePath = path.join(QUOTE_UPLOAD_DIR, `${file.stored_name}${extension}`);
            const content = await fs.promises.readFile(safePath);
            response.writeHead(200, {
                "Content-Type": file.mime_type,
                "Content-Length": content.length,
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff"
            });
            return response.end(content);
        } catch (error) {
            if (error.code === "ENOENT") return sendJson(response, 404, { message: "Datei nicht verfügbar." });
            console.error("[admin] quote file read failed:", error.code || "file_error");
            return sendJson(response, 503, { message: "Die Datei konnte nicht geladen werden." });
        }
    }

    if (quoteId && request.method === "GET") {
        try {
            const [rows] = await adminPool.execute("SELECT * FROM quote_requests WHERE id = ?", [quoteId]);
            if (!rows[0]) return sendJson(response, 404, { message: "Anfrage nicht gefunden." });
            const [files] = await adminPool.execute("SELECT id, original_name, mime_type, size_bytes, created_at FROM quote_request_files WHERE quote_request_id = ? ORDER BY id", [quoteId]);
            return sendJson(response, 200, { quote: rows[0], files });
        } catch (error) {
            console.error("[admin] quote detail failed:", error.code || "database_error");
            return sendJson(response, 503, { message: adminDatabaseErrorMessage(error, "Die Anfrage konnte nicht geladen werden.") });
        }
    }

    if (quoteId && request.method === "PATCH") {
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body;
        try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Die Statusdaten konnten nicht gelesen werden." }); }
        const status = readText(body.status, 20);
        if (!quoteStatuses.has(status)) return sendJson(response, 400, { message: "Ungültiger Status." });
        try {
            const [result] = await adminPool.execute("UPDATE quote_requests SET status = ? WHERE id = ?", [status, quoteId]);
            if (!result.affectedRows) return sendJson(response, 404, { message: "Anfrage nicht gefunden." });
            return sendJson(response, 200, { id: quoteId, status, statusLabel: quoteStatusLabels[status] });
        } catch (error) {
            console.error("[admin] quote status update failed:", error.code || "database_error");
            return sendJson(response, 503, { message: adminDatabaseErrorMessage(error, "Der Status konnte nicht gespeichert werden.") });
        }
    }

    if (!quoteId && request.method === "GET") {
        const requestedStatus = searchParams.get("status") || "all";
        if (requestedStatus !== "all" && !quoteStatuses.has(requestedStatus)) return sendJson(response, 400, { message: "Ungültiger Filter." });
        const pageRaw = Number(searchParams.get("page") || 1);
        const page = Number.isSafeInteger(pageRaw) ? Math.min(Math.max(pageRaw, 1), 10000) : 1;
        const search = (searchParams.get("search") || "").trim().slice(0, 100);
        const conditions = []; const values = [];
        if (requestedStatus !== "all") { conditions.push("status = ?"); values.push(requestedStatus); }
        if (search) { conditions.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR city LIKE ? OR requested_service LIKE ?)"); for (let i = 0; i < 5; i += 1) values.push(`%${search}%`); }
        const whereSql = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
        try {
            const [count] = await adminPool.execute(`SELECT COUNT(*) AS total FROM quote_requests${whereSql}`, values);
            const [rows] = await adminPool.execute(`SELECT id, first_name, last_name, company, email, phone, object_type, city, requested_service, area_m2, status, created_at FROM quote_requests${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...values, 25, (page - 1) * 25]);
            return sendJson(response, 200, { rows, total: Number(count[0].total), page, pageSize: 25, statusLabels: quoteStatusLabels });
        } catch (error) {
            console.error("[admin] quote list failed:", error.code || "database_error");
            return sendJson(response, 503, { message: adminDatabaseErrorMessage(error, "Die Angebotsanfragen konnten nicht geladen werden.") });
        }
    }
    response.setHeader("Allow", "GET, PATCH");
    return sendJson(response, 405, { message: "Methode nicht erlaubt." });
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

async function readRequestBuffer(request, maximumSize) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maximumSize) {
            const error = new Error("Request body too large");
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

function multipartHeaderValue(headers, name) {
    const expression = new RegExp(`${name}="([^\"]*)"`, "i");
    return headers.match(expression)?.[1] || "";
}

async function readMultipart(request) {
    const contentType = String(request.headers["content-type"] || "");
    const boundary = contentType.match(/multipart\/form-data;\s*boundary=([^;]+)/i)?.[1];
    if (!boundary) {
        const error = new Error("Unsupported content type");
        error.statusCode = 415;
        throw error;
    }
    const body = await readRequestBuffer(request, MAX_MULTIPART_BODY_BYTES);
    const separator = Buffer.from(`--${boundary}`);
    const headerEnd = Buffer.from("\r\n\r\n");
    const fields = {};
    const files = [];
    let cursor = 0;

    while (cursor < body.length) {
        const start = body.indexOf(separator, cursor);
        if (start < 0) break;
        const partStart = start + separator.length;
        if (body.subarray(partStart, partStart + 2).equals(Buffer.from("--"))) break;
        const contentStart = partStart + 2;
        const next = body.indexOf(separator, contentStart);
        if (next < 0) break;
        const part = body.subarray(contentStart, next - 2);
        cursor = next;
        const headerIndex = part.indexOf(headerEnd);
        if (headerIndex < 0) continue;
        const headers = part.subarray(0, headerIndex).toString("utf8");
        const name = multipartHeaderValue(headers, "name");
        if (!name) continue;
        const value = part.subarray(headerIndex + headerEnd.length);
        const originalName = multipartHeaderValue(headers, "filename");
        if (!originalName) {
            fields[name] = value.toString("utf8");
            continue;
        }
        const declaredMime = headers.match(/content-type:\s*([^\r\n;]+)/i)?.[1]?.toLowerCase() || "";
        files.push({ field: name, originalName: path.basename(originalName).replace(/[\0-\x1f<>:"/\\|?*]/g, "_").slice(0, 180), declaredMime, buffer: value });
    }
    return { fields, files };
}

function detectQuoteMime(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
    return "";
}

function validateQuote(body) {
    const firstName = readText(body.first_name, 80);
    const lastName = readText(body.last_name, 80);
    const company = readText(body.company, 160, { optional: true });
    const email = validateEmail(body.email);
    const phone = readText(body.phone, 40);
    const objectType = readText(body.object_type, 40);
    const address = readText(body.address, 180);
    const postalCode = readText(body.postal_code, 16);
    const city = readText(body.city, 120);
    const service = readText(body.service, 100);
    const frequency = readText(body.frequency, 80, { optional: true });
    const preferredPeriod = readText(body.preferred_period, 120, { optional: true });
    const preferredDate = readText(body.preferred_date, 10, { optional: true });
    const message = readText(body.message, 4000, { optional: true, multiline: true });
    const additionalInformation = readText(body.additional_information, 2000, { optional: true, multiline: true });
    const areaText = readText(body.area_m2, 6, { optional: true });
    const areaM2 = areaText ? Number(areaText) : null;
    if (!firstName || !lastName || !email || !phone || !/^[+0-9()\/ .-]{5,40}$/.test(phone)
        || !quoteObjectTypes.has(objectType) || !address || !postalCode || !city || !service
        || (areaText && (!Number.isInteger(areaM2) || areaM2 < 1 || areaM2 > 9999))
        || (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate))) return null;
    return { firstName, lastName, company: company || null, email, phone, objectType, address, postalCode, city, service, areaM2, frequency: frequency || null, preferredPeriod: preferredPeriod || null, preferredDate: preferredDate || null, message: message || null, additionalInformation: additionalInformation || null };
}

async function saveQuoteFiles(files, quoteId) {
    if (files.length > QUOTE_MAX_FILES) {
        const error = new Error("Too many files"); error.statusCode = 400; throw error;
    }
    await fs.promises.mkdir(QUOTE_UPLOAD_DIR, { recursive: true, mode: 0o700 });
    const saved = [];
    try {
        for (const file of files) {
            if (file.field !== "attachments" || !file.originalName || file.buffer.length === 0 || file.buffer.length > QUOTE_MAX_FILE_BYTES) {
                const error = new Error("Invalid file"); error.statusCode = 400; throw error;
            }
            const mime = detectQuoteMime(file.buffer);
            if (!allowedQuoteMimes.has(mime) || (file.declaredMime && file.declaredMime !== mime)) {
                const error = new Error("Invalid file type"); error.statusCode = 400; throw error;
            }
            const storedName = crypto.randomUUID();
            const extension = allowedQuoteMimes.get(mime);
            await fs.promises.writeFile(path.join(QUOTE_UPLOAD_DIR, `${storedName}${extension}`), file.buffer, { mode: 0o600, flag: "wx" });
            saved.push({ originalName: file.originalName, storedName, mime, size: file.buffer.length });
        }
        for (const file of saved) await pool.execute(
            "INSERT INTO quote_request_files (quote_request_id, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)",
            [quoteId, file.originalName, file.storedName, file.mime, file.size]
        );
        return saved;
    } catch (error) {
        await Promise.all(saved.map(file => fs.promises.unlink(path.join(QUOTE_UPLOAD_DIR, `${file.storedName}${allowedQuoteMimes.get(file.mime)}`)).catch(() => {})));
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

function isIsoDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()); }
function isClockTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")); }
function employeeRecord(row) {
    if (!row) return null;
    const { password_hash, ...employee } = row;
    return employee;
}

async function handleAdminEmployees(request, response, pathname, searchParams) {
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für die Mitarbeiterverwaltung sind noch nicht eingerichtet." });
    const detail = pathname.match(/^\/api\/admin\/employees\/(\d+)(?:\/(status|role))?$/);
    const id = detail ? Number(detail[1]) : null;
    const action = detail?.[2] || "";
    if (id && request.method === "GET" && !action) {
        try {
            const [rows] = await adminPool.execute("SELECT id,first_name,last_name,email,phone,role,status,employee_number,position,hire_date,notes,last_login_at,created_at,updated_at FROM employees WHERE id=?", [id]);
            return rows[0] ? sendJson(response, 200, { employee: employeeRecord(rows[0]) }) : sendJson(response, 404, { message: "Mitarbeiter nicht gefunden." });
        } catch (error) { console.error("[admin] employee detail failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Mitarbeiter konnte nicht geladen werden." }); }
    }
    if (!id && request.method === "GET") {
        const search = (searchParams.get("search") || "").trim().slice(0, 100);
        const role = searchParams.get("role") || "all", status = searchParams.get("status") || "all";
        if ((role !== "all" && !employeeRoles.has(role)) || (status !== "all" && !employeeStatuses.has(status))) return sendJson(response, 400, { message: "Ungültige Filter." });
        const pageRaw = Number(searchParams.get("page") || 1), page = Number.isSafeInteger(pageRaw) ? Math.min(Math.max(pageRaw, 1), 10000) : 1, pageSize = 25;
        const clauses = [], values = [];
        if (role !== "all") { clauses.push("role=?"); values.push(role); }
        if (status !== "all") { clauses.push("status=?"); values.push(status); }
        if (search) { clauses.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR employee_number LIKE ? OR position LIKE ?)"); for (let index = 0; index < 5; index += 1) values.push(`%${search}%`); }
        const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
        try {
            const [count] = await adminPool.execute(`SELECT COUNT(*) AS total FROM employees${where}`, values);
            const [rows] = await adminPool.execute(`SELECT id,first_name,last_name,email,phone,role,status,employee_number,position,hire_date,last_login_at,created_at FROM employees${where} ORDER BY last_name,first_name LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
            return sendJson(response, 200, { rows, total: Number(count[0].total), page, pageSize });
        } catch (error) { console.error("[admin] employee list failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Mitarbeiter konnten nicht geladen werden." }); }
    }
    if ((!id && request.method === "POST") || (id && request.method === "PATCH")) {
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
        if (id && action === "status") {
            const status = readText(body.status, 16); if (!employeeStatuses.has(status)) return sendJson(response, 400, { message: "Ungültiger Status." });
            const [result] = await adminPool.execute("UPDATE employees SET status=? WHERE id=?", [status, id]); return result.affectedRows ? sendJson(response, 200, { id, status }) : sendJson(response, 404, { message: "Mitarbeiter nicht gefunden." });
        }
        if (id && action === "role") {
            const role = readText(body.role, 16); if (!employeeRoles.has(role)) return sendJson(response, 400, { message: "Ungültige Rolle." });
            const [result] = await adminPool.execute("UPDATE employees SET role=? WHERE id=?", [role, id]); return result.affectedRows ? sendJson(response, 200, { id, role }) : sendJson(response, 404, { message: "Mitarbeiter nicht gefunden." });
        }
        const firstName = readText(body.first_name, 80), lastName = readText(body.last_name, 80), email = validateEmail(body.email), phone = readText(body.phone, 40);
        const employeeNumber = readText(body.employee_number, 40), position = readText(body.position, 120, { optional: true }), hireDate = readText(body.hire_date, 10, { optional: true }), notes = readText(body.notes, 4000, { optional: true, multiline: true });
        const role = readText(body.role || "EMPLOYEE", 16), status = readText(body.status || "ACTIVE", 16);
        if (!firstName || !lastName || !email || !phone || !employeeNumber || !/^[A-Za-z0-9_-]{3,40}$/.test(employeeNumber) || !employeeRoles.has(role) || !employeeStatuses.has(status) || (hireDate && !isIsoDate(hireDate))) return sendJson(response, 400, { message: "Bitte prüfen Sie die Mitarbeiterdaten." });
        try {
            if (!id) {
                const password = body.password, confirmation = body.password_confirmation;
                if (!validCustomerPassword(password) || password !== confirmation) return sendJson(response, 400, { message: "Das Passwort benötigt mindestens 12 Zeichen sowie Groß-, Kleinbuchstaben und eine Zahl." });
                const [result] = await adminPool.execute("INSERT INTO employees (first_name,last_name,email,phone,password_hash,role,status,employee_number,position,hire_date,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [firstName,lastName,email,phone,await makePasswordHash(password),role,status,employeeNumber,position || null,hireDate || null,notes || null]);
                return sendJson(response, 201, { id: result.insertId, message: "Mitarbeiter wurde angelegt." });
            }
            const [result] = await adminPool.execute("UPDATE employees SET first_name=?,last_name=?,email=?,phone=?,role=?,status=?,employee_number=?,position=?,hire_date=?,notes=? WHERE id=?", [firstName,lastName,email,phone,role,status,employeeNumber,position || null,hireDate || null,notes || null,id]);
            return result.affectedRows ? sendJson(response, 200, { id, message: "Mitarbeiter gespeichert." }) : sendJson(response, 404, { message: "Mitarbeiter nicht gefunden." });
        } catch (error) { if (error.code === "ER_DUP_ENTRY") return sendJson(response, 409, { message: "E-Mail oder Mitarbeiternummer ist bereits vergeben." }); console.error("[admin] employee save failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Mitarbeiter konnte nicht gespeichert werden." }); }
    }
    response.setHeader("Allow", "GET, POST, PATCH");
    return sendJson(response, 405, { message: "Methode nicht erlaubt." });
}

async function handleAdminEmployeeTasks(request, response, pathname) {
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für Aufgaben sind noch nicht eingerichtet." });
    const match = pathname.match(/^\/api\/admin\/employee-tasks(?:\/(\d+))?$/);
    const id = match?.[1] ? Number(match[1]) : null;
    if (request.method !== (id ? "PATCH" : "POST")) { response.setHeader("Allow", "POST, PATCH"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
    if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
    let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
    const title = readText(body.title, 180), description = readText(body.description, 4000, { optional: true, multiline: true });
    const employeeId = Number(body.employee_id), customerId = body.customer_id == null || body.customer_id === "" ? null : Number(body.customer_id), appointmentId = body.appointment_id == null || body.appointment_id === "" ? null : Number(body.appointment_id);
    const status = readText(body.status || "OPEN", 20), priority = readText(body.priority || "NORMAL", 20), scheduledDate = readText(body.scheduled_date, 10, { optional: true }), startTime = readText(body.start_time, 5, { optional: true }), endTime = readText(body.end_time, 5, { optional: true });
    if (!title || !Number.isSafeInteger(employeeId) || employeeId < 1 || !employeeTaskStatuses.has(status) || !employeeTaskPriorities.has(priority) || (scheduledDate && !isIsoDate(scheduledDate)) || (startTime && !isClockTime(startTime)) || (endTime && !isClockTime(endTime))) return sendJson(response, 400, { message: "Bitte prüfen Sie die Aufgabendaten." });
    try {
        if (!id) {
            const [employee] = await adminPool.execute("SELECT id FROM employees WHERE id=? AND status='ACTIVE'", [employeeId]); if (!employee[0]) return sendJson(response, 404, { message: "Aktiver Mitarbeiter nicht gefunden." });
            const [result] = await adminPool.execute("INSERT INTO employee_tasks (employee_id,title,description,customer_id,appointment_id,status,priority,scheduled_date,start_time,end_time,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [employeeId,title,description || null,Number.isSafeInteger(customerId) ? customerId : null,Number.isSafeInteger(appointmentId) ? appointmentId : null,status,priority,scheduledDate || null,startTime || null,endTime || null,"admin"]);
            return sendJson(response, 201, { id: result.insertId, message: "Aufgabe zugewiesen." });
        }
        const [result] = await adminPool.execute("UPDATE employee_tasks SET title=?,description=?,employee_id=?,customer_id=?,appointment_id=?,status=?,priority=?,scheduled_date=?,start_time=?,end_time=? WHERE id=?", [title,description || null,employeeId,Number.isSafeInteger(customerId) ? customerId : null,Number.isSafeInteger(appointmentId) ? appointmentId : null,status,priority,scheduledDate || null,startTime || null,endTime || null,id]);
        return result.affectedRows ? sendJson(response, 200, { id, message: "Aufgabe gespeichert." }) : sendJson(response, 404, { message: "Aufgabe nicht gefunden." });
    } catch (error) { console.error("[admin] employee task failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Aufgabe konnte nicht gespeichert werden." }); }
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

    if (pathname === "/api/admin/quotes" || /^\/api\/admin\/quotes\/\d+(?:\/files\/\d+)?$/.test(pathname)) {
        return handleAdminQuotes(request, response, pathname, searchParams);
    }
    if (pathname === "/api/admin/appointments" || /^\/api\/admin\/appointments\/\d+$/.test(pathname)) {
        return handleAdminAppointments(request, response, pathname, searchParams);
    }
    if (pathname === "/api/admin/customers" || /^\/api\/admin\/customers\/\d+$/.test(pathname)) {
        return handleAdminCustomers(request, response, pathname, searchParams);
    }
    if (pathname === "/api/admin/employees" || /^\/api\/admin\/employees\/\d+(?:\/(?:status|role))?$/.test(pathname)) {
        return handleAdminEmployees(request, response, pathname, searchParams);
    }
    if (pathname === "/api/admin/employee-tasks" || /^\/api\/admin\/employee-tasks\/\d+$/.test(pathname)) {
        return handleAdminEmployeeTasks(request, response, pathname);
    }

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
    if (pathname.startsWith("/api/employee/")) return handleEmployeeApi(request, response, pathname, searchParams);
    if (pathname.startsWith("/api/customer/")) return handleCustomerApi(request, response, pathname, searchParams);
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

    if (pathname === "/api/appointments/availability") {
        if (request.method !== "GET") { response.setHeader("Allow", "GET"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        const service = (searchParams.get("service") || "").trim(), date = searchParams.get("date") || "";
        if (!appointmentServices.has(service) || !isValidBookingDate(date)) return sendJson(response, 400, { message: "Bitte wählen Sie eine gültige Dienstleistung und ein zukünftiges Datum." });
        if (!BOOKING_SLOT_TIMES.length) return sendJson(response, 200, { date, availableSlots: [], configured: false, message: "Für die Online-Terminbuchung sind noch keine bestätigten Zeitfenster hinterlegt." });
        if (!pool) return sendJson(response, 503, { message: "Die Terminbuchung ist derzeit nicht verfügbar." });
        try {
            const [rows] = await pool.execute("SELECT start_time FROM appointments WHERE preferred_date = ? AND status <> 'cancelled'", [date]);
            const occupied = new Set(rows.map(row => String(row.start_time).slice(0, 5)));
            return sendJson(response, 200, { date, availableSlots: BOOKING_SLOT_TIMES.filter(slot => !occupied.has(slot)), durationMinutes: BOOKING_SLOT_DURATION_MINUTES, configured: true });
        } catch (error) { console.error("[api] appointment availability failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Freie Termine konnten nicht geladen werden." }); }
    }

    if (pathname === "/api/appointments") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        const retryAfter = takeRateLimit(request); if (retryAfter) { response.setHeader("Retry-After", String(retryAfter)); return sendJson(response, 429, { message: "Zu viele Anfragen. Bitte versuchen Sie es später erneut." }); }
        let body; try { body = await readJson(request); } catch (error) { return sendJson(response, error.statusCode || 400, { message: "Die Buchungsdaten konnten nicht gelesen werden." }); }
        if (typeof body.website === "string" && body.website.trim()) return sendJson(response, 202, { message: "Vielen Dank für Ihre Terminanfrage." });
        const booking = {
            firstName: readText(body.first_name, 80), lastName: readText(body.last_name, 80), email: validateEmail(body.email), phone: readText(body.phone, 40),
            service: readText(body.service, 100), objectType: readText(body.object_type, 40), address: readText(body.address, 180), postalCode: readText(body.postal_code, 16), city: readText(body.city, 120),
            areaM2: body.area_m2 === "" || body.area_m2 == null ? null : Number(body.area_m2), date: readText(body.preferred_date, 10), startTime: readText(body.start_time, 5), message: readText(body.message, 4000, { optional: true, multiline: true })
        };
        if (!booking.firstName || !booking.lastName || !booking.email || !booking.phone || !appointmentServices.has(booking.service) || !quoteObjectTypes.has(booking.objectType) || !booking.address || !booking.postalCode || !booking.city || !isValidBookingDate(booking.date) || !BOOKING_SLOT_TIMES.includes(booking.startTime) || !Number.isFinite(booking.areaM2) && booking.areaM2 !== null || booking.areaM2 !== null && (!Number.isInteger(booking.areaM2) || booking.areaM2 < 1 || booking.areaM2 > 9999)) return sendJson(response, 400, { message: "Bitte prüfen Sie Ihre Pflichtangaben und den ausgewählten Termin." });
        if (!pool || !BOOKING_SLOT_TIMES.length) return sendJson(response, 503, { message: "Die Online-Terminbuchung ist noch nicht konfiguriert." });
        const endTime = bookingEndTime(booking.startTime); if (!endTime) return sendJson(response, 400, { message: "Ungültiges Zeitfenster." });
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [customer] = await connection.execute("INSERT INTO appointment_customers (first_name, last_name, email, phone) VALUES (?, ?, ?, ?)", [booking.firstName, booking.lastName, booking.email, booking.phone]);
            const portalSession = readCustomerSession(request);
            const [appointment] = await connection.execute("INSERT INTO appointments (customer_id, portal_customer_id, service, object_type, address, postal_code, city, area_m2, preferred_date, start_time, end_time, duration_minutes, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [customer.insertId, portalSession?.customerId || null, booking.service, booking.objectType, booking.address, booking.postalCode, booking.city, booking.areaM2, booking.date, booking.startTime, endTime, BOOKING_SLOT_DURATION_MINUTES, booking.message]);
            await connection.commit();
            return sendJson(response, 201, { id: appointment.insertId, service: booking.service, date: booking.date, startTime: booking.startTime, message: "Termin erfolgreich angefragt." });
        } catch (error) {
            await connection.rollback();
            if (error.code === "ER_DUP_ENTRY") return sendJson(response, 409, { message: "Dieses Zeitfenster wurde gerade vergeben. Bitte wählen Sie eine andere Uhrzeit." });
            console.error("[api] appointment create failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Die Terminbuchung ist derzeit nicht verfügbar." });
        } finally { connection.release(); }
    }

    if (pathname === "/api/quotes") {
        if (request.method !== "POST") {
            response.setHeader("Allow", "POST");
            return sendJson(response, 405, { message: "Methode nicht erlaubt." });
        }
        const retryAfter = takeRateLimit(request);
        if (retryAfter) {
            response.setHeader("Retry-After", String(retryAfter));
            return sendJson(response, 429, { message: "Zu viele Anfragen. Bitte versuchen Sie es später erneut." });
        }
        if (!pool) return sendJson(response, 503, { message: "Der Angebotsversand ist noch nicht eingerichtet. Bitte schreiben Sie an zoicasundosinski@gmail.com." });
        let multipart;
        try { multipart = await readMultipart(request); } catch (error) {
            const message = error.statusCode === 413 ? "Die Dateien sind zu groß." : "Die Anfrage konnte nicht gelesen werden.";
            return sendJson(response, error.statusCode || 400, { message });
        }
        if (typeof multipart.fields.website === "string" && multipart.fields.website.trim() !== "") {
            return sendJson(response, 202, { message: "Vielen Dank für Ihre Anfrage. Wir haben Ihre Anfrage erhalten und werden uns schnellstmöglich bei Ihnen melden." });
        }
        const quote = validateQuote(multipart.fields);
        if (!quote) return sendJson(response, 400, { message: "Bitte prüfen Sie Ihre Pflichtangaben und versuchen Sie es erneut." });
        if (multipart.files.length > QUOTE_MAX_FILES || multipart.files.some(file => !file.originalName || file.buffer.length > QUOTE_MAX_FILE_BYTES || !allowedQuoteMimes.has(detectQuoteMime(file.buffer)))) {
            return sendJson(response, 400, { message: `Bitte laden Sie nur bis zu ${QUOTE_MAX_FILES} JPG-, PNG- oder PDF-Dateien mit maximal ${Math.floor(QUOTE_MAX_FILE_BYTES / 1024 / 1024)} MB hoch.` });
        }
        try {
            const portalSession = readCustomerSession(request);
            const [result] = await pool.execute(
                "INSERT INTO quote_requests (customer_id, first_name, last_name, company, email, phone, object_type, address, postal_code, city, requested_service, area_m2, frequency, preferred_period, preferred_date, message, additional_information) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [portalSession?.customerId || null, quote.firstName, quote.lastName, quote.company, quote.email, quote.phone, quote.objectType, quote.address, quote.postalCode, quote.city, quote.service, quote.areaM2, quote.frequency, quote.preferredPeriod, quote.preferredDate, quote.message, quote.additionalInformation]
            );
            await saveQuoteFiles(multipart.files, result.insertId);
            // Email delivery is intentionally prepared through .env but remains disabled until SMTP is configured.
            return sendJson(response, 201, { id: result.insertId, message: "Vielen Dank für Ihre Anfrage. Wir haben Ihre Anfrage erhalten und werden uns schnellstmöglich bei Ihnen melden." });
        } catch (error) {
            console.error("[api] quote request failed:", error.code || "quote_error");
            return sendJson(response, 503, { message: "Der Versand ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut oder schreiben Sie an zoicasundosinski@gmail.com." });
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

async function handleCustomerApi(request, response, pathname, searchParams) {
    if (!pool) return sendJson(response, 503, { message: "Das Kundenportal ist derzeit nicht verfügbar." });
    const loginLimited = () => takeAdminLoginRateLimit(request);
    if (pathname === "/api/customer/register") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        if (takeRateLimit(request)) return sendJson(response, 429, { message: "Zu viele Anfragen. Bitte versuchen Sie es später erneut." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Die Registrierungsdaten konnten nicht gelesen werden." }); }
        const firstName = readText(body.first_name, 80), lastName = readText(body.last_name, 80), email = validateEmail(body.email), phone = readText(body.phone, 40), password = body.password, confirmation = body.password_confirmation;
        if (!firstName || !lastName || !email || !phone || !validCustomerPassword(password) || password !== confirmation) return sendJson(response, 400, { message: "Bitte prüfen Sie Ihre Angaben. Das Passwort benötigt mindestens 12 Zeichen sowie Groß-, Kleinbuchstaben und eine Zahl." });
        try { const hash = await makePasswordHash(password); const [result] = await pool.execute("INSERT INTO customers (first_name,last_name,email,phone,password_hash) VALUES (?,?,?,?,?)", [firstName,lastName,email,phone,hash]); return sendJson(response, 201, { id: result.insertId, message: "Ihr Kundenkonto wurde erstellt. Sie können sich jetzt anmelden." }); } catch (error) { if (error.code === "ER_DUP_ENTRY") return sendJson(response, 409, { message: "Für diese E-Mail-Adresse besteht bereits ein Konto." }); console.error("[customer] registration failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Die Registrierung ist derzeit nicht verfügbar." }); }
    }
    if (pathname === "/api/customer/login") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        if (loginLimited()) return sendJson(response, 429, { message: "Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Die Anmeldedaten konnten nicht gelesen werden." }); }
        const email = validateEmail(body.email), password = typeof body.password === "string" ? body.password : ""; if (!email || !password) return sendJson(response, 401, { message: "E-Mail oder Passwort ist falsch." });
        try { const [rows] = await pool.execute("SELECT id,first_name,last_name,email,password_hash,status FROM customers WHERE email = ?", [email]); const customer = rows[0]; if (!customer || customer.status !== "active" || !await verifyPassword(password, customer.password_hash)) return sendJson(response, 401, { message: "E-Mail oder Passwort ist falsch." }); const token = crypto.randomBytes(32).toString("base64url"); customerSessions.set(token, { customerId: customer.id, expiresAt: Date.now() + CUSTOMER_SESSION_TTL_MS }); await pool.execute("UPDATE customers SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [customer.id]); setCustomerCookie(response, token, Math.floor(CUSTOMER_SESSION_TTL_MS / 1000)); return sendJson(response, 200, { authenticated: true, customer: { id: customer.id, first_name: customer.first_name, last_name: customer.last_name, email: customer.email } }); } catch (error) { console.error("[customer] login failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Die Anmeldung ist derzeit nicht verfügbar." }); }
    }
    if (pathname === "/api/customer/logout") { if (request.method !== "POST") return sendJson(response, 405, { message: "Methode nicht erlaubt." }); if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." }); const session = readCustomerSession(request); if (session) customerSessions.delete(session.token); response.setHeader("Set-Cookie", `${CUSTOMER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAdminCookie ? "; Secure" : ""}`); return sendJson(response, 200, { authenticated: false }); }
    if (pathname === "/api/customer/session") { const session = customerSessionOrRespond(request,response); if (!session) return; const [rows] = await pool.execute("SELECT id,first_name,last_name,email FROM customers WHERE id = ? AND status = 'active'", [session.customerId]); return rows[0] ? sendJson(response,200,{authenticated:true,customer:rows[0]}) : sendJson(response,401,{message:"Bitte melden Sie sich an."}); }
    const session = customerSessionOrRespond(request,response); if (!session) return;
    if (pathname === "/api/customer/profile") { if (request.method === "GET") { const [rows] = await pool.execute("SELECT id,first_name,last_name,email,phone,address,postal_code,city,status,created_at,last_login_at FROM customers WHERE id=?",[session.customerId]); return rows[0] ? sendJson(response,200,{customer:rows[0]}) : sendJson(response,404,{message:"Konto nicht gefunden."}); } if (request.method === "PATCH") { if (!isSameOriginRequest(request)) return sendJson(response,403,{message:"Anfrage nicht erlaubt."}); let b;try{b=await readJson(request)}catch{return sendJson(response,400,{message:"Ungültige Daten."})}; const values=[readText(b.first_name,80),readText(b.last_name,80),readText(b.phone,40),readText(b.address,180,{optional:true}),readText(b.postal_code,16,{optional:true}),readText(b.city,120,{optional:true})]; if(!values[0]||!values[1]||!values[2])return sendJson(response,400,{message:"Bitte prüfen Sie Ihre Angaben."}); await pool.execute("UPDATE customers SET first_name=?,last_name=?,phone=?,address=?,postal_code=?,city=? WHERE id=?",[...values,session.customerId]);return sendJson(response,200,{message:"Profil gespeichert."}); } return sendJson(response,405,{message:"Methode nicht erlaubt."}); }
    if (pathname === "/api/customer/change-password") { if (request.method !== "POST" || !isSameOriginRequest(request)) return sendJson(response,403,{message:"Anfrage nicht erlaubt."}); if(takeRateLimit(request))return sendJson(response,429,{message:"Zu viele Anfragen."}); let b;try{b=await readJson(request)}catch{return sendJson(response,400,{message:"Ungültige Daten."})};const [rows]=await pool.execute("SELECT password_hash FROM customers WHERE id=?",[session.customerId]);if(!rows[0]||!await verifyPassword(b.current_password,rows[0].password_hash)||!validCustomerPassword(b.new_password)||b.new_password!==b.password_confirmation)return sendJson(response,400,{message:"Passwort konnte nicht geändert werden."});await pool.execute("UPDATE customers SET password_hash=? WHERE id=?",[await makePasswordHash(b.new_password),session.customerId]);return sendJson(response,200,{message:"Passwort geändert."}); }
    const resource = pathname.match(/^\/api\/customer\/(appointments|quotes)(?:\/(\d+))?$/); if (resource && request.method === "GET") { const table=resource[1]==="appointments"?"appointments":"quote_requests", link=table==="appointments"?"portal_customer_id":"customer_id", id=resource[2]?Number(resource[2]):null; const columns=table==="appointments"?"id,service,object_type,address,postal_code,city,preferred_date,start_time,end_time,status,created_at":"id,requested_service,object_type,address,postal_code,city,status,created_at"; const [rows]=await pool.execute(`SELECT ${columns} FROM ${table} WHERE ${link}=?${id?" AND id=?":""} ORDER BY created_at DESC`,id?[session.customerId,id]:[session.customerId]); if(id&&!rows[0])return sendJson(response,404,{message:"Eintrag nicht gefunden."}); return sendJson(response,200,id?{[resource[1].slice(0,-1)]:rows[0]}:{rows}); }
    return sendJson(response,404,{message:"API-Endpunkt nicht gefunden."});
}

async function employeeTaskForSession(employeeId, taskId) {
    const [rows] = await pool.execute("SELECT id,employee_id,title,description,employee_notes,customer_id,appointment_id,status,priority,scheduled_date,start_time,end_time,created_at,updated_at FROM employee_tasks WHERE id=? AND employee_id=?", [taskId, employeeId]);
    return rows[0] || null;
}

async function saveEmployeeDocument(file, taskId, employeeId, description) {
    if (!file || file.field !== "document" || !file.originalName || file.buffer.length === 0 || file.buffer.length > EMPLOYEE_MAX_FILE_BYTES) {
        const error = new Error("Invalid file"); error.statusCode = 400; throw error;
    }
    const mime = detectQuoteMime(file.buffer);
    if (!allowedQuoteMimes.has(mime) || (file.declaredMime && file.declaredMime !== mime)) {
        const error = new Error("Invalid file type"); error.statusCode = 400; throw error;
    }
    await fs.promises.mkdir(EMPLOYEE_UPLOAD_DIR, { recursive: true, mode: 0o700 });
    const storedFileName = crypto.randomUUID(), extension = allowedQuoteMimes.get(mime), relativePath = path.join("employee-documents", `${storedFileName}${extension}`);
    const filePath = path.join(EMPLOYEE_UPLOAD_DIR, `${storedFileName}${extension}`);
    try {
        await fs.promises.writeFile(filePath, file.buffer, { mode: 0o600, flag: "wx" });
        const [result] = await pool.execute("INSERT INTO task_documents (task_id,employee_id,file_name,stored_file_name,mime_type,file_size,storage_path,description) VALUES (?,?,?,?,?,?,?,?)", [taskId,employeeId,file.originalName,storedFileName,mime,file.buffer.length,relativePath,description || null]);
        return { id: result.insertId, file_name: file.originalName, mime_type: mime, file_size: file.buffer.length };
    } catch (error) { await fs.promises.unlink(filePath).catch(() => {}); throw error; }
}

async function handleEmployeeApi(request, response, pathname, searchParams) {
    if (!pool) return sendJson(response, 503, { message: "Das Mitarbeiterportal ist derzeit nicht verfügbar." });

    if (pathname === "/api/employee/register") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        const admin = adminSessionOrRespond(request, response); if (!admin) return;
        return handleAdminEmployees(request, response, "/api/admin/employees", searchParams);
    }

    if (pathname === "/api/employee/login") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        if (takeEmployeeLoginRateLimit(request)) return sendJson(response, 429, { message: "Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Die Anmeldedaten konnten nicht gelesen werden." }); }
        const email = validateEmail(body.email), password = typeof body.password === "string" ? body.password : "";
        if (!email || !password) return sendJson(response, 401, { message: "E-Mail oder Passwort ist falsch." });
        try {
            const [rows] = await pool.execute("SELECT id,first_name,last_name,email,role,status,password_hash FROM employees WHERE email=?", [email]);
            const employee = rows[0];
            if (!employee || employee.status !== "ACTIVE" || !await verifyPassword(password, employee.password_hash)) return sendJson(response, 401, { message: "E-Mail oder Passwort ist falsch." });
            const token = crypto.randomBytes(32).toString("base64url");
            employeeSessions.set(token, { employeeId: employee.id, role: employee.role, expiresAt: Date.now() + EMPLOYEE_SESSION_TTL_MS });
            employeeLoginBuckets.delete(request.socket.remoteAddress || "unknown");
            await pool.execute("UPDATE employees SET last_login_at=CURRENT_TIMESTAMP WHERE id=?", [employee.id]);
            setEmployeeCookie(response, token, Math.floor(EMPLOYEE_SESSION_TTL_MS / 1000));
            return sendJson(response, 200, { authenticated: true, employee: employeeRecord(employee) });
        } catch (error) { console.error("[employee] login failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Die Anmeldung ist derzeit nicht verfügbar." }); }
    }

    if (pathname === "/api/employee/logout") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        const session = readEmployeeSession(request); if (session) employeeSessions.delete(session.token);
        response.setHeader("Set-Cookie", `${EMPLOYEE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAdminCookie ? "; Secure" : ""}`);
        return sendJson(response, 200, { authenticated: false });
    }

    const session = employeeSessionOrRespond(request, response); if (!session) return;
    if (pathname === "/api/employee/session") {
        if (request.method !== "GET") return sendJson(response, 405, { message: "Methode nicht erlaubt." });
        const [rows] = await pool.execute("SELECT id,first_name,last_name,email,role,status FROM employees WHERE id=? AND status='ACTIVE'", [session.employeeId]);
        return rows[0] ? sendJson(response, 200, { authenticated: true, employee: rows[0] }) : sendJson(response, 401, { message: "Bitte melden Sie sich an." });
    }
    if (pathname === "/api/employee/profile") {
        if (request.method === "GET") {
            const [rows] = await pool.execute("SELECT id,first_name,last_name,email,phone,role,status,employee_number,position,hire_date,created_at,last_login_at FROM employees WHERE id=?", [session.employeeId]);
            return rows[0] ? sendJson(response, 200, { employee: rows[0] }) : sendJson(response, 404, { message: "Profil nicht gefunden." });
        }
        if (request.method !== "PATCH" || !isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
        const firstName = readText(body.first_name, 80), lastName = readText(body.last_name, 80), phone = readText(body.phone, 40);
        if (!firstName || !lastName || !phone) return sendJson(response, 400, { message: "Bitte prüfen Sie Ihre Angaben." });
        await pool.execute("UPDATE employees SET first_name=?,last_name=?,phone=? WHERE id=?", [firstName,lastName,phone,session.employeeId]);
        return sendJson(response, 200, { message: "Profil gespeichert." });
    }
    if (pathname === "/api/employee/change-password") {
        if (request.method !== "POST" || !isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        if (takeRateLimit(request)) return sendJson(response, 429, { message: "Zu viele Anfragen." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
        const [rows] = await pool.execute("SELECT password_hash FROM employees WHERE id=?", [session.employeeId]);
        if (!rows[0] || !await verifyPassword(body.current_password, rows[0].password_hash) || !validCustomerPassword(body.new_password) || body.new_password !== body.password_confirmation) return sendJson(response, 400, { message: "Passwort konnte nicht geändert werden." });
        await pool.execute("UPDATE employees SET password_hash=? WHERE id=?", [await makePasswordHash(body.new_password),session.employeeId]);
        return sendJson(response, 200, { message: "Passwort geändert." });
    }

    const taskMatch = pathname.match(/^\/api\/employee\/tasks(?:\/(\d+)(?:\/documents(?:\/(\d+))?)?)?$/);
    if (taskMatch) {
        const taskId = taskMatch[1] ? Number(taskMatch[1]) : null, documentId = taskMatch[2] ? Number(taskMatch[2]) : null;
        if (!taskId && request.method === "GET") {
            const [rows] = await pool.execute("SELECT id,title,description,employee_notes,customer_id,appointment_id,status,priority,scheduled_date,start_time,end_time,created_at,updated_at FROM employee_tasks WHERE employee_id=? ORDER BY scheduled_date IS NULL,scheduled_date,start_time,id DESC", [session.employeeId]);
            return sendJson(response, 200, { rows });
        }
        const task = taskId ? await employeeTaskForSession(session.employeeId, taskId) : null;
        if (!task) return sendJson(response, 404, { message: "Aufgabe nicht gefunden." });
        if (!documentId && !pathname.endsWith("/documents") && request.method === "GET") return sendJson(response, 200, { task });
        if (!documentId && !pathname.endsWith("/documents") && request.method === "PATCH") {
            if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
            let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
            const status = readText(body.status, 20), notes = readText(body.employee_notes, 4000, { optional: true, multiline: true });
            if (!employeeTaskStatuses.has(status)) return sendJson(response, 400, { message: "Ungültiger Status." });
            await pool.execute("UPDATE employee_tasks SET status=?,employee_notes=? WHERE id=? AND employee_id=?", [status,notes || null,taskId,session.employeeId]);
            return sendJson(response, 200, { id: taskId, status, message: "Aufgabe aktualisiert." });
        }
        if (pathname.endsWith("/documents") && request.method === "GET") {
            const [rows] = await pool.execute("SELECT id,file_name,mime_type,file_size,description,created_at FROM task_documents WHERE task_id=? AND employee_id=? ORDER BY created_at DESC", [taskId,session.employeeId]);
            return sendJson(response, 200, { rows });
        }
        if (pathname.endsWith("/documents") && request.method === "POST") {
            if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
            let multipart; try { multipart = await readMultipart(request); } catch (error) { return sendJson(response, error.statusCode || 400, { message: "Datei konnte nicht gelesen werden." }); }
            if (multipart.files.length !== 1) return sendJson(response, 400, { message: "Bitte laden Sie genau eine JPG-, PNG- oder PDF-Datei hoch." });
            const description = readText(multipart.fields.description, 1000, { optional: true, multiline: true }); if (description === null) return sendJson(response, 400, { message: "Ungültige Beschreibung." });
            try { const document = await saveEmployeeDocument(multipart.files[0], taskId, session.employeeId, description); return sendJson(response, 201, { document }); } catch (error) { return sendJson(response, error.statusCode || 400, { message: "Ungültige oder zu große Datei." }); }
        }
        if (documentId && request.method === "GET") {
            const [rows] = await pool.execute("SELECT file_name,stored_file_name,mime_type,storage_path FROM task_documents WHERE id=? AND task_id=? AND employee_id=?", [documentId,taskId,session.employeeId]);
            const document = rows[0]; if (!document) return sendJson(response, 404, { message: "Dokument nicht gefunden." });
            const extension = allowedQuoteMimes.get(document.mime_type); const filePath = path.join(EMPLOYEE_UPLOAD_DIR, `${document.stored_file_name}${extension}`);
            try { const stat = await fs.promises.stat(filePath); response.writeHead(200, { "Content-Type": document.mime_type, "Content-Length": stat.size, "Content-Disposition": `attachment; filename=\"${document.file_name.replace(/[\"\\]/g, "_")}\"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" }); return fs.createReadStream(filePath).pipe(response); } catch { return sendJson(response, 404, { message: "Datei nicht gefunden." }); }
        }
        return sendJson(response, 405, { message: "Methode nicht erlaubt." });
    }

    const workLogMatch = pathname.match(/^\/api\/employee\/work-logs(?:\/(\d+))?$/);
    if (workLogMatch) {
        const workLogId = workLogMatch[1] ? Number(workLogMatch[1]) : null;
        if (!workLogId && request.method === "GET") { const [rows] = await pool.execute("SELECT id,task_id,work_date,start_time,end_time,break_minutes,notes,created_at,updated_at FROM employee_work_logs WHERE employee_id=? ORDER BY work_date DESC,start_time DESC", [session.employeeId]); return sendJson(response, 200, { rows }); }
        if (request.method !== (workLogId ? "PATCH" : "POST") || !isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
        const taskId = body.task_id == null || body.task_id === "" ? null : Number(body.task_id), workDate = readText(body.work_date,10), startTime = readText(body.start_time,5), endTime = readText(body.end_time,5), breakMinutes = Number(body.break_minutes || 0), notes = readText(body.notes,4000,{optional:true,multiline:true});
        if (!isIsoDate(workDate) || !isClockTime(startTime) || !isClockTime(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime) || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720 || notes === null) return sendJson(response, 400, { message: "Bitte prüfen Sie die Arbeitszeit." });
        if (taskId && !(await employeeTaskForSession(session.employeeId,taskId))) return sendJson(response, 404, { message: "Aufgabe nicht gefunden." });
        if (!workLogId) { const [result] = await pool.execute("INSERT INTO employee_work_logs (employee_id,task_id,work_date,start_time,end_time,break_minutes,notes) VALUES (?,?,?,?,?,?,?)", [session.employeeId,taskId,workDate,startTime,endTime,breakMinutes,notes || null]); return sendJson(response,201,{id:result.insertId,message:"Arbeitszeit erfasst."}); }
        const [result] = await pool.execute("UPDATE employee_work_logs SET task_id=?,work_date=?,start_time=?,end_time=?,break_minutes=?,notes=? WHERE id=? AND employee_id=?", [taskId,workDate,startTime,endTime,breakMinutes,notes || null,workLogId,session.employeeId]); return result.affectedRows ? sendJson(response,200,{id:workLogId,message:"Arbeitszeit gespeichert."}) : sendJson(response,404,{message:"Arbeitszeit nicht gefunden."});
    }

    if (pathname === "/api/employee/appointments" && request.method === "GET") {
        const [rows] = await pool.execute("SELECT a.id,a.service,a.address,a.postal_code,a.city,a.preferred_date,a.start_time,a.end_time,a.status,t.id AS task_id,t.title AS task_title FROM employee_tasks t JOIN appointments a ON a.id=t.appointment_id WHERE t.employee_id=? ORDER BY a.preferred_date,a.start_time", [session.employeeId]);
        return sendJson(response, 200, { rows });
    }
    return sendJson(response, 404, { message: "API-Endpunkt nicht gefunden." });
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
    ) || ["index.html", "sitemap.xml", "robots.txt"].includes(path.basename(candidate))
        && path.dirname(candidate) === ROOT;
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
