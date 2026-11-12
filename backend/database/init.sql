-- MySQL 8.0.16+ required for enforced CHECK constraints.
CREATE DATABASE IF NOT EXISTS university_event_system CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE university_event_system;

CREATE TABLE IF NOT EXISTS users (
  user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  student_id VARCHAR(32) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student','faculty','admin') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS venues (
  venue_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  venue_name VARCHAR(100) NOT NULL UNIQUE,
  capacity INT NOT NULL,
  resources TEXT NOT NULL,
  CONSTRAINT chk_venue_capacity CHECK (capacity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  event_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  expected_attendance INT NOT NULL,
  venue_id INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  status ENUM('scheduled','pending_schedule','cancelled') NOT NULL DEFAULT 'scheduled',
  CONSTRAINT fk_event_venue FOREIGN KEY (venue_id) REFERENCES venues(venue_id) ON DELETE RESTRICT,
  CONSTRAINT fk_event_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT chk_event_attendance CHECK (expected_attendance > 0),
  CONSTRAINT chk_event_times CHECK (start_time >= '00:00:00' AND end_time < '24:00:00' AND end_time > start_time),
  INDEX idx_venue_calendar (venue_id,event_date,status,start_time,end_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS registrations (
  registration_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  event_id INT UNSIGNED NOT NULL,
  status ENUM('confirmed','waitlisted') NOT NULL DEFAULT 'confirmed',
  checked_in TINYINT(1) NOT NULL DEFAULT 0,
  checked_in_at TIMESTAMP NULL DEFAULT NULL,
  registration_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_student_event UNIQUE (user_id,event_id),
  CONSTRAINT fk_registration_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  INDEX idx_registration_event (event_id),
  INDEX idx_registration_status (event_id,status,registration_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS venue_requests (
  request_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  faculty_id INT UNSIGNED NOT NULL,
  preferred_venue_id INT UNSIGNED NULL,
  assigned_venue_id INT UNSIGNED NULL,
  event_size INT NOT NULL,
  required_resources TEXT NOT NULL,
  event_category ENUM('lecture','workshop','seminar','competition','cultural') NOT NULL DEFAULT 'workshop',
  priority_level ENUM('normal','high','urgent') NOT NULL DEFAULT 'normal',
  accessibility_needed TINYINT(1) NOT NULL DEFAULT 0,
  av_support_needed TINYINT(1) NOT NULL DEFAULT 0,
  setup_minutes INT NOT NULL DEFAULT 15,
  faculty_notes TEXT NULL,
  queue_status ENUM('queued','assigned','declined') NOT NULL DEFAULT 'queued',
  admin_notes TEXT NULL,
  reviewed_by INT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vr_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_vr_faculty FOREIGN KEY (faculty_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_vr_pref_venue FOREIGN KEY (preferred_venue_id) REFERENCES venues(venue_id) ON DELETE SET NULL,
  CONSTRAINT fk_vr_assigned_venue FOREIGN KEY (assigned_venue_id) REFERENCES venues(venue_id) ON DELETE SET NULL,
  CONSTRAINT fk_vr_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT chk_vr_size CHECK (event_size > 0),
  CONSTRAINT chk_vr_setup CHECK (setup_minutes >= 0 AND setup_minutes <= 180),
  CONSTRAINT uq_vr_event UNIQUE (event_id),
  INDEX idx_vr_status_created (queue_status,created_at),
  INDEX idx_vr_faculty (faculty_id,queue_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_tasks (
  task_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id VARCHAR(32) NOT NULL,
  task_name VARCHAR(100) NOT NULL,
  arrival_time INT NOT NULL,
  burst_time INT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  status ENUM('sample','simulated') NOT NULL DEFAULT 'sample',
  CONSTRAINT chk_task_arrival CHECK (arrival_time >= 0),
  CONSTRAINT chk_task_burst CHECK (burst_time > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scheduling_runs (
  run_id CHAR(36) PRIMARY KEY,
  algorithm ENUM('FCFS','SJF','SRTF','PRIORITY','RR') NOT NULL,
  quantum INT NULL DEFAULT NULL,
  timeline_json MEDIUMTEXT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  task_count INT NOT NULL,
  average_waiting_time DECIMAL(14,4) NOT NULL,
  average_turnaround_time DECIMAL(14,4) NOT NULL,
  CONSTRAINT uq_run_algorithm UNIQUE (run_id,algorithm),
  CONSTRAINT fk_run_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT chk_run_quantum CHECK (quantum IS NULL OR quantum > 0),
  CONSTRAINT chk_run_count CHECK (task_count > 0),
  CONSTRAINT chk_run_averages CHECK (average_waiting_time >= 0 AND average_turnaround_time > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scheduling_results (
  result_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  task_id INT UNSIGNED NOT NULL,
  algorithm ENUM('FCFS','SJF','SRTF','PRIORITY','RR') NOT NULL,
  process_id VARCHAR(32) NOT NULL,
  task_name VARCHAR(100) NOT NULL,
  arrival_time INT NOT NULL,
  burst_time INT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  start_time INT NOT NULL,
  finish_time INT NOT NULL,
  waiting_time INT NOT NULL,
  turnaround_time INT NOT NULL,
  CONSTRAINT uq_run_task UNIQUE (run_id,task_id),
  CONSTRAINT fk_result_run FOREIGN KEY (run_id,algorithm) REFERENCES scheduling_runs(run_id,algorithm) ON DELETE CASCADE,
  CONSTRAINT fk_result_task FOREIGN KEY (task_id) REFERENCES event_tasks(task_id) ON DELETE RESTRICT,
  CONSTRAINT chk_result_math CHECK (
    arrival_time >= 0 AND burst_time > 0 AND start_time >= arrival_time
    AND finish_time >= start_time + burst_time
    AND turnaround_time = finish_time - arrival_time
    AND waiting_time = turnaround_time - burst_time
    AND waiting_time >= 0
  )
) ENGINE=InnoDB;

-- Safe sample records only. Accounts are created by the password-hashing CLI.
INSERT INTO venues (venue_name,capacity,resources) VALUES
 ('Main Auditorium',300,'Projector, PA system, stage'),
 ('Innovation Lab',40,'Computers, Wi-Fi, whiteboards'),
 ('Seminar Hall',80,'Projector, microphone, seating'),
 ('TCL 1-2',70,'Computer Lab, Dual Displays, Gigabit LAN, AC'),
 ('TCL 3-4',70,'Computer Lab, Projector, High-speed LAN, AC'),
 ('Ubuntu Lab',120,'Linux Workstations (100-130 capacity), Gigabit LAN, Smart Projector, AC'),
 ('KP Nautiyal Auditorium',350,'Auditorium (300-400 capacity), Stage, Surround Audio, Dual Projectors'),
 ('New Auditorium',500,'Grand Auditorium, 500 Capacity, Central AC, Concert Audio & Stage Lights')
ON DUPLICATE KEY UPDATE venue_name=VALUES(venue_name);

INSERT INTO event_tasks (process_id,task_name,arrival_time,burst_time,priority,status)
SELECT 'P1','Generate event report',0,7,0,'sample'
WHERE NOT EXISTS (SELECT 1 FROM event_tasks WHERE status='sample' AND process_id='P1');
INSERT INTO event_tasks (process_id,task_name,arrival_time,burst_time,priority,status)
SELECT 'P2','Process registrations',2,4,0,'sample'
WHERE NOT EXISTS (SELECT 1 FROM event_tasks WHERE status='sample' AND process_id='P2');
INSERT INTO event_tasks (process_id,task_name,arrival_time,burst_time,priority,status)
SELECT 'P3','Generate attendance lists',4,1,0,'sample'
WHERE NOT EXISTS (SELECT 1 FROM event_tasks WHERE status='sample' AND process_id='P3');
INSERT INTO event_tasks (process_id,task_name,arrival_time,burst_time,priority,status)
SELECT 'P4','Prepare certificates',5,4,0,'sample'
WHERE NOT EXISTS (SELECT 1 FROM event_tasks WHERE status='sample' AND process_id='P4');
INSERT INTO event_tasks (process_id,task_name,arrival_time,burst_time,priority,status)
SELECT 'P5','Update event statistics',20,2,0,'sample'
WHERE NOT EXISTS (SELECT 1 FROM event_tasks WHERE status='sample' AND process_id='P5');

-- Node.js server-side sessions. Cookies contain only a signed, opaque session ID.
CREATE TABLE IF NOT EXISTS app_sessions (
  session_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  data MEDIUMTEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX idx_session_expiry (expires_at)
) ENGINE=InnoDB;
