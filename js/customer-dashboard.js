"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const $ = selector => document.querySelector(selector);
    const data = $("#portal-data"), title = $("#portal-title"), description = $("#portal-description");
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    let customer = null;

    async function api(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (options.body) headers.set("Content-Type", "application/json");
        const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Nicht verfügbar.");
        return result;
    }

    function orderCard(order) {
        return `<article class="portal-order-card"><strong>${escapeHtml(order.order_number)} · ${escapeHtml(order.service_type)}</strong><p>${escapeHtml(order.title)}</p><small>${escapeHtml(order.preferred_date || "Termin wird abgestimmt")} · ${escapeHtml(order.status)}</small><button type="button" class="button button-light" data-order-id="${order.id}">Details ansehen</button></article>`;
    }

    function commercialCard(document, type) {
        const number = type === "quote" ? document.quote_number : document.contract_number;
        const button = type === "quote" ? "data-quote-id" : "data-contract-id";
        return `<article class="portal-order-card"><strong>${escapeHtml(number)} · ${escapeHtml(document.service_type)}</strong><p>${escapeHtml(document.status)} · ${escapeHtml(document.valid_until || document.start_date || "—")}</p><small>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(document.gross_amount || 0)))}</small><button type="button" class="button button-light" ${button}="${document.id}">Details ansehen</button></article>`;
    }

    async function renderCommercial(type, id = null) {
        const plural = type === "quote" ? "quotes" : "contracts", singular = type === "quote" ? "quote" : "contract";
        const result = await api(`/api/customer/${plural}${id ? `/${id}` : ""}`);
        title.textContent = id ? (type === "quote" ? "Angebotsdetails" : "Vertragsdetails") : (type === "quote" ? "Meine Angebote" : "Meine Verträge");
        if (!id) { description.textContent = result.rows.length ? "Ihre sicher verknüpften Unterlagen." : "Noch keine Einträge verfügbar."; data.innerHTML = result.rows.map(row => commercialCard(row, type)).join("") || "<article>Keine Einträge vorhanden.</article>"; return; }
        const document = result[singular], lines = type === "quote" ? `<ul>${(result.items || []).map(item => `<li><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</li>`).join("")}</ul>` : "";
        const accept = type === "quote" && document.status === "GESENDET" ? `<div class="portal-action-row"><button type="button" class="button button-primary" data-accept-quote="${document.id}">Angebot annehmen</button><button type="button" class="button button-light" data-reject-quote="${document.id}">Angebot ablehnen</button></div>` : "";
        description.textContent = "Ihre Daten im Überblick.";
        const nextService = type === "contract" && document.next_service_at ? `<div><dt>Nächster Einsatz</dt><dd>${escapeHtml(String(document.next_service_at).replace("T", " ").slice(0, 16))} · ${escapeHtml(document.next_service_status || "GEPLANT")}</dd></div>` : "";
        data.innerHTML = `<article class="portal-order-detail"><strong>${escapeHtml(document.quote_number || document.contract_number)}</strong><p>${escapeHtml(document.service_description || document.service_type)}</p>${lines}<dl><div><dt>Netto</dt><dd>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(document.net_amount || 0)))}</dd></div><div><dt>MwSt.</dt><dd>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(document.tax_amount || 0)))}</dd></div><div><dt>Brutto</dt><dd>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(document.gross_amount || 0)))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(document.status)}</dd></div>${nextService}</dl>${accept}<button type="button" class="button button-light" data-back-commercial="${type}">Zurück</button></article>`;
    }

    async function renderOrders(id = null) {
        const result = await api(`/api/customer/orders${id ? `/${id}` : ""}`);
        title.textContent = id ? "Auftragsdetails" : "Meine Aufträge";
        if (id) {
            const order = result.order;
            description.textContent = "Ihre Auftragsdaten im Überblick.";
            data.innerHTML = `<article class="portal-order-detail"><strong>${escapeHtml(order.order_number)}</strong><dl><div><dt>Leistung</dt><dd>${escapeHtml(order.service_type)}</dd></div><div><dt>Status</dt><dd>${escapeHtml(order.status)}</dd></div><div><dt>Termin</dt><dd>${escapeHtml(order.preferred_date || "Wird abgestimmt")}</dd></div><div><dt>Adresse</dt><dd>${escapeHtml([order.address, order.postal_code, order.city].filter(Boolean).join(", ") || "—")}</dd></div></dl><p>${escapeHtml(order.description || "Keine zusätzliche Beschreibung.")}</p><button type="button" class="button button-light" data-back-orders>Zurück zu meinen Aufträgen</button></article>`;
        } else {
            const rows = result.rows || [];
            description.textContent = rows.length ? "Ihre bestätigten und geplanten Aufträge." : "Noch keine Aufträge mit Ihrem Kundenkonto verknüpft.";
            data.innerHTML = rows.map(orderCard).join("") || "<article>Keine Aufträge vorhanden.</article>";
        }
    }

    async function renderInvoices(id = null) {
        const result = await api(`/api/customer/invoices${id ? `/${id}` : ""}`);
        title.textContent = id ? "Rechnungsdetails" : "Meine Rechnungen";
        if (!id) {
            const rows = result.rows || [];
            description.textContent = rows.length ? "Ihre sicher verknüpften Rechnungen." : "Noch keine Rechnungen verfügbar.";
            data.innerHTML = rows.map(invoice => `<article class="portal-order-card"><strong>${escapeHtml(invoice.invoice_number)}</strong><p>${escapeHtml(invoice.status)} · ${escapeHtml(invoice.invoice_date)}</p><small>Brutto: ${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(invoice.gross_amount || 0)))} · Offen: ${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(invoice.outstanding_amount || 0)))}</small><button type="button" class="button button-light" data-invoice-id="${invoice.id}">Details ansehen</button></article>`).join("") || "<article>Keine Einträge vorhanden.</article>";
            return;
        }
        const invoice = result.invoice;
        description.textContent = "Ihre Rechnungsdaten im Überblick.";
        data.innerHTML = `<article class="portal-order-detail"><strong>${escapeHtml(invoice.invoice_number)}</strong><dl><div><dt>Status</dt><dd>${escapeHtml(invoice.status)}</dd></div><div><dt>Rechnungsdatum</dt><dd>${escapeHtml(invoice.invoice_date)}</dd></div><div><dt>Leistungszeitraum</dt><dd>${escapeHtml([invoice.service_period_from, invoice.service_period_to].filter(Boolean).join(" – ") || "—")}</dd></div><div><dt>Zahlungsziel</dt><dd>${escapeHtml(invoice.due_date)}</dd></div><div><dt>Netto</dt><dd>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(invoice.net_amount || 0)))}</dd></div><div><dt>MwSt.</dt><dd>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(invoice.tax_amount || 0)))}</dd></div><div><dt>Brutto</dt><dd>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(invoice.gross_amount || 0)))}</dd></div><div><dt>Bezahlt / Offen</dt><dd>${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(invoice.paid_amount || 0)))} / ${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(invoice.outstanding_amount || 0)))}</dd></div></dl><ul>${(result.items || []).map(item => `<li><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)} · ${escapeHtml(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(item.gross_amount || 0)))}</li>`).join("")}</ul><button type="button" class="button button-light" data-back-invoices>Zurück zu meinen Rechnungen</button></article>`;
        const download = document.createElement("a");
        download.className = "button button-primary";
        download.href = `/api/customer/invoices/${Number(invoice.id)}/pdf`;
        download.textContent = "Rechnung herunterladen";
        data.querySelector(".portal-order-detail")?.append(download);
    }

    const serviceReportStatus = status => ({ SHARED: "Freigegeben", CUSTOMER_CONFIRMED: "Bestätigt" }[status] || status || "—");
    const germanDateTime = value => {
        if (!value) return "—";
        const date = new Date(String(value).replace(" ", "T"));
        return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
    };
    let confirmingServiceReportId = null;

    function serviceReportCard(report) {
        const confirmed = report.status === "CUSTOMER_CONFIRMED";
        return `<article class="portal-order-card"><strong>${escapeHtml(report.report_number)}</strong><p>${escapeHtml(report.order_number)} · ${escapeHtml(report.order_title || "Leistung")}</p><small>${escapeHtml(germanDateTime(report.service_date))} · ${escapeHtml(serviceReportStatus(report.status))}${confirmed ? " · von Ihnen bestätigt" : ""}</small><button type="button" class="button button-light" data-service-report-id="${Number(report.id)}">Details ansehen</button></article>`;
    }

    async function renderServiceReports(id = null) {
        const result = await api(`/api/customer/service-reports${id ? `/${id}` : ""}`);
        title.textContent = id ? "Leistungsnachweis" : "Meine Leistungsnachweise";
        if (!id) {
            const rows = result.rows || [];
            description.textContent = rows.length ? "Hier sehen Sie ausschließlich die für Sie freigegebenen Leistungsnachweise." : "Aktuell wurden Ihnen keine Leistungsnachweise bereitgestellt.";
            data.innerHTML = rows.map(serviceReportCard).join("") || "<article><strong>Keine Leistungsnachweise vorhanden.</strong><p>Freigegebene Nachweise erscheinen hier automatisch.</p></article>";
            return;
        }
        const report = result.report;
        const canConfirm = report.status === "SHARED";
        description.textContent = canConfirm ? "Bitte prüfen Sie die Angaben. Die Bestätigung dokumentiert lediglich Ihre Kenntnisnahme." : "Dieser Leistungsnachweis wurde bereits bestätigt.";
        data.innerHTML = `<article class="portal-order-detail"><strong>${escapeHtml(report.report_number)}</strong><p>${escapeHtml(report.order_number)} · ${escapeHtml(report.order_title || "Leistung")}</p><dl><div><dt>Leistungstag</dt><dd>${escapeHtml(germanDateTime(report.service_date))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(serviceReportStatus(report.status))}</dd></div><div><dt>Beginn</dt><dd>${escapeHtml(germanDateTime(report.started_at))}</dd></div><div><dt>Ende</dt><dd>${escapeHtml(germanDateTime(report.finished_at))}</dd></div><div><dt>Freigegeben</dt><dd>${escapeHtml(germanDateTime(report.shared_with_customer_at))}</dd></div><div><dt>Bestätigt</dt><dd>${escapeHtml(germanDateTime(report.customer_confirmed_at))}</dd></div></dl><h2>Durchgeführte Leistung</h2><p>${escapeHtml(report.summary || "Keine Beschreibung hinterlegt.")}</p>${report.customer_notes ? `<h2>Hinweis für Sie</h2><p>${escapeHtml(report.customer_notes)}</p>` : ""}${canConfirm ? `<button type="button" class="button button-primary" data-confirm-service-report="${Number(report.id)}">Leistungsnachweis bestätigen</button>` : ""}<button type="button" class="button button-light" data-back-service-reports>Zurück zu Leistungsnachweisen</button></article>`;
    }

    async function confirmServiceReport(id) {
        if (confirmingServiceReportId) return;
        if (!window.confirm("Möchten Sie diesen Leistungsnachweis bestätigen? Diese Aktion kann nicht rückgängig gemacht werden.")) return;
        confirmingServiceReportId = id;
        const button = data.querySelector("[data-confirm-service-report]");
        if (button) { button.disabled = true; button.textContent = "Bestätigung wird gespeichert …"; }
        try {
            const result = await api(`/api/customer/service-reports/${id}/confirm`, { method: "POST", body: "{}" });
            description.textContent = result.message || "Leistungsnachweis bestätigt.";
            await renderServiceReports(id);
        } catch (error) {
            description.textContent = error.message || "Die Bestätigung konnte nicht gespeichert werden.";
        } finally {
            confirmingServiceReportId = null;
        }
    }

    async function load(view) {
        document.querySelectorAll("[data-portal-view]").forEach(button => button.classList.toggle("is-active", button.dataset.portalView === view));
        if (view === "home") {
            title.textContent = "Willkommen zurück";
            description.textContent = customer?.customer_number ? `Ihre Kundennummer: ${customer.customer_number}` : "Ihre verknüpften Informationen sehen Sie hier.";
            data.innerHTML = "<article><strong>Meine Termine</strong><p>Ihre verknüpften Termine stehen unter Termine.</p></article><article><strong>Meine Angebote</strong><p>Ihre verknüpften Angebote stehen unter Angebote.</p></article><article><strong>Meine Aufträge</strong><p>Ihre geplanten Leistungen stehen unter Meine Aufträge.</p></article>";
            return;
        }
        if (view === "orders") return renderOrders();
        if (view === "service-reports") return renderServiceReports();
        if (view === "invoices") return renderInvoices();
        if (view === "documents") { const result=await api("/api/customer/documents"); title.textContent="Meine Dokumente"; description.textContent="Ihre sicher bereitgestellten Unterlagen."; data.innerHTML=result.rows.map(row=>`<article class="portal-order-card"><strong>${escapeHtml(row.document_type)}</strong><p>${escapeHtml(row.file_name)}</p><small>${escapeHtml(row.created_at)}</small><a class="button button-light" href="/api/customer/documents/${row.id}">Download</a></article>`).join("")||"<article>Keine Dokumente vorhanden.</article>";return; }
        if (view === "messages") { const result=await api("/api/customer/messages"); title.textContent="Nachrichten"; description.textContent="Sicherer Austausch mit Ihrer Verwaltung."; data.innerHTML=`<form id="message-form" class="portal-profile"><label>Betreff<input name="subject" maxlength="180" required></label><label>Nachricht<textarea name="message" maxlength="8000" required></textarea></label><button class="button button-primary">Nachricht senden</button></form>${result.rows.map(row=>`<article class="portal-order-card"><strong>${escapeHtml(row.subject)}</strong><p>${escapeHtml(row.message)}</p><small>${escapeHtml(row.sender_type)} · ${escapeHtml(row.created_at)} · ${row.read_at?"gelesen":"neu"}</small>${!row.read_at?` <button type="button" class="button button-light" data-message-read="${row.id}">Als gelesen markieren</button>`:""}</article>`).join("")}`; $("#message-form").onsubmit=async e=>{e.preventDefault();await api("/api/customer/messages",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});load("messages")}; data.querySelectorAll("[data-message-read]").forEach(button=>button.onclick=async()=>{await api(`/api/customer/messages/${button.dataset.messageRead}/read`,{method:"PATCH",body:"{}"});load("messages")});return; }
        if (view === "notifications") { const result=await api("/api/customer/notifications"); title.textContent="Benachrichtigungen"; description.textContent="Ihre aktuellen Informationen."; data.innerHTML=result.rows.map(row=>`<article class="portal-order-card"><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.body||"")}</p><small>${escapeHtml(row.created_at)} ${row.read_at?"· gelesen":"· neu"} ${row.entity_type?`· ${escapeHtml(row.entity_type)} #${escapeHtml(row.entity_id)}`:""}</small>${!row.read_at?` <button type="button" class="button button-light" data-notification-read="${row.id}">Als gelesen markieren</button>`:""}</article>`).join("")||"<article>Keine Benachrichtigungen vorhanden.</article>";data.querySelectorAll("[data-notification-read]").forEach(button=>button.onclick=async()=>{await api(`/api/customer/notifications/${button.dataset.notificationRead}/read`,{method:"PATCH",body:"{}"});load("notifications")});return; }
        if (view === "quotes") return renderCommercial("quote");
        if (view === "contracts") return renderCommercial("contract");
        if (view === "profile") {
            const result = await api("/api/customer/profile");
            title.textContent = "Mein Profil";
            description.textContent = "Ihre E-Mail-Adresse und Kundennummer bleiben aus Sicherheitsgründen unverändert.";
            data.innerHTML = `<form id="profile-form" class="portal-profile"><label>Kundennummer<input value="${escapeHtml(result.customer.customer_number)}" readonly></label><label>Vorname<input name="first_name" value="${escapeHtml(result.customer.first_name)}" required></label><label>Nachname<input name="last_name" value="${escapeHtml(result.customer.last_name)}" required></label><label>Telefon<input name="phone" value="${escapeHtml(result.customer.phone)}" required></label><label>Adresse<input name="address" value="${escapeHtml(result.customer.address)}"></label><label>PLZ<input name="postal_code" value="${escapeHtml(result.customer.postal_code)}"></label><label>Ort<input name="city" value="${escapeHtml(result.customer.city)}"></label><button class="button button-primary">Profil speichern</button></form>`;
            const passwordSection = document.createElement("section");
            passwordSection.className = "portal-password-section";
            passwordSection.innerHTML = `<h2>Passwort ändern</h2><form id="customer-password-form" class="portal-profile"><label>Aktuelles Passwort<input name="current_password" type="password" autocomplete="current-password" required></label><label>Neues Passwort<input name="new_password" type="password" autocomplete="new-password" minlength="12" required></label><label>Passwort wiederholen<input name="password_confirmation" type="password" autocomplete="new-password" minlength="12" required></label><p class="form-note" role="status" aria-live="polite"></p><button class="button button-primary" type="submit">Passwort ändern</button></form>`;
            data.append(passwordSection);
            $("#profile-form").onsubmit = async event => { event.preventDefault(); await api("/api/customer/profile", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); description.textContent = "Profil gespeichert."; };
            $("#customer-password-form").onsubmit = async event => { event.preventDefault(); const form=event.currentTarget, note=form.querySelector(".form-note"), values=Object.fromEntries(new FormData(form)); note.textContent=""; if(values.new_password !== values.password_confirmation){note.textContent="Die neuen Passwörter stimmen nicht überein.";return;} try { const result=await api("/api/customer/change-password",{method:"POST",body:JSON.stringify(values)}); form.reset(); description.textContent=result.message; } catch(error) { note.textContent=error.message; } };
            return;
        }
        const type = view === "appointments" ? "appointments" : "quotes";
        const result = await api(`/api/customer/${type}`);
        title.textContent = view === "appointments" ? "Meine Termine" : "Meine Angebote";
        description.textContent = result.rows.length ? "Ihre sicher verknüpften Einträge." : "Noch keine Einträge mit Ihrem Kundenkonto verknüpft.";
        data.innerHTML = result.rows.map(row => `<article><strong>${escapeHtml(row.service || row.requested_service)}</strong><p>${escapeHtml(row.preferred_date || row.created_at)} · ${escapeHtml(row.status)}</p></article>`).join("") || "<article>Keine Einträge vorhanden.</article>";
    }

    const quotesButton = document.querySelector('[data-portal-view="quotes"]');
    if (quotesButton && !document.querySelector('[data-portal-view="contracts"]')) {
        quotesButton.insertAdjacentHTML("afterend", '<button data-portal-view="contracts">Verträge</button>');
    }
    document.querySelectorAll("[data-portal-view]").forEach(button => button.addEventListener("click", () => load(button.dataset.portalView).catch(error => { description.textContent = error.message; })));
    data.addEventListener("click", event => {
        const order = event.target.closest("[data-order-id]");
        if (order) renderOrders(order.dataset.orderId).catch(error => { description.textContent = error.message; });
        if (event.target.closest("[data-back-orders]")) renderOrders().catch(error => { description.textContent = error.message; });
        const quote = event.target.closest("[data-quote-id]");
        if (quote) renderCommercial("quote", quote.dataset.quoteId).catch(error => { description.textContent = error.message; });
        const contract = event.target.closest("[data-contract-id]");
        if (contract) renderCommercial("contract", contract.dataset.contractId).catch(error => { description.textContent = error.message; });
        const back = event.target.closest("[data-back-commercial]");
        if (back) renderCommercial(back.dataset.backCommercial).catch(error => { description.textContent = error.message; });
        const invoice = event.target.closest("[data-invoice-id]");
        if (invoice) renderInvoices(invoice.dataset.invoiceId).catch(error => { description.textContent = error.message; });
        if (event.target.closest("[data-back-invoices]")) renderInvoices().catch(error => { description.textContent = error.message; });
        const serviceReport = event.target.closest("[data-service-report-id]");
        if (serviceReport) renderServiceReports(serviceReport.dataset.serviceReportId).catch(error => { description.textContent = error.message; });
        if (event.target.closest("[data-back-service-reports]")) renderServiceReports().catch(error => { description.textContent = error.message; });
        const confirmServiceReportButton = event.target.closest("[data-confirm-service-report]");
        if (confirmServiceReportButton) confirmServiceReport(confirmServiceReportButton.dataset.confirmServiceReport);
        const accept = event.target.closest("[data-accept-quote]");
        if (accept) api(`/api/customer/quotes/${accept.dataset.acceptQuote}/accept`, { method: "POST", body: "{}" }).then(() => renderCommercial("quote", accept.dataset.acceptQuote)).catch(error => { description.textContent = error.message; });
        const reject = event.target.closest("[data-reject-quote]");
        if (reject) {
            if (!window.confirm("Möchten Sie dieses Angebot wirklich ablehnen?")) return;
            const reason = window.prompt("Grund der Ablehnung (optional):", "");
            if (reason === null) return;
            reject.disabled = true;
            api(`/api/customer/quotes/${reject.dataset.rejectQuote}/reject`, { method:"POST", body:JSON.stringify({ reason }) }).then(result => { description.textContent=result.message; return renderCommercial("quote",reject.dataset.rejectQuote); }).catch(error => { description.textContent=error.message; reject.disabled=false; });
        }
    });
    $("#customer-logout").onclick = async () => { try { await api("/api/customer/logout", { method: "POST", body: "{}" }); } finally { location.href = "kundenportal.html"; } };
    api("/api/customer/session").then(result => { customer = result.customer; $("#portal-name").textContent = `${customer.first_name} ${customer.last_name}`; load("home"); }).catch(() => location.replace("kundenportal.html"));
});
