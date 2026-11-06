
/* ==================================================
   ZOICAS & OSINSKI
   CINEMATIC JAVASCRIPT
================================================== */

document.addEventListener("DOMContentLoaded", () => {

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

