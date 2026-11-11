# Premium frontend design guide

## Direction
Editorial campus / technical workspace: deep navy hero panels, precise blue actions, slate body text, Inter variable typography and generous but purposeful spacing. This is a distinct CampusFlow identity, not copied Apple branding.

## System and files
- `public/app.css`: shared tokens, sidebar layout, hero, cards, responsive forms, focus states, dark colors, Gantt and table containers.
- `public/app.js`: theme, password visibility, event filtering, deletion confirmation, GSAP entrance timelines, ScrollTrigger depth and desktop breadcrumb scroll behavior.
- `views/partials/header.ejs`: desktop sidebar and mobile navigation, branding, account controls and breadcrumbs.
- `views/login.ejs` and `views/dashboard.ejs`: redesigned editorial compositions with actual records, not fabricated metrics.
- All other EJS routes use the same components: events, venues, editors, registrations, simulator, saved runs, SQL reports and error screens.
- `public/fonts`: local Inter variable font and SIL Open Font License.
- `public/vendor`: local Bootstrap, GSAP 3.15.0 and ScrollTrigger with license notices.

## Motion
GSAP animates transform and opacity on entrance. ScrollTrigger adds subtle six-pixel depth to selected panels. Only the hero action has a small fine-pointer magnetic interaction. The desktop breadcrumb bar can retreat while scrolling down; the sidebar stays available. Forms submit immediately and charts are never animated into fake values. There is no blocking preloader, custom cursor, scroll hijacking or forced full-screen dashboard. Reduced-motion preference stops and clears motion; touch pointers do not get magnetic behavior. Missing GSAP leaves all content usable.

## Progressive enhancement
Server-rendered content starts visible. JavaScript-only controls use `hidden data-enhance`, revealed by app.js. Without JavaScript, the login and server forms remain usable and the inactive theme/search/password controls are not shown. Authentication, CSRF, authorization, capacity and scheduling validation are always server-side.

Theme follows system colors until chosen explicitly; `campusflow-theme` is a browser-only localStorage preference. Event search filters loaded cards only. Wide tables stay inside focusable horizontal scrolling regions. Narrow timeline segments are explained by exact interval chips below the chart. Status always includes text, not just color.

## Scope
A working academic prototype, not a production-readiness or accessibility certification. Browser evidence covers local Chromium desktop and emulated mobile viewports, not every device or assistive technology.

## Additional skill refinements
Text sizes use rem units; native select labels reserve arrow space; mobile CSV inputs use the 16px default-root baseline. Sticky chrome reserves focus scroll clearance and success notifications use polite status semantics. These refinements follow the requested jakubkrehel skills; see ADDITIONAL_SKILL_REVIEW.md for executed checks and limitations.

## Apple-style interaction refinements
Press feedback begins immediately, entrances settle in 350ms, and reduced-transparency/increased-contrast preferences produce solid chrome. Reduced-motion users do not get a magnetic exit tween. These use the existing vanilla CSS/GSAP stack and are informed by emilkowalski/skills. No physical-device frame-rate guarantee is asserted.
