export const REPORTS = {
  events_and_venues: {
    title: "1. Events & Assigned Venues (2-Table JOIN)",
    sql: `SELECT e.event_id, e.title, v.venue_name, v.capacity, e.event_date, e.start_time, e.end_time
FROM events e
INNER JOIN venues v ON e.venue_id = v.venue_id
ORDER BY e.event_date, e.start_time`,
  },
  system_accounts: {
    title: "2. User Accounts Directory (SELECT)",
    sql: `SELECT user_id, name, email, student_id, role, created_at
FROM users
ORDER BY role, name`,
  },
  venue_event_counts: {
    title: "3. Events per Venue (GROUP BY & COUNT)",
    sql: `SELECT v.venue_name, v.capacity, COUNT(e.event_id) AS total_events
FROM venues v
LEFT JOIN events e ON v.venue_id = e.venue_id
GROUP BY v.venue_id, v.venue_name, v.capacity
ORDER BY total_events DESC`,
  },
  student_roster: {
    title: "4. Student Event Registrations (3-Table JOIN)",
    sql: `SELECT u.name AS student_name, u.student_id, e.title AS event_title, e.event_date, r.status
FROM registrations r
INNER JOIN users u ON r.user_id = u.user_id
INNER JOIN events e ON r.event_id = e.event_id
ORDER BY e.event_date, u.name`,
  },
  available_events: {
    title: "5. Available Seats per Event (Calculated Column)",
    sql: `SELECT e.event_id, e.title, v.venue_name, e.expected_attendance AS capacity,
  COUNT(r.registration_id) AS registered_students,
  (e.expected_attendance - COUNT(r.registration_id)) AS available_seats
FROM events e
INNER JOIN venues v ON e.venue_id = v.venue_id
LEFT JOIN registrations r ON e.event_id = r.event_id AND r.status = 'confirmed'
WHERE e.status = 'scheduled'
GROUP BY e.event_id, e.title, v.venue_name, e.expected_attendance
ORDER BY e.event_date`,
  },
  venue_requests_queue: {
    title: "6. Faculty Venue Requests (JOIN & Filter)",
    sql: `SELECT vr.request_id, e.title AS event_title, u.name AS faculty_name, vr.event_size, vr.priority_level, vr.queue_status
FROM venue_requests vr
INNER JOIN events e ON vr.event_id = e.event_id
INNER JOIN users u ON vr.faculty_id = u.user_id
ORDER BY vr.request_id ASC`,
  },
  organizer_events: {
    title: "7. Event Organizers (INNER JOIN)",
    sql: `SELECT e.title AS event_title, u.name AS organizer_name, u.role, v.venue_name, e.event_date
FROM events e
INNER JOIN users u ON e.created_by = u.user_id
INNER JOIN venues v ON e.venue_id = v.venue_id
ORDER BY e.event_date`,
  },
  event_counts: {
    title: "8. Total Bookings per Event (COUNT)",
    sql: `SELECT e.title AS event_title, v.venue_name, e.event_date, e.expected_attendance,
  COUNT(r.registration_id) AS total_registrations
FROM events e
INNER JOIN venues v ON e.venue_id = v.venue_id
LEFT JOIN registrations r ON e.event_id = r.event_id
GROUP BY e.event_id, e.title, v.venue_name, e.event_date, e.expected_attendance
ORDER BY e.event_date`,
  },
  venue_utilization: {
    title: "9. Campus Venue Capacity (SUM)",
    sql: `SELECT v.venue_name, v.capacity,
  COUNT(e.event_id) AS scheduled_events,
  COALESCE(SUM(e.expected_attendance), 0) AS total_expected_students
FROM venues v
LEFT JOIN events e ON v.venue_id = e.venue_id AND e.status = 'scheduled'
GROUP BY v.venue_id, v.venue_name, v.capacity
ORDER BY scheduled_events DESC, v.capacity DESC`,
  },
  run_comparison: {
    title: "10. OS Scheduling Runs Log (SELECT)",
    sql: `SELECT sr.run_id, sr.algorithm, sr.task_count, sr.average_waiting_time, sr.average_turnaround_time, sr.created_at
FROM scheduling_runs sr
ORDER BY sr.created_at DESC`,
  },
};

export const EVENT_LIST = `SELECT e.event_id, e.title, e.description, e.event_date, e.start_time, e.end_time,
  e.expected_attendance, e.venue_id, e.created_by, e.status,
  v.venue_name, v.capacity, u.name AS organizer,
  COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS registration_count,
  COUNT(CASE WHEN r.status = 'waitlisted' THEN 1 END) AS waitlist_count
FROM events e
INNER JOIN venues v ON e.venue_id = v.venue_id
INNER JOIN users u ON e.created_by = u.user_id
LEFT JOIN registrations r ON e.event_id = r.event_id`;

export const EVENT_LIST_GROUP_BY = `GROUP BY e.event_id, e.title, e.description, e.event_date, e.start_time, e.end_time,
  e.expected_attendance, e.venue_id, e.created_by, e.status,
  v.venue_name, v.capacity, u.name`;
