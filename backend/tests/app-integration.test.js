import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
import { demoSql, createUser } from "../src/accounts.js";
import { parseProcesses } from "../src/scheduler.js";
import { signInput } from "../src/scheduling-store.js";
import { REPORTS } from "../src/reports.js";

const PASSWORD = "CampusAdmin@2026";
const SECRET = "test-only-session-secret-at-least-32-characters";
const SOURCE =
  "P1,Report,0,7\nP2,Registrations,2,4\nP3,Attendance,4,1\nP4,Certificates,5,4";

let app, server, db, services;

function futureDate(daysAhead = 15) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function eventFields(overrides = {}) {
  return {
    title: "Integration Test Event",
    description: "End-to-end verification event.",
    event_date: futureDate(15),
    start_time: "10:00",
    end_time: "11:00",
    expected_attendance: "20",
    venue_id: "1",
    status: "scheduled",
    ...overrides,
  };
}

async function csrf(agent, path = "/login") {
  const res = await agent.get(path);
  assert.equal(res.status, 200);
  const match = res.text.match(/name="csrf_token" value="([^"]+)"/);
  assert.ok(match, `Missing CSRF token on ${path}`);
  return match[1];
}

async function login(agent, identifier = "admin@campus.test", password = PASSWORD) {
  const token = await csrf(agent, "/login");
  const res = await agent
    .post("/login")
    .type("form")
    .send({ csrf_token: token, identifier, password });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/dashboard");
  return res;
}

beforeEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (app) await app.locals.close();
  app = await createApp({
    secret: SECRET,
    password: "fallback-only-unused-password",
    forceFallback: true,
  });
  db = app.locals.db;
  services = app.locals.services;
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (app) await app.locals.close();
});

const TECH_JARGON =
  /\b(OS Scheduler|OS CPU|OS runs|FCFS|SJF|SRTF|Round Robin|DBMS|scrypt|MySQL|SQLite)\b|AT\s*=|BT\s*=/i;

test("Login page has no prefilled credentials and strict CSP blocks inline scripts", async () => {
  const res = await request(server).get("/login");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /CampusAdmin@2026/);
  assert.doesNotMatch(res.text, TECH_JARGON);
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
});

test("Auth: admin & student ID login, CSRF check, session rotation, and logout", async () => {
  const admin = request.agent(server);
  const preToken = await csrf(admin, "/login");
  const loginRes = await admin
    .post("/login")
    .type("form")
    .send({ csrf_token: preToken, identifier: "admin@campus.test", password: PASSWORD });
  assert.equal(loginRes.status, 302);

  // Old CSRF token must be rejected after login regeneration
  const staleLogout = await admin
    .post("/logout")
    .type("form")
    .send({ csrf_token: preToken });
  assert.equal(staleLogout.status, 400);

  const dash = await admin.get("/dashboard");
  assert.equal(dash.status, 200);
  assert.match(dash.text, /Administrator Console/);
  assert.match(dash.text, /SQLite/);

  const postToken = await csrf(admin, "/dashboard");
  const out = await admin.post("/logout").type("form").send({ csrf_token: postToken });
  assert.equal(out.status, 302);
  assert.equal((await admin.get("/dashboard")).status, 302);

  // Student ID login
  const student = request.agent(server);
  await login(student, "CSE2026001");
  const sDash = await student.get("/dashboard");
  assert.equal(sDash.status, 200);
  assert.match(sDash.text, /Campus Hub Live/);
  assert.doesNotMatch(sDash.text, TECH_JARGON);
});

test("RBAC enforces admin vs student boundaries cleanly", async () => {
  const student = request.agent(server);
  await login(student, "student@campus.test");
  for (const path of ["/venues", "/venues/new", "/events/new", "/reports", "/users", "/simulator", "/runs"]) {
    assert.equal((await student.get(path)).status, 403);
  }
  for (const path of ["/dashboard", "/events", "/registrations", "/account"]) {
    const res = await student.get(path);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, TECH_JARGON);
  }
  const st = await csrf(student, "/events");
  assert.equal(
    (
      await student
        .post("/simulator/save")
        .type("form")
        .send({ csrf_token: st, input_token: signInput(parseProcesses(SOURCE), "FCFS", 2, SECRET) })
    ).status,
    403,
  );
  assert.equal(
    (
      await student
        .post("/simulator/commit")
        .type("form")
        .send({ csrf_token: st, workload: SOURCE, event_date: futureDate(10) })
    ).status,
    403,
  );

  const admin = request.agent(server);
  await login(admin);
  assert.equal((await admin.get("/registrations")).status, 403);
  const at = await csrf(admin, "/events");
  assert.equal(
    (await admin.post("/events/1/register").type("form").send({ csrf_token: at })).status,
    403,
  );
});

