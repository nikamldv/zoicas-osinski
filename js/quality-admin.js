"use strict";

/* Phase 16.8C: Admin UI only. Server authorization remains authoritative. */
let qualityPage = 1;
let qualityPages = 1;

const qualityStatuses = ["OPEN","IN_REVIEW","IN_PROGRESS","WAITING_CUSTOMER","RESOLVED","CLOSED","CANCELLED"];
const value = id => byId(id).value.trim();
const qualityDate = value => String(value || "").slice(0, 10);
const qualityOverdue = row => row.due_date && !["RESOLVED","CLOSED","CANCELLED"].includes(row.status) && qualityDate(row.due_date) < new Date().toISOString().slice(0,10);

function qualityParams(overrides = {}) {
    const query = new URLSearchParams({ page: String(overrides.page || qualityPage), page_size: String(overrides.pageSize || 25) });
    [["status","quality-status"],["severity","quality-severity"],["customer_id","quality-customer"],["employee_id","quality-employee"],["order_id","quality-order"],["from","quality-from"],["to","quality-to"],["search","quality-search"]].forEach(([key,id]) => { if (value(id)) query.set(key,value(id)); });
    Object.entries(overrides).forEach(([key,item]) => { if (!["page","pageSize"].includes(key) && item) query.set(key,item); });
    return query.toString();
}

function qualityMessage(message, type = "error") { const node=byId("quality-message"); node.textContent=message; node.className=`dashboard-message${type === "success" ? " is-success" : ""}`; node.hidden=!message; }
function qualityField(label, item) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(item || "—")}</dd></div>`; }

function renderQuality(result) {
    const rows=result.rows || [];
    byId("quality-body").innerHTML=rows.map(row=>`<tr><td><strong>${escapeHtml(row.incident_number)}</strong></td><td>${escapeHtml(`${row.customer_first_name || ""} ${row.customer_last_name || ""}`.trim())}<div class="person-phone">${escapeHtml(row.customer_number || "")}</div></td><td>${escapeHtml(row.order_number || "—")}</td><td><strong>${escapeHtml(row.title)}</strong><div class="person-phone">${escapeHtml(row.category)}</div></td><td><span class="quality-badge severity-${escapeHtml(row.severity)}">${escapeHtml(row.severity)}</span></td><td><span class="quality-badge status-${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td><td>${escapeHtml(`${row.assigned_employee_first_name || ""} ${row.assigned_employee_last_name || ""}`.trim() || "—")}</td><td class="${qualityOverdue(row) ? "quality-overdue" : ""}">${escapeHtml(qualityDate(row.due_date) || "—")}</td><td>${escapeHtml(formatDate(row.created_at))}</td><td><button class="detail-button" type="button" data-quality-detail="${Number(row.id)}">Details</button></td></tr>`).join("");
    byId("quality-empty").hidden=rows.length !== 0;
    byId("quality-page-info").textContent=result.total ? `Seite ${result.page} von ${result.totalPages} · ${result.total} Einträge` : "Keine Einträge";
    byId("quality-page-number").textContent=String(result.page || 1);
    byId("quality-previous").disabled=(result.page || 1) <= 1;
    byId("quality-next").disabled=(result.page || 1) >= (result.totalPages || 1);
}

async function loadQualityCards() {
    const [open, critical, resolved, allRows] = await Promise.all([
        api(`/api/admin/quality-incidents?${qualityParams({page:1,pageSize:1,status:"OPEN"})}`),
        api(`/api/admin/quality-incidents?${qualityParams({page:1,pageSize:1,severity:"CRITICAL"})}`),
        api(`/api/admin/quality-incidents?${qualityParams({page:1,pageSize:1,status:"RESOLVED"})}`),
        loadAllQualityRows()
    ]);
    const overdue=allRows.filter(qualityOverdue).length;
    byId("quality-cards").innerHTML=[["Offene Vorfälle",open.total],["Kritische Vorfälle",critical.total],["Überfällige Vorfälle",overdue],["Gelöste Vorfälle",resolved.total]].map(([label,count])=>`<article class="finance-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(count || 0))}</strong></article>`).join("");
    byId("nav-quality-count").textContent=String(open.total || 0);
}

async function loadAllQualityRows() {
    const first=await api(`/api/admin/quality-incidents?${qualityParams({page:1,pageSize:100})}`);
    const batches=[first];
    for(let page=2;page<=Number(first.totalPages||1);page++) batches.push(await api(`/api/admin/quality-incidents?${qualityParams({page,pageSize:100})}`));
    return batches.flatMap(result=>result.rows || []);
}

