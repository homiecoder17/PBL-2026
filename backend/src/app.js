import express from "express";
import session from "express-session";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { MySQLSessionStore } from "./session-store.js";
import {
  HttpError,
  ensureCsrf,
  verifyCsrf,
  loginRequired,
  roleRequired,
  flash,
  regenerate,
  destroySession,
} from "./security.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { createServices, UserError, integer } from "./services.js";
import {
  campusNow,
  clock,
  displayDate,
  dateDay,
  dateMonth,
  fixed,
} from "./format.js";
import {
  parseProcesses,
  serializeTasks,
  schedule,
  eventsToCsv,
} from "./scheduler.js";
import { REPORTS, EVENT_LIST } from "./reports.js";

export async function createApp(overrides = {}) {
  const config = loadConfig(overrides),
    db = await createDatabase(config),
    store = db.isFallback ? new session.MemoryStore() : new MySQLSessionStore(db),
    app = express();
  const services = createServices(db, config),
    dummyHash = await hashPassword("not-an-account-passphrase");
  app.locals.db = db;
  app.locals.config = config;
  app.locals.services = services;
  app.locals.store = store;
  app.locals.close = async () => {
    if (typeof store.close === "function") store.close();
    await db.close();
  };
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", fileURLToPath(new URL("../../frontend/views", import.meta.url)));
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
      "Cache-Control": "no-store",
    });
    next();
  });
  app.use(
    "/static",
    express.static(fileURLToPath(new URL("../../frontend/public", import.meta.url))),
  );
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", database_checked: false }),
  );
  app.use(
    express.urlencoded({ extended: false, limit: "128kb", parameterLimit: 50 }),
  );
  app.use(
    session({
      name: "campusflow.sid",
      secret: config.secret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookie,
        maxAge: 2 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(async (req, res, next) => {
    req.user = null;
    res.locals.user = null;
    req.session.messages ||= [];
    res.locals.messages = req.session.messages;
    req.session.messages = [];
    res.locals.csrf = ensureCsrf(req);
    res.locals.config = config;
    Object.assign(res.locals, {
      clock,
      displayDate,
      dateDay,
      dateMonth,
      fixed,
    });
    if (req.session.userId) {
      req.user =
        (
          await db.query(
            "SELECT user_id,name,email,student_id,role FROM users WHERE user_id=?",
            [req.session.userId],
          )
        )[0] || null;
      if (!req.user) delete req.session.userId;
    }
    res.locals.user = req.user;
    next();
  });
  app.use(verifyCsrf);
  const id = (value) => {
    try {
      return integer(value, "Record ID", 1, 4294967295);
    } catch {
      throw new HttpError(404, "Record not found.");
    }
  };
  const notify = (res, error) =>
    res.locals.messages.push({ type: "danger", text: error.message });

  app.get("/", (req, res) => res.redirect(req.user ? "/dashboard" : "/login"));
  app.get("/login", (req, res) =>
    req.user
      ? res.redirect("/dashboard")
      : res.render("login", { identifier: "" }),
  );
  app.post("/login", async (req, res) => {
    if (req.user) return res.redirect("/dashboard");
    const identifier =
      typeof req.body.identifier === "string" ? req.body.identifier.trim() : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    const user = (
      await db.query(
        "SELECT * FROM users WHERE email=? OR student_id=? LIMIT 1",
        [identifier.toLowerCase(), identifier],
      )
    )[0];
    const valid = await verifyPassword(
      user ? user.password_hash : dummyHash,
      password,
    );
    if (user && valid) {
      await regenerate(req);
      req.session.userId = user.user_id;
      req.session.messages = [];
      ensureCsrf(req);
      return res.redirect("/dashboard");
    }
    notify(res, new Error("Incorrect email/student ID or password."));
    res.render("login", { identifier });
  });
  app.post("/logout", loginRequired, async (req, res) => {
    await destroySession(req);
    res.clearCookie("campusflow.sid", { path: "/" });
    res.redirect("/login");
  });
  app.get("/dashboard", loginRequired, async (req, res) => {
    const scalar = async (sql, p = []) => Number((await db.query(sql, p))[0].n);
    const stats = {
      events: await scalar(
        "SELECT COUNT(*) n FROM events WHERE status != 'cancelled'",
      ),
      venues: await scalar("SELECT COUNT(*) n FROM venues"),
    };
    const allEvents = await db.query(
      EVENT_LIST +
        " WHERE e.status != 'cancelled' ORDER BY e.event_date, e.start_time, e.event_id",
    );
    const now = campusNow(config.campusTimezone);
    const upcoming = allEvents.filter(e => `${e.event_date} ${e.start_time}` > now).slice(0, 4);

    const calendarEvents = {};
    for (const e of allEvents) {
      if (!calendarEvents[e.event_date]) calendarEvents[e.event_date] = [];
      calendarEvents[e.event_date].push(e);
    }
    const venues = await db.query("SELECT * FROM venues ORDER BY venue_name");

    res.render("dashboard", { stats, upcoming, allEvents, calendarEvents, venues, today: now.slice(0, 10) });
  });
  app.get("/events", loginRequired, async (req, res) => {
    const events = await db.query(
      EVENT_LIST + " ORDER BY e.event_date,e.start_time,e.event_id",
    );
    const registered = new Set(
      (
        await db.query("SELECT event_id FROM registrations WHERE user_id=?", [
          req.user.user_id,
        ])
      ).map((r) => r.event_id),
    );
    const now = campusNow(config.campusTimezone);
    for (const e of events)
      e.registration_open = `${e.event_date} ${e.start_time}` > now;
    res.render("events", { events, registered });
  });
  async function eventEditor(req, res, eventId = null) {
    let event = eventId
      ? (await db.query("SELECT * FROM events WHERE event_id=?", [eventId]))[0]
      : {
          event_date: req.query.date || "",
          venue_id: req.query.venue_id || "",
          status: "pending_schedule",
        };
    if (!event) throw new HttpError(404, "Event not found.");
    if (req.method === "POST") {
      try {
        await services.saveEvent(req.body, req.user.user_id, eventId);
        flash(req, "success", "Event saved. Venue and capacity checks passed.");
        return res.redirect("/events");
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        notify(res, error);
        event = req.body;
      }
    }
    res.render("event-form", {
      event,
      editing: Boolean(eventId),
      venues: await db.query("SELECT * FROM venues ORDER BY venue_name"),
      today: campusNow(config.campusTimezone).slice(0, 10),
    });
  }
  app.all("/events/new", ...roleRequired("admin"), async (req, res) => {
    if (!["GET", "POST"].includes(req.method))
      throw new HttpError(405, "Method not allowed.");
    await eventEditor(req, res);
  });
  app.all("/events/:id/edit", ...roleRequired("admin"), async (req, res) => {
    if (!["GET", "POST"].includes(req.method))
      throw new HttpError(405, "Method not allowed.");
    await eventEditor(req, res, id(req.params.id));
  });
  app.post("/events/:id/delete", ...roleRequired("admin"), async (req, res) => {
    try {
      await services.deleteEvent(id(req.params.id));
      flash(req, "success", "Event and its registrations deleted.");
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      flash(req, "danger", e.message);
    }
    res.redirect("/events");
  });

  async function venueEditor(req, res, venueId = null) {
    let venue = venueId
      ? (await db.query("SELECT * FROM venues WHERE venue_id=?", [venueId]))[0]
      : {};
    if (!venue) throw new HttpError(404, "Venue not found.");
    if (req.method === "POST") {
      try {
        await services.saveVenue(req.body, venueId);
        flash(
          req,
          "success",
          venueId ? "Venue updated successfully." : "New venue added successfully."
        );
        return res.redirect("/venues");
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        notify(res, error);
        venue = req.body;
      }
    }
    res.render("venue-form", {
      venue,
      editing: Boolean(venueId),
    });
  }

  app.get("/venues", loginRequired, async (req, res) => {
    const venues = await db.query(`
      SELECT v.*, COUNT(e.event_id) AS event_count 
      FROM venues v 
      LEFT JOIN events e ON v.venue_id = e.venue_id AND e.status != 'cancelled'
      GROUP BY v.venue_id, v.venue_name, v.capacity, v.resources
      ORDER BY v.capacity DESC, v.venue_name
    `);
    res.render("venues", { venues });
  });

  app.all("/venues/new", ...roleRequired("admin"), async (req, res) => {
    if (!["GET", "POST"].includes(req.method))
      throw new HttpError(405, "Method not allowed.");
    await venueEditor(req, res);
  });

  app.all("/venues/:id/edit", ...roleRequired("admin"), async (req, res) => {
    if (!["GET", "POST"].includes(req.method))
      throw new HttpError(405, "Method not allowed.");
    await venueEditor(req, res, id(req.params.id));
  });

  app.post("/venues/:id/delete", ...roleRequired("admin"), async (req, res) => {
    try {
      await services.deleteVenue(id(req.params.id));
      flash(req, "success", "Venue removed successfully.");
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      flash(req, "danger", e.message);
    }
    res.redirect("/venues");
  });

  async function simulator(req, res) {
    const venues = await db.query("SELECT * FROM venues ORDER BY venue_name");
    const today = campusNow(config.campusTimezone).slice(0, 10);
    const todayDate = new Date(today + "T00:00:00Z");

    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);

    const dayAfterDate = new Date(todayDate);
    dayAfterDate.setUTCDate(dayAfterDate.getUTCDate() + 2);
    const dayAfterTomorrow = dayAfterDate.toISOString().slice(0, 10);

    const selectedVenueId = req.query.venue_id || req.body?.venue_id || "all";
    const selectedDate = req.query.date || req.body?.event_date || dayAfterTomorrow;

    // Fetch existing events from database for the selected date (across all venues or filtered)
    let query = `
      SELECT e.*, v.venue_name, v.capacity 
      FROM events e 
      LEFT JOIN venues v ON e.venue_id = v.venue_id 
      WHERE e.event_date = ? AND e.status != 'cancelled'
    `;
    const params = [selectedDate];

    if (selectedVenueId && selectedVenueId !== "all") {
      query += " AND e.venue_id = ?";
      params.push(selectedVenueId);
    }
    query += " ORDER BY e.start_time, e.event_id";

    const dayEvents = await db.query(query, params);

    const samples = [
      { title: "Technical Keynote", start_time: "09:00", expected_attendance: 100 },
      { title: "Hands-on Workshop", start_time: "10:00", expected_attendance: 150 },
      { title: "Lightning Project Pitches", start_time: "11:00", expected_attendance: 50 },
    ];

    let source = "";
    if (req.query.reset === "1" || req.body?.load_samples) {
      source = eventsToCsv(samples);
    } else if (req.method === "POST" && req.body.processes && req.body.processes.trim() !== "" && !req.body.load_samples) {
      source = req.body.processes;
    } else if (dayEvents.length > 0) {
      source = eventsToCsv(dayEvents);
    } else {
      source = eventsToCsv(samples);
    }

    const results = [];
    try {
      const tasks = parseProcesses(source);
      for (const algorithm of ["FCFS", "SJF"])
        results.push(schedule(tasks, algorithm));
    } catch (e) {
      if (req.method === "POST") notify(res, e);
    }

    res.render("simulator", {
      source: typeof source === "string" ? source : "",
      results,
      venues,
      selectedVenueId,
      selectedDate,
      minDate: today,
      today,
      tomorrow,
      dayAfterTomorrow,
      dayEvents,
    });
  }

  app.get("/simulator", loginRequired, simulator);
  app.post("/simulator", loginRequired, simulator);

  app.post("/simulator/commit", loginRequired, async (req, res) => {
    try {
      const selectedVenueId = req.body.venue_id;
      const eventDate = typeof req.body.event_date === "string" ? req.body.event_date.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new UserError("Valid event date is required.");

      const algorithm = req.body.algorithm === "SJF" ? "SJF" : "FCFS";
      const rawWorkload = typeof req.body.workload === "string"
        ? req.body.workload.replace(/&#34;|&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        : "";
      const tasks = parseProcesses(rawWorkload);
      const scheduledResult = schedule(tasks, algorithm);

      const defaultVenue = (await db.query("SELECT * FROM venues ORDER BY venue_id LIMIT 1"))[0];
      let targetVenue = null;
      if (selectedVenueId && selectedVenueId !== "all") {
        targetVenue = (await db.query("SELECT * FROM venues WHERE venue_id=?", [selectedVenueId]))[0];
      }

      let savedCount = 0;
      for (const row of scheduledResult.rows) {
        const cleanTitle = row.task_name.replace(/&#34;|&quot;|"/g, "").trim();
        const startHour = 9 + row.start_time;
        const endHour = startHour + row.burst_time;
        if (endHour > 23) throw new UserError(`Scheduled event ${cleanTitle} exceeds operating day hours.`);

        const startTime = `${String(startHour).padStart(2, "0")}:00`;
        const endTime = `${String(endHour).padStart(2, "0")}:00`;

        let existing = null;
        if (targetVenue) {
          existing = (await db.query(
            "SELECT * FROM events WHERE venue_id=? AND event_date=? AND (title=? OR title LIKE ?) AND status != 'cancelled' LIMIT 1",
            [targetVenue.venue_id, eventDate, cleanTitle, `%${cleanTitle}%`]
          ))[0];
        } else {
          existing = (await db.query(
            "SELECT * FROM events WHERE event_date=? AND (title=? OR title LIKE ?) AND status != 'cancelled' LIMIT 1",
            [eventDate, cleanTitle, `%${cleanTitle}%`]
          ))[0];
        }

        const venueIdToUse = existing ? existing.venue_id : (targetVenue ? targetVenue.venue_id : defaultVenue.venue_id);

        if (existing) {
          await db.query(
            "UPDATE events SET title=?, start_time=?, end_time=?, status='scheduled', description=? WHERE event_id=?",
            [
              cleanTitle,
              startTime,
              endTime,
              `Scheduled via OS ${algorithm}. Order #${row.start_time + 1}. Turnaround: ${row.turnaround_time}h, Wait: ${row.waiting_time}h.`,
              existing.event_id,
            ]
          );
        } else {
          await services.saveEvent({
            title: cleanTitle,
            description: `Scheduled via OS ${algorithm}. Order #${row.start_time + 1}. Turnaround: ${row.turnaround_time}h, Wait: ${row.waiting_time}h.`,
            event_date: eventDate,
            start_time: startTime,
            end_time: endTime,
            venue_id: venueIdToUse,
            expected_attendance: row.expected_students || Math.min(300, row.burst_time * 50),
            status: "scheduled",
          }, req.user.user_id);
        }
        savedCount++;
      }

      const scopeText = targetVenue ? `at ${targetVenue.venue_name}` : `across all venues`;
      flash(req, "success", `OS ${algorithm} successfully scheduled ${savedCount} event(s) ${scopeText} on ${eventDate} and saved them to MySQL.`);
      res.redirect("/events");
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      flash(req, "danger", e.message);
      res.redirect("/simulator");
    }
  });

  app.get("/reports", loginRequired, async (req, res) => {
    const selected = req.query.query || "events_and_venues";
    if (typeof selected !== "string" || !Object.hasOwn(REPORTS, selected))
      throw new HttpError(400, "Unknown query. Choose a listed DBMS query.");
    const report = REPORTS[selected];
    const rows = await db.query(report.sql);
    res.render("reports", {
      reports: REPORTS,
      selected,
      report,
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
    });
  });
  app.use((_req, _res, next) => next(new HttpError(404, "Page not found.")));
  app.use((error, req, res, _next) => {
    if (res.headersSent) return _next(error);
    const status =
      error.status ||
      (error.code?.startsWith("ER_") || error.code === "ECONNREFUSED"
        ? 503
        : 500);
    if (status >= 500)
      console.error("Request failed:", error.code || error.name);
    if (!res.locals.config)
      Object.assign(res.locals, {
        user: null,
        messages: [],
        csrf: "",
        config,
        clock,
        displayDate,
        dateDay,
        dateMonth,
        fixed,
      });
    res
      .status(status)
      .render("error", {
        code: status,
        message:
          status >= 500
            ? "Database unavailable or operation failed. Check MySQL and the application configuration."
            : error.message,
      });
  });
  return app;
}
