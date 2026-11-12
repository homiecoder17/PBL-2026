import { test as nodeTest, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/passwords.js";
import { parseProcesses } from "../src/scheduler.js";
import { signInput, saveSignedRun } from "../src/scheduling-store.js";
import { createUser, seedDemo, seedEvents, demoSql } from "../src/accounts.js";
const enabled = process.env.RUN_DB_TESTS === "1";
const test = (name, fn) => nodeTest(name, { skip: !enabled }, fn);
const PASSWORD = "Tests-only-passphrase-2026!",
  SECRET = "test-only-session-secret-at-least-32-characters";
const SOURCE =
  "P1,Report,0,7\nP2,Registrations,2,4\nP3,Attendance,4,1\nP4,Certificates,5,4";
let app, server, db, services, config, hashed, sampleSQL;
const tables = [
  "app_sessions",
  "scheduling_results",
  "scheduling_runs",
  "event_tasks",
  "venue_requests",
  "registrations",
  "events",
  "venues",
  "users",
];
before(async () => {
  if (!enabled) return;
  const name =
    process.env.TEST_MYSQL_DATABASE || "university_event_system_test";
  if (
    !/^[A-Za-z0-9_]+_test$/.test(name) ||
    name.toLowerCase() ===
      (process.env.MYSQL_DATABASE || "university_event_system").toLowerCase()
  )
    throw new Error(
      "Refusing destructive tests: use a separate database ending with _test.",
    );
  const options = {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  };
  const init = await mysql.createConnection(options);
  try {
    await init.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await init.query(`USE \`${name}\``);
    await init.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of tables) await init.query(`DROP TABLE IF EXISTS \`${t}\``);
    await init.query("SET FOREIGN_KEY_CHECKS=1");
    const sql = (
      await readFile(new URL("../database/init.sql", import.meta.url), "utf8")
    ).replace(/^\s*--.*$/gm, "");
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statements)
      if (!/^(CREATE DATABASE|USE )/i.test(s)) await init.query(s);
    sampleSQL = statements.filter((s) =>
      /^INSERT INTO (venues|event_tasks)/i.test(s),
    );
  } finally {
    await init.end();
  }
  app = await createApp({ secret: SECRET, database: name });
  db = app.locals.db;
  services = app.locals.services;
  config = app.locals.config;
  hashed = await hashPassword(PASSWORD);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
});
beforeEach(async () => {
  if (!enabled) return;
  const conn = await db.pool.getConnection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t}\``);
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    for (const s of sampleSQL) await conn.query(s);
  } finally {
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    conn.release();
  }
  for (const [name, email, sid, role] of [
    ["Admin", "admin@campus.test", null, "admin"],
    ["Student", "student@campus.test", "CSE001", "student"],
    ["Student Two", "two@campus.test", "CSE002", "student"],
  ])
    await db.query(
      "INSERT INTO users (name,email,student_id,password_hash,role) VALUES (?,?,?,?,?)",
      [name, email, sid, hashed, role],
    );
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (app) await app.locals.close();
});
function fields(overrides = {}) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 15);
  return {
    title: "Test event",
    description: "Test description",
    event_date: d.toISOString().slice(0, 10),
    start_time: "10:00",
    end_time: "11:00",
    expected_attendance: "20",
    venue_id: "1",
    status: "scheduled",
    ...overrides,
  };
}
const count = async (table) =>
  Number((await db.query(`SELECT COUNT(*) n FROM ${table}`))[0].n);
async function csrf(agent, path = "/login") {
  const r = await agent.get(path);
  assert.equal(r.status, 200);
  return r.text.match(/name="csrf_token" value="([^"]+)"/)[1];
}
async function login(agent, role = "admin") {
  const token = await csrf(agent);
  const r = await agent
    .post("/login")
    .type("form")
    .send({
      csrf_token: token,
      identifier: role + "@campus.test",
      password: PASSWORD,
    });
  assert.equal(r.status, 302);
  return r;
}
async function post(agent, path, data) {
  return agent.post(path).type("form").send(data);
}
async function show(agent, path) {
  const r = await agent.get(path);
  assert.equal(r.status, 200);
  return r.text;
}

