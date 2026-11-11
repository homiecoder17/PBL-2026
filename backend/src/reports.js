export const REPORTS = {
  events_and_venues: {
    title: "Events with Venue Details · INNER JOIN / ORDER BY",
    sql: `SELECT e.event_id, e.title, v.venue_name, v.capacity, e.event_date, e.start_time, e.end_time, e.status
FROM events e INNER JOIN venues v ON e.venue_id = v.venue_id
ORDER BY e.event_date, e.start_time`,
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
  system_accounts: {
    title: "User Directory & Roles · SELECT / ORDER BY",
    sql: `SELECT user_id, name, email, role, created_at
FROM users
ORDER BY role, name`,
  },
};

export const EVENT_LIST = `SELECT e.*, v.venue_name, v.capacity, u.name AS organizer, 0 AS registration_count
FROM events e INNER JOIN venues v ON e.venue_id = v.venue_id INNER JOIN users u ON e.created_by = u.user_id`;
