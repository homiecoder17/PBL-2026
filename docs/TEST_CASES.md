# Executed test cases

The inputs below identify the executed fixtures. Exact requests, SQL and assertions are in `test/*.test.js`. Actual results are derived from `automated-tests.xml`. Test passwords are isolated fixtures, not installed application credentials.

| # | Input / action | Expected result | Actual result |
|---|---|---|---|
| 1 | Fresh schema; SELECT sample counts; GET /health | Schema sample records and application health are real and valid | PASS — all assertions met |
| 2 | Valid seeded administrator email and test password; GET /dashboard | Correct administrator login grants dashboard access | PASS — all assertions met |
| 3 | Valid email, password wrong; GET /dashboard afterwards | Wrong login leaves no authenticated session | PASS — all assertions met |
| 4 | Student identifier CSE001 with correct password | Student ID authentication works | PASS — all assertions met |
| 5 | Student session; GET /venues, /events/new, /reports | Student cannot access administrator pages or create events | PASS — all assertions met |
| 6 | Authenticated session; POST /logout with current CSRF token | Logout destroys the server-side session and access | PASS — all assertions met |
| 7 | Login POST with empty token and 64 repeated Unicode characters | Missing and malformed Unicode CSRF tokens rejected with 400 | PASS — all assertions met |
| 8 | Anonymous session/token before login; compare session cookie and old-token logout | Login regenerates the session ID and CSRF token | PASS — all assertions met |
| 9 | Log in; recreate Express application; reuse cookie with same MySQL store | Session survives application recreation using the MySQL store | PASS — all assertions met |
| 10 | Authenticated session; set session expiry to zero; GET /dashboard | Expired MySQL sessions cannot authenticate | PASS — all assertions met |
| 11 | SELECT stored password_hash; verify hash; GET /signup | Passwords are hashed in MySQL and no public signup exists | PASS — all assertions met |
| 12 | Valid event, future date, 10:00–11:00, attendance 20, venue 1; edit and delete | Event CRUD inserts, updates and deletes actual records | PASS — all assertions met |
| 13 | Event end_time 09:00, start_time 10:00 | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 14 | Event end_time 10:00, start_time 10:00 | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 15 | Event date 2026-02-30 | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 16 | Event date 2000-01-01 | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 17 | Expected attendance 301; venue capacity 300 | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 18 | Expected attendance 0 | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 19 | Venue ID 999 | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 20 | Event status hacked (unsupported) | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 21 | Venue ID abc | Validation error; no event inserted; transaction rolled back | PASS — all assertions met |
| 22 | Existing 10:00–11:00; same-venue overlap, adjacent 11:00 start, and another venue | Overlaps rejected; adjacent slots and another venue accepted | PASS — all assertions met |
| 23 | Edit into occupied interval; cancel original and retry slot | Conflicting event edits roll back and cancellation frees the slot | PASS — all assertions met |
| 24 | Two simultaneous saveEvent requests for same venue/date/interval | Concurrent identical venue bookings allow exactly one event | PASS — all assertions met |
| 25 | Create venue, edit capacity, duplicate its name, delete unused venue | Venue CRUD and duplicate names are handled | PASS — all assertions met |
| 26 | Venue referenced by event; delete venue or lower capacity below event attendance | Referenced venue deletion and capacity reduction rejected | PASS — all assertions met |
| 27 | Administrator submits event create and edit HTML forms | Event creation and editing HTML forms work | PASS — all assertions met |
| 28 | Student registers once and repeats same student/event pair | Student registration stores time and rejects duplicate | PASS — all assertions met |
| 29 | Direct SQL INSERT of already existing student/event registration | Database UNIQUE independently prevents duplicate registration | PASS — all assertions met |
| 30 | Capacity-one event; second distinct student registers | Full event rejects another student | PASS — all assertions met |
| 31 | Two concurrent students compete for capacity-one event | Concurrent requests for the final seat allow exactly one registration | PASS — all assertions met |
| 32 | Cancel registered event; attempt new registration; delete event | Cancellation rejects new registration and deletion cascades old records | PASS — all assertions met |
| 33 | Existing registration; edit expected attendance below registration count | Attendance limit cannot fall below existing registrations | PASS — all assertions met |
| 34 | Past-start scheduled event; register student | Past-start events reject registrations | PASS — all assertions met |
| 35 | Student POST registration and GET history; administrator attempts registration | Student registration/history route works; admin registration forbidden | PASS — all assertions met |
| 36 | Direct SQL with nonexistent FK or invalid time/capacity/metrics | Foreign keys and CHECK constraints reject invalid SQL writes | PASS — all assertions met |
| 37 | Save same valid signed SJF workload twice; SELECT runs and results | Repeated saved SJF runs have distinct IDs and correct stored values | PASS — all assertions met |
| 38 | Tampered signed scheduling input; inspect task/result counts | Invalid signed run cannot create result or task records | PASS — all assertions met |
| 39 | Forced persistence failure during result transaction; compare row counts | Failed result persistence is atomic | PASS — all assertions met |
| 40 | POST simulator with four reference tasks; save FCFS and GET saved run | Simulator form compares both algorithms and saves to MySQL | PASS — all assertions met |
| 41 | Invalid workload and expired signed save token via HTML routes | Invalid simulator inputs and expired saves show validation errors | PASS — all assertions met |
| 42 | Other user owns run; student lists own runs and requests foreign run URL | Students cannot view or list another user’s saved runs | PASS — all assertions met |
| 43 | Known reports; unknown query key; student attempts reports | Reports allow only known queries and enforce administrator access | PASS — all assertions met |
| 44 | HTML payload in event title; SQL injection string as login identifier | HTML is escaped and login SQL injection cannot authenticate | PASS — all assertions met |
| 45 | Weak password or already initialized demo accounts | Secure account initialization refuses weak and existing accounts | PASS — all assertions met |
| 46 | Create additional student; duplicate student ID | Additional student creation and duplicate ID validation work | PASS — all assertions met |
| 47 | Initialize future sample events twice | Future sample events seed once through the booking service | PASS — all assertions met |
| 48 | Real SQL INSERT, SELECT, UPDATE, DELETE demonstration followed by rollback | Non-destructive SQL CRUD demonstration rolls back all changes | PASS — all assertions met |
| 49 | Admin create → student register → compare/save → report → event delete | Full workflow: admin event, student registration, simulation save, reports, cascade deletion | PASS — all assertions met |
| 50 | Same strong password hashed twice; correct and incorrect verification | Passwords use salted scrypt hashes and correct/wrong verification | PASS — all assertions met |
| 51 | Weak password and malformed/unsupported hash formats | Weak passwords and malformed hashes are rejected | PASS — all assertions met |
| 52 | Independent original Werkzeug scrypt fixture and original password | Original Werkzeug scrypt hashes verify without password resets | PASS — all assertions met |
| 53 | P1(0,7), P2(2,4), P3(4,1), P4(5,4); FCFS | Order P1,P2,P3,P4; CT [7,11,12,16]; WT [0,5,7,7]; TAT [7,9,8,11]; avg WT 4.75 / TAT 8.75 | PASS — all assertions met |
| 54 | Same four-process reference fixture; non-preemptive SJF | Order P1,P3,P2,P4; CT in input order [7,12,8,16]; WT [0,6,3,7]; TAT [7,10,4,11]; avg WT 4.00 / TAT 8.00 | PASS — all assertions met |
| 55 | A(3,2), B(10,1); FCFS | Idle 0–3 and 5–10; A 3–5; B 10–11; avg WT 0 | PASS — all assertions met |
| 56 | A(3,2), B(10,1); SJF | Idle 0–3 and 5–10; A 3–5; B 10–11; avg WT 0 | PASS — all assertions met |
| 57 | A(0,8), B(1,1), C(0,10); SJF | A runs 0–8 uninterrupted, then B, then C | PASS — all assertions met |
| 58 | P2(0,2), P10(0,2); both algorithms | P10 precedes P2 for equal arrival/burst | PASS — all assertions met |
| 59 | Empty CSV | Validation exception; workload not scheduled | PASS — all assertions met |
| 60 | P1,A,-1,2 | Validation exception; workload not scheduled | PASS — all assertions met |
| 61 | P1,A,0,0 | Validation exception; workload not scheduled | PASS — all assertions met |
| 62 | P1,A,0,1.5 | Validation exception; workload not scheduled | PASS — all assertions met |
| 63 | P1,A,0,1 and p1,B,0,1 | Validation exception; workload not scheduled | PASS — all assertions met |
| 64 | IDLE,A,0,1 | Validation exception; workload not scheduled | PASS — all assertions met |
| 65 | P1,A,100001,1 | Validation exception; workload not scheduled | PASS — all assertions met |
| 66 | P1,A,0,100001 | Validation exception; workload not scheduled | PASS — all assertions met |
| 67 | P1,A,0 | Validation exception; workload not scheduled | PASS — all assertions met |
| 68 | 21 processes | Validation exception; workload not scheduled | PASS — all assertions met |
| 69 | P1,"broken,0,2 | Validation exception; workload not scheduled | PASS — all assertions met |
| 70 | Task name Generate, verify report serialized and parsed as CSV | CSV names containing commas round-trip correctly | PASS — all assertions met |
| 71 | Algorithm RR; boolean arrival_time true | Invalid algorithm and boolean arrival rejected | PASS — all assertions met |
| 72 | A(3,2), B(10,1) saved rows; same workload FCFS/SJF color map | Saved rows reproduce exact idle timeline and stable process colors | PASS — all assertions met |
| 73 | Valid token; altered token; wrong user; older than 30min; future-issued token | Signed scheduling input rejects tampering, wrong user, expiry, and future time | PASS — all assertions met |
| 74 | 300 seeded generated workloads (1–20 tasks), each through FCFS and SJF | 300 deterministic workloads satisfy non-overlap and CT/WT/TAT identities | PASS — all assertions met |
