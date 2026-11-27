"use strict";
(() => {
    const theme = document.getElementById("employee-theme");
    const key = "zo-employee-theme";
    function apply(value) {
        document.documentElement.dataset.employeeTheme = value;
        theme.setAttribute("aria-pressed",String(value==="dark"));
    }
    let active = "light";
    try { if(localStorage.getItem(key)==="dark")active="dark"; } catch {}
    apply(active);
    theme.addEventListener("click",()=>{
        active=active==="dark"?"light":"dark";
        try { localStorage.setItem(key,active); } catch {}
        apply(active);
    });

    const dashboard = document.getElementById("employee-dashboard");
    if(!dashboard)return;
    const sidebar = document.getElementById("employee-menu-items");
    const menu = document.getElementById("employee-more-menu");
    const bottom = document.querySelector(".employee-bottom");
    const more = document.getElementById("employee-more");
    const close = document.getElementById("employee-navigation-close");
    const mobile = matchMedia("(max-width:900px)");
    const title = document.getElementById("employee-title");
    let moveFocus = false;
    function sync() {
        if(!mobile.matches && menu.open)menu.close();
        if(!menu.open && sidebar.parentElement!==dashboard)dashboard.prepend(sidebar);
        more.setAttribute("aria-expanded",String(menu.open));
    }
    more.addEventListener("click",()=>{
        menu.append(sidebar);
        menu.showModal();
        sync();
        close.focus();
    });
    close.addEventListener("click",()=>menu.close());
    menu.addEventListener("close",()=>{
        sync();
        if(moveFocus){moveFocus=false;title.focus();}
    });
    sidebar.addEventListener("click",event=>{
        if(menu.open&&event.target.closest("[data-employee-view]")){
            moveFocus=true;
            menu.close();
        }
    });
    mobile.addEventListener("change",sync);
    bottom.addEventListener("click",event=>{
        const target=event.target.closest("[data-worker-tab]");
        if(!target)return;
        sidebar.querySelector('[data-employee-view="'+target.dataset.workerTab+'"]').click();
        title.focus();
    });
    document.addEventListener("employee-view-change",event=>{
        const type=event.detail;
        const selected=button=>button.dataset.workerTab===type || button.id==="employee-more"&&!["overview","orders","work"].includes(type);
        for(const button of bottom.querySelectorAll("button")){
            if(selected(button))button.setAttribute("aria-current","page");
            else button.removeAttribute("aria-current");
        }
    });
})();
