"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");

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
const EMPLOYEE_INVITE_TTL_HOURS = Math.min(Math.max(Number(process.env.EMPLOYEE_INVITE_TTL_HOURS || 72), 1), 168);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || `http://${HOST}:${PORT}`).replace(/\/+$/, "");
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
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
const orderStatuses = new Set(["NEU", "GEPLANT", "ZUGEWIESEN", "IN_BEARBEITUNG", "PAUSIERT", "ERLEDIGT", "STORNIERT"]);
const orderPriorities = new Set(["NORMAL", "HOCH", "DRINGEND"]);
const assignmentStatuses = new Set(["GEPLANT", "IN_BEARBEITUNG", "ERLEDIGT", "STORNIERT"]);
const absenceTypes = new Set(["URLAUB", "KRANK", "FREI", "SONSTIGE"]);

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

function invitationTokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

function waitForSmtpResponse(socket) {
    return new Promise((resolve, reject) => {
        let buffer = "";
        const onData = chunk => {
            buffer += chunk.toString("utf8");
            const lines = buffer.split("\r\n").filter(Boolean);
            const last = lines.at(-1);
            if (last && /^\d{3} /.test(last)) finish(null, { code: Number(last.slice(0, 3)), lines });
        };
        const onError = error => finish(error);
        const onClose = () => finish(new Error("SMTP connection closed unexpectedly."));
        const finish = (error, result) => {
            socket.off("data", onData); socket.off("error", onError); socket.off("close", onClose);
            error ? reject(error) : resolve(result);
        };
        socket.on("data", onData); socket.once("error", onError); socket.once("close", onClose);
    });
}

async function smtpCommand(socket, command, expected = [250]) {
    const response = waitForSmtpResponse(socket);
    socket.write(`${command}\r\n`);
    const result = await response;
    if (!expected.includes(result.code)) throw new Error(`SMTP command failed (${result.code}).`);
    return result;
}

function escapeEmailHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

function employeeInvitationEmail({ firstName, invitationUrl }) {
    const safeName = escapeEmailHtml(firstName || "");
    const safeUrl = escapeEmailHtml(invitationUrl);
    const logo = `<img src="cid:zoicas-logo" width="210" alt="Zoicas &amp; Osinski" style="display:block;width:210px;max-width:100%;height:auto;border:0;">`;
    const text = [
        `Hallo ${firstName || ""},`, "", "willkommen bei Zoicas & Osinski.", "",
        "Bitte legen Sie über den folgenden persönlichen Einladungslink Ihr Passwort für das Mitarbeiterportal fest:", invitationUrl, "",
        `Der Link ist aus Sicherheitsgründen ${EMPLOYEE_INVITE_TTL_HOURS} Stunden gültig und kann nur einmal verwendet werden.`, "",
        "Wenn Sie diese Einladung nicht erwartet haben, müssen Sie nichts unternehmen.", "", "Freundliche Grüße", "Zoicas & Osinski"
    ].join("\r\n");
    const html = `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#f5f2ed;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Ihr persönlicher Zugang zum Mitarbeiterportal von Zoicas &amp; Osinski.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0;padding:0;background:#f5f2ed;"><tr><td align="center" style="padding:38px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:650px;border-collapse:separate;overflow:hidden;background:#ffffff;border:1px solid #e2ddd6;border-radius:22px;box-shadow:0 9px 28px rgba(28,42,52,.10);"><tr><td style="padding:28px 38px;background:#102f50;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="vertical-align:middle;">${logo}</td><td align="right" style="vertical-align:middle;color:#a6d936;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.6px;">MITARBEITERPORTAL</td></tr></table></td></tr><tr><td style="padding:48px 42px 40px;font-family:Arial,sans-serif;color:#2a3440;"><h1 style="margin:0 0 28px;font-size:30px;line-height:1.25;font-weight:500;color:#27333f;">Guten Tag ${safeName},</h1><p style="margin:0 0 23px;font-size:18px;line-height:1.65;color:#3f4b57;">wir freuen uns, Sie bei Zoicas &amp; Osinski willkommen zu heißen.</p><p style="margin:0 0 28px;font-size:18px;line-height:1.65;color:#3f4b57;">Mit dieser Einladung können Sie Ihren persönlichen Zugang zum Mitarbeiterportal aktivieren und Ihr Passwort festlegen.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 30px;"><tr><td style="padding:24px 26px;border-left:4px solid #a6d936;border-radius:12px;background:#f6f8fa;"><p style="margin:0 0 11px;font-size:17px;line-height:1.5;color:#263747;"><strong>Ihr persönlicher Zugang</strong></p><p style="margin:0 0 19px;font-size:15px;line-height:1.55;color:#52616e;">Der Einladungslink ist nur für Sie bestimmt und aus Sicherheitsgründen <strong>${EMPLOYEE_INVITE_TTL_HOURS} Stunden</strong> gültig.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:8px;background:#176eae;"><a href="${safeUrl}" style="display:inline-block;padding:15px 23px;border-radius:8px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:700;text-decoration:none;">Zugang aktivieren &rarr;</a></td></tr></table></td></tr></table><p style="margin:0 0 11px;font-size:16px;line-height:1.65;color:#46535f;">Falls Sie diese Einladung nicht erwartet haben, müssen Sie nichts unternehmen.</p><p style="margin:30px 0 0;font-size:18px;line-height:1.55;color:#2d3945;">Freundliche Grüße<br><strong>Ihr Zoicas &amp; Osinski Team</strong></p><p style="margin:30px 0 0;padding-top:20px;border-top:1px solid #e9e4de;color:#7e8992;font-size:12px;line-height:1.55;">Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br><a href="${safeUrl}" style="color:#176eae;word-break:break-all;">${safeUrl}</a></p></td></tr></table></td></tr></table></body></html>`;
    return { text, html };
}

async function sendEmployeeInviteEmail({ email, firstName, invitationUrl }) {
    if (!smtpConfigured) return { delivered: false, reason: "smtp_not_configured" };
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const implicitTls = process.env.SMTP_IMPLICIT_TLS === "true" || port === 465;
    const connect = implicitTls
        ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
        : net.connect({ host, port });
    await new Promise((resolve, reject) => { connect.once(implicitTls ? "secureConnect" : "connect", resolve); connect.once("error", reject); });
    let socket = connect;
    try {
        let greeting = await waitForSmtpResponse(socket);
        if (greeting.code !== 220) throw new Error("SMTP greeting failed.");
        let hello = await smtpCommand(socket, `EHLO ${HOST}`, [250]);
        if (!implicitTls) {
            if (!hello.lines.some(line => /STARTTLS/i.test(line))) throw new Error("SMTP server does not offer STARTTLS.");
            await smtpCommand(socket, "STARTTLS", [220]);
            socket = tls.connect({ socket, servername: host, rejectUnauthorized: true });
            await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
            hello = await smtpCommand(socket, `EHLO ${HOST}`, [250]);
        }
        if (!hello.lines.some(line => /AUTH/i.test(line))) throw new Error("SMTP authentication is unavailable.");
        const auth = Buffer.from(`\u0000${process.env.SMTP_USER}\u0000${process.env.SMTP_PASSWORD}`).toString("base64");
        await smtpCommand(socket, `AUTH PLAIN ${auth}`, [235]);
        const from = String(process.env.SMTP_FROM).replace(/[\r\n]/g, "");
        await smtpCommand(socket, `MAIL FROM:<${from}>`, [250]);
        await smtpCommand(socket, `RCPT TO:<${email}>`, [250, 251]);
        await smtpCommand(socket, "DATA", [354]);
        const subject = "Ihr Zugang zum Mitarbeiterportal";
        const { text, html } = employeeInvitationEmail({ firstName, invitationUrl });
        const relatedBoundary = `zoicas-related-${crypto.randomBytes(12).toString("hex")}`;
        const alternativeBoundary = `zoicas-alt-${crypto.randomBytes(12).toString("hex")}`;
        const alternativeBody = `--${alternativeBoundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n\r\n--${alternativeBoundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html}\r\n\r\n--${alternativeBoundary}--`;
        const logoPath = path.join(ROOT, "assets", "images", "Logo", "zoicas-osinski.png");
        const logoBase64 = fs.readFileSync(logoPath).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
        const messageBody = `--${relatedBoundary}\r\nContent-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n${alternativeBody}\r\n\r\n--${relatedBoundary}\r\nContent-Type: image/png; name="zoicas-osinski.png"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <zoicas-logo>\r\nContent-Disposition: inline; filename="zoicas-osinski.png"\r\n\r\n${logoBase64}\r\n--${relatedBoundary}--`;
        const data = `From: ${from}\r\nTo: ${email}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${relatedBoundary}"\r\n\r\n${messageBody.replace(/^\./gm, "..")}\r\n.`;
        await smtpCommand(socket, data, [250]);
        await smtpCommand(socket, "QUIT", [221]);
        return { delivered: true };
    } finally { socket.destroy(); }
}

