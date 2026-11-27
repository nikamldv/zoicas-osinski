(() => {
    const role = document.currentScript.dataset.portalTheme;
    let theme = "light";
    try { if (localStorage.getItem("zo-" + role + "-theme") === "dark") theme = "dark"; } catch {}
    document.documentElement.setAttribute("data-" + role + "-theme",theme);
})();



