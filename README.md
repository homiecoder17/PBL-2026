# CampusFlow — JavaScript / Node.js edition
## University Event Management + OS Scheduling + DBMS · Complete 40% PBL prototype

**No Python is required to install, run, initialize, or test this project.**
Stack: Node.js, Express, EJS, HTML/CSS/JavaScript, bundled Bootstrap, and real MySQL.
Read this file first, then `docs/DEMO_GUIDE.md` and `docs/TEST_REPORT.md`.

This replaces the Flask project with the same core workflows: administrator and
student login, event/venue CRUD, transactional venue conflict checks, student
registration, FCFS/SJF simulation, proportional Gantt charts, stored run history,
and SQL demonstrations. It is a local academic prototype, not a production app.

## 1. Install software
- Node.js 22+ (Node.js 24 LTS recommended), including npm.
- MySQL Community Server 8.0.16+ (8.4 LTS recommended), running locally.
- MySQL command-line client or MySQL Workbench.
- VS Code, recommended.

Check:
```bash
node --version
npm --version
mysql --version
```
A MySQL client alone is not a running database server. SQLite/MariaDB are not
substituted. Bootstrap is bundled; runtime does not depend on a CDN.

## 2. Install exact dependencies
Extract this archive and open a terminal **inside campusflow-node**:
```bash
npm ci
```
The package-lock.json is included. You do not need a Python virtual environment,
a Flask server, React, a Java compiler, or a separate frontend build.

## 3. Configure environment
Windows PowerShell:
```powershell
Copy-Item .env.example .env
```
macOS / Linux:
```bash
cp .env.example .env
```
Generate a secret:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
Set `.env` with your own values:
```dotenv
SESSION_SECRET=YOUR_GENERATED_RANDOM_SECRET
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=ues_app
MYSQL_PASSWORD=YOUR_DATABASE_USER_PASSWORD
MYSQL_DATABASE=university_event_system
CAMPUS_TIMEZONE=Asia/Kolkata
SESSION_COOKIE_SECURE=false
TRUST_PROXY=0
PORT=3000
HOST=127.0.0.1
```
These are placeholders, not credentials. Never commit .env. Keep cookie secure
false for localhost HTTP; true requires HTTPS. The app refuses short session
secrets and blank DB passwords. Use your university's IANA timezone if different.

## 4. Initialize MySQL and a limited application user
From this project folder, as a MySQL administrator:
```bash
mysql -u root -p --execute="SOURCE backend/database/init.sql"
```
The client prompts privately for the database administrator password.
The script creates `university_event_system`, the original seven domain tables,
and an additional `app_sessions` table for persistent server-side login sessions.
It seeds 8 campus venues and 5 tasks but no fixed-password login accounts.

Copy/edit `backend/database/create_app_user.sql.example` outside source control, replace the
password placeholder with a strong unique password, and execute it as a DB
administrator. Put that user's credentials into .env; the app should not use root.
The app needs only SELECT/INSERT/UPDATE/DELETE on its own database. Remove or
securely store your temporary user-creation file.

```bash
npm run cli -- check-db
```
Expected: MySQL verified; a real SELECT 1 returns 1.

## 5. Initialize demo accounts securely
Run these in an interactive terminal:
```bash
npm run cli -- seed-demo
npm run cli -- seed-events
```
The account initializer asks for two chosen passwords with confirmation and
hidden input. Passwords must be 12–256 characters. Do not place passwords in
command arguments, pipe them into the CLI, or send them in chat.

Accounts:
- Administrator: `admin@campus.test`
- Student: `student@campus.test`, or student ID `CSE2026001`

There are **no default passwords** and no public admin-registration endpoint.
Existing accounts are never overwritten. The sample events are dated 7–9 days
in the future. Each event uses the normal transactional booking service. Event
seeding is individually transactional; if interrupted, inspect events before
retrying. It refuses to seed when the calendar already contains records.

Create another student when demonstrating a full event:
```bash
npm run cli -- create-user --name "Second Student" --email second@campus.test --role student --student-id CSE2026002
```
The password is privately prompted. Use `--role admin` only for intentional local
administrator initialization. There is no password recovery/public signup UI.

## 6. Run
```bash
npm start
```
Open **http://127.0.0.1:3000**. `/health` checks the Node server only, not MySQL;
check-db verifies database connectivity. Press Ctrl+C to stop.

## 7. Faculty demonstration
1. Admin creates/edits an event, rejects an overlap, and accepts adjacent slots.
2. Student registers and views history; duplicate and full-event protection are demonstrated.
3. Simulator compares FCFS/SJF, including ties and idle periods.
4. Save both algorithms and retrieve separate UUID runs.
5. Admin uses DBMS reports and the safe SQL CRUD demonstration:
```bash
npm run cli -- demo-sql
```
It makes real temporary INSERT/UPDATE/SELECT/DELETE operations, then rolls back.
Auto-increment gaps after rollback are normal.
See `docs/DEMO_GUIDE.md` for a timed workflow, reference metrics, and viva answers.

## 8. Verification
JavaScript is interpreted: there is no separate compilation executable.
Check all delivered JavaScript syntax and compile all EJS templates:
```bash
npm run check
```
Run pure scheduling, token, and password tests without MySQL:
```bash
npm run test:unit
```
`npm test` runs unit tests and **skips database integration tests unless explicitly
opted in**. A green default test run is not proof that your MySQL setup works.

### Full real-MySQL tests — destructive test database only
Tests drop/recreate/truncate tables in a disposable DB ending in `_test`.
Never use the application database. Create a separate test user using
`sql/create_test_user.sql.example` with a different password. It needs CREATE/DROP
only on `university_event_system_test`, not on your live/app database.

