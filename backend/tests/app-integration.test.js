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
