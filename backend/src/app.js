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
  ALGORITHMS,
  DEFAULT_QUANTUM,
  MAX_QUANTUM,
  NON_PREEMPTIVE_ALGORITHMS,
  parseProcesses,
  serializeTasks,
  schedule,
  eventsToCsv,
  resultFromRows,
} from "./scheduler.js";
import { signInput, saveSignedRun } from "./scheduling-store.js";
import { REPORTS, EVENT_LIST, EVENT_LIST_GROUP_BY } from "./reports.js";
import { createUser, changePassword } from "./accounts.js";
import {
  RESOURCE_OPTIONS,
  EVENT_CATEGORIES,
  PRIORITY_LEVELS,
  evaluateVenueMatches,
} from "./venue-matcher.js";

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
    res.locals.dbFallback = db.isFallback;
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
    res.locals.queuedVenueRequests =
      req.user && req.user.role === "admin"
        ? Number(
            (
              await db.query(
                "SELECT COUNT(*) n FROM venue_requests WHERE queue_status='queued'",
              )
            )[0].n,
          )
        : 0;
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
  async function activeQueueRankMap() {
    const rows = await db.query(
      `SELECT request_id
       FROM venue_requests
       WHERE queue_status='queued'
       ORDER BY CASE priority_level WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, request_id ASC`,
    );
    return new Map(rows.map((r, i) => [r.request_id, { position: i + 1, total: rows.length }]));
  }

  app.get("/dashboard", loginRequired, async (req, res) => {
    const scalar = async (sql, p = []) => Number((await db.query(sql, p))[0].n);
    const isAdmin = req.user.role === "admin";
    const isFaculty = req.user.role === "faculty";
    const stats = isAdmin
      ? {
          events: await scalar(
            "SELECT COUNT(*) n FROM events WHERE status != 'cancelled'",
          ),
          venues: await scalar("SELECT COUNT(*) n FROM venues"),
          registrations: await scalar("SELECT COUNT(*) n FROM registrations"),
          runs: await scalar("SELECT COUNT(*) n FROM scheduling_runs"),
          queuedRequests: await scalar(
            "SELECT COUNT(*) n FROM venue_requests WHERE queue_status='queued'",
          ),
        }
      : isFaculty
        ? {
            myEvents: await scalar(
              "SELECT COUNT(*) n FROM events WHERE created_by=? AND status != 'cancelled'",
              [req.user.user_id],
            ),
            queuedRequests: await scalar(
              "SELECT COUNT(*) n FROM venue_requests WHERE faculty_id=? AND queue_status='queued'",
              [req.user.user_id],
            ),
            assignedRequests: await scalar(
              "SELECT COUNT(*) n FROM venue_requests WHERE faculty_id=? AND queue_status='assigned'",
              [req.user.user_id],
            ),
            totalAttendees: await scalar(
              `SELECT COUNT(*) n
               FROM registrations r
               INNER JOIN events e ON r.event_id = e.event_id
               WHERE e.created_by=? AND r.status='confirmed'`,
              [req.user.user_id],
            ),
          }
        : {
            events: await scalar(
              "SELECT COUNT(*) n FROM events WHERE status != 'cancelled'",
            ),
            venues: await scalar("SELECT COUNT(*) n FROM venues"),
            registrations: await scalar(
              "SELECT COUNT(*) n FROM registrations WHERE user_id=? AND status='confirmed'",
              [req.user.user_id],
            ),
            waitlisted: await scalar(
              "SELECT COUNT(*) n FROM registrations WHERE user_id=? AND status='waitlisted'",
              [req.user.user_id],
            ),
          };
    const allEvents = await db.query(
      `${EVENT_LIST} WHERE e.status != 'cancelled' ${EVENT_LIST_GROUP_BY} ORDER BY e.event_date, e.start_time, e.event_id`,
    );
    const now = campusNow(config.campusTimezone);
    const upcoming = allEvents.filter(e => `${e.event_date} ${e.start_time}` > now).slice(0, 4);

    const calendarEvents = {};
    for (const e of allEvents) {
      if (!calendarEvents[e.event_date]) calendarEvents[e.event_date] = [];
      calendarEvents[e.event_date].push(e);
    }
    const venues = await db.query("SELECT * FROM venues ORDER BY venue_name");
    const venueUtilization = isAdmin
      ? await db.query(REPORTS.venue_utilization.sql)
      : [];
    const myRegistrations =
      isAdmin || isFaculty
        ? []
        : await db.query(
            `SELECT r.status AS registration_status, e.event_id, e.title, e.event_date, e.start_time, e.end_time, v.venue_name
             FROM registrations r
             INNER JOIN events e ON r.event_id = e.event_id
             INNER JOIN venues v ON e.venue_id = v.venue_id
             WHERE r.user_id = ? AND e.status != 'cancelled'
             ORDER BY e.event_date, e.start_time
             LIMIT 4`,
            [req.user.user_id],
          );
    const myQueueRequests = isFaculty
      ? await db.query(
          `SELECT vr.*, e.title, e.event_date, e.start_time, e.end_time, e.status AS event_status,
            pv.venue_name AS preferred_venue_name, av.venue_name AS assigned_venue_name
           FROM venue_requests vr
           INNER JOIN events e ON vr.event_id = e.event_id
           LEFT JOIN venues pv ON vr.preferred_venue_id = pv.venue_id
           LEFT JOIN venues av ON vr.assigned_venue_id = av.venue_id
           WHERE vr.faculty_id = ?
           ORDER BY CASE vr.queue_status WHEN 'queued' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, vr.request_id DESC
           LIMIT 4`,
          [req.user.user_id],
        )
      : [];
    const queueRanks = isFaculty ? await activeQueueRankMap() : new Map();

    res.render("dashboard", {
      stats,
      upcoming,
      allEvents,
      calendarEvents,
      venues,
      venueUtilization,
      myRegistrations,
      myQueueRequests,
      queueRanks,
      today: now.slice(0, 10),
    });
  });
  app.get("/events", loginRequired, async (req, res) => {
    const events = await db.query(
      `${EVENT_LIST} ${EVENT_LIST_GROUP_BY} ORDER BY e.event_date,e.start_time,e.event_id`,
    );
    const registered = new Map(
      (
        await db.query(
          "SELECT event_id, status FROM registrations WHERE user_id=?",
          [req.user.user_id],
        )
      ).map((r) => [r.event_id, r.status]),
    );
    const now = campusNow(config.campusTimezone);
    for (const e of events)
      e.registration_open = `${e.event_date} ${e.start_time}` > now;
    res.render("events", { events, registered });
  });
  app.post("/events/:id/register", ...roleRequired("student"), async (req, res) => {
    try {
      await services.registerStudent(id(req.params.id), req.user.user_id);
      flash(req, "success", "Registration confirmed.");
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      flash(req, "danger", error.message);
    }
    res.redirect("/events");
  });
  app.post("/events/:id/waitlist", ...roleRequired("student"), async (req, res) => {
    try {
      const outcome = await services.registerStudent(
        id(req.params.id),
        req.user.user_id,
        { allowWaitlist: true },
      );
      flash(
        req,
        "success",
        outcome.status === "waitlisted"
          ? "Added to the event waitlist. You will be promoted automatically if a seat opens."
          : "Registration confirmed.",
      );
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      flash(req, "danger", error.message);
    }
    res.redirect("/events");
  });
  app.post("/events/:id/unregister", ...roleRequired("student"), async (req, res) => {
    try {
      const { promoted } = await services.unregisterStudent(
        id(req.params.id),
        req.user.user_id,
      );
      flash(
        req,
        "success",
        promoted
          ? "Registration cancelled. The next waitlisted student was promoted."
          : "Registration cancelled.",
      );
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      flash(req, "danger", error.message);
    }
    const target = req.body.return_to === "/events" ? "/events" : "/registrations";
    res.redirect(target);
  });
  app.get("/registrations", ...roleRequired("student"), async (req, res) => {
    const registrations = await db.query(
      `SELECT r.registration_id, r.status AS registration_status, r.checked_in, r.checked_in_at, r.registration_date,
        e.*, v.venue_name, v.capacity, u.name AS organizer
       FROM registrations r
       INNER JOIN events e ON r.event_id = e.event_id
       INNER JOIN venues v ON e.venue_id = v.venue_id
       INNER JOIN users u ON e.created_by = u.user_id
       WHERE r.user_id = ?
       ORDER BY e.event_date, e.start_time, r.registration_id`,
      [req.user.user_id],
    );
    const now = campusNow(config.campusTimezone);
    for (const r of registrations)
      r.registration_open = `${r.event_date} ${r.start_time}` > now;
    res.render("registrations", { registrations });
  });
  app.get("/events/:id/attendees", ...roleRequired("admin", "faculty"), async (req, res) => {
    const eventId = id(req.params.id);
    const event = (
      await db.query(
        `${EVENT_LIST} WHERE e.event_id = ? ${EVENT_LIST_GROUP_BY}`,
        [eventId],
      )
    )[0];
    if (!event) throw new HttpError(404, "Event not found.");
    const attendees = await db.query(
      `SELECT r.registration_id, r.status, r.checked_in, r.checked_in_at, r.registration_date,
        u.user_id, u.name, u.email, u.student_id
       FROM registrations r
       INNER JOIN users u ON r.user_id = u.user_id
       WHERE r.event_id = ?
       ORDER BY CASE WHEN r.status='confirmed' THEN 0 ELSE 1 END, r.registration_id ASC`,
      [eventId],
    );
    res.render("event-attendees", { event, attendees });
  });
  app.post(
    "/events/:id/attendees/:regId/checkin",
    ...roleRequired("admin", "faculty"),
    async (req, res) => {
      const eventId = id(req.params.id);
      const regId = id(req.params.regId);
      try {
        const { checkedIn } = await services.toggleCheckIn(eventId, regId);
        flash(
          req,
          "success",
          checkedIn ? "Attendee checked in." : "Check-in status cleared.",
        );
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        flash(req, "danger", error.message);
      }
      res.redirect(`/events/${eventId}/attendees`);
    },
  );
  app.get("/events/:id/attendees.csv", ...roleRequired("admin", "faculty"), async (req, res) => {
    const eventId = id(req.params.id);
    const event = (
      await db.query("SELECT event_id, title FROM events WHERE event_id=?", [
        eventId,
      ])
    )[0];
    if (!event) throw new HttpError(404, "Event not found.");
    const rows = await db.query(
      `SELECT u.name, u.student_id, u.email, r.status, r.checked_in, r.checked_in_at, r.registration_date
       FROM registrations r
       INNER JOIN users u ON r.user_id = u.user_id
       WHERE r.event_id = ?
       ORDER BY CASE WHEN r.status='confirmed' THEN 0 ELSE 1 END, r.registration_id ASC`,
      [eventId],
    );
    const csvCell = (val) => {
      let s = String(val ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const lines = [
      ["Name", "Student ID", "Email", "Status", "Checked In", "Checked In At", "Registered At"].join(","),
      ...rows.map((r) =>
        [
          r.name,
          r.student_id || "",
          r.email,
          r.status,
          r.checked_in ? "Yes" : "No",
          r.checked_in_at || "",
          r.registration_date,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="event-${eventId}-roster.csv"`,
    });
    res.send(lines.join("\r\n") + "\r\n");
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

  app.get("/venues", ...roleRequired("admin"), async (req, res) => {
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

  app.get("/faculty", ...roleRequired("faculty"), async (req, res) => {
    const allEvents = await db.query(
      `${EVENT_LIST} WHERE e.status != 'cancelled' ${EVENT_LIST_GROUP_BY} ORDER BY e.event_date, e.start_time, e.event_id`,
    );
    const myEvents = await db.query(
      `${EVENT_LIST} WHERE e.created_by = ? ${EVENT_LIST_GROUP_BY} ORDER BY e.event_date, e.start_time, e.event_id`,
      [req.user.user_id],
    );
    const myRequests = await db.query(
      `SELECT vr.*, e.title, e.event_date, e.start_time, e.end_time, e.expected_attendance, e.status AS event_status,
        pv.venue_name AS preferred_venue_name, av.venue_name AS assigned_venue_name
       FROM venue_requests vr
       INNER JOIN events e ON vr.event_id = e.event_id
       LEFT JOIN venues pv ON vr.preferred_venue_id = pv.venue_id
       LEFT JOIN venues av ON vr.assigned_venue_id = av.venue_id
       WHERE vr.faculty_id = ?
       ORDER BY CASE vr.queue_status WHEN 'queued' THEN 0 WHEN 'declined' THEN 1 ELSE 2 END, vr.request_id DESC`,
      [req.user.user_id],
    );
    const reqByEventId = new Map(myRequests.map((r) => [r.event_id, r]));
    const unqueuedPendingEvents = myEvents.filter(
      (ev) => ev.status === "pending_schedule" && !reqByEventId.has(ev.event_id),
    );
    const queueRanks = await activeQueueRankMap();
    const venues = await db.query("SELECT * FROM venues ORDER BY capacity ASC, venue_name");

    res.render("faculty-portal", {
      allEvents,
      myEvents,
      myRequests,
      unqueuedPendingEvents,
      queueRanks,
      venues,
      resourceOptions: RESOURCE_OPTIONS,
      eventCategories: EVENT_CATEGORIES,
      priorityLevels: PRIORITY_LEVELS,
      stats: {
        myEventsCount: myEvents.filter((e) => e.status !== "cancelled").length,
        queuedCount: myRequests.filter((r) => r.queue_status === "queued").length,
        assignedCount: myRequests.filter((r) => r.queue_status === "assigned").length,
        totalAttendees: myEvents.reduce(
          (sum, ev) => sum + Number(ev.registration_count || 0),
          0,
        ),
      },
    });
  });

  app.get("/faculty/events/new", ...roleRequired("faculty"), async (req, res) => {
    const venues = await db.query("SELECT * FROM venues ORDER BY capacity ASC, venue_name");
    res.render("faculty-event-form", {
      form: {
        event_date: req.query.date || "",
        setup_minutes: "15",
        event_category: "workshop",
        priority_level: "normal",
        required_resources: ["Projector"],
      },
      venues,
      resourceOptions: RESOURCE_OPTIONS,
      eventCategories: EVENT_CATEGORIES,
      priorityLevels: PRIORITY_LEVELS,
      today: campusNow(config.campusTimezone).slice(0, 10),
    });
  });

  app.post("/faculty/events/new", ...roleRequired("faculty"), async (req, res) => {
    try {
      await services.submitFacultyEventAndQueue(req.body, req.user.user_id);
      flash(
        req,
        "success",
        "Event registered and placed in the campus venue assignment queue.",
      );
      return res.redirect("/faculty");
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      notify(res, error);
      const venues = await db.query("SELECT * FROM venues ORDER BY capacity ASC, venue_name");
      return res.render("faculty-event-form", {
        form: req.body,
        venues,
        resourceOptions: RESOURCE_OPTIONS,
        eventCategories: EVENT_CATEGORIES,
        priorityLevels: PRIORITY_LEVELS,
        today: campusNow(config.campusTimezone).slice(0, 10),
      });
    }
  });

  app.post("/faculty/queue", ...roleRequired("faculty"), async (req, res) => {
    try {
      const eventId = id(req.body.event_id);
      await services.enqueueEventForVenue(eventId, req.body, req.user.user_id);
      flash(req, "success", "Event added to the campus venue queue.");
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      flash(req, "danger", error.message);
    }
    res.redirect("/faculty");
  });

  app.post(
    "/faculty/queue/:id/withdraw",
    ...roleRequired("faculty"),
    async (req, res) => {
      try {
        await services.withdrawVenueRequest(id(req.params.id), req.user.user_id);
        flash(req, "success", "Venue queue request withdrawn.");
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        flash(req, "danger", error.message);
      }
      res.redirect("/faculty");
    },
  );

  app.get("/venues/assign", ...roleRequired("admin"), async (req, res) => {
    const strictResources = req.query.strict_resources === "1";
    const enforceBuffer = req.query.enforce_buffer === "1";
    const rawHeadroom = Number(req.query.min_headroom || 0);
    const minHeadroomPct = [0, 10, 20].includes(rawHeadroom) ? rawHeadroom : 0;

    const queuedRequests = await db.query(
      `SELECT vr.*, e.title, e.description, e.event_date, e.start_time, e.end_time, e.expected_attendance, e.status AS event_status,
        u.name AS faculty_name, u.email AS faculty_email, u.student_id AS faculty_code,
        pv.venue_name AS preferred_venue_name, pv.capacity AS preferred_venue_capacity
       FROM venue_requests vr
       INNER JOIN events e ON vr.event_id = e.event_id
       INNER JOIN users u ON vr.faculty_id = u.user_id
       LEFT JOIN venues pv ON vr.preferred_venue_id = pv.venue_id
       WHERE vr.queue_status = 'queued' AND e.status != 'cancelled'
       ORDER BY CASE vr.priority_level WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, vr.request_id ASC`,
    );

    const recentRequests = await db.query(
      `SELECT vr.*, e.title, e.event_date, e.start_time, e.end_time,
        u.name AS faculty_name, av.venue_name AS assigned_venue_name, rv.name AS reviewer_name
       FROM venue_requests vr
       INNER JOIN events e ON vr.event_id = e.event_id
       INNER JOIN users u ON vr.faculty_id = u.user_id
       LEFT JOIN venues av ON vr.assigned_venue_id = av.venue_id
       LEFT JOIN users rv ON vr.reviewed_by = rv.user_id
       WHERE vr.queue_status IN ('assigned','declined')
       ORDER BY vr.reviewed_at DESC, vr.request_id DESC
       LIMIT 20`,
    );

    const venues = await db.query("SELECT * FROM venues ORDER BY capacity ASC, venue_name");
    const scheduledEvents = await db.query(
      "SELECT event_id, title, venue_id, event_date, start_time, end_time, status FROM events WHERE status='scheduled'",
    );

    const evaluatedQueue = queuedRequests.map((item, idx) => {
      const match = evaluateVenueMatches(item, venues, scheduledEvents, {
        strictResources,
        enforceBuffer,
        minHeadroomPct,
      });
      return {
        ...item,
        queuePosition: idx + 1,
        candidates: match.candidates,
        recommendedVenueId: match.recommendedVenueId,
      };
    });

    res.render("venue-assign", {
      queue: evaluatedQueue,
      recentRequests,
      venues,
      filters: {
        strictResources,
        enforceBuffer,
        minHeadroomPct,
      },
    });
  });

  app.post("/venues/assign/:id", ...roleRequired("admin"), async (req, res) => {
    try {
      const outcome = await services.assignVenueToRequest(
        id(req.params.id),
        req.body,
        req.user.user_id,
      );
      flash(
        req,
        "success",
        `Assigned ${outcome.venueName} to "${outcome.eventTitle}" and opened event registrations.`,
      );
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      flash(req, "danger", error.message);
    }
    res.redirect("/venues/assign");
  });

  app.post(
    "/venues/assign/:id/decline",
    ...roleRequired("admin"),
    async (req, res) => {
      try {
        await services.declineVenueRequest(
          id(req.params.id),
          req.body.admin_notes,
          req.user.user_id,
        );
        flash(req, "success", "Returned request to faculty with review notes.");
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        flash(req, "danger", error.message);
      }
      res.redirect("/venues/assign");
    },
  );

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

    const rawQuantum = req.body?.quantum ?? req.query.quantum;
    let quantum = DEFAULT_QUANTUM;
    if (rawQuantum !== undefined && String(rawQuantum).trim() !== "") {
      try {
        quantum = integer(String(rawQuantum).trim(), "Time quantum", 1, MAX_QUANTUM);
      } catch (e) {
        if (req.method === "POST") notify(res, e);
      }
    }

    const results = [];
    const signedTokens = {};
    try {
      const tasks = parseProcesses(source);
      for (const algorithm of ALGORITHMS) {
        results.push(schedule(tasks, algorithm, { quantum }));
        signedTokens[algorithm] = signInput(
          tasks,
          algorithm,
          req.user.user_id,
          config.secret,
          Date.now(),
          { quantum },
        );
      }
    } catch (e) {
      if (req.method === "POST") notify(res, e);
    }

    const bestAlgorithm = results.length
      ? results.reduce((best, cur) =>
          cur.average_waiting_time < best.average_waiting_time ? cur : best,
        ).algorithm
      : null;

    res.render("simulator", {
      source: typeof source === "string" ? source : "",
      quantum,
      results,
      signedTokens,
      nonPreemptiveAlgs: NON_PREEMPTIVE_ALGORITHMS,
      bestAlgorithm,
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

  app.get("/simulator", ...roleRequired("admin"), simulator);
  app.post("/simulator", ...roleRequired("admin"), simulator);

  app.post("/simulator/save", ...roleRequired("admin"), async (req, res) => {
    try {
      const runId = await saveSignedRun(
        db,
        req.body.input_token,
        req.user.user_id,
        config.secret,
      );
      flash(req, "success", "Saved scheduling run to database.");
      res.redirect(`/runs/${runId}`);
    } catch (e) {
      flash(req, "danger", e.message || "Could not save scheduling run.");
      res.redirect("/simulator");
    }
  });

  app.post("/simulator/commit", ...roleRequired("admin"), async (req, res) => {
    try {
      const rawWorkload =
        typeof req.body.workload === "string"
          ? req.body.workload
              .replace(/&#34;|&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, "&")
          : "";
      const summary = await services.commitScheduledEvents({
        workload: rawWorkload,
        algorithm: req.body.algorithm,
        venueId: req.body.venue_id,
        eventDate:
          typeof req.body.event_date === "string"
            ? req.body.event_date.trim()
            : "",
        userId: req.user.user_id,
      });
      flash(
        req,
        "success",
        `OS ${summary.algorithm} successfully scheduled ${summary.savedCount} event(s) ${summary.scopeText} on ${summary.eventDate} and saved them to database.`,
      );
      res.redirect("/events");
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      flash(req, "danger", e.message);
      res.redirect("/simulator");
    }
  });

  app.get("/runs", ...roleRequired("admin"), async (req, res) => {
    const runs = await db.query(
      "SELECT sr.*, u.name AS owner_name FROM scheduling_runs sr INNER JOIN users u ON sr.created_by = u.user_id ORDER BY sr.created_at DESC, sr.run_id DESC LIMIT 50",
    );
    res.render("runs", { runs });
  });

  app.get("/runs/:id", ...roleRequired("admin"), async (req, res) => {
    const runId = req.params.id;
    if (
      typeof runId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        runId,
      )
    ) {
      throw new HttpError(404, "Scheduling run not found.");
    }
    const run = (
      await db.query(
        "SELECT sr.*, u.name AS owner_name FROM scheduling_runs sr INNER JOIN users u ON sr.created_by = u.user_id WHERE sr.run_id = ?",
        [runId],
      )
    )[0];
    if (!run) throw new HttpError(404, "Scheduling run not found.");
    if (req.user.role !== "admin" && run.created_by !== req.user.user_id) {
      throw new HttpError(403, "This scheduling run belongs to another user.");
    }
    const rows = await db.query(
      "SELECT * FROM scheduling_results WHERE run_id = ? ORDER BY start_time, result_id",
      [runId],
    );
    let timeline = null;
    if (run.timeline_json) {
      try {
        timeline = JSON.parse(run.timeline_json);
      } catch {
        timeline = null;
      }
    }
    const result = resultFromRows(rows, run.algorithm, timeline, {
      quantum: run.quantum,
    });
    res.render("run", { run, result });
  });

  app.get("/reports", ...roleRequired("admin"), async (req, res) => {
    const selected = req.query.query || "events_and_venues";
    if (typeof selected !== "string" || !Object.hasOwn(REPORTS, selected))
      throw new HttpError(400, "Unknown query. Choose a listed DBMS query.");
    const report = REPORTS[selected];
    const rows = await db.query(report.sql);
    const explain = req.query.explain === "1";
    let explainRows = [];
    if (explain) {
      const explainSql = db.isFallback
        ? `EXPLAIN QUERY PLAN ${report.sql}`
        : `EXPLAIN ${report.sql}`;
      explainRows = await db.query(explainSql);
    }
    res.render("reports", {
      reports: REPORTS,
      selected,
      report,
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      explain,
      explainRows,
      explainColumns: explainRows[0] ? Object.keys(explainRows[0]) : [],
    });
  });

  async function listUsers() {
    return db.query(
      `SELECT u.user_id, u.name, u.email, u.student_id, u.role, u.created_at,
        COUNT(DISTINCT r.registration_id) AS registration_count,
        COUNT(DISTINCT sr.run_id) AS run_count
       FROM users u
       LEFT JOIN registrations r ON u.user_id = r.user_id
       LEFT JOIN scheduling_runs sr ON u.user_id = sr.created_by
       GROUP BY u.user_id, u.name, u.email, u.student_id, u.role, u.created_at
       ORDER BY u.role, u.name`,
    );
  }

  app.get("/users", ...roleRequired("admin"), async (req, res) => {
    res.render("users", { users: await listUsers(), form: {} });
  });

  app.post("/users", ...roleRequired("admin"), async (req, res) => {
    try {
      const requestedRole = ["admin", "faculty", "student"].includes(req.body.role)
        ? req.body.role
        : "student";
      await createUser(db, {
        name: req.body.name,
        email: req.body.email,
        role: requestedRole,
        studentId: req.body.student_id || null,
        password: req.body.password,
      });
      flash(req, "success", "Account provisioned with salted scrypt password hash.");
      return res.redirect("/users");
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      notify(res, error);
      return res.render("users", { users: await listUsers(), form: req.body });
    }
  });

  app.get("/account", loginRequired, async (req, res) => {
    res.render("account");
  });

  app.post("/account/password", loginRequired, async (req, res) => {
    try {
      if (req.body.new_password !== req.body.confirm_password) {
        throw new UserError("New password and confirmation do not match.");
      }
      await changePassword(
        db,
        req.user.user_id,
        req.body.current_password,
        req.body.new_password,
      );
      const userId = req.user.user_id;
      await regenerate(req);
      req.session.userId = userId;
      req.session.messages = [];
      ensureCsrf(req);
      flash(req, "success", "Password updated and session rotated.");
      return res.redirect("/account");
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      notify(res, error);
      return res.render("account");
    }
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
        dbFallback: db.isFallback,
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
