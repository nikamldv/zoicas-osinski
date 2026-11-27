"use strict";
window.dashboardHome = (() => {
    const number = new Intl.NumberFormat("de-DE");
    const currency = new Intl.NumberFormat("de-DE", {style:"currency",currency:"EUR"});
    const date = new Intl.DateTimeFormat("de-DE",{dateStyle:"medium",timeZone:"UTC"});
    const visit = item => item ? [item.title || item.service_type,item.order_number,`${date.format(new Date(item.day))} · ${item.start_time.slice(0,5)} Uhr`] : [];
    const card = (title, lines, target, action) => ({title,lines,target,action});
    const count = (title,value,target,action) => card(title,[number.format(value)],target,action);
    const states = {PENDING:"Offen",APPROVED:"Genehmigt",REJECTED:"Abgelehnt",WITHDRAWN:"Zurückgezogen"};
    const layouts = {
        admin({day,operations:d,finance:f}) {
            return [
                card("Heutige Aufträge",[date.format(new Date(day)),`${d.scheduled} geplant · ${d.completed} erledigt · ${d.pending} offen`],"schedule","Einsatzplanung öffnen"),
                count("Aufträge ohne Zuweisung",d.unassigned,"order","Aufträge öffnen"),
                card("Einsatzkonflikte",[`${d.overlaps} mit Überschneidung`,`${d.absence_conflicts} während einer Abwesenheit`],"schedule","Einsätze prüfen"),
                count("Unterbesetzte Aufträge",d.understaffed,"recurring","Einsatzplanung prüfen"),
                count("Aktuell eingecheckt",d.checked_in,"attendance","Anwesenheit öffnen"),
                count("Offene Abwesenheitsanträge",d.vacation_requests,"schedule","Anträge prüfen"),
                count("Neue Serviceanfragen",d.service_requests,"quote","Anfragen öffnen"),
                count("Offene Beschwerden",d.complaints,"quality","Beschwerden prüfen"),
                count("Angebote mit Handlungsbedarf",d.quotes,"offer","Angebote öffnen"),
                count("Rechnungsentwürfe",d.invoice_drafts,"invoice","Rechnungen öffnen"),
                count("Materialien am oder unter Mindestbestand",d.low_stock,"materials","Bestände prüfen"),
                card("Ausgestellte Rechnungen",[`${f.invoice_count} Rechnungen · ${currency.format(f.issued_amount)} brutto`,`${currency.format(f.paid_amount)} erhalten`],"invoice","Rechnungsübersicht öffnen"),
                card("Offene Forderungen",[`${currency.format(f.outstanding_amount)} offen`,`${f.overdue_count} überfällig · ${currency.format(f.overdue_amount)}`],"invoice","Offene Rechnungen prüfen"),
                card("Zahlungseingänge in diesem Monat",[currency.format(f.monthly_payments),"Erfasste Rechnungszahlungen"],"reporting","Berichte öffnen")
            ];
        },
        employee(d) {
            return [
                card("Heutige Einsätze",d.today.map(item=>`${item.start_time.slice(0,5)} · ${item.title}`),"orders","Aufträge öffnen"),
                card("Nächster Einsatz",visit(d.next),"schedule","Zeitplan öffnen"),
                card("Aktive Anwesenheit",d.attendance?[d.attendance.order_number,"Eingecheckt"]:[],"work","Arbeitszeit öffnen"),
                count("Ausstehende Leistungsnachweise",d.reports,"service-reports","Nachweise öffnen"),
                card("Letzter Abwesenheitsantrag",d.vacation?[states[d.vacation.status],date.format(new Date(d.vacation.day))]:[],"absence","Anträge öffnen"),
                count("Neue Benachrichtigungen",d.notifications,"notifications","Benachrichtigungen öffnen")
            ];
        },
        customer(d) {
            return [
                card("Nächster Service",d.next ? [...visit(d.next).filter(Boolean),d.next.kind==="APPOINTMENT"?"Bestätigter Termin":"Geplanter Serviceauftrag",d.next.end_time?"Ende "+d.next.end_time.slice(0,5)+" Uhr":"",[d.next.address,[d.next.postal_code,d.next.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean):[],d.next?.kind==="APPOINTMENT"?"appointments":"orders",d.next?.kind==="APPOINTMENT"?"Termine öffnen":"Aufträge öffnen"),
                ...(d.bookings?.length?[card("Weitere bestätigte Termine",d.bookings.map(item=>visit(item).filter(Boolean).join(" · ")),"appointments","Termine öffnen")]:[]),
                count("Aktive Serviceanfragen",d.requests,"service-requests","Anfragen öffnen"),
                count("Angebote zur Entscheidung",d.quotes,"quotes","Angebote öffnen"),
                count("Offene Rechnungen",d.invoices,"invoices","Rechnungen öffnen"),
                count("Offene Beschwerden",d.complaints,"complaints","Beschwerden öffnen"),
                card("Aktuelle Benachrichtigungen",d.notifications.map(item=>item.title),"notifications","Benachrichtigungen öffnen")
            ];
        }
    };
    const loads = new WeakMap();
    return async (container, role, navigate, active=()=>true) => {
        const load = Symbol();
        loads.set(container,load);
        const status=document.createElement("p");
        status.setAttribute("role","status");
        status.textContent="Übersicht wird geladen …";
        container.replaceChildren(status);
        try {
            const response=await fetch(`/api/${role}/home`,{cache:"no-store"});
            if(response.status===401&&role!=="admin"){location.replace(role==="customer"?"kunden-anmelden.html":"mitarbeiter-anmelden.html");return;}
            if (!response.ok) throw new Error("dashboard_request");
            const data=await response.json();
            if (!active() || loads.get(container)!==load) return;
            const grid=document.createElement("div");
            grid.className="portal-home-grid";
            for (const {title,lines,target,action} of layouts[role](data)) {
                const item=document.createElement("article");
                const heading=document.createElement("h2");
                heading.textContent=title;
                const details=document.createElement("div");
                for (const line of lines.length?lines:["Keine Einträge vorhanden."]) {
                    const paragraph=document.createElement("p");
                    paragraph.textContent=line;
                    details.append(paragraph);
                }
                const button=document.createElement("button");
                button.type="button";
                button.textContent=action;
                button.addEventListener("click",()=>navigate(target));
                item.append(heading,details,button);
                grid.append(item);
            }
            status.className="portal-home-announcement";
            status.textContent="Übersicht geladen.";
            container.append(grid);
        } catch {
            if (!active() || loads.get(container)!==load) return;
            status.textContent="Übersicht konnte nicht geladen werden.";
            const retry=document.createElement("button");
            retry.type="button";
            retry.textContent="Erneut versuchen";
            retry.addEventListener("click",()=>window.dashboardHome(container,role,navigate,active));
            container.append(retry);
        }
    };
})();
