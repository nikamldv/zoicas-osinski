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
let selectedEmployee = null;
let selectedOrder = null;
let orderCustomers = [];
let orderEmployees = [];
let orderAssignments = [];
let selectedAppointment = null;
let scheduleWeek = false;
const weekdayNames = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

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
    dashboardMessage.classList.toggle("is-warning", kind === "warning");
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
    const quote = currentType === "quote", appointment = currentType === "appointment", customer = currentType === "customer", employee = currentType === "employee", order = currentType === "order", schedule = currentType === "schedule";
    byId("page-title").textContent = schedule ? "Einsatzplanung" : order ? "Aufträge" : employee ? "Mitarbeiter" : customer ? "Kunden" : appointment ? "Termine" : quote ? "Angebotsanfragen" : career ? "Bewerbungen" : "Kontaktanfragen";
    byId("records-title").textContent = order ? "Auftragsverwaltung" : employee ? "Mitarbeiterverwaltung" : customer ? "Registrierte Kunden" : appointment ? "Gebuchte Termine" : quote ? "Aktuelle Angebotsanfragen" : career ? "Aktuelle Bewerbungen" : "Aktuelle Kontaktanfragen";
    byId("service-heading").textContent = order ? "LEISTUNG / ADRESSE" : employee ? "POSITION / ROLLE" : appointment || quote ? "DIENSTLEISTUNG / ORT" : career ? "BEREICH" : "LEISTUNG";
    byId("create-employee-button").hidden = !employee;
    byId("create-order-button").hidden = !order;
    byId("schedule-panel").hidden = !schedule;
    document.querySelector(".records-panel").hidden = schedule;
    document.querySelector(".privacy-note").hidden = schedule;
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("is-active", button.dataset.type === currentType));
    const quoteOnlyStatuses = new Set(["offer_sent", "accepted", "declined", "completed"]);
    const employeeStatuses = new Set(["all", "ACTIVE", "INACTIVE"]);
    const orderStatuses = new Set(["all", "NEU", "GEPLANT", "ZUGEWIESEN", "IN_BEARBEITUNG", "PAUSIERT", "ERLEDIGT", "STORNIERT"]);
    byId("status-filter").querySelectorAll("option").forEach(option => {
        option.hidden = order ? !orderStatuses.has(option.value) : employee
            ? !employeeStatuses.has(option.value)
            : quoteOnlyStatuses.has(option.value) ? !quote : option.value === "done" ? quote : ["ACTIVE", "INACTIVE"].includes(option.value);
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

async function loadOrderNavCount() {
    try {
        const result = await api("/api/admin/orders?status=NEU");
        byId("nav-order-count").textContent = result.total;
    } catch {
        byId("nav-order-count").textContent = "—";
    }
}

async function loadOrderSelections() {
    const [customers, employees] = await Promise.all([
        api("/api/admin/customers?page=1"),
        api("/api/admin/employees?status=ACTIVE&page=1")
    ]);
    orderCustomers = customers.rows || [];
    orderEmployees = employees.rows || [];
    byId("order-customer").innerHTML = `<option value="">Kunde wählen</option>${orderCustomers.map(customer => `<option value="${customer.id}">${escapeHtml(`${customer.first_name} ${customer.last_name}`)} · ${escapeHtml(customer.customer_number || customer.email)}</option>`).join("")}`;
    byId("assignment-employee").innerHTML = `<option value="">Mitarbeiter wählen</option>${orderEmployees.map(employee => `<option value="${employee.id}">${escapeHtml(`${employee.first_name} ${employee.last_name}`)} · ${escapeHtml(employee.employee_number || employee.position || "")}</option>`).join("")}`;
}

function renderRecords(rows) {
    currentRows = rows;
    if (currentType === "order") {
        recordsBody.innerHTML = rows.map((row, index) => `
            <tr><td class="date-cell">${escapeHtml(row.order_number)}</td>
            <td class="person-cell"><strong>${escapeHtml(`${row.first_name} ${row.last_name}`)}</strong><span class="person-phone">${escapeHtml(row.customer_number || "—")}</span></td>
            <td class="service-cell"><strong>${escapeHtml(row.service_type)}</strong><div class="person-phone">${escapeHtml([row.address, row.postal_code, row.city].filter(Boolean).join(", ") || "—")}</div></td>
            <td class="message-cell"><span class="message-preview">${escapeHtml(row.title)}</span><div class="person-phone">${escapeHtml(row.preferred_date || "Termin offen")} · ${escapeHtml(String(row.assignment_count || 0))} Einsatz(e)</div></td>
            <td class="status-cell"><span class="status-pill" data-status="${escapeHtml(row.status === "ERLEDIGT" ? "done" : "new")}">${escapeHtml(row.status)} · ${escapeHtml(row.priority)}</span></td>
            <td><button class="detail-button" type="button" data-record-index="${index}">Öffnen</button></td></tr>`).join("");
        const empty = rows.length === 0;
        byId("empty-state").hidden = !empty;
        document.querySelector(".table-wrap table").hidden = empty;
        return;
    }
    if (currentType === "customer") {
        recordsBody.innerHTML = rows.map((row, index) => `
            <tr><td class="date-cell">${escapeHtml(formatDate(row.created_at))}</td>
            <td class="person-cell"><strong>${escapeHtml(`${row.first_name} ${row.last_name}`)}</strong><a href="mailto:${escapeHtml(row.email)}">${escapeHtml(row.email)}</a><div class="person-phone">${escapeHtml(row.customer_number || "—")}</div></td>
            <td class="service-cell">${escapeHtml(row.city || "—")}</td>
            <td class="message-cell"><span class="message-preview">${escapeHtml(row.phone || "—")}</span></td>
            <td class="status-cell"><span class="status-pill" data-status="${row.status === "active" ? "done" : "new"}">${escapeHtml(row.status)}</span></td>
            <td><button class="detail-button" type="button" data-record-index="${index}">Ansehen</button></td></tr>`).join("");
        const empty = rows.length === 0;
        byId("empty-state").hidden = !empty;
        document.querySelector(".table-wrap table").hidden = empty;
        return;
    }
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
    if (currentType === "schedule") return;
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
        const endpoint = currentType === "order" ? "/api/admin/orders" : currentType === "employee" ? "/api/admin/employees" : currentType === "quote" ? "/api/admin/quotes" : currentType === "appointment" ? "/api/admin/appointments" : currentType === "customer" ? "/api/admin/customers" : "/api/admin/submissions";
        const result = await api(`${endpoint}?${params.toString()}`);
        if (currentType === "quote") byId("nav-quote-count").textContent = result.rows.filter(row => row.status === "new").length;
        renderRecords(result.rows);
        const resultPage = result.page || 1, pageSize = result.pageSize || result.rows.length || 1;
        const first = result.total === 0 ? 0 : (resultPage - 1) * pageSize + 1;
        const last = Math.min(resultPage * pageSize, result.total);
        byId("result-count").textContent = `${result.total} ${currentType === "employee" ? "Mitarbeiter" : "Einträge"}`;
        byId("page-summary").textContent = result.total === 0
            ? "Keine Einträge"
            : `Einträge ${first}–${last} von ${result.total}`;
        byId("page-number").textContent = String(resultPage);
        byId("previous-page").disabled = resultPage <= 1 || currentType === "order";
        byId("next-page").disabled = last >= result.total || currentType === "order";
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

function isoToday(offset = 0) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function scheduleDateText(value) { return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`)); }
function scheduleTime(value) { return String(value || "").slice(0, 5); }

async function loadSchedule() {
    const date = byId("schedule-date").value || isoToday();
    byId("schedule-date").value = date;
    const days = scheduleWeek ? 5 : 1;
    const results = await Promise.all(Array.from({ length: days }, (_, index) => { const day = new Date(`${date}T00:00:00`); day.setDate(day.getDate() + index); return api(`/api/admin/employee-schedules?date=${day.toISOString().slice(0, 10)}`); }));
    byId("schedule-title").textContent = scheduleWeek ? "Wochenansicht" : scheduleDateText(date);
    byId("schedule-week").textContent = scheduleWeek ? "Tagesansicht" : "Wochenansicht";
    const absenceRows = results.flatMap(result => result.employees.filter(employee => employee.absence).map(employee => ({ employee, date: result.date, absence: employee.absence })));
    byId("absence-list").innerHTML = absenceRows.map(row => `<article class="assignment-row"><div><strong>${escapeHtml(`${row.employee.first_name} ${row.employee.last_name}`)}</strong><br><span>${escapeHtml(row.absence.absence_type)} · ${escapeHtml(row.date)}</span></div></article>`).join("") || "<p class=\"empty-copy\">Keine Abwesenheiten im gewählten Zeitraum.</p>";
    byId("schedule-grid").innerHTML = results.map(result => `<section class="schedule-day"><h3>${escapeHtml(scheduleDateText(result.date))}</h3>${result.employees.map(employee => { const assignments = employee.assignments.map(item => `<div class="schedule-block"><strong>${escapeHtml(item.order_number)}</strong><span>${scheduleTime(item.start_time)}–${scheduleTime(item.end_time)} · ${escapeHtml(item.title)}</span></div>`).join(""); const availability = employee.absence ? `<div class="schedule-absence">${escapeHtml(employee.absence.absence_type)}</div>` : employee.work_start ? `<small>${scheduleTime(employee.work_start)}–${scheduleTime(employee.work_end)}</small>` : "<small>Keine Arbeitszeit</small>"; return `<article class="schedule-employee"><header><strong>${escapeHtml(`${employee.first_name} ${employee.last_name}`)}</strong>${availability}</header><div class="schedule-lane">${assignments || `<span class="schedule-free">Frei</span>`}</div></article>`; }).join("")}</section>`).join("");
}

async function refreshAvailableEmployees() {
    const form = byId("assignment-form"), date = form.elements.namedItem("assignment_date").value, start = form.elements.namedItem("start_time").value, end = form.elements.namedItem("end_time").value;
    if (!date || !start || !end || start >= end) return;
    try { const result = await api(`/api/admin/available-employees?date=${encodeURIComponent(date)}&start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}${form.elements.namedItem("assignment_id").value ? `&exclude_assignment_id=${form.elements.namedItem("assignment_id").value}` : ""}`); byId("available-employee-list").innerHTML = result.rows.map(item => `<button type="button" class="availability-row ${item.available ? "is-available" : "is-unavailable"}" data-available-employee="${item.id}" ${item.available ? "" : "disabled"}><strong>${item.available ? "●" : "●"} ${escapeHtml(`${item.first_name} ${item.last_name}`)}</strong><span>${escapeHtml(item.available ? `${item.work_start}–${item.work_end} verfügbar` : item.reason)}</span>${item.id === result.recommended_employee_id ? "<em>Empfohlen</em>" : ""}</button>`).join(""); } catch (error) { byId("available-employee-list").innerHTML = `<p class="empty-copy">${escapeHtml(error.message)}</p>`; }
}

async function reloadDashboard() {
    await Promise.all([loadSummary(), loadSubmissions(), loadQuoteNavCount(), loadEmployeeNavCount(), loadOrderNavCount()]);
}

function assignmentRow(assignment) {
    return `<article class="assignment-row"><div><strong>${escapeHtml(`${assignment.first_name} ${assignment.last_name}`)}</strong><br><span>${escapeHtml(assignment.assignment_date)} · ${escapeHtml(String(assignment.start_time).slice(0, 5))}–${escapeHtml(String(assignment.end_time).slice(0, 5))} · ${escapeHtml(assignment.status)}</span></div><div class="assignment-actions"><button type="button" data-assignment-edit="${assignment.id}">Bearbeiten</button><button type="button" class="danger" data-assignment-delete="${assignment.id}">Entfernen</button></div></article>`;
}

function renderAssignments() {
    byId("order-assignment-list").innerHTML = orderAssignments.map(assignmentRow).join("") || "<p class=\"empty-copy\">Noch kein Mitarbeiter eingeplant.</p>";
}

async function openOrderDialog(order = null) {
    const form = byId("order-form");
    form.reset();
    byId("order-form-note").hidden = true;
    byId("assignment-form").reset();
    byId("assignment-form-note").hidden = true;
    await loadOrderSelections();
    selectedOrder = order;
    orderAssignments = [];
    byId("order-id").value = order ? order.id : "";
    byId("order-dialog-title").textContent = order ? `Auftrag ${order.order_number || "bearbeiten"}` : "Auftrag anlegen";
    byId("order-dialog-intro").textContent = order ? "Ändern Sie die Auftragsdaten oder planen Sie einen Einsatz." : "Erfassen Sie alle Angaben zum Auftrag. Pflichtfelder sind mit * markiert.";
    byId("order-assignment-section").hidden = !order;
    if (order) {
        const result = await api(`/api/admin/orders/${order.id}`);
        selectedOrder = result.order;
        orderAssignments = result.assignments || [];
        Object.entries(result.order).forEach(([key, value]) => {
            const field = form.elements.namedItem(key);
            if (field) field.value = key === "preferred_date" && value ? String(value).slice(0, 10) : value ?? "";
        });
        renderAssignments();
        byId("order-document-list").innerHTML = (result.documents || []).map(document => `<article class="assignment-row"><div><strong>${escapeHtml(document.file_name)}</strong><br><span>${escapeHtml(`${document.first_name} ${document.last_name}`)} · ${escapeHtml(document.description || "Ohne Beschreibung")}</span></div></article>`).join("") || "<p class=\"empty-copy\">Noch keine private Dokumentation zu diesem Auftrag.</p>";
    }
    byId("order-dialog").showModal();
}

function openEmployeeDialog(employee = null) {
    const form = byId("employee-create-form");
    form.reset();
    form.dataset.employeeId = employee ? String(employee.id) : "";
    byId("employee-form-note").hidden = true;
    byId("employee-status-field").hidden = !employee;
    byId("employee-dialog-title").textContent = employee ? "Mitarbeiter bearbeiten" : "Mitarbeiter anlegen";
    byId("employee-dialog-intro").textContent = employee
        ? "Aktualisieren Sie Stammdaten, Rolle oder Kontostatus dieser Person."
        : "Erfassen Sie die Stammdaten. Nach dem Speichern erhält die Person einen sicheren Link zur eigenen Passwortvergabe.";
    form.querySelector("button[type='submit']").textContent = employee ? "Änderungen speichern" : "Mitarbeiter speichern";
    const employeeNumberField = byId("employee-number");
    employeeNumberField.readOnly = true;
    employeeNumberField.placeholder = employee ? "" : "Wird automatisch vergeben";
    if (employee) {
        ["first_name", "last_name", "email", "phone", "employee_number", "position", "role", "status", "notes"].forEach(name => {
            const field = form.elements.namedItem(name);
            if (field) field.value = employee[name] || "";
        });
        const hireDate = form.elements.namedItem("hire_date");
        if (hireDate) hireDate.value = employee.hire_date ? String(employee.hire_date).slice(0, 10) : "";
    }
    byId("employee-dialog").showModal();
}

async function openWorkHoursDialog(employee) {
    if (!employee) return;
    const result = await api(`/api/admin/employees/${employee.id}/work-hours`);
    const byWeekday = new Map((result.rows || []).map(row => [Number(row.weekday), row]));
    byId("work-hours-form").reset();
    byId("work-hours-form").elements.namedItem("employee_id").value = employee.id;
    byId("work-hours-dialog-title").textContent = `Arbeitszeiten – ${employee.first_name} ${employee.last_name}`;
    byId("work-hours-dialog-intro").textContent = "Aktivieren Sie die Tage, an denen diese Person regulär eingesetzt werden kann.";
    byId("work-hours-rows").innerHTML = weekdayNames.map((name, index) => { const row = byWeekday.get(index + 1); return `<label class="work-hours-row"><span><input type="checkbox" name="enabled_${index + 1}" ${row ? "checked" : ""}> ${name}</span><input name="start_${index + 1}" type="time" value="${row ? String(row.start_time).slice(0,5) : "08:00"}"><span>bis</span><input name="end_${index + 1}" type="time" value="${row ? String(row.end_time).slice(0,5) : "16:00"}"></label>`; }).join("");
    byId("work-hours-form-note").hidden = true;
    byId("work-hours-dialog").showModal();
}

function openTaskDialog(employee) {
    if (!employee || employee.status !== "ACTIVE") {
        setNotice("Aufgaben können erst aktiven Mitarbeitern zugewiesen werden.", "warning");
        return;
    }
    const form = byId("employee-task-form");
    form.reset();
    byId("task-employee-id").value = employee.id;
    byId("employee-task-form-note").hidden = true;
    byId("employee-task-dialog-intro").textContent = `Neue Aufgabe für ${employee.first_name} ${employee.last_name}.`;
    byId("employee-task-dialog").showModal();
}

async function openDetails(index) {
    const row = currentRows[index];
    if (!row) return;
    byId("resend-employee-invite").hidden = true;
    byId("employee-detail-actions").hidden = true;
    byId("employee-task-summary").hidden = true;
    byId("create-order-from-appointment").hidden = true;
    selectedEmployee = null;
    if (currentType === "order") {
        try { await openOrderDialog(row); } catch (error) { setNotice(error.message); }
        return;
    }
    if (currentType === "appointment") {
        try { const result = await api(`/api/admin/appointments/${row.id}`); const appointment = result.appointment; selectedAppointment = appointment; byId("detail-type").textContent = `TERMIN #${appointment.id}`; byId("detail-name").textContent = `${appointment.first_name} ${appointment.last_name}`; byId("detail-date").textContent = `${appointment.preferred_date} · ${String(appointment.start_time).slice(0,5)} Uhr`; byId("detail-service").textContent = appointment.service; byId("detail-message").textContent = appointment.message || "—"; const email = byId("detail-email"); email.textContent = appointment.email; email.href = `mailto:${appointment.email}`; byId("detail-phone-row").hidden = false; byId("detail-phone").textContent = appointment.phone; byId("detail-quote-extra").hidden = false; byId("detail-quote-values").textContent = `${appointment.object_type} · ${appointment.address}, ${appointment.postal_code} ${appointment.city}`; byId("detail-files").hidden = true; byId("create-order-from-appointment").hidden = false; byId("detail-dialog").showModal(); } catch (error) { setNotice(error.message); } return;
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
            selectedEmployee = employee;
            byId("employee-detail-actions").hidden = false;
            const tasks = await api(`/api/admin/employee-tasks?employee_id=${employee.id}`);
            byId("employee-task-summary").hidden = false;
            byId("employee-task-list").innerHTML = tasks.rows.length
                ? tasks.rows.map(task => `${escapeHtml(task.title)} <small>(${escapeHtml(task.status)} · ${escapeHtml(task.priority)})</small>`).join("<br>")
                : "Noch keine Aufgaben zugewiesen.";
            const resend = byId("resend-employee-invite"); resend.hidden = false; resend.dataset.employeeId = employee.id;
            byId("detail-dialog").showModal();
        } catch (error) { setNotice(error.message); }
        return;
    }
    if (currentType === "customer") {
        try {
            const result = await api(`/api/admin/customers/${row.id}`);
            const customer = result.customer;
            byId("detail-type").textContent = `KUNDE ${customer.customer_number || `#${customer.id}`}`;
            byId("detail-name").textContent = `${customer.first_name} ${customer.last_name}`;
            byId("detail-date").textContent = formatDate(customer.created_at);
            byId("detail-service").textContent = customer.city || "—";
            byId("detail-message").textContent = "Kundenkonto im Kundenportal.";
            const email = byId("detail-email"); email.textContent = customer.email; email.href = `mailto:${customer.email}`;
            byId("detail-phone-row").hidden = false; byId("detail-phone").textContent = customer.phone || "—";
            byId("detail-quote-extra").hidden = false;
            byId("detail-quote-values").textContent = `${customer.customer_number || "—"} · ${customer.status}${customer.address ? ` · ${customer.address}, ${customer.postal_code || ""} ${customer.city || ""}` : ""}`;
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
    byId("resend-employee-invite").hidden = true;
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
    button.addEventListener("click", async () => {
        if (currentType === button.dataset.type) return;
        currentType = button.dataset.type;
        currentPage = 1;
        byId("status-filter").value = "all";
        updateViewHeading();
        if (currentType === "schedule") { try { await loadSchedule(); } catch (error) { setNotice(error.message); } } else loadSubmissions();
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

byId("schedule-date").value = isoToday();
byId("schedule-date").addEventListener("change", () => loadSchedule().catch(error => setNotice(error.message)));
byId("schedule-previous").addEventListener("click", () => { const date = new Date(`${byId("schedule-date").value}T00:00:00`); date.setDate(date.getDate() - (scheduleWeek ? 7 : 1)); byId("schedule-date").value = date.toISOString().slice(0, 10); loadSchedule().catch(error => setNotice(error.message)); });
byId("schedule-next").addEventListener("click", () => { const date = new Date(`${byId("schedule-date").value}T00:00:00`); date.setDate(date.getDate() + (scheduleWeek ? 7 : 1)); byId("schedule-date").value = date.toISOString().slice(0, 10); loadSchedule().catch(error => setNotice(error.message)); });
byId("schedule-week").addEventListener("click", () => { scheduleWeek = !scheduleWeek; loadSchedule().catch(error => setNotice(error.message)); });
byId("create-absence-button").addEventListener("click", async () => { try { if (!orderEmployees.length) await loadOrderSelections(); byId("absence-employee").innerHTML = `<option value="">Mitarbeiter wählen</option>${orderEmployees.map(employee => `<option value="${employee.id}">${escapeHtml(`${employee.first_name} ${employee.last_name}`)}</option>`).join("")}`; const form=byId("absence-form"); form.reset(); form.elements.namedItem("start_date").value=byId("schedule-date").value; form.elements.namedItem("end_date").value=byId("schedule-date").value; byId("absence-form-note").hidden=true; byId("absence-dialog").showModal(); } catch(error) { setNotice(error.message); } });
byId("absence-form").addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget, note=byId("absence-form-note"), id=form.elements.namedItem("absence_id").value; try { const payload=Object.fromEntries(new FormData(form)); delete payload.absence_id; const result=await api(id ? `/api/admin/absences/${id}` : "/api/admin/absences",{method:id ? "PATCH":"POST",body:JSON.stringify(payload)}); byId("absence-dialog").close(); setNotice(result.message,"success"); await loadSchedule(); } catch(error) { note.textContent=error.message; note.hidden=false; } });

byId("create-employee-button").addEventListener("click", () => {
    openEmployeeDialog();
});

byId("create-order-button").addEventListener("click", () => {
    openOrderDialog().catch(error => setNotice(error.message));
});

byId("edit-employee-button").addEventListener("click", () => {
    if (!selectedEmployee) return;
    byId("detail-dialog").close();
    openEmployeeDialog(selectedEmployee);
});

byId("edit-work-hours-button").addEventListener("click", () => {
    if (!selectedEmployee) return;
    byId("detail-dialog").close();
    openWorkHoursDialog(selectedEmployee).catch(error => setNotice(error.message));
});

byId("work-hours-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget, note = byId("work-hours-form-note"), employeeId = form.elements.namedItem("employee_id").value;
    const hours = weekdayNames.map((_, index) => index + 1).filter(day => form.elements.namedItem(`enabled_${day}`).checked).map(day => ({ weekday: day, start_time: form.elements.namedItem(`start_${day}`).value, end_time: form.elements.namedItem(`end_${day}`).value }));
    try { const result = await api(`/api/admin/employees/${employeeId}/work-hours`, { method: "PATCH", body: JSON.stringify({ hours }) }); byId("work-hours-dialog").close(); setNotice(result.message, "success"); if (currentType === "schedule") await loadSchedule(); } catch (error) { note.textContent = error.message; note.hidden = false; }
});

byId("assign-task-button").addEventListener("click", () => {
    if (!selectedEmployee) return;
    byId("detail-dialog").close();
    openTaskDialog(selectedEmployee);
});

byId("resend-employee-invite").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!button.dataset.employeeId) return;
    button.disabled = true;
    try {
        const result = await api(`/api/admin/employees/${button.dataset.employeeId}/invitation`, { method: "POST", body: JSON.stringify({}) });
        byId("detail-dialog").close();
        setNotice(result.message, result.emailSent === false ? "warning" : "success");
        await reloadDashboard();
    } catch (error) { setNotice(error.message); } finally { button.disabled = false; }
});

