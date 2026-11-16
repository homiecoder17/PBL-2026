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
const statusFilter = document.querySelector("#event-status-filter");
if (search) {
  const cards = Array.from(document.querySelectorAll("[data-event-card]"));
  const count = document.querySelector("#event-count");
  const empty = document.querySelector(".search-empty");
  const filterEvents = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const chosenStatus = statusFilter ? statusFilter.value : "all";
    let visible = 0;
    cards.forEach((card) => {
      const matchesText = card.textContent.toLocaleLowerCase().includes(query);
      const matchesStatus =
        chosenStatus === "all" || card.dataset.status === chosenStatus;
      card.hidden = !(matchesText && matchesStatus);
      if (!card.hidden) visible++;
    });
    count.textContent = `${visible} ${visible === 1 ? "event" : "events"}`;
    empty.hidden = visible !== 0 || cards.length === 0;
  };
  search.addEventListener("input", filterEvents);
  statusFilter?.addEventListener("change", filterEvents);
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

// Simulator date/venue auto-filter without inline onchange (CSP-safe) and reloading fresh DB events.
const simDate = document.querySelector("#event_date[data-auto-filter]");
const simVenue = document.querySelector("#venue_id[data-auto-filter]");
const simQuantum = document.querySelector("#quantum");
if (simDate && simVenue) {
  const navigateFilter = () => {
    const params = new URLSearchParams();
    if (simDate.value) params.set("date", simDate.value);
    if (simVenue.value) params.set("venue_id", simVenue.value);
    if (simQuantum && simQuantum.value) params.set("quantum", simQuantum.value);
    window.location.assign("/simulator?" + params.toString());
  };
  simDate.addEventListener("change", navigateFilter);
  simVenue.addEventListener("change", navigateFilter);
}

// Simulator algorithm tab switcher (CSP-safe, declutters 5-algorithm detail panels)
const algTabBtns = document.querySelectorAll(".alg-tab-btn");
const algPanels = document.querySelectorAll(".alg-result-panel");
const algCards = document.querySelectorAll(".alg-card[data-alg-card]");

if (algTabBtns.length > 0 && algPanels.length > 0) {
  const switchAlgorithm = (target) => {
    algTabBtns.forEach((btn) => {
      const match = btn.getAttribute("data-alg-target") === target;
      btn.classList.toggle("btn-primary", match);
      btn.classList.toggle("btn-outline-secondary", !match);
    });

    algCards.forEach((card) => {
      const match = card.getAttribute("data-alg-card") === target;
      card.classList.toggle("is-selected", match);
    });

    algPanels.forEach((panel) => {
      const panelAlg = panel.getAttribute("data-alg-panel");
      if (target === "all" || panelAlg === target) {
        panel.classList.remove("alg-panel-hidden");
      } else {
        panel.classList.add("alg-panel-hidden");
      }
    });
  };

  algTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-alg-target");
      if (target) switchAlgorithm(target);
    });
  });

  algCards.forEach((card) => {
    const target = card.getAttribute("data-alg-card");
    card.addEventListener("click", () => {
      if (target) switchAlgorithm(target);
      const activePanel = document.querySelector(`.alg-result-panel[data-alg-panel="${target}"]`);
      if (activePanel) {
        activePanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.click();
      }
    });
  });

  const activeBtn = document.querySelector(".alg-tab-btn.active") || algTabBtns[0];
  if (activeBtn) {
    const initialTarget = activeBtn.getAttribute("data-alg-target");
    if (initialTarget) switchAlgorithm(initialTarget);
  }
}

