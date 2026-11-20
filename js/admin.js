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
let selectedQuoteRequest = null;
let scheduleWeek = false;
let quoteItems = [];
let invoiceItems = [];
let financeTab = "payments";
let financePage = 1;
let serviceReportRows = [];
let serviceReportFilteredRows = [];
let serviceReportPage = 1;
const serviceReportPageSize = 25;
let materialTab = "materials";
let materialRows = [];
let requirementOrderId = "";
const weekdayNames = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");

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

const money = value => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value || 0));
function openFinanceDetail(title, values, actions = []) { byId("finance-detail-title").textContent=title; byId("finance-detail-values").innerHTML=values.map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "—")}</dd></div>`).join(""); const area=byId("finance-detail-actions"); area.replaceChildren(); actions.forEach(action=>{const link=document.createElement("a");link.className="button button-primary";link.href=action.href;link.target="_blank";link.rel="noopener noreferrer";link.textContent=action.label;area.append(link);}); byId("finance-detail-dialog").showModal(); }
async function openPaymentDetail(id) { const result=await api(`/api/admin/finance/employee-cash-payments/${id}`),p=result.payment, paymentId=Number(p.id); const actions=Number.isSafeInteger(paymentId)&&paymentId>0&&Number(p.has_receipt)===1?[{label:"Beleg ansehen",href:`/api/admin/finance/employee-cash-payments/${paymentId}/receipt`}]:[]; openFinanceDetail(`Barzahlung ${p.payment_number}`, [["Status",p.status],["Datum",String(p.payment_date||"").slice(0,10)],["Betrag",money(p.amount)],["Zahlungsmethode",p.payment_method],["Mitarbeiter",p.employee_number],["Kunde",`${p.first_name||""} ${p.last_name||""}`],["Auftrag",p.order_number],["Rechnung",p.invoice_number],["Zweck",p.purpose],["E-Mail-Status",p.customer_email_status],["Beleg vorhanden",p.has_receipt?"Ja":"Nein"],["Notiz / Ablehnungsgrund",p.notes],["Erstellt",formatDate(p.created_at)],["Aktualisiert",formatDate(p.updated_at)]],actions); }
async function openTransactionDetail(id) { const result=await api(`/api/admin/finance/transactions/${id}`),t=result.transaction; openFinanceDetail(`Transaktion ${t.transaction_number}`, [["Typ",t.transaction_type],["Betrag",money(t.amount)],["Zahlungsmethode",t.payment_method],["Status",t.status],["Datum",String(t.transaction_date||"").slice(0,10)],["Mitarbeiter",t.employee_number],["Kunde",`${t.first_name||""} ${t.last_name||""}`],["Auftrag",t.order_number],["Rechnung",t.invoice_number],["Beschreibung",t.description],["Referenz",t.reference],["Barzahlung",t.reference?.startsWith("BAR-")?t.reference:"—"],["Kassenübergabe","—"],["Erstellt",formatDate(t.created_at)],["Aktualisiert",formatDate(t.updated_at)]]); }
function financeFilterQuery() {
    const parameters = new URLSearchParams({ page: String(financePage), pageSize: "25" });
    const fields = [["from","finance-from"],["to","finance-to"],["type","finance-type"],["status","finance-status"],["payment_method","finance-method"],["employee_id","finance-employee-id"],["customer_id","finance-customer-id"],["order_id","finance-order-id"],["invoice_id","finance-invoice-id"],["amount_min","finance-amount-min"],["amount_max","finance-amount-max"],["search","finance-search"]];
    fields.forEach(([key,id]) => { const value=byId(id).value.trim(); if(value) parameters.set(key,value); });
    return parameters.toString();
}
function setFinanceFilterOptions() {
    const payment=financeTab==="payments", transfer=financeTab==="transfers";
    const statusOptions = payment ? [["ERFASST","Erfasst"],["GEPRUEFT","Geprüft"],["ABGELEHNT","Abgelehnt"],["STORNIERT","Storniert"]] : transfer ? [["OFFEN","Offen"],["UEBERGEBEN","Übergeben"],["GEPRUEFT","Geprüft"],["ABGELEHNT","Abgelehnt"]] : [["ERFASST","Erfasst"],["GEPRUEFT","Geprüft"],["STORNIERT","Storniert"]];
    const methodOptions = payment ? [["BAR","Bar"],["BANK","Bank"],["KARTE","Karte"],["SONSTIGE","Sonstige"]] : [["CASH","Bar"],["BANK","Bank"],["CARD","Karte"],["OTHER","Sonstige"]];
    byId("finance-status").innerHTML = `<option value="">Alle Status</option>${statusOptions.map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}`;
    byId("finance-method").innerHTML = `<option value="">Alle Methoden</option>${methodOptions.map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}`;
    byId("finance-type-field").hidden = payment || transfer;
    byId("finance-method-field").hidden = transfer;
    ["finance-customer-field","finance-order-field","finance-invoice-field"].forEach(id=>byId(id).hidden=transfer);
}
async function loadFinance() {
    const period = byId("finance-period").value;
    const endpoint = financeTab === "payments" ? "/api/admin/finance/employee-cash-payments" : financeTab === "transfers" ? "/api/admin/finance/cash-transfers" : "/api/admin/finance/transactions";
    const [dashboard, result] = await Promise.all([api(`/api/admin/finance/dashboard?period=${encodeURIComponent(period)}`),api(`${endpoint}?${financeFilterQuery()}`)]);
    if (financePage > result.totalPages) { financePage=result.totalPages; return loadFinance(); }
    const cards = [["Gesamteinnahmen",dashboard.income],["Gesamtausgaben",dashboard.expenses],["Cashflow",dashboard.cashflow],["Barzahlungen",dashboard.cash],["Bankzahlungen",dashboard.bank],["Kartenzahlungen",dashboard.card],["Mitarbeitereinnahmen",dashboard.employee_cash],["Noch nicht übergeben",dashboard.not_transferred],["Offene Rechnungen",dashboard.open_invoices],["Überfällige Rechnungen",dashboard.overdue_invoices]];
    byId("finance-cards").innerHTML = cards.map(([label,value],index)=>`<article class="finance-card${index===2?" is-flow":""}"><span>${escapeHtml(label)}</span><strong>${index>7 ? escapeHtml(value) : money(value)}</strong></article>`).join("");
    const payment=financeTab==="payments", transfer=financeTab==="transfers";
    byId("finance-head").innerHTML = (payment?["Nummer","Datum","Mitarbeiter","Kunde","Auftrag","Betrag","Status","Beleg"]:transfer?["Nummer","Mitarbeiter","Datum","Betrag","Status","Notiz"]:["Nummer","Datum","Typ","Beschreibung","Zahlungsart","Einnahme","Ausgabe","Status"]).map(value=>`<th>${value}</th>`).join("");
    const list=result.items||[];
    byId("finance-body").innerHTML = list.map(row=> payment ? `<tr><td>${escapeHtml(row.payment_number)}</td><td>${escapeHtml(String(row.payment_date||"").slice(0,10))}</td><td>${escapeHtml(row.employee_number||"")}</td><td>${escapeHtml(`${row.first_name||""} ${row.last_name||""}`)}</td><td>${escapeHtml(row.order_number||"")}</td><td>${money(row.amount)}</td><td>${escapeHtml(row.status)}</td><td><button class="detail-button" data-payment-detail="${Number(row.id)}">Details</button> ${row.has_receipt?"Vorhanden":"—"} ${row.status==="ERFASST"?`<button class="detail-button" data-finance-status="GEPRUEFT" data-payment-id="${Number(row.id)}">Genehmigen</button><button class="detail-button" data-finance-status="ABGELEHNT" data-payment-id="${Number(row.id)}">Ablehnen</button>`:""}</td></tr>` : transfer ? `<tr><td>${escapeHtml(row.transfer_number)}</td><td>${escapeHtml(`${row.first_name||""} ${row.last_name||""}`)}</td><td>${escapeHtml(String(row.transfer_date||"").slice(0,10))}</td><td>${money(row.amount)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.notes||"")}</td></tr>` : `<tr><td>${escapeHtml(row.transaction_number)}</td><td>${escapeHtml(String(row.transaction_date||"").slice(0,10))}</td><td>${escapeHtml(row.transaction_type)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.payment_method)}</td><td>${row.transaction_type==="INCOME"?money(row.amount):"—"}</td><td>${row.transaction_type==="EXPENSE"?money(row.amount):"—"}</td><td><button class="detail-button" data-transaction-detail="${Number(row.id)}">Details</button> ${escapeHtml(row.status)}</td></tr>`).join("") || '<tr><td colspan="8">Keine Finanzdaten vorhanden.</td></tr>';
    byId("finance-page-info").textContent=`Seite ${result.page} von ${result.totalPages} · ${result.total} Einträge`;
    byId("finance-previous").disabled=result.page<=1;
    byId("finance-next").disabled=result.page>=result.totalPages;
}

function serviceReportFilters() {
    return {
        date: byId("service-report-date").value,
        status: byId("service-report-status").value,
        customerId: byId("service-report-customer").value.trim(),
        employeeId: byId("service-report-employee").value.trim(),
        orderId: byId("service-report-order").value.trim(),
        search: byId("service-report-search").value.trim().toLocaleLowerCase("de-DE")
    };
}

function renderServiceReports() {
    const filters = serviceReportFilters();
    serviceReportFilteredRows = serviceReportRows.filter(report => {
        const searchable = [report.report_number, report.customer_number, report.customer_first_name, report.customer_last_name, report.employee_number, report.employee_first_name, report.employee_last_name, report.order_number, report.order_title].join(" ").toLocaleLowerCase("de-DE");
        return (!filters.date || String(report.service_date || "").slice(0, 10) === filters.date) && (!filters.search || searchable.includes(filters.search));
    });
    const totalPages = Math.max(1, Math.ceil(serviceReportFilteredRows.length / serviceReportPageSize));
    if (serviceReportPage > totalPages) serviceReportPage = totalPages;
    const first = (serviceReportPage - 1) * serviceReportPageSize;
    const rows = serviceReportFilteredRows.slice(first, first + serviceReportPageSize);
    byId("service-reports-body").innerHTML = rows.map(report => `<tr><td>${escapeHtml(report.report_number)}</td><td>${escapeHtml(String(report.service_date || "").slice(0, 10))}</td><td><strong>${escapeHtml(`${report.customer_first_name || ""} ${report.customer_last_name || ""}`.trim())}</strong><div class="person-phone">${escapeHtml(report.customer_number || "")}</div></td><td><strong>${escapeHtml(`${report.employee_first_name || ""} ${report.employee_last_name || ""}`.trim())}</strong><div class="person-phone">${escapeHtml(report.employee_number || "")}</div></td><td>${escapeHtml(report.order_number || "—")}</td><td><span class="status-pill" data-status="${escapeHtml(report.status === "CUSTOMER_CONFIRMED" ? "done" : report.status === "RETURNED" ? "in_progress" : "new")}">${escapeHtml(report.status)}</span></td><td>${escapeHtml(formatDate(report.submitted_at))}</td><td>${escapeHtml(formatDate(report.shared_with_customer_at))}</td><td>${escapeHtml(formatDate(report.customer_confirmed_at))}</td><td><button class="detail-button" type="button" data-service-report-detail="${Number(report.id)}">Details</button></td></tr>`).join("");
    byId("service-reports-empty").hidden = rows.length !== 0;
    byId("service-reports-page-info").textContent = serviceReportFilteredRows.length ? `Einträge ${first + 1}–${Math.min(first + serviceReportPageSize, serviceReportFilteredRows.length)} von ${serviceReportFilteredRows.length}` : "Keine Einträge";
    byId("service-reports-page-number").textContent = String(serviceReportPage);
    byId("service-reports-previous").disabled = serviceReportPage <= 1;
    byId("service-reports-next").disabled = serviceReportPage >= totalPages;
}

async function loadServiceReports() {
    const filters = serviceReportFilters();
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.customerId) query.set("customer_id", filters.customerId);
    if (filters.employeeId) query.set("employee_id", filters.employeeId);
    if (filters.orderId) query.set("order_id", filters.orderId);
    try {
        const result = await api(`/api/admin/service-reports${query.size ? `?${query}` : ""}`);
        serviceReportRows = result.rows || [];
        byId("nav-service-report-count").textContent = String(serviceReportRows.length);
        renderServiceReports();
    } catch (error) {
        byId("service-reports-message").textContent = error.message;
        byId("service-reports-message").hidden = false;
        byId("service-reports-body").replaceChildren();
        byId("service-reports-empty").hidden = false;
    }
}

function serviceReportDateTime(value) { return value ? String(value).replace(" ", "T").slice(0, 16) : ""; }

function serviceReportDetailValues(report) {
    return [["Status", report.status], ["Auftrag", `${report.order_number || "—"} · ${report.order_title || ""}`], ["Kunde", `${report.customer_first_name || ""} ${report.customer_last_name || ""} · ${report.customer_number || ""}`.trim()], ["Mitarbeiter", `${report.employee_first_name || ""} ${report.employee_last_name || ""} · ${report.employee_number || ""}`.trim()], ["Einsatz", `#${report.assignment_id}`], ["Leistungsdatum", String(report.service_date || "").slice(0, 10)], ["Beginn", formatDate(report.started_at)], ["Ende", formatDate(report.finished_at)], ["Eingereicht", formatDate(report.submitted_at)], ["Geprüft", formatDate(report.reviewed_at)], ["Freigegeben", formatDate(report.shared_with_customer_at)], ["Kundenbestätigung", formatDate(report.customer_confirmed_at)], ["Erstellt", formatDate(report.created_at)], ["Aktualisiert", formatDate(report.updated_at)]];
}