byId("create-order-from-appointment").addEventListener("click", async () => {
    if (!selectedAppointment) return;
    try {
        byId("detail-dialog").close();
        await openOrderDialog();
        const appointment = selectedAppointment;
        const customer = orderCustomers.find(item => String(item.id) === String(appointment.portal_customer_id || "")) || orderCustomers.find(item => item.email && appointment.email && item.email.toLowerCase() === appointment.email.toLowerCase());
        if (customer) byId("order-customer").value = customer.id;
        const form = byId("order-form");
        byId("order-appointment-id").value = appointment.id;
        const values = { service_type: appointment.service, title: `${appointment.service} – ${appointment.first_name} ${appointment.last_name}`, description: appointment.message || "", object_type: appointment.object_type || "", address: appointment.address || "", postal_code: appointment.postal_code || "", city: appointment.city || "", preferred_date: appointment.preferred_date ? String(appointment.preferred_date).slice(0, 10) : "", notes: `Erstellt aus Termin #${appointment.id}.` };
        Object.entries(values).forEach(([key, value]) => { const field = form.elements.namedItem(key); if (field) field.value = value; });
        if (!customer) setNotice("Kunde des Termins ist nicht als Kundenkonto registriert. Bitte wählen Sie den Kunden im Auftrag aus.", "warning");
    } catch (error) { setNotice(error.message); }
});