test("Schema sample records and application health are real and valid", async () => {
  assert.equal(await count("venues"), 8);
  assert.equal(await count("event_tasks"), 5);
  const r = await request(server).get("/health");
  assert.deepEqual(r.body, { status: "ok", database_checked: false });
});
test("Correct administrator login grants dashboard access", async () => {
  const a = request.agent(server);
  await login(a);
  assert.match(await show(a, "/dashboard"), /Administrator Console/);
});
test("Wrong login leaves no authenticated session", async () => {
  const a = request.agent(server);
  const r = await post(a, "/login", {
    csrf_token: await csrf(a),
    identifier: "admin@campus.test",
    password: "wrong",
  });
  assert.match(r.text, /Incorrect email\/student ID or password/);
  assert.equal((await a.get("/dashboard")).status, 302);
});
test("Student ID authentication works", async () => {
  const a = request.agent(server);
  assert.equal(
    (
      await post(a, "/login", {
        csrf_token: await csrf(a),
        identifier: "CSE001",
        password: PASSWORD,
      })
    ).status,
    302,
  );
  assert.match(await show(a, "/dashboard"), /Campus Hub Live/);
});
test("Student cannot access administrator pages or create events", async () => {
  const a = request.agent(server);
  await login(a, "student");
  for (const path of ["/venues", "/events/new", "/reports", "/users", "/simulator", "/runs"])
    assert.equal((await a.get(path)).status, 403);
});
test("Logout destroys the server-side session and access", async () => {
  const a = request.agent(server);
  await login(a);
  const token = await csrf(a, "/dashboard");
  assert.equal((await post(a, "/logout", { csrf_token: token })).status, 302);
  assert.equal((await a.get("/dashboard")).status, 302);
});
test("Missing and malformed Unicode CSRF tokens rejected with 400", async () => {
  const a = request.agent(server);
  await csrf(a);
  for (const token of ["", "é".repeat(64)])
    assert.equal(
      (
        await post(a, "/login", {
          csrf_token: token,
          identifier: "admin@campus.test",
          password: PASSWORD,
        })
      ).status,
      400,
    );
});
test("Login regenerates the session ID and CSRF token", async () => {
  const a = request.agent(server);
  const before = await a.get("/login");
  const token = before.text.match(/name="csrf_token" value="([^"]+)"/)[1];
  const r = await post(a, "/login", {
    csrf_token: token,
    identifier: "admin@campus.test",
    password: PASSWORD,
  });
  assert.notEqual(
    before.headers["set-cookie"][0].split(";")[0],
    r.headers["set-cookie"][0].split(";")[0],
  );
  assert.equal((await post(a, "/logout", { csrf_token: token })).status, 400);
});
test("Session survives application recreation using the MySQL store", async () => {
  const a = request.agent(server);
  await login(a);
  const response = await a.get("/dashboard");
  const cookie = response.headers["set-cookie"][0].split(";")[0];
  const second = await createApp({ ...config });
  const other = second.listen(0, "127.0.0.1");
  await once(other, "listening");
  try {
    assert.equal(
      (await request(other).get("/dashboard").set("Cookie", cookie)).status,
      200,
    );
  } finally {
    await new Promise((resolve) => other.close(resolve));
    await second.locals.close();
  }
});
test("Expired MySQL sessions cannot authenticate", async () => {
  const a = request.agent(server);
  await login(a);
  await db.query("UPDATE app_sessions SET expires_at=0");
  assert.equal((await a.get("/dashboard")).status, 302);
});
test("Passwords are hashed in MySQL and no public signup exists", async () => {
  const row = (
    await db.query("SELECT password_hash FROM users WHERE user_id=1")
  )[0];
  assert.notEqual(row.password_hash, PASSWORD);
  assert.equal(await verifyPassword(row.password_hash, PASSWORD), true);
  assert.equal((await request(server).get("/signup")).status, 404);
});
test("Event CRUD inserts, updates and deletes actual records", async () => {
  const id = await services.saveEvent(fields(), 1);
  assert.equal(
    (await db.query("SELECT title FROM events WHERE event_id=?", [id]))[0]
      .title,
    "Test event",
  );
  await services.saveEvent(fields({ title: "Edited" }), 1, id);
  assert.equal(
    (await db.query("SELECT title FROM events WHERE event_id=?", [id]))[0]
      .title,
    "Edited",
  );
  await services.deleteEvent(id);
  assert.equal(await count("events"), 0);
});
for (const [label, override] of [
  ["end before start", { end_time: "09:00" }],
  ["equal times", { end_time: "10:00" }],
  ["invalid date", { event_date: "2026-02-30" }],
  ["past date", { event_date: "2000-01-01" }],
  ["capacity exceeded", { expected_attendance: "301" }],
  ["zero attendance", { expected_attendance: "0" }],
  ["unknown venue", { venue_id: "999" }],
  ["invalid status", { status: "hacked" }],
  ["non-numeric venue", { venue_id: "abc" }],
])
  test("Invalid event rejected and rolled back: " + label, async () => {
    await assert.rejects(() => services.saveEvent(fields(override), 1));
    assert.equal(await count("events"), 0);
  });