async function openServiceReportDetail(id) {
    const result = await api(`/api/admin/service-reports/${id}`);
    const report = result.report;
    byId("service-report-detail-title").textContent = report.report_number;
    byId("service-report-detail-values").innerHTML = serviceReportDetailValues(report).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "—")}</dd></div>`).join("");
    byId("service-report-summary").textContent = report.summary || "—";
    byId("service-report-customer-notes").textContent = report.customer_notes || "—";
    byId("service-report-internal-notes").textContent = report.internal_notes || "—";
    const related = byId("service-report-related-values");
    related.innerHTML = `<div><strong>Auftrag</strong>${escapeHtml(report.order_number || "—")}</div><div><strong>Einsatz</strong>#${escapeHtml(report.assignment_id)}</div><div><strong>Arbeitsprotokolle</strong>Über den Auftrag einsehbar</div><div><strong>Dokumente</strong>Private Dokumente bleiben geschützt</div>`;
    const actions = byId("service-report-detail-actions");
    actions.replaceChildren();
    const addAction = (label, handler, primary = false) => { const button = document.createElement("button"); button.className = `button ${primary ? "button-primary" : "button-light"}`; button.type = "button"; button.textContent = label; button.addEventListener("click", handler); actions.append(button); };
    addAction("Auftrag öffnen", () => { byId("service-report-detail-dialog").close(); openOrderDialog({ id: report.order_id, order_number: report.order_number }).catch(error => setNotice(error.message)); });
    if (["DRAFT", "RETURNED"].includes(report.status)) {
        addAction("Bearbeiten", () => openServiceReportEdit(report));
        if (report.status === "DRAFT") addAction("Einreichen", () => submitServiceReport(report.id), true);
    }
    if (report.status === "SUBMITTED") {
        addAction("Prüfung freigeben", () => reviewServiceReport(report.id), true);
        addAction("Zurückgeben", () => openServiceReportReturn(report.id));
    }
    if (report.status === "REVIEWED") addAction("Für Kunden freigeben", () => shareServiceReport(report.id), true);
    byId("service-report-detail-dialog").showModal();
}

function openServiceReportEdit(report) {
    const form = byId("service-report-edit-form");
    form.reset();
    form.elements.id.value = report.id;
    form.elements.order_id.value = report.order_id;
    form.elements.assignment_id.value = report.assignment_id;
    form.elements.service_date.value = String(report.service_date || "").slice(0, 10);
    form.elements.started_at.value = serviceReportDateTime(report.started_at);
    form.elements.finished_at.value = serviceReportDateTime(report.finished_at);
    form.elements.summary.value = report.summary || "";
    form.elements.customer_notes.value = report.customer_notes || "";
    form.elements.internal_notes.value = report.internal_notes || "";
    byId("service-report-edit-relation").textContent = `${report.order_number || "Auftrag"} · Einsatz #${report.assignment_id}`;
    byId("service-report-edit-note").hidden = true;
    byId("service-report-detail-dialog").close();
    byId("service-report-edit-dialog").showModal();
}

async function refreshServiceReportAfterAction(id, message) {
    await loadServiceReports();
    if (message) setNotice(message, "success");
    if (id) await openServiceReportDetail(id);
}

