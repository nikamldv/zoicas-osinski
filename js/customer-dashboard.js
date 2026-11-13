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
        const accept = type === "quote" && document.status === "GESENDET" ? `<button type="button" class="button button-primary" data-accept-quote="${document.id}">Angebot annehmen</button>` : "";
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
        if (view === "invoices") return renderInvoices();
        if (view === "quotes") return renderCommercial("quote");
        if (view === "contracts") return renderCommercial("contract");
        if (view === "profile") {
            const result = await api("/api/customer/profile");
            title.textContent = "Mein Profil";
            description.textContent = "Ihre E-Mail-Adresse und Kundennummer bleiben aus Sicherheitsgründen unverändert.";
            data.innerHTML = `<form id="profile-form" class="portal-profile"><label>Kundennummer<input value="${escapeHtml(result.customer.customer_number)}" readonly></label><label>Vorname<input name="first_name" value="${escapeHtml(result.customer.first_name)}" required></label><label>Nachname<input name="last_name" value="${escapeHtml(result.customer.last_name)}" required></label><label>Telefon<input name="phone" value="${escapeHtml(result.customer.phone)}" required></label><label>Adresse<input name="address" value="${escapeHtml(result.customer.address)}"></label><label>PLZ<input name="postal_code" value="${escapeHtml(result.customer.postal_code)}"></label><label>Ort<input name="city" value="${escapeHtml(result.customer.city)}"></label><button class="button button-primary">Profil speichern</button></form>`;
            $("#profile-form").onsubmit = async event => { event.preventDefault(); await api("/api/customer/profile", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); description.textContent = "Profil gespeichert."; };
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
        const accept = event.target.closest("[data-accept-quote]");
        if (accept) api(`/api/customer/quotes/${accept.dataset.acceptQuote}/accept`, { method: "POST", body: "{}" }).then(() => renderCommercial("quote", accept.dataset.acceptQuote)).catch(error => { description.textContent = error.message; });
    });
    $("#customer-logout").onclick = async () => { try { await api("/api/customer/logout", { method: "POST", body: "{}" }); } finally { location.href = "kundenportal.html"; } };
    api("/api/customer/session").then(result => { customer = result.customer; $("#portal-name").textContent = `${customer.first_name} ${customer.last_name}`; load("home"); }).catch(() => location.replace("kundenportal.html"));
});
