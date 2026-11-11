# Verification report — JavaScript premium frontend edition

## Executed environment

Linux sandbox, Node.js 24.14.1, npm 11.11.0, real MySQL 8.4.9 (InnoDB), local Chromium through Playwright. Testing used isolated local accounts and databases; no credentials are included. Screenshot dates reflect the test environment clock and sample records, not fixed dates required to run the app.

## Results

| Verification | Actual result |
|---|---|
| JavaScript syntax (`node --check`, including bundled Bootstrap JavaScript) | 25 JavaScript files passed |
| EJS template compilation | 16 templates passed |
| Executed native test suite with MySQL enabled | 74 passed, 0 failed, 0 skipped |
| Unit coverage | 25 tests: passwords, hash compatibility, scheduling, validation and signed inputs |
| MySQL/application integration coverage | 49 tests using actual queries, HTTP requests and transactions |
| Generated scheduling property checks | 300 workloads × 2 algorithms inside one test |
| Browser workflows | 38 core page states + 4 additional skill-check states, 0 uncaught JavaScript errors, 0 page-level horizontal overflow |
| Account initializer in a real terminal (retained backend evidence) (retained backend evidence) (retained backend evidence) | Exit 0; 4 hidden password prompts; plaintext password not echoed |
| Dependency audit | 0 reported vulnerabilities at verification time |
| Clean archive installation | See `CLEAN_INSTALL.md` |

JavaScript has no separate compilation build here. Every project JavaScript file was syntax-checked, every EJS template compiled, and runtime behavior was exercised. SQL initialization and the application queries ran against real MySQL; fake database responses were not substituted.

## Browser verification

Admin/student login, incorrect-login feedback, event create/edit/delete, venue CRUD, overlapping booking rejection, FCFS/SJF comparison, save/retrieve, student registration/history, forbidden admin route, all four report queries, mobile navigation and forms, internal table scrolling, OS dark theme, manual theme switching, event search/empty results, password reveal/hide, and reduced motion.

Screenshots are in `screenshots/`; machine-readable page-state results are in `browser-checks.json`. The browser automation waits for the GSAP entrance-ready signal, local font loading, finite animations and collapsed navigation transitions before taking screenshots. Manual visual inspection covered the rendered routes and states. UI uses locally served Bootstrap, Inter variable typography, SVG icons, GSAP 3.15.0 and ScrollTrigger. Additional checks confirmed Inter loaded, GSAP was available, and the no-JavaScript login rendered without inactive enhancement controls.

Core text contrast checks: normal text on white 16.02:1; muted text on light canvas 5.26:1; blue/white action text 5.83:1; hero text 13.31:1; dark primary text 13.88:1; dark muted text 8.56:1; dark accent on tinted surface 6.14:1. Input boundaries were strengthened during visual review. These checks are not a complete accessibility certification.

## Algorithm reference results

For P1=(arrival 0, burst 7), P2=(2,4), P3=(4,1), P4=(5,4):

- FCFS order P1→P2→P3→P4; average WT 4.75; average TAT 8.75.
- Non-preemptive SJF order P1→P3→P2→P4; average WT 4.00; average TAT 8.00.
- Add P5=(20,2), as the database sample does: FCFS averages 3.80/7.40; SJF 3.20/6.80; both include CPU idle 16–20.

The expected and actual results for all 74 native cases are in `TEST_CASES.md`; raw output is `automated-tests.xml`.

## Reproducing safely

Follow README setup before starting. `npm test` without RUN_DB_TESTS=1 intentionally skips integration tests. Full verification requires a dedicated disposable database ending in `_test` and explicit consent via RUN_DB_TESTS=1. It drops/recreates its own test tables. Do not point it at real data.

`npm run test:browser` must use a seeded local demo server. It creates/deletes disposable test venues/events and may retain two simulation runs and one student registration. Browser test passwords are entered through hidden terminal prompts unless an explicit test environment supplies them.

## Honest limitations

- Not executed on the user's computer, Windows/macOS, Safari or Firefox. Run the same checks after local installation.
- Not a production load test, penetration test, backup-recovery test or complete screen-reader audit.
- Concurrency verification covered two conflicting bookings and two final-seat registrations, not unbounded distributed traffic.
- SQL write access outside the application's locking protocol can bypass overlap checks; UNIQUE/FK/CHECK constraints remain enforced.
- No guarantee against future dependency vulnerabilities. Run npm audit again when installing/upgrading.
- Deployment hardening, HTTPS, login throttling, account recovery, monitoring and production operations remain future work.
- CPU scheduling is an educational simulation, not host CPU control or an automatic university timetable optimizer.

## Additional requested skills

The final refinement pass used better-accessibility and better-typography from jakubkrehel/skills. Four supplementary states cover login/dashboard at 320px, keyboard login controls and 200% root text sizing. These augment the 38 core workflow states. Keyboard navigation disclosure and the password visibility button were exercised. This does not prove complete WCAG compliance, real screen-reader behavior or native browser zoom support; see ADDITIONAL_SKILL_REVIEW.md and additional-skill-checks.json.

## Apple-design and animation-performance checks

Emil Kowalski’s relevant skills informed immediate press feedback, restrained entrance timing and material preference fallbacks. Local Chromium checks verified active scale 0.98 without transition delay and no backdrop blur when reduced transparency was emulated. See apple-motion-checks.json. Real-device frame profiling, Safari and native gesture physics were not verified; this is not a guaranteed-FPS claim.
