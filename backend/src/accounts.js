import { randomUUID } from "node:crypto";
import { execute } from "./db.js";
import { text } from "./services.js";
import { hashPassword, validatePassword } from "./passwords.js";
import { campusNow } from "./format.js";
export async function createUser(
  db,
  { name, email, role = "student", studentId = null, password },
) {
  name = text(name, "Name", 100);
  email = text(email, "Email", 254).toLowerCase();
  validatePassword(password);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email.");
  if (!["admin", "student"].includes(role))
    throw new Error("Role must be admin or student.");
  if (studentId && !/^[A-Za-z0-9_-]{1,32}$/.test(studentId))
    throw new Error("Invalid student ID.");
  if (
    (
      await db.query(
        "SELECT user_id FROM users WHERE email=? OR student_id=?",
        [email, studentId],
      )
    ).length
  )
    throw new Error("Email or student ID already exists.");
  const hash = await hashPassword(password);
  return db.transaction(
    async (conn) =>
      (
        await execute(
          conn,
          "INSERT INTO users (name,email,student_id,password_hash,role) VALUES (?,?,?,?,?)",
          [name, email, studentId, hash, role],
        )
      ).insertId,
  );
}
export async function seedDemo(db, passwords) {
  validatePassword(passwords.adminPassword);
  validatePassword(passwords.studentPassword);
  if (
    (
      await db.query("SELECT user_id FROM users WHERE email IN (?,?)", [
        "admin@campus.test",
        "student@campus.test",
      ])
    ).length
  )
    throw new Error(
      "Default accounts already exist; passwords were not overwritten.",
    );
  const adminHash = await hashPassword(passwords.adminPassword),
    studentHash = await hashPassword(passwords.studentPassword);
  await db.transaction(async (conn) => {
    await execute(
      conn,
      "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)",
      ["Admin", "admin@campus.test", adminHash, "admin"],
    );
    await execute(
      conn,
      "INSERT INTO users (name,email,student_id,password_hash,role) VALUES (?,?,?,?,?)",
      [
        "Student",
        "student@campus.test",
        "CSE2026001",
        studentHash,
        "student",
      ],
    );
  });
}
export async function seedEvents(db, services, config) {
  const admin = (
    await db.query(
      "SELECT user_id FROM users WHERE role='admin' ORDER BY user_id LIMIT 1",
    )
  )[0];
  if (!admin) throw new Error("Create an administrator first.");
  if ((await db.query("SELECT event_id FROM events LIMIT 1")).length)
    throw new Error("Events already exist; no duplicates were added.");
  const samples = [
    [
      "Research & Innovation Symposium",
      "Student research presentations, poster sessions, and faculty discussions.",
      "Main Auditorium",
      200,
      7,
      "10:00",
      "12:00",
    ],
    [
      "Career Readiness Workshop",
      "Practical resume reviews, interview exercises, and career planning.",
      "Seminar Hall",
      60,
      8,
      "14:00",
      "16:00",
    ],
    [
      "Build Lab: Campus Hackathon",
      "Hands-on prototyping for student software projects.",
      "Innovation Lab",
      35,
      9,
      "09:00",
      "13:00",
    ],
  ];
  for (const [
    title,
    description,
    name,
    attendance,
    days,
    start,
    end,
  ] of samples) {
    const venue = (
      await db.query("SELECT venue_id FROM venues WHERE venue_name=?", [name])
    )[0];
    if (!venue) throw new Error("Initialize the sample venues first.");
    const day = new Date(
      campusNow(config.campusTimezone).slice(0, 10) + "T00:00:00Z",
    );
    day.setUTCDate(day.getUTCDate() + days);
    await services.saveEvent(
      {
        title,
        description,
        event_date: day.toISOString().slice(0, 10),
        start_time: start,
        end_time: end,
        venue_id: venue.venue_id,
        expected_attendance: attendance,
        status: "scheduled",
      },
      admin.user_id,
    );
  }
}
export async function demoSql(db) {
  const output = [];
  const rollback = Symbol("rollback");
  try {
    await db.transaction(async (conn) => {
      const result = await execute(
        conn,
        "INSERT INTO venues (venue_name,capacity,resources) VALUES (?,?,?)",
        ["SQL test " + randomUUID().slice(0, 8), 25, "Temporary test resource"],
      );
      const id = result.insertId;
      output.push("INSERT: temporary venue " + id);
      await execute(conn, "UPDATE venues SET capacity=? WHERE venue_id=?", [
        30,
        id,
      ]);
      output.push("UPDATE: capacity 30");
      const row = (
        await execute(
          conn,
          "SELECT venue_name,capacity FROM venues WHERE venue_id=? ORDER BY venue_id",
          [id],
        )
      )[0];
      output.push("SELECT / WHERE / ORDER BY: " + JSON.stringify(row));
      await execute(conn, "DELETE FROM venues WHERE venue_id=?", [id]);
      output.push("DELETE: temporary venue");
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
    output.push("ROLLBACK: no venue records left behind (ID gaps are normal).");
  }
  return output;
}
