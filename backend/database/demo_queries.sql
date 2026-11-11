USE university_event_system;

-- SELECT, WHERE, ORDER BY.
SELECT event_id,title,event_date,start_time FROM events
WHERE status='scheduled' ORDER BY event_date,start_time;

-- INNER JOIN.
SELECT e.title,v.venue_name,u.name AS organizer FROM events e
INNER JOIN venues v ON e.venue_id=v.venue_id
INNER JOIN users u ON e.created_by=u.user_id;

-- LEFT JOIN, GROUP BY, COUNT includes events with zero registrations.
SELECT e.event_id,e.title,COUNT(r.registration_id) AS registrations
FROM events e LEFT JOIN registrations r ON e.event_id=r.event_id
GROUP BY e.event_id,e.title ORDER BY e.event_id;

-- Registration history and related student records.
SELECT u.name,u.student_id,e.title,r.registration_date FROM registrations r
INNER JOIN users u ON r.user_id=u.user_id
INNER JOIN events e ON r.event_id=e.event_id ORDER BY e.title,u.name;

-- Compare distinct scheduling runs, not overwritten results.
SELECT run_id,algorithm,task_count,average_waiting_time,average_turnaround_time,created_at
FROM scheduling_runs ORDER BY created_at DESC;

-- Non-destructive CRUD demonstration: changes below are rolled back.
START TRANSACTION;
INSERT INTO venues (venue_name,capacity,resources)
VALUES (CONCAT('SQL demo ',UUID()),25,'Temporary demonstration');
SET @demo_venue_id=LAST_INSERT_ID();
UPDATE venues SET capacity=30 WHERE venue_id=@demo_venue_id;
SELECT * FROM venues WHERE venue_id=@demo_venue_id;
DELETE FROM venues WHERE venue_id=@demo_venue_id;
ROLLBACK;