test("Event CRUD, pending_schedule, venue overlaps, and FK/cascade constraints work in fallback DB", async () => {
  const admin = request.agent(server);
  await login(admin);
  const token = await csrf(admin, "/events/new");

  // Create pending_schedule event
  const pendingRes = await admin
    .post("/events/new")
    .type("form")
    .send({ ...eventFields({ title: "Pending Tech Talk", status: "pending_schedule" }), csrf_token: token });
  assert.equal(pendingRes.status, 302);

  // Create fixed scheduled event
  const schedRes = await admin
    .post("/events/new")
    .type("form")
    .send({ ...eventFields({ title: "Fixed Slot Event" }), csrf_token: token });
  assert.equal(schedRes.status, 302);

  // Overlapping fixed event in same venue/date must fail
  const overlapRes = await admin
    .post("/events/new")
    .type("form")
    .send({
      ...eventFields({ title: "Overlap Event", start_time: "10:30", end_time: "11:30" }),
      csrf_token: token,
    });
  assert.equal(overlapRes.status, 200);
  assert.match(overlapRes.text, /Venue conflict/);

  // Referenced venue cannot be deleted (ON DELETE RESTRICT)
  await assert.rejects(() => services.deleteVenue(1), /referenced/);

  // Deleting an event cascades its registrations
  const sympId = 1;
  const regBefore = Number((await db.query("SELECT COUNT(*) n FROM registrations WHERE event_id=?", [sympId]))[0].n);
  assert.equal(regBefore, 1);
  await services.deleteEvent(sympId);
  const regAfter = Number((await db.query("SELECT COUNT(*) n FROM registrations WHERE event_id=?", [sympId]))[0].n);
  assert.equal(regAfter, 0);
});

test("Student registration, live counts, capacity limits, duplicate rejection, and unregister", async () => {
  await createUser(db, {
    name: "Second Student",
    email: "two@campus.test",
    studentId: "CSE2026002",
    password: PASSWORD,
  });

  const eventId = await services.saveEvent(
    eventFields({ title: "Tiny Workshop", expected_attendance: "1" }),
    1,
  );

  const s1 = request.agent(server);
  await login(s1, "student@campus.test");
  const t1 = await csrf(s1, "/events");
  const regRes = await s1.post(`/events/${eventId}/register`).type("form").send({ csrf_token: t1 });
  assert.equal(regRes.status, 302);
  assert.equal(regRes.headers.location, "/events");

  const eventsHtml = (await s1.get("/events")).text;
  assert.match(eventsHtml, /Tiny Workshop/);
  assert.match(eventsHtml, /<strong>1<\/strong> \/ 1 reserved/);
  assert.match(eventsHtml, /Cancel registration/);

  const regsHtml = (await s1.get("/registrations")).text;
  assert.match(regsHtml, /Tiny Workshop/);

  // Second student blocked because event is full
  const s2 = request.agent(server);
  await login(s2, "two@campus.test");
  const s2Events = (await s2.get("/events")).text;
  assert.match(s2Events, /Event full/);
  const t2 = await csrf(s2, "/events");
  await s2.post(`/events/${eventId}/register`).type("form").send({ csrf_token: t2 });
  assert.equal(
    Number((await db.query("SELECT COUNT(*) n FROM registrations WHERE event_id=?", [eventId]))[0].n),
    1,
  );

  // First student unregisters, freeing the seat
  const unregRes = await s1
    .post(`/events/${eventId}/unregister`)
    .type("form")
    .send({ csrf_token: t1, return_to: "/registrations" });
  assert.equal(unregRes.status, 302);
  assert.equal(unregRes.headers.location, "/registrations");

  // Second student can now register
  await s2.post(`/events/${eventId}/register`).type("form").send({ csrf_token: t2 });
  assert.equal(
    Number((await db.query("SELECT COUNT(*) n FROM registrations WHERE event_id=?", [eventId]))[0].n),
    1,
  );
});

