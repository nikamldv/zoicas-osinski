"use strict";

const byId = id => document.getElementById(id);
const loginView = byId("login-view");
const dashboardView = byId("dashboard-view");
const recordsBody = byId("records-body");
const dashboardMessage = byId("dashboard-message");
const statusLabels = {
    new: "Neu",
    in_progress: "In Bearbeitung",
    done: "Erledigt",
    offer_sent: "Angebot gesendet",
    accepted: "Angenommen",
    declined: "Abgelehnt",
    completed: "Abgeschlossen",
    pending: "Neu", confirmed: "Bestätigt", cancelled: "Storniert"
};

let currentType = "contact";
let currentPage = 1;
let currentRows = [];
let searchTimer;

async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set("Content-Type", "application/json");

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: "same-origin",
        cache: "no-store"
    });
    let data = {};
    try {
        data = await response.json();
    } catch {
        data = {};
    }
    if (!response.ok) {
        const error = new Error(data.message || "Die Anfrage ist fehlgeschlagen.");
        error.status = response.status;
        throw error;
    }
    return data;
}

function showLogin(message = "") {
    dashboardView.hidden = true;
    loginView.hidden = false;
    const error = byId("login-error");
    error.textContent = message;
    error.hidden = !message;
}

function showDashboard(username) {
    loginView.hidden = true;
    dashboardView.hidden = false;
    byId("account-name").textContent = username || "Admin";
}

function setNotice(message, kind = "error") {
    dashboardMessage.textContent = message;
    dashboardMessage.classList.toggle("is-success", kind === "success");
    dashboardMessage.hidden = !message;
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function updateViewHeading() {
    const career = currentType === "career";
    const quote = currentType === "quote", appointment = currentType === "appointment", customer = currentType === "customer", employee = currentType === "employee";
    byId("page-title").textContent = employee ? "Mitarbeiter" : customer ? "Kunden" : appointment ? "Termine" : quote ? "Angebotsanfragen" : career ? "Bewerbungen" : "Kontaktanfragen";
    byId("records-title").textContent = employee ? "Mitarbeiterverwaltung" : customer ? "Registrierte Kunden" : appointment ? "Gebuchte Termine" : quote ? "Aktuelle Angebotsanfragen" : career ? "Aktuelle Bewerbungen" : "Aktuelle Kontaktanfragen";
    byId("service-heading").textContent = employee ? "POSITION / ROLLE" : appointment || quote ? "DIENSTLEISTUNG / ORT" : career ? "BEREICH" : "LEISTUNG";
    byId("create-employee-button").hidden = !employee;
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("is-active", button.dataset.type === currentType));
    const quoteOnlyStatuses = new Set(["offer_sent", "accepted", "declined", "completed"]);
    byId("status-filter").querySelectorAll("option").forEach(option => { option.hidden = quoteOnlyStatuses.has(option.value) ? !quote : option.value === "done" ? quote : false; });
}

async function loadSummary() {
    try {
        const summary = await api("/api/admin/summary");
        byId("stat-contacts").textContent = summary.contacts;
        byId("stat-new-contacts").textContent = summary.newContacts;
        byId("stat-applications").textContent = summary.applications;
        byId("stat-new-applications").textContent = summary.newApplications;
        byId("nav-contact-count").textContent = summary.newContacts;
        byId("nav-career-count").textContent = summary.newApplications;
        document.querySelector(".live-indicator").innerHTML = "<span></span> Datenbank verbunden";
        return true;
    } catch (error) {
        document.querySelector(".live-indicator").innerHTML = "<span></span> Datenbank nicht erreichbar";
        setNotice(error.message);
        return false;
    }
}

async function loadQuoteNavCount() {
    try {
        const result = await api("/api/admin/quotes?status=new&page=1");
        byId("nav-quote-count").textContent = result.total;
    } catch {
        // The quote migration may not be installed yet; the existing dashboard remains usable.
        byId("nav-quote-count").textContent = "—";
    }
}

async function loadEmployeeNavCount() {
    try {
        const result = await api("/api/admin/employees?page=1");
        byId("nav-employee-count").textContent = result.total;
    } catch {
        byId("nav-employee-count").textContent = "—";
    }
}

