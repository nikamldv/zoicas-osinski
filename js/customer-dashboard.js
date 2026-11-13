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

    async function load(view) {
        document.querySelectorAll("[data-portal-view]").forEach(button => button.classList.toggle("is-active", button.dataset.portalView === view));
        if (view === "home") {
            title.textContent = "Willkommen zurück";
            description.textContent = customer?.customer_number ? `Ihre Kundennummer: ${customer.customer_number}` : "Ihre verknüpften Informationen sehen Sie hier.";
            data.innerHTML = "<article><strong>Meine Termine</strong><p>Ihre verknüpften Termine stehen unter Termine.</p></article><article><strong>Meine Angebote</strong><p>Ihre verknüpften Angebote stehen unter Angebote.</p></article><article><strong>Meine Aufträge</strong><p>Ihre geplanten Leistungen stehen unter Meine Aufträge.</p></article>";
            return;
        }
        if (view === "orders") return renderOrders();
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

    document.querySelectorAll("[data-portal-view]").forEach(button => button.addEventListener("click", () => load(button.dataset.portalView).catch(error => { description.textContent = error.message; })));
    data.addEventListener("click", event => {
        const order = event.target.closest("[data-order-id]");
        if (order) renderOrders(order.dataset.orderId).catch(error => { description.textContent = error.message; });
        if (event.target.closest("[data-back-orders]")) renderOrders().catch(error => { description.textContent = error.message; });
    });
    $("#customer-logout").onclick = async () => { try { await api("/api/customer/logout", { method: "POST", body: "{}" }); } finally { location.href = "kundenportal.html"; } };
    api("/api/customer/session").then(result => { customer = result.customer; $("#portal-name").textContent = `${customer.first_name} ${customer.last_name}`; load("home"); }).catch(() => location.replace("kundenportal.html"));
});
