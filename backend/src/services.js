import { execute } from "./db.js";
import { campusNow } from "./format.js";
import {
  NON_PREEMPTIVE_ALGORITHMS,
  parseProcesses,
  schedule,
} from "./scheduler.js";
import {
  evaluateVenueMatches,
  parseResourceTags,
} from "./venue-matcher.js";
export class UserError extends Error {}
export function integer(value, label, minimum = 1, maximum = 1_000_000) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^[0-9]+$/.test(String(value))
  )
    throw new UserError(`${label} must be a whole number.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum || n > maximum)
    throw new UserError(`${label} must be between ${minimum} and ${maximum}.`);
  return n;
}
export function text(value, label, maximum) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    throw new UserError(
      `${label} is required and must be at most ${maximum} characters.`,
    );
  return value.trim();
}
export function eventFields(form, timezone) {
  const day = form.event_date,
    start = form.start_time,
    end = form.end_time;
  if (
    typeof day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number(day.slice(0, 4)) < 1000 ||
    Number.isNaN(new Date(day + "T00:00:00Z").getTime()) ||
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day ||
    typeof start !== "string" ||
    typeof end !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)
  )
    throw new UserError("Enter a valid date and start/end times.");
  if (`${day} ${start}:00` <= campusNow(timezone))
    throw new UserError("Choose an event start in the future (campus time).");
  if (end <= start)
    throw new UserError(
      "End time must be later than start time; overnight events are not supported.",
    );
  const status = form.status || "scheduled";
  if (!["scheduled", "cancelled", "pending_schedule"].includes(status))
    throw new UserError("Invalid event status.");
  return {
    title: text(form.title, "Title", 150),
    description: text(form.description, "Description", 5000),
    event_date: day,
    start_time: start,
    end_time: end,
    expected_attendance: integer(form.expected_attendance, "Attendance"),
    venue_id: integer(form.venue_id, "Venue ID"),
    status,
  };
}
export function createServices(db, config) {
  async function saveEvent(form, userId, eventId = null) {
    const data = eventFields(form, config.campusTimezone);
    const old = eventId
      ? (
          await db.query("SELECT venue_id FROM events WHERE event_id=?", [
            eventId,
          ])
        )[0]
      : null;
    if (eventId && !old) throw new UserError("Event no longer exists.");
    const locks = [
      ...new Set([data.venue_id, ...(old ? [old.venue_id] : [])]),
    ].sort((a, b) => a - b);
    return db.transaction(async (conn) => {
      const venues = new Map();
      for (const id of locks) {
        const rows = await execute(
          conn,
          "SELECT venue_id,capacity FROM venues WHERE venue_id=? FOR UPDATE",
          [id],
        );
        if (rows[0]) venues.set(id, rows[0]);
      }
      const venue = venues.get(data.venue_id);
      if (!venue) throw new UserError("Selected venue does not exist.");
      if (data.expected_attendance > venue.capacity)
        throw new UserError("Expected attendance exceeds venue capacity.");
      if (eventId) {
        const current = (
          await execute(
            conn,
            "SELECT * FROM events WHERE event_id=? FOR UPDATE",
            [eventId],
          )
        )[0];
        if (!current || current.venue_id !== old.venue_id)
          throw new UserError(
            "Event changed concurrently. Reload before editing.",
          );
        const count = Number(
          (
            await execute(
              conn,
              "SELECT COUNT(*) n FROM registrations WHERE event_id=? AND status='confirmed'",
              [eventId],
            )
          )[0].n,
        );
        if (count > data.expected_attendance)
          throw new UserError(
            "Attendance limit cannot be below the current registration count.",
          );
      }
      if (data.status === "scheduled") {
        const conflicts = await execute(
          conn,
          `SELECT event_id FROM events WHERE venue_id=? AND event_date=? AND status='scheduled'
          AND start_time < ? AND end_time > ? AND event_id <> ? LIMIT 1`,
          [
            data.venue_id,
            data.event_date,
            data.end_time,
            data.start_time,
            eventId || 0,
          ],
        );
        if (conflicts.length)
          throw new UserError(
            "Venue conflict: another event overlaps this time slot. Choose 'Pending Scheduling' to let the OS Scheduler sequence non-conflicting slots.",
          );
      }
      const values = [
        "title",
        "description",
        "event_date",
        "start_time",
        "end_time",
        "expected_attendance",
        "venue_id",
        "status",
      ].map((k) => data[k]);
      if (eventId) {
        await execute(
          conn,
          "UPDATE events SET title=?,description=?,event_date=?,start_time=?,end_time=?,expected_attendance=?,venue_id=?,status=? WHERE event_id=?",
          [...values, eventId],
        );
        if (data.status === "scheduled") {
          const confirmed = Number(
            (
              await execute(
                conn,
                "SELECT COUNT(*) n FROM registrations WHERE event_id=? AND status='confirmed'",
                [eventId],
              )
            )[0].n,
          );
          const spare = data.expected_attendance - confirmed;
          if (spare > 0) {
            const waitlisted = await execute(
              conn,
              "SELECT registration_id FROM registrations WHERE event_id=? AND status='waitlisted' ORDER BY registration_id ASC LIMIT ?",
              [eventId, spare],
            );
            for (const w of waitlisted) {
              await execute(
                conn,
                "UPDATE registrations SET status='confirmed' WHERE registration_id=?",
                [w.registration_id],
              );
            }
          }
        }
        return eventId;
      }
      const result = await execute(
        conn,
        "INSERT INTO events (title,description,event_date,start_time,end_time,expected_attendance,venue_id,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
        [...values, userId],
      );
      return result.insertId;
    });
  }
  async function deleteEvent(eventId) {
    await db.transaction(async (conn) => {
      if (
        !(
          await execute(
            conn,
            "SELECT event_id FROM events WHERE event_id=? FOR UPDATE",
            [eventId],
          )
        ).length
      )
        throw new UserError("Event no longer exists.");
      await execute(conn, "DELETE FROM events WHERE event_id=?", [eventId]);
    });
  }
  async function saveVenue(form, venueId = null) {
    const name = text(form.venue_name, "Venue name", 100),
      capacity = integer(form.capacity, "Capacity"),
      resources = text(form.resources, "Resources", 2000);
    try {
      return await db.transaction(async (conn) => {
        if (venueId) {
          if (
            !(
              await execute(
                conn,
                "SELECT venue_id FROM venues WHERE venue_id=? FOR UPDATE",
                [venueId],
              )
            ).length
          )
            throw new UserError("Venue no longer exists.");
          const largest =
            (
              await execute(
                conn,
                "SELECT MAX(expected_attendance) largest FROM events WHERE venue_id=?",
                [venueId],
              )
            )[0].largest || 0;
          if (capacity < largest)
            throw new UserError(
              "Capacity cannot be below an existing event attendance limit.",
            );
          await execute(
            conn,
            "UPDATE venues SET venue_name=?,capacity=?,resources=? WHERE venue_id=?",
            [name, capacity, resources, venueId],
          );
          return venueId;
        }
        return (
          await execute(
            conn,
            "INSERT INTO venues (venue_name,capacity,resources) VALUES (?,?,?)",
            [name, capacity, resources],
          )
        ).insertId;
      });
    } catch (error) {
      if (error.errno === 1062)
        throw new UserError("A venue with that name already exists.");
      throw error;
    }
  }
  async function deleteVenue(venueId) {
    try {
      await db.transaction(async (conn) => {
        if (
          !(
            await execute(
              conn,
              "SELECT venue_id FROM venues WHERE venue_id=? FOR UPDATE",
              [venueId],
            )
          ).length
        )
          throw new UserError("Venue no longer exists.");
        await execute(conn, "DELETE FROM venues WHERE venue_id=?", [venueId]);
      });
    } catch (error) {
      if (error.errno === 1451)
        throw new UserError("Cannot delete a venue referenced by an event.");
      throw error;
    }
  }
  async function registerStudent(eventId, userId, options = {}) {
    try {
      return await db.transaction(async (conn) => {
        const event = (
          await execute(
            conn,
            "SELECT * FROM events WHERE event_id=? FOR UPDATE",
            [eventId],
          )
        )[0];
        if (!event || event.status !== "scheduled")
          throw new UserError("This event is not available for registration.");
        if (
          `${event.event_date} ${event.start_time}` <=
          campusNow(config.campusTimezone)
        )
          throw new UserError("Registration closes when the event starts.");
        if (
          (
            await execute(
              conn,
              "SELECT registration_id FROM registrations WHERE event_id=? AND user_id=?",
              [eventId, userId],
            )
          ).length
        )
          throw new UserError("You are already registered for this event.");
        const count = Number(
          (
            await execute(
              conn,
              "SELECT COUNT(*) n FROM registrations WHERE event_id=? AND status='confirmed'",
              [eventId],
            )
          )[0].n,
        );
        const isFull = count >= event.expected_attendance;
        if (isFull && !options.allowWaitlist)
          throw new UserError("This event is full.");
        const status = isFull ? "waitlisted" : "confirmed";
        await execute(
          conn,
          "INSERT INTO registrations (user_id,event_id,status) VALUES (?,?,?)",
          [userId, eventId, status],
        );
        return { status };
      });
    } catch (error) {
      if (error.errno === 1062)
        throw new UserError("You are already registered for this event.");
      throw error;
    }
  }
  async function unregisterStudent(eventId, userId) {
    return db.transaction(async (conn) => {
      const event = (
        await execute(
          conn,
          "SELECT event_id, event_date, start_time, status FROM events WHERE event_id=? FOR UPDATE",
          [eventId],
        )
      )[0];
      if (!event) throw new UserError("Event no longer exists.");
      if (
        `${event.event_date} ${event.start_time}` <=
        campusNow(config.campusTimezone)
      )
        throw new UserError("Registration changes close when the event starts.");
      const existing = (
        await execute(
          conn,
          "SELECT registration_id, status FROM registrations WHERE event_id=? AND user_id=?",
          [eventId, userId],
        )
      )[0];
      if (!existing)
        throw new UserError("You are not registered for this event.");
      await execute(
        conn,
        "DELETE FROM registrations WHERE registration_id=?",
        [existing.registration_id],
      );
      let promoted = false;
      if (existing.status === "confirmed" && event.status === "scheduled") {
        const nextWait = (
          await execute(
            conn,
            "SELECT registration_id FROM registrations WHERE event_id=? AND status='waitlisted' ORDER BY registration_id ASC LIMIT 1",
            [eventId],
          )
        )[0];
        if (nextWait) {
          await execute(
            conn,
            "UPDATE registrations SET status='confirmed' WHERE registration_id=?",
            [nextWait.registration_id],
          );
          promoted = true;
        }
      }
      return { promoted };
    });
  }
  async function toggleCheckIn(eventId, registrationId) {
    return db.transaction(async (conn) => {
      const row = (
        await execute(
          conn,
          "SELECT registration_id, status, checked_in FROM registrations WHERE registration_id=? AND event_id=? FOR UPDATE",
          [registrationId, eventId],
        )
      )[0];
      if (!row) throw new UserError("Registration record not found.");
      if (row.status !== "confirmed")
        throw new UserError("Only confirmed attendees can be checked in.");
      const nextState = row.checked_in ? 0 : 1;
      const stamped = nextState
        ? new Date().toISOString().slice(0, 19).replace("T", " ")
        : null;
      await execute(
        conn,
        "UPDATE registrations SET checked_in=?, checked_in_at=? WHERE registration_id=?",
        [nextState, stamped, registrationId],
      );
      return { checkedIn: Boolean(nextState) };
    });
  }
  async function commitScheduledEvents({
    workload,
    algorithm,
    venueId,
    eventDate,
    userId,
  }) {
    if (
      typeof eventDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      Number.isNaN(new Date(eventDate + "T00:00:00Z").getTime()) ||
      new Date(eventDate + "T00:00:00Z").toISOString().slice(0, 10) !== eventDate
    ) {
      throw new UserError("Valid event date is required.");
    }
    const today = campusNow(config.campusTimezone).slice(0, 10);
    if (eventDate < today) {
      throw new UserError("Choose today or a future date to commit a schedule.");
    }
    if (!NON_PREEMPTIVE_ALGORITHMS.includes(algorithm)) {
      throw new UserError(
        `Only non-preemptive algorithms (${NON_PREEMPTIVE_ALGORITHMS.join(", ")}) can be committed to physical venue slots.`,
      );
    }
    const chosenAlg = algorithm;
    let tasks, scheduledResult;
    try {
      tasks = parseProcesses(workload);
      scheduledResult = schedule(tasks, chosenAlg);
    } catch (error) {
      throw new UserError(error.message);
    }

    const parsedVenueId =
      venueId && venueId !== "all" ? integer(venueId, "Venue ID") : null;

    return db.transaction(async (conn) => {
      const allVenues = await execute(
        conn,
        "SELECT venue_id, venue_name, capacity FROM venues ORDER BY venue_id FOR UPDATE",
      );
      if (!allVenues.length) throw new UserError("No venues exist in database.");
      const venueMap = new Map(allVenues.map((v) => [v.venue_id, v]));
      const targetVenue = parsedVenueId ? venueMap.get(parsedVenueId) : null;
      if (parsedVenueId && !targetVenue)
        throw new UserError("Selected venue does not exist.");
      const defaultVenue = allVenues[0];

      const existingQuery = targetVenue
        ? "SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.event_id) AS reg_count FROM events e WHERE e.venue_id=? AND e.event_date=? AND e.status != 'cancelled' ORDER BY e.event_id FOR UPDATE"
        : "SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.event_id) AS reg_count FROM events e WHERE e.event_date=? AND e.status != 'cancelled' ORDER BY e.event_id FOR UPDATE";
      const existingEvents = await execute(
        conn,
        existingQuery,
        targetVenue ? [targetVenue.venue_id, eventDate] : [eventDate],
      );

      const usedIds = new Set();
      const plans = [];

      for (const row of scheduledResult.rows) {
        const cleanTitle = text(row.task_name, "Title", 150);
        const startHour = 9 + row.start_time;
        const endHour = 9 + row.finish_time;
        if (startHour < 0 || endHour > 23 || endHour <= startHour) {
          throw new UserError(
            `Scheduled event "${cleanTitle}" (${startHour}:00–${endHour}:00) exceeds operating hours (09:00–23:00).`,
          );
        }
        const startTime = `${String(startHour).padStart(2, "0")}:00`;
        const endTime = `${String(endHour).padStart(2, "0")}:00`;

        const existing = existingEvents.find(
          (ev) =>
            !usedIds.has(ev.event_id) &&
            ev.title.trim().toLowerCase() === cleanTitle.toLowerCase(),
        );
        if (existing) usedIds.add(existing.event_id);

        const venue = existing
          ? venueMap.get(existing.venue_id)
          : targetVenue || defaultVenue;
        const expectedAttendance = existing
          ? existing.expected_attendance
          : row.expected_students ||
            Math.min(venue.capacity, row.burst_time * 50);

        if (expectedAttendance > venue.capacity) {
          throw new UserError(
            `Expected attendance (${expectedAttendance}) for "${cleanTitle}" exceeds ${venue.venue_name} capacity (${venue.capacity}).`,
          );
        }
        if (existing && Number(existing.reg_count || 0) > expectedAttendance) {
          throw new UserError(
            `Attendance limit for "${cleanTitle}" cannot be below current registrations.`,
          );
        }

        plans.push({
          existing,
          venue,
          title: cleanTitle,
          startTime,
          endTime,
          expectedAttendance,
          description: `Scheduled via OS ${chosenAlg}. Slot ${startTime}–${endTime} (WT: ${row.waiting_time}h, TAT: ${row.turnaround_time}h).`,
        });
      }

      // Verify committed slots neither overlap each other on the same venue nor collide with untouched scheduled events.
      const untouchedScheduled = existingEvents.filter(
        (ev) => !usedIds.has(ev.event_id) && ev.status === "scheduled",
      );
      const intervalsByVenue = new Map();
      for (const ev of untouchedScheduled) {
        const list = intervalsByVenue.get(ev.venue_id) || [];
        list.push({
          title: ev.title,
          start: String(ev.start_time).slice(0, 5),
          end: String(ev.end_time).slice(0, 5),
        });
        intervalsByVenue.set(ev.venue_id, list);
      }
      for (const p of plans) {
        const list = intervalsByVenue.get(p.venue.venue_id) || [];
        const clash = list.find(
          (slot) => slot.start < p.endTime && slot.end > p.startTime,
        );
        if (clash) {
          throw new UserError(
            `Venue conflict at ${p.venue.venue_name} on ${eventDate}: "${p.title}" (${p.startTime}–${p.endTime}) overlaps "${clash.title}" (${clash.start}–${clash.end}).`,
          );
        }
        list.push({ title: p.title, start: p.startTime, end: p.endTime });
        intervalsByVenue.set(p.venue.venue_id, list);
      }

      for (const p of plans) {
        if (p.existing) {
          await execute(
            conn,
            "UPDATE events SET title=?, start_time=?, end_time=?, status='scheduled', description=? WHERE event_id=?",
            [p.title, p.startTime, p.endTime, p.description, p.existing.event_id],
          );
        } else {
          await execute(
            conn,
            "INSERT INTO events (title,description,event_date,start_time,end_time,expected_attendance,venue_id,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
            [
              p.title,
              p.description,
              eventDate,
              p.startTime,
              p.endTime,
              p.expectedAttendance,
              p.venue.venue_id,
              "scheduled",
              userId,
            ],
          );
        }
      }

      return {
        savedCount: plans.length,
        algorithm: chosenAlg,
        scopeText: targetVenue ? `at ${targetVenue.venue_name}` : "across all venues",
        eventDate,
      };
    });
  }
  function queueRequestFields(form) {
    const rawPreferred =
      typeof form.preferred_venue_id === "string"
        ? form.preferred_venue_id.trim()
        : form.preferred_venue_id;
    const preferredVenueId =
      rawPreferred && rawPreferred !== "any"
        ? integer(rawPreferred, "Preferred venue")
        : null;
    const eventCategory = form.event_category || "workshop";
    if (
      !["lecture", "workshop", "seminar", "competition", "cultural"].includes(
        eventCategory,
      )
    ) {
      throw new UserError("Invalid event category.");
    }
    const priorityLevel = form.priority_level || "normal";
    if (!["normal", "high", "urgent"].includes(priorityLevel)) {
      throw new UserError("Invalid priority level.");
    }
    const rawSetup =
      form.setup_minutes === undefined || String(form.setup_minutes).trim() === ""
        ? 15
        : form.setup_minutes;
    const setupMinutes = integer(rawSetup, "Setup buffer (minutes)", 0, 180);
    const resourceTags = [
      ...parseResourceTags(form.required_resources),
      ...parseResourceTags(form.custom_resources),
    ];
    const requiredResources = resourceTags.length
      ? [...new Set(resourceTags)].join(", ").slice(0, 1000)
      : "Standard seating";
    const facultyNotes =
      typeof form.faculty_notes === "string" && form.faculty_notes.trim()
        ? form.faculty_notes.trim().slice(0, 1000)
        : null;
    return {
      preferredVenueId,
      eventCategory,
      priorityLevel,
      setupMinutes,
      requiredResources,
      accessibilityNeeded: form.accessibility_needed ? 1 : 0,
      avSupportNeeded: form.av_support_needed ? 1 : 0,
      facultyNotes,
    };
  }

  async function submitFacultyEventAndQueue(form, facultyId) {
    const q = queueRequestFields(form);
    return db.transaction(async (conn) => {
      const venues = await execute(
        conn,
        "SELECT venue_id, venue_name, capacity FROM venues ORDER BY capacity ASC, venue_id ASC FOR UPDATE",
      );
      if (!venues.length)
        throw new UserError("No campus venues are configured yet.");

      const attendance = integer(form.expected_attendance, "Expected attendance");
      let placeholderVenue = null;
      if (q.preferredVenueId) {
        placeholderVenue = venues.find((v) => v.venue_id === q.preferredVenueId);
        if (!placeholderVenue)
          throw new UserError("Selected preferred venue does not exist.");
        if (attendance > placeholderVenue.capacity) {
          throw new UserError(
            `Expected attendance (${attendance}) exceeds ${placeholderVenue.venue_name} capacity (${placeholderVenue.capacity} seats). Choose another preferred hall or select "No preference".`,
          );
        }
      } else {
        placeholderVenue = venues.find((v) => v.capacity >= attendance);
        if (!placeholderVenue) {
          const maxCap = venues[venues.length - 1].capacity;
          throw new UserError(
            `Expected attendance (${attendance}) exceeds the largest campus hall capacity (${maxCap} seats).`,
          );
        }
      }

      const data = eventFields(
        {
          ...form,
          venue_id: String(placeholderVenue.venue_id),
          status: "pending_schedule",
        },
        config.campusTimezone,
      );

      const evRes = await execute(
        conn,
        "INSERT INTO events (title,description,event_date,start_time,end_time,expected_attendance,venue_id,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          data.title,
          data.description,
          data.event_date,
          data.start_time,
          data.end_time,
          data.expected_attendance,
          placeholderVenue.venue_id,
          "pending_schedule",
          facultyId,
        ],
      );
      const eventId = evRes.insertId;
      const vrRes = await execute(
        conn,
        `INSERT INTO venue_requests
          (event_id, faculty_id, preferred_venue_id, event_size, required_resources, event_category, priority_level, accessibility_needed, av_support_needed, setup_minutes, faculty_notes, queue_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued')`,
        [
          eventId,
          facultyId,
          q.preferredVenueId,
          data.expected_attendance,
          q.requiredResources,
          q.eventCategory,
          q.priorityLevel,
          q.accessibilityNeeded,
          q.avSupportNeeded,
          q.setupMinutes,
          q.facultyNotes,
        ],
      );
      return { eventId, requestId: vrRes.insertId };
    });
  }

  async function enqueueEventForVenue(eventId, form, facultyId) {
    const q = queueRequestFields(form);
    return db.transaction(async (conn) => {
      const ev = (
        await execute(
          conn,
          "SELECT * FROM events WHERE event_id=? FOR UPDATE",
          [eventId],
        )
      )[0];
      if (!ev) throw new UserError("Event no longer exists.");
      if (Number(ev.created_by) !== Number(facultyId)) {
        throw new UserError("You can only manage venue queue requests for your own events.");
      }
      if (ev.status !== "pending_schedule") {
        throw new UserError(
          "Only events awaiting venue assignment can enter the queue.",
        );
      }
      if (`${ev.event_date} ${ev.start_time}:00` <= campusNow(config.campusTimezone)) {
        throw new UserError("Cannot queue an event whose start time has already passed.");
      }

      const venues = await execute(
        conn,
        "SELECT venue_id, venue_name, capacity FROM venues ORDER BY capacity ASC FOR UPDATE",
      );
      if (q.preferredVenueId) {
        const pref = venues.find((v) => v.venue_id === q.preferredVenueId);
        if (!pref) throw new UserError("Selected preferred venue does not exist.");
        if (ev.expected_attendance > pref.capacity) {
          throw new UserError(
            `Event size (${ev.expected_attendance}) exceeds ${pref.venue_name} capacity (${pref.capacity}).`,
          );
        }
      }

      const existingReq = (
        await execute(
          conn,
          "SELECT request_id, queue_status FROM venue_requests WHERE event_id=? FOR UPDATE",
          [eventId],
        )
      )[0];
      if (existingReq) {
        if (existingReq.queue_status === "assigned") {
          throw new UserError("This event already has an assigned venue.");
        }
        await execute(
          conn,
          `UPDATE venue_requests
           SET preferred_venue_id=?, assigned_venue_id=NULL, event_size=?, required_resources=?, event_category=?, priority_level=?,
               accessibility_needed=?, av_support_needed=?, setup_minutes=?, faculty_notes=?, queue_status='queued',
               admin_notes=NULL, reviewed_by=NULL, reviewed_at=NULL
           WHERE request_id=?`,
          [
            q.preferredVenueId,
            ev.expected_attendance,
            q.requiredResources,
            q.eventCategory,
            q.priorityLevel,
            q.accessibilityNeeded,
            q.avSupportNeeded,
            q.setupMinutes,
            q.facultyNotes,
            existingReq.request_id,
          ],
        );
        return existingReq.request_id;
      }

      const ins = await execute(
        conn,
        `INSERT INTO venue_requests
          (event_id, faculty_id, preferred_venue_id, event_size, required_resources, event_category, priority_level, accessibility_needed, av_support_needed, setup_minutes, faculty_notes, queue_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued')`,
        [
          eventId,
          facultyId,
          q.preferredVenueId,
          ev.expected_attendance,
          q.requiredResources,
          q.eventCategory,
          q.priorityLevel,
          q.accessibilityNeeded,
          q.avSupportNeeded,
          q.setupMinutes,
          q.facultyNotes,
        ],
      );
      return ins.insertId;
    });
  }

  async function withdrawVenueRequest(requestId, facultyId) {
    return db.transaction(async (conn) => {
      const reqRow = (
        await execute(
          conn,
          "SELECT request_id, faculty_id, queue_status FROM venue_requests WHERE request_id=? FOR UPDATE",
          [requestId],
        )
      )[0];
      if (!reqRow) throw new UserError("Queue request no longer exists.");
      if (Number(reqRow.faculty_id) !== Number(facultyId)) {
        throw new UserError("You can only withdraw your own queue requests.");
      }
      if (reqRow.queue_status !== "queued") {
        throw new UserError("Only pending queued requests can be withdrawn.");
      }
      await execute(conn, "DELETE FROM venue_requests WHERE request_id=?", [
        requestId,
      ]);
    });
  }

  async function assignVenueToRequest(requestId, form, adminId) {
    const venueId = integer(form.venue_id, "Assigned venue");
    const enforceBuffer = Boolean(form.enforce_buffer);
    const adminNotes =
      typeof form.admin_notes === "string" && form.admin_notes.trim()
        ? form.admin_notes.trim().slice(0, 1000)
        : null;

    return db.transaction(async (conn) => {
      const reqRow = (
        await execute(
          conn,
          "SELECT * FROM venue_requests WHERE request_id=? FOR UPDATE",
          [requestId],
        )
      )[0];
      if (!reqRow) throw new UserError("Venue request no longer exists.");
      if (reqRow.queue_status !== "queued") {
        throw new UserError("This venue request is no longer in the active queue.");
      }

      const ev = (
        await execute(
          conn,
          "SELECT * FROM events WHERE event_id=? FOR UPDATE",
          [reqRow.event_id],
        )
      )[0];
      if (!ev || ev.status === "cancelled") {
        throw new UserError("Associated event is cancelled or missing.");
      }

      const venue = (
        await execute(
          conn,
          "SELECT * FROM venues WHERE venue_id=? FOR UPDATE",
          [venueId],
        )
      )[0];
      if (!venue) throw new UserError("Selected venue does not exist.");
      if (Number(venue.capacity) < Number(ev.expected_attendance)) {
        throw new UserError(
          `${venue.venue_name} capacity (${venue.capacity}) is smaller than the event size (${ev.expected_attendance}).`,
        );
      }

      const sameDayScheduled = await execute(
        conn,
        `SELECT event_id, venue_id, title, event_date, start_time, end_time, status
         FROM events
         WHERE venue_id=? AND event_date=? AND status='scheduled' AND event_id <> ?
         FOR UPDATE`,
        [venueId, ev.event_date, ev.event_id],
      );

      const assessment = evaluateVenueMatches(
        { ...reqRow, ...ev },
        [venue],
        sameDayScheduled,
        { enforceBuffer },
      ).candidates[0];

      if (!assessment.available) {
        const clash = assessment.conflicts[0];
        throw new UserError(
          `Venue unavailable: ${venue.venue_name} already hosts "${clash.title}" (${clash.start_time}–${clash.end_time}) on ${ev.event_date}.`,
        );
      }
      if (enforceBuffer && !assessment.bufferClear) {
        throw new UserError(
          `Turnover buffer check failed at ${venue.venue_name}: only ${assessment.minGapMinutes} min gap (${reqRow.setup_minutes} min requested).`,
        );
      }

      const confirmed = Number(
        (
          await execute(
            conn,
            "SELECT COUNT(*) n FROM registrations WHERE event_id=? AND status='confirmed'",
            [ev.event_id],
          )
        )[0].n,
      );
      if (confirmed > Number(ev.expected_attendance)) {
        throw new UserError("Confirmed registrations exceed expected attendance limit.");
      }

      const stamped = new Date().toISOString().slice(0, 19).replace("T", " ");
      await execute(
        conn,
        "UPDATE events SET venue_id=?, status='scheduled' WHERE event_id=?",
        [venueId, ev.event_id],
      );
      await execute(
        conn,
        `UPDATE venue_requests
         SET assigned_venue_id=?, queue_status='assigned', admin_notes=?, reviewed_by=?, reviewed_at=?
         WHERE request_id=?`,
        [venueId, adminNotes, adminId, stamped, requestId],
      );

      return {
        eventId: ev.event_id,
        eventTitle: ev.title,
        venueName: venue.venue_name,
      };
    });
  }

  async function declineVenueRequest(requestId, rawReason, adminId) {
    const reason = text(rawReason, "Feedback / reason", 1000);
    return db.transaction(async (conn) => {
      const reqRow = (
        await execute(
          conn,
          "SELECT request_id, event_id, queue_status FROM venue_requests WHERE request_id=? FOR UPDATE",
          [requestId],
        )
      )[0];
      if (!reqRow) throw new UserError("Venue request no longer exists.");
      if (reqRow.queue_status !== "queued") {
        throw new UserError("Only active queued requests can be returned for revision.");
      }
      const stamped = new Date().toISOString().slice(0, 19).replace("T", " ");
      await execute(
        conn,
        `UPDATE venue_requests
         SET queue_status='declined', admin_notes=?, reviewed_by=?, reviewed_at=?
         WHERE request_id=?`,
        [reason, adminId, stamped, requestId],
      );
      await execute(
        conn,
        "UPDATE events SET status='pending_schedule' WHERE event_id=? AND status != 'cancelled'",
        [reqRow.event_id],
      );
    });
  }

  return {
    saveEvent,
    deleteEvent,
    saveVenue,
    deleteVenue,
    registerStudent,
    unregisterStudent,
    toggleCheckIn,
    commitScheduledEvents,
    submitFacultyEventAndQueue,
    enqueueEventForVenue,
    withdrawVenueRequest,
    assignVenueToRequest,
    declineVenueRequest,
  };
}
