
/* ==================================================
   ZOICAS & OSINSKI
   CINEMATIC JAVASCRIPT
================================================== */

document.addEventListener("DOMContentLoaded", () => {

    // One shared public navigation/footer keeps every website page consistent.
    const isServicePage = window.location.pathname.includes("/leistungen/");
    const publicPrefix = isServicePage ? "../" : window.location.pathname.includes("/public/") ? "" : "public/";
    const homePrefix = isServicePage ? "../../" : window.location.pathname.includes("/public/") ? "../" : "";
    const servicePrefix = isServicePage ? "" : `${publicPrefix}leistungen/`;
    const navMarkup = `
        <a href="${homePrefix}index.html#home">Startseite</a>
        <a href="${homePrefix}index.html#leistungen">Leistungen</a>
        <a href="${publicPrefix}ueber-uns.html">Über uns</a>
        <a href="${publicPrefix}einsatzgebiete.html">Einsatzgebiete</a>
        <a href="${publicPrefix}referenzen.html">Referenzen</a>
        <a href="${publicPrefix}karriere.html">Karriere</a>
        <a href="${publicPrefix}faq.html">FAQ</a>
        <a class="portal-link" href="${publicPrefix}kundenportal.html">Kundenportal</a>
        <a class="mobile-nav-cta" href="${publicPrefix}kontakt.html">Kontakt aufnehmen →</a>`;
    document.querySelectorAll(".main-nav").forEach(nav => { nav.innerHTML = navMarkup; });
    document.querySelectorAll(".header-cta").forEach(link => { link.href = `${publicPrefix}angebot.html`; link.textContent = "Angebot anfordern →"; });
    document.querySelectorAll(".site-footer").forEach(footer => {
        footer.innerHTML = `<div class="footer-main"><div class="footer-column footer-about"><a href="${homePrefix}index.html#home" class="footer-brand">ZOICAS &amp; OSINSKI<span>REINIGUNGSSERVICE</span></a><p>Mehr Zeit für Sie. Mehr Qualität für Ihr Zuhause.</p><a class="footer-region" href="${publicPrefix}einsatzgebiete.html">Erfurt &amp; Umgebung bis 200 km</a></div><nav class="footer-column"><h3>Navigation</h3><a href="${homePrefix}index.html#home">Startseite</a><a href="${homePrefix}index.html#leistungen">Leistungen</a><a href="${publicPrefix}ueber-uns.html">Über uns</a><a href="${publicPrefix}referenzen.html">Referenzen</a><a href="${publicPrefix}karriere.html">Karriere</a></nav><nav class="footer-column"><h3>Service</h3><a href="${publicPrefix}angebot.html">Angebot anfordern</a><a href="${publicPrefix}termin-buchen.html">Termin buchen</a><a href="${publicPrefix}faq.html">FAQ</a><a href="${publicPrefix}kundenportal.html">Kundenportal</a></nav><div class="footer-column footer-contact"><h3>Kontakt</h3><a href="tel:+4915562875968">+49 1556 2875968</a><a href="mailto:zoicasundosinski@gmail.com">zoicasundosinski@gmail.com</a><a href="${publicPrefix}kontakt.html">Kontakt aufnehmen →</a></div></div><div class="footer-bottom"><span>© 2026 Zoicas &amp; Osinski.</span><div><a href="${publicPrefix}impressum.html">Impressum</a><a href="${publicPrefix}datenschutz.html">Datenschutz</a></div></div>`;
    });

    // Keep the growing services menu and essential public pages reachable from every page.
    const specialistServices = [
        ["bueroreinigung.html", "Büroreinigung"],
        ["fensterreinigung.html", "Fensterreinigung"],
        ["grundreinigung.html", "Grundreinigung"],
        ["treppenhausreinigung.html", "Treppenhausreinigung"],
        ["bauendreinigung.html", "Bauendreinigung"],
        ["praxis-gewerbereinigung.html", "Praxis-/Gewerbereinigung"]
    ];
    document.querySelectorAll(".nav-dropdown-menu").forEach(menu => {
        specialistServices.forEach(([file, label]) => {
            if (!menu.querySelector(`a[href$="${file}"]`)) {
                const link = document.createElement("a");
                link.href = `${servicePrefix}${file}`;
                link.textContent = label;
                menu.append(link);
            }
        });
    });
    document.querySelectorAll(".header-inner").forEach(headerInner => {
        if (headerInner.querySelector(".booking-cta")) return;
        const isPublic = window.location.pathname.includes("/public/");
        const bookingPrefix = isServicePage ? "../" : isPublic ? "" : "public/";
        const link = document.createElement("a");
        link.className = "booking-cta";
        link.href = `${bookingPrefix}termin-buchen.html`;
        link.textContent = "Termin buchen";
        const headerCta = headerInner.querySelector(".header-cta");
        if (headerCta) headerInner.insertBefore(link, headerCta);
    });

    // MOBILE NAVIGATION
    const menuToggle = document.querySelector(".menu-toggle");
    const mainNav = document.querySelector(".main-nav");
    const navLinks = document.querySelectorAll(".main-nav a");
    const dropdowns = document.querySelectorAll(".nav-dropdown");

    function closeDropdowns() {
        dropdowns.forEach(dropdown => {
            dropdown.classList.remove("open");
            const toggle = dropdown.querySelector(".nav-dropdown-toggle");
            if (toggle) toggle.setAttribute("aria-expanded", "false");
        });
    }

    dropdowns.forEach(dropdown => {
        const toggle = dropdown.querySelector(".nav-dropdown-toggle");
        if (!toggle) return;

        toggle.addEventListener("click", () => {
            const isOpen = dropdown.classList.toggle("open");
            toggle.setAttribute("aria-expanded", String(isOpen));
        });
    });

    if (menuToggle && mainNav) {

        menuToggle.addEventListener("click", () => {
            const isOpen = mainNav.classList.toggle("active");

            menuToggle.setAttribute(
                "aria-expanded",
                String(isOpen)
            );
        });

        navLinks.forEach(link => {
            link.addEventListener("click", () => {
                mainNav.classList.remove("active");
                menuToggle.setAttribute("aria-expanded", "false");
                closeDropdowns();
            });
        });

        document.addEventListener("click", event => {
            const clickedInsideMenu =
                mainNav.contains(event.target) ||
                menuToggle.contains(event.target);

            if (!clickedInsideMenu) {
                mainNav.classList.remove("active");
                menuToggle.setAttribute("aria-expanded", "false");
                closeDropdowns();
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            closeDropdowns();
            mainNav.classList.remove("active");
            menuToggle.setAttribute("aria-expanded", "false");
        });
    }


    // HEADER SCROLL EFFECT
    const header = document.querySelector(".site-header");

    function updateHeader() {
        if (!header) return;

        header.classList.toggle(
            "scrolled",
            window.scrollY > 40
        );
    }

    window.addEventListener("scroll", updateHeader, {
        passive: true
    });

    updateHeader();


    // SCROLL REVEAL ANIMATIONS
    const revealElements = document.querySelectorAll(
        ".section-heading, .service-card, " +
        ".renovation-content, .about-content, " +
        ".about-visual, .benefit-item, " +
        ".reference-placeholder, .career-section, " +
        ".contact-intro, .contact-form"
    );

    if ("IntersectionObserver" in window) {

        const observer = new IntersectionObserver(
            (entries, currentObserver) => {

                entries.forEach(entry => {

                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");

                        currentObserver.unobserve(entry.target);
                    }

                });

            },
            {
                threshold: 0.12,
                rootMargin: "0px 0px -35px 0px"
            }
        );

        revealElements.forEach(element => {
            element.classList.add("reveal");
            observer.observe(element);
        });

    } else {
        revealElements.forEach(element => {
            element.classList.add("is-visible");
        });
    }


    // Send contact and career forms to the same-origin MySQL API.
    async function submitForm(form, endpoint, pendingMessage, fallbackMessage) {
        if (!form.reportValidity()) return;

        const note = form.querySelector(".form-note");
        const submitButton = form.querySelector('button[type="submit"]');
        const values = Object.fromEntries(new FormData(form).entries());

        if (submitButton) submitButton.disabled = true;
        if (note) note.textContent = pendingMessage;

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values)
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                if (note) note.textContent = result.message || fallbackMessage;
                return;
            }

            if (note) note.textContent = result.message || "Ihre Angaben wurden übermittelt.";
            form.reset();
        } catch {
            if (note) note.textContent = fallbackMessage;
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    }

    const careerForm = document.querySelector("#career-form");
    if (careerForm) {
        careerForm.addEventListener("submit", event => {
            event.preventDefault();
            submitForm(
                careerForm,
                "/api/career",
                "Ihre Bewerbung wird übermittelt …",
                "Der Versand ist derzeit nicht verfügbar. Bitte schreiben Sie an zoicasundosinski@gmail.com."
            );
        });
    }

    const contactForm = document.querySelector("#contact-form");
    if (contactForm) {
        contactForm.addEventListener("submit", event => {
            event.preventDefault();
            submitForm(
                contactForm,
                "/api/contact",
                "Ihre Anfrage wird übermittelt …",
                "Der Versand ist derzeit nicht verfügbar. Bitte schreiben Sie an zoicasundosinski@gmail.com."
            );
        });
    }

    // Quote request form uses multipart data so optional JPG, PNG and PDF files can be sent safely.
    const quoteForm = document.querySelector("#quote-form");
    if (quoteForm) {
        const quoteFiles = document.querySelector("#quote-files");
        const fileList = document.querySelector("#quote-file-list");
        const quoteService = document.querySelector("#quote-service");
        const prefilledService = new URLSearchParams(window.location.search).get("service");
        if (prefilledService && Array.from(quoteService.options).some(option => option.value === prefilledService)) {
            quoteService.value = prefilledService;
        }
        quoteFiles?.addEventListener("change", () => {
            const files = Array.from(quoteFiles.files || []);
            fileList.textContent = files.length ? files.map(file => `${file.name} (${Math.ceil(file.size / 1024)} KB)`).join(" · ") : "";
        });
        quoteForm.addEventListener("submit", async event => {
            event.preventDefault();
            if (!quoteForm.reportValidity()) return;
            const note = quoteForm.querySelector(".form-note");
            const button = quoteForm.querySelector('button[type="submit"]');
            const files = Array.from(quoteFiles?.files || []);
            if (files.length > 5 || files.some(file => file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "application/pdf"].includes(file.type))) {
                note.textContent = "Bitte laden Sie nur bis zu 5 JPG-, PNG- oder PDF-Dateien mit jeweils maximal 5 MB hoch.";
                return;
            }
            button.disabled = true;
            note.textContent = "Ihre Angebotsanfrage wird übermittelt …";
            try {
                const response = await fetch("/api/quotes", { method: "POST", body: new FormData(quoteForm) });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.message || "Der Versand ist derzeit nicht verfügbar.");
                quoteForm.reset();
                fileList.textContent = "";
                note.textContent = result.message || "Vielen Dank für Ihre Anfrage. Wir haben Ihre Anfrage erhalten und werden uns schnellstmöglich bei Ihnen melden.";
                note.classList.add("is-success");
            } catch (error) {
                note.textContent = error.message || "Der Versand ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.";
                note.classList.remove("is-success");
            } finally { button.disabled = false; }
        });
    }

    // Online booking only displays slots supplied by the server's confirmed configuration.
    const bookingForm = document.querySelector("#booking-form");
    if (bookingForm) {
        const service = bookingForm.elements.service, date = document.querySelector("#booking-date"), slots = document.querySelector("#booking-slots"), time = document.querySelector("#booking-time"), summary = document.querySelector("#booking-summary"), note = bookingForm.querySelector(".form-note"), success = document.querySelector("#booking-success");
        date.min = new Date().toISOString().slice(0, 10);
        const updateSummary = () => {
            const values = Object.fromEntries(new FormData(bookingForm).entries());
            summary.textContent = values.service && values.preferred_date && values.start_time ? `Zusammenfassung: ${values.service} · ${values.object_type || "Objekt offen"} · ${values.area_m2 ? `${values.area_m2} m² · ` : ""}${values.preferred_date} · ${values.start_time} Uhr · ${values.first_name || ""} ${values.last_name || ""}` : "Ihre Auswahl erscheint hier vor dem Absenden.";
        };
        async function loadSlots() {
            time.value = ""; slots.innerHTML = "<p>Freie Zeiten werden geladen …</p>"; updateSummary();
            if (!service.value || !date.value) { slots.innerHTML = "<p>Bitte Dienstleistung und Datum wählen.</p>"; return; }
            try {
                const response = await fetch(`/api/appointments/availability?${new URLSearchParams({ service: service.value, date: date.value })}`), result = await response.json();
                if (!response.ok) throw new Error(result.message);
                if (!result.configured) { slots.innerHTML = `<p>${result.message}</p>`; return; }
                if (!result.availableSlots.length) { slots.innerHTML = "<p>Für dieses Datum sind keine freien Zeiten verfügbar.</p>"; return; }
                slots.innerHTML = result.availableSlots.map(slot => `<button class="booking-slot" type="button" data-slot="${slot}">${slot}</button>`).join("");
            } catch (error) { slots.innerHTML = `<p>${error.message || "Freie Zeiten konnten nicht geladen werden."}</p>`; }
        }
        service.addEventListener("change", loadSlots); date.addEventListener("change", loadSlots); bookingForm.addEventListener("input", updateSummary);
        slots.addEventListener("click", event => { const button = event.target.closest("[data-slot]"); if (!button) return; time.value = button.dataset.slot; slots.querySelectorAll(".booking-slot").forEach(slot => slot.classList.toggle("is-selected", slot === button)); updateSummary(); });
        bookingForm.addEventListener("submit", async event => {
            event.preventDefault(); if (!bookingForm.reportValidity() || !time.value) { note.textContent = "Bitte wählen Sie eine freie Uhrzeit."; return; }
            const button = bookingForm.querySelector('button[type="submit"]'); button.disabled = true; note.textContent = "Ihre Terminanfrage wird übermittelt …";
            try { const response = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(bookingForm).entries())) }), result = await response.json(); if (!response.ok) throw new Error(result.message); bookingForm.hidden = true; success.hidden = false; success.innerHTML = `<h2>Termin erfolgreich angefragt</h2><p><strong>${result.service}</strong><br>${result.date} um ${result.startTime} Uhr<br>Anfrage-ID: ${result.id}</p><p>Wir bestätigen Ihren Termin persönlich.</p>`; } catch (error) { note.textContent = error.message || "Die Terminbuchung ist derzeit nicht verfügbar."; } finally { button.disabled = false; }
        });
    }

    // Service CTAs open the quote form and carry the matching service with them.
    if (document.body.classList.contains("service-page") && !quoteForm) {
        const service = document.querySelector(".service-page-copy h1")?.textContent.trim();
        if (service) {
            document.querySelectorAll(".service-page-actions .button-primary, .service-contact-band .button-primary").forEach(link => {
                link.href = `../angebot.html?service=${encodeURIComponent(service)}`;
                link.firstChild.textContent = "Jetzt Angebot anfordern ";
            });
        }
    }

    console.log("Zoicas & Osinski cinematic website initialized.");

});


