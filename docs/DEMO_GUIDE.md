# Faculty demonstration — approximately 8 minutes

## Before the evaluation
Run README setup, check-db, seed-demo, and seed-events. Know the two passwords
that you chose. Use two browser profiles or log out when changing roles. Keep
MySQL running and avoid modifying data directly during the demonstration.
No internet is needed at runtime; Bootstrap is bundled.

## 1. Introduce the problem (30 seconds)
Explain manual venue conflicts, duplicate registrations, and inconsistent
records. Show how an event record connects a venue and its administrator.

## 2. Administrator workflow (2 minutes)
Log in as admin@campus.test. Open Events and create a future event in Innovation
Lab with expected attendance 30. Use a date at least one day in the future and
10:00–11:00. Show its saved record and registration count.
Try a second event in that venue/date at 10:30–11:30: conflict rejected.
Try 11:00–12:00: adjacent interval accepted. Try attendance 41: capacity rejected.
Edit an event title. Demonstrate deletion only on a newly created disposable event.
Explain deletion cascades its registrations, while cancellation retains them.

## 3. Student workflow (90 seconds)
Log out; log in as student@campus.test or CSE2026001. Register for an event.
Open My registrations and show the timestamp. Attempt the same registration
again via the workflow/test evidence: service rejection plus UNIQUE constraint.
Try /venues: administrator-only access is forbidden.
For a capacity example create a disposable event with registration limit 1 and
use a second student initialized through the create-user CLI.

## 4. OS simulator (2 minutes)
Use this CSV to match the known reference test:
```csv
P1,Generate event report,0,7
P2,Process registrations,2,4
P3,Generate attendance lists,4,1
P4,Prepare certificates,5,4
```
FCFS: P1 -> P2 -> P3 -> P4. Average WT = 4.75, average TAT = 8.75.
SJF: P1 -> P3 -> P2 -> P4. Average WT = 4.00, average TAT = 8.00.
Show CT/WT/TAT per process and the Gantt intervals.
Add `P5,Update event statistics,20,2` to demonstrate IDLE from 16 to 20.
The initial database samples already include P5, so their averages differ from
the four-process reference above; do not confuse those datasets.
Explain SJF selects only arrived tasks and is non-preemptive.
Save FCFS and SJF separately; retrieve both under Saved runs. Explain their
unique run IDs and immutable task snapshots.

## 5. DBMS evidence (90 seconds)
As admin, open DBMS reports. Show the query text, LEFT JOIN/GROUP BY counts,
INNER JOIN roster, and WHERE/ORDER BY. Run the demo-sql CLI for real INSERT,
UPDATE, SELECT, DELETE, and ROLLBACK without persistent changes.
Show sql/init.sql primary/foreign keys and UNIQUE(user_id,event_id).
Show docs/TEST_REPORT.md for executed tests, including concurrent booking and
final-seat competition, rather than pretending concurrency is visible in a
single sequential screen recording.

## Likely viva questions
- Calendar scheduling vs CPU scheduling? Real venues/date/time vs simulated computation ordering.
- Why UNIQUE as well as a JavaScript check? Database-enforced protection even if application checks race.
- Why lock the venue rather than just existing events? There may be no existing event row to lock.
- Why a run table? Repeated executions must be distinguishable and must not overwrite historical inputs.
- Why can auto-increment IDs skip? Rolled-back inserts do not normally restore consumed IDs.
- Is SJF always better? No universal claim; compare the given workload and discuss starvation in sustained workloads.
- Does this control the OS scheduler? No; it is an educational simulation.

## JavaScript edition notes
Run npm start, not Flask. The scheduler is in src/scheduler.js and MySQL locks
are in src/services.js. Login sessions are stored in app_sessions. No Python
is needed. For secure setup use npm run cli -- seed-demo and seed-events.
