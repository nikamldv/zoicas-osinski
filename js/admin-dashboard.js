"use strict";

window.adminDashboard = (() => {
    const get = id => document.getElementById(id);
    const host = get("management-home");
    const dashboard = get("dashboard-view");
    const sidebar = get("admin-sidebar");
    const drawer = get("admin-nav-drawer");
    const toggle = get("admin-nav-toggle");
    const mobile = matchMedia("(max-width:1070px)");
    const euros = new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"});
    const counts = new Intl.NumberFormat("de-DE");
    const isoDay = new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin",dateStyle:"short"});
    const berlinClock = new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"Europe/Berlin"});
    const dayLabel = new Intl.DateTimeFormat("de-DE",{timeZone:"UTC",dateStyle:"full"});
    const shortDate = new Intl.DateTimeFormat("de-DE",{timeZone:"UTC",day:"2-digit",month:"2-digit"});
    const searchableModules = new Set(["contact","career","quote","offer","contract","invoice","order","appointment","customer","employee","audit"]);
    let generation = 0;
    let unreadGeneration = 0;
    let period = "month";
    let current = "home";

    const iconPaths = {
        home:"M3 3h7v8H3z M14 3h7v4h-7z M14 11h7v10h-7z M3 15h7v6H3z",
        schedule:"M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2 M14 14h2 M8 17h2",
        appointment:"M6 3h12 M6 21h12 M7 3v4a5 5 0 0 0 5 5 5 5 0 0 0 5-5V3 M7 21v-4a5 5 0 0 1 5-5 5 5 0 0 1 5 5v4",
        order:"M8 5H5v16h14V5h-3 M8 3h8v4H8z M8 12h8 M8 16h8",
        recurring:"M20 7h-9a5 5 0 0 0-5 5 M17 4l3 3-3 3 M4 17h9a5 5 0 0 0 5-5 M7 14l-3 3 3 3",
        employee:"M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M13.5 7a4 4 0 1 1-8 0 4 4 0 1 1 8 0 M21 21v-2a4 4 0 0 0-3-3.9 M17 3.4a4 4 0 0 1 0 7.2",
        attendance:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
        absence:"M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M9 15h6",
        "service-report":"M7 3h8l4 4v14H5V3z M14 3v5h5 M8 15l2 2 5-5",
        "live-locations":"M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0",
        customer:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
        quote:"M4 4h16v12H9l-5 4z M12 7v6 M9 10h6",
        offer:"M3 5h8l9 9-6 6-9-9z M8 8h.01",
        contract:"M6 3h9l4 4v14H5V3z M14 3v5h5 M8 12h8 M8 16h5",
        invoice:"M5 3l3 2 4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2z M8 9h8 M8 13h8 M8 17h4",
        finance:"M3 6h17v13H3z M3 8l13-5 3 3 M20 11h-6v4h6",
        materials:"M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
        quality:"M12 3l8 3v6c0 4-8 9-8 9s-8-5-8-9V6z M8 12l3 3 5-6",
        document:"M3 6h7l2 2h9v11H3z",
        reporting:"M4 4v16h17 M8 16v-4 M13 16V7 M18 16v-6",
        message:"M3 5h18v14H3z M3 6l9 7 9-7",
        notification:"M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 20h4",
        "action-center":"M12 3l9 17H3z M12 9v4 M12 17h.01",
        contact:"M3 5h18v14H3z M7 9h3v3H7z M14 9h4 M14 13h4 M6 16h5",
        career:"M3 8h18v12H3z M8 8V4h8v4 M3 13h18 M10 12v3h4v-3",
        audit:"M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
        settings:"M4 7h16 M4 12h16 M4 17h16 M8 5v4 M16 10v4 M10 15v4",
        check:"M4 12l5 5L20 6",
        arrow:"M4 12h15 M14 7l5 5-5 5"
    };
    const svgNamespace = "http://www.w3.org/2000/svg";
    function icon(name) {
        const image = document.createElementNS(svgNamespace,"svg");
        image.setAttribute("viewBox","0 0 24 24");
        image.setAttribute("aria-hidden","true");
        image.setAttribute("focusable","false");
        image.classList.add("admin-outline");
        const path = document.createElementNS(svgNamespace,"path");
        path.setAttribute("d",iconPaths[name] || iconPaths.document);
        image.append(path);
        return image;
    }
    for (const item of sidebar.querySelectorAll(".nav-item,.admin-nav-extra")) {
        item.querySelector(".nav-icon")?.replaceChildren(icon(item.dataset.type || item.dataset.adminNav));
    }
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function button(label, handler, className = "admin-link") {
        const node = element("button",label,className);
        node.type = "button";
        node.addEventListener("click",handler);
        return node;
    }
    const placeholder = "Nicht verfügbar";
    function value(raw, formatter = counts) {
        if (raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw))) return placeholder;
        return formatter.format(Number(raw));
    }
    const durationUnits = Object.fromEntries(["hour","minute","second"].map(unit=>[
        unit,new Intl.NumberFormat("de-DE",{style:"unit",unit,unitDisplay:"short"})
    ]));
    const workingDuration = {
        format(hours) {
            const seconds = Math.round(Number(hours)*3600);
            if (seconds > 0 && seconds < 60) return durationUnits.second.format(seconds);
            const h = Math.floor(seconds/3600), m = Math.floor(seconds%3600/60), s = seconds%60;
            return [
                h ? durationUnits.hour.format(h) : "",
                m || !h ? durationUnits.minute.format(m) : "",
                s ? durationUnits.second.format(s) : ""
            ].filter(Boolean).join(" ");
        }
    };
    function navigate(target, action) {
        const nav = sidebar.querySelector('[data-type="'+target+'"]');
        if (!nav || nav.hidden) return;
        if (drawer.open) drawer.close();
        get("admin-account").open = false;
        nav.click();
        if (action) get(action).click();
        else get("page-title").focus({preventScroll:true});
    }
    function datePlus(day, increment) {
        const date = new Date(day+"T12:00:00Z");
        date.setUTCDate(date.getUTCDate()+increment);
        return date.toISOString().slice(0,10);
    }
    function panel(title, description, controls) {
        const section = element("section",undefined,"admin-section");
        const head = element("header",undefined,"admin-section-head");
        const copy = element("div");
        copy.append(element("h2",title));
        if (description) copy.append(element("p",description));
        head.append(copy);
        if (controls) head.append(controls);
        const body = element("div");
        body.classList.add("admin-section-body");
        section.append(head,body);
        return {section,body};
    }
    function state(text, kind) {
        const node = element("p",text,"admin-state"+(kind?" "+kind:""));
        node.setAttribute("role","status");
        return node;
    }
    // Share only concurrent reads so refresh and retry always request fresh data.
    function shareRead(read) {
        let pending;
        return () => {
            if (!pending) pending = read().finally(() => { pending = undefined; });
            return pending;
        };
    }
    function mountSlot(target, task, render, options = {}) {
        let request = 0;
        const page = generation;
        const valid = id => page === generation && id === request && current === "home" && !dashboard.hidden;
        return async function refresh() {
            const id = ++request;
            const loading = state(options.loading || "Daten werden geladen …");
            for (let i=0;i<2;i+=1) {
                const line = element("span",undefined,"admin-skeleton");
                line.setAttribute("aria-hidden","true");
                loading.append(line);
            }
            target.replaceChildren(loading);
            try {
                const data = await task();
                if (valid(id)) target.replaceChildren(render(data));
            } catch (error) {
                if (!valid(id)) return;
                if (error.status === 401) { showLogin("Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an."); return; }
                const message = state(options.error || "Daten konnten nicht geladen werden.","error");
                const retry = button(options.retryLabel || "Erneut versuchen",() => {
                    refresh();
                    target.focus();
                },"button button-light");
                target.tabIndex = -1;
                target.replaceChildren(message,retry);
            }
        };
    }
    function metric(items) {
        const grid = element("div",undefined,"admin-kpi-grid");
        for (const [label,figure,note,target,symbol,tone] of items) {
            const card = element("article",undefined,"admin-metric");
            if (tone) card.dataset.tone = tone;
            const header = element("div",undefined,"admin-metric-heading");
            const emblem = element("span",undefined,"admin-metric-icon");
            emblem.append(icon(symbol || target));
            header.append(emblem,element("h3",label));
            card.append(header,element("strong",figure),element("small",note));
            if (target) {
                const action = button("Öffnen",()=>navigate(target));
                action.setAttribute("aria-label","Öffnen: "+label);
                action.append(icon("arrow"));
                card.append(action);
            }
            grid.append(card);
        }
        return grid;
    }
    function operationalStats(items, customers) {
        const section = panel("Betriebsübersicht",null,customers);
        section.section.classList.add("admin-stat-panel");
        const grid = element("div",undefined,"admin-stat-grid");
        for (const [label,number,target] of items) {
            const cell = element("div",undefined,"admin-stat-cell");
            const name = element("h3");
            name.append(button(label,()=>navigate(target)));
            cell.append(element("strong",value(number)),name);
            grid.append(cell);
        }
        section.body.append(grid);
        return section.section;
    }
    function list(rows, emptyText, title) {
        if (!rows.length) return state(emptyText);
        const table = element("table",undefined,"admin-work-table");
        table.setAttribute("aria-label",title);
        const header = table.createTHead().insertRow();
        for (const label of ["Eintrag","Zuordnung","Status"]) {
            const cell = element("th",label);
            cell.scope = "col";
            header.append(cell);
        }
        const body = table.createTBody();
        for (const [name,detail,status,tone] of rows) {
            const row = body.insertRow();
            row.insertCell().append(element("strong",name));
            row.insertCell().textContent = detail || "—";
            row.insertCell().append(element("span",status,"admin-badge "+(tone||"")));
        }
        return table;
    }
    function statusName(status) {
        return ({GEPLANT:"Geplant",ZUGEWIESEN:"Zugewiesen",IN_BEARBEITUNG:"In Arbeit",ERLEDIGT:"Erledigt",PAUSIERT:"Pausiert",NEU:"Neu",confirmed:"Bestätigt",new:"Neu",STORNIERT:"Storniert",ABGESCHLOSSEN:"Abgeschlossen",SUBMITTED:"Eingereicht",OPEN:"Offen"})[status] || status;
    }
    function chart(rows,label,formatter,columns = false) {
        if (!rows.length) return state("Keine Daten im ausgewählten Zeitraum.");
        const values = rows.map(([,number])=>Number(number));
        if (rows.some(([,value])=>value === null || value === "") || !values.every(Number.isFinite)) return state("Die Berichtsdaten sind unvollständig.");
        const max = Math.max(...values.map(Math.abs)) || 1;
        const bars = element("ul",undefined,"admin-bars"+(columns?" admin-trend":""));
        bars.setAttribute("aria-label",label);
        if (columns) bars.tabIndex = 0;
        for (const [name,amount] of rows) {
            const row = element("li");
            const track = element("span",undefined,"bar-track");
            track.setAttribute("aria-hidden","true");
            const fill = element("span",undefined,"bar-fill");
            fill.style.setProperty(columns?"--bar-size":"width",(Math.abs(Number(amount))/max*100)+"%");
            track.append(fill);
            const caption = element("span",name);
            const amountLabel = element("strong",formatter.format(amount));
            if (columns) row.append(amountLabel,track,caption);
            else row.append(caption,track,amountLabel);
            bars.append(row);
        }
        return bars;
    }
    function orderDonut(rows) {
        const countsByStatus = rows.map(([,value])=>value == null ? NaN : Number(value));
        if (countsByStatus.some(value=>!Number.isFinite(value) || value < 0)) return state("Die Berichtsdaten sind unvollständig.");
        const total = countsByStatus.reduce((sum,value)=>sum+value,0);
        const graphic = document.createElementNS(svgNamespace,"svg");
        graphic.setAttribute("viewBox","0 0 100 100");
        graphic.setAttribute("aria-hidden","true");
        graphic.setAttribute("focusable","false");
        const legend = element("ul",undefined,"admin-donut-legend");
        legend.setAttribute("aria-label","Aufträge nach Status");
        let offset = 0;
        function ring(className) {
            const circle = document.createElementNS(svgNamespace,"circle");
            for (const [key,value] of Object.entries({cx:50,cy:50,r:38,pathLength:100,transform:"rotate(-90 50 50)"})) circle.setAttribute(key,value);
            circle.classList.add(className);
            graphic.append(circle);
            return circle;
        }
        ring("admin-donut-track");
        rows.forEach(([name],index)=>{
            const key = "admin-status-tone-"+index;
            const percent = total ? countsByStatus[index] / total * 100 : 0;
            if (percent > 0) {
                const arc = ring(key);
                arc.setAttribute("stroke-dasharray",percent+" "+(100-percent));
                arc.setAttribute("stroke-dashoffset",-offset);
                offset += percent;
            }
            const row = element("li",undefined,key);
            const swatch = element("span",undefined,"admin-donut-swatch");
            swatch.setAttribute("aria-hidden","true");
            row.append(swatch,element("span",name),element("strong",counts.format(countsByStatus[index])));
            legend.append(row);
        });
        const wrap = element("div",undefined,"admin-donut-wrap");
        const drawing = element("div",undefined,"admin-donut");
        const caption = element("p",undefined,"admin-donut-total");
        caption.append(element("strong",counts.format(total)),element("span","Aufträge"));
        drawing.append(graphic,caption);
        wrap.append(drawing,legend);
        return wrap;
    }
    function revenueChart(rows) {
        if (!rows.length) return state("Keine Daten im ausgewählten Zeitraum.");
        if (rows.some(([,amount])=>amount == null || amount === "" || !Number.isFinite(Number(amount)))) return state("Die Berichtsdaten sind unvollständig.");
        const amounts = rows.map(([,amount])=>Number(amount));
        const highest = Math.max(0,...amounts), lowest = Math.min(0,...amounts);
        const step = 10 ** Math.floor(Math.log10(Math.max(1,highest,-lowest)));
        const tick = step/4;
        const upper = Math.ceil(highest/(3*tick))*3*tick || (lowest===0?3*tick:0);
        const lower = Math.floor(lowest/(3*tick))*3*tick;
        const range = upper-lower;
        const figure = element("div",undefined,"admin-revenue-chart");
        const graphic = element("div",undefined,"admin-revenue-graphic");
        graphic.setAttribute("aria-hidden","true");
        const axis = element("div",undefined,"admin-revenue-axis");
        const compact = new Intl.NumberFormat("de-DE",{maximumFractionDigits:2});
        for (let i=0;i<4;i++) {
            const tickValue=upper-i*range/3;
            axis.append(element("span",Math.abs(tickValue)>=1000?compact.format(tickValue/1000)+" Tsd. €":compact.format(tickValue)+" €"));
        }
        const plot = element("div",undefined,"admin-revenue-plot");
        const grid = element("div",undefined,"admin-revenue-lines");
        for(let i=0;i<4;i++)grid.append(element("i"));
        plot.append(grid);
        const labels = element("div",undefined,"admin-revenue-labels");
        const interval = Math.ceil(rows.length/6);
        const values = element("details",undefined,"admin-chart-values");
        const exact = element("dl");
        values.append(element("summary","Diagrammwerte anzeigen"),exact);
        rows.forEach(([date,amount],i)=>{
            const column = element("span",undefined,"admin-revenue-column");
            column.title=date+" · "+euros.format(amount);
            const fill=element("i");
            fill.style.height=Math.abs(amount)/range*100+"%";
            fill.style.bottom=(Math.min(0,amount)-lower)/range*100+"%";
            column.append(fill);
            plot.append(column);
            labels.append(element("span",i%interval===0?date:""));
            exact.append(element("dt",date),element("dd",euros.format(amount)));
        });
        for(const track of [plot,labels])track.style.setProperty("--period-count",rows.length);
        graphic.append(axis,plot,labels);
        figure.append(graphic,values);
        return figure;
    }
    function reportPath(resource, params = {}) {
        return "/api/admin/reports/"+resource+"?"+new URLSearchParams({period,...params});
    }
    function analytic(title, subtitle, request, adapt, formatter, controls, render) {
        const card = panel(title,subtitle,controls);
        card.section.classList.add("admin-analytic-card");
        return {card, refresh:mountSlot(card.body,request,data=>render ? render(adapt(data)) : chart(adapt(data),title,formatter,Boolean(controls)))};
    }
    function buildAnalytics() {
        const filters = element("label","Zeitraum ");
        const select = element("select");
        for (const [key,label] of [["today","Heute"],["week","Diese Woche"],["month","Dieser Monat"],["year","Dieses Jahr"]]) {
            const option = element("option",label);
            option.value = key;
            select.append(option);
        }
        select.value = period;
        filters.append(select);
        const analytics = element("div",undefined,"admin-analytics-section");
        const grid = element("div",undefined,"admin-home-grid admin-analytics-grid");
        const dateText = (row,groupBy) => groupBy==="month"?row.date.slice(5,7)+"/"+row.date.slice(0,4):shortDate.format(new Date(row.date));
        let revenuePeriod, revenueRead;
        const revenue = () => {
            const path = reportPath("revenue");
            if (path !== revenuePeriod) { revenuePeriod = path; revenueRead = shareRead(() => api(path)); }
            return revenueRead();
        };
        const cards = [
            analytic("Rechnungsentwicklung","Fakturierte Bruttobeträge nach Rechnungsdatum",
                ()=>api(reportPath("trends",{metric:"revenue"})),
                result=>result.data.series.map(row=>[dateText(row,result.meta.groupBy),row.gross]),euros,filters,revenueChart),
            analytic("Auftragsstatus","Aktueller Status der im Zeitraum angelegten Aufträge",
                ()=>api(reportPath("orders")),result=>[["Neu",result.data.new_orders],["Aktiv",result.data.active_orders],["Erledigt",result.data.completed_orders],["Storniert",result.data.cancelled_orders]],counts,null,orderDonut),
            analytic("Mitarbeitereinsätze","Bis zu sechs Mitarbeitende nach erfassten Arbeitsstunden",
                ()=>api(reportPath("rankings",{type:"employees",limit:"6"})),
                result=>result.data.items.filter(item=>Number(item.work_hours)>0).map(item=>[item.label,item.work_hours]),workingDuration),
            analytic("Finanzübersicht","Gebuchte Transaktionen im gewählten Zeitraum",
                revenue,result=>[["Gebuchte Einnahmen",result.data.financial_income],["Gebuchte Ausgaben",result.data.expenses]],euros)
        ];
        grid.append(...cards.slice(1).map(item=>item.card.section));
        analytics.append(grid);
        const refresh = () => Promise.all(cards.map(item=>item.refresh()));
        select.addEventListener("change",()=>{period=select.value;refresh();});
        return {lead:cards[0].card.section,section:analytics,refresh};
    }
    function queueCard(title, target, request, adapt, empty) {
        const body = element("div");
        return {title,target,body,refresh:mountSlot(body,request,result=>list(adapt(result),empty,title))};
    }
    function dailyPanel(queues) {
        const links = queues.map(queue=>button("Alle anzeigen",()=>navigate(queue.target)));
        const action = element("div");
        const card = panel("Tagesgeschäft",null,action);
        card.section.classList.add("admin-daily");
        const tabs = element("div",undefined,"admin-daily-tabs");
        tabs.setAttribute("role","tablist");
        tabs.setAttribute("aria-label","Tagesgeschäft");
        const labels = queues.map((queue,index)=>{
            const tab = button(queue.title,()=>select(index),"admin-daily-tab");
            tab.id = "admin-daily-tab-"+index;
            tab.setAttribute("role","tab");
            tab.setAttribute("aria-controls","admin-daily-panel-"+index);
            queue.body.id = "admin-daily-panel-"+index;
            queue.body.setAttribute("role","tabpanel");
            queue.body.setAttribute("aria-labelledby",tab.id);
            queue.body.tabIndex=0;
            tabs.append(tab);
            return tab;
        });
        function select(index,focus=false) {
            labels.forEach((tab,i)=>{
                tab.setAttribute("aria-selected",String(i===index));
                tab.tabIndex=i===index?0:-1;
                queues[i].body.hidden=i!==index;
            });
            action.replaceChildren(links[index]);
            if (focus) labels[index].focus();
        }
        tabs.addEventListener("keydown",event=>{
            const index = labels.indexOf(event.target);
            if (index<0) return;
            const next = {ArrowRight:(index+1)%labels.length,ArrowLeft:(index+labels.length-1)%labels.length,Home:0,End:labels.length-1}[event.key];
            if (next===undefined) return;
            event.preventDefault();
            select(next,true);
        });
        select(0);
        card.body.append(tabs,...queues.map(queue=>queue.body));
        return card.section;
    }
    function finishQuickActions() {
        const dialog = element("dialog",undefined,"admin-quick");
        dialog.setAttribute("aria-labelledby","admin-quick-title");
        const heading = element("h2","Schnellaktionen");
        heading.id = "admin-quick-title";
        const list = element("div",undefined,"admin-quick-links");
        const links = [
            ["Neuen Kunden anlegen","customer","create-customer-button"],
            ["Auftrag erstellen","order","create-order-button"],
            ["Vertrag erfassen","contract","register-existing-contract"],
            ["Angebot erstellen","offer","create-offer-button"],
            ["Mitarbeiter einladen","employee","create-employee-button"]
        ];
        for (const [name,target,action] of links) list.append(button(name,()=>{dialog.close();navigate(target,action);},"button button-light"));
        const booking = element("a","Termin erstellen","button button-light");
        booking.href = "/public/termin-buchen.html";
        list.append(booking,button("Schließen",()=>dialog.close(),"button button-light"));
        dialog.append(heading,list);
        return dialog;
    }
    function load() {
        generation += 1;
        const now = new Date();
        const day = isoDay.format(now);
        const headline = element("div",undefined,"admin-headline");
        const quick = finishQuickActions();
        headline.append(element("p",dayLabel.format(new Date(day))),button("＋ Schnellaktionen",()=>quick.showModal(),"button button-primary"));
        const executive = element("div",undefined,"admin-executive");
        const overview = element("div",undefined,"admin-overview-slot");
        const activeCustomer = element("div",undefined,"admin-customer-summary");
        const alerts = panel("Handlungsbedarf","Offene Vorgänge in der Verwaltung");
        const calendar = queueCard("Heutige Einsätze","schedule",
            ()=>api("/api/admin/employee-schedules?date="+day),
            result=>result.employees.flatMap(person=>person.assignments.map(assignment=>[
                assignment.title || assignment.order_number,String(assignment.start_time).slice(0,5)+" Uhr · "+person.first_name+" "+person.last_name,
                assignment.absence_review_required?"Abwesenheit prüfen":statusName(assignment.status),assignment.absence_review_required?"warn":""
            ])).sort((a,b)=>a[1].localeCompare(b[1])).slice(0,5),"Keine Einsätze zugewiesen.");
        const bookings = queueCard("Kommende Termine","appointment",
            ()=>Promise.all(Array.from({length:7},async (_,index)=>{
                const date = datePlus(day,index);
                const {rows} = await api("/api/admin/appointments?status=confirmed&date="+date);
                return rows.map(item=>({...item,date}));
            })),
            results=>results.flat().filter(item=>item.date!==day || String(item.start_time).slice(0,5)>=berlinClock.format(now))
                .slice(0,5).map(item=>[item.service,[shortDate.format(new Date(item.date)),String(item.start_time).slice(0,5)+" Uhr",item.city].filter(Boolean).join(" · "),statusName(item.status),"ok"]),
            "Keine bestätigten Buchungen in den nächsten 7 Tagen.");
        const activeStaff = queueCard("Aktive Mitarbeiter","attendance",
            ()=>api("/api/admin/attendance?status=OPEN&page_size=5"),
            result=>result.rows.map(item=>[item.first_name+" "+item.last_name,item.title || item.order_number,"Eingecheckt","ok"]),
            "Derzeit ist niemand eingecheckt.");
        const reports = queueCard("Offene Leistungsnachweise","action-center",
            ()=>api("/api/admin/action-center?area=service_reports&page_size=4"),
            result=>result.items.map(item=>[item.title,item.description,"Offen","warn"]),
            "Keine fehlenden Leistungsnachweise.");
        const review = queueCard("Leistungsnachweise zur Prüfung","service-report",
            ()=>api("/api/admin/service-reports?status=SUBMITTED"),
            result=>result.rows.slice(0,4).map(item=>[
                item.order_title || item.report_number,item.employee_first_name+" "+item.employee_last_name,"Eingereicht","warn"
            ]),"Keine eingereichten Nachweise zur Prüfung.");
        const analytics = buildAnalytics();
        const spotlight = element("div",undefined,"admin-home-grid admin-spotlight-grid");
        spotlight.append(analytics.lead,alerts.section);
        const operations = dailyPanel([calendar,bookings,activeStaff,reports,review]);
        executive.append(headline,overview,spotlight,operations,analytics.section,quick);
        host.replaceChildren(executive);
        const readHome = shareRead(() => api("/api/admin/home"));
        const loadBase = mountSlot(overview,readHome,({day,operations:o,finance:f})=>{
            const cards = element("div",undefined,"portal-home-grid admin-executive-summary");
            const finance = metric([
                ["Ausgestellte Rechnungen",value(f.issued_amount,euros),value(f.invoice_count)+" Rechnungen · brutto","invoice","invoice","blue"],
                ["Zahlungseingänge",value(f.monthly_payments,euros),"Erfasste Zahlungen · dieser Monat","reporting","finance","green"],
                ["Offene Forderungen",value(f.outstanding_amount,euros),"Offener Gesamtbetrag","invoice","attendance","blue"],
                ["Überfällige Rechnungen",value(f.overdue_amount,euros),value(f.overdue_count)+" überfällige Rechnungen","invoice","action-center","amber"]
            ]);
            cards.append(finance,operationalStats([
                ["Heutige Aufträge",o.scheduled,"schedule"],
                ["Abgeschlossene Aufträge",o.completed,"order"],
                ["Aktive Check-ins",o.checked_in,"attendance"],
                ["Unterbesetzte Aufträge",o.understaffed,"recurring"],
                ["Ausstehende Urlaubsanträge",o.vacation_requests,"schedule"],
                ["Aufträge ohne Zuweisung",o.unassigned,"order"]
            ],activeCustomer));
            return cards;
        },{loading:"Übersicht wird geladen …",error:"Übersicht konnte nicht geladen werden."});
        const loadAlerts = mountSlot(alerts.body,readHome,({operations:o})=>{
            const grouped = element("div");
            const rows = element("ul",undefined,"admin-row-list");
            const overflow = element("details",undefined,"admin-urgent-more");
            const further = element("ul",undefined,"admin-row-list");
            overflow.append(element("summary","Weitere Hinweise"),further);
            const alerts = [
                ["Abwesenheitskonflikte",o.absence_conflicts,"schedule"],["Einsatzüberschneidungen",o.overlaps,"schedule"],
                ["Beschwerden",o.complaints,"quality"],["Offene Kundenanfragen",o.service_requests,"quote"],["Lagerwarnungen",o.low_stock,"materials"],
                ["Unterbesetzte Aufträge",o.understaffed,"recurring"],["Angebote mit Handlungsbedarf",o.quotes,"offer"],["Rechnungsentwürfe",o.invoice_drafts,"invoice"]
            ];
            alerts.forEach(([label,raw,target],i)=>{
                const item = element("li",undefined,"admin-row");
                item.append(button(label,()=>navigate(target)),element("span",value(raw),"admin-badge"+(Number(raw)>0?" warn":"")));
                (i<5?rows:further).append(item);
            });
            const all=button("Alle Vorgänge anzeigen",()=>navigate("action-center"));
            all.append(icon("arrow"));
            grouped.append(rows,overflow,all);
            return grouped;
        },{retryLabel:"Handlungsbedarf erneut laden"});
        const loadCustomers = mountSlot(activeCustomer,()=>api("/api/admin/reports/customers?period=month"),
            result=>{
                const link=button("",()=>navigate("customer"),"admin-link admin-customer-link");
                link.append(icon("customer"),element("strong",value(result.data.active_customers)),document.createTextNode(" aktive Kunden "),icon("arrow"));
                return link;
            });
        return Promise.all([loadBase(),loadAlerts(),loadCustomers(),calendar.refresh(),bookings.refresh(),activeStaff.refresh(),reports.refresh(),review.refresh(),analytics.refresh(),updateUnread()]);
    }
    const themeKey = "zo-admin-theme";
    function setTheme(theme) {
        document.documentElement.dataset.adminTheme = theme;
        get("admin-theme").setAttribute("aria-pressed",String(theme==="dark"));
    }
    setTheme(localStorage.getItem(themeKey)==="dark"?"dark":"light");
    function cycleTheme() {
        const next = document.documentElement.dataset.adminTheme==="dark"?"light":"dark";
        localStorage.setItem(themeKey,next);
        setTheme(next);
    }
    get("admin-theme").addEventListener("click",cycleTheme);
    function syncDrawer() {
        if (!mobile.matches && drawer.open) drawer.close();
        if (!drawer.open && sidebar.parentElement!==dashboard) dashboard.prepend(sidebar);
        toggle.setAttribute("aria-expanded",String(mobile.matches?drawer.open:dashboard.dataset.compact!=="true"));
        toggle.setAttribute("aria-controls",mobile.matches?"admin-nav-drawer":"admin-sidebar");
    }
    toggle.addEventListener("click",()=>{
        if (mobile.matches) {
            drawer.append(sidebar);
            drawer.showModal();
        } else dashboard.dataset.compact = String(dashboard.dataset.compact!=="true");
        syncDrawer();
    });
    get("admin-nav-close").addEventListener("click",()=>drawer.close());
    drawer.addEventListener("close",syncDrawer);
    mobile.addEventListener("change",syncDrawer);
    syncDrawer();
    function updateNavigation(type) {
        current = type;
        if (type!=="home") generation += 1;
        for (const item of sidebar.querySelectorAll(".nav-item")) {
            if (item.dataset.type===type) item.setAttribute("aria-current","page");
            else item.removeAttribute("aria-current");
        }
        get("admin-crumb").textContent = get("page-title").textContent;
        get("admin-search-shortcut").hidden = !searchableModules.has(type);
    }
    let pendingUnread;
    async function updateUnread(force = false) {
        if (pendingUnread && !force) return pendingUnread;
        const request = ++unreadGeneration;
        const badge = get("admin-unread");
        const task = (async()=>{
            try {
                const {total} = await api("/api/admin/notifications?state=unread");
                if (request!==unreadGeneration || dashboard.hidden) return;
                if (!Number.isInteger(total)) return;
                badge.hidden = false;
                badge.textContent = total===200?"200+":value(total);
                get("admin-notifications").setAttribute("aria-label","Benachrichtigungen, "+badge.textContent+" ungelesen");
            } catch {
                if (request!==unreadGeneration) return;
                badge.hidden = true;
                get("admin-notifications").setAttribute("aria-label","Benachrichtigungen");
            }
        })();
        pendingUnread = task;
        try { await task; } finally { if (pendingUnread===task) pendingUnread=undefined; }
    }
    function clear() {
        generation += 1;
        unreadGeneration += 1;
        pendingUnread = undefined;
        host.replaceChildren();
        get("admin-unread").hidden = true;
        get("admin-notifications").removeAttribute("aria-label");
        get("admin-account").open = false;
        if (drawer.open) drawer.close();
    }
    get("admin-search-shortcut").addEventListener("click",()=>get("search-input").focus());
    dashboard.addEventListener("click",event=>{
        const nav = event.target.closest(".nav-item");
        if (nav && drawer.open) { drawer.close(); get("page-title").focus({preventScroll:true}); }
        const target = event.target.closest("[data-admin-go]")?.dataset.adminGo;
        if (target) navigate(target);
        const submenu = event.target.closest("[data-admin-nav]")?.dataset.adminNav;
        if (submenu==="absence") {
            navigate("schedule");
            const title = get("absence-request-title");
            title.tabIndex = -1;
            title.focus();
        }
        if (submenu==="settings") {
            if (drawer.open) drawer.close();
            const dialog = element("dialog",undefined,"admin-preferences");
            dialog.setAttribute("aria-label","Darstellungseinstellungen");
            dialog.append(element("h2","Darstellung"),button("Farbschema wechseln",cycleTheme,"button button-light"),
                button("Schließen",()=>dialog.close(),"button button-light"));
            dialog.addEventListener("close",()=>{dialog.remove(); if(mobile.matches)toggle.focus();},{once:true});
            dashboard.append(dialog);
            dialog.showModal();
        }
        if (get("admin-account").open && !get("admin-account").contains(event.target)) get("admin-account").open=false;
    });
    get("admin-account").addEventListener("keydown",event=>{
        if(event.key==="Escape"){get("admin-account").open=false;get("admin-account").querySelector("summary").focus();}
    });
    return {load,clear,updateNavigation,updateUnread};
})();