async function submitServiceReport(id) { try { const result = await api(`/api/admin/service-reports/${id}`, { method: "PATCH", body: JSON.stringify({ status: "SUBMITTED" }) }); await refreshServiceReportAfterAction(id, result.message); } catch (error) { setNotice(error.message); } }
async function reviewServiceReport(id) { try { const result = await api(`/api/admin/service-reports/${id}/review`, { method: "PATCH", body: JSON.stringify({ status: "REVIEWED" }) }); await refreshServiceReportAfterAction(id, result.message); } catch (error) { setNotice(error.message); } }
async function shareServiceReport(id) { try { const result = await api(`/api/admin/service-reports/${id}/share`, { method: "PATCH", body: "{}" }); await refreshServiceReportAfterAction(id, result.message); } catch (error) { setNotice(error.message); } }
function openServiceReportReturn(id) { byId("service-report-return-id").value = id; byId("service-report-return-reason").value = ""; byId("service-report-return-note").hidden = true; byId("service-report-return-dialog").showModal(); }
const reportingCache = new Map();
const reportEuro = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(Number(value)) : "—";
const reportNumber = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat("de-DE").format(Number(value)) : "—";
function reportParams(){const period=byId("reporting-period").value,from=byId("reporting-from").value,to=byId("reporting-to").value,compare=byId("reporting-compare").checked;if(period==="custom"&&(!from||!to||from>to))throw new Error("Der Zeitraum ist ungültig. Das Startdatum darf nicht nach dem Enddatum liegen.");return {period,from,to,compare};}
async function loadReport(endpoint,params,{force=false}={}){const query=new URLSearchParams({period:params.period,compare:String(params.compare)});if(params.period==="custom"){query.set("from",params.from);query.set("to",params.to);}const separator=endpoint.includes("?")?"&":"?",key=`${endpoint}${separator}${query}`;if(!force&&reportingCache.has(key))return reportingCache.get(key);const result=await api(key);if(result.success!==true)throw new Error("Der Bericht konnte nicht geladen werden.");reportingCache.set(key,result);return result;}
function reportingMessage(message,kind="error"){const node=byId("reporting-message");node.textContent=message;node.className=`dashboard-message${kind==="success"?" is-success":""}`;node.hidden=!message;}
function reportingPeriodLabel(params){const format=value=>new Intl.DateTimeFormat("de-DE").format(new Date(`${value}T12:00:00`));return `Zeitraum: ${format(params.from)} – ${format(params.to)}${params.compare?" · Vergleich aktiv":""}`;}
function exportFilename(response){const match=/filename="?([^";]+)"?/i.exec(response.headers.get("Content-Disposition")||"");return match?match[1]:"zoicas-osinski-report.csv";}
async function downloadReportingCsv(){let params;try{params=reportParams()}catch(error){return reportingMessage(error.message)}const button=byId("reporting-export-csv"),type=byId("reporting-export-type").value,original=button.textContent;button.disabled=true;button.textContent="CSV wird erstellt…";reportingMessage("CSV wird erstellt …","success");try{const query=new URLSearchParams({type,format:"csv",period:params.period,compare:String(params.compare)});if(params.period==="custom"){query.set("from",params.from);query.set("to",params.to);}const response=await fetch(`/api/admin/reports/export?${query}`,{credentials:"same-origin",cache:"no-store"});if(response.status===401){showLogin("Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");return;}if(!response.ok)throw new Error("Export konnte nicht erstellt werden.");const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=exportFilename(response);link.hidden=true;document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);reportingMessage("Download gestartet.","success");}catch(error){reportingMessage(error.message||"Export konnte nicht erstellt werden.");}finally{button.disabled=false;button.textContent=original;}}
async function downloadReportingPdf(){let params;try{params=reportParams()}catch(error){return reportingMessage(error.message)}const button=byId("reporting-export-pdf"),original=button.textContent;button.disabled=true;button.textContent="PDF wird erstellt…";try{const query=new URLSearchParams({period:params.period,compare:String(params.compare)});if(params.period==="custom"){query.set("from",params.from);query.set("to",params.to);}const response=await fetch(`/api/admin/reports/pdf?${query}`,{credentials:"same-origin",cache:"no-store"});if(response.status===401){showLogin("Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");return;}if(!response.ok)throw new Error("PDF konnte nicht erstellt werden.");const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=exportFilename(response).replace(/\.csv$/i,".pdf");document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);reportingMessage("PDF-Download gestartet.","success");}catch(error){reportingMessage(error.message||"PDF konnte nicht erstellt werden.");}finally{button.disabled=false;button.textContent=original;}}
function svgLine(title,rows,keys,labels=keys){if(!rows.length)return `<p class="reporting-chart-empty">Keine Daten für den ausgewählten Zeitraum vorhanden.</p>`;const values=rows.flatMap(r=>keys.map(k=>Number(r[k]||0))),max=Math.max(1,...values),width=360,height=170,left=42,right=14,top=26,bottom=34,plotWidth=width-left-right,plotHeight=height-top-bottom,point=(row,index,key)=>({x:left+index*(plotWidth/Math.max(1,rows.length-1)),y:top+plotHeight-(Number(row[key]||0)/max)*plotHeight}),points=key=>rows.map((row,index)=>{const p=point(row,index,key);return `${p.x},${p.y}`;}).join(" "),legend=keys.map((key,index)=>`<span><i class="reporting-legend-dot reporting-legend-${index}" aria-hidden="true"></i>${escapeHtml(labels[index]||key)}</span>`).join("");return `<div class="reporting-chart"><div class="reporting-legend" aria-label="Legende">${legend}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-${keys.join("-")}-title chart-${keys.join("-")}-desc"><title id="chart-${keys.join("-")}-title">${escapeHtml(title)}</title><desc id="chart-${keys.join("-")}-desc">${escapeHtml(title)}. Datenwerte können per Tastatur oder Maus abgerufen werden.</desc><line x1="${left}" y1="${top+plotHeight}" x2="${width-right}" y2="${top+plotHeight}" stroke="#b9cad8"/>${keys.map((key,index)=>`<polyline fill="none" stroke="${index?"#176d9d":"#78a915"}" stroke-width="3" points="${points(key)}"/>${rows.map((row,rowIndex)=>{const p=point(row,rowIndex,key),value=Number(row[key]||0);return `<circle class="reporting-chart-point" cx="${p.x}" cy="${p.y}" r="4" fill="${index?"#176d9d":"#78a915"}" tabindex="0"><title>${escapeHtml(`${labels[index]||key}: ${reportEuro(value)} · ${row.label||row.date}`)}</title></circle>`;}).join("")}`).join("")}<text x="${left}" y="${height-12}" fill="#668198" font-size="10">${escapeHtml(rows[0].label||rows[0].date)}</text><text x="${width-right}" y="${height-12}" text-anchor="end" fill="#668198" font-size="10">${escapeHtml(rows.at(-1).label||rows.at(-1).date)}</text><text x="${left}" y="16" fill="#668198" font-size="10">${escapeHtml(reportEuro(max))}</text></svg></div>`;}
function rankList(title,rows,formatter){return `<article class="reporting-section"><h3>${escapeHtml(title)}</h3>${rows.length?`<ol class="reporting-rank-list">${rows.map(row=>`<li><strong>${escapeHtml(row.label||"—")}</strong><span>${escapeHtml(formatter(row))}</span></li>`).join("")}</ol>`:"<p>Keine Daten für den ausgewählten Zeitraum vorhanden.</p>"}</article>`;}
async function loadVisuals(){let params;try{params=reportParams()}catch(error){return reportingMessage(error.message)}const visual=byId("reporting-visuals");visual.setAttribute("aria-busy","true");visual.innerHTML="<p class=\"reporting-chart-loading\">Diagramme werden geladen …</p>";try{const metrics=["revenue","cashflow","invoices","orders"],types=["customers","employees","materials"],results=await Promise.all([...metrics.map(metric=>loadReport(`/api/admin/reports/trends?metric=${metric}`,params)),...types.map(type=>loadReport(`/api/admin/reports/rankings?type=${type}&limit=10`,params))]);const [revenue,cashflow,invoices,orders,customers,employees,materials]=results.map(r=>r.data);visual.innerHTML=`<section class="reporting-chart-grid"><article class="reporting-section"><h3>Umsatzentwicklung</h3>${svgLine("Umsatz Netto und Brutto",revenue.series||[],["net","gross"],["Netto","Brutto"])}</article><article class="reporting-section"><h3>Einnahmen / Ausgaben</h3>${svgLine("Einnahmen und Ausgaben",cashflow.series||[],["income","expense"],["Einnahmen","Ausgaben"])}</article><article class="reporting-section"><h3>Rechnungsentwicklung</h3>${svgLine("Rechnungen",invoices.series||[],["issued","paid"],["Ausgestellt","Bezahlt"])}</article><article class="reporting-section"><h3>Auftragsentwicklung</h3>${svgLine("Neu angelegte Aufträge",orders.series||[],["new_orders"],["Neue Aufträge"])}</article></section><section class="reporting-summary">${rankList("Top Kunden",customers.items||[],r=>`${reportEuro(r.revenue_gross)} · ${reportNumber(r.order_count)} Aufträge`)}${rankList("Mitarbeiter",employees.items||[],r=>`${reportNumber(r.work_hours)} Std. · ${reportNumber(r.assignments)} Einsätze`)}${rankList("Materialverbrauch",materials.items||[],r=>`${reportNumber(r.consumed_quantity)} · ${reportEuro(r.consumption_cost)}`)}</section>`;}catch(error){visual.innerHTML="<p class=\"reporting-chart-error\">Diagramme konnten nicht geladen werden. Bitte aktualisieren Sie den Bericht.</p>";reportingMessage(error.message||"Der Bericht konnte nicht geladen werden.");}finally{visual.removeAttribute("aria-busy");}}
function renderReportCards(data,compare){const current=compare?data.current:data,comparison=compare?data.comparison:null,f=current.finance||{},o=current.orders||{},c=current.customers||{},e=current.employees||{},m=current.materials||{};const cards=[["Umsatz Netto",f.invoiced?.net,"money"],["Umsatz Brutto",f.invoiced?.gross,"money"],["MwSt.",f.invoiced?.tax,"money"],["Einnahmen",f.financial_income,"money"],["Ausgaben",f.expenses,"money"],["Teilergebnis – unvollständig",f.partial_result_incomplete,"money"],["Offene Forderungen",f.outstanding_amount,"money"],["Überfällige Rechnungen",f.overdue_amount,"money"],["Gesamtaufträge",o.total,"number"],["Aktive Kunden",c.active_customers,"number"],["Aktive Mitarbeiter",e.active_employees,"number"],["Materialverbrauchskosten",m.consumption_costs,"money"]];byId("reporting-cards").innerHTML=cards.map(([label,value,type])=>{const key=label==="Umsatz Netto"?"invoiced.net":label==="Umsatz Brutto"?"invoiced.gross":label==="MwSt."?"invoiced.tax":label==="Einnahmen"?"financial_income":label==="Ausgaben"?"expenses":label==="Teilergebnis – unvollständig"?"partial_result_incomplete":label==="Offene Forderungen"?"outstanding_amount":label==="Gesamtaufträge"?"total":label==="Aktive Kunden"?"active_customers":label==="Aktive Mitarbeiter"?"active_employees":"consumption_costs";const delta=compare?(key.includes(".")?comparison?.finance?.[key.split(".")[1]]:comparison?.finance?.[key]||comparison?.orders?.[key]||comparison?.customers?.[key]||comparison?.employees?.[key]||comparison?.materials?.[key]):null;return `<article class="finance-card"><span>${escapeHtml(label)}</span><strong>${type==="money"?reportEuro(value):reportNumber(value)}</strong>${delta?`<small>Vorheriger Zeitraum: ${type==="money"?reportEuro(delta.previous):reportNumber(delta.previous)} · Δ ${type==="money"?reportEuro(delta.difference):reportNumber(delta.difference)}${delta.percent===null?"":" · "+escapeHtml(String(delta.percent))+"%"}</small>`:""}</article>`;}).join("");}
async function loadPerformance(){const params=reportParams(),paths=["operations","services","receivables","recurring"],results=await Promise.all(paths.map(name=>loadReport(`/api/admin/reports/performance/${name}`,params)));const [operations,services,receivables,recurring]=results.map(result=>result.data);byId("performance-cards").innerHTML=[["Completion Rate",`${Number(operations.completion_rate||0).toFixed(1)}%`],["Cancellation Rate",`${Number(operations.cancellation_rate||0).toFixed(1)}%`],["Planned Hours",`${Number(operations.planned_hours||0).toFixed(1)} h`],["Actual Hours",`${Number(operations.actual_hours||0).toFixed(1)} h`],["Report Completion",`${Number(operations.service_report_completion_rate||0).toFixed(1)}%`],["Contribution vor Personalkosten",reportEuro((services.items||[]).reduce((sum,row)=>sum+Number(row.contribution_before_personnel_costs||0),0))],["Überfällige Forderungen",reportEuro(receivables.overdue_invoice_amount)]].map(([label,value])=>`<article class="finance-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");byId("performance-content").innerHTML=`<article class="reporting-section"><h3>Service Performance</h3>${(services.items||[]).length?`<ol class="reporting-rank-list">${services.items.map(row=>`<li><strong>${escapeHtml(row.service_type||"—")}</strong><span>${escapeHtml(reportEuro(row.revenue))} · ${escapeHtml(reportEuro(row.contribution_before_personnel_costs))}</span></li>`).join("")}</ol>`:"<p>Keine Daten für den ausgewählten Zeitraum.</p>"}</article><article class="reporting-section"><h3>Forderungsalterung</h3><p>Aktuell: ${escapeHtml(reportEuro(receivables.buckets?.current))}<br>1–30: ${escapeHtml(reportEuro(receivables.buckets?.days_1_30))}<br>31–60: ${escapeHtml(reportEuro(receivables.buckets?.days_31_60))}<br>61–90: ${escapeHtml(reportEuro(receivables.buckets?.days_61_90))}<br>90+: ${escapeHtml(reportEuro(receivables.buckets?.days_90_plus))}</p></article><article class="reporting-section"><h3>Wiederkehrende Aufträge</h3><p>Aktive Verträge: ${escapeHtml(reportNumber(recurring.recurring_contracts))}<br>Generierungen: ${escapeHtml(reportNumber(recurring.generated_orders))}<br>Erfolgreich: ${escapeHtml(reportNumber(recurring.successful_generation))}<br>Duplikate: ${escapeHtml(reportNumber(recurring.duplicate_outcomes))}<br>Fehler: ${escapeHtml(reportNumber(recurring.error_outcomes))}</p></article>`;}
async function loadReporting({force=false}={}){const params=reportParams();byId("reporting-period-label").textContent="Zeitraum wird geladen …";reportingMessage("Bericht wird geladen …","success");try{const result=await loadReport("/api/admin/reports/dashboard",params,{force});byId("reporting-period-label").textContent=reportingPeriodLabel({from:result.meta.from,to:result.meta.to,compare:params.compare});renderReportCards(result.data,params.compare);const current=params.compare?result.data.current:result.data,sections=[["Revenue","revenue"],["Invoices","invoices"],["Orders","orders"],["Customers","customers"],["Employees","employees"],["Materials","materials"]];byId("reporting-summary").innerHTML=sections.map(([label,name])=>`<article class="reporting-section"><h3>${label}</h3><p>Zusammenfassung für den gewählten Zeitraum.</p><button class="detail-button" data-report-detail="${name}" type="button">Details anzeigen</button><div id="report-detail-${name}"></div></article>`).join("");reportingMessage("");}catch(error){reportingMessage(error.status===401?"Sitzung abgelaufen. Bitte melden Sie sich erneut an.":error.message||"Der Bericht konnte nicht geladen werden.");}}

function updateViewHeading() {
    const career = currentType === "career", finance = currentType === "finance", reporting = currentType === "reporting", actionCenter = currentType === "action-center", serviceReport = currentType === "service-report", materials = currentType === "materials", quality = currentType === "quality";
    const quote = currentType === "quote", offer = currentType === "offer", contract = currentType === "contract", recurring = currentType === "recurring", invoice = currentType === "invoice", appointment = currentType === "appointment", customer = currentType === "customer", employee = currentType === "employee", order = currentType === "order", schedule = currentType === "schedule", document = currentType === "document", message = currentType === "message", notification = currentType === "notification", audit = currentType === "audit";
    byId("page-title").textContent = actionCenter ? "Aktionscenter" : quality ? "Qualität & Vorfälle" : materials ? "Materialverwaltung" : serviceReport ? "Leistungsnachweise" : finance ? "Finanzen" : schedule ? "Einsatzplanung" : recurring ? "Wiederkehrende Aufträge" : invoice ? "Rechnungen" : contract ? "Verträge" : offer ? "Angebote" : order ? "Aufträge" : employee ? "Mitarbeiter" : customer ? "Kunden" : appointment ? "Termine" : quote ? "Angebotsanfragen" : career ? "Bewerbungen" : "Kontaktanfragen";
    byId("records-title").textContent = recurring ? "Automatisierte Einsatzpläne & Protokolle" : invoice ? "Rechnungsverwaltung" : contract ? "Vertragsverwaltung" : offer ? "Angebotsverwaltung" : order ? "Auftragsverwaltung" : employee ? "Mitarbeiterverwaltung" : customer ? "Registrierte Kunden" : appointment ? "Gebuchte Termine" : quote ? "Aktuelle Angebotsanfragen" : career ? "Aktuelle Bewerbungen" : "Aktuelle Kontaktanfragen";
    byId("service-heading").textContent = recurring ? "INTERVALL / NÄCHSTER LAUF" : invoice || contract || offer || order ? "LEISTUNG / BETRAG" : employee ? "POSITION / ROLLE" : appointment || quote ? "DIENSTLEISTUNG / ORT" : career ? "BEREICH" : "LEISTUNG";
    byId("create-employee-button").hidden = !employee;
    byId("create-order-button").hidden = !order;
    byId("create-offer-button").hidden = !offer;
    byId("create-contract-button").hidden = !contract;
    byId("create-recurring-button").hidden = !recurring;
    byId("generate-recurring-button").hidden = !recurring;
    byId("create-invoice-button").hidden = !invoice;
    byId("create-document-button").hidden = !document;
    byId("create-message-button").hidden = !message;
    byId("create-material-button").hidden = !materials;
    if (document) { byId("page-title").textContent = "Dokumente"; byId("records-title").textContent = "Private Dokumente"; byId("service-heading").textContent = "TYP / SICHTBARKEIT"; }
    if (message) { byId("page-title").textContent = "Nachrichten"; byId("records-title").textContent = "Kundennachrichten"; byId("service-heading").textContent = "ABSENDER / EMPFÄNGER"; }
    if (notification) { byId("page-title").textContent = "Benachrichtigungen"; byId("records-title").textContent = "Interne Benachrichtigungen"; byId("service-heading").textContent = "TYP / VERKNÜPFUNG"; }
    if (audit) { byId("page-title").textContent = "Audit-Protokoll"; byId("records-title").textContent = "Nachvollziehbare Systemereignisse"; byId("service-heading").textContent = "AKTION / OBJEKT"; }
    if (reporting) { byId("page-title").textContent = "Reporting & Kennzahlen"; }
    ["invoice-customer-filter", "invoice-order-filter", "invoice-due-filter"].forEach(id => { byId(id).hidden = !invoice; });
    byId("schedule-panel").hidden = !schedule;
    byId("finance-panel").hidden = !finance;
    byId("reporting-panel").hidden = !reporting;
    byId("action-center-panel").hidden = !actionCenter;
    byId("service-reports-panel").hidden = !serviceReport;
    byId("materials-panel").hidden = !materials;
    byId("quality-panel").hidden = !quality;
    document.querySelector(".stats-grid").hidden = reporting || actionCenter || quality;
    document.querySelector(".records-panel").hidden = schedule || finance || reporting || actionCenter || serviceReport || materials || quality;
    document.querySelector(".privacy-note").hidden = schedule || finance || reporting || actionCenter || serviceReport || materials || quality;
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("is-active", button.dataset.type === currentType));
    const quoteOnlyStatuses = new Set(["offer_sent", "accepted", "declined", "completed"]);
    const commercialStatuses = new Set(["all", "ENTWURF", "GESENDET", "ANGENOMMEN", "ABGELEHNT", "ABGELAUFEN", "STORNIERT"]);
    const contractStatuses = new Set(["all", "ENTWURF", "AKTIV", "PAUSIERT", "GEKUENDIGT", "ABGELAUFEN", "BEENDET"]), invoiceStatuses = new Set(["all", "ENTWURF", "AUSGESTELLT", "GESENDET", "BEZAHLT", "TEILBEZAHLT", "ÜBERFÄLLIG", "STORNIERT"]);
    const employeeStatuses = new Set(["all", "ACTIVE", "INACTIVE"]);
    const orderStatuses = new Set(["all", "NEU", "GEPLANT", "ZUGEWIESEN", "IN_BEARBEITUNG", "PAUSIERT", "ERLEDIGT", "STORNIERT"]);
    byId("status-filter").querySelectorAll("option").forEach(option => {
        option.hidden = recurring ? option.value !== "all" : invoice ? !invoiceStatuses.has(option.value) : offer ? !commercialStatuses.has(option.value) : contract ? !contractStatuses.has(option.value) : order ? !orderStatuses.has(option.value) : employee
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
        const result = await api("/api/admin/quote-requests?status=new&page=1");
        byId("nav-quote-count").textContent = result.total;
    } catch {
        // The quote migration may not be installed yet; the existing dashboard remains usable.
        byId("nav-quote-count").textContent = "—";
    }
}

async function loadCommercialNavCounts() {
    try { byId("nav-offer-count").textContent = (await api("/api/admin/quotes?status=ENTWURF")).total; } catch { byId("nav-offer-count").textContent = "—"; }
    try { byId("nav-contract-count").textContent = (await api("/api/admin/contracts?status=AKTIV")).total; } catch { byId("nav-contract-count").textContent = "—"; }
}
async function loadInvoiceNavCount() { try { byId("nav-invoice-count").textContent = (await api("/api/admin/invoices?status=ÜBERFÄLLIG")).total; } catch { byId("nav-invoice-count").textContent = "—"; } }
async function loadRecurringNavCount() { try { byId("nav-recurring-count").textContent = (await api("/api/admin/recurring-orders")).rows.filter(row => Number(row.active) === 1).length; } catch { byId("nav-recurring-count").textContent = "—"; } }

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
    if (["document", "message", "notification", "audit"].includes(currentType)) {
        const cell = value => escapeHtml(value || "—");
        recordsBody.innerHTML = rows.map((row, index) => {
            if (currentType === "document") return `<tr><td class="date-cell">${cell(formatDate(row.created_at))}</td><td class="person-cell"><strong>${cell(row.file_name)}</strong><span class="person-phone">${cell(row.first_name ? `${row.first_name} ${row.last_name}` : "Ohne Kundenzuordnung")}</span></td><td class="service-cell">${cell(row.document_type)}<div class="person-phone">${cell(row.visibility)}</div></td><td class="message-cell"><span class="message-preview">${cell(row.mime_type)} · ${cell(row.file_size)} B</span></td><td class="status-cell"><span class="status-pill" data-status="done">GESPEICHERT</span></td><td><a class="detail-button" href="/api/admin/documents/${row.id}">Download</a></td></tr>`;
            if (currentType === "message") return `<tr><td class="date-cell">${cell(formatDate(row.created_at))}</td><td class="person-cell"><strong>${cell(`${row.first_name} ${row.last_name}`)}</strong><span class="person-phone">${cell(row.customer_number)}</span></td><td class="service-cell">${cell(row.sender_type)} → ${cell(row.recipient_type)}</td><td class="message-cell"><strong>${cell(row.subject)}</strong><div class="person-phone">${cell(row.message)}</div></td><td class="status-cell"><span class="status-pill" data-status="${row.read_at ? "done" : "new"}">${row.read_at ? "GELESEN" : "NEU"}</span></td><td>${row.read_at ? "" : `<button class="detail-button" type="button" data-message-read="${row.id}">Lesen</button>`}</td></tr>`;
            if (currentType === "notification") return `<tr><td class="date-cell">${cell(formatDate(row.created_at))}</td><td class="person-cell"><strong>${cell(row.title)}</strong><span class="person-phone">${cell(row.notification_type)}</span></td><td class="service-cell">${cell(row.entity_type)} #${cell(row.entity_id)}</td><td class="message-cell"><span class="message-preview">${cell(row.body)}</span></td><td class="status-cell"><span class="status-pill" data-status="${row.read_at ? "done" : "new"}">${row.read_at ? "GELESEN" : "NEU"}</span></td><td>${row.read_at ? "" : `<button class="detail-button" type="button" data-notification-read="${row.id}">Lesen</button>`}</td></tr>`;
            return `<tr><td class="date-cell">${cell(formatDate(row.created_at))}</td><td class="person-cell"><strong>${cell(row.actor_type)}</strong><span class="person-phone">${cell(row.actor_id)}</span></td><td class="service-cell">${cell(row.action)}<div class="person-phone">${cell(row.entity_type)} #${cell(row.entity_id)}</div></td><td class="message-cell"><span class="message-preview">${cell(row.metadata)}</span></td><td class="status-cell"><span class="status-pill" data-status="done">PROTOKOLLIERT</span></td><td></td></tr>`;
        }).join("");
        const empty = rows.length === 0; byId("empty-state").hidden = !empty; document.querySelector(".table-wrap table").hidden = empty; return;
    }
    if (currentType === "recurring") {
        recordsBody.innerHTML = rows.map((row, index) => `<tr><td class="date-cell">${escapeHtml(row.contract_number)}</td><td class="person-cell"><strong>${escapeHtml(`${row.first_name} ${row.last_name}`)}</strong><span class="person-phone">${escapeHtml(row.customer_number || "—")}</span></td><td class="service-cell"><strong>${escapeHtml(row.service_type)}</strong><div class="person-phone">${escapeHtml(row.recurrence_type)} · ${escapeHtml(row.weekdays || "monatlich/einmalig")}</div></td><td class="message-cell"><span class="message-preview">${escapeHtml(row.next_run_date || "—")}</span><div class="person-phone">${escapeHtml(row.employee_first_name ? `${row.employee_first_name} ${row.employee_last_name}` : "Mitarbeiter wird vorgeschlagen")} · Log: ${escapeHtml(row.last_result || "—")}</div></td><td class="status-cell"><span class="status-pill" data-status="${Number(row.active) ? "done" : "new"}">${Number(row.active) ? "AKTIV" : "INAKTIV"}</span></td><td><button class="detail-button" type="button" data-record-index="${index}">Öffnen</button></td></tr>`).join("");
        const empty = rows.length === 0; byId("empty-state").hidden = !empty; document.querySelector(".table-wrap table").hidden = empty; return;
    }
    if (currentType === "invoice") {
        recordsBody.innerHTML = rows.map((row, index) => `<tr><td class="date-cell">${escapeHtml(row.invoice_number)}</td><td class="person-cell"><strong>${escapeHtml(row.customer_name_snapshot || `${row.first_name} ${row.last_name}`)}</strong><span class="person-phone">${escapeHtml(row.customer_number || "—")}</span></td><td class="service-cell"><strong>${escapeHtml(row.order_number || "Ohne Auftrag")}</strong><div class="person-phone">Fällig: ${escapeHtml(row.due_date)}</div></td><td class="message-cell"><span class="message-preview">${escapeHtml(euro(row.gross_amount))}</span><div class="person-phone">Offen: ${escapeHtml(euro(row.outstanding_amount))}</div></td><td class="status-cell"><span class="status-pill" data-status="${row.status === "BEZAHLT" ? "done" : "new"}">${escapeHtml(row.status)}</span></td><td><button class="detail-button" type="button" data-record-index="${index}">Öffnen</button></td></tr>`).join("");
        const empty = rows.length === 0; byId("empty-state").hidden = !empty; document.querySelector(".table-wrap table").hidden = empty; return;
    }
    if (currentType === "offer" || currentType === "contract") {
        const offer = currentType === "offer";
        recordsBody.innerHTML = rows.map((row, index) => `
            <tr><td class="date-cell">${escapeHtml(offer ? row.quote_number : row.contract_number)}</td>
            <td class="person-cell"><strong>${escapeHtml(`${row.first_name} ${row.last_name}`)}</strong><span class="person-phone">${escapeHtml(row.customer_number || "—")}</span></td>
            <td class="service-cell"><strong>${escapeHtml(row.service_type)}</strong><div class="person-phone">${escapeHtml(offer ? "Angebot" : row.interval_type)}</div></td>
            <td class="message-cell"><span class="message-preview">${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(row.gross_amount || 0)))}</span><div class="person-phone">${escapeHtml(offer ? (row.valid_until || "ohne Ablauf") : (row.start_date || "—"))}</div></td>
            <td class="status-cell"><span class="status-pill" data-status="new">${escapeHtml(row.status)}</span></td>
            <td><button class="detail-button" type="button" data-record-index="${index}">Öffnen</button></td></tr>`).join("");
        const empty = rows.length === 0; byId("empty-state").hidden = !empty; document.querySelector(".table-wrap table").hidden = empty; return;
    }
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
    if (currentType === "schedule" || currentType === "service-report" || currentType === "reporting") return;
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
    if (currentType === "invoice") {
        const customerId = byId("invoice-customer-filter").value, orderId = byId("invoice-order-filter").value, due = byId("invoice-due-filter").value;
        if (customerId) params.set("customer_id", customerId);
        if (orderId) params.set("order_id", orderId);
        if (due) params.set("due", due);
    }

    try {
        const endpoint = currentType === "document" ? "/api/admin/documents" : currentType === "message" ? "/api/admin/messages" : currentType === "notification" ? "/api/admin/notifications" : currentType === "audit" ? "/api/admin/audit-logs" : currentType === "recurring" ? "/api/admin/recurring-orders" : currentType === "invoice" ? "/api/admin/invoices" : currentType === "order" ? "/api/admin/orders" : currentType === "employee" ? "/api/admin/employees" : currentType === "offer" ? "/api/admin/quotes" : currentType === "contract" ? "/api/admin/contracts" : currentType === "quote" ? "/api/admin/quote-requests" : currentType === "appointment" ? "/api/admin/appointments" : currentType === "customer" ? "/api/admin/customers" : "/api/admin/submissions";
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
    await Promise.all([loadSummary(), currentType === "reporting" ? Promise.all([loadReporting({force:true}),loadVisuals()]) : currentType === "service-report" ? loadServiceReports() : loadSubmissions(), loadQuoteNavCount(), loadCommercialNavCounts(), loadInvoiceNavCount(), loadRecurringNavCount(), loadEmployeeNavCount(), loadOrderNavCount()]);
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

function euro(value) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value || 0)); }
function blankQuoteItem() { return { title: "", description: "", quantity: 1, unit: "Pauschale", unit_price: 0, discount_amount: 0, tax_rate: 19 }; }
function blankInvoiceItem() { return { title: "", description: "", quantity: 1, unit: "Pauschale", unit_price: 0, discount_amount: 0, tax_rate: 19 }; }
function renderInvoiceItems() {
    byId("invoice-items").innerHTML = invoiceItems.map((item,index) => `<article class="quote-item-row" data-invoice-item="${index}"><div class="quote-item-heading"><strong>Position ${index + 1}</strong><button type="button" class="danger" data-remove-invoice-item="${index}">Entfernen</button></div><label>Bezeichnung *<input data-field="title" value="${escapeHtml(item.title)}" required maxlength="180"></label><label>Menge *<input data-field="quantity" type="number" min="0.01" step="0.01" value="${escapeHtml(item.quantity)}" required></label><label>Einheit *<select data-field="unit">${["Stück","m²","Stunde","Pauschale","Monat","Einsatz"].map(unit => `<option ${item.unit === unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label><label>Einzelpreis *<input data-field="unit_price" type="number" min="0" step="0.01" value="${escapeHtml(item.unit_price)}" required></label><label>Rabatt (€)<input data-field="discount_amount" type="number" min="0" step="0.01" value="${escapeHtml(item.discount_amount)}"></label><label>MwSt. (%) *<input data-field="tax_rate" type="number" min="0" max="100" step="0.01" value="${escapeHtml(item.tax_rate)}" required></label><label class="admin-form-wide">Beschreibung<textarea data-field="description" maxlength="4000">${escapeHtml(item.description || "")}</textarea></label></article>`).join("");
    const totals=invoiceItems.reduce((sum,item)=>{const net=Math.max(0,Number(item.quantity||0)*Number(item.unit_price||0)-Number(item.discount_amount||0)),tax=net*Number(item.tax_rate||0)/100;return {net:sum.net+net,tax:sum.tax+tax};},{net:0,tax:0}); byId("invoice-totals").textContent=`Netto: ${euro(totals.net)} · MwSt.: ${euro(totals.tax)} · Brutto: ${euro(totals.net + totals.tax)}`;
}
function renderQuoteItems() {
    byId("quote-items").innerHTML = quoteItems.map((item, index) => `<article class="quote-item-row" data-quote-item="${index}"><div class="quote-item-heading"><strong>Position ${index + 1}</strong><button type="button" class="danger" data-remove-quote-item="${index}">Entfernen</button></div><label>Bezeichnung *<input data-field="title" value="${escapeHtml(item.title)}" maxlength="180" required></label><label>Menge *<input data-field="quantity" type="number" min="0.01" step="0.01" value="${escapeHtml(item.quantity)}" required></label><label>Einheit *<select data-field="unit"><option ${item.unit === "Stück" ? "selected" : ""}>Stück</option><option ${item.unit === "m²" ? "selected" : ""}>m²</option><option ${item.unit === "Stunde" ? "selected" : ""}>Stunde</option><option ${item.unit === "Pauschale" ? "selected" : ""}>Pauschale</option><option ${item.unit === "Monat" ? "selected" : ""}>Monat</option><option ${item.unit === "Einsatz" ? "selected" : ""}>Einsatz</option></select></label><label>Einzelpreis *<input data-field="unit_price" type="number" min="0" step="0.01" value="${escapeHtml(item.unit_price)}" required></label><label>Rabatt (€)<input data-field="discount_amount" type="number" min="0" step="0.01" value="${escapeHtml(item.discount_amount)}"></label><label>MwSt. (%) *<input data-field="tax_rate" type="number" min="0" max="100" step="0.01" value="${escapeHtml(item.tax_rate)}" required></label><label class="admin-form-wide">Beschreibung<textarea data-field="description" maxlength="4000">${escapeHtml(item.description || "")}</textarea></label></article>`).join("");
    const totals = quoteItems.reduce((sum, item) => { const net = Math.max(0, Number(item.quantity || 0) * Number(item.unit_price || 0) - Number(item.discount_amount || 0)); const tax = net * Number(item.tax_rate || 0) / 100; return { net: sum.net + net, tax: sum.tax + tax }; }, { net: 0, tax: 0 });
    byId("quote-totals").textContent = `Netto: ${euro(totals.net)} · MwSt.: ${euro(totals.tax)} · Brutto: ${euro(totals.net + totals.tax)}`;
}

async function fillCommercialCustomers() {
    const customers = await api("/api/admin/customers?page=1");
    const options = `<option value="">Kunde wählen</option>${(customers.rows || []).map(customer => `<option value="${customer.id}">${escapeHtml(`${customer.first_name} ${customer.last_name}`)} · ${escapeHtml(customer.customer_number || customer.email)}</option>`).join("")}`;
    byId("offer-customer").innerHTML = options; byId("contract-customer").innerHTML = options;
}
async function fillPhase12Customers() {
    const result = await api("/api/admin/customers?page=1");
    const options = `<option value="">Kunde wählen</option>${(result.rows || []).map(customer => `<option value="${customer.id}">${escapeHtml(`${customer.first_name} ${customer.last_name}`)} · ${escapeHtml(customer.customer_number || customer.email)}</option>`).join("")}`;
    byId("document-customer").innerHTML = options;
    byId("message-customer").innerHTML = options;
}

async function openDocumentDialog() {
    byId("document-form").reset(); byId("document-form-note").hidden = true;
    await fillPhase12Customers(); byId("document-dialog").showModal();
}

async function openMessageDialog() {
    byId("admin-message-form").reset(); byId("admin-message-form-note").hidden = true;
    await fillPhase12Customers(); byId("message-dialog").showModal();
}
async function openInvoiceDialog(invoice = null) {
    const form=byId("invoice-form"); form.reset(); byId("invoice-form-note").hidden=true; invoiceItems=[blankInvoiceItem()];
    const [customers,orders]=await Promise.all([api("/api/admin/customers?page=1"),api("/api/admin/orders")]);
    byId("invoice-customer").innerHTML=`<option value="">Kunde wählen</option>${(customers.rows||[]).map(customer=>`<option value="${customer.id}">${escapeHtml(`${customer.first_name} ${customer.last_name}`)} · ${escapeHtml(customer.customer_number||customer.email)}</option>`).join("")}`;
    byId("invoice-order").innerHTML=`<option value="">Ohne Auftrag</option>${(orders.rows||[]).map(order=>`<option value="${order.id}">${escapeHtml(order.order_number)} · ${escapeHtml(order.title)}</option>`).join("")}`;
    byId("invoice-dialog-title").textContent=invoice?`Rechnung ${invoice.invoice_number}`:"Rechnung anlegen"; byId("invoice-payments-panel").hidden=!invoice;
    if(invoice){const result=await api(`/api/admin/invoices/${invoice.id}`);Object.entries(result.invoice).forEach(([key,value])=>{const field=form.elements.namedItem(key);if(field)field.value=/date|period/.test(key)&&value?String(value).slice(0,10):value??"";});invoiceItems=result.items||[blankInvoiceItem()];byId("invoice-payment-form").elements.namedItem("invoice_id").value=result.invoice.id;byId("invoice-payment-list").innerHTML=(result.payments||[]).map(payment=>`<article class="assignment-row"><div><strong>${escapeHtml(euro(payment.amount))}</strong><br><span>${escapeHtml(payment.payment_date)} · ${escapeHtml(payment.payment_method)} · ${escapeHtml(payment.payment_reference||"—")}</span></div></article>`).join("")||"<p class=\"empty-copy\">Noch keine Zahlungen.</p>";}
    else { const today=new Date().toISOString().slice(0,10), due=new Date(Date.now()+12096e5).toISOString().slice(0,10); form.elements.namedItem("invoice_date").value=today;form.elements.namedItem("due_date").value=due; }
    renderInvoiceItems();byId("invoice-dialog").showModal();
}

async function openOfferDialog(offer = null, request = null) {
    const form = byId("offer-form"); form.reset(); form.dataset.quoteRequestId = ""; byId("offer-form-note").hidden = true; byId("offer-actions").hidden = true;
    await fillCommercialCustomers(); quoteItems = [blankQuoteItem()];
    byId("offer-dialog-title").textContent = offer ? `Angebot ${offer.quote_number}` : "Angebot anlegen";
    if (offer) { const result = await api(`/api/admin/quotes/${offer.id}`); Object.entries(result.quote).forEach(([key, value]) => { const field = form.elements.namedItem(key); if (field) field.value = /date/.test(key) && value ? String(value).slice(0, 10) : value ?? ""; }); quoteItems = result.items || [blankQuoteItem()]; byId("offer-actions").hidden = result.quote.status !== "ANGENOMMEN"; byId("create-order-from-offer").dataset.quoteId = result.quote.id; }
    if (request) { const values = { customer_id: request.customer_id || "", contact_person: `${request.first_name || ""} ${request.last_name || ""}`.trim(), service_type: request.requested_service || "", service_description: request.message || request.additional_information || "", object_address: request.address || "", postal_code: request.postal_code || "", city: request.city || "", area_sqm: request.area_m2 || "", frequency: request.frequency || "" }; Object.entries(values).forEach(([key,value]) => { const field=form.elements.namedItem(key); if(field) field.value=value; }); form.dataset.quoteRequestId=String(request.id); }
    renderQuoteItems(); byId("offer-dialog").showModal();
}

async function openContractDialog(contract = null) {
    const form = byId("contract-form"); form.reset(); byId("contract-form-note").hidden = true; await fillCommercialCustomers();
    const offers = await api("/api/admin/quotes"); byId("contract-quote").innerHTML = `<option value="">Ohne Angebot</option>${offers.rows.map(offer => `<option value="${offer.id}">${escapeHtml(offer.quote_number)} · ${escapeHtml(`${offer.first_name} ${offer.last_name}`)}</option>`).join("")}`;
    byId("contract-dialog-title").textContent = contract ? `Vertrag ${contract.contract_number}` : "Vertrag anlegen";
    if (contract) { const result = await api(`/api/admin/contracts/${contract.id}`); Object.entries(result.contract).forEach(([key,value]) => { const field=form.elements.namedItem(key); if(field) field.value=/date/.test(key)&&value?String(value).slice(0,10):value??""; }); }
    byId("contract-dialog").showModal();
}

async function openRecurringDialog(schedule = null) {
    const form = byId("recurring-form");
    const [contracts, employees] = await Promise.all([api("/api/admin/contracts?status=AKTIV"), api("/api/admin/employees?status=ACTIVE&page=1")]);
    byId("recurring-contract").innerHTML = `<option value="">Vertrag wählen</option>${(contracts.rows || []).map(contract => `<option value="${contract.id}">${escapeHtml(contract.contract_number)} · ${escapeHtml(`${contract.first_name} ${contract.last_name}`)}</option>`).join("")}`;
    byId("recurring-employee").innerHTML = `<option value="">Automatisch vorschlagen</option>${(employees.rows || []).map(employee => `<option value="${employee.id}">${escapeHtml(`${employee.first_name} ${employee.last_name}`)}</option>`).join("")}`;
    form.reset(); form.elements.namedItem("id").value = ""; byId("recurring-form-note").hidden = true;
    byId("recurring-dialog-title").textContent = schedule ? `Einsatzplan ${schedule.contract_number}` : "Wiederkehrenden Einsatzplan anlegen";
    if (schedule) { const result = await api(`/api/admin/recurring-orders/${schedule.id}`); Object.entries(result.schedule).forEach(([key, value]) => { const field = form.elements.namedItem(key); if (field) field.value = /date/.test(key) && value ? String(value).slice(0, 10) : (value ?? ""); }); form.elements.namedItem("id").value = result.schedule.id; form.elements.namedItem("active").value = Number(result.schedule.active) ? "1" : "0"; }
    byId("recurring-dialog").showModal();
}

async function openDetails(index) {
    const row = currentRows[index];
    if (!row) return;
    byId("resend-employee-invite").hidden = true;
    byId("employee-detail-actions").hidden = true;
    byId("employee-task-summary").hidden = true;
    byId("create-order-from-appointment").hidden = true;
    byId("create-offer-from-request").hidden = true;
    selectedEmployee = null;
    if (currentType === "order") {
        try { await openOrderDialog(row); } catch (error) { setNotice(error.message); }
        return;
    }
    if (currentType === "recurring") { try { await openRecurringDialog(row); } catch (error) { setNotice(error.message); } return; }
    if (currentType === "invoice") { try { await openInvoiceDialog(row); } catch (error) { setNotice(error.message); } return; }
    if (currentType === "offer") { try { await openOfferDialog(row); } catch (error) { setNotice(error.message); } return; }
    if (currentType === "contract") { try { await openContractDialog(row); } catch (error) { setNotice(error.message); } return; }
    if (currentType === "appointment") {
        try { const result = await api(`/api/admin/appointments/${row.id}`); const appointment = result.appointment; selectedAppointment = appointment; byId("detail-type").textContent = `TERMIN #${appointment.id}`; byId("detail-name").textContent = `${appointment.first_name} ${appointment.last_name}`; byId("detail-date").textContent = `${appointment.preferred_date} · ${String(appointment.start_time).slice(0,5)} Uhr`; byId("detail-service").textContent = appointment.service; byId("detail-message").textContent = appointment.message || "—"; const email = byId("detail-email"); email.textContent = appointment.email; email.href = `mailto:${appointment.email}`; byId("detail-phone-row").hidden = false; byId("detail-phone").textContent = appointment.phone; byId("detail-quote-extra").hidden = false; byId("detail-quote-values").textContent = `${appointment.object_type} · ${appointment.address}, ${appointment.postal_code} ${appointment.city}`; byId("detail-files").hidden = true; byId("create-order-from-appointment").hidden = false; byId("detail-dialog").showModal(); } catch (error) { setNotice(error.message); } return;
    }
    if (currentType === "quote") {
        try {
            const result = await api(`/api/admin/quote-requests/${row.id}`);
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
            byId("detail-file-links").innerHTML = result.files.map(file => `<a href="/api/admin/quote-requests/${quote.id}/files/${file.id}">${escapeHtml(file.original_name)}</a>`).join("<br>") || "—";
            selectedQuoteRequest = quote;
            byId("create-offer-from-request").hidden = false;
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

const materialTypeLabel = value => ({ RECEIPT: "Wareneingang", CONSUMPTION: "Verbrauch", RETURN: "Rückgabe", ADJUSTMENT_IN: "Korrektur Eingang", ADJUSTMENT_OUT: "Korrektur Ausgang" }[value] || value || "—");
const materialStatusLabel = value => ({ NORMAL: "Normal", LOW_STOCK: "Niedriger Bestand", OUT_OF_STOCK: "Nicht verfügbar", ACTIVE: "Aktiv", INACTIVE: "Inaktiv", ARCHIVED: "Archiviert", RECORDED: "Erfasst", APPROVED: "Genehmigt", CANCELLED: "Storniert" }[value] || value || "—");
function materialPill(value) { const tone = value === "OUT_OF_STOCK" ? "new" : value === "LOW_STOCK" ? "in_progress" : value === "APPROVED" || value === "NORMAL" ? "done" : "new"; return `<span class="status-pill" data-status="${tone}">${escapeHtml(materialStatusLabel(value))}</span>`; }
function materialNotice(message = "") { const box=byId("materials-message"); box.textContent=message; box.hidden=!message; }
function materialDateToday() { return new Date().toISOString().slice(0,10); }
async function loadMaterials() {
    materialNotice(""); const search=byId("material-search").value.trim(), status=byId("material-status").value;
    try {
        const query=new URLSearchParams(); if(search)query.set("search",search);if(status)query.set("status",status);
        materialRows=(await api(`/api/admin/materials${query.size?`?${query}`:""}`)).rows || [];
        byId("nav-material-count").textContent=String(materialRows.length);
        const cards=[["Gesamtmaterialien",materialRows.length],["Normal",materialRows.filter(row=>row.stock_status==="NORMAL").length],["Niedriger Bestand",materialRows.filter(row=>row.stock_status==="LOW_STOCK").length],["Nicht verfügbar",materialRows.filter(row=>row.stock_status==="OUT_OF_STOCK").length],["Gesamtbestand",materialRows.reduce((total,row)=>total+Number(row.current_stock||0),0)]];
        byId("material-cards").innerHTML=cards.map(([label,value])=>`<article class="finance-card"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString("de-DE",{maximumFractionDigits:3})}</strong></article>`).join("");
        if(materialTab==="materials") { byId("materials-head").innerHTML="<th>NUMMER</th><th>MATERIAL</th><th>EINHEIT</th><th>MINDESTBESTAND</th><th>BESTAND</th><th>STATUS</th><th></th>";byId("materials-body").innerHTML=materialRows.map(row=>`<tr><td>${escapeHtml(row.material_number)}</td><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.unit)}</td><td>${escapeHtml(String(row.minimum_stock))}</td><td>${escapeHtml(String(row.current_stock))}</td><td>${materialPill(row.stock_status)}</td><td><button class="detail-button" data-material-edit="${Number(row.id)}">Bearbeiten</button></td></tr>`).join("")||"<tr><td colspan=7>Keine Daten vorhanden.</td></tr>"; }
        if(materialTab==="movements") await loadMaterialMovements();
        if(materialTab==="requirements") await loadMaterialRequirements();
        byId("materials-page-info").textContent=`${materialRows.length} Einträge`;
    } catch(error) { materialNotice(error.message);byId("materials-body").innerHTML="<tr><td colspan=7>Die Daten konnten nicht geladen werden.</td></tr>"; }
}
async function loadMaterialMovements() { const result=await api("/api/admin/material-stock-movements");const rows=result.rows||[];byId("materials-head").innerHTML="<th>NUMMER</th><th>DATUM</th><th>MATERIAL</th><th>TYP</th><th>MENGE</th><th>KOSTEN</th><th>STATUS</th><th>AKTIONEN</th>";byId("materials-body").innerHTML=rows.map(row=>{const total=row.unit_cost_snapshot==null?"—":`${escapeHtml(String(row.unit_cost_snapshot))} / ${escapeHtml(String((Number(row.quantity)*Number(row.unit_cost_snapshot)).toFixed(2)))}`;const actions=`<button class="detail-button" data-movement-detail="${Number(row.id)}">Details</button>${row.status==="RECORDED"?` <button class="detail-button" data-movement-status="APPROVED" data-movement-id="${Number(row.id)}">Genehmigen</button> <button class="detail-button" data-movement-status="CANCELLED" data-movement-id="${Number(row.id)}">Stornieren</button>`:""}`;return `<tr><td>${escapeHtml(row.movement_number)}</td><td>${escapeHtml(String(row.movement_date||"").slice(0,10))}</td><td>${escapeHtml(row.material_name)}</td><td>${escapeHtml(materialTypeLabel(row.movement_type))}</td><td>${escapeHtml(String(row.quantity))} ${escapeHtml(row.unit)}</td><td>${total}</td><td>${materialPill(row.status)}</td><td>${actions}</td></tr>`;}).join("")||"<tr><td colspan=8>Keine Daten vorhanden.</td></tr>"; }
async function openMaterial(id) { const {material}=await api(`/api/admin/materials/${id}`),form=byId("material-form");form.reset();Object.entries({id:material.id,material_number:material.material_number,name:material.name,unit:material.unit,minimum_stock:material.minimum_stock,default_cost:material.default_unit_cost,status:material.status,description:material.description||""}).forEach(([key,value])=>form.elements.namedItem(key).value=value??"");byId("material-dialog-title").textContent=`Material bearbeiten · ${material.material_number}`;byId("material-form-note").hidden=true;byId("material-dialog").showModal();}
function openMaterialCreate(){const form=byId("material-form");form.reset();form.elements.id.value="";form.elements.minimum_stock.value="0";form.elements.status.value="ACTIVE";byId("material-dialog-title").textContent="Neues Material";byId("material-form-note").hidden=true;byId("material-dialog").showModal();}
function openMovement(type="RECEIPT"){const form=byId("movement-form");form.reset();form.elements.movement_type.value=type;form.elements.movement_date.value=materialDateToday();byId("movement-dialog-title").textContent=materialTypeLabel(type);byId("movement-form-note").hidden=true;byId("movement-cost-preview").hidden=true;byId("movement-dialog").showModal();}
async function openMovementDetail(id){const {movement}=await api(`/api/admin/material-stock-movements/${id}`);const value=value=>escapeHtml(value==null||value===""?"—":String(value));const rows=[["Bewegungsnummer",movement.movement_number],["Material",`${movement.material_number||""} · ${movement.material_name||""}`],["Einheit",movement.unit],["Typ",materialTypeLabel(movement.movement_type)],["Menge",movement.quantity],["Kosten pro Einheit",movement.unit_cost_snapshot],["Gesamtkosten",movement.unit_cost_snapshot==null?null:(Number(movement.quantity)*Number(movement.unit_cost_snapshot)).toFixed(2)],["Status",movement.status],["Datum",String(movement.movement_date||"").slice(0,10)],["Auftrag",movement.order_number],["Mitarbeiter",movement.employee_number],["Leistungsnachweis",movement.report_number],["Referenz / Grund",movement.reference],["Notiz",movement.notes],["Erstellt",movement.created_at],["Aktualisiert",movement.updated_at]].map(([label,text])=>`<div><span>${escapeHtml(label)}</span><strong>${value(text)}</strong></div>`).join("");byId("movement-detail-content").innerHTML=rows;byId("movement-detail-title").textContent=`Bewegung · ${movement.movement_number}`;byId("movement-detail-dialog").showModal();}
async function loadRequirementOrders(){const result=await api("/api/admin/orders?page=1");const select=byId("requirement-order"),current=select.value;select.innerHTML='<option value="">Auftrag wählen</option>'+(result.rows||[]).map(row=>`<option value="${Number(row.id)}">${escapeHtml(row.order_number)} – ${escapeHtml(`${row.first_name||""} ${row.last_name||""}`.trim()||"Kunde")}</option>`).join("");select.value=current;}
async function loadMaterialRequirements(){const control=byId("requirement-order-control");control.hidden=false;await loadRequirementOrders();byId("materials-head").innerHTML="<th>MATERIAL</th><th>MENGE</th><th>EINHEIT</th><th>BESTAND</th><th>STATUS</th><th>AKTIONEN</th>";if(!requirementOrderId){byId("materials-body").innerHTML='<tr><td colspan="6">Bitte wählen Sie zuerst einen Auftrag aus.</td></tr>';return;}const result=await api(`/api/admin/orders/${requirementOrderId}/material-requirements`),stock=new Map(materialRows.map(row=>[Number(row.id),row]));byId("materials-body").innerHTML=(result.rows||[]).map(row=>{const item=stock.get(Number(row.material_id));return `<tr><td>${escapeHtml(row.material_number)} · ${escapeHtml(row.name)}</td><td>${escapeHtml(String(row.planned_quantity))}</td><td>${escapeHtml(row.unit)}</td><td>${item?escapeHtml(String(item.current_stock)):"—"}</td><td>${item?materialPill(item.stock_status):"—"}</td><td><button class="detail-button" data-requirement-edit="${Number(row.id)}">Bearbeiten</button> <button class="detail-button" data-requirement-delete="${Number(row.id)}">Löschen</button></td></tr>`}).join("")||'<tr><td colspan="6">Für diesen Auftrag sind noch keine Materialien geplant.</td></tr>';}
function openRequirement(row=null){if(!requirementOrderId){materialNotice("Bitte wählen Sie zuerst einen Auftrag aus.");return;}const form=byId("requirement-form");form.reset();form.elements.id.value=row?.id||"";byId("requirement-dialog-title").textContent=row?"Materialbedarf bearbeiten":"Materialbedarf hinzufügen";byId("requirement-material").innerHTML='<option value="">Material wählen</option>'+materialRows.filter(item=>item.status==="ACTIVE").map(item=>`<option value="${Number(item.id)}" data-unit="${escapeHtml(item.unit)}">${escapeHtml(item.material_number)} · ${escapeHtml(item.name)}</option>`).join("");if(row){form.elements.material_id.value=row.material_id;form.elements.required_quantity.value=row.planned_quantity;form.elements.status.value=row.status;form.elements.notes.value=row.notes||"";byId("requirement-unit").value=row.unit;}byId("requirement-form-note").hidden=true;byId("requirement-dialog").showModal();}

let actionCenterPage = 1;
function actionCenterMessage(message, kind="error"){const node=byId("action-center-message");node.textContent=message;node.className=`dashboard-message${kind==="success"?" is-success":""}`;node.hidden=!message;}
function actionPriorityLabel(priority){return priority==="critical"?"Kritisch":priority==="high"?"Hoch":"Normal";}
function actionAreaLabel(area){return ({orders:"Aufträge",invoices:"Rechnungen",service_reports:"Leistungsnachweise",materials:"Material & Lager",quality:"Qualität & Vorfälle",automation:"Automation",notifications:"Benachrichtigungen"})[area]||area;}
function actionDate(value){return value?formatDate(value):"—";}
async function loadActionCenter(){const priority=byId("action-center-priority").value,area=byId("action-center-area").value,query=new URLSearchParams({page:String(actionCenterPage),page_size:"20"});if(priority)query.set("priority",priority);if(area)query.set("area",area);byId("action-center-body").innerHTML='<tr><td colspan="5">Aktionscenter wird geladen …</td></tr>';actionCenterMessage("");try{const result=await api(`/api/admin/action-center?${query}`),summary=result.summary||{};byId("action-center-cards").innerHTML=[["Kritisch",summary.critical||0,"critical"],["Hohe Priorität",summary.high||0,"high"],["Fehlende Leistungsnachweise",summary.service_reports||0,"high"],["Überfällige Rechnungen",summary.invoices||0,"critical"],["Niedrige Bestände",summary.materials||0,"high"],["Ungelesene Hinweise",summary.notifications||0,"normal"]].map(([label,value,priorityClass])=>`<article class="finance-card action-card-${priorityClass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(reportNumber(value))}</strong></article>`).join("");byId("nav-action-count").textContent=String(Number(summary.critical||0)+Number(summary.high||0));byId("action-center-body").innerHTML=(result.items||[]).map(item=>`<tr><td><span class="action-priority action-priority-${escapeHtml(item.priority)}">${escapeHtml(actionPriorityLabel(item.priority))}</span></td><td>${escapeHtml(actionAreaLabel(item.area))}</td><td><strong>${escapeHtml(item.title)}</strong><div class="message-preview">${escapeHtml(item.description||"")}</div></td><td>${escapeHtml(actionDate(item.date))}</td><td><button type="button" class="detail-button" data-action-target="${escapeHtml(item.target)}" data-action-id="${Number(item.entity_id)||""}">Öffnen</button></td></tr>`).join("")||'<tr><td colspan="5">Keine Hinweise für die ausgewählten Filter.</td></tr>';byId("action-center-page-info").textContent=`Seite ${result.page} von ${result.totalPages} · ${result.total} Einträge`;byId("action-center-previous").disabled=result.page<=1;byId("action-center-next").disabled=result.page>=result.totalPages;}catch(error){byId("action-center-cards").innerHTML="";byId("action-center-body").innerHTML='<tr><td colspan="5">Aktionscenter konnte nicht geladen werden.</td></tr>';actionCenterMessage(error.status===401?"Sitzung abgelaufen. Bitte melden Sie sich erneut an.":error.message||"Aktionscenter konnte nicht geladen werden.");if(error.status===401)showLogin("Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");}}
byId("action-center-refresh").addEventListener("click",()=>{actionCenterPage=1;loadActionCenter();});
["action-center-priority","action-center-area"].forEach(id=>byId(id).addEventListener("change",()=>{actionCenterPage=1;loadActionCenter();}));
byId("action-center-previous").addEventListener("click",()=>{if(actionCenterPage>1){actionCenterPage-=1;loadActionCenter();}});
byId("action-center-next").addEventListener("click",()=>{actionCenterPage+=1;loadActionCenter();});
byId("action-center-body").addEventListener("click",event=>{const button=event.target.closest("[data-action-target]");if(!button)return;const target=button.dataset.actionTarget;if(!document.querySelector(`.nav-item[data-type="${target}"]`))return;currentType=target;currentPage=1;updateViewHeading();if(target==="materials")loadMaterials().catch(error=>setNotice(error.message));else if(target==="service-report")loadServiceReports().catch(error=>setNotice(error.message));else if(target==="notification")loadSubmissions().catch(error=>setNotice(error.message));else loadSubmissions().catch(error=>setNotice(error.message));});

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", async () => {
        if (currentType === button.dataset.type) return;
        currentType = button.dataset.type;
        currentPage = 1;
        byId("status-filter").value = "all";
        updateViewHeading();
        if (currentType === "schedule") { try { await loadSchedule(); } catch (error) { setNotice(error.message); } } else if (currentType === "finance") { try { setFinanceFilterOptions(); await loadFinance(); } catch (error) { setNotice(error.message); } } else if (currentType === "action-center") { await loadActionCenter(); } else if (currentType === "reporting") { await Promise.all([loadReporting(),loadVisuals()]); } else if (currentType === "service-report") { await loadServiceReports(); } else if (currentType === "quality") { await window.loadQualityIncidents?.(); } else if (currentType === "materials") { await loadMaterials(); } else loadSubmissions();
    });
});

