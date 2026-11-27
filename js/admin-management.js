"use strict";

window.adminManagement = (() => {
    const sections = {
        contact:"Kontaktanfragen sichten, filtern und bearbeiten.",
        career:"Bewerbungen und zugehörige Unterlagen prüfen.",
        schedule:"Arbeitszeiten, geplante Einsätze und Abwesenheiten koordinieren.",
        appointment:"Gebuchte Reinigungstermine prüfen und bestätigte Termine weiterbearbeiten.",
        order:"Aufträge, Teambesetzung und Abrechnungsvoraussetzungen prüfen.",
        recurring:"Einsatzpläne, Generierungsprotokolle und Personalengpässe prüfen.",
        employee:"Mitarbeitende, Arbeitszeiten und Portalzugänge verwalten.",
        attendance:"Check-ins, Arbeitszeiten und Prüfhinweise kontrollieren.",
        "service-report":"Eingereichte Nachweise prüfen und Freigaben verwalten.",
        "live-locations":"Testansicht für synthetische Standortdaten.",
        customer:"Privat- und Geschäftskunden, Rechnungsdaten und Portalzugänge verwalten.",
        quote:"Service- und Angebotsanfragen prüfen und weiterbearbeiten.",
        offer:"Angebote erstellen, prüfen und gezielt veröffentlichen.",
        contract:"Vertragslaufzeiten, Konditionen, Dokumente und Einsatzpläne verwalten.",
        invoice:"Rechnungsentwürfe, veröffentlichte Rechnungen und Zahlungen prüfen.",
        finance:"Zahlungen, Einnahmen, Ausgaben und Kassenbewegungen verwalten.",
        materials:"Materialbestände, Mindestmengen und Lagerbewegungen kontrollieren.",
        quality:"Beschwerden, interne Vorfälle und Korrekturmaßnahmen bearbeiten.",
        document:"Private Unterlagen hochladen und deren Sichtbarkeit prüfen.",
        reporting:"Berichte nach Zeitraum auswerten und vorhandene Exporte erstellen.",
        message:"Kundennachrichten lesen und beantworten.",
        notification:"Interne Hinweise lesen und ihren Bearbeitungsstand prüfen.",
        "action-center":"Offene Aufgaben und kritische Vorgänge nach Priorität prüfen.",
        audit:"Protokollierte Ereignisse nachvollziehen."
    };
    const specialized = {
        schedule:"schedule-panel",attendance:"attendance-panel", "live-locations":"live-locations-panel",
        "service-report":"service-reports-panel",finance:"finance-panel",reporting:"reporting-panel",
        materials:"materials-panel",quality:"quality-panel","action-center":"action-center-panel"
    };
    const get = id => document.getElementById(id);
    const shell = get("dashboard-view");
    const intro = get("admin-page-intro");
    const description = get("admin-page-description");
    const summary = get("admin-view-summary");
    const count = get("admin-view-count");
    const progress = get("management-progress");
    const failure = get("admin-view-error");
    const retry = get("admin-view-retry");
    const groups = get("admin-records");
    let current;
    let sequence = 0;
    const reportPanel = get("reporting-panel");
    new MutationObserver(() => {
        if(current==="reporting")decorateTables(reportPanel);
    }).observe(reportPanel,{childList:true,subtree:true});

    function decorateTables(panel) {
        const name = get("page-title").textContent;
        for (const region of panel.querySelectorAll(".table-wrap,.table-scroll")) {
            if (!region.querySelector("table")) continue;
            if (!region.hasAttribute("role")) region.setAttribute("role","region");
            if (!region.hasAttribute("aria-label") && !region.hasAttribute("aria-labelledby")) {
                const heading = region.closest("section[aria-labelledby]")?.getAttribute("aria-labelledby");
                if (heading) region.setAttribute("aria-labelledby",heading);
                else region.setAttribute("aria-label",name+" – Tabelle");
            }
            if (!region.hasAttribute("tabindex")) region.tabIndex = 0;
        }
    }
    function show(type) {
        current = type;
        sequence += 1;
        intro.hidden = !sections[type];
        failure.hidden = true;
        progress.hidden = true;
        summary.hidden = true;
        if (intro.hidden) { delete shell.dataset.management; return; }
        shell.dataset.management = type;
        description.textContent = sections[type];
        const pane = get(specialized[type]) || groups;
        decorateTables(pane);
    }
    function listCount(type,total) {
        if (type!==current || specialized[type] || total===null) { summary.hidden = true; return; }
        if (!Number.isFinite(Number(total))) return;
        count.textContent = new Intl.NumberFormat("de-DE").format(total);
        summary.hidden = false;
    }
    function clearError() { failure.hidden = true; }
    function listFailed(type,error,fetchView) {
        if(type!==current)return;
        get("admin-view-error-label").textContent = error.message || "Die Ansicht konnte nicht geladen werden.";
        retry.onclick = () => { fetchView(); get("page-title").focus(); };
        failure.hidden = false;
    }
    async function load(type, fetchView) {
        if (!specialized[type] || type==="live-locations") return fetchView();
        const id = ++sequence;
        const stillCurrent = () => type===current && id===sequence;
        progress.hidden = false;
        failure.hidden = true;
        try {
            await fetchView();
        } catch (error) {
            if (!stillCurrent()) return;
            listFailed(type,error,()=>load(type,fetchView));
        } finally {
            if (stillCurrent()) progress.hidden = true;
        }
    }
    function relatedButton(label, handler) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-light";
        button.textContent = label;
        button.addEventListener("click",handler);
        return button;
    }
    function detailSection(title, values) {
        const node = document.createElement("section");
        const heading = document.createElement("h3");
        heading.textContent = title;
        const list = document.createElement("dl");
        for (const [label,value] of values) {
            const cell = document.createElement("div");
            const key = document.createElement("dt");
            const content = document.createElement("dd");
            key.textContent = label;
            content.textContent = value || "—";
            cell.append(key,content);
            list.append(cell);
        }
        node.append(heading,list);
        return node;
    }
    function customerDetail(container,customer,navigate) {
        const status = {active:"Aktiv",inactive:"Inaktiv",blocked:"Gesperrt"}[customer.status];
        const formatAddress = (street,postal,city) => [street,[postal,city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        const contact = formatAddress(customer.address,customer.postal_code,customer.city);
        const billing = formatAddress(customer.billing_address,customer.billing_postal_code,customer.billing_city);
        container.append(
            detailSection("Kundenkonto",[
                ["Kundentyp",customer.customer_type==="BUSINESS"?"Geschäftskunde":"Privatkunde"],
                ["Status",status],["Portalzugang",customer.portal_enabled?"Aktiviert":"Ohne Portalzugang"],
                ["Ansprechperson",customer.contact_name || [customer.first_name,customer.last_name].filter(Boolean).join(" ")]
            ]),
            detailSection("Kontakt und Rechnungsanschrift",[["Anschrift",contact],["Rechnungsanschrift",billing||"Keine separate Rechnungsanschrift"]])
        );
        if (customer.internal_notes) {
            const notes = detailSection("Interne Notiz · nur Verwaltung",[["Notiz",customer.internal_notes]]);
            notes.classList.add("private-note");
            container.append(notes);
        }
        const related = document.createElement("div");
        related.className = "related-actions";
        for (const [label,type] of [["Verträge","contract"],["Aufträge","order"],["Termine","appointment"],["Rechnungen","invoice"],["Geschützte Dokumente","document"]]){
            related.append(relatedButton(label,()=>navigate(type,customer)));
        }
        container.append(related);
        container.hidden = false;
    }
    return {show,listCount,listFailed,clearError,load,customerDetail};
})();
