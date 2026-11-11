# CampusFlow — Project Structure & Viva Guide

A clean, modular **Frontend / Backend** architecture designed for academic evaluation and evaluation by university examiners.

---

## 📁 Directory Architecture Overview

```text
c:\Users\shivs\pbl\
│
├── 🎨 frontend/                     # Everything visible to the user / browser
│   ├── views/                      # Dynamic EJS Server-Rendered UI Templates
│   │   ├── partials/               # Reusable UI components
│   │   │   ├── header.ejs          # Top navigation bar, session indicators & user role
│   │   │   ├── footer.ejs          # Page footer
│   │   │   ├── icon.ejs            # Clean vector SVG icons
│   │   │   └── result.ejs          # OS Gantt charts, metrics & Commit-to-MySQL forms
│   │   ├── dashboard.ejs           # Admin & Student overview + Interactive monthly calendar
│   │   ├── simulator.ejs           # OS CPU Process Scheduler (FCFS vs SJF with dynamic queue)
│   │   ├── events.ejs              # Campus events catalog with status badges
│   │   ├── event-form.ejs          # Create & edit event form with venue/capacity checks
│   │   ├── venues.ejs              # Campus venues listing (TCL 1-2, Ubuntu Lab, Audis, etc.)
│   │   ├── venue-form.ejs          # Add & edit venue form
│   │   ├── reports.ejs             # Relational DBMS query viewer & export
│   │   ├── login.ejs               # Authentication portal
│   │   └── error.ejs               # Friendly HTTP error pages
│   │
│   └── public/                     # Static Client Assets
│       ├── app.css                 # Responsive stylesheet & theme tokens
│       ├── app.js                  # Client interactivity & animation enhancements
│       ├── fonts/                  # Local Inter font files
│       └── vendor/                 # Local bootstrap & animation scripts
│
├── ⚙️ backend/                      # Core logic, OS algorithms & database engine
│   ├── src/                        # Node.js / Express Server Source Code
│   │   ├── server.js               # Application entrypoint & HTTP port listener
│   │   ├── app.js                  # Express routing, middleware, controllers & view configuration
│   │   ├── scheduler.js            # OS CPU Scheduling Algorithms: FCFS & SJF logic
│   │   ├── services.js             # DBMS business logic, ACID transactions & concurrency locks
│   │   ├── db.js                   # Database layer: MySQL 8 pool + SQLite relational fallback
│   │   ├── security.js             # Session security, CSRF protection & role-based access
│   │   ├── passwords.js            # Salted scrypt password hashing & verification
│   │   ├── config.js               # Environment variables & timezone loader
│   │   ├── reports.js              # Pre-defined analytical SQL queries
│   │   └── format.js               # Date, time & numeric presentation helpers
│   │
│   ├── database/                   # Database Schemas & Initial Records
│   │   └── init.sql                # Relational DDL: tables, CHECK constraints & campus venues
│   │
│   └── tests/                      # Automated Verification & Test Suites
│       ├── scheduler.test.js       # 26 Unit tests for FCFS, SJF, and AT/BT math
│       └── integration.test.js     # End-to-end integration & database tests
│
├── 📜 scripts/                     # Automated verification & health-check scripts
│   ├── check.js                    # Syntax and template integrity checker
│   └── ...
│
├── index.js                        # Root entrypoint (delegates to backend/src/server.js)
├── package.json                    # Project dependencies & npm scripts
└── README.md                       # Project documentation
```

---

## 👩‍🏫 Quick Answers for "Mam" (Viva Questions & Explanations)

### Q1: "Show me where your Frontend code is."
> **Answer:** *"Ma'am, all client-facing presentation code is organized inside the `frontend/` directory."*
- **`frontend/views/`**: *"These are our EJS templates. For example, `simulator.ejs` renders the OS CPU scheduler page, `dashboard.ejs` renders the monthly calendar, and `venues.ejs` displays all college halls and computer labs."*
- **`frontend/public/`**: *"These are our static assets, including `app.css` for clean styling, responsive cards, and Gantt chart CSS tracks."*

---

### Q2: "Where are the Operating System scheduling algorithms implemented?"
> **Answer:** *"The OS scheduling algorithms lie in `backend/src/scheduler.js`."*
- **Non-preemptive SJF (Shortest Job First)**: Evaluates all processes that have arrived (`arrival_time <= current_time`) and selects the job with the shortest burst time.
- **FCFS (First-Come, First-Served)**: Executes processes strictly in arrival order.
- **Event-to-Process Mapping**:
  $$\text{Arrival Time } (AT) = \max(0, \text{Start Hour} - 9)$$
  $$\text{Burst Time } (BT) = \left\lceil \frac{\text{Expected Students}}{50} \right\rceil \text{ hours}$$

---

### Q3: "Where is the database and backend transaction logic?"
> **Answer:** *"The database engine and transaction logic lie in `backend/src/services.js` and `backend/src/db.js`."*
- **`backend/src/services.js`**: Runs bookings inside `db.transaction()` with pessimistic row locks (`SELECT ... FOR UPDATE`) to prevent double-booking identical venues at overlapping hours.
- **`backend/src/db.js`**: Connects to MySQL with connection pooling, and includes a zero-config offline relational database fallback so the viva never fails even if MySQL is stopped.
- **`backend/database/init.sql`**: Contains the full schema with enforced `CHECK` constraints (e.g. `capacity > 0`, `end_time > start_time`).

---

### Q4: "How does the backend connect to the frontend?"
> **Answer:** *"In `backend/src/app.js`, Express sets `frontend/views` as the view engine path and serves `frontend/public` at `/static`. The controllers fetch relational data from `backend/src/services.js`, execute algorithms via `backend/src/scheduler.js`, and pass the processed data into the EJS views."*
