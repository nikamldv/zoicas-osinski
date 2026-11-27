"use strict";
(() => {
    const toggle=document.getElementById("customer-theme"),key="zo-customer-theme";
    let theme="light";
    try{if(localStorage.getItem(key)==="dark")theme="dark";}catch{}
    function apply(){
        document.documentElement.dataset.customerTheme=theme;
        toggle.setAttribute("aria-pressed",String(theme==="dark"));
    }
    apply();
    toggle.addEventListener("click",()=>{
        theme=theme==="dark"?"light":"dark";
        try{localStorage.setItem(key,theme);}catch{}
        apply();
    });
    const dashboard=document.getElementById("customer-dashboard");
    if(!dashboard)return;
    const rail=document.getElementById("customer-rail"),menu=document.getElementById("customer-menu");
    const more=document.getElementById("customer-menu-toggle"),close=document.getElementById("customer-menu-close");
    const title=document.getElementById("portal-title"),bottom=document.querySelector(".customer-bottom");
    const mobile=matchMedia("(max-width:900px)");
    let moving=false;
    function sync(){
        if(!mobile.matches&&menu.open)menu.close();
        if(!menu.open&&rail.parentElement!==dashboard)dashboard.prepend(rail);
        more.setAttribute("aria-expanded",String(menu.open));
    }
    more.addEventListener("click",()=>{menu.append(rail);menu.showModal();sync();close.focus();});
    close.addEventListener("click",()=>menu.close());
    menu.addEventListener("close",()=>{sync();if(moving){moving=false;title.focus();}});
    rail.addEventListener("click",event=>{
        if(menu.open&&event.target.closest("[data-portal-view]")){moving=true;menu.close();}
    });
    mobile.addEventListener("change",sync);
    bottom.addEventListener("click",event=>{
        const tab=event.target.closest("[data-customer-tab]");
        if(!tab)return;
        rail.querySelector('[data-portal-view="'+tab.dataset.customerTab+'"]').click();
        title.focus();
    });
    document.addEventListener("customer-view-change",event=>{
        const view=event.detail;
        for(const button of bottom.querySelectorAll("button")){
            if(button.dataset.customerTab===view || button===more&&!["home","appointments","invoices"].includes(view))
                button.setAttribute("aria-current","page");
            else button.removeAttribute("aria-current");
        }
    });
})();
