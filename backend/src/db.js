import mysql from "mysql2/promise";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function cleanSql(sql) {
  return sql
    .replace(/\s+FOR\s+UPDATE/gi, "")
    .replace(/SET\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+[A-Za-z\s]+/gi, "")
    .replace(/SET\s+time_zone\s*=\s*['"][^'"]+['"]/gi, "");
}

function initSqliteDatabase(options = {}) {
  const dbPath =
    !options.forceFallback && options.sqlitePath ? options.sqlitePath : ":memory:";
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.function("TIMESTAMP", (d, t) => `${d} ${t}`);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      student_id TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student','admin')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS venues (
      venue_id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_name TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      resources TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      event_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      expected_attendance INTEGER NOT NULL CHECK (expected_attendance > 0),
      venue_id INTEGER NOT NULL REFERENCES venues(venue_id) ON DELETE RESTRICT,
      created_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','pending_schedule','cancelled')),
      CHECK (start_time >= '00:00' AND end_time < '24:00' AND end_time > start_time)
    );

    CREATE TABLE IF NOT EXISTS registrations (
      registration_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
      event_id INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','waitlisted')),
      checked_in INTEGER NOT NULL DEFAULT 0 CHECK (checked_in IN (0,1)),
      checked_in_at TEXT DEFAULT NULL,
      registration_date TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, event_id)
    );

    CREATE TABLE IF NOT EXISTS event_tasks (
      task_id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      arrival_time INTEGER NOT NULL CHECK (arrival_time >= 0),
      burst_time INTEGER NOT NULL CHECK (burst_time > 0),
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'sample' CHECK (status IN ('sample','simulated'))
    );

    CREATE TABLE IF NOT EXISTS scheduling_runs (
      run_id TEXT PRIMARY KEY,
      algorithm TEXT NOT NULL CHECK (algorithm IN ('FCFS','SJF','SRTF','PRIORITY','RR')),
      quantum INTEGER DEFAULT NULL CHECK (quantum IS NULL OR quantum > 0),
      timeline_json TEXT DEFAULT NULL,
      created_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      task_count INTEGER NOT NULL CHECK (task_count > 0),
      average_waiting_time REAL NOT NULL CHECK (average_waiting_time >= 0),
      average_turnaround_time REAL NOT NULL CHECK (average_turnaround_time > 0)
    );

    CREATE TABLE IF NOT EXISTS scheduling_results (
      result_id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES scheduling_runs(run_id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES event_tasks(task_id) ON DELETE RESTRICT,
      algorithm TEXT NOT NULL CHECK (algorithm IN ('FCFS','SJF','SRTF','PRIORITY','RR')),
      process_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      arrival_time INTEGER NOT NULL,
      burst_time INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      start_time INTEGER NOT NULL,
      finish_time INTEGER NOT NULL,
      waiting_time INTEGER NOT NULL,
      turnaround_time INTEGER NOT NULL,
      UNIQUE(run_id, task_id),
      CHECK (
        arrival_time >= 0 AND burst_time > 0 AND start_time >= arrival_time
        AND finish_time >= start_time + burst_time
        AND turnaround_time = finish_time - arrival_time
        AND waiting_time = turnaround_time - burst_time
        AND waiting_time >= 0
      )
    );

    CREATE TABLE IF NOT EXISTS app_sessions (
      session_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const formatDate = (daysAhead) => {
    const d = new Date(now.getTime() + daysAhead * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  const adminHash =
    "scrypt:32768:8:1$WqOr0FxZKzC51bUYfEQM9A$03aa3c775de6649ad30c686a70c197281bacb49ed5e63c9e7019f642f5b72083fc536c5d7baf8b43322e461738f8df06515f16411157e5c227f1c80024ca343b";

  const existingVenues = sqlite.prepare("SELECT COUNT(*) AS n FROM venues").get().n;
  if (options.seedDemoData !== false && existingVenues === 0) {
    sqlite.exec(`
    INSERT INTO users (name, email, student_id, password_hash, role) VALUES
      ('Admin', 'admin@campus.test', NULL, '${adminHash}', 'admin'),
      ('Student', 'student@campus.test', 'CSE2026001', '${adminHash}', 'student');

    INSERT INTO venues (venue_name, capacity, resources) VALUES
      ('Main Auditorium', 300, 'Projector, PA system, stage'),
      ('Innovation Lab', 40, 'Computers, Wi-Fi, whiteboards'),
      ('Seminar Hall', 80, 'Projector, microphone, seating'),
      ('TCL 1-2', 70, 'Computer Lab, Dual Displays, Gigabit LAN, AC'),
      ('TCL 3-4', 70, 'Computer Lab, Projector, High-speed LAN, AC'),
      ('Ubuntu Lab', 120, 'Linux Workstations (100-130 capacity), Gigabit LAN, Smart Projector, AC'),
      ('KP Nautiyal Auditorium', 350, 'Auditorium (300-400 capacity), Stage, Surround Audio, Dual Projectors'),
      ('New Auditorium', 500, 'Grand Auditorium, 500 Capacity, Central AC, Concert Audio & Stage Lights');

    INSERT INTO events (title, description, event_date, start_time, end_time, expected_attendance, venue_id, created_by, status) VALUES
      ('Research & Innovation Symposium', 'Student research presentations, poster sessions, and faculty discussions.', '${formatDate(5)}', '10:00', '12:00', 200, 1, 1, 'scheduled'),
      ('Career Readiness Workshop', 'Practical resume reviews, interview exercises, and career planning.', '${formatDate(6)}', '14:00', '16:00', 60, 3, 1, 'scheduled'),
      ('Build Lab: Campus Hackathon', 'Hands-on prototyping for student software projects.', '${formatDate(7)}', '09:00', '13:00', 35, 2, 1, 'scheduled');

    INSERT INTO registrations (user_id, event_id) VALUES
      (2, 1);

    INSERT INTO event_tasks (process_id, task_name, arrival_time, burst_time, priority, status) VALUES
      ('P1', 'Generate event report', 0, 7, 0, 'sample'),
      ('P2', 'Process registrations', 2, 4, 0, 'sample'),
      ('P3', 'Generate attendance lists', 4, 1, 0, 'sample'),
      ('P4', 'Prepare certificates', 5, 4, 0, 'sample'),
      ('P5', 'Update event statistics', 20, 2, 0, 'sample');

    INSERT INTO scheduling_runs (run_id, algorithm, created_by, task_count, average_waiting_time, average_turnaround_time) VALUES
      ('88888888-8888-4888-8888-888888888888', 'FCFS', 1, 5, 3.8, 7.4),
      ('99999999-9999-4999-9999-999999999999', 'SJF', 1, 5, 3.2, 6.8);

    INSERT INTO scheduling_results (run_id, task_id, algorithm, process_id, task_name, arrival_time, burst_time, start_time, finish_time, waiting_time, turnaround_time) VALUES
      ('88888888-8888-4888-8888-888888888888', 1, 'FCFS', 'P1', 'Generate event report', 0, 7, 0, 7, 0, 7),
      ('88888888-8888-4888-8888-888888888888', 2, 'FCFS', 'P2', 'Process registrations', 2, 4, 7, 11, 5, 9),
      ('88888888-8888-4888-8888-888888888888', 3, 'FCFS', 'P3', 'Generate attendance lists', 4, 1, 11, 12, 7, 8),
      ('88888888-8888-4888-8888-888888888888', 4, 'FCFS', 'P4', 'Prepare certificates', 5, 4, 12, 16, 7, 11),
      ('88888888-8888-4888-8888-888888888888', 5, 'FCFS', 'P5', 'Update event statistics', 20, 2, 20, 22, 0, 2),
      ('99999999-9999-4999-9999-999999999999', 1, 'SJF', 'P1', 'Generate event report', 0, 7, 0, 7, 0, 7),
      ('99999999-9999-4999-9999-999999999999', 3, 'SJF', 'P3', 'Generate attendance lists', 4, 1, 7, 8, 3, 4),
      ('99999999-9999-4999-9999-999999999999', 2, 'SJF', 'P2', 'Process registrations', 2, 4, 8, 12, 6, 10),
      ('99999999-9999-4999-9999-999999999999', 4, 'SJF', 'P4', 'Prepare certificates', 5, 4, 12, 16, 7, 11),
      ('99999999-9999-4999-9999-999999999999', 5, 'SJF', 'P5', 'Update event statistics', 20, 2, 20, 22, 0, 2);
  `);
  }

  async function query(sql, params = []) {
    const cleaned = cleanSql(sql).trim();
    if (!cleaned) return [];
    try {
      const isSelect = /^(SELECT|PRAGMA|EXPLAIN)/i.test(cleaned);
      const stmt = sqlite.prepare(cleaned);
      if (isSelect) {
        return stmt.all(...params);
      }
      const res = stmt.run(...params);
      return {
        insertId: Number(res.lastInsertRowid),
        affectedRows: Number(res.changes),
      };
    } catch (err) {
      if (err.message?.includes("UNIQUE constraint failed")) {
        err.errno = 1062;
      } else if (err.message?.includes("FOREIGN KEY constraint failed")) {
        err.errno = 1451;
      } else if (err.message?.includes("CHECK constraint failed")) {
        err.errno = 3819;
      }
      throw err;
    }
  }

  async function transaction(fn) {
    sqlite.exec("BEGIN IMMEDIATE");
    const fakeConn = {
      isFallback: true,
      execute: async (sql, params = []) => query(sql, params),
      query: async (sql, params = []) => query(sql, params),
    };
    try {
      const res = await fn(fakeConn);
      sqlite.exec("COMMIT");
      return res;
    } catch (err) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {}
      throw err;
    }
  }

  return {
    isFallback: true,
    query,
    transaction,
    close: () => sqlite.close(),
  };
}

export async function createDatabase(config) {
  if (config.forceFallback) {
    return initSqliteDatabase({
      seedDemoData: config.seedDemoData,
      forceFallback: true,
    });
  }

  let pool = null;
  let useFallback = false;

  try {
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 10,
      waitForConnections: true,
      dateStrings: true,
      timezone: "Z",
      charset: "utf8mb4",
      connectTimeout: 1000,
      multipleStatements: false,
    });
    const connection = await pool.getConnection();
    connection.release();
    console.log(`[CampusFlow] Connected to MySQL database '${config.database}' at ${config.host}:${config.port}`);
  } catch (err) {
    console.log(`[CampusFlow] MySQL is offline (${err.code || err.message}). Activated offline relational database.`);
    useFallback = true;
    if (pool) {
      try {
        await pool.end();
      } catch {}
    }
  }

  if (useFallback) {
    return initSqliteDatabase({
      seedDemoData: config.seedDemoData,
      sqlitePath: config.sqlitePath,
    });
  }

  pool.pool.on("connection", (connection) =>
    connection.query("SET time_zone = '+00:00'"),
  );

  async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  async function transaction(fn) {
    const connection = await pool.getConnection();
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { pool, query, transaction, isFallback: false, close: () => pool.end() };
}

export async function execute(connection, sql, params = []) {
  if (connection.isFallback) {
    return connection.query(sql, params);
  }
  const [rows] = await connection.execute(sql, params);
  return rows;
}