byId("employee-create-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const note = byId("employee-form-note");
    try {
        const payload = Object.fromEntries(new FormData(form));
        const employeeId = form.dataset.employeeId;
        const result = await api(employeeId ? `/api/admin/employees/${employeeId}` : "/api/admin/employees", { method: employeeId ? "PATCH" : "POST", body: JSON.stringify(payload) });
        form.reset();
        form.dataset.employeeId = "";
        byId("employee-dialog").close();
        setNotice(result.message || (employeeId ? "Mitarbeiter gespeichert." : "Mitarbeiter wurde angelegt."), result.emailSent === false ? "warning" : "success");
        await reloadDashboard();
    } catch (error) {
        note.textContent = error.message;
        note.hidden = false;
    }
});

byId("employee-task-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const note = byId("employee-task-form-note");
    try {
        const result = await api("/api/admin/employee-tasks", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        form.reset();
        byId("employee-task-dialog").close();
        setNotice(result.message || "Aufgabe zugewiesen.", "success");
        await reloadDashboard();
    } catch (error) {
        note.textContent = error.message;
        note.hidden = false;
    }
});

byId("order-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const note = byId("order-form-note");
    const id = byId("order-id").value;
    try {
        const payload = Object.fromEntries(new FormData(form));
        delete payload.id;
        const result = await api(id ? `/api/admin/orders/${id}` : "/api/admin/orders", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
        if (!id) {
            byId("order-id").value = result.id;
            selectedOrder = { id: result.id, order_number: result.orderNumber };
            byId("order-dialog-title").textContent = `Auftrag ${result.orderNumber}`;
            byId("order-assignment-section").hidden = false;
            renderAssignments();
        }
        note.textContent = result.message || "Auftrag gespeichert.";
        note.hidden = false;
        note.classList.remove("is-error");
        await reloadDashboard();
    } catch (error) { note.textContent = error.message; note.hidden = false; }
});

