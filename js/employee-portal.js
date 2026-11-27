"use strict";
document.addEventListener("DOMContentLoaded", () => {
    const $ = selector => document.querySelector(selector);
    const scrollToSection = element => element.scrollIntoView({
        behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block:"start"
    });
    const state = { employee: null, tasks: [], orders: [], workLogs: [], attendance: { current: null, assignments: [], rows: [] }, locationSimulation: null, documents: [], notifications: [], materialConsumptions: [], availableMaterials: [], cashPayments: [], serviceReports: [], qualityActions: [], qualityActionBusy: false, materialBusy: false, attendanceBusy: false, locationSimulationBusy: false, serviceReportPage: 1, scheduleWeek: false };
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    const berlinDate = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"});
    function localDay(value) {
        const text=String(value||"");
        if(/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)){
            const date=new Date(text);
            if(Number.isFinite(date.getTime()))return berlinDate.format(date);
        }
        return text.slice(0,10);
    }
    let displayDate;
    const dateText = value => value ? (displayDate ??= new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" })).format(new Date(`${localDay(value)}T00:00:00`)) : "—";
    const showNotice = (message, success = false) => { const node = $("#employee-notice"); node.textContent = message; node.hidden = !message; node.classList.toggle("is-success", success); };
    async function api(url, options = {}) { const headers = new Headers(options.headers || {}); if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json"); const response = await fetch(url, { ...options, headers, credentials: "same-origin", cache: "no-store" }); const data = await response.json().catch(() => ({})); if (response.status===401) location.replace("mitarbeiter-anmelden.html"); if (!response.ok) { const error = new Error(data.message || "Die Anfrage ist fehlgeschlagen."); error.status = response.status; throw error; } return data; }
    function taskSelects() { const options = state.tasks.filter(task => task.status !== "CANCELLED").map(task => `<option value="${task.id}">${escapeHtml(task.title)}</option>`).join(""); const orderOptions = state.orders.map(order => `<option value="${order.id}">${escapeHtml(order.order_number)} · ${escapeHtml(order.title)}</option>`).join(""); $("#work-task").innerHTML = `<option value="">Ohne Zuordnung</option>${options}`; $("#work-order").innerHTML = `<option value="">Ohne Zuordnung</option>${orderOptions}`; $("#document-task").innerHTML = `<option value="">Aufgabe wählen</option>${options}`; $("#document-order").innerHTML = `<option value="">Ohne Auftragsbezug</option>${orderOptions}`; }
    const berlinToday = () => berlinDate.format(new Date());
    function renderTasks() { const container = $("#task-list"), today = berlinToday(); const rows = state.tasks.map(task => `<article class="employee-row"><div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.description || "Keine Beschreibung")}</p><small>${dateText(task.scheduled_date)} · ${escapeHtml(task.priority)} · ${escapeHtml(task.status)}</small></div><form class="task-update" data-task-id="${task.id}"><select name="status" aria-label="Aufgabenstatus">${["OPEN","IN_PROGRESS","COMPLETED","CANCELLED"].map(status => `<option ${status === task.status ? "selected" : ""}>${status}</option>`).join("")}</select><textarea name="employee_notes" aria-label="Eigene Notiz" maxlength="4000" placeholder="Eigene Notiz">${escapeHtml(task.employee_notes || "")}</textarea><button class="button button-light" type="submit">Speichern</button></form></article>`).join(""); container.innerHTML = rows || "<p class=\"empty-copy\">Keine Aufgaben zugewiesen.</p>"; $("#overview-tasks").innerHTML = state.tasks.filter(task => String(task.scheduled_date || "").slice(0,10) === today).map(task => `<article class="employee-row"><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.status)} · ${escapeHtml(task.priority)}</small></div></article>`).join("") || "<p class=\"empty-copy\">Heute sind keine Aufgaben geplant.</p>"; document.querySelectorAll(".task-update").forEach(form => form.addEventListener("submit", async event => { event.preventDefault(); try { await api(`/api/employee/tasks/${form.dataset.taskId}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); showNotice("Aufgabe gespeichert.", true); await loadTasks(); } catch (error) { showNotice(error.message); } })); }
    function renderWorkLogs() { const today = berlinToday(); const minutes = state.workLogs.filter(row => String(row.work_date).slice(0,10) === today).reduce((total,row) => total + ((Number(String(row.end_time).slice(0,2))*60 + Number(String(row.end_time).slice(3,5))) - (Number(String(row.start_time).slice(0,2))*60 + Number(String(row.start_time).slice(3,5))) - Number(row.break_minutes || 0)),0); $("#overview-hours").textContent = `${Math.max(minutes,0)/60}`.replace(/\.0$/, "") + " h"; $("#work-log-list").innerHTML = state.workLogs.map(row => `<article class="employee-row"><div><strong>${dateText(row.work_date)}</strong><p>${String(row.start_time).slice(0,5)} – ${String(row.end_time).slice(0,5)} · Pause ${row.break_minutes} Min.</p><small>${escapeHtml(row.notes || "")}</small></div></article>`).join("") || "<p class=\"empty-copy\">Noch keine Arbeitszeiten erfasst.</p>"; }
    function renderDocuments() { $("#document-list").innerHTML = state.documents.map(document => `<article class="employee-row"><div><strong><a href="/api/employee/tasks/${document.task_id}/documents/${document.id}">${escapeHtml(document.file_name)}</a></strong><p>${escapeHtml(document.description || "Ohne Beschreibung")}</p><small>${dateText(document.created_at)} · ${Math.ceil(document.file_size / 1024)} KB${document.order_id ? ` · Auftrag #${escapeHtml(document.order_id)}` : ""}</small></div></article>`).join("") || "<p class=\"empty-copy\">Noch keine Dokumente hochgeladen.</p>"; }
    const paymentStatus = value => ({ ERFASST:"Erfasst", GEPRUEFT:"Geprüft", ABGELEHNT:"Abgelehnt", STORNIERT:"Storniert" }[value] || value || "—");
    const emailStatus = value => ({ PENDING:"Ausstehend", SENT:"Gesendet", FAILED:"Fehlgeschlagen", NOT_REQUIRED:"Nicht erforderlich" }[value] || value || "Nicht erforderlich");
    const moneyText = value => new Intl.NumberFormat("de-DE", { style:"currency", currency:"EUR" }).format(Number(value || 0));
    function selectedCustomerOrders() { const customerId = Number($("#cash-customer").value || 0); return state.orders.filter(order => Number(order.customer_id) === customerId); }
    function renderCashOrderOptions() { const select = $("#cash-order"), orders = selectedCustomerOrders(); select.disabled = !orders.length; select.innerHTML = `<option value="">${orders.length ? "Auftrag wählen" : "Zuerst Kunde wählen"}</option>${orders.map(order => `<option value="${order.id}">${escapeHtml(order.order_number)} · ${escapeHtml(order.title)}</option>`).join("")}`; $("#cash-invoice").disabled = true; $("#cash-invoice").innerHTML = '<option value="">Ohne Rechnung</option>'; }
    function renderCashPayments() { const today = new Date().toISOString().slice(0,10), month=today.slice(0,7), rows=state.cashPayments; $("#cash-payment-total").textContent=rows.length; $("#cash-payment-today").textContent=rows.filter(row=>String(row.payment_date).slice(0,10)===today).length; $("#cash-payment-month").textContent=rows.filter(row=>String(row.payment_date).slice(0,7)===month).length; $("#cash-payment-recorded").textContent=rows.filter(row=>row.status==="ERFASST").length; $("#cash-payment-approved").textContent=rows.filter(row=>row.status==="GEPRUEFT").length; $("#cash-payment-list").innerHTML=rows.map(row=>`<article class="employee-row cash-payment-row"><div><strong>${escapeHtml(row.payment_number || "Barzahlung")} · ${moneyText(row.amount)}</strong><p>${escapeHtml(`${row.first_name} ${row.last_name}`)} · ${escapeHtml(row.order_number)}</p><small>${dateText(row.payment_date)} · ${escapeHtml(row.payment_method)} · ${escapeHtml(paymentStatus(row.status))} · E-Mail: ${escapeHtml(emailStatus(row.customer_email_status))}</small></div><div class="cash-payment-actions"><button class="button button-light" type="button" data-payment-detail="${row.id}">Details</button>${Number(row.has_receipt) ? `<a class="button button-light" href="/api/employee/cash-payments/${row.id}/receipt">Beleg ansehen</a>` : ""}</div></article>`).join("") || '<p class="empty-copy">Noch keine Barzahlungen erfasst.</p>'; }
    async function loadCashPayments() { const result=await api("/api/employee/cash-payments"); state.cashPayments=result.rows || []; renderCashPayments(); const customers=[...new Map(state.orders.map(order=>[order.customer_id,order])).values()]; $("#cash-customer").innerHTML=`<option value="">Kunde wählen</option>${customers.map(order=>`<option value="${order.customer_id}">${escapeHtml(`${order.first_name} ${order.last_name}`)} · ${escapeHtml(order.customer_number || "")}</option>`).join("")}`; }
    async function loadCashInvoices() { const orderId=Number($("#cash-order").value || 0), select=$("#cash-invoice"); select.innerHTML='<option value="">Ohne Rechnung</option>'; select.disabled=true; if(!orderId)return; try { const result=await api(`/api/employee/orders/${orderId}/invoices`); select.innerHTML += (result.rows || []).filter(invoice=>invoice.status!=="STORNIERT").map(invoice=>`<option value="${invoice.id}">${escapeHtml(invoice.invoice_number)} · ${moneyText(invoice.outstanding_amount)}</option>`).join(""); select.disabled=false; } catch (error) { showNotice(error.message); } }
    async function loadTasks() { const result = await api("/api/employee/tasks"); state.tasks = result.rows; taskSelects(); renderTasks(); }
    async function loadWorkLogs() { const result = await api("/api/employee/work-logs"); state.workLogs = result.rows; renderWorkLogs(); }
    function renderAttendance() {
        const current = state.attendance.current, select = $("#attendance-assignment"), status = $("#attendance-status"), checkIn = $("#attendance-checkin-form"), checkOut = $("#attendance-checkout-form"), workForm = $("#work-log-form");
        select.innerHTML = `<option value="">Einsatz wählen</option>${state.attendance.assignments.map(item => `<option value="${Number(item.assignment_id)}">${escapeHtml(item.order_number)} · ${escapeHtml(item.title)} · ${escapeHtml(String(item.start_time).slice(0,5))}–${escapeHtml(String(item.end_time).slice(0,5))}</option>`).join("")}`;
        checkIn.hidden = Boolean(current); checkOut.hidden = !current; workForm.querySelectorAll("input,select,textarea,button").forEach(field => { field.disabled = Boolean(current); });
        if (current) status.textContent = `Eingecheckt: ${escapeHtml(current.order_number)} seit ${new Date(String(current.check_in_at).replace(" ", "T")).toLocaleTimeString("de-DE", { hour:"2-digit", minute:"2-digit" })}`;
        else if (!state.attendance.assignments.length) status.textContent = "Heute ist kein aktiver eigener Einsatz verfügbar.";
        else status.textContent = "Nicht eingecheckt";
        const elapsed=$("#attendance-elapsed");
        const raw=String(current?.check_in_at||"");
        const minutes=/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?Math.floor((Date.now()-Date.parse(raw))/60000):NaN;
        elapsed.hidden=!Number.isFinite(minutes)||minutes<0;
        if(!elapsed.hidden)elapsed.textContent="Seit Arbeitsbeginn: "+Math.floor(minutes/60)+" Std. "+minutes%60+" Min.";
    }
    function renderAttendanceVisit() {
        const visit = state.attendance.current || state.attendance.rows[0] || state.attendance.assignments[0], details = $("#attendance-visit-details");
        if (!details) return;
        if (!visit) { details.innerHTML = "<p class=\"empty-copy\">Heute ist kein eigener Einsatz verfügbar.</p>"; return; }
        const schedule = visit.start_time && visit.end_time ? `${dateText(visit.assignment_date)} · ${String(visit.start_time).slice(0,5)}–${String(visit.end_time).slice(0,5)}` : "Nicht geplant";
        const report = visit.report_status ? escapeHtml(visit.report_status === "CUSTOMER_CONFIRMED" ? "Kundenbestätigt" : visit.report_status) : "Nicht eingereicht";
        const confirmation = visit.customer_confirmed_at ? dateText(visit.customer_confirmed_at) : (visit.report_status === "SHARED" ? "Optional · ausstehend" : "Nicht erforderlich");
        const customer = `${visit.customer_first_name || ""} ${visit.customer_last_name || ""}`.trim() || "Kunde";
        details.innerHTML = `<dl><div><dt>Kunde / Auftrag</dt><dd>${escapeHtml(customer)} · ${escapeHtml(visit.order_number || "—")}</dd></div><div><dt>Geplant</dt><dd>${escapeHtml(schedule)}</dd></div><div><dt>Check-in</dt><dd>${escapeHtml(dateText(visit.check_in_at))}</dd></div><div><dt>Check-out</dt><dd>${escapeHtml(dateText(visit.check_out_at))}</dd></div><div><dt>Leistungsnachweis</dt><dd>${report}</dd></div><div><dt>Kundenbestätigung</dt><dd>${escapeHtml(confirmation)}</dd></div></dl>`;
    }
    async function loadAttendance() { const result = await api("/api/employee/attendance"); state.attendance = { current: result.current || null, assignments: result.assignments || [], rows: result.rows || [] }; renderAttendance(); renderAttendanceVisit(); renderAttendanceHistory(); renderOrders(); }
    function renderLocationSimulation() {
        const sharing = state.locationSimulation, status = $("#location-simulation-status"), start = $("#location-simulation-start"), stop = $("#location-simulation-stop"), form = $("#location-simulation-update-form");
        const active = Boolean(sharing && sharing.status === "ACTIVE");
        start.hidden = active; stop.hidden = !active; form.hidden = !active;
        if (!state.attendance.current) {
            status.textContent = "Für die Simulation ist zuerst ein offener Check-in erforderlich.";
            start.disabled = true;
        } else if (active) {
            const time = sharing.last_updated_at ? new Date(String(sharing.last_updated_at).replace(" ", "T")).toLocaleTimeString("de-DE", { hour:"2-digit", minute:"2-digit" }) : "noch keine Testkoordinaten";
            status.textContent = `Simulation aktiv · letztes Update: ${time}`;
            start.disabled = false;
        } else {
            status.textContent = "Simulation inaktiv";
            start.disabled = false;
        }
    }
    async function loadLocationSimulation() {
        try {
            const result = await api("/api/employee/location-simulation");
            $("#location-simulation-heading").closest("section").hidden = false;
            state.locationSimulation = result.sharing || null;
            renderLocationSimulation();
        } catch (error) {
            if (error.status === 404) { $("#location-simulation-heading").closest("section").hidden = true; return; }
            throw error;
        }
    }
    async function loadAppointments() { const result = await api("/api/employee/appointments"); $("#appointment-list").innerHTML = result.rows.map(row => `<article class="employee-row"><div><strong>${escapeHtml(row.service)}</strong><p>${escapeHtml(row.address)}, ${escapeHtml(row.postal_code)} ${escapeHtml(row.city)}</p><small>${dateText(row.preferred_date)} · ${String(row.start_time).slice(0,5)} Uhr · ${escapeHtml(row.task_title)}</small></div></article>`).join("") || "<p class=\"empty-copy\">Keine Termine zugeordnet.</p>"; }

    const statusText = status => ({
        GEPLANT:"Geplant", ZUGEWIESEN:"Zugewiesen", IN_BEARBEITUNG:"In Arbeit", ERLEDIGT:"Erledigt",
        OPEN:"Eingecheckt", CLOSED:"Arbeitszeit erfasst", REVIEW_REQUIRED:"Prüfung erforderlich",
        DRAFT:"Entwurf", SUBMITTED:"Eingereicht", REVIEWED:"Geprüft", SHARED:"Freigegeben",
        RETURNED:"Zurückgegeben", CUSTOMER_CONFIRMED:"Kundenbestätigt"
    })[status] || status || "—";
    function chip(status) {
        const tone = ["ERLEDIGT","CLOSED","REVIEWED","SHARED","CUSTOMER_CONFIRMED"].includes(status)?" done":
            ["REVIEW_REQUIRED","RETURNED"].includes(status)?" review":"";
        return '<span class="employee-status-chip'+tone+'">'+escapeHtml(statusText(status))+'</span>';
    }
    function slot(row) {
        return [row.start_time,row.end_time].filter(Boolean).map(time=>String(time).slice(0,5)).join("–");
    }
    function locationLabel(row) {
        return [row.address,[row.postal_code,row.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    }
    function attendanceFor(assignmentId) {
        return [state.attendance.current,...state.attendance.rows,...state.attendance.assignments]
            .find(row=>row && Number(row.assignment_id)===Number(assignmentId));
    }
    function renderNextAssignment() {
        const host=$("#employee-next-assignment");
        const today=berlinToday();
        const time=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
        const current=state.attendance.current;
        const next=current ? state.orders.find(row=>Number(row.assignment_id)===Number(current.assignment_id))||current :
            state.orders.find(row=>{
                const date=localDay(row.assignment_date);
                return !["STORNIERT","ERLEDIGT"].includes(row.assignment_status) &&
                    !["STORNIERT","ERLEDIGT"].includes(row.status) && (date>today||date===today&&String(row.end_time).slice(0,5)>=time);
            });
        host.hidden=false;
        if(!next){host.innerHTML='<p class="section-kicker">Nächster Einsatz</p><p>Derzeit ist kein weiterer Einsatz verfügbar.</p>';return;}
        const heading=current?"Aktiver Einsatz":"Nächster Einsatz";
        const schedule=[dateText(next.assignment_date),slot(next)].filter(Boolean).join(" · ");
        const address=locationLabel(next);
        host.innerHTML='<p class="section-kicker">'+heading+'</p><h2>'+escapeHtml(next.title || next.order_number)+
            '</h2><p>'+escapeHtml([schedule,next.service_type,address].filter(Boolean).join(" · "))+'</p>';
        const action=document.createElement("button");
        action.type="button";
        action.className="button button-primary";
        const target=current?"work":"orders";
        action.textContent=current?"Zur Zeiterfassung":"Einsätze ansehen";
        action.onclick=()=>openView(target);
        host.append(action);
    }
    function renderOrders() {
        const dates = new Map();
        for (const order of state.orders) {
            const day=localDay(order.assignment_date);
            if(!dates.has(day))dates.set(day,[]);
            dates.get(day).push(order);
        }
        $("#employee-order-list").innerHTML = [...dates].map(([day,orders])=>{
            const rows=orders.map(order=>{
                const visit=attendanceFor(order.assignment_id);
                const states=[order.assignment_status,visit?.status,visit?.report_status].filter(Boolean).map(chip).join("");
                const contact=[order.first_name,order.last_name].filter(Boolean).join(" ");
                return '<article class="employee-row"><div><strong>'+escapeHtml(order.title || order.order_number)+'</strong><p>'+
                    escapeHtml([order.order_number,order.service_type,contact].filter(Boolean).join(" · "))+'</p><p>'+
                    escapeHtml(locationLabel(order)||"Kein Einsatzort hinterlegt")+'</p><small>'+escapeHtml(slot(order))+'</small>'+
                    '<div class="employee-assignment-meta">'+states+'</div></div><button class="button button-light" type="button" data-order-detail="'+Number(order.id)+'">Details</button></article>';
            }).join("");
            return '<section class="employee-assignment-day"><h3>'+escapeHtml(dateText(day))+'</h3>'+rows+'</section>';
        }).join("") || '<p class="empty-copy">Keine Aufträge zugewiesen.</p>';
        renderNextAssignment();
    }
    function attendanceTime(raw) {
        if(!raw)return "—";
        const value=String(raw);
        if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) return value.slice(11,16);
        const instant=new Date(value);
        return Number.isNaN(instant.getTime())?"—":new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit"}).format(instant);
    }
    function renderAttendanceHistory() {
        $("#attendance-history").innerHTML=state.attendance.rows.filter(row=>row.check_out_at).map(row=>
            '<article class="employee-row"><div><strong>'+escapeHtml(row.title||row.order_number)+'</strong><p>'+
            escapeHtml([dateText(row.assignment_date),attendanceTime(row.check_in_at)+"–"+attendanceTime(row.check_out_at)].join(" · "))+
            '</p><div class="employee-assignment-meta">'+chip(row.status)+(row.report_status?chip(row.report_status):"")+'</div></div></article>'
        ).join("") || '<p class="empty-copy">Noch keine abgeschlossenen Anwesenheiten.</p>';
    }
    async function loadOrders() {
        const result = await api("/api/employee/orders");
        state.orders = result.rows || [];
        const today=berlinToday();
        $("#overview-completed").textContent=String(state.orders.filter(row=>
            localDay(row.assignment_date)===today&&row.assignment_status==="ERLEDIGT").length);
        taskSelects();
        renderOrders();
    }
    const serviceReportStatus = value => ({ DRAFT:"Entwurf", SUBMITTED:"Eingereicht", REVIEWED:"Geprüft", RETURNED:"Zurückgegeben", SHARED:"Freigegeben", CUSTOMER_CONFIRMED:"Kundenbestätigt", CANCELLED:"Storniert" }[value] || value || "—");
    const reportPageSize = 10;
    function reportDateTime(value) { return value ? String(value).replace(" ", "T").slice(0,16) : ""; }
    function renderServiceReportAssignments(selectedId = "") { const select=$("#employee-service-report-assignment"); select.innerHTML=`<option value="">Einsatz wählen</option>${state.orders.map(order=>`<option value="${Number(order.assignment_id)}" data-order-id="${Number(order.id)}" ${String(order.assignment_id)===String(selectedId)?"selected":""}>${escapeHtml(order.order_number)} · ${escapeHtml(order.title)} · ${escapeHtml(String(order.assignment_date||"").slice(0,10))} ${escapeHtml(String(order.start_time||"").slice(0,5))}–${escapeHtml(String(order.end_time||"").slice(0,5))}</option>`).join("")}`; }
    function filteredServiceReports() { const status=$("#employee-service-report-status").value, date=$("#employee-service-report-date").value, search=$("#employee-service-report-search").value.trim().toLocaleLowerCase("de-DE"); return state.serviceReports.filter(report=>{ const text=[report.report_number,report.order_number,report.order_title,report.customer_number,report.customer_first_name,report.customer_last_name].join(" ").toLocaleLowerCase("de-DE"); return (!status||report.status===status)&&(!date||String(report.service_date||"").slice(0,10)===date)&&(!search||text.includes(search)); }); }
    function renderServiceReports() { const reports=filteredServiceReports(), pages=Math.max(1,Math.ceil(reports.length/reportPageSize)); if(state.serviceReportPage>pages)state.serviceReportPage=pages; const first=(state.serviceReportPage-1)*reportPageSize, visible=reports.slice(first,first+reportPageSize); $("#employee-service-report-list").innerHTML=visible.map(report=>`<article class="employee-row service-report-row"><div><strong>${escapeHtml(report.report_number)}</strong><p>${escapeHtml(report.order_number)} · ${escapeHtml(report.order_title)}</p><p>Kunde: ${escapeHtml(`${report.customer_first_name||""} ${report.customer_last_name||""}`.trim())}</p><small>${dateText(report.service_date)} · ${escapeHtml(serviceReportStatus(report.status))} · Aktualisiert: ${dateText(report.updated_at)}</small>${report.status==="RETURNED"?'<p class="service-report-returned">Zur Überarbeitung zurückgegeben. Bitte korrigieren und erneut einreichen.</p>':""}</div><button class="button button-light" type="button" data-service-report-detail="${Number(report.id)}">Details</button></article>`).join("")||"<p class=\"empty-copy\">Keine Leistungsnachweise gefunden.</p>"; $("#employee-service-report-page-info").textContent=reports.length?`Einträge ${first+1}–${Math.min(first+reportPageSize,reports.length)} von ${reports.length}`:"Keine Einträge"; $("#employee-service-report-previous").disabled=state.serviceReportPage<=1; $("#employee-service-report-next").disabled=state.serviceReportPage>=pages; }
    async function loadServiceReports() { const result=await api("/api/employee/service-reports"); state.serviceReports=result.rows||[]; state.serviceReportPage=1; renderServiceReports(); }
    function openServiceReportForm(report = null) { const form=$("#employee-service-report-form"); form.reset(); renderServiceReportAssignments(report?.assignment_id||""); form.elements.id.value=report?.id||""; form.elements.order_id.value=report?.order_id||""; form.elements.service_date.value=report?String(report.service_date||"").slice(0,10):""; form.elements.started_at.value=reportDateTime(report?.started_at); form.elements.finished_at.value=reportDateTime(report?.finished_at); form.elements.summary.value=report?.summary||""; form.elements.customer_notes.value=report?.customer_notes||""; $("#employee-service-report-form-note").textContent=""; form.hidden=false; $("#service-report-create-toggle").textContent=report?"Bearbeitung schließen":"Formular schließen"; scrollToSection(form); }
    function closeServiceReportForm() { const form=$("#employee-service-report-form"); form.hidden=true; form.reset(); $("#service-report-create-toggle").textContent="+ Leistungsnachweis erstellen"; }
    function populateServiceReportTiming() { const form=$("#employee-service-report-form"), selected=state.orders.find(order=>String(order.assignment_id)===String($("#employee-service-report-assignment").value)); if(!selected)return; const date=String(selected.assignment_date||"").slice(0,10), start=String(selected.start_time||"").slice(0,5), end=String(selected.end_time||"").slice(0,5); form.elements.order_id.value=selected.id; if(!form.elements.service_date.value)form.elements.service_date.value=date; if(!form.elements.started_at.value)form.elements.started_at.value=`${date}T${start}`; if(!form.elements.finished_at.value)form.elements.finished_at.value=`${date}T${end}`; }
    async function openServiceReportDetail(id) { const result=await api(`/api/employee/service-reports/${id}`), report=result.report; $("#employee-service-report-detail-title").textContent=report.report_number; $("#employee-service-report-detail-values").innerHTML=[["Auftrag",`${report.order_number||"—"} · ${report.order_title||""}`],["Kunde",`${report.customer_first_name||""} ${report.customer_last_name||""}`.trim()],["Service-Datum",dateText(report.service_date)],["Beginn",reportDateTime(report.started_at)],["Ende",reportDateTime(report.finished_at)],["Status",serviceReportStatus(report.status)],["Erstellt",dateText(report.created_at)],["Aktualisiert",dateText(report.updated_at)],["Eingereicht",dateText(report.submitted_at)]].map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value||"—")}</dd></div>`).join(""); $("#employee-service-report-detail-summary").textContent=report.summary||"—"; $("#employee-service-report-detail-customer-notes").textContent=report.customer_notes||"—"; const actions=$("#employee-service-report-detail-actions"); actions.replaceChildren(); const add=(label,handler,primary=false)=>{const button=document.createElement("button");button.type="button";button.className=`button ${primary?"button-primary":"button-light"}`;button.textContent=label;button.addEventListener("click",handler);actions.append(button);}; if(["DRAFT","RETURNED"].includes(report.status)){add("Bearbeiten",()=>openServiceReportForm(report));add("Leistungsnachweis einreichen",()=>submitServiceReport(report.id),true);} $("#employee-service-report-detail").hidden=false; scrollToSection($("#employee-service-report-detail")); }
    async function submitServiceReport(id) { try { const result=await api(`/api/employee/service-reports/${id}/submit`,{method:"POST",body:"{}"}); showNotice(result.message,true); await loadServiceReports(); await openServiceReportDetail(id); } catch(error) { showNotice(error.message); } }
    const qualityActionStatus = value => ({ OPEN:"Offen", IN_PROGRESS:"In Bearbeitung", COMPLETED:"Erledigt", CANCELLED:"Storniert" }[value] || value || "—");
    const qualityActionOverdue = action => action.due_date && !["COMPLETED","CANCELLED"].includes(action.status) && String(action.due_date).slice(0,10) < new Date().toISOString().slice(0,10);
    function filteredQualityActions() { const status=$("#quality-actions-status").value, search=$("#quality-actions-search").value.trim().toLocaleLowerCase("de-DE"); return state.qualityActions.filter(action => { const text=[action.title,action.description,action.incident_number,action.incident_title,action.order_number,action.category].join(" ").toLocaleLowerCase("de-DE"); return (!status || action.status===status) && (!search || text.includes(search)); }); }
    function renderQualityActions() { const rows=filteredQualityActions(); $("#quality-actions-list").innerHTML=rows.map(action => `<article class="employee-row quality-action-row${qualityActionOverdue(action)?" is-overdue":""}"><div><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(action.description || "Keine Beschreibung")}</p><small>Vorfall: ${escapeHtml(action.incident_number || "—")} · ${escapeHtml(action.order_number || "Ohne Auftragsnummer")} · <span class="quality-action-status quality-action-status-${escapeHtml(action.status)}">${escapeHtml(qualityActionStatus(action.status))}</span></small><small class="quality-action-deadline">Frist: ${escapeHtml(dateText(action.due_date))}${qualityActionOverdue(action)?" · Überfällig":""}${action.completed_at?` · Erledigt: ${escapeHtml(dateText(action.completed_at))}`:""}</small></div><button class="button button-light" type="button" data-quality-action-detail="${Number(action.id)}">Details</button></article>`).join("") || '<p class="empty-copy">Keine Qualitätsmaßnahmen für die gewählten Filter.</p>'; }
    async function loadQualityActions() { $("#quality-actions-list").innerHTML='<p class="empty-copy">Qualitätsmaßnahmen werden geladen …</p>'; try { const result=await api("/api/employee/quality-actions"); state.qualityActions=result.rows || []; renderQualityActions(); } catch(error) { $("#quality-actions-list").innerHTML='<p class="empty-copy">Qualitätsmaßnahmen konnten nicht geladen werden.</p>'; showNotice(error.status===401?"Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.":error.message); } }
    async function openQualityActionDetail(id) { const result=await api(`/api/employee/quality-actions/${id}`), action=result.action; $("#quality-action-detail-title").textContent=action.title; $("#quality-action-detail-values").innerHTML=[["Status",qualityActionStatus(action.status)],["Frist",dateText(action.due_date)],["Erledigt",dateText(action.completed_at)],["Vorfall",action.incident_number],["Kategorie",action.category],["Schweregrad",action.severity],["Auftrag",action.order_number],["Erstellt",dateText(action.created_at)],["Aktualisiert",dateText(action.updated_at)]].map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "—")}</dd></div>`).join(""); $("#quality-action-detail-description").textContent=action.description || "—"; $("#quality-action-detail-incident").textContent=action.incident_title ? `${action.incident_number || "Vorfall"}: ${action.incident_title}` : (action.incident_number || "—"); const actions=$("#quality-action-detail-actions"); actions.replaceChildren(); const add=(label,status,primary=false)=>{const button=document.createElement("button"); button.type="button"; button.className=`button ${primary?"button-primary":"button-light"}`; button.textContent=label; button.addEventListener("click",()=>updateQualityAction(action.id,status)); actions.append(button);}; if(action.status==="OPEN") add("Bearbeitung beginnen","IN_PROGRESS"); if(["OPEN","IN_PROGRESS"].includes(action.status)) add("Als erledigt markieren","COMPLETED",true); $("#quality-action-detail").hidden=false; scrollToSection($("#quality-action-detail")); }
    async function updateQualityAction(id,status) { if(state.qualityActionBusy)return; const completing=status==="COMPLETED"; if(completing && !window.confirm("Möchten Sie diese Qualitätsmaßnahme wirklich als erledigt markieren?"))return; state.qualityActionBusy=true; try { const result=await api(`/api/employee/quality-actions/${id}`,{method:"PATCH",body:JSON.stringify({status})}); showNotice(result.message,true); await loadQualityActions(); await openQualityActionDetail(id); } catch(error) { showNotice(error.status===404?"Diese Maßnahme ist nicht verfügbar.":error.message); } finally { state.qualityActionBusy=false; } }
    async function loadSchedule() { const date = $("#employee-schedule-date").value || new Date().toISOString().slice(0,10); $("#employee-schedule-date").value = date; const result = await api(`/api/employee/schedule?date=${encodeURIComponent(date)}&view=${state.scheduleWeek ? "week" : "day"}`); $("#employee-schedule-week").textContent = state.scheduleWeek ? "Tag" : "Woche"; $("#employee-schedule-list").innerHTML = result.days.map(day => { const assignments = day.assignments.map(item => `<article class="employee-row schedule-order"><div><strong>${escapeHtml(item.order_number)} · ${escapeHtml(item.title)}</strong><p>${escapeHtml(item.service_type)} · Kunde: ${escapeHtml(`${item.first_name} ${item.last_name}`)}</p><small>${escapeHtml(item.start_time)}–${escapeHtml(item.end_time)} · ${escapeHtml([item.address,item.postal_code,item.city].filter(Boolean).join(", "))}</small></div></article>`).join(""); const work = day.work_hours.map(item => `${escapeHtml(item.start_time)}–${escapeHtml(item.end_time)}`).join(", ") || "Keine Arbeitszeit hinterlegt"; const absence = day.absence ? `<p class="employee-schedule-absence">${escapeHtml(day.absence.absence_type)}</p>` : ""; return `<section class="employee-schedule-day"><h3>${dateText(day.date)}</h3><p class="employee-schedule-work">Arbeitszeit: ${work}</p>${absence}${assignments || (!day.absence ? "<p class=\"empty-copy\">Frei</p>" : "")}</section>`; }).join(""); }
    async function loadDocuments() { const all = []; for (const task of state.tasks) { const result = await api(`/api/employee/tasks/${task.id}/documents`); all.push(...result.rows.map(document => ({ ...document, task_id: task.id }))); } state.documents = all; renderDocuments(); }

    const absenceLabels = {PENDING:"Offen",APPROVED:"Genehmigt",REJECTED:"Abgelehnt",WITHDRAWN:"Zurückgezogen"};
    let employeeAbsencePage = 1, employeeAbsenceBusy = false;
    const employeeAbsenceMessage = message => { $("#employee-absence-message").textContent = message; };
    async function loadEmployeeAbsences(page = employeeAbsencePage) {
        const result = await api("/api/employee/absence-requests?page="+page);
        employeeAbsencePage = page;
        const list = $("#employee-absence-list");
        list.replaceChildren();
        if (!result.rows.length) list.textContent = "Keine Anträge vorhanden.";
        for (const row of result.rows) {
            const item = document.createElement("article");
            item.className = "employee-row absence-request-card";
            const content = document.createElement("div");
            const heading = document.createElement("strong");
            heading.textContent = row.absence_type + " · " + row.start_date + " – " + row.end_date;
            const status = document.createElement("p");
            status.textContent = absenceLabels[row.status];
            content.append(heading,status);
            for (const note of [row.note,row.decision_note]) {
                if (!note) continue;
                const paragraph = document.createElement("p");
                paragraph.textContent = note;
                content.append(paragraph);
            }
            item.append(content);
            if (row.status === "PENDING") {
                const withdraw = document.createElement("button");
                withdraw.type = "button";
                withdraw.className = "button button-light";
                withdraw.dataset.withdrawAbsence = row.id;
                withdraw.textContent = "Zurückziehen";
                item.append(withdraw);
            }
            list.append(item);
        }
        $("#employee-absence-prev").disabled = page === 1;
        $("#employee-absence-next").disabled = !result.hasMore;
    }

    $("#employee-absence-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (employeeAbsenceBusy) return;
        employeeAbsenceBusy = true;
        try {
            await api("/api/employee/absence-requests",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(form)))});
            form.reset();
            employeeAbsenceMessage("Antrag eingereicht.");
            await loadEmployeeAbsences(1);
        } catch(error) { employeeAbsenceMessage(error.message); }
        finally { employeeAbsenceBusy = false; }
    });
    $("#employee-absence-list").addEventListener("click", async event => {
        const button = event.target.closest("[data-withdraw-absence]");
        if (!button || employeeAbsenceBusy || !window.confirm("Diesen offenen Antrag zurückziehen?")) return;
        employeeAbsenceBusy = true;
        try {
            await api("/api/employee/absence-requests/"+button.dataset.withdrawAbsence,{method:"PATCH",body:JSON.stringify({status:"WITHDRAWN"})});
            employeeAbsenceMessage("Antrag zurückgezogen.");
            await loadEmployeeAbsences();
        } catch(error) { employeeAbsenceMessage(error.message); }
        finally { employeeAbsenceBusy = false; }
    });
    $("#employee-absence-prev").onclick = () => loadEmployeeAbsences(employeeAbsencePage-1).catch(error=>employeeAbsenceMessage(error.message));
    $("#employee-absence-next").onclick = () => loadEmployeeAbsences(employeeAbsencePage+1).catch(error=>employeeAbsenceMessage(error.message));

    async function loadEmployeeHome() {
        const host=$("#employee-home");
        await dashboardHome(host,"employee",target=>document.querySelector(`[data-employee-view="${target}"]`).click());
        for(const section of host.querySelectorAll(".portal-home-grid > article > div")){
            if(section.scrollHeight<=section.clientHeight)continue;
            section.tabIndex=0;
            section.setAttribute("role","region");
            section.setAttribute("aria-label",section.previousElementSibling.textContent);
        }
    }

    const viewLoaders = {
        overview:loadEmployeeHome,tasks:loadTasks, appointments:loadAppointments,
        orders:loadOrders,work:()=>Promise.all([loadAttendance(),loadWorkLogs()]),
        documents:loadDocuments,schedule:loadSchedule,absence:()=>loadEmployeeAbsences(1),
        "cash-payments":loadCashPayments,"service-reports":loadServiceReports,"quality-actions":loadQualityActions,
        notifications:loadNotifications,"material-consumption":loadMaterialConsumptions,profile:loadProfile
    };
    let viewRequest=0;
    async function openView(view) {
        const id=++viewRequest;
        const heading=$("#employee-title");
        const nav=$('[data-employee-view="'+view+'"]');
        document.querySelectorAll(".employee-view").forEach(node=>{node.hidden=node.id!=="employee-"+view;});
        document.querySelectorAll("[data-employee-view]").forEach(item=>{
            item.classList.toggle("is-active",item===nav);
            if(item===nav)item.setAttribute("aria-current","page");else item.removeAttribute("aria-current");
        });
        const short={overview:"Übersicht",orders:"Einsätze",work:"Zeiterfassung"};
        heading.textContent=short[view]||nav.childNodes[0].textContent.trim();
        const descriptions={
            overview:"Ihre Einsätze und Arbeitszeit im Überblick.",orders:"Ihre Aufträge nach Einsatzdatum.",
            work:"Arbeitsbeginn, Arbeitsende und erfasste Zeiten.",notifications:"Ihre persönlichen Systemhinweise und Statusmeldungen.",
            "material-consumption":"Materialverbrauch für eigene Aufträge erfassen."
        };
        $("#employee-subtitle").textContent=descriptions[view]||"Eigene Daten und zugewiesene Aufgaben.";
        document.dispatchEvent(new CustomEvent("employee-view-change",{detail:view}));
        const status=$("#employee-view-state"),retry=$("#employee-view-retry"),skeleton=$("#employee-view-skeleton");
        status.hidden=view==="overview";status.classList.remove("error");retry.hidden=true;skeleton.hidden=false;
        $("#employee-view-message").textContent="Daten werden geladen …";
        try {
            await viewLoaders[view]?.();
            if(id===viewRequest)status.hidden=true;
        } catch (error) {
            if(id!==viewRequest||error.status===401)return;
            status.hidden=false;
            status.classList.add("error");
            skeleton.hidden=true;
            $("#employee-view-message").textContent=error.message;
            retry.hidden=false;
            retry.onclick=()=>{openView(view);heading.focus();};
        }
    }
    async function loadProfile() {
        const {employee}=await api("/api/employee/profile");
        for(const [key,value] of Object.entries(employee)){
            const input=$("#employee-profile-form").elements.namedItem(key);
            if(input)input.value=value||"";
        }
        $("#employee-email").value=employee.email||"";
        $("#employee-position").value=employee.position||"";
    }
    async function initializeDashboard() {
        const boot=$("#employee-boot"),retry=$("#employee-boot-retry");
        retry.hidden=true;
        try {
            const {employee}=await api("/api/employee/session");
            state.employee=employee;
            boot.hidden=true;
            $("#employee-dashboard").hidden=false;
            const next=$("#employee-next-assignment");
            next.hidden=false;
            next.innerHTML='<p role="status">Einsatzdaten werden geladen …</p><span class="employee-loading-line" aria-hidden="true"></span>';
            openView("overview");
            // Appointments and profile have their own loaders when their views open.
            const requests=[loadTasks(),loadOrders(),loadWorkLogs(),loadAttendance(),loadLocationSimulation()];
            const settled=await Promise.allSettled(requests);
            if(settled.some(item=>item.status==="rejected" && item.reason.status!==401))
                showNotice("Einige Informationen konnten nicht geladen werden. Öffnen Sie den jeweiligen Bereich, um es erneut zu versuchen.");
        } catch (error) {
            if(error.status===401)return;
            $("#employee-boot-message").textContent=error.message;
            retry.hidden=false;
        }
    }
    document.querySelectorAll("[data-employee-view]").forEach(button=>
        button.addEventListener("click",()=>openView(button.dataset.employeeView))
    );

    $("#employee-schedule-date").value = new Date().toISOString().slice(0,10);
    $("#employee-schedule-date").addEventListener("change", () => loadSchedule().catch(error => showNotice(error.message)));
    $("#employee-schedule-previous").addEventListener("click", () => { const date=new Date(`${$("#employee-schedule-date").value}T00:00:00`); date.setDate(date.getDate()-(state.scheduleWeek?7:1)); $("#employee-schedule-date").value=date.toISOString().slice(0,10); loadSchedule().catch(error=>showNotice(error.message)); });
    $("#employee-schedule-next").addEventListener("click", () => { const date=new Date(`${$("#employee-schedule-date").value}T00:00:00`); date.setDate(date.getDate()+(state.scheduleWeek?7:1)); $("#employee-schedule-date").value=date.toISOString().slice(0,10); loadSchedule().catch(error=>showNotice(error.message)); });
    $("#employee-schedule-week").addEventListener("click", () => { state.scheduleWeek=!state.scheduleWeek; loadSchedule().catch(error=>showNotice(error.message)); });
    $("#employee-order-list").addEventListener("click", async event => { const button = event.target.closest("[data-order-detail]"); if (!button) return; try { const result = await api(`/api/employee/orders/${button.dataset.orderDetail}`); const order = result.order; showNotice(`${order.order_number}: ${order.service_type} · ${order.first_name} ${order.last_name} · ${[order.address, order.postal_code, order.city].filter(Boolean).join(", ")} · ${order.description || "Keine Beschreibung"}`, true); } catch (error) { showNotice(error.message); } });
    $("#service-report-create-toggle").addEventListener("click", () => { const form=$("#employee-service-report-form"); if(form.hidden)openServiceReportForm();else closeServiceReportForm(); });
    $("#employee-service-report-cancel").addEventListener("click", closeServiceReportForm);
    $("#employee-service-report-assignment").addEventListener("change", populateServiceReportTiming);
    $("#employee-service-report-status").addEventListener("change", () => { state.serviceReportPage=1; renderServiceReports(); });
    $("#employee-service-report-date").addEventListener("change", () => { state.serviceReportPage=1; renderServiceReports(); });
    $("#employee-service-report-search").addEventListener("input", () => { state.serviceReportPage=1; renderServiceReports(); });
    $("#employee-service-report-previous").addEventListener("click", () => { if(state.serviceReportPage>1){state.serviceReportPage-=1;renderServiceReports();} });
    $("#employee-service-report-next").addEventListener("click", () => { state.serviceReportPage+=1;renderServiceReports(); });
    $("#employee-service-report-list").addEventListener("click", event => { const button=event.target.closest("[data-service-report-detail]"); if(button)openServiceReportDetail(button.dataset.serviceReportDetail).catch(error=>showNotice(error.message)); });
    $("#employee-service-report-detail-close").addEventListener("click", () => { $("#employee-service-report-detail").hidden=true; });
    $("#employee-service-report-form").addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget, note=$("#employee-service-report-form-note"), payload=Object.fromEntries(new FormData(form)), id=payload.id; delete payload.id; payload.internal_notes=""; if(!payload.order_id||!payload.assignment_id){note.textContent="Bitte wählen Sie einen eigenen Einsatz aus.";return;} try { const result=await api(id?`/api/employee/service-reports/${id}`:"/api/employee/service-reports",{method:id?"PATCH":"POST",body:JSON.stringify(payload)}); closeServiceReportForm(); showNotice(result.message,true); await loadServiceReports(); if(id)await openServiceReportDetail(id); } catch(error) { note.textContent=error.message; } });
    $("#quality-actions-refresh").addEventListener("click", () => loadQualityActions());
    $("#quality-actions-status").addEventListener("change", renderQualityActions);
    $("#quality-actions-search").addEventListener("input", renderQualityActions);
    $("#quality-actions-list").addEventListener("click", event => { const button=event.target.closest("[data-quality-action-detail]"); if(button)openQualityActionDetail(button.dataset.qualityActionDetail).catch(error=>showNotice(error.message)); });
    $("#quality-action-detail-close").addEventListener("click", () => { $("#quality-action-detail").hidden=true; });
    $("#cash-payment-toggle").addEventListener("click", () => { const form=$("#cash-payment-form"); form.hidden=!form.hidden; if(!form.hidden){ $("#cash-payment-toggle").textContent="Formular schließen"; form.elements.payment_date.value=new Date().toISOString().slice(0,10); } else $("#cash-payment-toggle").textContent="+ Barzahlung erfassen"; });
    $("#cash-customer").addEventListener("change", renderCashOrderOptions);
    $("#cash-order").addEventListener("change", () => loadCashInvoices().catch(error => showNotice(error.message)));
    $("#cash-payment-list").addEventListener("click", async event => { const button=event.target.closest("[data-payment-detail]"); if(!button)return; try { const result=await api(`/api/employee/cash-payments/${button.dataset.paymentDetail}`), p=result.payment; showNotice(`${p.payment_number} · ${moneyText(p.amount)} · ${p.first_name} ${p.last_name} · ${p.order_number} · ${paymentStatus(p.status)}${p.invoice_id ? ` · Rechnung #${p.invoice_id}` : ""}${p.receipt_number ? ` · Quittung ${p.receipt_number}` : ""}`, true); } catch(error){showNotice(error.message);} });
    $("#cash-payment-form").addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget, values=Object.fromEntries(new FormData(form)), note=$("#cash-payment-form-note"), file=$("#cash-receipt").files[0], amount=Number(values.amount); note.textContent=""; if(!values.customer_id){note.textContent="Bitte wählen Sie einen Kunden aus.";return;} if(!values.order_id){note.textContent="Bitte wählen Sie einen Auftrag aus.";return;} if(!Number.isFinite(amount)||amount<=0){note.textContent="Der Betrag muss größer als 0 € sein.";return;} if(!values.payment_date){note.textContent="Bitte wählen Sie ein Zahlungsdatum aus.";return;} if(!values.purpose?.trim()){note.textContent="Bitte geben Sie einen Verwendungszweck ein.";return;} if(file && (!['image/jpeg','image/png','application/pdf'].includes(file.type)||file.size>5*1024*1024)){note.textContent="Diese Datei ist nicht erlaubt.";return;} if(!values.invoice_id)delete values.invoice_id; delete values.receipt; try { const result=await api("/api/employee/cash-payments",{method:"POST",body:JSON.stringify(values)}); if(file){const receipt=new FormData();receipt.append("receipt",file);await api(`/api/employee/cash-payments/${result.id}/receipt`,{method:"POST",body:receipt});} form.reset(); renderCashOrderOptions(); form.hidden=true; $("#cash-payment-toggle").textContent="+ Barzahlung erfassen"; showNotice(`${result.message} Status: Erfasst.${file ? " Beleg sicher gespeichert." : ""}`,true); await loadCashPayments(); }catch(error){note.textContent=error.message;} });
    $("#employee-logout").addEventListener("click", async () => { await api("/api/employee/logout", { method:"POST" }); window.location.replace("mitarbeiter-anmelden.html"); });
    $("#attendance-checkin-form").addEventListener("submit", async event => { event.preventDefault(); if (state.attendanceBusy) return; const form = event.currentTarget, note = $("#attendance-checkin-note"), button = $("#attendance-checkin-submit"), payload = Object.fromEntries(new FormData(form)); note.textContent = ""; if (!payload.assignment_id) { note.textContent = "Bitte wählen Sie einen eigenen Einsatz aus."; return; } state.attendanceBusy = true; button.disabled = true; try { const result = await api("/api/employee/attendance/check-in", { method:"POST", body:JSON.stringify(payload) }); form.reset(); showNotice(result.message, true); await Promise.all([loadAttendance(), loadLocationSimulation(), loadWorkLogs()]); } catch (error) { note.textContent = error.message; } finally { state.attendanceBusy = false; button.disabled = false; } });
    $("#attendance-checkout-form").addEventListener("submit", async event => { event.preventDefault(); if (state.attendanceBusy) return; const form = event.currentTarget, note = $("#attendance-checkout-note"), button = $("#attendance-checkout-submit"), payload = Object.fromEntries(new FormData(form)); note.textContent = ""; state.attendanceBusy = true; button.disabled = true; try { const result = await api("/api/employee/attendance/check-out", { method:"POST", body:JSON.stringify(payload) }); form.reset(); showNotice(result.message, true); await Promise.all([loadAttendance(), loadLocationSimulation(), loadWorkLogs()]); } catch (error) { note.textContent = error.message; } finally { state.attendanceBusy = false; button.disabled = false; } });
    $("#location-simulation-start").addEventListener("click", async () => { if (state.locationSimulationBusy) return; state.locationSimulationBusy = true; const button=$("#location-simulation-start"); button.disabled=true; try { const result=await api("/api/employee/location-simulation/start",{method:"POST",body:JSON.stringify({})}); showNotice(result.message,true); await loadLocationSimulation(); } catch(error) { showNotice(error.message); } finally { state.locationSimulationBusy=false; button.disabled=false; } });
    $("#location-simulation-stop").addEventListener("click", async () => { if (state.locationSimulationBusy) return; state.locationSimulationBusy = true; const button=$("#location-simulation-stop"); button.disabled=true; try { const result=await api("/api/employee/location-simulation/stop",{method:"POST",body:JSON.stringify({})}); showNotice(result.message,true); await loadLocationSimulation(); } catch(error) { showNotice(error.message); } finally { state.locationSimulationBusy=false; button.disabled=false; } });
    $("#location-simulation-update-form").addEventListener("submit", async event => { event.preventDefault(); if (state.locationSimulationBusy) return; const form=event.currentTarget, note=$("#location-simulation-note"), button=$("#location-simulation-update"), payload=Object.fromEntries(new FormData(form)); note.textContent=""; payload.synthetic=true; if (!Number.isFinite(Number(payload.latitude)) || !Number.isFinite(Number(payload.longitude))) { note.textContent="Bitte geben Sie gültige synthetische Testkoordinaten ein."; return; } state.locationSimulationBusy=true; button.disabled=true; try { const result=await api("/api/employee/location-simulation/update",{method:"POST",body:JSON.stringify(payload)}); showNotice(result.message,true); await loadLocationSimulation(); } catch(error) { note.textContent=error.message; } finally { state.locationSimulationBusy=false; button.disabled=false; } });
    function bindMutation(selector, save) {
        const form = $(selector);
        form.addEventListener("submit", async event => {
            event.preventDefault();
            if(form.hasAttribute("aria-busy")) return;
            form.setAttribute("aria-busy","true");
            try { await save(form); }
            catch (error) { showNotice(error.message); }
            finally { form.removeAttribute("aria-busy"); }
        });
    }
    const jsonForm = form => JSON.stringify(Object.fromEntries(new FormData(form)));
    bindMutation("#work-log-form", async form => {
        await api("/api/employee/work-logs",{method:"POST",body:jsonForm(form)});
        form.reset();
        showNotice("Arbeitszeit gespeichert.",true);
        await loadWorkLogs();
    });
    bindMutation("#document-form", async form => {
        const data=new FormData(form);
        await api(`/api/employee/tasks/${data.get("task_id")}/documents`,{method:"POST",body:data});
        form.reset();
        showNotice("Dokument hochgeladen.",true);
        await loadDocuments();
    });
    bindMutation("#employee-profile-form", async form => {
        await api("/api/employee/profile",{method:"PATCH",body:jsonForm(form)});
        showNotice("Profil gespeichert.",true);
    });
    bindMutation("#employee-password-form", async form => {
        const result=await api("/api/employee/change-password",{method:"POST",body:jsonForm(form)});
        form.reset();
        showNotice(result.message,true);
    });
    function renderNotifications() {
        const unread = state.notifications.filter(item => !item.read_at).length;
        const badge = $("#employee-notification-count"); badge.textContent = unread; badge.hidden = !unread;
        $("#employee-notification-list").innerHTML = state.notifications.map(item => `<article class="employee-row employee-notification${item.read_at ? "" : " is-unread"}"><div><strong>${escapeHtml(item.title || "Benachrichtigung")}</strong><p>${escapeHtml(item.body || "")}</p><small>${escapeHtml(item.notification_type || "System") } · ${escapeHtml(dateText(item.created_at))}${item.read_at ? " · Gelesen" : " · Ungelesen"}</small></div>${item.read_at ? "" : `<button class="button button-light" type="button" data-notification-read="${Number(item.id)}">Als gelesen markieren</button>`}</article>`).join("") || '<p class="empty-copy">Keine Benachrichtigungen vorhanden.</p>';
    }
    async function loadNotifications() {
        $("#employee-notification-list").innerHTML = '<p class="empty-copy">Benachrichtigungen werden geladen …</p>';
        try { const result = await api("/api/employee/notifications"); state.notifications = result.rows || []; renderNotifications(); }
        catch (error) { $("#employee-notification-list").innerHTML = '<p class="empty-copy">Benachrichtigungen konnten nicht geladen werden.</p>'; showNotice(error.status === 401 ? "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an." : error.message); }
    }
    async function markNotificationRead(id) {
        try { const result = await api(`/api/employee/notifications/${Number(id)}/read`, { method:"PATCH", body:"{}" }); showNotice(result.message, true); await loadNotifications(); }
        catch (error) { showNotice(error.message); }
    }
    const materialUnitLabel = unit => ({ STUECK:"Stück", LITER:"Liter", KILOGRAMM:"Kilogramm", METER:"Meter", PACKUNG:"Packung" }[unit] || unit || "—");
    function renderMaterialConsumption() {
        const orderSelect = $("#employee-material-order"), materialSelect = $("#employee-material-id");
        orderSelect.innerHTML = `<option value="">Auftrag wählen</option>${state.orders.map(order => `<option value="${Number(order.id)}">${escapeHtml(order.order_number)} · ${escapeHtml(order.title)}</option>`).join("")}`;
        materialSelect.innerHTML = `<option value="">Material wählen</option>${state.availableMaterials.map(material => `<option value="${Number(material.id)}">${escapeHtml(material.material_number)} · ${escapeHtml(material.name)} (${escapeHtml(materialUnitLabel(material.unit))})</option>`).join("")}`;
        $("#employee-material-list").innerHTML = state.materialConsumptions.map(item => `<article class="employee-row"><div><strong>${escapeHtml(item.movement_number)} · ${escapeHtml(item.material_name)}</strong><p>${escapeHtml(item.order_number)} · ${escapeHtml(item.movement_type === "RETURN" ? "Rückgabe" : "Verbrauch")}</p><small>${escapeHtml(String(item.quantity))} ${escapeHtml(materialUnitLabel(item.unit))} · ${escapeHtml(dateText(item.movement_date))} · ${escapeHtml(item.status)}</small>${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}</div></article>`).join("") || '<p class="empty-copy">Noch keine Materialbewegungen erfasst.</p>';
    }
    async function loadMaterialConsumptions() {
        $("#employee-material-list").innerHTML = '<p class="empty-copy">Materialbewegungen werden geladen …</p>';
        try { const result = await api("/api/employee/material-consumptions"); state.materialConsumptions = result.rows || []; state.availableMaterials = result.materials || []; renderMaterialConsumption(); }
        catch (error) { $("#employee-material-list").innerHTML = '<p class="empty-copy">Materialbewegungen konnten nicht geladen werden.</p>'; showNotice(error.status === 401 ? "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an." : error.message); }
    }


    $("#employee-notifications-refresh").addEventListener("click", () => loadNotifications());
    $("#employee-notification-list").addEventListener("click", event => { const button = event.target.closest("[data-notification-read]"); if (button) markNotificationRead(button.dataset.notificationRead); });
    $("#employee-material-refresh").addEventListener("click", () => loadMaterialConsumptions());
    $("#employee-material-date").value = new Date().toISOString().slice(0,10);
    $("#employee-material-form").addEventListener("submit", async event => { event.preventDefault(); if (state.materialBusy) return; const form = event.currentTarget, note = $("#employee-material-note"), button = $("#employee-material-submit"), payload = Object.fromEntries(new FormData(form)), quantity = Number(payload.quantity); note.textContent = ""; if (!payload.order_id || !payload.material_id) { note.textContent = "Bitte wählen Sie einen eigenen Auftrag und ein Material aus."; return; } if (!Number.isFinite(quantity) || quantity <= 0) { note.textContent = "Die Menge muss größer als 0 sein."; return; } state.materialBusy = true; button.disabled = true; try { const result = await api("/api/employee/material-consumptions", { method:"POST", body:JSON.stringify(payload) }); form.reset(); $("#employee-material-date").value = new Date().toISOString().slice(0,10); showNotice(result.message, true); await loadMaterialConsumptions(); } catch (error) { note.textContent = error.message; } finally { state.materialBusy = false; button.disabled = false; } });
    $("#employee-boot-retry").addEventListener("click", initializeDashboard);
    initializeDashboard();
});