// Dashboard interactive monthly calendar (CSP-safe DOM construction, no innerHTML).
const calendarDataNode = document.getElementById("calendar-data");
const daysContainer = document.getElementById("calendar-days");
if (calendarDataNode && daysContainer) {
  let payload;
  try {
    payload = JSON.parse(calendarDataNode.textContent);
  } catch {
    payload = null;
  }
  if (payload) {
    const {
      eventsByDate = {},
      today = "",
      isAdmin = false,
      isFaculty = false,
    } = payload;
    let [tYear, tMonth] = today.split("-").map(Number);
    let viewYear = tYear || new Date().getFullYear();
    let viewMonth = (tMonth || 1) - 1;

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const monthYearLabel = document.getElementById("cal-month-year");
    const selectedDateCard = document.getElementById("selected-date-card");
    const selDateLabel = document.getElementById("sel-date-label");
    const selDateActions = document.getElementById("sel-date-actions");
    const selDateEvents = document.getElementById("sel-date-events");

    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      return node;
    };

    const selectDate = (dateKey, dayEvents) => {
      selectedDateCard.style.display = "block";
      selDateLabel.textContent = new Date(dateKey + "T00:00:00").toLocaleDateString(
        undefined,
        {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        },
      );

      selDateActions.replaceChildren();
      if (isAdmin) {
        const simLink = el(
          "a",
          "btn btn-primary btn-sm w-100",
          "⚡ Launch OS Scheduler for Date →",
        );
        simLink.href = "/simulator?date=" + encodeURIComponent(dateKey);
        selDateActions.appendChild(simLink);

        const newLink = el(
          "a",
          "btn btn-outline-secondary btn-sm w-100",
          "+ Create Event",
        );
        newLink.href = "/events/new?date=" + encodeURIComponent(dateKey);
        selDateActions.appendChild(newLink);
      } else if (isFaculty) {
        const regLink = el(
          "a",
          "btn btn-primary btn-sm w-100",
          "+ Register Event for Date →",
        );
        regLink.href = "/faculty/events/new?date=" + encodeURIComponent(dateKey);
        selDateActions.appendChild(regLink);

        const browseLink = el(
          "a",
          "btn btn-outline-secondary btn-sm w-100",
          "Browse All Events →",
        );
        browseLink.href = "/events";
        selDateActions.appendChild(browseLink);
      } else {
        const browseLink = el(
          "a",
          "btn btn-primary btn-sm w-100",
          "Browse All Events →",
        );
        browseLink.href = "/events";
        selDateActions.appendChild(browseLink);
      }

      selDateEvents.replaceChildren();
      if (!dayEvents || dayEvents.length === 0) {
        selDateEvents.appendChild(
          el(
            "p",
            "text-muted m-0 small-note",
            isAdmin
              ? "No events scheduled for this date. Launch the OS Scheduler to plan workloads."
              : isFaculty
                ? "No campus events scheduled for this date yet. Register a new event to enter the venue queue."
                : "No campus events scheduled for this date yet. Check nearby dates or browse the full directory.",
          ),
        );
        return;
      }

      for (const e of dayEvents) {
        const isPending = e.status === "pending_schedule";
        const regCount = Number(e.registration_count || 0);
        const maxSeats = Math.max(1, Number(e.expected_attendance || 1));
        const pct = Math.min(100, Math.round((regCount / maxSeats) * 100));

        const card = el("div", "drawer-event-card");
        const topRow = el("div", "d-flex align-items-center justify-content-between gap-2 mb-2 flex-wrap");
        topRow.appendChild(
          el(
            "span",
            "drawer-time-chip",
            `${String(e.start_time).slice(0, 5)} – ${String(e.end_time).slice(0, 5)}`,
          ),
        );
        topRow.appendChild(
          el(
            "span",
            "status " + (isPending ? "status-amber" : "status-green"),
            isPending
              ? isAdmin
                ? "Pending OS"
                : isFaculty
                  ? "In Queue"
                  : "Schedule TBA"
              : "Scheduled",
          ),
        );
        card.appendChild(topRow);
        card.appendChild(el("h4", "drawer-event-title", e.title));
        card.appendChild(el("p", "drawer-event-venue", e.venue_name));

        const gaugeWrap = el("div", "mt-2");
        const gaugeMeta = el("div", "d-flex justify-content-between small-note mb-1");
        gaugeMeta.appendChild(el("span", "", "Seating"));
        gaugeMeta.appendChild(el("span", "", `${regCount}/${maxSeats} (${pct}%)`));
        const track = el("div", "capacity-track" + (pct >= 85 ? " capacity-high" : ""));
        const fill = el("span");
        fill.style.width = `${pct}%`;
        track.appendChild(fill);
        gaugeWrap.appendChild(gaugeMeta);
        gaugeWrap.appendChild(track);
        card.appendChild(gaugeWrap);

        if (isAdmin) {
          const startH = parseInt(String(e.start_time).split(":")[0], 10) || 9;
          const arrivalH = Math.max(0, startH - 9);
          const burstH = Math.max(1, Math.ceil(Number(e.expected_attendance) / 50));
          const chips = el("div", "d-flex gap-1 flex-wrap mt-2 pt-2 border-top");
          chips.appendChild(el("span", "badge bg-light text-dark border", `AT = ${arrivalH}h`));
          chips.appendChild(el("span", "badge bg-light text-dark border", `BT = ${burstH}h`));
          card.appendChild(chips);
        }

        selDateEvents.appendChild(card);
      }
    };

    const renderCalendar = () => {
      monthYearLabel.textContent = monthNames[viewMonth] + " " + viewYear;
      daysContainer.replaceChildren();

      const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

      for (let i = firstDayIndex - 1; i >= 0; i--) {
        const cell = el("div", "calendar-day-cell inactive-month");
        cell.appendChild(
          el("span", "calendar-day-num", String(daysInPrevMonth - i)),
        );
        daysContainer.appendChild(cell);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dStr = String(d).padStart(2, "0");
        const mStr = String(viewMonth + 1).padStart(2, "0");
        const dateKey = viewYear + "-" + mStr + "-" + dStr;
        const dayEvents = eventsByDate[dateKey] || [];

        const cell = el("button", "calendar-day-cell text-start");
        cell.type = "button";
        if (dateKey === today) cell.classList.add("is-today");
        cell.appendChild(el("span", "calendar-day-num", String(d)));

        if (dayEvents.length > 0) {
          const hasPending = dayEvents.some(
            (e) => e.status === "pending_schedule",
          );
          cell.appendChild(
            el(
              "span",
              "calendar-event-pill" + (hasPending ? " pending" : ""),
              dayEvents.length + " event" + (dayEvents.length > 1 ? "s" : ""),
            ),
          );
        }

        cell.addEventListener("click", () => {
          daysContainer
            .querySelectorAll(".calendar-day-cell")
            .forEach((c) => c.classList.remove("is-selected"));
          cell.classList.add("is-selected");
          selectDate(dateKey, dayEvents);
        });

        daysContainer.appendChild(cell);
      }
    };

    document.getElementById("cal-prev")?.addEventListener("click", () => {
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      renderCalendar();
    });
    document.getElementById("cal-next")?.addEventListener("click", () => {
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      renderCalendar();
    });

    renderCalendar();
    const eventDates = Object.keys(eventsByDate);
    const targetDate = eventDates[0] || today;
    if (targetDate) selectDate(targetDate, eventsByDate[targetDate] || []);
  }
}

// Faculty hub quick event roster selector
const facultyJump = document.getElementById("faculty-event-jump");
const facultyRosterBtn = document.getElementById("faculty-open-roster-btn");
if (facultyJump && facultyRosterBtn) {
  const syncRosterHref = () => {
    const id = encodeURIComponent(facultyJump.value || "");
    if (id) facultyRosterBtn.href = `/events/${id}/attendees`;
  };
  facultyJump.addEventListener("change", syncRosterHref);
  syncRosterHref();
}