In a separate test terminal, PowerShell:
```powershell
$env:RUN_DB_TESTS="1"
$env:MYSQL_USER="ues_tester"
$secure=Read-Host "Test database password" -AsSecureString
$env:MYSQL_PASSWORD=[System.Net.NetworkCredential]::new("", $secure).Password
Remove-Variable secure
$env:TEST_MYSQL_DATABASE="university_event_system_test"
npm run verify:all
```
Bash on macOS/Linux:
```bash
export RUN_DB_TESTS=1
export MYSQL_USER=ues_tester
read -s -p "Test database password: " MYSQL_PASSWORD; echo
export MYSQL_PASSWORD
export TEST_MYSQL_DATABASE=university_event_system_test
npm run verify:all
```
Host and port come from .env unless overridden. Close the test terminal after
finishing. Environment variables are still accessible to sufficiently privileged
local processes; these prompts avoid exposing passwords on screen/history.
Tests refuse invalid DB identifiers and the configured application DB name.

### Browser tests — local demo data only
With a seeded local application running in another terminal:
```bash
npx playwright install chromium
npm run test:browser
```
Enter your chosen demo passwords at the hidden prompts. These checks create and
remove temporary QA events/venues, and retain two saved runs plus a demo student
registration. Do not run on valuable real data. The script refuses remote hosts.
Snapshots and a JSON report go to docs/browser-output. CHROMIUM_PATH can specify
an existing Chromium executable; BROWSER_URL can set a different local port.

## 9. Existing Flask database conversion
The domain schema remains compatible with the previous project. Back it up
first, stop Flask, then run this edition's init.sql to add the session table.
Existing default Werkzeug scrypt password hashes are supported and tested, so
those users do not need password resets. Other hash formats are not supported.
Use a new SESSION_SECRET; old Flask login cookies are not migrated. Do not run
both editions concurrently unless every writer follows the same lock protocol.
SQL initialization is not a general-purpose migration system.

## 10. File guide
- backend/src/server.js: Node HTTP server and graceful shutdown.
- backend/src/app.js: Express routes, role-aware forms, middleware, safe errors/headers.
- backend/src/config.js: validated environment configuration.
- backend/src/db.js: parameterized queries, MySQL connection pool, and SQLite fallback.
- backend/src/session-store.js: MySQL-backed server-side sessions and expiry cleanup.
- backend/src/security.js: role guards, CSRF tokens, session regeneration/logout.
- backend/src/passwords.js: salted scrypt hashing and legacy hash verification.
- backend/src/services.js: event/venue/registration/commit validation and row locks.
- backend/src/scheduler.js: CSV parser, FCFS/SJF algorithms, metrics, saved timeline recovery.
- backend/src/scheduling-store.js: HMAC-signed input, expiry, atomic result saving.
- backend/src/accounts.js: secure account creation, sample events, rollback SQL demo.
- backend/src/terminal.js: private local password prompts.
- backend/src/format.js: campus-local clock and display formatters.
- backend/src/reports.js: allowlisted queries and event listing JOIN.
- frontend/views/: EJS pages and reusable header/footer/result partials.
- frontend/public/: CSS/JS, Inter font, GSAP, and bundled Bootstrap with licenses.
- scripts/: CLI, syntax/template verification, browser and full-test commands.
- backend/tests/: real-MySQL + fallback integration tests plus pure algorithm/password tests.
- backend/database/: schema/sample records/query examples and DB-user templates.
- docs/: academic notes, test evidence, traceability, screenshots, demo workflow.

## Troubleshooting
- MySQL 1045: credentials/host-specific grants are wrong.
- MySQL 1049 or missing table: run sql/init.sql against the intended database.
- ECONNREFUSED: start MySQL and verify host/port.
- Login succeeds then fails after redirect: check session-table permissions; secure
  cookies must be false for HTTP localhost.
- Form token expired: reload and resubmit; tokens rotate when logging in.
- Venue deletion rejected: an event still references it.
- Registration closed: the event already started in campus time.
- Browser install unavailable: use CHROMIUM_PATH or mark browser tests unexecuted;
  do not invent success.
- npm test skips integration: follow the opt-in full-verification instructions.

Do not expose this prototype publicly without HTTPS, rate limiting, auditing,
backup/recovery, deployment/security review, and appropriate production hardening.

## Premium frontend edition

The requested `premium-frontend-ui` skill from github/awesome-copilot was installed and applied, followed by relevant `better-accessibility` and `better-typography` skills from jakubkrehel/skills and `apple-design` / `animation-performance` from emilkowalski/skills. This edition uses an editorial campus identity: Inter variable typography, a desktop sidebar workspace, a split-screen login, a blue dashboard hero, cohesive cards/forms/tables, and locally bundled GSAP motion.

- GSAP entrance timelines and restrained ScrollTrigger depth; no scroll hijacking or blocking loader.
- Responsive mobile navigation, readable forms, and keyboard-focusable table scroll regions.
- Light/dark theme, explicit password visibility, event filtering and meaningful empty/error states.
- Reduced-motion preferences disable the motion enhancements; content is available without GSAP.
- Server forms and validation remain usable without JavaScript. JavaScript-only controls are hidden until enhanced.
- Inter, Bootstrap, GSAP and ScrollTrigger are served locally; no runtime CDN is required.

See `docs/FRONTEND_GUIDE.md`, `docs/SKILL_APPLICATION.md` and `docs/TEST_REPORT.md`. The archive excludes database secrets, initialized passwords, and node_modules. Follow the setup steps above to initialize MySQL and create your own accounts.
