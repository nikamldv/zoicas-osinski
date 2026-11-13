"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("#employee-activation-form");
    const note = document.querySelector("#employee-activation-note");
    const token = new URLSearchParams(window.location.search).get("token") || "";
    document.querySelector("#employee-invite-token").value = token;

    async function api(url, options = {}) {
        const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, credentials: "same-origin", cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || "Die Anfrage konnte nicht verarbeitet werden.");
        return body;
    }

    if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
        form.querySelector("button").disabled = true;
        note.textContent = "Der Einladungslink ist ungültig. Bitte fordern Sie einen neuen Link bei der Verwaltung an.";
        return;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        const button = form.querySelector("button");
        button.disabled = true;
        note.textContent = "";
        try {
            await api("/api/employee/activate", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
            window.location.replace("mitarbeiterportal.html");
        } catch (error) {
            note.textContent = error.message;
            button.disabled = false;
        }
    });
});