function renderRecords(rows) {
    currentRows = rows;
    if (currentType === "employee") {
        recordsBody.innerHTML = rows.map((row, index) => `
            <tr><td class="date-cell">${escapeHtml(formatDate(row.created_at))}</td>
            <td class="person-cell"><strong>${escapeHtml(`${row.first_name} ${row.last_name}`)}</strong><a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a><div class="person-phone">${escapeHtml(row.employee_number)}</div></td>
            <td class="service-cell">${escapeHtml(row.position || "—")}<div class="person-phone">${escapeHtml(row.role)}</div></td>
            <td class="message-cell"><span class="message-preview">${escapeHtml(row.phone || "—")}</span></td>
            <td class="status-cell"><span class="status-pill" data-status="${row.status === "ACTIVE" ? "done" : "new"}">${escapeHtml(row.status)}</span></td>
            <td><button class="detail-button" type="button" data-record-index="${index}">Ansehen</button></td></tr>`).join("");
        const empty = rows.length === 0;
        byId("empty-state").hidden = !empty;
        document.querySelector(".table-wrap table").hidden = empty;
        return;
    }
    recordsBody.innerHTML = rows.map((row, index) => {
        const quote = currentType === "quote", appointment = currentType === "appointment";
        const label = (quote || appointment) ? `${appointment ? row.service : row.requested_service || "—"}<div class="person-phone">${row.city || ""}</div>` : currentType === "career" ? row.area : row.requested_service;
        const status = statusLabels[row.status] ? row.status : "new";
        const phone = row.phone ? `<div class="person-phone">${escapeHtml(row.phone)}</div>` : "";
        return `
            <tr>
                <td class="date-cell">${escapeHtml(formatDate(row.created_at))}</td>
                <td class="person-cell">
                    <strong>${escapeHtml((quote || appointment) ? `${row.first_name || ""} ${row.last_name || ""}`.trim() : row.full_name)}</strong>
                    <a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a>
                    ${phone}
                </td>
                <td class="service-cell">${quote ? label : escapeHtml(label || "—")}</td>
                <td class="message-cell"><span class="message-preview">${escapeHtml(quote ? (row.object_type || "") : (row.message || ""))}</span></td>
                <td class="status-cell">
                    ${(quote || appointment) ? `<select class="status-select" data-managed-status="${escapeHtml(row.id)}">${Object.entries(statusLabels).filter(([value]) => value !== "done" && (appointment ? ["pending","confirmed","in_progress","completed","cancelled"].includes(value) : !["pending","confirmed","cancelled"].includes(value))).map(([value, text]) => `<option value="${value}" ${value === status ? "selected" : ""}>${text}</option>`).join("")}</select>` : `<span class="status-pill" data-status="${status}">${statusLabels[status]}</span>`}
                </td>
                <td><button class="detail-button" type="button" data-record-index="${index}">Ansehen</button></td>
            </tr>`;
    }).join("");

    const isEmpty = rows.length === 0;
    byId("empty-state").hidden = !isEmpty;
    document.querySelector(".table-wrap table").hidden = isEmpty;
}

async function loadSubmissions() {
    const loading = byId("loading-state");
    loading.hidden = false;
    byId("empty-state").hidden = true;
    document.querySelector(".table-wrap table").hidden = true;
    setNotice("");

    const params = new URLSearchParams({
        type: currentType,
        status: byId("status-filter").value,
        search: byId("search-input").value.trim(),
        page: String(currentPage)
    });

    try {
        const endpoint = currentType === "employee" ? "/api/admin/employees" : currentType === "quote" ? "/api/admin/quotes" : currentType === "appointment" ? "/api/admin/appointments" : currentType === "customer" ? "/api/admin/customers" : "/api/admin/submissions";
        const result = await api(`${endpoint}?${params.toString()}`);
        if (currentType === "quote") byId("nav-quote-count").textContent = result.rows.filter(row => row.status === "new").length;
        renderRecords(result.rows);
        const first = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
        const last = Math.min(result.page * result.pageSize, result.total);
        byId("result-count").textContent = `${result.total} ${currentType === "employee" ? "Mitarbeiter" : "Einträge"}`;
        byId("page-summary").textContent = result.total === 0
            ? "Keine Einträge"
            : `Einträge ${first}–${last} von ${result.total}`;
        byId("page-number").textContent = String(result.page);
        byId("previous-page").disabled = result.page <= 1;
        byId("next-page").disabled = last >= result.total;
    } catch (error) {
        currentRows = [];
        recordsBody.innerHTML = "";
        byId("empty-state").hidden = true;
        document.querySelector(".table-wrap table").hidden = true;
        byId("result-count").textContent = "—";
        byId("page-summary").textContent = "Einträge nicht verfügbar";
        byId("previous-page").disabled = true;
        byId("next-page").disabled = true;
        setNotice(error.message);
    } finally {
        loading.hidden = true;
    }
}