async function loadQualityIncidents() {
    qualityMessage("");
    try {
        const result=await api(`/api/admin/quality-incidents?${qualityParams()}`);
        qualityPages=result.totalPages || 1;
        if (qualityPage > qualityPages) { qualityPage=qualityPages; return loadQualityIncidents(); }
        renderQuality(result);
        await loadQualityCards();
    } catch(error) {
        byId("quality-body").replaceChildren(); byId("quality-empty").hidden=false;
        qualityMessage(error.status === 401 ? "Sitzung abgelaufen. Bitte melden Sie sich erneut an." : error.message);
        if (error.status === 401) showLogin("Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");
    }
}
window.loadQualityIncidents=loadQualityIncidents;

function formPayload(form) { const payload=Object.fromEntries(new FormData(form)); ["order_id","assignment_id","service_report_id","assigned_employee_id","due_date","internal_notes","root_cause"].forEach(key=>{if(!payload[key])payload[key]="";}); return payload; }

function openQualityForm(incident = null) {
    const form=byId("quality-form"); form.reset(); byId("quality-form-note").hidden=true;
    form.elements.id.value=incident?.id || "";
    byId("quality-dialog-title").textContent=incident ? `Vorfall ${incident.incident_number} bearbeiten` : "Neuen Vorfall erstellen";
    if (incident) ["customer_id","order_id","assignment_id","service_report_id","assigned_employee_id","category","severity","title","description","internal_notes","root_cause","due_date"].forEach(key=>{ if(form.elements[key]) form.elements[key].value=key === "due_date" ? qualityDate(incident[key]) : incident[key] || ""; });
    byId("quality-dialog").showModal();
}

function openQualityAction(incidentId, action = null) {
    const form=byId("quality-action-form"); form.reset(); byId("quality-action-note").hidden=true;
    form.elements.incident_id.value=incidentId; form.elements.action_id.value=action?.id || "";
    byId("quality-action-title").textContent=action ? "Korrekturmaßnahme bearbeiten" : "Korrekturmaßnahme anlegen";
    if(action) ["assigned_employee_id","due_date","status","title","description"].forEach(key=>{if(form.elements[key])form.elements[key].value=key === "due_date" ? qualityDate(action[key]) : action[key] || "";});
    byId("quality-action-dialog").showModal();
}

async function openQualityIncident(id) {
    const result=await api(`/api/admin/quality-incidents/${id}`), incident=result.incident;
    byId("quality-detail-title").textContent=incident.incident_number;
    byId("quality-detail-values").innerHTML=[
        ["Status",incident.status],["Schweregrad",incident.severity],["Kunde",`${incident.customer_first_name || ""} ${incident.customer_last_name || ""} · ${incident.customer_number || ""}`],["Auftrag",incident.order_number || "—"],["Einsatz",incident.assignment_id ? `#${incident.assignment_id}` : "—"],["Leistungsnachweis",incident.service_report_id ? `#${incident.service_report_id}` : "—"],["Mitarbeiter",`${incident.assigned_employee_first_name || ""} ${incident.assigned_employee_last_name || ""}`.trim() || "—"],["Fällig",qualityDate(incident.due_date) || "—"],["Gelöst",formatDate(incident.resolved_at)],["Geschlossen",formatDate(incident.closed_at)]
    ].map(([label,item])=>qualityField(label,item)).join("");
    byId("quality-detail-description").textContent=incident.description || "—";
    byId("quality-detail-notes").textContent=incident.internal_notes || "—";
    byId("quality-detail-cause").textContent=incident.root_cause || "—";
    byId("quality-actions-list").innerHTML=(incident.actions || []).map(action=>`<article class="assignment-row"><div><strong>${escapeHtml(action.title)}</strong><br><span>${escapeHtml(action.status)} · ${escapeHtml(qualityDate(action.due_date) || "ohne Frist")} · ${escapeHtml(`${action.first_name || ""} ${action.last_name || ""}`.trim() || "nicht zugewiesen")}</span></div><button class="detail-button" type="button" data-quality-action-edit="${Number(action.id)}">Bearbeiten</button></article>`).join("") || '<p class="empty-copy">Noch keine Korrekturmaßnahme.</p>';
    const actions=byId("quality-detail-actions"); actions.replaceChildren();
    const add=(label,handler,primary=false)=>{const button=document.createElement("button");button.type="button";button.className=`button ${primary ? "button-primary" : "button-light"}`;button.textContent=label;button.addEventListener("click",handler);actions.append(button);};
    if(!["CLOSED","CANCELLED"].includes(incident.status)) add("Bearbeiten",()=>openQualityForm(incident));
    if(!["RESOLVED","CLOSED","CANCELLED"].includes(incident.status)) add("Maßnahme hinzufügen",()=>openQualityAction(incident.id),true);
    if(["IN_PROGRESS","WAITING_CUSTOMER"].includes(incident.status)) add("Als gelöst markieren",()=>runQualityWorkflow(incident.id,"resolve"),true);
    if(incident.status === "RESOLVED") add("Vorfall schließen",()=>{if(window.confirm("Vorfall wirklich schließen?"))runQualityWorkflow(incident.id,"close");},true);
    byId("quality-detail-dialog").showModal();
    byId("quality-actions-list").onclick=event=>{const button=event.target.closest("[data-quality-action-edit]");if(!button)return;openQualityAction(incident.id,(incident.actions || []).find(action=>Number(action.id)===Number(button.dataset.qualityActionEdit)));};
}
window.openQualityIncident=openQualityIncident;