async function createEmployeeInvitation(employeeId, createdBy, employee) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + EMPLOYEE_INVITE_TTL_HOURS * 60 * 60 * 1000);
    await adminPool.execute("UPDATE employee_invitations SET revoked_at=CURRENT_TIMESTAMP WHERE employee_id=? AND accepted_at IS NULL AND revoked_at IS NULL", [employeeId]);
    await adminPool.execute("INSERT INTO employee_invitations (employee_id,token_hash,expires_at,created_by) VALUES (?,?,?,?)", [employeeId, invitationTokenHash(token), expiresAt, createdBy]);
    const invitationUrl = `${PUBLIC_BASE_URL}/public/mitarbeiter-zugang.html?token=${encodeURIComponent(token)}`;
    const delivery = await sendEmployeeInviteEmail({ email: employee.email, firstName: employee.first_name, invitationUrl });
    return { ...delivery, expiresAt: expiresAt.toISOString() };
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
    if(id&&request.method==="GET"){const [r]=await adminPool.execute("SELECT id,customer_number,first_name,last_name,email,phone,address,postal_code,city,status,created_at,last_login_at FROM customers WHERE id=?",[id]);return r[0]?sendJson(response,200,{customer:r[0]}):sendJson(response,404,{message:"Kunde nicht gefunden."});}
    if(id&&request.method==="PATCH"){if(!isSameOriginRequest(request))return sendJson(response,403,{message:"Anfrage nicht erlaubt."});let b;try{b=await readJson(request)}catch{return sendJson(response,400,{message:"Ungültige Daten."})};if(!["active","inactive","blocked"].includes(readText(b.status,20)))return sendJson(response,400,{message:"Ungültiger Status."});await adminPool.execute("UPDATE customers SET status=? WHERE id=?",[b.status,id]);return sendJson(response,200,{id,status:b.status});}
    if(!id&&request.method==="GET"){const search=(searchParams.get("search")||"").trim().slice(0,100),status=searchParams.get("status")||"all";if(status!=="all"&&!["active","inactive","blocked"].includes(status))return sendJson(response,400,{message:"Ungültige Filter."});const c=[],v=[];if(status!=="all"){c.push("status=?");v.push(status)}if(search){c.push("(customer_number LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR city LIKE ?)");for(let i=0;i<6;i++)v.push(`%${search}%`)}const w=c.length?` WHERE ${c.join(" AND ")}`:"";const [rows]=await adminPool.execute(`SELECT id,customer_number,first_name,last_name,email,phone,city,status,created_at,last_login_at FROM customers${w} ORDER BY created_at DESC LIMIT 100`,v);return sendJson(response,200,{rows,total:rows.length});}
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
    const detail = pathname.match(/^\/api\/admin\/employees\/(\d+)(?:\/(status|role|invitation))?$/);
    const id = detail ? Number(detail[1]) : null;
    const action = detail?.[2] || "";
    if (id && action === "invitation") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        try {
            const [rows] = await adminPool.execute("SELECT id,first_name,last_name,email FROM employees WHERE id=?", [id]);
            if (!rows[0]) return sendJson(response, 404, { message: "Mitarbeiter nicht gefunden." });
            await adminPool.execute("UPDATE employees SET status='INACTIVE' WHERE id=?", [id]);
            const invite = await createEmployeeInvitation(id, "admin", rows[0]);
            return sendJson(response, 201, { message: invite.delivered ? "Ein neuer Einladungslink wurde per E-Mail gesendet." : "Einladung erstellt, aber SMTP ist noch nicht eingerichtet.", emailSent: invite.delivered, expiresAt: invite.expiresAt });
        } catch (error) { console.error("[admin] employee invitation failed:", error.code || "invite_error"); return sendJson(response, 503, { message: "Einladung konnte nicht erstellt werden." }); }
    }
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
        const employeeNumber = readText(body.employee_number, 40, { optional: true }), position = readText(body.position, 120, { optional: true }), hireDate = readText(body.hire_date, 10, { optional: true }), notes = readText(body.notes, 4000, { optional: true, multiline: true });
        const role = readText(body.role || "EMPLOYEE", 16), status = readText(body.status || "ACTIVE", 16);
        if (!firstName || !lastName || !email || !phone || (employeeNumber && !/^[A-Za-z0-9_-]{3,40}$/.test(employeeNumber)) || !employeeRoles.has(role) || !employeeStatuses.has(status) || (hireDate && !isIsoDate(hireDate))) return sendJson(response, 400, { message: "Bitte prüfen Sie die Mitarbeiterdaten." });
        try {
            if (!id) {
                const inactivePassword = crypto.randomBytes(48).toString("base64url");
                const passwordHash = await makePasswordHash(inactivePassword);
                let createdEmployee;
                let generatedEmployeeNumber;
                let lastError;
                for (let attempt = 0; attempt < 5; attempt += 1) {
                    generatedEmployeeNumber = `ZO-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;
                    try {
                        [createdEmployee] = await adminPool.execute("INSERT INTO employees (first_name,last_name,email,phone,password_hash,role,status,employee_number,position,hire_date,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [firstName,lastName,email,phone,passwordHash,role,"INACTIVE",generatedEmployeeNumber,position || null,hireDate || null,notes || null]);
                        break;
                    } catch (error) {
                        lastError = error;
                        if (error.code !== "ER_DUP_ENTRY") throw error;
                    }
                }
                if (!createdEmployee) throw lastError || new Error("Employee number generation failed");
                const invite = await createEmployeeInvitation(createdEmployee.insertId, "admin", { email, first_name: firstName });
                return sendJson(response, 201, { id: createdEmployee.insertId, employeeNumber: generatedEmployeeNumber, message: invite.delivered ? "Mitarbeiter angelegt und Einladung per E-Mail gesendet." : "Mitarbeiter angelegt. SMTP ist noch nicht eingerichtet; die Einladung wurde nicht versendet.", emailSent: invite.delivered, expiresAt: invite.expiresAt });
            }
            // Employee numbers are system-assigned at creation and deliberately remain immutable.
            const [result] = await adminPool.execute("UPDATE employees SET first_name=?,last_name=?,email=?,phone=?,role=?,status=?,position=?,hire_date=?,notes=? WHERE id=?", [firstName,lastName,email,phone,role,status,position || null,hireDate || null,notes || null,id]);
            return result.affectedRows ? sendJson(response, 200, { id, message: "Mitarbeiter gespeichert." }) : sendJson(response, 404, { message: "Mitarbeiter nicht gefunden." });
        } catch (error) { if (error.code === "ER_DUP_ENTRY") return sendJson(response, 409, { message: "E-Mail oder Mitarbeiternummer ist bereits vergeben." }); console.error("[admin] employee save failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Mitarbeiter konnte nicht gespeichert werden." }); }
    }
    response.setHeader("Allow", "GET, POST, PATCH");
    return sendJson(response, 405, { message: "Methode nicht erlaubt." });
}

async function handleAdminEmployeeTasks(request, response, pathname, searchParams) {
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für Aufgaben sind noch nicht eingerichtet." });
    const match = pathname.match(/^\/api\/admin\/employee-tasks(?:\/(\d+))?$/);
    const id = match?.[1] ? Number(match[1]) : null;
    if (!id && request.method === "GET") {
        const employeeIdValue = searchParams.get("employee_id");
        const employeeId = employeeIdValue ? Number(employeeIdValue) : null;
        if (employeeIdValue && (!Number.isSafeInteger(employeeId) || employeeId < 1)) return sendJson(response, 400, { message: "Invalid employee id." });
        try {
            const [rows] = await adminPool.execute(
                `SELECT t.id,t.employee_id,t.title,t.description,t.employee_notes,t.customer_id,t.appointment_id,t.status,t.priority,t.scheduled_date,t.start_time,t.end_time,t.created_at,t.updated_at,e.first_name,e.last_name,e.employee_number FROM employee_tasks t JOIN employees e ON e.id=t.employee_id ${employeeId ? "WHERE t.employee_id=?" : ""} ORDER BY t.scheduled_date IS NULL,t.scheduled_date,t.start_time,t.id DESC`,
                employeeId ? [employeeId] : []
            );
            return sendJson(response, 200, { rows });
        } catch (error) {
            console.error("[admin] employee task list failed:", error.code || "database_error");
            return sendJson(response, 503, { message: "Aufgaben konnten nicht geladen werden." });
        }
    }
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

async function assignmentHasConflict(database, employeeId, assignmentDate, startTime, endTime, exceptAssignmentId = null) {
    const parameters = [employeeId, assignmentDate, endTime, startTime];
    let where = "employee_id=? AND assignment_date=? AND status <> 'STORNIERT' AND start_time < ? AND end_time > ?";
    if (exceptAssignmentId) { where += " AND id <> ?"; parameters.push(exceptAssignmentId); }
    const [rows] = await database.execute(`SELECT id FROM order_assignments WHERE ${where} LIMIT 1`, parameters);
    return Boolean(rows[0]);
}

function weekdayForDate(value) {
    const day = new Date(`${value}T00:00:00Z`).getUTCDay();
    return day === 0 ? 7 : day;
}

async function availabilityForSlot(database, date, startTime, endTime, { exceptAssignmentId = null } = {}) {
    const weekday = weekdayForDate(date);
    const [rows] = await database.execute(
        `SELECT e.id,e.first_name,e.last_name,e.employee_number,e.position,
                wh.start_time AS work_start,wh.end_time AS work_end,
                (SELECT COUNT(*) FROM order_assignments oa WHERE oa.employee_id=e.id AND oa.assignment_date=? AND oa.status <> 'STORNIERT') AS assignment_count,
                (SELECT CONCAT(o.order_number, ' · ', oa.start_time, '–', oa.end_time) FROM order_assignments oa JOIN orders o ON o.id=oa.order_id WHERE oa.employee_id=e.id AND oa.assignment_date=? AND oa.status <> 'STORNIERT' AND oa.start_time < ? AND oa.end_time > ?${exceptAssignmentId ? " AND oa.id <> ?" : ""} ORDER BY oa.start_time LIMIT 1) AS conflict_assignment,
                (SELECT absence_type FROM employee_absences ea WHERE ea.employee_id=e.id AND ea.start_date <= ? AND ea.end_date >= ? ORDER BY ea.start_date LIMIT 1) AS absence_type
         FROM employees e
         LEFT JOIN employee_work_hours wh ON wh.employee_id=e.id AND wh.weekday=?
         WHERE e.status='ACTIVE'
         ORDER BY assignment_count,e.last_name,e.first_name`,
        exceptAssignmentId
            ? [date, date, endTime, startTime, exceptAssignmentId, date, date, weekday]
            : [date, date, endTime, startTime, date, date, weekday]
    );
    return rows.map(row => {
        let reason = "", available = true;
        if (!row.work_start || !row.work_end || String(row.work_start).slice(0, 5) > startTime || String(row.work_end).slice(0, 5) < endTime) {
            available = false; reason = "Außerhalb der Arbeitszeit";
        } else if (row.absence_type) {
            available = false; reason = row.absence_type;
        } else if (row.conflict_assignment) {
            available = false; reason = `Bereits eingeplant: ${row.conflict_assignment}`;
        }
        return { ...row, available, reason, work_start: row.work_start ? String(row.work_start).slice(0, 5) : null, work_end: row.work_end ? String(row.work_end).slice(0, 5) : null };
    });
}

async function handleAdminAvailability(request, response, pathname, searchParams) {
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für die Einsatzplanung sind noch nicht eingerichtet." });
    const workHoursMatch = pathname.match(/^\/api\/admin\/employees\/(\d+)\/work-hours$/);
    if (workHoursMatch) {
        const employeeId = Number(workHoursMatch[1]);
        if (request.method === "GET") {
            const [rows] = await adminPool.execute("SELECT weekday,start_time,end_time FROM employee_work_hours WHERE employee_id=? ORDER BY weekday", [employeeId]);
            return sendJson(response, 200, { rows: rows.map(row => ({ ...row, start_time: String(row.start_time).slice(0, 5), end_time: String(row.end_time).slice(0, 5) })) });
        }
        if (request.method !== "PATCH" || !isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Arbeitszeiten." }); }
        const hours = Array.isArray(body.hours) ? body.hours : [];
        if (hours.length > 7 || hours.some(item => !Number.isInteger(Number(item.weekday)) || Number(item.weekday) < 1 || Number(item.weekday) > 7 || !isClockTime(item.start_time) || !isClockTime(item.end_time) || item.start_time >= item.end_time)) return sendJson(response, 400, { message: "Bitte prüfen Sie die Arbeitszeiten." });
        const [employee] = await adminPool.execute("SELECT id FROM employees WHERE id=?", [employeeId]); if (!employee[0]) return sendJson(response, 404, { message: "Mitarbeiter nicht gefunden." });
        const connection = await adminPool.getConnection();
        try { await connection.beginTransaction(); await connection.execute("DELETE FROM employee_work_hours WHERE employee_id=?", [employeeId]); for (const item of hours) await connection.execute("INSERT INTO employee_work_hours (employee_id,weekday,start_time,end_time) VALUES (?,?,?,?)", [employeeId,Number(item.weekday),item.start_time,item.end_time]); await connection.commit(); return sendJson(response, 200, { message: "Arbeitszeiten gespeichert." }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
    if (pathname === "/api/admin/available-employees" && request.method === "GET") {
        const date = String(searchParams.get("date") || ""), startTime = String(searchParams.get("start_time") || ""), endTime = String(searchParams.get("end_time") || ""), exceptId = searchParams.get("exclude_assignment_id") ? Number(searchParams.get("exclude_assignment_id")) : null;
        if (!isIsoDate(date) || !isClockTime(startTime) || !isClockTime(endTime) || startTime >= endTime || (exceptId !== null && (!Number.isSafeInteger(exceptId) || exceptId < 1))) return sendJson(response, 400, { message: "Datum oder Uhrzeit ist ungültig." });
        const rows = await availabilityForSlot(adminPool, date, startTime, endTime, { exceptAssignmentId: exceptId });
        return sendJson(response, 200, { date, start_time: startTime, end_time: endTime, recommended_employee_id: rows.find(row => row.available)?.id || null, rows });
    }
    if (pathname === "/api/admin/absences") {
        if (request.method === "GET") { const from = String(searchParams.get("from") || ""), to = String(searchParams.get("to") || ""); const values = [], where = []; if (from && to && isIsoDate(from) && isIsoDate(to)) { where.push("a.start_date <= ? AND a.end_date >= ?"); values.push(to, from); } const [rows] = await adminPool.execute(`SELECT a.*,e.first_name,e.last_name,e.employee_number FROM employee_absences a JOIN employees e ON e.id=a.employee_id${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY a.start_date,e.last_name`, values); return sendJson(response, 200, { rows }); }
        if (request.method !== "POST" || !isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Abwesenheit." }); }
        const employeeId=Number(body.employee_id), type=readText(body.absence_type,16), startDate=readText(body.start_date,10), endDate=readText(body.end_date,10), notes=readText(body.notes,1000,{optional:true,multiline:true});
        if (!Number.isSafeInteger(employeeId) || employeeId < 1 || !absenceTypes.has(type) || !isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate || notes === null) return sendJson(response, 400, { message: "Bitte prüfen Sie die Abwesenheit." });
        const [employee] = await adminPool.execute("SELECT id FROM employees WHERE id=?",[employeeId]); if (!employee[0]) return sendJson(response,404,{message:"Mitarbeiter nicht gefunden."});
        const [result] = await adminPool.execute("INSERT INTO employee_absences (employee_id,absence_type,start_date,end_date,notes,created_by) VALUES (?,?,?,?,?,?)",[employeeId,type,startDate,endDate,notes || null,"admin"]); return sendJson(response,201,{id:result.insertId,message:"Abwesenheit gespeichert."});
    }
    const absenceMatch = pathname.match(/^\/api\/admin\/absences\/(\d+)$/);
    if (absenceMatch) {
        const absenceId = Number(absenceMatch[1]);
        if (request.method === "DELETE") { if (!isSameOriginRequest(request)) return sendJson(response,403,{message:"Anfrage nicht erlaubt."}); const [result]=await adminPool.execute("DELETE FROM employee_absences WHERE id=?",[absenceId]); return result.affectedRows ? sendJson(response,200,{message:"Abwesenheit entfernt."}) : sendJson(response,404,{message:"Abwesenheit nicht gefunden."}); }
        if (request.method !== "PATCH" || !isSameOriginRequest(request)) return sendJson(response,403,{message:"Anfrage nicht erlaubt."});
        let body; try { body=await readJson(request); } catch { return sendJson(response,400,{message:"Ungültige Abwesenheit."}); }
        const type=readText(body.absence_type,16),startDate=readText(body.start_date,10),endDate=readText(body.end_date,10),notes=readText(body.notes,1000,{optional:true,multiline:true});
        if (!absenceTypes.has(type)||!isIsoDate(startDate)||!isIsoDate(endDate)||startDate>endDate||notes===null) return sendJson(response,400,{message:"Bitte prüfen Sie die Abwesenheit."});
        const [result]=await adminPool.execute("UPDATE employee_absences SET absence_type=?,start_date=?,end_date=?,notes=? WHERE id=?",[type,startDate,endDate,notes || null,absenceId]); return result.affectedRows ? sendJson(response,200,{id:absenceId,message:"Abwesenheit gespeichert."}) : sendJson(response,404,{message:"Abwesenheit nicht gefunden."});
    }
    if (pathname === "/api/admin/employee-schedules" && request.method === "GET") {
        const date = String(searchParams.get("date") || ""); if (!isIsoDate(date)) return sendJson(response,400,{message:"Datum ist ungültig."});
        const weekday=weekdayForDate(date); const [employees]=await adminPool.execute("SELECT e.id,e.first_name,e.last_name,e.employee_number,wh.start_time AS work_start,wh.end_time AS work_end FROM employees e LEFT JOIN employee_work_hours wh ON wh.employee_id=e.id AND wh.weekday=? WHERE e.status='ACTIVE' ORDER BY e.last_name,e.first_name",[weekday]);
        const [assignments]=await adminPool.execute("SELECT a.*,o.order_number,o.title FROM order_assignments a JOIN orders o ON o.id=a.order_id WHERE a.assignment_date=? AND a.status <> 'STORNIERT' ORDER BY a.start_time",[date]);
        const [absences]=await adminPool.execute("SELECT employee_id,absence_type,start_date,end_date FROM employee_absences WHERE start_date<=? AND end_date>=?",[date,date]);
        return sendJson(response,200,{date,employees:employees.map(e=>({...e,work_start:e.work_start?String(e.work_start).slice(0,5):null,work_end:e.work_end?String(e.work_end).slice(0,5):null,assignments:assignments.filter(a=>a.employee_id===e.id),absence:absences.find(a=>a.employee_id===e.id)||null}))});
    }
    return false;
}

async function handleAdminOrders(request, response, pathname, searchParams) {
    if (!adminPool) return sendJson(response, 503, { message: "Die Datenbankrechte für Aufträge sind noch nicht eingerichtet." });
    const match = pathname.match(/^\/api\/admin\/orders(?:\/(\d+)(?:\/assignments(?:\/(\d+))?)?)?$/);
    const orderId = match?.[1] ? Number(match[1]) : null;
    const assignmentId = match?.[2] ? Number(match[2]) : null;
    const assignmentsRoute = pathname.includes("/assignments");
    if (assignmentsRoute) {
        if (!orderId) return sendJson(response, 404, { message: "Auftrag nicht gefunden." });
        if (request.method === "GET" && !assignmentId) {
            const [rows] = await adminPool.execute("SELECT a.*,e.first_name,e.last_name,e.employee_number,e.position FROM order_assignments a JOIN employees e ON e.id=a.employee_id WHERE a.order_id=? ORDER BY a.assignment_date,a.start_time", [orderId]);
            return sendJson(response, 200, { rows });
        }
        if (!["POST", "PATCH", "DELETE"].includes(request.method)) { response.setHeader("Allow", "GET, POST, PATCH, DELETE"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        if (request.method === "DELETE") {
            if (!assignmentId) return sendJson(response, 400, { message: "Einsatz fehlt." });
            const [result] = await adminPool.execute("DELETE FROM order_assignments WHERE id=? AND order_id=?", [assignmentId, orderId]);
            return result.affectedRows ? sendJson(response, 200, { message: "Einsatz entfernt." }) : sendJson(response, 404, { message: "Einsatz nicht gefunden." });
        }
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
        const employeeId = Number(body.employee_id), assignmentDate = readText(body.assignment_date, 10), startTime = readText(body.start_time, 5), endTime = readText(body.end_time, 5), status = readText(body.status || "GEPLANT", 20), notes = readText(body.notes, 4000, { optional: true, multiline: true });
        if (!Number.isSafeInteger(employeeId) || employeeId < 1 || !isIsoDate(assignmentDate) || !isClockTime(startTime) || !isClockTime(endTime) || startTime >= endTime || !assignmentStatuses.has(status)) return sendJson(response, 400, { message: "Bitte prüfen Sie die Einsatzdaten." });
        const [employee] = await adminPool.execute("SELECT id FROM employees WHERE id=? AND status='ACTIVE'", [employeeId]);
        if (!employee[0]) return sendJson(response, 404, { message: "Aktiver Mitarbeiter nicht gefunden." });
        if (await assignmentHasConflict(adminPool, employeeId, assignmentDate, startTime, endTime, assignmentId)) return sendJson(response, 409, { message: "Der Mitarbeiter ist zu diesem Zeitpunkt bereits eingeplant." });
        const availability = await availabilityForSlot(adminPool, assignmentDate, startTime, endTime, { exceptAssignmentId: assignmentId });
        const employeeAvailability = availability.find(item => item.id === employeeId);
        if (!employeeAvailability?.available) return sendJson(response, 409, { message: employeeAvailability?.reason === "" ? "Der Mitarbeiter ist zu diesem Zeitpunkt nicht verfügbar." : `Der Mitarbeiter ist zu diesem Zeitpunkt nicht verfügbar: ${employeeAvailability?.reason || "Arbeitszeit prüfen."}` });
        if (request.method === "POST") {
            const [result] = await adminPool.execute("INSERT INTO order_assignments (order_id,employee_id,assignment_date,start_time,end_time,status,notes) VALUES (?,?,?,?,?,?,?)", [orderId, employeeId, assignmentDate, startTime, endTime, status, notes || null]);
            await adminPool.execute("UPDATE orders SET status='ZUGEWIESEN' WHERE id=? AND status IN ('NEU','GEPLANT')", [orderId]);
            return sendJson(response, 201, { id: result.insertId, message: "Mitarbeiter eingeplant." });
        }
        if (!assignmentId) return sendJson(response, 400, { message: "Einsatz fehlt." });
        const [result] = await adminPool.execute("UPDATE order_assignments SET employee_id=?,assignment_date=?,start_time=?,end_time=?,status=?,notes=? WHERE id=? AND order_id=?", [employeeId, assignmentDate, startTime, endTime, status, notes || null, assignmentId, orderId]);
        return result.affectedRows ? sendJson(response, 200, { id: assignmentId, message: "Einsatz gespeichert." }) : sendJson(response, 404, { message: "Einsatz nicht gefunden." });
    }
    if (!orderId && request.method === "GET") {
        const search = String(searchParams.get("search") || "").trim().slice(0, 100), status = String(searchParams.get("status") || "all"), priority = String(searchParams.get("priority") || "all");
        if (status !== "all" && !orderStatuses.has(status)) return sendJson(response, 400, { message: "Ungültiger Status." });
        if (priority !== "all" && !orderPriorities.has(priority)) return sendJson(response, 400, { message: "Ungültige Priorität." });
        const clauses = [], values = [];
        if (status !== "all") { clauses.push("o.status=?"); values.push(status); }
        if (priority !== "all") { clauses.push("o.priority=?"); values.push(priority); }
        if (search) { clauses.push("(o.order_number LIKE ? OR o.title LIKE ? OR o.service_type LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.customer_number LIKE ?)"); for (let i = 0; i < 6; i += 1) values.push(`%${search}%`); }
        const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
        const [rows] = await adminPool.execute(`SELECT o.id,o.order_number,o.service_type,o.title,o.address,o.postal_code,o.city,o.preferred_date,o.status,o.priority,o.created_at,c.first_name,c.last_name,c.customer_number,COUNT(a.id) AS assignment_count FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN order_assignments a ON a.order_id=o.id${where} GROUP BY o.id ORDER BY o.preferred_date IS NULL,o.preferred_date DESC,o.id DESC LIMIT 100`, values);
        return sendJson(response, 200, { rows, total: rows.length });
    }
    if (orderId && request.method === "GET") {
        const [orders] = await adminPool.execute("SELECT o.*,c.first_name,c.last_name,c.customer_number,c.email,c.phone,c.address AS customer_address,c.postal_code AS customer_postal_code,c.city AS customer_city FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?", [orderId]);
        if (!orders[0]) return sendJson(response, 404, { message: "Auftrag nicht gefunden." });
        const [assignments] = await adminPool.execute("SELECT a.*,e.first_name,e.last_name,e.employee_number,e.position FROM order_assignments a JOIN employees e ON e.id=a.employee_id WHERE a.order_id=? ORDER BY a.assignment_date,a.start_time", [orderId]);
        const [workLogs] = await adminPool.execute("SELECT w.*,e.first_name,e.last_name FROM employee_work_logs w JOIN employees e ON e.id=w.employee_id WHERE w.order_id=? ORDER BY w.work_date DESC,w.start_time DESC", [orderId]);
        const [documents] = await adminPool.execute("SELECT d.id,d.task_id,d.employee_id,d.file_name,d.mime_type,d.file_size,d.description,d.created_at,e.first_name,e.last_name FROM task_documents d JOIN employees e ON e.id=d.employee_id WHERE d.order_id=? ORDER BY d.created_at DESC", [orderId]);
        return sendJson(response, 200, { order: orders[0], assignments, workLogs, documents });
    }
    if (!orderId && request.method !== "POST") { response.setHeader("Allow", "GET, POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
    if (orderId && !["PATCH", "DELETE"].includes(request.method)) { response.setHeader("Allow", "GET, PATCH, DELETE"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
    if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
    if (request.method === "DELETE") { const [result] = await adminPool.execute("UPDATE orders SET status='STORNIERT' WHERE id=?", [orderId]); return result.affectedRows ? sendJson(response, 200, { message: "Auftrag storniert." }) : sendJson(response, 404, { message: "Auftrag nicht gefunden." }); }
    let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
    const customerId = Number(body.customer_id), appointmentId = body.appointment_id ? Number(body.appointment_id) : null, quoteId = body.quote_id ? Number(body.quote_id) : null;
    const serviceType = readText(body.service_type, 160), title = readText(body.title, 180), description = readText(body.description, 4000, { optional: true, multiline: true }), objectType = readText(body.object_type, 120, { optional: true }), frequency = readText(body.frequency, 80, { optional: true }), address = readText(body.address, 180, { optional: true }), postalCode = readText(body.postal_code, 16, { optional: true }), city = readText(body.city, 120, { optional: true }), preferredDate = readText(body.preferred_date, 10, { optional: true }), status = readText(body.status || "NEU", 20), priority = readText(body.priority || "NORMAL", 20), notes = readText(body.notes, 4000, { optional: true, multiline: true });
    const area = body.area_sqm === "" || body.area_sqm == null ? null : Number(body.area_sqm), duration = body.estimated_duration_minutes === "" || body.estimated_duration_minutes == null ? null : Number(body.estimated_duration_minutes);
    if (!Number.isSafeInteger(customerId) || customerId < 1 || !serviceType || !title || !orderStatuses.has(status) || !orderPriorities.has(priority) || (preferredDate && !isIsoDate(preferredDate)) || (area !== null && (!Number.isFinite(area) || area < 0)) || (duration !== null && (!Number.isSafeInteger(duration) || duration < 1 || duration > 1440))) return sendJson(response, 400, { message: "Bitte prüfen Sie die Auftragsdaten." });
    const [customer] = await adminPool.execute("SELECT id FROM customers WHERE id=?", [customerId]); if (!customer[0]) return sendJson(response, 404, { message: "Kunde nicht gefunden." });
    if (Number.isSafeInteger(appointmentId) && appointmentId > 0) {
        const [appointments] = await adminPool.execute("SELECT id,portal_customer_id FROM appointments WHERE id=?", [appointmentId]);
        if (!appointments[0]) return sendJson(response, 404, { message: "Termin nicht gefunden." });
        if (appointments[0].portal_customer_id && Number(appointments[0].portal_customer_id) !== customerId) return sendJson(response, 400, { message: "Der Termin gehört zu einem anderen Kundenkonto." });
    }
    if (Number.isSafeInteger(quoteId) && quoteId > 0) {
        const [quotes] = await adminPool.execute("SELECT id,customer_id FROM quote_requests WHERE id=?", [quoteId]);
        if (!quotes[0]) return sendJson(response, 404, { message: "Angebotsanfrage nicht gefunden." });
        if (quotes[0].customer_id && Number(quotes[0].customer_id) !== customerId) return sendJson(response, 400, { message: "Die Angebotsanfrage gehört zu einem anderen Kundenkonto." });
    }
    if (!orderId && Number.isSafeInteger(appointmentId) && appointmentId > 0) {
        const [existing] = await adminPool.execute("SELECT id,order_number FROM orders WHERE appointment_id=? LIMIT 1", [appointmentId]);
        if (existing[0]) return sendJson(response, 409, { message: `Für diesen Termin existiert bereits der Auftrag ${existing[0].order_number}.` });
    }
    const fields = [customerId, Number.isSafeInteger(appointmentId) ? appointmentId : null, Number.isSafeInteger(quoteId) ? quoteId : null, serviceType, title, description || null, objectType || null, area, frequency || null, address || null, postalCode || null, city || null, preferredDate || null, status, priority, duration, notes || null];
    if (!orderId) {
        let created, orderNumber, lastError;
        for (let attempt = 0; attempt < 5; attempt += 1) { orderNumber = `AU-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`; try { [created] = await adminPool.execute("INSERT INTO orders (order_number,customer_id,appointment_id,quote_id,service_type,title,description,object_type,area_sqm,frequency,address,postal_code,city,preferred_date,status,priority,estimated_duration_minutes,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [orderNumber, ...fields]); break; } catch (error) { lastError = error; if (error.code !== "ER_DUP_ENTRY") throw error; } }
        if (!created) throw lastError || new Error("Order number generation failed");
        return sendJson(response, 201, { id: created.insertId, orderNumber, message: "Auftrag erstellt." });
    }
    const [result] = await adminPool.execute("UPDATE orders SET customer_id=?,appointment_id=?,quote_id=?,service_type=?,title=?,description=?,object_type=?,area_sqm=?,frequency=?,address=?,postal_code=?,city=?,preferred_date=?,status=?,priority=?,estimated_duration_minutes=?,notes=? WHERE id=?", [...fields, orderId]);
    return result.affectedRows ? sendJson(response, 200, { id: orderId, message: "Auftrag gespeichert." }) : sendJson(response, 404, { message: "Auftrag nicht gefunden." });
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
    if (pathname === "/api/admin/employees" || /^\/api\/admin\/employees\/\d+(?:\/(?:status|role|invitation))?$/.test(pathname)) {
        return handleAdminEmployees(request, response, pathname, searchParams);
    }
    if (/^\/api\/admin\/employees\/\d+\/work-hours$/.test(pathname) || pathname === "/api/admin/available-employees" || pathname === "/api/admin/employee-schedules" || pathname === "/api/admin/absences" || /^\/api\/admin\/absences\/\d+$/.test(pathname)) {
        return handleAdminAvailability(request, response, pathname, searchParams);
    }
    if (pathname === "/api/admin/employee-tasks" || /^\/api\/admin\/employee-tasks\/\d+$/.test(pathname)) {
        return handleAdminEmployeeTasks(request, response, pathname, searchParams);
    }
    if (pathname === "/api/admin/orders" || /^\/api\/admin\/orders\/\d+(?:\/assignments(?:\/\d+)?)?$/.test(pathname)) {
        return handleAdminOrders(request, response, pathname, searchParams);
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
        try {
            const hash = await makePasswordHash(password);
            let result, customerNumber, lastError;
            for (let attempt = 0; attempt < 5; attempt += 1) {
                customerNumber = `KU-${new Date().getFullYear()}-${crypto.randomInt(100000, 1000000)}`;
                try {
                    [result] = await pool.execute("INSERT INTO customers (customer_number,first_name,last_name,email,phone,password_hash) VALUES (?,?,?,?,?,?)", [customerNumber,firstName,lastName,email,phone,hash]);
                    break;
                } catch (error) {
                    lastError = error;
                    if (error.code !== "ER_DUP_ENTRY") throw error;
                }
            }
            if (!result) throw lastError || new Error("Customer number generation failed");
            return sendJson(response, 201, { id: result.insertId, customerNumber, message: "Ihr Kundenkonto wurde erstellt. Sie können sich jetzt anmelden." });
        } catch (error) { if (error.code === "ER_DUP_ENTRY") return sendJson(response, 409, { message: "Für diese E-Mail-Adresse besteht bereits ein Konto." }); console.error("[customer] registration failed:", error.code || "database_error"); return sendJson(response, 503, { message: "Die Registrierung ist derzeit nicht verfügbar." }); }
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
    if (pathname === "/api/customer/session") { const session = customerSessionOrRespond(request,response); if (!session) return; const [rows] = await pool.execute("SELECT id,customer_number,first_name,last_name,email FROM customers WHERE id = ? AND status = 'active'", [session.customerId]); return rows[0] ? sendJson(response,200,{authenticated:true,customer:rows[0]}) : sendJson(response,401,{message:"Bitte melden Sie sich an."}); }
    const session = customerSessionOrRespond(request,response); if (!session) return;
    if (pathname === "/api/customer/profile") { if (request.method === "GET") { const [rows] = await pool.execute("SELECT id,customer_number,first_name,last_name,email,phone,address,postal_code,city,status,created_at,last_login_at FROM customers WHERE id=?",[session.customerId]); return rows[0] ? sendJson(response,200,{customer:rows[0]}) : sendJson(response,404,{message:"Konto nicht gefunden."}); } if (request.method === "PATCH") { if (!isSameOriginRequest(request)) return sendJson(response,403,{message:"Anfrage nicht erlaubt."}); let b;try{b=await readJson(request)}catch{return sendJson(response,400,{message:"Ungültige Daten."})}; const values=[readText(b.first_name,80),readText(b.last_name,80),readText(b.phone,40),readText(b.address,180,{optional:true}),readText(b.postal_code,16,{optional:true}),readText(b.city,120,{optional:true})]; if(!values[0]||!values[1]||!values[2])return sendJson(response,400,{message:"Bitte prüfen Sie Ihre Angaben."}); await pool.execute("UPDATE customers SET first_name=?,last_name=?,phone=?,address=?,postal_code=?,city=? WHERE id=?",[...values,session.customerId]);return sendJson(response,200,{message:"Profil gespeichert."}); } return sendJson(response,405,{message:"Methode nicht erlaubt."}); }
    if (pathname === "/api/customer/change-password") { if (request.method !== "POST" || !isSameOriginRequest(request)) return sendJson(response,403,{message:"Anfrage nicht erlaubt."}); if(takeRateLimit(request))return sendJson(response,429,{message:"Zu viele Anfragen."}); let b;try{b=await readJson(request)}catch{return sendJson(response,400,{message:"Ungültige Daten."})};const [rows]=await pool.execute("SELECT password_hash FROM customers WHERE id=?",[session.customerId]);if(!rows[0]||!await verifyPassword(b.current_password,rows[0].password_hash)||!validCustomerPassword(b.new_password)||b.new_password!==b.password_confirmation)return sendJson(response,400,{message:"Passwort konnte nicht geändert werden."});await pool.execute("UPDATE customers SET password_hash=? WHERE id=?",[await makePasswordHash(b.new_password),session.customerId]);return sendJson(response,200,{message:"Passwort geändert."}); }
    const orderMatch = pathname.match(/^\/api\/customer\/orders(?:\/(\d+))?$/);
    if (orderMatch && request.method === "GET") {
        const orderId = orderMatch[1] ? Number(orderMatch[1]) : null;
        const [rows] = await pool.execute(`SELECT id,order_number,service_type,title,description,object_type,address,postal_code,city,preferred_date,status,priority,created_at FROM orders WHERE customer_id=?${orderId ? " AND id=?" : ""} ORDER BY preferred_date DESC,id DESC`, orderId ? [session.customerId, orderId] : [session.customerId]);
        if (orderId && !rows[0]) return sendJson(response, 404, { message: "Auftrag nicht gefunden." });
        return sendJson(response, 200, orderId ? { order: rows[0] } : { rows });
    }
    const resource = pathname.match(/^\/api\/customer\/(appointments|quotes)(?:\/(\d+))?$/); if (resource && request.method === "GET") { const table=resource[1]==="appointments"?"appointments":"quote_requests", link=table==="appointments"?"portal_customer_id":"customer_id", id=resource[2]?Number(resource[2]):null; const columns=table==="appointments"?"id,service,object_type,address,postal_code,city,preferred_date,start_time,end_time,status,created_at":"id,requested_service,object_type,address,postal_code,city,status,created_at"; const [rows]=await pool.execute(`SELECT ${columns} FROM ${table} WHERE ${link}=?${id?" AND id=?":""} ORDER BY created_at DESC`,id?[session.customerId,id]:[session.customerId]); if(id&&!rows[0])return sendJson(response,404,{message:"Eintrag nicht gefunden."}); return sendJson(response,200,id?{[resource[1].slice(0,-1)]:rows[0]}:{rows}); }
    return sendJson(response,404,{message:"API-Endpunkt nicht gefunden."});
}

async function employeeTaskForSession(employeeId, taskId) {
    const [rows] = await pool.execute("SELECT id,employee_id,title,description,employee_notes,customer_id,appointment_id,status,priority,scheduled_date,start_time,end_time,created_at,updated_at FROM employee_tasks WHERE id=? AND employee_id=?", [taskId, employeeId]);
    return rows[0] || null;
}

async function saveEmployeeDocument(file, taskId, employeeId, description, orderId = null) {
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
        const [result] = await pool.execute("INSERT INTO task_documents (task_id,order_id,employee_id,file_name,stored_file_name,mime_type,file_size,storage_path,description) VALUES (?,?,?,?,?,?,?,?,?)", [taskId,orderId,employeeId,file.originalName,storedFileName,mime,file.buffer.length,relativePath,description || null]);
        return { id: result.insertId, file_name: file.originalName, mime_type: mime, file_size: file.buffer.length, order_id: orderId };
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

    if (pathname === "/api/employee/activate") {
        if (request.method !== "POST") { response.setHeader("Allow", "POST"); return sendJson(response, 405, { message: "Methode nicht erlaubt." }); }
        if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        if (takeEmployeeLoginRateLimit(request)) return sendJson(response, 429, { message: "Zu viele Versuche. Bitte versuchen Sie es später erneut." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Die Zugangsdaten konnten nicht gelesen werden." }); }
        const token = typeof body.token === "string" && /^[A-Za-z0-9_-]{40,128}$/.test(body.token) ? body.token : "";
        const password = body.password, confirmation = body.password_confirmation;
        if (!token || !validCustomerPassword(password) || password !== confirmation) return sendJson(response, 400, { message: "Bitte verwenden Sie ein Passwort mit mindestens 12 Zeichen, Groß-/Kleinbuchstaben und einer Zahl." });
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute("SELECT i.id AS invitation_id,i.employee_id,i.expires_at,i.accepted_at,i.revoked_at,e.id,e.first_name,e.last_name,e.email,e.role,e.status FROM employee_invitations i JOIN employees e ON e.id=i.employee_id WHERE i.token_hash=? FOR UPDATE", [invitationTokenHash(token)]);
            const invitation = rows[0];
            if (!invitation || invitation.accepted_at || invitation.revoked_at || new Date(invitation.expires_at).getTime() < Date.now()) { await connection.rollback(); return sendJson(response, 400, { message: "Dieser Einladungslink ist ungültig oder abgelaufen." }); }
            await connection.execute("UPDATE employees SET password_hash=?,status='ACTIVE',last_login_at=CURRENT_TIMESTAMP WHERE id=?", [await makePasswordHash(password), invitation.employee_id]);
            await connection.execute("UPDATE employee_invitations SET accepted_at=CURRENT_TIMESTAMP WHERE id=?", [invitation.invitation_id]);
            await connection.commit();
            const sessionToken = crypto.randomBytes(32).toString("base64url");
            employeeSessions.set(sessionToken, { employeeId: invitation.employee_id, role: invitation.role, expiresAt: Date.now() + EMPLOYEE_SESSION_TTL_MS });
            employeeLoginBuckets.delete(request.socket.remoteAddress || "unknown");
            setEmployeeCookie(response, sessionToken, Math.floor(EMPLOYEE_SESSION_TTL_MS / 1000));
            return sendJson(response, 200, { authenticated: true, employee: { id: invitation.employee_id, first_name: invitation.first_name, last_name: invitation.last_name, email: invitation.email, role: invitation.role } });
        } catch (error) { await connection.rollback().catch(() => {}); console.error("[employee] activation failed:", error.code || "activation_error"); return sendJson(response, 503, { message: "Der Zugang konnte nicht aktiviert werden." }); } finally { connection.release(); }
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

    const employeeOrderMatch = pathname.match(/^\/api\/employee\/orders(?:\/(\d+))?$/);
    if (employeeOrderMatch && request.method === "GET") {
        const orderId = employeeOrderMatch[1] ? Number(employeeOrderMatch[1]) : null;
        const [rows] = await pool.execute(`SELECT o.id,o.order_number,o.service_type,o.title,o.description,o.object_type,o.address,o.postal_code,o.city,o.preferred_date,o.status,o.priority,a.id AS assignment_id,a.assignment_date,a.start_time,a.end_time,a.status AS assignment_status,a.notes AS assignment_notes,c.first_name,c.last_name,c.customer_number,c.phone FROM order_assignments a JOIN orders o ON o.id=a.order_id JOIN customers c ON c.id=o.customer_id WHERE a.employee_id=?${orderId ? " AND o.id=?" : ""} AND a.status <> 'STORNIERT' ORDER BY a.assignment_date,a.start_time`, orderId ? [session.employeeId, orderId] : [session.employeeId]);
        if (orderId && !rows[0]) return sendJson(response, 404, { message: "Auftrag nicht gefunden." });
        return sendJson(response, 200, orderId ? { order: rows[0] } : { rows });
    }

    if (pathname === "/api/employee/schedule" && request.method === "GET") {
        const date = String(searchParams.get("date") || new Date().toISOString().slice(0, 10));
        const view = searchParams.get("view") === "week" ? "week" : "day";
        if (!isIsoDate(date)) return sendJson(response, 400, { message: "Datum ist ungültig." });
        const first = new Date(`${date}T00:00:00Z`);
        if (view === "week") first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
        const dates = Array.from({ length: view === "week" ? 5 : 1 }, (_, index) => { const current = new Date(first); current.setUTCDate(first.getUTCDate() + index); return current.toISOString().slice(0, 10); });
        const [hours] = await pool.execute("SELECT weekday,start_time,end_time FROM employee_work_hours WHERE employee_id=?", [session.employeeId]);
        const [assignments] = await pool.execute("SELECT a.assignment_date,a.start_time,a.end_time,a.status,o.id AS order_id,o.order_number,o.title,o.service_type,o.address,o.postal_code,o.city,c.first_name,c.last_name FROM order_assignments a JOIN orders o ON o.id=a.order_id JOIN customers c ON c.id=o.customer_id WHERE a.employee_id=? AND a.assignment_date BETWEEN ? AND ? AND a.status <> 'STORNIERT' ORDER BY a.assignment_date,a.start_time", [session.employeeId,dates[0],dates[dates.length - 1]]);
        const [absences] = await pool.execute("SELECT absence_type,start_date,end_date,notes FROM employee_absences WHERE employee_id=? AND start_date<=? AND end_date>=?", [session.employeeId,dates[dates.length - 1],dates[0]]);
        return sendJson(response, 200, { view, days: dates.map(day => ({ date: day, work_hours: hours.filter(row => Number(row.weekday) === weekdayForDate(day)).map(row => ({ start_time: String(row.start_time).slice(0,5), end_time: String(row.end_time).slice(0,5) })), assignments: assignments.filter(row => String(row.assignment_date).slice(0,10) === day).map(row => ({ ...row, start_time:String(row.start_time).slice(0,5),end_time:String(row.end_time).slice(0,5) })), absence: absences.find(row => String(row.start_date).slice(0,10) <= day && String(row.end_date).slice(0,10) >= day) || null })) });
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
            const [rows] = await pool.execute("SELECT id,order_id,file_name,mime_type,file_size,description,created_at FROM task_documents WHERE task_id=? AND employee_id=? ORDER BY created_at DESC", [taskId,session.employeeId]);
            return sendJson(response, 200, { rows });
        }
        if (pathname.endsWith("/documents") && request.method === "POST") {
            if (!isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
            let multipart; try { multipart = await readMultipart(request); } catch (error) { return sendJson(response, error.statusCode || 400, { message: "Datei konnte nicht gelesen werden." }); }
            if (multipart.files.length !== 1) return sendJson(response, 400, { message: "Bitte laden Sie genau eine JPG-, PNG- oder PDF-Datei hoch." });
            const description = readText(multipart.fields.description, 1000, { optional: true, multiline: true });
            const orderId = multipart.fields.order_id ? Number(multipart.fields.order_id) : null;
            if (description === null || (orderId !== null && (!Number.isSafeInteger(orderId) || orderId < 1))) return sendJson(response, 400, { message: "Ungültige Beschreibung oder Auftragsbezug." });
            if (orderId) { const [orders] = await pool.execute("SELECT order_id FROM order_assignments WHERE order_id=? AND employee_id=? AND status <> 'STORNIERT'", [orderId, session.employeeId]); if (!orders[0]) return sendJson(response, 404, { message: "Auftrag nicht gefunden." }); }
            try { const document = await saveEmployeeDocument(multipart.files[0], taskId, session.employeeId, description, orderId); return sendJson(response, 201, { document }); } catch (error) { return sendJson(response, error.statusCode || 400, { message: "Ungültige oder zu große Datei." }); }
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
        if (!workLogId && request.method === "GET") { const [rows] = await pool.execute("SELECT id,task_id,order_id,work_date,start_time,end_time,break_minutes,notes,created_at,updated_at FROM employee_work_logs WHERE employee_id=? ORDER BY work_date DESC,start_time DESC", [session.employeeId]); return sendJson(response, 200, { rows }); }
        if (request.method !== (workLogId ? "PATCH" : "POST") || !isSameOriginRequest(request)) return sendJson(response, 403, { message: "Anfrage nicht erlaubt." });
        let body; try { body = await readJson(request); } catch { return sendJson(response, 400, { message: "Ungültige Daten." }); }
        const taskId = body.task_id == null || body.task_id === "" ? null : Number(body.task_id), orderId = body.order_id == null || body.order_id === "" ? null : Number(body.order_id), workDate = readText(body.work_date,10), startTime = readText(body.start_time,5), endTime = readText(body.end_time,5), breakMinutes = Number(body.break_minutes || 0), notes = readText(body.notes,4000,{optional:true,multiline:true});
        if (!isIsoDate(workDate) || !isClockTime(startTime) || !isClockTime(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime) || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720 || notes === null) return sendJson(response, 400, { message: "Bitte prüfen Sie die Arbeitszeit." });
        if (taskId && !(await employeeTaskForSession(session.employeeId,taskId))) return sendJson(response, 404, { message: "Aufgabe nicht gefunden." });
        if (orderId) { const [orders] = await pool.execute("SELECT a.order_id FROM order_assignments a WHERE a.order_id=? AND a.employee_id=? AND a.status <> 'STORNIERT'", [orderId,session.employeeId]); if (!orders[0]) return sendJson(response, 404, { message: "Auftrag nicht gefunden." }); }
        if (!workLogId) { const [result] = await pool.execute("INSERT INTO employee_work_logs (employee_id,task_id,order_id,work_date,start_time,end_time,break_minutes,notes) VALUES (?,?,?,?,?,?,?,?)", [session.employeeId,taskId,orderId,workDate,startTime,endTime,breakMinutes,notes || null]); return sendJson(response,201,{id:result.insertId,message:"Arbeitszeit erfasst."}); }
        const [result] = await pool.execute("UPDATE employee_work_logs SET task_id=?,order_id=?,work_date=?,start_time=?,end_time=?,break_minutes=?,notes=? WHERE id=? AND employee_id=?", [taskId,orderId,workDate,startTime,endTime,breakMinutes,notes || null,workLogId,session.employeeId]); return result.affectedRows ? sendJson(response,200,{id:workLogId,message:"Arbeitszeit gespeichert."}) : sendJson(response,404,{message:"Arbeitszeit nicht gefunden."});
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
