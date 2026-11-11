# Requirements → implementation

| Requirement | Files / demonstration |
|---|---|
| Student/admin login, hashed passwords, logout, sessions, roles | `src/app.js`, `passwords.js`, `security.js`, `session-store.js`; login/dashboard views |
| Secure account initialization | `scripts/cli.js`, `src/terminal.js`, `accounts.js`; hidden password prompts, no public admin signup |
| Event create/list/edit/delete | `src/services.js`, `app.js`, event views; actual MySQL CRUD |
| Future dates, end > start, attendance and venue capacity | `services.js`; validation and rollback tests |
| Same-venue overlap rejection, concurrency | Venue row locks in `services.js`; two concurrent booking test |
| Student registration, duplicates and capacity | Event row lock, registration UNIQUE in `sql/init.sql`, `services.js` |
| Registration history and timestamps/counts | `registrations.ejs`, `reports.js`; JOIN, GROUP BY, COUNT |
| PK/FK/UNIQUE/CHECK, relational database | `sql/init.sql`; seven domain tables + MySQL session table |
| INSERT/SELECT/UPDATE/DELETE, WHERE/ORDER BY | Real app forms, `sql/demo_queries.sql`, `npm run cli -- demo-sql` |
| INNER/LEFT JOIN and aggregates | Allowlisted `src/reports.js`, reports page |
| FCFS/non-preemptive SJF, idle and ties | `src/scheduler.js`, `test/scheduler.test.js` |
| CT/TAT/WT and averages | Scheduler and result table, verified reference cases |
| Gantt visualization and algorithm comparison | `views/partials/result.ejs`, simulator; duration-proportional segments and interval legend |
| Save/retrieve repeated valid runs | `scheduling-store.js`, run UUID, immutable per-run task snapshots; transaction rollback tests |
| Responsive polished frontend | `public/app.css`, `app.js`, EJS templates, local Bootstrap |
| Theme, motion accessibility, event search | Progressive enhancement in `app.js`; reduced-motion CSS; browser interaction checks |
| Installation, explanation, tests, demo | README, ARCHITECTURE, TEST_REPORT, TEST_CASES, DEMO_GUIDE |

This is the requested 40% academic prototype, not an official grading rubric or a complete production system. Calendar booking validation does not control the operating system CPU scheduler. CPU task execution is simulated.

## Premium redesign
Requested skill provenance: SKILL_APPLICATION.md and skills-lock.json. Shared design: public/app.css and views/partials. Motion and progressive enhancement: public/app.js. Local typography: public/fonts. Verification: 38 browser states in browser-checks.json, screenshots and TEST_REPORT.md. Existing backend requirements and tests are unchanged.