byId("status-filter").addEventListener("change", () => {
    currentPage = 1;
    loadSubmissions();
});
["invoice-customer-filter", "invoice-order-filter", "invoice-due-filter"].forEach(id => byId(id).addEventListener("change", () => { currentPage = 1; loadSubmissions(); }));

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

byId("create-offer-button").addEventListener("click", () => openOfferDialog().catch(error => setNotice(error.message)));
byId("create-contract-button").addEventListener("click", () => openContractDialog().catch(error => setNotice(error.message)));
byId("create-recurring-button").addEventListener("click", () => openRecurringDialog().catch(error => setNotice(error.message)));
byId("generate-recurring-button").addEventListener("click", () => { byId("generator-form").reset(); byId("generator-form-note").hidden = true; byId("generator-dialog").showModal(); });
byId("create-invoice-button").addEventListener("click", () => openInvoiceDialog().catch(error => setNotice(error.message)));
byId("create-document-button").addEventListener("click", () => openDocumentDialog().catch(error => setNotice(error.message)));
byId("create-message-button").addEventListener("click", () => openMessageDialog().catch(error => setNotice(error.message)));
byId("document-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget, note = byId("document-form-note"), data = new FormData(form);
    try { const result = await api("/api/admin/documents", { method: "POST", body: data }); form.reset(); byId("document-dialog").close(); setNotice(result.message, "success"); await loadSubmissions(); } catch (error) { note.textContent = error.message; note.hidden = false; }
});
byId("admin-message-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget, note = byId("admin-message-form-note");
    try { const result = await api("/api/admin/messages", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); byId("message-dialog").close(); setNotice(result.message, "success"); await loadSubmissions(); } catch (error) { note.textContent = error.message; note.hidden = false; }
});
byId("recurring-form").addEventListener("submit", async event => { event.preventDefault(); const form = event.currentTarget, id = form.elements.namedItem("id").value, note = byId("recurring-form-note"); try { const payload = Object.fromEntries(new FormData(form)); delete payload.id; const result = await api(id ? `/api/admin/recurring-orders/${id}` : "/api/admin/recurring-orders", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) }); byId("recurring-dialog").close(); setNotice(result.message, "success"); await reloadDashboard(); } catch (error) { note.textContent = error.message; note.hidden = false; } });
byId("generator-form").addEventListener("submit", async event => { event.preventDefault(); const note = byId("generator-form-note"); try { const result = await api("/api/admin/recurring-orders/generate", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); const summary = result.summary; note.textContent = `Geprüft: ${summary.checkedContracts} · Neu: ${summary.created} · Bereits vorhanden: ${summary.existing} · Ohne Mitarbeiter: ${summary.noAvailability} · Fehler: ${summary.failed}`; note.hidden = false; note.classList.remove("is-error"); await reloadDashboard(); } catch (error) { note.textContent = error.message; note.hidden = false; } });
byId("add-invoice-item").addEventListener("click", () => { invoiceItems.push(blankInvoiceItem()); renderInvoiceItems(); });
byId("invoice-items").addEventListener("change", event => { const row=event.target.closest("[data-invoice-item]"); if(!row||!event.target.dataset.field)return; invoiceItems[Number(row.dataset.invoiceItem)][event.target.dataset.field]=event.target.value; renderInvoiceItems(); });
byId("invoice-items").addEventListener("click", event => { const button=event.target.closest("[data-remove-invoice-item]"); if(!button)return; invoiceItems.splice(Number(button.dataset.removeInvoiceItem),1); if(!invoiceItems.length)invoiceItems.push(blankInvoiceItem()); renderInvoiceItems(); });
byId("invoice-form").addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget,note=byId("invoice-form-note"),id=form.elements.namedItem("id").value; try { const payload=Object.fromEntries(new FormData(form));delete payload.id;if(!id || payload.status === "ENTWURF") payload.items=invoiceItems;const result=await api(id?`/api/admin/invoices/${id}`:"/api/admin/invoices",{method:id?"PATCH":"POST",body:JSON.stringify(payload)});note.textContent=result.message;note.hidden=false;note.classList.remove("is-error");if(!id){form.elements.namedItem("id").value=result.id;byId("invoice-dialog-title").textContent=`Rechnung ${result.invoiceNumber}`;byId("invoice-payments-panel").hidden=false;byId("invoice-payment-form").elements.namedItem("invoice_id").value=result.id;}await reloadDashboard(); }catch(error){note.textContent=error.message;note.hidden=false;} });
byId("invoice-payment-form").addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget,id=form.elements.namedItem("invoice_id").value; if(!id)return; try { await api(`/api/admin/invoices/${id}/payments`,{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(form)))}); const result=await api(`/api/admin/invoices/${id}`); byId("invoice-payment-list").innerHTML=(result.payments||[]).map(payment=>`<article class="assignment-row"><div><strong>${escapeHtml(euro(payment.amount))}</strong><br><span>${escapeHtml(payment.payment_date)} · ${escapeHtml(payment.payment_method)}</span></div></article>`).join(""); form.reset();form.elements.namedItem("invoice_id").value=id;await reloadDashboard(); }catch(error){byId("invoice-form-note").textContent=error.message;byId("invoice-form-note").hidden=false;} });
byId("add-quote-item").addEventListener("click", () => { quoteItems.push(blankQuoteItem()); renderQuoteItems(); });
byId("quote-items").addEventListener("change", event => { const row = event.target.closest("[data-quote-item]"); if (!row || !event.target.dataset.field) return; quoteItems[Number(row.dataset.quoteItem)][event.target.dataset.field] = event.target.value; renderQuoteItems(); });
byId("quote-items").addEventListener("click", event => { const button = event.target.closest("[data-remove-quote-item]"); if (!button) return; quoteItems.splice(Number(button.dataset.removeQuoteItem), 1); if (!quoteItems.length) quoteItems.push(blankQuoteItem()); renderQuoteItems(); });
byId("offer-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget, note = byId("offer-form-note"), id = form.elements.namedItem("id").value;
    try { const payload = Object.fromEntries(new FormData(form)); delete payload.id; payload.quote_request_id = form.dataset.quoteRequestId || ""; payload.items = quoteItems; const result = await api(id ? `/api/admin/quotes/${id}` : "/api/admin/quotes", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) }); form.dataset.quoteRequestId = ""; note.textContent = result.message; note.hidden = false; note.classList.remove("is-error"); if (!id) { form.elements.namedItem("id").value = result.id; byId("offer-dialog-title").textContent = `Angebot ${result.quoteNumber}`; } await reloadDashboard(); } catch (error) { note.textContent = error.message; note.hidden = false; }
});
byId("create-order-from-offer").addEventListener("click", async event => { const quoteId = event.currentTarget.dataset.quoteId; if (!quoteId) return; try { const result = await api(`/api/admin/quotes/${quoteId}/create-order`, { method: "POST", body: "{}" }); setNotice(`${result.message} ${result.orderNumber}`, "success"); byId("offer-dialog").close(); currentType = "order"; updateViewHeading(); await reloadDashboard(); } catch (error) { byId("offer-form-note").textContent = error.message; byId("offer-form-note").hidden = false; } });
byId("create-offer-from-request").addEventListener("click", () => { if (!selectedQuoteRequest) return; byId("detail-dialog").close(); openOfferDialog(null, selectedQuoteRequest).catch(error => setNotice(error.message)); });
byId("contract-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget, note = byId("contract-form-note"), id = form.elements.namedItem("id").value;
    try { const payload=Object.fromEntries(new FormData(form)); delete payload.id; const result=await api(id ? `/api/admin/contracts/${id}` : "/api/admin/contracts", { method:id ? "PATCH":"POST", body:JSON.stringify(payload) }); note.textContent=result.message; note.hidden=false; note.classList.remove("is-error"); if(!id){form.elements.namedItem("id").value=result.id;byId("contract-dialog-title").textContent=`Vertrag ${result.contractNumber}`;}await reloadDashboard(); } catch(error){note.textContent=error.message;note.hidden=false;}
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
    const message = event.target.closest("[data-message-read]");
    const notification = event.target.closest("[data-notification-read]");
    if (message) { api(`/api/admin/messages/${message.dataset.messageRead}/read`, { method: "PATCH", body: "{}" }).then(() => loadSubmissions()).catch(error => setNotice(error.message)); return; }
    if (notification) { api(`/api/admin/notifications/${notification.dataset.notificationRead}/read`, { method: "PATCH", body: "{}" }).then(() => loadSubmissions()).catch(error => setNotice(error.message)); return; }
    const button = event.target.closest("[data-record-index]");
    if (button?.classList.contains("detail-button")) openDetails(Number(button.dataset.recordIndex));
});

