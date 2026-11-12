"use strict";
document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("#employee-login-form");
    const note = document.querySelector("#employee-login-note");
    async function api(url, options = {}) {
        const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, credentials: "same-origin", cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Die Anmeldung ist fehlgeschlagen.");
        return data;
    }
    form.addEventListener("submit", async event => {
        event.preventDefault();
        const button = form.querySelector("button");
        button.disabled = true; note.textContent = "";
        try {
            await api("/api/employee/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
            window.location.replace("mitarbeiterportal.html");
        } catch (error) { note.textContent = error.message; } finally { button.disabled = false; }
    });
    fetch("/api/employee/session", { credentials: "same-origin", cache: "no-store" }).then(response => { if (response.ok) window.location.replace("mitarbeiterportal.html"); }).catch(() => {});
});