async function runQualityWorkflow(id, action) { try { const result=await api(`/api/admin/quality-incidents/${id}/${action}`,{method:"POST",body:"{}"}); byId("quality-detail-dialog").close(); setNotice(result.message,"success"); await loadQualityIncidents(); await openQualityIncident(id); } catch(error) { setNotice(error.message); } }

byId("quality-create").addEventListener("click",()=>openQualityForm());
byId("quality-refresh").addEventListener("click",()=>{qualityPage=1;loadQualityIncidents();});
byId("quality-apply").addEventListener("click",()=>{qualityPage=1;loadQualityIncidents();});
byId("quality-clear").addEventListener("click",()=>{document.querySelectorAll("#quality-panel input,#quality-panel select").forEach(field=>field.value="");qualityPage=1;loadQualityIncidents();});
byId("quality-search").addEventListener("input",()=>{window.clearTimeout(window.qualitySearchTimer);window.qualitySearchTimer=window.setTimeout(()=>{qualityPage=1;loadQualityIncidents();},300);});
byId("quality-previous").addEventListener("click",()=>{if(qualityPage>1){qualityPage--;loadQualityIncidents();}});
byId("quality-next").addEventListener("click",()=>{if(qualityPage<qualityPages){qualityPage++;loadQualityIncidents();}});
byId("quality-body").addEventListener("click",event=>{const button=event.target.closest("[data-quality-detail]");if(button)openQualityIncident(button.dataset.qualityDetail).catch(error=>qualityMessage(error.message));});
byId("quality-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,id=form.elements.id.value,note=byId("quality-form-note"),submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;try{const result=await api(id?`/api/admin/quality-incidents/${id}`:"/api/admin/quality-incidents",{method:id?"PATCH":"POST",body:JSON.stringify(formPayload(form))});byId("quality-dialog").close();setNotice(result.message,"success");await loadQualityIncidents();if(id)await openQualityIncident(id);}catch(error){note.textContent=error.message;note.hidden=false;}finally{submit.disabled=false;}});
byId("quality-action-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,incidentId=form.elements.incident_id.value,actionId=form.elements.action_id.value,note=byId("quality-action-note"),submit=form.querySelector('[type="submit"]'),payload=Object.fromEntries(new FormData(form));if(submit.disabled)return;submit.disabled=true;delete payload.incident_id;delete payload.action_id;["assigned_employee_id","due_date","description"].forEach(key=>{if(!payload[key])payload[key]="";});try{const result=await api(`/api/admin/quality-incidents/${incidentId}/actions${actionId?`/${actionId}`:""}`,{method:actionId?"PATCH":"POST",body:JSON.stringify(payload)});byId("quality-action-dialog").close();setNotice(result.message,"success");await loadQualityIncidents();await openQualityIncident(incidentId);}catch(error){note.textContent=error.message;note.hidden=false;}finally{submit.disabled=false;}});

byId("action-center-body").addEventListener("click",event=>{const button=event.target.closest('[data-action-target="quality"]');if(!button)return;window.setTimeout(async()=>{try{await loadQualityIncidents();if(button.dataset.actionId)await openQualityIncident(button.dataset.actionId);}catch(error){qualityMessage(error.message);}},0);});