async function reloadDashboard() {
    await Promise.all([loadSummary(), loadSubmissions(), loadQuoteNavCount(), loadEmployeeNavCount()]);
}

async function openDetails(index) {
    const row = currentRows[index];
    if (!row) return;
    if (currentType === "appointment") {
        try { const result = await api(`/api/admin/appointments/${row.id}`); const appointment = result.appointment; byId("detail-type").textContent = `TERMIN #${appointment.id}`; byId("detail-name").textContent = `${appointment.first_name} ${appointment.last_name}`; byId("detail-date").textContent = `${appointment.preferred_date} · ${String(appointment.start_time).slice(0,5)} Uhr`; byId("detail-service").textContent = appointment.service; byId("detail-message").textContent = appointment.message || "—"; const email = byId("detail-email"); email.textContent = appointment.email; email.href = `mailto:${appointment.email}`; byId("detail-phone-row").hidden = false; byId("detail-phone").textContent = appointment.phone; byId("detail-quote-extra").hidden = false; byId("detail-quote-values").textContent = `${appointment.object_type} · ${appointment.address}, ${appointment.postal_code} ${appointment.city}`; byId("detail-files").hidden = true; byId("detail-dialog").showModal(); } catch (error) { setNotice(error.message); } return;
    }
    if (currentType === "quote") {
        try {
            const result = await api(`/api/admin/quotes/${row.id}`);
            const quote = result.quote;
            byId("detail-type").textContent = `ANGEBOTSANFRAGE #${quote.id}`;
            byId("detail-name").textContent = `${quote.first_name} ${quote.last_name}`;
            byId("detail-date").textContent = formatDate(quote.created_at);
            byId("detail-service").textContent = quote.requested_service || "—";
            byId("detail-message").textContent = quote.message || quote.additional_information || "—";
            const email = byId("detail-email"); email.textContent = quote.email; email.href = `mailto:${quote.email}`;
            byId("detail-phone-row").hidden = false; byId("detail-phone").textContent = quote.phone || "—";
            byId("detail-quote-extra").hidden = false;
            byId("detail-quote-values").textContent = `${quote.object_type} · ${quote.address}, ${quote.postal_code} ${quote.city}${quote.area_m2 ? ` · ${quote.area_m2} m²` : ""}${quote.frequency ? ` · ${quote.frequency}` : ""}${quote.preferred_date ? ` · Wunschtermin: ${quote.preferred_date}` : ""}`;
            byId("detail-files").hidden = result.files.length === 0;
            byId("detail-file-links").innerHTML = result.files.map(file => `<a href="/api/admin/quotes/${quote.id}/files/${file.id}">${escapeHtml(file.original_name)}</a>`).join("<br>") || "—";
            byId("detail-dialog").showModal();
        } catch (error) { setNotice(error.message); }
        return;
    }
    if (currentType === "employee") {
        try {
            const result = await api(`/api/admin/employees/${row.id}`);
            const employee = result.employee;
            byId("detail-type").textContent = `MITARBEITER #${employee.id}`;
            byId("detail-name").textContent = `${employee.first_name} ${employee.last_name}`;
            byId("detail-date").textContent = formatDate(employee.created_at);
            byId("detail-service").textContent = `${employee.position || "—"} · ${employee.role}`;
            byId("detail-message").textContent = employee.notes || "Keine internen Notizen.";
            const email = byId("detail-email"); email.textContent = employee.email; email.href = `mailto:${employee.email}`;
            byId("detail-phone-row").hidden = false; byId("detail-phone").textContent = employee.phone;
            byId("detail-quote-extra").hidden = false; byId("detail-quote-values").textContent = `${employee.employee_number} · ${employee.status}`;
            byId("detail-files").hidden = true;
            byId("detail-dialog").showModal();
        } catch (error) { setNotice(error.message); }
        return;
    }
    const career = currentType === "career";
    byId("detail-type").textContent = career ? "BEWERBUNG" : "KONTAKTANFRAGE";
    byId("detail-name").textContent = row.full_name || "—";
    byId("detail-date").textContent = formatDate(row.created_at);
    byId("detail-service").textContent = career ? row.area || "—" : row.requested_service || "—";
    byId("detail-message").textContent = row.message || "—";
    const email = byId("detail-email");
    email.textContent = row.email || "—";
    if (row.email) email.href = `mailto:${row.email}`;
    else email.removeAttribute("href");
    byId("detail-phone-row").hidden = !row.phone;
    byId("detail-phone").textContent = row.phone || "—";
    byId("detail-quote-extra").hidden = true;
    byId("detail-files").hidden = true;
    byId("detail-dialog").showModal();
}

