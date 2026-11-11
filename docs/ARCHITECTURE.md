# Academic explanation — JavaScript edition

## Problem and scope
Centralize university events, reserve venues safely, prevent duplicate/full-event
registrations, and demonstrate OS scheduling concepts through simulated tasks.
This implements the proposed 40% evaluation scope, not an official grading rubric
or a production system. Payments, real timetable optimization, notifications,
certificate generation, priority/Round Robin algorithms, and public signup are out of scope.

## Architecture
Browser -> Express role/CSRF checks -> parameterized mysql2 service queries ->
MySQL InnoDB. EJS renders escaped HTML; Bootstrap/JS/CSS are served locally.
Node.js runs backend JavaScript. The simulator is a pure JavaScript module with
no database or host-scheduler dependency. No Python or frontend build is required.

## Relational model
users 1 -> many events (created_by); venues 1 -> many events;
users many <-> many events through registrations;
users 1 -> many scheduling_runs; runs 1 -> many scheduling_results;
event_tasks -> scheduling_results as per-run immutable input snapshots.

The six requested tables are preserved, plus scheduling_runs for distinct runs
and app_sessions for persistent login sessions. Primary/foreign keys, UNIQUE
email/student ID/venue name/student-event pairs, and CHECK constraints are
implemented in MySQL. Counts use LEFT JOIN/GROUP BY/COUNT so empty events remain
visible. INNER JOINs resolve venue/organizer/student data. WHERE and ORDER BY
appear in browsing/history/reports. Forms and the rollback CLI demonstrate CRUD.

## Calendar scheduling vs CPU scheduling
Calendar management uses actual venue/date/time assignments chosen by an admin.
It validates bookings; it is not an automatic timetable optimizer.
CPU simulation orders hypothetical computational tasks such as reports,
registration processing, attendance lists, and certificate preparation. Burst
times are input units, not real measurements. It never controls the host OS CPU scheduler.

FCFS chooses arrival then case-insensitive alphabetic ID. SJF chooses shortest
burst among already-arrived tasks, then arrival, then ID. P10 precedes P2.
Both are non-preemptive. IDLE intervals fill gaps until the next arrival.
CT=finish; TAT=CT-arrival; WT=TAT-burst=start-arrival. Every process contributes
once to each average. 1–20 processes, arrival 0–100000, burst 1–100000 integers.
Priority is stored but unused by these algorithms.

Gantt widths are proportional to durations, colors are stable by process across
both algorithms, and exact labelled intervals accompany narrow segments.
Tables scroll within accessible, keyboard-focusable panels on mobile.

## Consistency and concurrency
Transactions use READ COMMITTED. Booking writes lock the **venue row** before
checking overlaps, even if there are no existing events to lock. Editing locks
old/new venues in increasing ID order, then locks the event; stale venue changes
are rejected. Conflicts: same date/venue AND existing.start < new.end AND
existing.end > new.start. Adjacent endpoints do not overlap.

Registration locks the **event row**, checks status/start/count, then inserts.
The UNIQUE student/event pair is also enforced independently by the database.
Event edits/deletion use the same lock, preventing races with registration.
Capacity cannot shrink below registered counts or linked attendance limits.
Cancelled events retain registrations but free reservations; deleted events
cascade registrations. Referenced venues cannot be deleted. Expected attendance
also serves as the prototype's registration limit and cannot exceed venue capacity.

Signed simulation inputs are HMAC-SHA256 authenticated, user-bound, and expire
after 30 minutes. Metrics are recomputed server-side; client-submitted results
are never trusted. Run headers, snapshots, and results commit atomically.
Each save creates a UUID; repeated saves are distinguishable. Students see only
their runs; administrators can inspect all. Stored timestamps are UTC; calendar
inputs use CAMPUS_TIMEZONE. Overnight events and editing already-started events
are not supported.

All writers must follow this lock protocol. Direct SQL can bypass cross-row
calendar/capacity rules; MySQL has no simple exclusion constraint here. Venue
locks serialize even different dates for that venue: safe but conservative.
Deadlocks/timeouts roll back and require a retry. This is not a load-tested
multi-server reservation platform. Run history shows 50 records without pagination.

## Authentication and security
Built-in asynchronous scrypt uses random salts, N=32768/r=8/p=1 and 64-byte hashes.
Default Werkzeug scrypt hashes are compatible with the original edition; this
was independently reference-tested. Other hash formats require separate migration.
Passwords are never stored in plaintext or put in CLI arguments. Hidden terminal
prompts initialize accounts; there is no public administrator registration.

express-session uses a MySQL Store, not MemoryStore. Cookies contain a signed,
opaque session ID; session data stays in MySQL. IDs and CSRF tokens regenerate
on login, logout removes the session row, and expired sessions cannot authenticate.
Cookies are HTTP-only and SameSite Lax. Secure cookies require HTTPS.
Role checks run server-side against the current user row on every protected
request. All POST forms require CSRF. SQL is parameterized and EJS escapes text.
Reports are allowlisted, not an arbitrary SQL console.

Before public deployment: HTTPS, rate limiting/account lockout, production
operations, security/audit review, backups/recovery, secret rotation, migration
management, and real workload tests are still required. Background session
cleanup runs hourly; expired records are ignored immediately on access. Local
HOST defaults to 127.0.0.1. TRUST_PROXY must match a trusted reverse proxy setup.

## Premium frontend runtime
EJS remains server-rendered. Inter, Bootstrap, GSAP and ScrollTrigger are local public assets. GSAP is progressive enhancement, not a route/data dependency. Details and original skill provenance are in FRONTEND_GUIDE.md and SKILL_APPLICATION.md.

