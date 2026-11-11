// Pure educational simulation: never controls the computer's OS CPU scheduler.
import { parse } from "csv-parse/sync";
export const MAX_PROCESSES = 20;
export const MAX_TIME = 100_000;
export function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > MAX_PROCESSES)
    throw new Error("Enter between 1 and 20 processes.");
  const seen = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== "object")
      throw new Error("Invalid process data.");
    const pid = task.process_id;
    if (
      typeof pid !== "string" ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(pid) ||
      pid.toUpperCase() === "IDLE"
    )
      throw new Error(
        "Process IDs need 1–32 letters, digits, underscores or hyphens; IDLE is reserved.",
      );
    if (seen.has(pid.toLowerCase()))
      throw new Error("Process IDs must be unique (case-insensitive).");
    seen.add(pid.toLowerCase());
    if (
      typeof task.task_name !== "string" ||
      !task.task_name.trim() ||
      task.task_name.length > 100
    )
      throw new Error("Task names need 1–100 characters.");
    if (
      !Number.isInteger(task.arrival_time) ||
      task.arrival_time < 0 ||
      task.arrival_time > MAX_TIME
    )
      throw new Error("Arrival time must be a whole number from 0 to 100000.");
    if (
      !Number.isInteger(task.burst_time) ||
      task.burst_time < 1 ||
      task.burst_time > MAX_TIME
    )
      throw new Error("Burst time must be a whole number from 1 to 100000.");
  }
}
export function timeToArrival(timeStr, baseHour = 9) {
  if (typeof timeStr === "string" && timeStr.includes(":")) {
    const [h, m] = timeStr.split(":").map((v) => parseInt(v, 10));
    return Math.max(0, Math.floor(h - baseHour + (m || 0) / 60));
  }
  const val = Number(timeStr);
  return val >= baseHour && val <= 24 ? val - baseHour : Math.max(0, val);
}

export function studentsToBurst(studentCount, studentsPerHour = 50) {
  const count = Number(studentCount);
  return Math.max(1, Math.ceil(count / studentsPerHour));
}

export function parseProcesses(source) {
  if (typeof source !== "string" || source.length > 10000)
    throw new Error("Process input must be text of at most 10000 characters.");
  let rows;
  try {
    rows = parse(source, {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  } catch {
    throw new Error(
      "Invalid CSV. Use double quotes around names containing commas.",
    );
  }
  const tasks = rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      if (row.length !== 4)
        throw new Error(
          "Each line needs process_id, task_name, arrival_time, burst_time.",
        );
      const [pid, name, arrivalRaw, burstRaw] = row.map((cell) => cell.trim());
      let arrival;
      let burst;
      let originalStartTime = null;
      let expectedStudents = null;

      if (/^\d{1,2}:\d{2}$/.test(arrivalRaw)) {
        originalStartTime = arrivalRaw;
        arrival = timeToArrival(arrivalRaw, 9);
      } else if (/^\d+$/.test(arrivalRaw)) {
        arrival = Number(arrivalRaw);
      } else {
        throw new Error("Arrival and burst times must be whole numbers.");
      }

      if (/^\d+$/.test(burstRaw)) {
        const val = Number(burstRaw);
        if (originalStartTime !== null) {
          expectedStudents = val;
          burst = studentsToBurst(val, 50);
        } else {
          burst = val;
        }
      } else {
        throw new Error("Arrival and burst times must be whole numbers.");
      }

      const cleanName = name
        .replace(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, "")
        .replace(/^(&#34;|&quot;)|(&#34;|&quot;)$/g, "")
        .replaceAll("&#34;", "")
        .replaceAll("&quot;", "")
        .trim();

      const task = {
        process_id: pid,
        task_name: cleanName,
        arrival_time: arrival,
        burst_time: burst,
      };
      if (originalStartTime !== null) {
        task.original_start_time = originalStartTime;
        task.expected_students = expectedStudents;
      }
      return task;
    });
  validateTasks(tasks);
  return tasks;
}

export function eventsToCsv(events) {
  return events
    .map((e, index) => {
      const pid = `E${index + 1}`;
      const cleanTitle = (e.title || `Event ${index + 1}`)
        .replaceAll("&#34;", "")
        .replaceAll("&quot;", "")
        .replaceAll('"', '')
        .trim();
      const startTime = e.start_time ? String(e.start_time).slice(0, 5) : "09:00";
      const students = e.expected_attendance || 50;
      const formattedTitle = cleanTitle.includes(",") ? `"${cleanTitle}"` : cleanTitle;
      return `${pid},${formattedTitle},${startTime},${students}`;
    })
    .join("\n");
}
export function serializeTasks(tasks) {
  return tasks
    .map((t) =>
      [t.process_id, t.task_name, t.arrival_time, t.burst_time]
        .map((v) => {
          const s = String(v);
          return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
}
function compareId(a, b) {
  const x = a.toLowerCase(),
    y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
function finishResult(rows, segments, algorithm, clock) {
  rows.sort(
    (a, b) =>
      a.arrival_time - b.arrival_time || compareId(a.process_id, b.process_id),
  );
  return {
    algorithm,
    rows,
    segments,
    total_time: clock,
    average_waiting_time:
      rows.reduce((n, r) => n + r.waiting_time, 0) / rows.length,
    average_turnaround_time:
      rows.reduce((n, r) => n + r.turnaround_time, 0) / rows.length,
    // Stable process colors across both algorithms, regardless of execution order.
    color_by_process: Object.fromEntries(
      rows.map((r, i) => [r.process_id, i % 4]),
    ),
  };
}
export function schedule(tasks, algorithm) {
  validateTasks(tasks);
  if (!["FCFS", "SJF"].includes(algorithm))
    throw new Error("Choose FCFS or SJF.");
  const pending = [...tasks],
    rows = [],
    segments = [];
  let clock = 0;
  while (pending.length) {
    const ready = pending.filter((t) => t.arrival_time <= clock);
    if (!ready.length) {
      const next = Math.min(...pending.map((t) => t.arrival_time));
      segments.push({ process_id: "IDLE", start: clock, finish: next });
      clock = next;
      continue;
    }
    ready.sort(
      (a, b) =>
        (algorithm === "SJF" ? a.burst_time - b.burst_time : 0) ||
        a.arrival_time - b.arrival_time ||
        compareId(a.process_id, b.process_id),
    );
    const task = ready[0],
      start = clock;
    clock += task.burst_time;
    pending.splice(pending.indexOf(task), 1);
    rows.push({
      ...task,
      start_time: start,
      finish_time: clock,
      waiting_time: start - task.arrival_time,
      turnaround_time: clock - task.arrival_time,
    });
    segments.push({ process_id: task.process_id, start, finish: clock });
  }
  return finishResult(rows, segments, algorithm, clock);
}
export function resultFromRows(input, algorithm) {
  const rows = input.map((r) => ({ ...r }));
  const segments = [];
  let clock = 0;
  for (const row of [...rows].sort((a, b) => a.start_time - b.start_time)) {
    if (row.start_time > clock)
      segments.push({
        process_id: "IDLE",
        start: clock,
        finish: row.start_time,
      });
    segments.push({
      process_id: row.process_id,
      start: row.start_time,
      finish: row.finish_time,
    });
    clock = row.finish_time;
  }
  return finishResult(rows, segments, algorithm, clock);
}
