document.addEventListener("DOMContentLoaded", () => {
  const headers = document.querySelectorAll(".header");

  headers.forEach((header) => {
    const toggle = header.querySelector(".mobile-menu-toggle");
    const nav = header.querySelector(".nav");

    if (!toggle || !nav) return;

    const closeMenu = () => {
      header.classList.remove("is-menu-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Abrir menu");
    };

    toggle.addEventListener("click", () => {
      const isOpen = header.classList.toggle("is-menu-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Fechar menu" : "Abrir menu");
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 768) {
          closeMenu();
        }
      });
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 768) {
        closeMenu();
      }
    });
  });
});
