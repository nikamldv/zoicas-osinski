"use strict";

const byId = id => document.getElementById(id);
const loginView = byId("login-view");
const dashboardView = byId("dashboard-view");
const recordsBody = byId("records-body");
const dashboardMessage = byId("dashboard-message");
const statusLabels = {
    new: "Neu",
    in_progress: "In Bearbeitung",
    done: "Erledigt"
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
    byId("page-title").textContent = career ? "Bewerbungen" : "Kontaktanfragen";
    byId("records-title").textContent = career ? "Aktuelle Bewerbungen" : "Aktuelle Kontaktanfragen";
    byId("service-heading").textContent = career ? "BEREICH" : "LEISTUNG";
    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle("is-active", button.dataset.type === currentType);
    });
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

function renderRecords(rows) {
    currentRows = rows;
    recordsBody.innerHTML = rows.map((row, index) => {
        const label = currentType === "career" ? row.area : row.requested_service;
        const status = statusLabels[row.status] ? row.status : "new";
        const phone = row.phone ? `<div class="person-phone">${escapeHtml(row.phone)}</div>` : "";
        return `
            <tr>
                <td class="date-cell">${escapeHtml(formatDate(row.created_at))}</td>
                <td class="person-cell">
                    <strong>${escapeHtml(row.full_name)}</strong>
                    <a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a>
                    ${phone}
                </td>
                <td class="service-cell">${escapeHtml(label || "—")}</td>
                <td class="message-cell"><span class="message-preview">${escapeHtml(row.message || "")}</span></td>
                <td class="status-cell">
                    <span class="status-pill" data-status="${status}">${statusLabels[status]}</span>
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
        const result = await api(`/api/admin/submissions?${params.toString()}`);
        renderRecords(result.rows);
        const first = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
        const last = Math.min(result.page * result.pageSize, result.total);
        byId("result-count").textContent = `${result.total} Einträge`;
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
    await Promise.all([loadSummary(), loadSubmissions()]);
}

function openDetails(index) {
    const row = currentRows[index];
    if (!row) return;
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

recordsBody.addEventListener("click", event => {
    const button = event.target.closest("[data-record-index]");
    if (button?.classList.contains("detail-button")) openDetails(Number(button.dataset.recordIndex));
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