recordsBody.addEventListener("change", async event => {
    const select = event.target.closest("[data-managed-status]");
    if (!select) return;
    select.disabled = true;
    try {
        const endpoint = currentType === "appointment" ? "/api/admin/appointments" : "/api/admin/quote-requests";
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

byId("finance-period").addEventListener("change", () => loadFinance().catch(error => setNotice(error.message)));
byId("reporting-period").addEventListener("change",event=>{const custom=event.target.value==="custom";byId("reporting-from-field").hidden=!custom;byId("reporting-to-field").hidden=!custom;byId("reporting-from").required=custom;byId("reporting-to").required=custom;performancePage=1;});
let performancePage=1;let performanceLoading=false;
function performanceState(message){const node=byId("performance-content");node.innerHTML=`<p class="reporting-chart-loading" role="status">${escapeHtml(message)}</p>`;}
function performanceChart(title,labels,values,formatter){if(!values.length||values.every(value=>Number(value||0)===0))return `<article class="reporting-section"><h3>${escapeHtml(title)}</h3><p>Keine Daten für den ausgewählten Zeitraum vorhanden.</p></article>`;const max=Math.max(1,...values.map(Number));const width=420,height=210,bar=width/values.length-12;return `<article class="reporting-section"><h3>${escapeHtml(title)}</h3><svg class="performance-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${values.map((value,index)=>{const h=Math.max(2,Number(value)/max*130),x=12+index*(bar+12),y=160-h;return `<rect x="${x}" y="${y}" width="${bar}" height="${h}" fill="#176d9d"><title>${escapeHtml(`${labels[index]}: ${formatter(value)}`)}</title></rect><text x="${x+bar/2}" y="178" text-anchor="middle" font-size="9">${escapeHtml(String(labels[index]).slice(0,14))}</text><text x="${x+bar/2}" y="${y-5}" text-anchor="middle" font-size="8">${escapeHtml(formatter(value))}</text>`}).join("")}</svg></article>`;}
function performanceOrderTable(data){let section=document.querySelector(".performance-order-section");if(!section){section=document.createElement("section");section.className="performance-order-section";section.innerHTML='<h3>Order Efficiency</h3><div class="table-scroll"><table><thead><tr><th>Auftrag</th><th>Kunde</th><th>Status</th><th>Geplant</th><th>Tatsächlich</th><th>Materialkosten</th><th>Umsatz</th><th>Contribution vor Personalkosten</th></tr></thead><tbody></tbody></table></div><div class="finance-pagination"><button type="button" class="button button-light" data-performance-prev aria-label="Vorherige Seite">← Zurück</button><span data-performance-page></span><button type="button" class="button button-light" data-performance-next aria-label="Nächste Seite">Weiter →</button></div>';byId("performance-content").after(section);section.addEventListener("click",event=>{if(event.target.closest("[data-performance-prev]")&&performancePage>1){performancePage--;loadPerformance()}if(event.target.closest("[data-performance-next]")&&performancePage<data.total_pages){performancePage++;loadPerformance()}})}const body=section.querySelector("tbody");body.innerHTML=(data.items||[]).length?(data.items||[]).map(row=>`<tr><td>${escapeHtml(row.order_number)}</td><td>${escapeHtml(row.customer_name)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(`${Number(row.planned_hours||0).toFixed(1)} h`)}</td><td>${escapeHtml(`${Number(row.actual_hours||0).toFixed(1)} h`)}</td><td>${escapeHtml(reportEuro(row.material_cost))}</td><td>${escapeHtml(reportEuro(row.price_gross_snapshot))}</td><td>${escapeHtml(reportEuro(row.contribution_before_personnel_costs))}</td></tr>`).join(""):'<tr><td colspan="8">Keine Daten für den ausgewählten Zeitraum vorhanden.</td></tr>';section.querySelector("[data-performance-page]").textContent=`Seite ${data.page} / ${data.total_pages} · ${data.total} Einträge`;section.querySelector("[data-performance-prev]").disabled=data.page<=1;section.querySelector("[data-performance-next]").disabled=data.page>=data.total_pages;}
async function loadPerformance(){if(performanceLoading)return;performanceLoading=true;performanceState("Leistungsanalyse wird geladen…");try{const params=reportParams(),query=new URLSearchParams({period:params.period,compare:String(params.compare),page:String(performancePage),page_size:"10"});if(params.period==="custom"){query.set("from",params.from);query.set("to",params.to)}const endpoints=["operations","services","receivables","recurring"].map(name=>api(`/api/admin/reports/performance/${name}?${query}`));const [operations,services,receivables,recurring,orders]=await Promise.all([...endpoints,api(`/api/admin/reports/performance/orders?${query}`)]);const op=operations.data,svc=services.data,rec=receivables.data,rng=recurring.data;byId("performance-cards").innerHTML=[["Auftragsabschlussrate",`${Number(op.completion_rate||0).toFixed(1)}%`],["Stornierungsrate",`${Number(op.cancellation_rate||0).toFixed(1)}%`],["Geplante Stunden",`${Number(op.planned_hours||0).toFixed(1)} h`],["Tatsächliche Stunden",`${Number(op.actual_hours||0).toFixed(1)} h`],["Service-Report-Abschlussrate",`${Number(op.service_report_completion_rate||0).toFixed(1)}%`],["Contribution vor Personalkosten",reportEuro((svc.items||[]).reduce((sum,row)=>sum+Number(row.contribution_before_personnel_costs||0),0))],["Überfällige Forderungen",reportEuro(rec.overdue_invoice_amount)]].map(([label,value])=>`<article class="finance-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");byId("performance-content").innerHTML=`<section class="reporting-chart-grid">${performanceChart("Umsatz nach Leistung",(svc.items||[]).map(row=>row.service_type),(svc.items||[]).map(row=>row.revenue),reportEuro)}${performanceChart("Geplante vs tatsächliche Stunden",["Geplant","Tatsächlich"],[op.planned_hours,op.actual_hours],value=>`${Number(value||0).toFixed(1)} h`)}${performanceChart("Forderungsalterung",["Aktuell","1–30","31–60","61–90",">90"],[rec.buckets?.current,rec.buckets?.days_1_30,rec.buckets?.days_31_60,rec.buckets?.days_61_90,rec.buckets?.days_90_plus],reportEuro)}</section><article class="reporting-section"><h3>Service Performance</h3>${(svc.items||[]).length?`<div class="table-scroll"><table><thead><tr><th>Leistung</th><th>Umsatz</th><th>Aufträge</th><th>Abgeschlossen</th><th>Storniert</th><th>Contribution vor Personalkosten</th></tr></thead><tbody>${svc.items.map(row=>`<tr><td>${escapeHtml(row.service_type)}</td><td>${escapeHtml(reportEuro(row.revenue))}</td><td>${escapeHtml(reportNumber(row.order_count))}</td><td>${escapeHtml(reportNumber(row.completed_orders))}</td><td>${escapeHtml(reportNumber(row.cancelled_orders))}</td><td>${escapeHtml(reportEuro(row.contribution_before_personnel_costs))}</td></tr>`).join("")}</tbody></table></div>`:"<p>Keine Daten für den ausgewählten Zeitraum vorhanden.</p>"}</article><article class="reporting-section"><h3>Wiederkehrende Aufträge</h3><p>Aktive Verträge: ${escapeHtml(reportNumber(rng.recurring_contracts))}<br>Generiert: ${escapeHtml(reportNumber(rng.generated_orders))}<br>Erfolgreich: ${escapeHtml(reportNumber(rng.successful_generation))}<br>Duplikate: ${escapeHtml(reportNumber(rng.duplicate_outcomes))}<br>Fehler: ${escapeHtml(reportNumber(rng.error_outcomes))}</p></article>`;performanceOrderTable(orders.data)}catch(error){byId("performance-cards").innerHTML="";performanceState("Die Leistungsanalyse konnte nicht geladen werden.")}finally{performanceLoading=false}}
byId("reporting-refresh").addEventListener("click",()=>{performancePage=1;reportingCache.clear();Promise.all([loadReporting({force:true}),loadVisuals(),loadPerformance()]).catch(error=>reportingMessage(error.message||"Der Bericht konnte nicht geladen werden."));});
document.querySelector('[data-type="reporting"]')?.addEventListener("click",()=>setTimeout(()=>loadPerformance().catch(error=>reportingMessage(error.message||"Die Leistungsanalyse konnte nicht geladen werden.")),0));

let performanceFilterOptionsPromise = null;

function performanceFilterValue(id) {
    return String(byId(id)?.value || "").trim();
}

function buildPerformanceQueryParams(endpoint, { page = performancePage } = {}) {
    const params = reportParams();
    const query = new URLSearchParams({ period: params.period, compare: String(params.compare) });
    if (params.period === "custom") { query.set("from", params.from); query.set("to", params.to); }
    const serviceType = performanceFilterValue("performance-service");
    const customerId = performanceFilterValue("performance-customer");
    const employeeId = performanceFilterValue("performance-employee");
    if (serviceType) query.set("service_type", serviceType);
    if (customerId) query.set("customer_id", customerId);
    if (["operations", "orders"].includes(endpoint) && employeeId) query.set("employee_id", employeeId);
    if (endpoint === "orders") { query.set("page", String(page)); query.set("page_size", "10"); }
    return query;
}

async function loadAllReportOptionRows(endpoint) {
    const first = await api(`${endpoint}${endpoint.includes("?") ? "&" : "?"}page=1`);
    const rows = [...(first.rows || [])];
    const pageSize = Number(first.pageSize || first.page_size || rows.length || 1);
    const totalPages = Math.min(20, Math.max(1, Math.ceil(Number(first.total || rows.length) / pageSize)));
    for (let page = 2; page <= totalPages; page += 1) {
        const result = await api(`${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}`);
        rows.push(...(result.rows || []));
    }
    return rows;
}

function setPerformanceSelectOptions(id, placeholder, rows, getValue, getLabel) {
    const select = byId(id), selected = select.value;
    const unique = new Map();
    rows.forEach(row => { const value = String(getValue(row) || "").trim(); if (value) unique.set(value, getLabel(row)); });
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${[...unique.entries()].sort((a,b) => String(a[1]).localeCompare(String(b[1]), "de")).map(([value,label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}`;
    if (unique.has(selected)) select.value = selected;
}

async function loadPerformanceFilterOptions() {
    if (performanceFilterOptionsPromise) return performanceFilterOptionsPromise;
    performanceFilterOptionsPromise = Promise.all([
        loadAllReportOptionRows("/api/admin/customers"),
        loadAllReportOptionRows("/api/admin/employees?status=ACTIVE"),
        loadAllReportOptionRows("/api/admin/orders")
    ]).then(([customers, employees, orders]) => {
        setPerformanceSelectOptions("performance-customer", "Alle Kunden", customers, row => row.id, row => `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.customer_number || row.email || `Kunde #${row.id}`);
        setPerformanceSelectOptions("performance-employee", "Alle Mitarbeiter", employees, row => row.id, row => `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.employee_number || `Mitarbeiter #${row.id}`);
        setPerformanceSelectOptions("performance-service", "Alle Leistungen", orders, row => row.service_type, row => row.service_type);
    }).catch(error => {
        performanceFilterOptionsPromise = null;
        reportingMessage(error.message || "Filteroptionen konnten nicht geladen werden.");
    });
    return performanceFilterOptionsPromise;
}

function performanceOrderSection() {
    return document.querySelector(".performance-order-section");
}

async function loadPerformance() {
    if (performanceLoading) return;
    performanceLoading = true;
    byId("performance-cards").innerHTML = "";
    performanceState("Leistungsanalyse wird geladen …");
    const existingTable = performanceOrderSection();
    if (existingTable) existingTable.hidden = true;
    try {
        await loadPerformanceFilterOptions();
        const request = endpoint => api(`/api/admin/reports/performance/${endpoint}?${buildPerformanceQueryParams(endpoint)}`);
        const [operations, services, receivables, recurring, orders] = await Promise.all([
            request("operations"), request("services"), request("receivables"), request("recurring"), request("orders")
        ]);
        const op = operations.data, svc = services.data, rec = receivables.data, rng = recurring.data;
        byId("performance-cards").innerHTML = [
            ["Aufträge", reportNumber(op.order_count)],
            ["Auftragsabschlussrate", `${Number(op.completion_rate || 0).toFixed(1)}%`],
            ["Stornierungsrate", `${Number(op.cancellation_rate || 0).toFixed(1)}%`],
            ["Geplante Stunden", `${Number(op.planned_hours || 0).toFixed(1)} h`],
            ["Tatsächliche Stunden", `${Number(op.actual_hours || 0).toFixed(1)} h`],
            ["Service-Report-Abschlussrate", `${Number(op.service_report_completion_rate || 0).toFixed(1)}%`],
            ["Überfällige Forderungen", reportEuro(rec.overdue_invoice_amount)]
        ].map(([label,value]) => `<article class="finance-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
        byId("performance-content").innerHTML = `<section class="reporting-chart-grid">${performanceChart("Umsatz nach Leistung", (svc.items || []).map(row => row.service_type), (svc.items || []).map(row => row.revenue), reportEuro)}${performanceChart("Geplante vs. tatsächliche Stunden", ["Geplant", "Tatsächlich"], [op.planned_hours, op.actual_hours], value => `${Number(value || 0).toFixed(1)} h`)}${performanceChart("Forderungsalterung", ["Aktuell", "1–30", "31–60", "61–90", ">90"], [rec.buckets?.current,rec.buckets?.days_1_30,rec.buckets?.days_31_60,rec.buckets?.days_61_90,rec.buckets?.days_90_plus], reportEuro)}</section><article class="reporting-section"><h3>Service Performance</h3>${(svc.items || []).length ? `<div class="table-scroll"><table><thead><tr><th>Leistung</th><th>Umsatz</th><th>Aufträge</th><th>Abgeschlossen</th><th>Storniert</th><th>Contribution vor Personalkosten</th></tr></thead><tbody>${svc.items.map(row => `<tr><td>${escapeHtml(row.service_type)}</td><td>${escapeHtml(reportEuro(row.revenue))}</td><td>${escapeHtml(reportNumber(row.order_count))}</td><td>${escapeHtml(reportNumber(row.completed_orders))}</td><td>${escapeHtml(reportNumber(row.cancelled_orders))}</td><td>${escapeHtml(reportEuro(row.contribution_before_personnel_costs))}</td></tr>`).join("")}</tbody></table></div>` : "<p>Keine Daten für den ausgewählten Zeitraum oder Filter vorhanden.</p>"}</article><article class="reporting-section"><h3>Wiederkehrende Aufträge</h3><p>Aktive Verträge: ${escapeHtml(reportNumber(rng.recurring_contracts))}<br>Generiert: ${escapeHtml(reportNumber(rng.generated_orders))}<br>Erfolgreich: ${escapeHtml(reportNumber(rng.successful_generation))}<br>Duplikate: ${escapeHtml(reportNumber(rng.duplicate_outcomes))}<br>Fehler: ${escapeHtml(reportNumber(rng.error_outcomes))}</p></article>`;
        performanceOrderTable(orders.data);
        const table = performanceOrderSection(); if (table) table.hidden = false;
    } catch (error) {
        byId("performance-cards").innerHTML = "";
        if (error.status === 401) showLogin("Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");
        performanceState(error.message || "Die Leistungsanalyse konnte nicht geladen werden.");
    } finally { performanceLoading = false; }
}

function resetPerformanceFilters() {
    byId("reporting-period").value = "month";
    byId("reporting-from").value = "";
    byId("reporting-to").value = "";
    byId("reporting-compare").checked = false;
    byId("reporting-from-field").hidden = true;
    byId("reporting-to-field").hidden = true;
    byId("reporting-from").required = false;
    byId("reporting-to").required = false;
    ["performance-service", "performance-customer", "performance-employee"].forEach(id => { byId(id).value = ""; });
    performancePage = 1;
}

byId("performance-apply-filters").addEventListener("click", () => { performancePage = 1; loadPerformance().catch(error => reportingMessage(error.message)); });
byId("performance-clear-filters").addEventListener("click", () => { resetPerformanceFilters(); loadPerformance().catch(error => reportingMessage(error.message)); });
document.querySelectorAll("#performance-service,#performance-customer,#performance-employee").forEach(field => field.addEventListener("change", () => { performancePage = 1; }));

byId("reporting-export-csv").addEventListener("click",downloadReportingCsv);
byId("reporting-export-pdf").addEventListener("click",downloadReportingPdf);
byId("reporting-print").addEventListener("click",()=>window.print());
byId("reporting-summary").addEventListener("click",async event=>{const button=event.target.closest("[data-report-detail]");if(!button)return;try{const params=reportParams(),result=await loadReport(`/api/admin/reports/${button.dataset.reportDetail}`,params);const data=params.compare?result.data.current:result.data;byId(`report-detail-${button.dataset.reportDetail}`).textContent=Object.entries(data).map(([key,value])=>`${key}: ${typeof value==="object"?JSON.stringify(value):value}`).join(" · ");}catch(error){reportingMessage(error.message);}});
byId("finance-refresh").addEventListener("click", () => loadFinance().catch(error => setNotice(error.message)));
document.querySelectorAll("[data-finance-tab]").forEach(button => button.addEventListener("click", () => { financeTab=button.dataset.financeTab; financePage=1; document.querySelectorAll("[data-finance-tab]").forEach(item=>item.classList.toggle("is-active",item===button)); setFinanceFilterOptions(); loadFinance().catch(error=>setNotice(error.message)); }));
byId("finance-apply-filters").addEventListener("click",()=>{financePage=1;loadFinance().catch(error=>setNotice(error.message));});
byId("finance-clear-filters").addEventListener("click",()=>{document.querySelectorAll("#finance-filter-panel input,#finance-filter-panel select").forEach(field=>field.value="");setFinanceFilterOptions();financePage=1;loadFinance().catch(error=>setNotice(error.message));});
byId("finance-previous").addEventListener("click",()=>{if(financePage>1){financePage-=1;loadFinance().catch(error=>setNotice(error.message));}});
byId("finance-next").addEventListener("click",()=>{financePage+=1;loadFinance().catch(error=>setNotice(error.message));});
byId("finance-body").addEventListener("click", async event => { const button=event.target.closest("[data-payment-id]"); if(!button)return; const status=button.dataset.financeStatus; if(status==="ABGELEHNT"){byId("finance-reject-payment-id").value=button.dataset.paymentId;byId("finance-reject-reason").value="";byId("finance-reject-note").hidden=true;byId("finance-reject-dialog").showModal();return;} try { await api(`/api/admin/finance/employee-cash-payments/${button.dataset.paymentId}`,{method:"PATCH",body:JSON.stringify({status,notes:""})}); setNotice("Barzahlung genehmigt.","success"); await loadFinance(); } catch(error){setNotice(error.message);} });
byId("finance-body").addEventListener("click", event => { const payment=event.target.closest("[data-payment-detail]"),transaction=event.target.closest("[data-transaction-detail]"); if(payment)openPaymentDetail(payment.dataset.paymentDetail).catch(error=>setNotice(error.message)); if(transaction)openTransactionDetail(transaction.dataset.transactionDetail).catch(error=>setNotice(error.message)); });
byId("finance-reject-form").addEventListener("submit",async event=>{event.preventDefault();const id=byId("finance-reject-payment-id").value,notes=byId("finance-reject-reason").value.trim(),note=byId("finance-reject-note");if(!notes){note.textContent="Bitte geben Sie einen Ablehnungsgrund ein.";note.hidden=false;return;}try{await api(`/api/admin/finance/employee-cash-payments/${id}`,{method:"PATCH",body:JSON.stringify({status:"ABGELEHNT",notes})});byId("finance-reject-dialog").close();setNotice("Barzahlung abgelehnt.","success");await loadFinance();}catch(error){note.textContent=error.message;note.hidden=false;}});
document.querySelector("[data-close-finance-reject]").addEventListener("click",()=>byId("finance-reject-dialog").close());
byId("create-expense-button").addEventListener("click",()=>{const form=byId("expense-form");form.reset();form.elements.transaction_date.value=new Date().toISOString().slice(0,10);byId("expense-note").hidden=true;byId("expense-dialog").showModal();});
byId("expense-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,note=byId("expense-note"),payload=Object.fromEntries(new FormData(form));payload.transaction_type="EXPENSE";payload.status="ERFASST";try{const result=await api("/api/admin/finance/transactions",{method:"POST",body:JSON.stringify(payload)});byId("expense-dialog").close();setNotice(result.message,"success");financeTab="cashbook";await loadFinance();}catch(error){note.textContent=error.message;note.hidden=false;}});
document.querySelector("[data-close-expense]").addEventListener("click",()=>byId("expense-dialog").close());

byId("service-reports-refresh").addEventListener("click", () => { serviceReportPage = 1; loadServiceReports(); });
byId("service-report-apply").addEventListener("click", () => { serviceReportPage = 1; loadServiceReports(); });
byId("service-report-clear").addEventListener("click", () => { document.querySelectorAll("#service-reports-panel input, #service-reports-panel select").forEach(field => { field.value = ""; }); serviceReportPage = 1; loadServiceReports(); });
byId("service-report-search").addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { serviceReportPage = 1; renderServiceReports(); }, 250); });
byId("service-report-date").addEventListener("change", () => { serviceReportPage = 1; renderServiceReports(); });
byId("service-reports-previous").addEventListener("click", () => { if (serviceReportPage > 1) { serviceReportPage -= 1; renderServiceReports(); } });
byId("service-reports-next").addEventListener("click", () => { serviceReportPage += 1; renderServiceReports(); });
byId("service-reports-body").addEventListener("click", event => { const button = event.target.closest("[data-service-report-detail]"); if (button) openServiceReportDetail(button.dataset.serviceReportDetail).catch(error => setNotice(error.message)); });
byId("service-report-edit-form").addEventListener("submit", async event => { event.preventDefault(); const form = event.currentTarget, note = byId("service-report-edit-note"), id = form.elements.id.value; const payload = Object.fromEntries(new FormData(form)); delete payload.id; try { const result = await api(`/api/admin/service-reports/${id}`, { method: "PATCH", body: JSON.stringify(payload) }); byId("service-report-edit-dialog").close(); await refreshServiceReportAfterAction(id, result.message); } catch (error) { note.textContent = error.message; note.hidden = false; } });
byId("service-report-return-form").addEventListener("submit", async event => { event.preventDefault(); const id = byId("service-report-return-id").value, reason = byId("service-report-return-reason").value.trim(), note = byId("service-report-return-note"); if (!reason) { note.textContent = "Bitte geben Sie einen Rückgabegrund ein."; note.hidden = false; return; } try { const result = await api(`/api/admin/service-reports/${id}/review`, { method: "PATCH", body: JSON.stringify({ status: "RETURNED", reason }) }); byId("service-report-return-dialog").close(); await refreshServiceReportAfterAction(id, result.message); } catch (error) { note.textContent = error.message; note.hidden = false; } });

byId("create-material-button").addEventListener("click", openMaterialCreate);
byId("materials-refresh").addEventListener("click", loadMaterials);
byId("material-apply").addEventListener("click", loadMaterials);
byId("create-receipt-button").addEventListener("click", ()=>openMovement("RECEIPT"));
byId("create-consumption-button").addEventListener("click", ()=>openMovement("CONSUMPTION"));
byId("create-return-button").addEventListener("click", ()=>openMovement("RETURN"));
byId("create-adjustment-button").addEventListener("click", ()=>openMovement("ADJUSTMENT_OUT"));
document.querySelectorAll("[data-material-tab]").forEach(button=>button.addEventListener("click",()=>{materialTab=button.dataset.materialTab;byId("requirement-order-control").hidden=materialTab!=="requirements";document.querySelectorAll("[data-material-tab]").forEach(item=>item.classList.toggle("is-active",item===button));loadMaterials();}));
byId("requirement-order").addEventListener("change",event=>{requirementOrderId=event.target.value;loadMaterialRequirements().catch(error=>materialNotice(error.message));});
byId("create-requirement-button").addEventListener("click",()=>openRequirement());
byId("requirement-material").addEventListener("change",event=>{byId("requirement-unit").value=event.target.selectedOptions[0]?.dataset.unit||"";});
byId("materials-body").addEventListener("click",event=>{const edit=event.target.closest("[data-material-edit]"),detail=event.target.closest("[data-movement-detail]"),movement=event.target.closest("[data-movement-id]"),reqEdit=event.target.closest("[data-requirement-edit]"),reqDelete=event.target.closest("[data-requirement-delete]");if(edit)openMaterial(edit.dataset.materialEdit).catch(error=>materialNotice(error.message));if(detail)openMovementDetail(detail.dataset.movementDetail).catch(error=>materialNotice(error.message));if(movement){const status=movement.dataset.movementStatus;const reason=status==="CANCELLED"?window.prompt("Warum wird diese Lagerbewegung storniert?"):"";if(status==="CANCELLED"&&!reason?.trim())return materialNotice("Ein Stornierungsgrund ist erforderlich.");api(`/api/admin/material-stock-movements/${movement.dataset.movementId}`,{method:"PATCH",body:JSON.stringify({status,notes:reason||undefined})}).then(()=>loadMaterials()).catch(error=>materialNotice(error.message));}if(reqEdit){api(`/api/admin/orders/${requirementOrderId}/material-requirements`).then(result=>openRequirement(result.rows.find(row=>Number(row.id)===Number(reqEdit.dataset.requirementEdit)))).catch(error=>materialNotice(error.message));}if(reqDelete&&window.confirm("Möchten Sie diesen Materialbedarf wirklich löschen?")){api(`/api/admin/orders/${requirementOrderId}/material-requirements/${reqDelete.dataset.requirementDelete}`,{method:"DELETE"}).then(result=>{setNotice(result.message,"success");loadMaterialRequirements();}).catch(error=>materialNotice(error.message));}});
byId("material-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,note=byId("material-form-note"),id=form.elements.id.value,payload=Object.fromEntries(new FormData(form));delete payload.id;try{const result=await api(`/api/admin/materials${id?`/${id}`:""}`,{method:id?"PATCH":"POST",body:JSON.stringify(payload)});byId("material-dialog").close();setNotice(result.message,"success");await loadMaterials();}catch(error){note.textContent=error.message;note.hidden=false;}});
byId("movement-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,note=byId("movement-form-note"),payload=Object.fromEntries(new FormData(form));["order_id","employee_id","service_report_id","unit_cost"].forEach(key=>{if(!payload[key])delete payload[key];});if(["ADJUSTMENT_IN","ADJUSTMENT_OUT"].includes(payload.movement_type)&&!String(payload.reference||"").trim()){note.textContent="Für eine Bestandskorrektur ist ein Grund erforderlich.";note.hidden=false;return;}try{const result=await api("/api/admin/material-stock-movements",{method:"POST",body:JSON.stringify(payload)});byId("movement-dialog").close();setNotice(result.message,"success");materialTab="movements";await loadMaterials();}catch(error){note.textContent=error.message;note.hidden=false;}});
byId("movement-form").addEventListener("input",event=>{if(!["quantity","unit_cost"].includes(event.target.name))return;const form=event.currentTarget,quantity=Number(form.elements.quantity.value||0),cost=Number(form.elements.unit_cost.value||0),preview=byId("movement-cost-preview");if(quantity>0&&cost>=0){preview.textContent=`Gesamtkosten: ${(quantity*cost).toFixed(2)} €`;preview.hidden=false;}else preview.hidden=true;});
byId("requirement-form").addEventListener("submit",async event=>{event.preventDefault();if(!requirementOrderId)return materialNotice("Bitte wählen Sie zuerst einen Auftrag aus.");const form=event.currentTarget,note=byId("requirement-form-note"),id=form.elements.id.value,payload=Object.fromEntries(new FormData(form));payload.unit=byId("requirement-unit").value;delete payload.id;try{const result=await api(`/api/admin/orders/${requirementOrderId}/material-requirements${id?`/${id}`:""}`,{method:id?"PATCH":"POST",body:JSON.stringify(payload)});byId("requirement-dialog").close();setNotice(result.message,"success");await loadMaterialRequirements();}catch(error){note.textContent=error.message;note.hidden=false;}});
document.querySelector("[data-close-service-report-edit]").addEventListener("click", () => byId("service-report-edit-dialog").close());
document.querySelector("[data-close-service-report-return]").addEventListener("click", () => byId("service-report-return-dialog").close());

updateViewHeading();
initialize();
