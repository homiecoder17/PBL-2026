import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execute } from "./db.js";
import { DEFAULT_QUANTUM, schedule, validateTasks } from "./scheduler.js";

export function signInput(
  tasks,
  algorithm,
  userId,
  secret,
  now = Date.now(),
  options = {},
) {
  validateTasks(tasks);
  schedule(tasks, algorithm, options);
  const quantum = algorithm === "RR" ? (options.quantum ?? DEFAULT_QUANTUM) : null;
  const data = Buffer.from(
    JSON.stringify({ tasks, algorithm, quantum, userId, issuedAt: now }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update("cpu-input-v1." + data)
    .digest("base64url");
  return data + "." + signature;
}

export function readInput(token, userId, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length > 20000)
    throw new Error("Invalid scheduling input.");
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
  )
    throw new Error("Invalid scheduling input.");
  const expected = createHmac("sha256", secret)
    .update("cpu-input-v1." + parts[0])
    .digest("base64url");
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[1])))
    throw new Error("Invalid scheduling signature.");
  const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (
    !Number.isSafeInteger(data.issuedAt) ||
    data.issuedAt > now ||
    now - data.issuedAt > 1800000
  )
    throw new Error("Scheduling input expired.");
  if (data.userId !== userId)
    throw new Error("Scheduling input belongs to another user.");
  validateTasks(data.tasks);
  return data;
}

export async function saveSignedRun(db, token, userId, secret) {
  const input = readInput(token, userId, secret),
    quantum = input.algorithm === "RR" ? (input.quantum ?? DEFAULT_QUANTUM) : null,
    result = schedule(input.tasks, input.algorithm, { quantum }),
    runId = randomUUID();
  await db.transaction(async (conn) => {
    await execute(
      conn,
      `INSERT INTO scheduling_runs (run_id,algorithm,quantum,timeline_json,created_by,task_count,average_waiting_time,average_turnaround_time) VALUES (?,?,?,?,?,?,?,?)`,
      [
        runId,
        result.algorithm,
        quantum,
        JSON.stringify(result.segments),
        userId,
        result.rows.length,
        result.average_waiting_time,
        result.average_turnaround_time,
      ],
    );
    for (const row of result.rows) {
      const priority = row.priority ?? 0;
      const task = await execute(
        conn,
        "INSERT INTO event_tasks (process_id,task_name,arrival_time,burst_time,priority,status) VALUES (?,?,?,?,?,'simulated')",
        [row.process_id, row.task_name, row.arrival_time, row.burst_time, priority],
      );
      await execute(
        conn,
        `INSERT INTO scheduling_results (run_id,task_id,algorithm,process_id,task_name,arrival_time,burst_time,priority,start_time,finish_time,waiting_time,turnaround_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          runId,
          task.insertId,
          result.algorithm,
          row.process_id,
          row.task_name,
          row.arrival_time,
          row.burst_time,
          priority,
          row.start_time,
          row.finish_time,
          row.waiting_time,
          row.turnaround_time,
        ],
      );
    }
  });
  return runId;
}
