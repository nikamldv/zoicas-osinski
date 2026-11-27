"use strict";

document.addEventListener("DOMContentLoaded",()=>{
    const form=document.querySelector("#customer-register"),note=document.querySelector("#portal-note");
    const token=new URLSearchParams(location.hash.slice(1)).get("einladung");
    if(token){
        history.replaceState(null,"",location.pathname+location.search);
        for(const name of ["first_name","last_name","email","phone"]){
            const input=form.elements.namedItem(name);
            input.disabled=true;
            input.closest("label").remove();
        }
        document.querySelector("h1").textContent="Portalzugang aktivieren";
        form.querySelector("button").textContent="Portalzugang aktivieren";
        note.textContent="Legen Sie Ihr persönliches Passwort für den eingeladenen Zugang fest.";
    }
    form.addEventListener("submit",async event=>{
        event.preventDefault();
        const button=form.querySelector("button");
        button.disabled=true;
        try {
            const body=Object.fromEntries(new FormData(form));
            if(token)body.token=token;
            const response=await fetch(token?"/api/customer/accept-invitation":"/api/customer/register",{
                method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"
            });
            const result=await response.json().catch(()=>({}));
            if(!response.ok)throw Error(result.message||"Registrierung nicht verfügbar.");
            location.replace("kunden-anmelden.html");
        }catch(error){note.textContent=error.message;button.disabled=false;}
    });
});
