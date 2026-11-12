export const REPORTS = {
  events_and_venues: {
    title: "Events with Venue Details · INNER JOIN / ORDER BY",
    sql: `SELECT e.event_id, e.title, v.venue_name, v.capacity, e.event_date, e.start_time, e.end_time, e.status
FROM events e INNER JOIN venues v ON e.venue_id = v.venue_id
ORDER BY e.event_date, e.start_time`,
  },
  event_counts: {
    title: "Event Registrations & Waitlist · LEFT JOIN / GROUP BY / COUNT",
    sql: `SELECT e.event_id, e.title, v.venue_name, e.event_date, e.expected_attendance,
  COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS confirmed_registrations,
  COUNT(CASE WHEN r.status = 'waitlisted' THEN 1 END) AS waitlisted_students,
  COUNT(CASE WHEN r.checked_in = 1 THEN 1 END) AS checked_in_count
FROM events e
INNER JOIN venues v ON e.venue_id = v.venue_id
LEFT JOIN registrations r ON e.event_id = r.event_id
GROUP BY e.event_id, e.title, v.venue_name, e.event_date, e.expected_attendance
ORDER BY e.event_date, e.event_id`,
  },
  student_roster: {
    title: "Registered Student Roster · INNER JOIN registrations",
    sql: `SELECT e.title AS event_title, e.event_date, u.name AS student_name, u.student_id, u.email, r.status, r.checked_in, r.registration_date
FROM registrations r
INNER JOIN users u ON r.user_id = u.user_id
INNER JOIN events e ON r.event_id = e.event_id
ORDER BY e.event_date, e.title, r.status, u.name`,
  },
  available_events: {
    title: "Available Event Capacity · Aggregate Seat Balance",
    sql: `SELECT e.event_id, e.title, v.venue_name, e.event_date, e.expected_attendance,
  COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS registered_count,
  (e.expected_attendance - COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END)) AS available_seats
FROM events e
INNER JOIN venues v ON e.venue_id = v.venue_id
LEFT JOIN registrations r ON e.event_id = r.event_id
WHERE e.status = 'scheduled'
GROUP BY e.event_id, e.title, v.venue_name, e.event_date, e.expected_attendance
ORDER BY e.event_date, e.event_id`,
  },
  venue_utilization: {
    title: "Venue Capacity & Utilization · Multi-Table Aggregation",
    sql: `SELECT v.venue_id, v.venue_name, v.capacity,
  COUNT(DISTINCT CASE WHEN e.status = 'scheduled' THEN e.event_id END) AS scheduled_events,
  COALESCE(SUM(CASE WHEN e.status = 'scheduled' THEN e.expected_attendance ELSE 0 END), 0) AS allocated_seats,
  COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS total_confirmed_attendees
FROM venues v
LEFT JOIN events e ON v.venue_id = e.venue_id
LEFT JOIN registrations r ON e.event_id = r.event_id
GROUP BY v.venue_id, v.venue_name, v.capacity
ORDER BY scheduled_events DESC, v.capacity DESC`,
  },
  venue_requests_queue: {
    title: "Faculty Venue Allocation Queue · Multi-Table JOIN",
    sql: `SELECT vr.request_id, e.title AS event_title, u.name AS faculty_name, vr.event_size, vr.priority_level, vr.event_category, vr.queue_status,
  pv.venue_name AS preferred_venue, av.venue_name AS assigned_venue, e.event_date, e.start_time, e.end_time
FROM venue_requests vr
INNER JOIN events e ON vr.event_id = e.event_id
INNER JOIN users u ON vr.faculty_id = u.user_id
LEFT JOIN venues pv ON vr.preferred_venue_id = pv.venue_id
LEFT JOIN venues av ON vr.assigned_venue_id = av.venue_id
ORDER BY CASE vr.queue_status WHEN 'queued' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END,
  CASE vr.priority_level WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
  vr.request_id ASC`,
  },
  venue_event_counts: {
    title: "Venue Event Distribution · LEFT JOIN / GROUP BY / COUNT",
    sql: `SELECT v.venue_id, v.venue_name, v.capacity, COUNT(e.event_id) AS total_events
FROM venues v LEFT JOIN events e ON v.venue_id = e.venue_id
GROUP BY v.venue_id, v.venue_name, v.capacity
ORDER BY v.venue_id`,
  },
  organizer_events: {
    title: "Event Organizers · INNER JOIN users and events",
    sql: `SELECT e.event_id, e.title, u.name AS organizer_name, u.email, v.venue_name, e.event_date
FROM events e INNER JOIN users u ON e.created_by = u.user_id
INNER JOIN venues v ON e.venue_id = v.venue_id
ORDER BY e.event_date`,
  },
  run_comparison: {
    title: "Saved OS Scheduling Runs · Algorithm Metrics",
    sql: `SELECT sr.run_id, sr.algorithm, sr.quantum, u.name AS created_by, sr.task_count, sr.average_waiting_time, sr.average_turnaround_time, sr.created_at
FROM scheduling_runs sr
INNER JOIN users u ON sr.created_by = u.user_id
ORDER BY sr.created_at DESC, sr.run_id DESC`,
  },
  system_accounts: {
    title: "User Directory & Roles · SELECT / ORDER BY",
    sql: `SELECT user_id, name, email, student_id, role, created_at
FROM users
ORDER BY role, name`,
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