test("Overlaps rejected; adjacent slots and another venue accepted", async () => {
  await services.saveEvent(fields(), 1);
  await assert.rejects(
    () =>
      services.saveEvent(fields({ start_time: "10:30", end_time: "11:30" }), 1),
    /conflict/,
  );
  await services.saveEvent(
    fields({ start_time: "11:00", end_time: "12:00" }),
    1,
  );
  await services.saveEvent(fields({ venue_id: "2" }), 1);
  assert.equal(await count("events"), 3);
});
test("Conflicting event edits roll back and cancellation frees the slot", async () => {
  const a = await services.saveEvent(fields(), 1),
    b = await services.saveEvent(
      fields({ start_time: "11:00", end_time: "12:00" }),
      1,
    );
  await assert.rejects(() =>
    services.saveEvent(
      fields({ start_time: "10:30", end_time: "11:30" }),
      1,
      b,
    ),
  );
  await services.saveEvent(fields({ status: "cancelled" }), 1, a);
  await services.saveEvent(fields(), 1);
  assert.equal(await count("events"), 3);
});
test("Concurrent identical venue bookings allow exactly one event", async () => {
  const r = await Promise.allSettled([
    services.saveEvent(fields(), 1),
    services.saveEvent(fields(), 1),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(await count("events"), 1);
});
test("Venue CRUD and duplicate names are handled", async () => {
  const id = await services.saveVenue({
    venue_name: "New Hall",
    capacity: "30",
    resources: "Projector",
  });
  await services.saveVenue(
    { venue_name: "Updated Hall", capacity: "40", resources: "Wi-Fi" },
    id,
  );
  await assert.rejects(
    () =>
      services.saveVenue({
        venue_name: "Updated Hall",
        capacity: "40",
        resources: "Wi-Fi",
      }),
    /already exists/,
  );
  await services.deleteVenue(id);
  assert.equal(await count("venues"), 8);
});
test("Referenced venue deletion and capacity reduction rejected", async () => {
  await services.saveEvent(fields(), 1);
  await assert.rejects(() => services.deleteVenue(1), /referenced/);
  await assert.rejects(
    () =>
      services.saveVenue(
        { venue_name: "Main Auditorium", capacity: "10", resources: "Stage" },
        1,
      ),
    /attendance/,
  );
});
test("Event creation and editing HTML forms work", async () => {
  const a = request.agent(server);
  await login(a);
  const token = await csrf(a, "/dashboard");
  assert.equal(
    (await post(a, "/events/new", { ...fields(), csrf_token: token })).status,
    302,
  );
  const id = (await db.query("SELECT event_id FROM events"))[0].event_id;
  assert.match(await show(a, `/events/${id}/edit`), /Test event/);
  assert.equal(
    (
      await a
        .post(`/events/${id}/edit`)
        .type("form")
        .send({ ...fields({ title: "Updated via form" }), csrf_token: token })
    ).status,
    302,
  );
  assert.match(await show(a, "/events"), /Updated via form/);
});
test("Student registration stores time and rejects duplicate", async () => {
  const id = await services.saveEvent(fields(), 1);
  await services.registerStudent(id, 2);
  assert.ok(
    (await db.query("SELECT registration_date FROM registrations"))[0]
      .registration_date,
  );
  await assert.rejects(
    () => services.registerStudent(id, 2),
    /already registered/,
  );
  assert.equal(await count("registrations"), 1);
});
test("Database UNIQUE independently prevents duplicate registration", async () => {
  const id = await services.saveEvent(fields(), 1);
  await services.registerStudent(id, 2);
  await assert.rejects(
    () =>
      db.query("INSERT INTO registrations (user_id,event_id) VALUES (?,?)", [
        2,
        id,
      ]),
    (e) => e.errno === 1062,
  );
  assert.equal(await count("registrations"), 1);
});
test("Full event rejects another student", async () => {
  const id = await services.saveEvent(fields({ expected_attendance: "1" }), 1);
  await services.registerStudent(id, 2);
  await assert.rejects(() => services.registerStudent(id, 3), /full/);
  assert.equal(await count("registrations"), 1);
});
test("Concurrent requests for the final seat allow exactly one registration", async () => {
  const id = await services.saveEvent(fields({ expected_attendance: "1" }), 1);
  const r = await Promise.allSettled([
    services.registerStudent(id, 2),
    services.registerStudent(id, 3),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(await count("registrations"), 1);
});
test("Cancellation rejects new registration and deletion cascades old records", async () => {
  const id = await services.saveEvent(fields(), 1);
  await services.registerStudent(id, 2);
  await services.saveEvent(fields({ status: "cancelled" }), 1, id);
  await assert.rejects(() => services.registerStudent(id, 3), /not available/);
  await services.deleteEvent(id);
  assert.equal(await count("registrations"), 0);
});
test("Attendance limit cannot fall below existing registrations", async () => {
  const id = await services.saveEvent(fields({ expected_attendance: "2" }), 1);
  await services.registerStudent(id, 2);
  await services.registerStudent(id, 3);
  await assert.rejects(
    () => services.saveEvent(fields({ expected_attendance: "1" }), 1, id),
    /registration count/,
  );
  assert.equal(
    (await db.query("SELECT expected_attendance FROM events"))[0]
      .expected_attendance,
    2,
  );
});
test("Past-start events reject registrations", async () => {
  const id = await services.saveEvent(fields(), 1);
  await db.query("UPDATE events SET event_date='2000-01-01' WHERE event_id=?", [
    id,
  ]);
  await assert.rejects(() => services.registerStudent(id, 2), /closes/);
  assert.equal(await count("registrations"), 0);
});
test("Student registration/history route works; admin registration forbidden", async () => {
  const id = await services.saveEvent(fields(), 1),
    a = request.agent(server);
  await login(a, "student");
  assert.equal(
    (
      await a
        .post(`/events/${id}/register`)
        .type("form")
        .send({ csrf_token: await csrf(a, "/dashboard") })
    ).status,
    302,
  );
  assert.match(await show(a, "/registrations"), /Test event/);
  const admin = request.agent(server);
  await login(admin);
  assert.equal(
    (
      await admin
        .post(`/events/${id}/register`)
        .type("form")
        .send({ csrf_token: await csrf(admin, "/dashboard") })
    ).status,
    403,
  );
});
test("Foreign keys and CHECK constraints reject invalid SQL writes", async () => {
  await assert.rejects(() =>
    db.query(
      "INSERT INTO registrations (user_id,event_id) VALUES (?,?)",
      [999, 999],
    ),
  );
  await assert.rejects(() =>
    db.query(
      "INSERT INTO event_tasks (process_id,task_name,arrival_time,burst_time) VALUES ('BAD','Invalid',0,0)",
    ),
  );
  assert.equal(await count("registrations"), 0);
  assert.equal(
    (await db.query("SELECT task_id FROM event_tasks WHERE process_id='BAD'"))
      .length,
    0,
  );
});
test("Repeated saved SJF runs have distinct IDs and correct stored values", async () => {
  const token = signInput(parseProcesses(SOURCE), "SJF", 1, SECRET),
    first = await saveSignedRun(db, token, 1, SECRET),
    second = await saveSignedRun(db, token, 1, SECRET);
  assert.notEqual(first, second);
  assert.equal(await count("scheduling_runs"), 2);
  const rows = await db.query(
    "SELECT waiting_time FROM scheduling_results WHERE run_id=? ORDER BY arrival_time",
    [first],
  );
  assert.deepEqual(
    rows.map((r) => r.waiting_time),
    [0, 6, 3, 7],
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT average_waiting_time FROM scheduling_runs WHERE run_id=?",
          [first],
        )
      )[0].average_waiting_time,
    ),
    4,
  );
});
test("Invalid signed run cannot create result or task records", async () => {
  await assert.rejects(() => saveSignedRun(db, "tampered", 1, SECRET));
  await assert.rejects(() =>
    saveSignedRun(
      db,
      signInput(parseProcesses(SOURCE), "FCFS", 1, SECRET),
      2,
      SECRET,
    ),
  );
  assert.equal(await count("scheduling_runs"), 0);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT COUNT(*) n FROM event_tasks WHERE status='simulated'",
        )
      )[0].n,
    ),
    0,
  );
});
test("Failed result persistence is atomic", async () => {
  await assert.rejects(() =>
    saveSignedRun(
      db,
      signInput(parseProcesses(SOURCE), "FCFS", 999, SECRET),
      999,
      SECRET,
    ),
  );
  assert.equal(await count("scheduling_runs"), 0);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT COUNT(*) n FROM event_tasks WHERE status='simulated'",
        )
      )[0].n,
    ),
    0,
  );
});
test("Simulator form compares both algorithms and saves to MySQL", async () => {
  const a = request.agent(server);
  await login(a);
  const token = await csrf(a, "/dashboard");
  const r = await post(a, "/simulator", {
    csrf_token: token,
    processes: SOURCE,
  });
  assert.equal(r.status, 200);
  assert.match(r.text, /FCFS/);
  assert.match(r.text, /SJF/);
  const signed = r.text.match(/name="input_token" value="([^"]+)"/)[1];
  const save = await post(a, "/simulator/save", {
    csrf_token: token,
    input_token: signed,
  });
  assert.equal(save.status, 302);
  assert.match(await show(a, save.headers.location), /Saved FCFS run/);
});
test("Invalid simulator inputs and expired saves show validation errors", async () => {
  const a = request.agent(server);
  await login(a);
  const token = await csrf(a, "/dashboard");
  const r = await post(a, "/simulator", {
    csrf_token: token,
    processes: "P1,A,0,0",
  });
  assert.equal(r.status, 200);
  assert.match(r.text, /Burst time/);
  const save = await post(a, "/simulator/save", {
    csrf_token: token,
    input_token: signInput(
      parseProcesses(SOURCE),
      "FCFS",
      1,
      SECRET,
      Date.now() - 1800001,
    ),
  });
  assert.equal(save.headers.location, "/simulator");
  assert.equal(await count("scheduling_runs"), 0);
});
test("Students cannot view or list another user’s saved runs", async () => {
  const rid = await saveSignedRun(
      db,
      signInput(parseProcesses(SOURCE), "FCFS", 1, SECRET),
      1,
      SECRET,
    ),
    a = request.agent(server);
  await login(a, "student");
  assert.equal((await a.get("/runs/" + rid)).status, 403);
  assert.equal((await a.get("/runs")).status, 403);
});
test("Reports allow only known queries and enforce administrator access", async () => {
  const a = request.agent(server);
  await login(a);
  for (const q of [
    "event_counts",
    "student_roster",
    "available_events",
    "run_comparison",
  ])
    assert.equal((await a.get("/reports?query=" + q)).status, 200);
  for (const q of ["DROP TABLE users", "__proto__"])
    assert.equal((await a.get("/reports").query({ query: q })).status, 400);
});
test("HTML is escaped and login SQL injection cannot authenticate", async () => {
  await services.saveEvent(fields({ title: "<script>alert(1)</script>" }), 1);
  const a = request.agent(server);
  await login(a);
  const html = await show(a, "/events");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  const b = request.agent(server);
  const r = await post(b, "/login", {
    csrf_token: await csrf(b),
    identifier: "' OR 1=1 --",
    password: PASSWORD,
  });
  assert.match(r.text, /Incorrect email/);
  assert.equal((await b.get("/dashboard")).status, 302);
});
test("Secure account initialization refuses weak and existing accounts", async () => {
  await db.query("DELETE FROM users");
  await assert.rejects(() =>
    seedDemo(db, { adminPassword: "short", studentPassword: PASSWORD }),
  );
  assert.equal(await count("users"), 0);
  await seedDemo(db, { adminPassword: PASSWORD, studentPassword: PASSWORD });
  const rows = await db.query("SELECT password_hash FROM users");
  assert.equal(rows.length, 2);
  for (const row of rows)
    assert.equal(await verifyPassword(row.password_hash, PASSWORD), true);
  await assert.rejects(() =>
    seedDemo(db, { adminPassword: PASSWORD, studentPassword: PASSWORD }),
  );
});
test("Additional student creation and duplicate ID validation work", async () => {
  await createUser(db, {
    name: "Extra Student",
    email: "extra@campus.test",
    studentId: "CSE003",
    password: PASSWORD,
  });
  assert.equal(await count("users"), 4);
  await assert.rejects(() =>
    createUser(db, {
      name: "Other",
      email: "other@campus.test",
      studentId: "CSE003",
      password: PASSWORD,
    }),
  );
  await assert.rejects(() =>
    createUser(db, {
      name: "Other",
      email: "other@campus.test",
      role: "superadmin",
      password: PASSWORD,
    }),
  );
});
test("Future sample events seed once through the booking service", async () => {
  await seedEvents(db, services, config);
  assert.equal(await count("events"), 3);
  await assert.rejects(() => seedEvents(db, services, config));
});
test("Non-destructive SQL CRUD demonstration rolls back all changes", async () => {
  const before = await count("venues");
  const output = await demoSql(db);
  assert.match(
    output.join("\n"),
    /INSERT.*\nUPDATE.*\nSELECT.*\nDELETE.*\nROLLBACK/s,
  );
  assert.equal(await count("venues"), before);
});
test("Full workflow: admin event, student registration, simulation save, reports, cascade deletion", async () => {
  const a = request.agent(server);
  await login(a);
  const token = await csrf(a, "/dashboard");
  await post(a, "/events/new", { ...fields(), csrf_token: token });
  const id = (await db.query("SELECT event_id FROM events"))[0].event_id;
  const student = request.agent(server);
  await login(student, "student");
  const st = await csrf(student, "/dashboard");
  await student
    .post(`/events/${id}/register`)
    .type("form")
    .send({ csrf_token: st });
  assert.match(await show(student, "/registrations"), /Test event/);
  const r = await a
    .post("/simulator")
    .type("form")
    .send({ csrf_token: token, processes: "A,Report,3,2\nB,Attendance,10,1" });
  assert.match(r.text, /IDLE/);
  const signed = r.text.match(/name="input_token" value="([^"]+)"/)[1];
  const saved = await a
    .post("/simulator/save")
    .type("form")
    .send({ csrf_token: token, input_token: signed });
  assert.equal(saved.status, 302);
  assert.match(await show(a, saved.headers.location), /Saved FCFS run/);
  assert.match(await show(a, "/reports"), /Test event/);
  await a.post(`/events/${id}/delete`).type("form").send({ csrf_token: token });
  assert.equal(await count("registrations"), 0);
});
