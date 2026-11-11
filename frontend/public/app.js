"use strict";
document.querySelectorAll("[data-enhance]").forEach((element) => {
  element.hidden = false;
});
// Progressive enhancement only. Authentication, validation, and writes stay server-side.
document.querySelectorAll("form[data-confirm]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});
const root = document.documentElement;
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
try {
  const choice = localStorage.getItem("campusflow-theme");
  if (choice === "light" || choice === "dark") root.dataset.theme = choice;
} catch {
  /* Storage may be disabled; the system theme still works. */
}
const themeButtons = document.querySelectorAll(".theme-toggle");
function themeLabel() {
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : systemDark.matches;
  themeButtons.forEach((button) => {
    button.setAttribute(
      "aria-label",
      "Switch to " + (dark ? "light" : "dark") + " theme",
    );
    button.title = button.getAttribute("aria-label");
  });
}
themeButtons.forEach((button) =>
  button.addEventListener("click", () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : systemDark.matches;
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("campusflow-theme", root.dataset.theme);
    } catch {
      /* Optional preference. */
    }
    themeLabel();
  }),
);
systemDark.addEventListener("change", themeLabel);
themeLabel();
document.querySelectorAll(".password-toggle").forEach((button) => {
  const input = button.parentElement.querySelector("input");
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    button.setAttribute("aria-pressed", String(show));
  });
});
const search = document.querySelector("#event-search");
if (search) {
  const cards = Array.from(document.querySelectorAll("[data-event-card]"));
  const count = document.querySelector("#event-count");
  const empty = document.querySelector(".search-empty");
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      card.hidden = !card.textContent.toLocaleLowerCase().includes(query);
      if (!card.hidden) visible++;
    });
    count.textContent = `${visible} ${visible === 1 ? "event" : "events"}`;
    empty.hidden = visible !== 0 || cards.length === 0;
  });
}

// Premium-frontend-ui motion: no scroll hijacking, no blocking loader, no hidden content.
window.__campusMotionReady = false;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
function startMotion() {
  if (reduceMotion.matches || !window.gsap) {
    window.__campusMotionReady = true;
    return;
  }
  const gsap = window.gsap;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  const targets = document.querySelectorAll(
    ".split-heading span, .page-heading, .metric-grid .metric, .login-card, .overview-next",
  );
  const timeline = gsap.timeline({
    onComplete() {
      gsap.set(targets, { clearProps: "transform,opacity,willChange" });
      window.__campusMotionReady = true;
    },
  });
  timeline
    .fromTo(
      ".entry-line",
      { scaleX: 0, opacity: 1 },
      { scaleX: 1, duration: 0.35, ease: "power2.out" },
      0,
    )
    .to(".entry-line", { opacity: 0, duration: 0.2 }, 0.35);
  if (targets.length)
    timeline.fromTo(
      targets,
      { y: 14, opacity: 0.85 },
      { y: 0, opacity: 1, duration: 0.35, stagger: 0.035, ease: "power3.out" },
      0,
    );
  if (window.ScrollTrigger) {
    document
      .querySelectorAll(".learning-panel, .schedule-result")
      .forEach((element) => {
        gsap.fromTo(
          element,
          { y: 6 },
          {
            y: 0,
            ease: "none",
            scrollTrigger: {
              trigger: element,
              start: "top bottom",
              end: "top 70%",
              scrub: 0.25,
            },
          },
        );
      });
  }
}
startMotion();
reduceMotion.addEventListener("change", () => {
  if (reduceMotion.matches && window.gsap) {
    window.ScrollTrigger?.getAll().forEach((trigger) => trigger.kill());
    window.gsap.killTweensOf("*");
    window.gsap.set(
      ".split-heading span, .page-heading, .metric, .login-card, .overview-next, .learning-panel, .schedule-result",
      { clearProps: "transform,opacity,willChange" },
    );
    window.__campusMotionReady = true;
  }
});
// Desktop breadcrumb reacts to direction; keyboard focus always brings it back.
const topbar = document.querySelector(".app-topbar");
topbar?.addEventListener("focusin", () => topbar.classList.remove("scroll-away"));
let lastScroll = window.scrollY,
  queued = false;
window.addEventListener(
  "scroll",
  () => {
    if (!topbar || queued || reduceMotion.matches) return;
    queued = true;
    requestAnimationFrame(() => {
      const current = window.scrollY;
      const focused = topbar.contains(document.activeElement);
      topbar.classList.toggle(
        "scroll-away",
        !focused && current > 140 && current > lastScroll + 3,
      );
      if (current < lastScroll - 3 || current < 140 || focused)
        topbar.classList.remove("scroll-away");
      lastScroll = current;
      queued = false;
    });
  },
  { passive: true },
);
// A small magnetic response on primary hero actions only, never on touch screens.
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
document.querySelectorAll(".btn-hero").forEach((button) => {
  button.addEventListener("pointermove", (event) => {
    if (!finePointer.matches || reduceMotion.matches || !window.gsap) return;
    const bounds = button.getBoundingClientRect();
    window.gsap.to(button, {
      x: (event.clientX - bounds.left - bounds.width / 2) * 0.035,
      y: (event.clientY - bounds.top - bounds.height / 2) * 0.04,
      duration: 0.25,
      ease: "power2.out",
      overwrite: true,
    });
  });
  button.addEventListener("pointerleave", () => {
    if (reduceMotion.matches) {
      window.gsap?.killTweensOf(button);
      window.gsap?.set(button, { clearProps: "transform" });
      return;
    }
    if (window.gsap)
      window.gsap.to(button, {
        x: 0,
        y: 0,
        duration: 0.3,
        ease: "power2.out",
        overwrite: true,
        onComplete() {
          window.gsap.set(button, { clearProps: "transform" });
        },
      });
  });
});