byId("assignment-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const note = byId("assignment-form-note");
    const orderId = byId("order-id").value;
    if (!orderId) return;
    try {
        const payload = Object.fromEntries(new FormData(form));
        const assignmentId = payload.assignment_id;
        delete payload.assignment_id;
        const result = await api(`/api/admin/orders/${orderId}/assignments${assignmentId ? `/${assignmentId}` : ""}`, { method: assignmentId ? "PATCH" : "POST", body: JSON.stringify(payload) });
        form.reset();
        note.textContent = result.message || "Einsatz gespeichert."; note.hidden = false;
        const details = await api(`/api/admin/orders/${orderId}`);
        orderAssignments = details.assignments || []; renderAssignments();
        await reloadDashboard();
    } catch (error) { note.textContent = error.message; note.hidden = false; }
});

["assignment_date", "start_time", "end_time"].forEach(name => byId("assignment-form").elements.namedItem(name).addEventListener("change", refreshAvailableEmployees));
byId("available-employee-list").addEventListener("click", event => { const button = event.target.closest("[data-available-employee]"); if (button && !button.disabled) byId("assignment-employee").value = button.dataset.availableEmployee; });

byId("order-assignment-list").addEventListener("click", async event => {
    const edit = event.target.closest("[data-assignment-edit]");
    const remove = event.target.closest("[data-assignment-delete]");
    if (edit) {
        const assignment = orderAssignments.find(item => String(item.id) === edit.dataset.assignmentEdit);
        if (!assignment) return;
        const form = byId("assignment-form");
        ["employee_id", "assignment_date", "start_time", "end_time", "status", "notes"].forEach(key => { const field = form.elements.namedItem(key); if (field) field.value = key === "assignment_date" ? String(assignment[key]).slice(0, 10) : (assignment[key] ?? ""); });
        form.elements.namedItem("assignment_id").value = assignment.id;
        refreshAvailableEmployees();
        return;
    }
    if (remove && byId("order-id").value) {
        try {
            await api(`/api/admin/orders/${byId("order-id").value}/assignments/${remove.dataset.assignmentDelete}`, { method: "DELETE", body: "{}" });
            const details = await api(`/api/admin/orders/${byId("order-id").value}`); orderAssignments = details.assignments || []; renderAssignments(); await reloadDashboard();
        } catch (error) { setNotice(error.message); }
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
