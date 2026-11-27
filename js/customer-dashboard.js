"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const $ = selector => document.querySelector(selector);
    const data = $("#portal-data"), title = $("#portal-title"), description = $("#portal-description");
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    let customer = null;
    const pendingQuotes=new Set();

    async function api(url, options = {}) {
        const readVersion=pageVersion;
        const headers = new Headers(options.headers || {});
        if (options.body) headers.set("Content-Type", "application/json");
        const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (response.status===401) location.replace("kunden-anmelden.html");
        if ((!options.method || options.method==="GET") && readVersion!==pageVersion) throw new DOMException("Ansicht gewechselt","AbortError");
        if (!response.ok) throw new Error(result.message || "Nicht verfügbar.");
        return result;
    }

    function orderCard(order) {
        return `<article class="portal-order-card"><strong>${escapeHtml(order.order_number)} · ${escapeHtml(order.service_type)}</strong><p>${escapeHtml(order.title)}</p><small>${escapeHtml(order.preferred_date || "Termin wird abgestimmt")} · ${escapeHtml(order.status)}</small><button type="button" class="button button-light" data-order-id="${order.id}">Details ansehen</button></article>`;
    }

    function commercialCard(document, type) {
        const number = type === "quote" ? document.quote_number : document.contract_number;
        const button = type === "quote" ? "data-quote-id" : "data-contract-id";
        return `<article class="portal-order-card"><strong>${escapeHtml(number)} · ${escapeHtml(document.service_type)}</strong><p>${escapeHtml(document.status)} · ${escapeHtml(document.valid_until || document.start_date || "—")}</p><small>${escapeHtml(money(document.gross_amount))}</small><button type="button" class="button button-light" ${button}="${document.id}">Details ansehen</button></article>`;
    }

    async function renderCommercial(type, id = null) {
        const plural = type === "quote" ? "quotes" : "contracts", singular = type === "quote" ? "quote" : "contract";
        const result = await api(`/api/customer/${plural}${id ? `/${id}` : ""}`);
        title.textContent = id ? (type === "quote" ? "Angebotsdetails" : "Vertragsdetails") : (type === "quote" ? "Meine Angebote" : "Meine Verträge");
        if (!id) { description.textContent = result.rows.length ? "Ihre sicher verknüpften Unterlagen." : "Noch keine Einträge verfügbar."; data.innerHTML = result.rows.map(row => commercialCard(row, type)).join("") || "<article>Keine Einträge vorhanden.</article>"; return; }
        const document = result[singular], lines = type === "quote" ? `<ul>${(result.items || []).map(item => `<li><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</li>`).join("")}</ul>` : "";
        const accept = type === "quote" && document.status === "GESENDET" ? `<div class="portal-action-row"><button type="button" class="button button-primary" data-accept-quote="${document.id}">Angebot annehmen</button><button type="button" class="button button-light" data-reject-quote="${document.id}">Angebot ablehnen</button></div>` : "";
        description.textContent = "Ihre Daten im Überblick.";
        const contractDates = type === "contract" ? `<div><dt>Vertragsbeginn</dt><dd>${escapeHtml(document.start_date || "—")}</dd></div><div><dt>Vertragliches Enddatum</dt><dd>${escapeHtml(document.end_date || "—")}</dd></div>${document.termination_date ? `<div><dt>Wirksames Vertragsende</dt><dd>${escapeHtml(document.termination_date)}</dd></div>` : ""}` : "";
        const nextService = type === "contract" && document.next_service_at ? `<div><dt>Nächster Einsatz</dt><dd>${escapeHtml(String(document.next_service_at).replace("T", " ").slice(0, 16))} · ${escapeHtml(document.next_service_status || "GEPLANT")}</dd></div>` : "";
        data.innerHTML = `<article class="portal-order-detail"><strong>${escapeHtml(document.quote_number || document.contract_number)}</strong><p>${escapeHtml(document.service_description || document.service_type)}</p>${lines}<dl><div><dt>Netto</dt><dd>${escapeHtml(money(document.net_amount))}</dd></div><div><dt>MwSt.</dt><dd>${escapeHtml(money(document.tax_amount))}</dd></div><div><dt>Brutto</dt><dd>${escapeHtml(money(document.gross_amount))}</dd></div><div><dt>Status</dt><dd>${escapeHtml(document.status)}</dd></div>${contractDates}${nextService}</dl>${accept}<button type="button" class="button button-light" data-back-commercial="${type}">Zurück</button></article>`;
    }

    async function renderOrders(id = null) {
        const result = await api(`/api/customer/orders${id ? `/${id}` : ""}`);
        title.textContent = id ? "Auftragsdetails" : "Meine Leistungen";
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
            data.innerHTML = rows.map(invoice => `<article class="portal-order-card"><strong>${escapeHtml(invoice.invoice_number)}</strong><p>${escapeHtml(invoice.status)} · ${escapeHtml(dateLabel(invoice.invoice_date))}</p><small>Brutto: ${escapeHtml(money(invoice.gross_amount))} · Offen: ${escapeHtml(money(invoice.outstanding_amount))}</small><button type="button" class="button button-light" data-invoice-id="${invoice.id}">Details ansehen</button></article>`).join("") || "<article>Keine Einträge vorhanden.</article>";
            return;
        }
        const invoice = result.invoice;
        description.textContent = "Ihre Rechnungsdaten im Überblick.";
        data.innerHTML = `<article class="portal-order-detail"><strong>${escapeHtml(invoice.invoice_number)}</strong><dl><div><dt>Status</dt><dd>${escapeHtml(invoice.status)}</dd></div><div><dt>Rechnungsdatum</dt><dd>${escapeHtml(dateLabel(invoice.invoice_date))}</dd></div><div><dt>Leistungszeitraum</dt><dd>${escapeHtml([invoice.service_period_from, invoice.service_period_to].filter(Boolean).join(" – ") || "—")}</dd></div><div><dt>Zahlungsziel</dt><dd>${escapeHtml(dateLabel(invoice.due_date))}</dd></div><div><dt>Netto</dt><dd>${escapeHtml(money(invoice.net_amount))}</dd></div><div><dt>MwSt.</dt><dd>${escapeHtml(money(invoice.tax_amount))}</dd></div><div><dt>Brutto</dt><dd>${escapeHtml(money(invoice.gross_amount))}</dd></div><div><dt>Zahlungseingänge</dt><dd>${escapeHtml(money(invoice.paid_amount))}</dd></div><div><dt>Offener Betrag</dt><dd>${escapeHtml(money(invoice.outstanding_amount))}</dd></div></dl><ul>${(result.items || []).map(item => `<li><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.quantity)} ${escapeHtml(item.unit)} · ${escapeHtml(money(item.gross_amount))}</li>`).join("")}</ul><button type="button" class="button button-light" data-back-invoices>Zurück zu meinen Rechnungen</button></article>`;
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
        return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone:"Europe/Berlin" }).format(date);
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


    const intakeLabels = {
        new:"Neu",in_progress:"In Bearbeitung",offer_sent:"Angebot verfügbar",accepted:"Angenommen",declined:"Abgelehnt",completed:"Abgeschlossen",
        RECEIVED:"Eingegangen",IN_REVIEW:"In Prüfung",RESOLVED:"Gelöst",CLOSED:"Abgeschlossen"
    };
    let intakeVersion=0;
    const intakePath = view => "/api/customer/"+view;
    async function renderIntake(view,page=1) {
        const version=++intakeVersion, service=view==="service-requests";
        title.textContent=service?"Serviceanfragen":"Beschwerden";
        description.textContent="Einträge werden geladen …";
        data.replaceChildren();
        const [result,orders]=await Promise.all([api(intakePath(view)+"?page="+page),service?null:api("/api/customer/orders")]);
        if (version!==intakeVersion) return;
        const fields=service
            ? '<label>Leistung<select name="service" required></select></label><label>Wunschtermin<input type="date" name="preferred_date" required></label>'
            : '<label>Auftrag (optional)<select name="order_id"><option value="">Ohne Auftrag</option></select></label>';
        data.innerHTML='<form class="portal-profile customer-intake-form" id="customer-intake-form">'+fields+
            '<label>Beschreibung<textarea name="description" rows="4" maxlength="4000" required></textarea></label><button class="button button-primary" type="submit">Absenden</button></form>'+
            '<div id="customer-intake-list"></div><div class="portal-action-row"><button type="button" class="button button-light" id="customer-intake-prev">Zurück</button><button type="button" class="button button-light" id="customer-intake-next">Weiter</button></div>';
        const form=$("#customer-intake-form"), list=$("#customer-intake-list");
        if (service) {
            for (const entry of result.services) form.elements.service.add(new Option(entry,entry));
        } else {
            for (const order of orders.rows) form.elements.order_id.add(new Option(order.order_number+" · "+order.title,order.id));
        }
        function draw(rows) {
            list.replaceChildren();
            if (!rows.length) list.textContent="Noch keine Einträge.";
            for (const row of rows) {
                const item=document.createElement("article"), heading=document.createElement("strong"), text=document.createElement("p"), button=document.createElement("button");
                item.className="portal-order-card";
                heading.textContent=(row.service||row.order_number||"Beschwerde")+" · "+intakeLabels[row.status];
                text.textContent=row.description||"";
                button.className="button button-light";
                button.type="button";
                button.textContent="Details ansehen";
                button.onclick=()=>openIntake(view,row.id,page).catch(error=>{description.textContent=error.message;});
                item.append(heading,text,button);
                if (row.quote_id) {
                    const offer=document.createElement("button");
                    offer.className="button button-primary";
                    offer.type="button";
                    offer.dataset.quoteId=row.quote_id;
                    offer.textContent="Angebot öffnen";
                    item.append(offer);
                }
                list.append(item);
            }
        }
        draw(result.rows);
        const prev=$("#customer-intake-prev"),next=$("#customer-intake-next");
        prev.disabled=page===1; next.disabled=!result.hasMore;
        prev.onclick=()=>renderIntake(view,page-1).catch(error=>{description.textContent=error.message;});
        next.onclick=()=>renderIntake(view,page+1).catch(error=>{description.textContent=error.message;});
        description.textContent=service?"Senden und verfolgen Sie Ihre Serviceanfragen.":"Melden Sie ein Problem und lesen Sie veröffentlichte Antworten.";
        let key=null,lastPayload=null;
        form.onsubmit=async event=>{
            event.preventDefault();
            const submit=event.submitter;
            if (!submit||submit.disabled) return;
            const payload=Object.fromEntries(new FormData(form)), encoded=JSON.stringify(payload);
            if (encoded!==lastPayload || !key) key=crypto.randomUUID();
            lastPayload=encoded;
            submit.disabled=true;
            try {
                await api(intakePath(view),{method:"POST",body:JSON.stringify({...payload,submission_key:key})});
                if (version!==intakeVersion) return;
                await renderIntake(view);
                description.textContent="Eintrag gespeichert.";
            } catch(error) { if (version===intakeVersion) description.textContent=error.message; }
            finally {submit.disabled=false;}
        };
    }

    async function openIntake(view,id,page) {
        const version=++intakeVersion;
        const result=await api(intakePath(view)+"/"+id);
        if(version!==intakeVersion)return;
        const {record,updates}=result;
        data.replaceChildren();
        const item=document.createElement("article");
        item.className="portal-order-detail";
        const heading=document.createElement("h3");
        heading.textContent=(record.service||record.order_number||"Beschwerde")+" · "+intakeLabels[record.status];
        const text=document.createElement("p");
        text.className="intake-description";
        text.textContent=record.description||"";
        item.append(heading,text);
        if(record.preferred_date){
            const date=document.createElement("p");
            date.textContent="Wunschtermin: "+record.preferred_date;
            item.append(date);
        }
        for(const update of updates){
            const row=document.createElement("p");
            row.className="intake-description";
            row.textContent=[intakeLabels[update.status],String(update.created_at).slice(0,10),update.response].filter(Boolean).join(" · ");
            item.append(row);
        }
        const back=document.createElement("button");
        back.type="button";back.className="button button-light";back.textContent="Zurück zur Liste";
        back.onclick=()=>renderIntake(view,page).catch(error=>{description.textContent=error.message;});
        if(record.quote_id){
            const offer=document.createElement("button");
            offer.className="button button-primary";offer.type="button";offer.dataset.quoteId=record.quote_id;offer.textContent="Angebot öffnen";
            item.append(offer);
        }
        item.append(back);data.append(item);
    }


    const views={
        home:"Willkommen zurück",appointments:"Meine Termine","service-requests":"Serviceanfragen",
        complaints:"Beschwerden",quotes:"Meine Angebote",contracts:"Meine Verträge",orders:"Meine Leistungen",
        "service-reports":"Meine Leistungsnachweise",invoices:"Meine Rechnungen",documents:"Meine Dokumente",
        messages:"Nachrichten",notifications:"Benachrichtigungen",profile:"Mein Profil"
    };
    const deDay=new Intl.DateTimeFormat("de-DE",{timeZone:"UTC",dateStyle:"medium"});
    const wallDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"});
    const wallClock=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    const amountFormatter=new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"});
    const money=value=>value===undefined||value===null||value===""||!Number.isFinite(Number(value))?"—":amountFormatter.format(value);
    function localDay(value){
        const text=String(value||"");
        if(/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)){
            const date=new Date(text);
            if(Number.isFinite(date.getTime()))return wallDay.format(date);
        }
        return text.slice(0,10);
    }
    function dateLabel(value){
        if(!value)return "—";
        const date=new Date(localDay(value)+"T00:00:00Z");
        return Number.isFinite(date.getTime())?deDay.format(date):"—";
    }
    function upcoming(appointment,now){
        const day=localDay(appointment.preferred_date);
        const today=wallDay.format(now);
        return day>today||day===today&&String(appointment.end_time||appointment.start_time||"").slice(0,5)>=wallClock.format(now);
    }
    const appointmentLabels={confirmed:"Bestätigt",pending:"Offen",in_progress:"In Bearbeitung",completed:"Erledigt",cancelled:"Storniert"};
    function appointmentCard(row){
        const day=dateLabel(row.preferred_date);
        const time=[row.start_time,row.end_time].filter(Boolean).map(value=>String(value).slice(0,5)).join("–");
        const address=[row.address,[row.postal_code,row.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        return '<article class="portal-order-card"><strong>'+escapeHtml(row.service)+'</strong><p>'+escapeHtml(day)+
            (time?' · '+escapeHtml(time)+' Uhr':"")+'</p>'+(address?'<p>'+escapeHtml(address)+'</p>':"")+
            '<span class="customer-badge'+(row.status==="confirmed"?" confirmed":"")+'">'+escapeHtml(appointmentLabels[row.status]||row.status)+'</span></article>';
    }
    async function renderAppointments(){
        const {rows}=await api("/api/customer/appointments");
        const now=new Date();
        const upcomingRows=[],pastRows=[];
        for (const row of new Map(rows.map(item=>[item.id,item])).values()){
            const queue=upcoming(row,now)&&!["completed","cancelled"].includes(row.status)?upcomingRows:pastRows;
            queue.push(row);
        }
        upcomingRows.sort((a,b)=>localDay(a.preferred_date).localeCompare(localDay(b.preferred_date))||String(a.start_time).localeCompare(String(b.start_time)));
        pastRows.sort((a,b)=>localDay(b.preferred_date).localeCompare(localDay(a.preferred_date)));
        title.textContent="Meine Termine";
        description.textContent="Ihre gebuchten Termine und der jeweilige Status.";
        data.innerHTML=[["Bevorstehend",upcomingRows],["Vergangen und abgeschlossen",pastRows]].map(([name,items])=>
            '<section class="customer-date-section"><h2>'+name+'</h2>'+
            (items.length?items.map(appointmentCard).join(""):'<article>Keine Termine in diesem Abschnitt.</article>')+'</section>'
        ).join("");
    }
    async function loadHomeDetails(version){
        const area=$("#customer-summary");
        area.replaceChildren();
        const now=new Date();
        const cards=[
            ["Aktive Verträge","contracts",rows=>rows.filter(row=>row.status==="AKTIV").length],
            ["Bevorstehende bestätigte Buchungen","appointments",rows=>rows.filter(row=>row.status==="confirmed"&&upcoming(row,now)).length],
            ["Ungelesene Benachrichtigungen","notifications",rows=>rows.filter(row=>!row.read_at).length]
        ];
        await Promise.all(cards.map(async ([label,endpoint,count])=>{
            const card=document.createElement("article"),heading=document.createElement("h2"),value=document.createElement("p");
            card.className="customer-extra-card";
            heading.textContent=label;
            value.textContent="Wird geladen …";
            value.setAttribute("role","status");
            card.append(heading,value);
            area.append(card);
            async function update(){
                try {
                    const {rows}=await api("/api/customer/"+endpoint);
                    if(version===pageVersion)value.textContent=String(count(rows));
                }catch(error){
                    if(version!==pageVersion||error.name==="AbortError")return;
                    value.textContent="Nicht verfügbar";
                    const retry=document.createElement("button");
                    retry.type="button";
                    retry.className="button button-light";
                    retry.textContent="Kennzahl neu laden";
                    retry.onclick=()=>{retry.remove();value.textContent="Wird geladen …";update();};
                    card.append(retry);
                }
            }
            await update();
        }).concat(api("/api/customer/invoices").then(({rows})=>{
            if(version!==pageVersion)return;
            const latest=rows[0];
            const link=$("#customer-quick-invoice");
            if(latest){link.href="/api/customer/invoices/"+Number(latest.id)+"/pdf";link.hidden=false;}
        }).catch(()=>{})));
    }
    let pageVersion=0;
    function bindForm(selector,save){
        const form=$(selector);
        form.onsubmit=async event=>{
            event.preventDefault();
            if(form.hasAttribute("aria-busy"))return;
            const submit=form.querySelector("button[type=submit],button:not([type])");
            const version=pageVersion;
            form.setAttribute("aria-busy","true");
            if(submit)submit.disabled=true;
            try{await save(form,()=>version===pageVersion);}
            catch(error){
                if(version===pageVersion&&error.name!=="AbortError"){
                    const note=form.querySelector(".form-note")||description;
                    note.textContent=error.message;
                }
            }finally{
                form.removeAttribute("aria-busy");
                if(submit)submit.disabled=false;
            }
        };
    }
    async function showView(view){
        const version=++pageVersion;
        const quick=$("#customer-quick");
        $("#customer-summary").before(quick);
        quick.hidden=view!=="home";
        $("#customer-summary").hidden=view!=="home";
        $("#customer-quick-invoice").hidden=true;
        $("#customer-view-status").hidden=view==="home";
        $("#customer-view-status").classList.remove("error");
        $("#customer-view-message").textContent="Daten werden geladen …";
        $("#customer-view-skeleton").hidden=false;
        const retry=$("#customer-view-retry");
        retry.hidden=true;
        title.textContent=views[view];
        description.textContent="";
        if(view!=="home")data.replaceChildren();
        for(const button of document.querySelectorAll("[data-portal-view]")){
            if(button.dataset.portalView===view)button.setAttribute("aria-current","page");
            else button.removeAttribute("aria-current");
        }
        document.dispatchEvent(new CustomEvent("customer-view-change",{detail:view}));
        try{
            const result=load(view);
            if(view==="home")loadHomeDetails(version);
            await result;
            if(version===pageVersion)$("#customer-view-status").hidden=true;
        }catch(error){
            if(version!==pageVersion||error.name==="AbortError")return;
            $("#customer-view-status").hidden=false;
            $("#customer-view-status").classList.add("error");
            $("#customer-view-message").textContent=error.message;
            $("#customer-view-skeleton").hidden=true;
            retry.hidden=false;
            retry.onclick=()=>{showView(view);title.focus();};
        }
    }
    async function boot(){
        const retry=$("#customer-boot-retry");
        retry.hidden=true;
        try{
            const {customer:account}=await api("/api/customer/session");
            customer=account;
            $("#portal-name").textContent=[account.first_name,account.last_name].filter(Boolean).join(" ")||"Kundenportal";
            $("#customer-boot").hidden=true;
            $("#customer-dashboard").hidden=false;
            showView("home");
        }catch(error){
            $("#customer-boot-message").textContent=error.message;
            retry.hidden=false;
        }
    }

    async function load(view) {
        intakeVersion++;
        if(view!=="home" && data.querySelector(".portal-home-grid")) data.replaceChildren();
        document.querySelectorAll("[data-portal-view]").forEach(button => button.classList.toggle("is-active", button.dataset.portalView === view));
        if (view === "home") {
            title.textContent = "Willkommen zurück";
            description.textContent = customer?.customer_number ? `Ihre Kundennummer: ${customer.customer_number}` : "Ihre verknüpften Informationen sehen Sie hier.";
            const homeVersion = intakeVersion;
            return dashboardHome(data,"customer",target=>document.querySelector(`[data-portal-view="${target}"]`).click(),()=>intakeVersion===homeVersion).then(()=>{
                if(intakeVersion!==homeVersion)return;
                data.querySelector(".portal-home-grid > article")?.after($("#customer-quick"));
            });
        }
        if (view === "service-requests" || view === "complaints") return renderIntake(view);
        if (view === "appointments") return renderAppointments();
        if (view === "orders") return renderOrders();
        if (view === "service-reports") return renderServiceReports();
        if (view === "invoices") return renderInvoices();
        if (view === "documents") { const result=await api("/api/customer/documents"); title.textContent="Meine Dokumente"; description.textContent="Ihre sicher bereitgestellten Unterlagen."; data.innerHTML=result.rows.map(row=>`<article class="portal-order-card"><strong>${escapeHtml(row.document_type)}</strong><p>${escapeHtml(row.file_name)}</p><small>${escapeHtml(row.created_at)}</small><a class="button button-light" href="/api/customer/documents/${row.id}">Download</a></article>`).join("")||"<article>Keine Dokumente vorhanden.</article>";return; }
        if (view === "messages") { const result=await api("/api/customer/messages"); title.textContent="Nachrichten"; description.textContent="Sicherer Austausch mit Ihrer Verwaltung."; data.innerHTML=`<form id="message-form" class="portal-profile"><label>Betreff<input name="subject" maxlength="180" required></label><label>Nachricht<textarea name="message" maxlength="8000" required></textarea></label><button class="button button-primary">Nachricht senden</button></form>${result.rows.map(row=>`<article class="portal-order-card"><strong>${escapeHtml(row.subject)}</strong><p>${escapeHtml(row.message)}</p><small>${escapeHtml(row.sender_type)} · ${escapeHtml(row.created_at)} · ${row.read_at?"gelesen":"neu"}</small>${!row.read_at?` <button type="button" class="button button-light" data-message-read="${row.id}">Als gelesen markieren</button>`:""}</article>`).join("")}`; bindForm("#message-form",async(form,active)=>{await api("/api/customer/messages",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(form)))});if(active())await showView("messages");}); data.querySelectorAll("[data-message-read]").forEach(button=>button.onclick=async()=>{await api(`/api/customer/messages/${button.dataset.messageRead}/read`,{method:"PATCH",body:"{}"});load("messages")});return; }
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
            bindForm("#profile-form",async(form,active)=>{await api("/api/customer/profile",{method:"PATCH",body:JSON.stringify(Object.fromEntries(new FormData(form)))});if(active())description.textContent="Profil gespeichert.";});
            bindForm("#customer-password-form",async(form,active)=>{
                const note=form.querySelector(".form-note"),values=Object.fromEntries(new FormData(form));
                note.textContent="";
                if(values.new_password!==values.password_confirmation){note.textContent="Die neuen Passwörter stimmen nicht überein.";return;}
                const result=await api("/api/customer/change-password",{method:"POST",body:JSON.stringify(values)});
                form.reset();
                if(active())description.textContent=result.message;
            });
            return;
        }

    }

    document.querySelectorAll("[data-portal-view]").forEach(button=>button.addEventListener("click",()=>showView(button.dataset.portalView)));
    $("#customer-quick").addEventListener("click",event=>{
        const target=event.target.closest("[data-customer-go]");
        if(target){showView(target.dataset.customerGo);title.focus();}
    });
    data.addEventListener("click", event => {
        const order = event.target.closest("[data-order-id]");
        if (order) renderOrders(order.dataset.orderId).catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        if (event.target.closest("[data-back-orders]")) renderOrders().catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        const quote = event.target.closest("[data-quote-id]");
        if (quote) renderCommercial("quote", quote.dataset.quoteId).catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        const contract = event.target.closest("[data-contract-id]");
        if (contract) renderCommercial("contract", contract.dataset.contractId).catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        const back = event.target.closest("[data-back-commercial]");
        if (back) renderCommercial(back.dataset.backCommercial).catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        const invoice = event.target.closest("[data-invoice-id]");
        if (invoice) renderInvoices(invoice.dataset.invoiceId).catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        if (event.target.closest("[data-back-invoices]")) renderInvoices().catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        const serviceReport = event.target.closest("[data-service-report-id]");
        if (serviceReport) renderServiceReports(serviceReport.dataset.serviceReportId).catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        if (event.target.closest("[data-back-service-reports]")) renderServiceReports().catch(error => { if(error.name!=="AbortError")description.textContent = error.message; });
        const confirmServiceReportButton = event.target.closest("[data-confirm-service-report]");
        if (confirmServiceReportButton) confirmServiceReport(confirmServiceReportButton.dataset.confirmServiceReport);
        const accept = event.target.closest("[data-accept-quote]");
        if (accept && !pendingQuotes.has(accept.dataset.acceptQuote)) {
            const id=accept.dataset.acceptQuote, version=pageVersion;
            pendingQuotes.add(id);accept.disabled=true;
            api(`/api/customer/quotes/${id}/accept`,{method:"POST",body:"{}"}).then(()=>{
                if(version===pageVersion)return renderCommercial("quote",id);
            }).catch(error=>{if(version===pageVersion&&error.name!=="AbortError")description.textContent=error.message;}).finally(()=>{
                pendingQuotes.delete(id);accept.disabled=false;
            });
        }
        const reject = event.target.closest("[data-reject-quote]");
        if (reject && !pendingQuotes.has(reject.dataset.rejectQuote)) {
            if (!window.confirm("Möchten Sie dieses Angebot wirklich ablehnen?")) return;
            const reason = window.prompt("Grund der Ablehnung (optional):", "");
            if (reason === null) return;
            const quoteId=reject.dataset.rejectQuote,version=pageVersion;
            pendingQuotes.add(quoteId);
            reject.disabled = true;
            api(`/api/customer/quotes/${reject.dataset.rejectQuote}/reject`, { method:"POST", body:JSON.stringify({ reason }) }).then(result=>{if(version===pageVersion){description.textContent=result.message;return renderCommercial("quote",quoteId);}}).catch(error=>{if(version===pageVersion&&error.name!=="AbortError")description.textContent=error.message;reject.disabled=false;}).finally(()=>pendingQuotes.delete(quoteId));
        }
    });
    $("#customer-logout").onclick = async () => { try { await api("/api/customer/logout", { method: "POST", body: "{}" }); } finally { location.href = "kundenportal.html"; } };
    $("#customer-boot-retry").addEventListener("click",boot);
    boot();
});