async function initialize() {
    try {
        const session = await api("/api/admin/session");
        showDashboard(session.username);
        await reloadDashboard();
    } catch (error) {
        showLogin(error.status === 401 ? "" : error.message);
    }
}

byId("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type='submit']");
    submit.disabled = true;
    const errorBox = byId("login-error");
    errorBox.hidden = true;

    try {
        const body = {
            username: byId("login-username").value,
            password: byId("login-password").value
        };
        const result = await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify(body)
        });
        byId("login-password").value = "";
        showDashboard(result.username);
        await reloadDashboard();
    } catch (error) {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
    } finally {
        submit.disabled = false;
    }
});

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
        if (currentType === button.dataset.type) return;
        currentType = button.dataset.type;
        currentPage = 1;
        byId("status-filter").value = "all";
        updateViewHeading();
        loadSubmissions();
    });
});

byId("status-filter").addEventListener("change", () => {
    currentPage = 1;
    loadSubmissions();
});

byId("search-input").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
        currentPage = 1;
        loadSubmissions();
    }, 250);
});

byId("previous-page").addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    loadSubmissions();
});

byId("next-page").addEventListener("click", () => {
    currentPage += 1;
    loadSubmissions();
});

byId("refresh-button").addEventListener("click", reloadDashboard);

byId("create-employee-button").addEventListener("click", () => {
    byId("employee-form-note").hidden = true;
    byId("employee-dialog").showModal();
});

byId("employee-create-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const note = byId("employee-form-note");
    try {
        const payload = Object.fromEntries(new FormData(form));
        await api("/api/admin/employees", { method: "POST", body: JSON.stringify(payload) });
        form.reset();
        byId("employee-dialog").close();
        setNotice("Mitarbeiter wurde angelegt.", "success");
        await reloadDashboard();
    } catch (error) {
        note.textContent = error.message;
        note.hidden = false;
    }
});

recordsBody.addEventListener("click", event => {
    const button = event.target.closest("[data-record-index]");
    if (button?.classList.contains("detail-button")) openDetails(Number(button.dataset.recordIndex));
});

recordsBody.addEventListener("change", async event => {
    const select = event.target.closest("[data-managed-status]");
    if (!select) return;
    select.disabled = true;
    try {
        const endpoint = currentType === "appointment" ? "/api/admin/appointments" : "/api/admin/quotes";
        await api(`${endpoint}/${select.dataset.managedStatus}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
        await reloadDashboard();
    } catch (error) { setNotice(error.message); } finally { select.disabled = false; }
});

byId("logout-button").addEventListener("click", async () => {
    try {
        await api("/api/admin/logout", { method: "POST", body: "{}" });
    } catch {
        // The server session expires automatically even if logout cannot be reached.
    }
    showLogin();
});

updateViewHeading();
initialize();