/* =========================================
   ABOUT TEAM SLIDER
========================================= */

document.addEventListener("DOMContentLoaded", function () {

    const slides = document.querySelectorAll(".about-slide");
    const dots = document.querySelectorAll(".about-dot");

    const nextBtn = document.querySelector(".about-next");
    const prevBtn = document.querySelector(".about-prev");

    if (!slides.length) return;

    let currentSlide = 0;
    let autoSlide;

    function showSlide(index) {

        slides.forEach((slide, i) => {
            slide.classList.toggle("active", i === index);
        });

        dots.forEach((dot, i) => {
            dot.classList.toggle("active", i === index);
        });

        currentSlide = index;
    }


    function nextSlide() {

        let next = currentSlide + 1;

        if (next >= slides.length) {
            next = 0;
        }

        showSlide(next);
    }


    function previousSlide() {

        let previous = currentSlide - 1;

        if (previous < 0) {
            previous = slides.length - 1;
        }

        showSlide(previous);
    }


    function startAutoSlide() {

        clearInterval(autoSlide);

        autoSlide = setInterval(() => {
            nextSlide();
        }, 5000);
    }


    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            nextSlide();
            startAutoSlide();
        });
    }


    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            previousSlide();
            startAutoSlide();
        });
    }


    dots.forEach((dot, index) => {

        dot.addEventListener("click", () => {
            showSlide(index);
            startAutoSlide();
        });

    });


    showSlide(0);
    startAutoSlide();

});