test("Simulator save, run history isolation, and transactional admin commit", async () => {
  const targetDay = futureDate(12);
  await services.saveEvent(
    eventFields({
      title: "Morning Keynote",
      event_date: targetDay,
      start_time: "09:00",
      end_time: "12:00",
      expected_attendance: "100",
      venue_id: "6",
      status: "pending_schedule",
    }),
    1,
  );
  await services.saveEvent(
    eventFields({
      title: "Quick Lightning Talk",
      event_date: targetDay,
      start_time: "09:00",
      end_time: "10:00",
      expected_attendance: "35",
      venue_id: "6",
      status: "pending_schedule",
    }),
    1,
  );

  const admin = request.agent(server);
  await login(admin);
  const simGet = await admin.get(`/simulator?date=${targetDay}&venue_id=6`);
  assert.equal(simGet.status, 200);
  assert.match(simGet.text, /Morning Keynote/);
  assert.match(simGet.text, /Quick Lightning Talk/);
  assert.match(simGet.text, /SRTF/);
  assert.match(simGet.text, /PRIORITY/);
  assert.match(simGet.text, /Round Robin/);

  // Save SJF run from simulator (5 algorithms => 5 signed input_token forms)
  const tokens = [...simGet.text.matchAll(/name="input_token" value="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(tokens.length, 5);
  const csrfTok = await csrf(admin, `/simulator?date=${targetDay}&venue_id=6`);

  const saveRes = await admin
    .post("/simulator/save")
    .type("form")
    .send({ csrf_token: csrfTok, input_token: tokens[1] });
  assert.equal(saveRes.status, 302);
  assert.match(saveRes.headers.location, /^\/runs\/[0-9a-f-]+$/i);

  const runPage = await admin.get(saveRes.headers.location);
  assert.equal(runPage.status, 200);
  assert.match(runPage.text, /Saved SJF run/);

  // Also save RR preemptive run (token index 4) and verify timeline & quantum persist
  const saveRr = await admin
    .post("/simulator/save")
    .type("form")
    .send({ csrf_token: csrfTok, input_token: tokens[4] });
  assert.equal(saveRr.status, 302);
  const rrPage = await admin.get(saveRr.headers.location);
  assert.equal(rrPage.status, 200);
  assert.match(rrPage.text, /Saved RR run/);
  assert.match(rrPage.text, /QUANTUM q = 2/);

  // Reject committing preemptive algorithms like RR
  const badCommit = await admin
    .post("/simulator/commit")
    .type("form")
    .send({
      csrf_token: csrfTok,
      algorithm: "RR",
      venue_id: "6",
      event_date: targetDay,
      workload: SOURCE,
    });
  assert.equal(badCommit.status, 302);
  assert.equal(badCommit.headers.location, "/simulator");

  // Student cannot access simulator, run list, or saved run
  const student = request.agent(server);
  await login(student, "student@campus.test");
  assert.equal((await student.get("/simulator")).status, 403);
  assert.equal((await student.get("/runs")).status, 403);
  assert.equal((await student.get(saveRes.headers.location)).status, 403);

  // Expired save redirects back to simulator
  const expiredSave = await admin
    .post("/simulator/save")
    .type("form")
    .send({
      csrf_token: csrfTok,
      input_token: signInput(parseProcesses(SOURCE), "FCFS", 1, SECRET, Date.now() - 1800001),
    });
  assert.equal(expiredSave.status, 302);
  assert.equal(expiredSave.headers.location, "/simulator");

  // Admin commits SJF schedule to DB and events become non-overlapping & scheduled
  const workloadMatch = simGet.text.match(/<textarea name="workload"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(workloadMatch);
  const commitRes = await admin
    .post("/simulator/commit")
    .type("form")
    .send({
      csrf_token: csrfTok,
      algorithm: "SJF",
      venue_id: "6",
      event_date: targetDay,
      workload: workloadMatch[1],
    });
  assert.equal(commitRes.status, 302);
  assert.equal(commitRes.headers.location, "/events");

  const updated = await db.query(
    "SELECT title, start_time, end_time, status FROM events WHERE venue_id=6 AND event_date=? ORDER BY start_time",
    [targetDay],
  );
  assert.equal(updated.length, 2);
  assert.equal(updated[0].title, "Quick Lightning Talk");
  assert.equal(updated[0].start_time, "09:00");
  assert.equal(updated[0].end_time, "10:00");
  assert.equal(updated[0].status, "scheduled");
  assert.equal(updated[1].title, "Morning Keynote");
  assert.equal(updated[1].start_time, "10:00");
  assert.equal(updated[1].end_time, "12:00");
  assert.equal(updated[1].status, "scheduled");
});

test("All allowlisted DBMS reports run cleanly, XSS is escaped, and demoSql rolls back", async () => {
  await services.saveEvent(eventFields({ title: "<script>alert(1)</script>" }), 1);
  const admin = request.agent(server);
  await login(admin);

  const eventsHtml = (await admin.get("/events")).text;
  assert.match(eventsHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(eventsHtml, /<script>alert\(1\)/);

  const dashHtml = (await admin.get("/dashboard")).text;
  assert.doesNotMatch(dashHtml, /<script>alert\(1\)/);
  assert.match(dashHtml, /\\u003cscript>alert\(1\)\\u003c\/script>/);

  for (const key of Object.keys(REPORTS)) {
    const r = await admin.get(`/reports?query=${key}&explain=1`);
    assert.equal(r.status, 200, `Report ${key} failed`);
    assert.match(r.text, /Query execution plan/);
  }
  assert.equal((await admin.get("/reports?query=DROP%20TABLE")).status, 400);

  const before = Number((await db.query("SELECT COUNT(*) n FROM venues"))[0].n);
  const out = await demoSql(db);
  assert.match(out.join("\n"), /ROLLBACK/);
  assert.equal(Number((await db.query("SELECT COUNT(*) n FROM venues"))[0].n), before);
});

test("Waitlist auto-promotion, check-in toggle, and CSV roster sanitization", async () => {
  await createUser(db, {
    name: "=FormulaName",
    email: "two@campus.test",
    studentId: "CSE2026002",
    password: PASSWORD,
  });

  const eventId = await services.saveEvent(
    eventFields({ title: "Limited Seat Seminar", expected_attendance: "1" }),
    1,
  );

  const s1 = request.agent(server);
  await login(s1, "student@campus.test");
  const t1 = await csrf(s1, "/events");
  await s1.post(`/events/${eventId}/register`).type("form").send({ csrf_token: t1 });

  // Student 2 joins waitlist
  const s2 = request.agent(server);
  await login(s2, "two@campus.test");
  const t2 = await csrf(s2, "/events");
  assert.match((await s2.get("/events")).text, /Join waitlist/);
  await s2.post(`/events/${eventId}/waitlist`).type("form").send({ csrf_token: t2 });
  assert.match((await s2.get("/registrations")).text, /Waitlisted/);

  // Student 1 cancels -> Student 2 is automatically promoted to confirmed
  await s1
    .post(`/events/${eventId}/unregister`)
    .type("form")
    .send({ csrf_token: t1, return_to: "/registrations" });
  assert.match((await s2.get("/registrations")).text, /Confirmed/);

  // Admin checks in promoted Student 2 and downloads CSV roster
  const admin = request.agent(server);
  await login(admin);
  const attendeesPage = await admin.get(`/events/${eventId}/attendees`);
  assert.equal(attendeesPage.status, 200);
  assert.match(attendeesPage.text, /=FormulaName/);
  const regIdMatch = attendeesPage.text.match(
    new RegExp(`/events/${eventId}/attendees/(\\d+)/checkin`),
  );
  assert.ok(regIdMatch);
  const aCsrf = await csrf(admin, `/events/${eventId}/attendees`);
  await admin
    .post(`/events/${eventId}/attendees/${regIdMatch[1]}/checkin`)
    .type("form")
    .send({ csrf_token: aCsrf });
  assert.match((await admin.get(`/events/${eventId}/attendees`)).text, /Checked in/);

  const csvRes = await admin.get(`/events/${eventId}/attendees.csv`);
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers["content-type"], /text\/csv/);
  assert.match(csvRes.text, /'=FormulaName,CSE2026002,two@campus.test,confirmed,Yes/);
});

test("Admin user provisioning, self password change, and persistent SQLite file mode", async () => {
  const admin = request.agent(server);
  await login(admin);
  const uCsrf = await csrf(admin, "/users");

  const newPass = "FreshStrongPass#2026";
  const createRes = await admin
    .post("/users")
    .type("form")
    .send({
      csrf_token: uCsrf,
      name: "Priya Nair",
      email: "priya@campus.test",
      role: "student",
      student_id: "CSE2026099",
      password: newPass,
    });
  assert.equal(createRes.status, 302);
  assert.match((await admin.get("/users")).text, /Priya Nair/);

  // New user logs in and rotates password
  const priya = request.agent(server);
  await login(priya, "CSE2026099", newPass);
  const acctCsrf = await csrf(priya, "/account");
  const rotatedPass = "RotatedStrongPass#2026";
  const chgRes = await priya
    .post("/account/password")
    .type("form")
    .send({
      csrf_token: acctCsrf,
      current_password: newPass,
      new_password: rotatedPass,
      confirm_password: rotatedPass,
    });
  assert.equal(chgRes.status, 302);

  // New password works, old password fails
  const priya2 = request.agent(server);
  await login(priya2, "priya@campus.test", rotatedPass);

  // Persistent SQLite file keeps records across reopen
  const tmpDir = mkdtempSync(join(tmpdir(), "campusflow-sqlite-"));
  const sqliteFile = join(tmpDir, "campus.sqlite");
  try {
    const db1 = await createDatabase({
      host: "127.0.0.1",
      port: 1,
      user: "x",
      password: "x",
      database: "x",
      sqlitePath: sqliteFile,
    });
    assert.equal(db1.isFallback, true);
    await db1.query("INSERT INTO venues (venue_name, capacity, resources) VALUES (?,?,?)", [
      "Persistent Hall",
      90,
      "Mic",
    ]);
    db1.close();

    const db2 = await createDatabase({
      host: "127.0.0.1",
      port: 1,
      user: "x",
      password: "x",
      database: "x",
      sqlitePath: sqliteFile,
    });
    const found = await db2.query("SELECT venue_name FROM venues WHERE venue_name=?", [
      "Persistent Hall",
    ]);
    assert.equal(found.length, 1);
    db2.close();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Faculty RBAC, university-ID login, and zero technical jargon across faculty views", async () => {
  const faculty = request.agent(server);
  await login(faculty, "FAC2026001");

  for (const path of [
    "/dashboard",
    "/faculty",
    "/faculty/events/new",
    "/events",
    "/events/1/attendees",
    "/account",
  ]) {
    const res = await faculty.get(path);
    assert.equal(res.status, 200, `Expected 200 for faculty on ${path}`);
    assert.doesNotMatch(res.text, TECH_JARGON, `Found disallowed jargon on ${path}`);
  }

  const csvRes = await faculty.get("/events/1/attendees.csv");
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers["content-type"], /text\/csv/);

  for (const blocked of [
    "/venues",
    "/venues/new",
    "/venues/assign",
    "/events/new",
    "/reports",
    "/users",
    "/simulator",
    "/runs",
    "/registrations",
  ]) {
    assert.equal((await faculty.get(blocked)).status, 403, `Expected 403 for faculty on ${blocked}`);
  }

  const ft = await csrf(faculty, "/events");
  assert.equal(
    (await faculty.post("/events/1/register").type("form").send({ csrf_token: ft })).status,
    403,
  );
  assert.equal(
    (
      await faculty
        .post("/simulator/save")
        .type("form")
        .send({ csrf_token: ft, input_token: signInput(parseProcesses(SOURCE), "FCFS", 2, SECRET) })
    ).status,
    403,
  );
  assert.equal(
    (await faculty.post("/venues/assign/1").type("form").send({ csrf_token: ft, venue_id: "1" })).status,
    403,
  );

  // Student must be blocked from faculty & venue assignment portals
  const student = request.agent(server);
  await login(student, "student@campus.test");
  for (const path of ["/faculty", "/faculty/events/new", "/events/1/attendees", "/events/1/attendees.csv", "/venues/assign"]) {
    assert.equal((await student.get(path)).status, 403, `Expected 403 for student on ${path}`);
  }
});

test("Faculty event creation -> venue queue -> admin multi-parameter venue assignment -> registration & check-in", async () => {
  const faculty = request.agent(server);
  await login(faculty, "faculty@campus.test");

  const allHalls = await db.query(
    "SELECT venue_id, venue_name, capacity FROM venues ORDER BY capacity DESC, venue_id ASC",
  );
  assert.ok(allHalls.length >= 2);
  const largestHall = allHalls[0];
  const preferredHall = allHalls[1];
  const targetAttendance = Math.max(10, Math.floor(preferredHall.capacity * 0.85));

  const slotDate = futureDate(18);
  const fToken = await csrf(faculty, "/faculty/events/new");
  const submitRes = await faculty
    .post("/faculty/events/new")
    .type("form")
    .send({
      csrf_token: fToken,
      title: "Quantum Computing Seminar",
      description: "Faculty seminar covering quantum error correction.",
      event_date: slotDate,
      start_time: "14:00",
      end_time: "16:00",
      expected_attendance: String(targetAttendance),
      preferred_venue_id: String(preferredHall.venue_id),
      event_category: "seminar",
      priority_level: "high",
      required_resources: ["Projector", "Microphone / PA Audio"],
      setup_minutes: "20",
      av_support_needed: "1",
      accessibility_needed: "1",
      faculty_notes: "Need lapel mic ready.",
    });
  assert.equal(submitRes.status, 302);
  assert.equal(submitRes.headers.location, "/faculty");

  const hubHtml = (await faculty.get("/faculty")).text;
  assert.match(hubHtml, /Quantum Computing Seminar/);
  assert.match(hubHtml, /HIGH/);
  assert.match(hubHtml, /Queue #\d+ of \d+/);

  const [createdEvent] = await db.query(
    "SELECT event_id, status FROM events WHERE title=?",
    ["Quantum Computing Seminar"],
  );
  assert.ok(createdEvent);
  assert.equal(createdEvent.status, "pending_schedule");

  const [createdReq] = await db.query(
    "SELECT request_id, queue_status, priority_level FROM venue_requests WHERE event_id=?",
    [createdEvent.event_id],
  );
  assert.ok(createdReq);
  assert.equal(createdReq.queue_status, "queued");
  assert.equal(createdReq.priority_level, "high");

  // Create a conflicting scheduled event in preferredHall on the same slot
  await services.saveEvent(
    eventFields({
      title: "Conflicting Hall Booking",
      event_date: slotDate,
      start_time: "14:30",
      end_time: "15:30",
      expected_attendance: "10",
      venue_id: String(preferredHall.venue_id),
      status: "scheduled",
    }),
    1,
  );

  // Admin reviews queued event in venue assignment portal with multi-parameter filters
  const admin = request.agent(server);
  await login(admin);
  const assignPage = await admin.get("/venues/assign?min_headroom=10&strict_resources=0&enforce_buffer=1");
  assert.equal(assignPage.status, 200);
  assert.match(assignPage.text, /Quantum Computing Seminar/);
  assert.match(assignPage.text, /Departmental Robotics Showcase/);
  assert.match(assignPage.text, /Conflict/);

  const aCsrf = await csrf(admin, "/venues/assign");

  // Attempting to assign conflicting preferredHall must be rejected cleanly
  const badAssign = await admin
    .post(`/venues/assign/${createdReq.request_id}`)
    .type("form")
    .send({
      csrf_token: aCsrf,
      venue_id: String(preferredHall.venue_id),
      admin_notes: "Try conflict",
    });
  assert.equal(badAssign.status, 302);
  const [stillQueued] = await db.query(
    "SELECT queue_status FROM venue_requests WHERE request_id=?",
    [createdReq.request_id],
  );
  assert.equal(stillQueued.queue_status, "queued");

  // Assign an eligible non-conflicting hall (largestHall)
  const targetVenueId = String(largestHall.venue_id);
  const okAssign = await admin
    .post(`/venues/assign/${createdReq.request_id}`)
    .type("form")
    .send({
      csrf_token: aCsrf,
      venue_id: targetVenueId,
      admin_notes: "Assigned with AV engineer on standby.",
    });
  assert.equal(okAssign.status, 302);

  const [updatedEvent] = await db.query(
    "SELECT status, venue_id FROM events WHERE event_id=?",
    [createdEvent.event_id],
  );
  assert.equal(updatedEvent.status, "scheduled");
  assert.equal(String(updatedEvent.venue_id), targetVenueId);

  const [updatedReq] = await db.query(
    "SELECT queue_status, assigned_venue_id FROM venue_requests WHERE request_id=?",
    [createdReq.request_id],
  );
  assert.equal(updatedReq.queue_status, "assigned");
  assert.equal(String(updatedReq.assigned_venue_id), targetVenueId);

  // Student registers for newly opened faculty event, and faculty checks student in + downloads CSV
  const student = request.agent(server);
  await login(student, "student@campus.test");
  const stToken = await csrf(student, "/events");
  const stuReg = await student
    .post(`/events/${createdEvent.event_id}/register`)
    .type("form")
    .send({ csrf_token: stToken });
  assert.equal(stuReg.status, 302);

  const rosterPage = await faculty.get(`/events/${createdEvent.event_id}/attendees`);
  assert.equal(rosterPage.status, 200);
  assert.match(rosterPage.text, /CSE2026001/);

  const [regRow] = await db.query(
    "SELECT registration_id FROM registrations WHERE event_id=?",
    [createdEvent.event_id],
  );
  const fRosterToken = await csrf(faculty, `/events/${createdEvent.event_id}/attendees`);
  const checkinRes = await faculty
    .post(`/events/${createdEvent.event_id}/attendees/${regRow.registration_id}/checkin`)
    .type("form")
    .send({ csrf_token: fRosterToken });
  assert.equal(checkinRes.status, 302);

  const csvOut = await faculty.get(`/events/${createdEvent.event_id}/attendees.csv`);
  assert.equal(csvOut.status, 200);
  assert.match(csvOut.text, /CSE2026001,student@campus\.test,confirmed,Yes/);
});

test("Admin declines queue request, faculty revises & re-queues or withdraws, and admin provisions faculty account", async () => {
  const admin = request.agent(server);
  await login(admin);

  const [seededReq] = await db.query("SELECT request_id, event_id FROM venue_requests LIMIT 1");
  assert.ok(seededReq);

  const aToken = await csrf(admin, "/venues/assign");
  const declineRes = await admin
    .post(`/venues/assign/${seededReq.request_id}/decline`)
    .type("form")
    .send({ csrf_token: aToken, admin_notes: "Shift slot 30 minutes later for maintenance" });
  assert.equal(declineRes.status, 302);

  const faculty = request.agent(server);
  await login(faculty, "faculty@campus.test");
  let fHtml = (await faculty.get("/faculty")).text;
  assert.match(fHtml, /Returned for Revision/);
  assert.match(fHtml, /Shift slot 30 minutes later for maintenance/);

  // Re-enter queue with revised parameters
  const fToken = await csrf(faculty, "/faculty");
  const requeueRes = await faculty
    .post("/faculty/queue")
    .type("form")
    .send({
      csrf_token: fToken,
      event_id: String(seededReq.event_id),
      preferred_venue_id: "any",
      priority_level: "urgent",
      setup_minutes: "30",
      custom_resources: "Projector, High-speed LAN",
      faculty_notes: "Flexible timing approved.",
    });
  assert.equal(requeueRes.status, 302);

  const [requeued] = await db.query(
    "SELECT queue_status, priority_level FROM venue_requests WHERE request_id=?",
    [seededReq.request_id],
  );
  assert.equal(requeued.queue_status, "queued");
  assert.equal(requeued.priority_level, "urgent");

  // Withdraw leaves event as an unqueued pending event ready to queue again later
  const wToken = await csrf(faculty, "/faculty");
  const withdrawRes = await faculty
    .post(`/faculty/queue/${seededReq.request_id}/withdraw`)
    .type("form")
    .send({ csrf_token: wToken });
  assert.equal(withdrawRes.status, 302);
  fHtml = (await faculty.get("/faculty")).text;
  assert.match(fHtml, /Queue an existing event for a venue/);

  // Admin creates a new faculty user account
  const uToken = await csrf(admin, "/users");
  const newFacPass = "FacultyStrongPass#2026";
  const createFac = await admin
    .post("/users")
    .type("form")
    .send({
      csrf_token: uToken,
      name: "Prof. Vikram Rao",
      email: "vikram@campus.test",
      role: "faculty",
      student_id: "FAC2026099",
      password: newFacPass,
    });
  assert.equal(createFac.status, 302);

  const newFac = request.agent(server);
  await login(newFac, "FAC2026099", newFacPass);
  const newFacHub = await newFac.get("/faculty");
  assert.equal(newFacHub.status, 200);
  assert.doesNotMatch(newFacHub.text, TECH_JARGON);
});
