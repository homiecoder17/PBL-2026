import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProcesses,
  serializeTasks,
  schedule,
  resultFromRows,
  timeToArrival,
  studentsToBurst,
} from "../src/scheduler.js";
import { signInput, readInput } from "../src/scheduling-store.js";
export const SOURCE =
  "P1,Report,0,7\nP2,Registrations,2,4\nP3,Attendance,4,1\nP4,Certificates,5,4";
const tasks = parseProcesses(SOURCE),
  secret = "test-only-random-secret-at-least-32-characters";
test("FCFS reference: order, completion, waiting, turnaround, and averages", () => {
  const r = schedule(tasks, "FCFS");
  assert.deepEqual(
    r.segments.map((s) => s.process_id),
    ["P1", "P2", "P3", "P4"],
  );
  assert.deepEqual(
    r.rows.map((x) => x.finish_time),
    [7, 11, 12, 16],
  );
  assert.deepEqual(
    r.rows.map((x) => x.waiting_time),
    [0, 5, 7, 7],
  );
  assert.deepEqual(
    r.rows.map((x) => x.turnaround_time),
    [7, 9, 8, 11],
  );
  assert.equal(r.average_waiting_time, 4.75);
  assert.equal(r.average_turnaround_time, 8.75);
});
test("SJF reference: arrived-only execution and exact timing metrics", () => {
  const r = schedule(tasks, "SJF");
  assert.deepEqual(
    r.segments.map((s) => s.process_id),
    ["P1", "P3", "P2", "P4"],
  );
  assert.deepEqual(
    r.rows.map((x) => x.finish_time),
    [7, 12, 8, 16],
  );
  assert.deepEqual(
    r.rows.map((x) => x.waiting_time),
    [0, 6, 3, 7],
  );
  assert.deepEqual(
    r.rows.map((x) => x.turnaround_time),
    [7, 10, 4, 11],
  );
  assert.equal(r.average_waiting_time, 4);
  assert.equal(r.average_turnaround_time, 8);
});
for (const alg of ["FCFS", "SJF"])
  test(`${alg}: initial and intermediate idle periods`, () => {
    const r = schedule(parseProcesses("A,Task A,3,2\nB,Task B,10,1"), alg);
    assert.deepEqual(r.segments, [
      { process_id: "IDLE", start: 0, finish: 3 },
      { process_id: "A", start: 3, finish: 5 },
      { process_id: "IDLE", start: 5, finish: 10 },
      { process_id: "B", start: 10, finish: 11 },
    ]);
    assert.equal(r.average_waiting_time, 0);
  });
test("SJF remains non-preemptive when a shorter process arrives", () => {
  const r = schedule(parseProcesses("A,A,0,8\nB,B,1,1\nC,C,0,10"), "SJF");
  assert.deepEqual(
    r.segments.map((s) => s.process_id),
    ["A", "B", "C"],
  );
  assert.equal(r.segments[0].finish, 8);
});
test("Both algorithms have deterministic alphabetical tie-breaking", () => {
  for (const alg of ["FCFS", "SJF"])
    assert.deepEqual(
      schedule(parseProcesses("P2,B,0,2\nP10,A,0,2"), alg).segments.map(
        (s) => s.process_id,
      ),
      ["P10", "P2"],
    );
});
const invalid = [
  ["empty", ""],
  ["negative arrival", "P1,A,-1,2"],
  ["zero burst", "P1,A,0,0"],
  ["fractional burst", "P1,A,0,1.5"],
  ["duplicate IDs", "P1,A,0,1\np1,B,0,1"],
  ["reserved ID", "IDLE,A,0,1"],
  ["arrival too large", "P1,A,100001,1"],
  ["burst too large", "P1,A,0,100001"],
  ["missing field", "P1,A,0"],
  [
    "too many processes",
    Array.from({ length: 21 }, (_, i) => `P${i},A,0,1`).join("\n"),
  ],
  ["broken CSV", 'P1,"broken,0,2'],
];
for (const [label, source] of invalid)
  test("Reject invalid workload: " + label, () =>
    assert.throws(() => parseProcesses(source)),
  );
test("CSV names containing commas round-trip correctly", () => {
  const t = [
    {
      process_id: "A",
      task_name: "Generate, verify report",
      arrival_time: 0,
      burst_time: 2,
    },
  ];
  assert.deepEqual(parseProcesses(serializeTasks(t)), t);
});
test("Invalid algorithm, bad quantum, and boolean arrival rejected", () => {
  assert.throws(() => schedule(tasks, "INVALID"));
  assert.throws(() => schedule(tasks, "RR", { quantum: 0 }));
  assert.throws(() => schedule(tasks, "RR", { quantum: 1.5 }));
  assert.throws(() =>
    schedule(
      [{ process_id: "A", task_name: "A", arrival_time: true, burst_time: 1 }],
      "FCFS",
    ),
  );
});
test("Saved rows reproduce exact idle timeline and stable process colors", () => {
  const r = schedule(parseProcesses("A,A,3,2\nB,B,10,1"), "FCFS");
  assert.deepEqual(resultFromRows(r.rows, "FCFS"), r);
  assert.deepEqual(
    schedule(tasks, "FCFS").color_by_process,
    schedule(tasks, "SJF").color_by_process,
  );
});
test("Signed scheduling input rejects tampering, wrong user, expiry, and future time", () => {
  const tok = signInput(tasks, "FCFS", 1, secret);
  assert.equal(readInput(tok, 1, secret).algorithm, "FCFS");
  assert.throws(() => readInput(tok + "x", 1, secret));
  assert.throws(() => readInput(tok, 2, secret));
  assert.throws(() =>
    readInput(
      signInput(tasks, "FCFS", 1, secret, Date.now() - 1800001),
      1,
      secret,
    ),
  );
  assert.throws(() =>
    readInput(
      signInput(tasks, "FCFS", 1, secret, Date.now() + 10000),
      1,
      secret,
    ),
  );
});
test("300 deterministic workloads satisfy invariants across all 5 algorithms", () => {
  let seed = 42;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  for (let run = 0; run < 300; run++) {
    const t = Array.from({ length: 1 + (next() % 20) }, (_, i) => ({
      process_id: "P" + i,
      task_name: "Task",
      arrival_time: next() % 40,
      burst_time: 1 + (next() % 15),
      priority: next() % 10,
    }));
    for (const alg of ["FCFS", "SJF", "SRTF", "PRIORITY", "RR"]) {
      const r = schedule(t, alg, { quantum: 1 + (run % 4) });
      assert.equal(r.rows.length, t.length);
      let finish = 0;
      const busyByPid = new Map();
      for (const s of r.segments) {
        assert.equal(s.start, finish);
        assert.ok(s.finish > s.start);
        if (s.process_id !== "IDLE") {
          busyByPid.set(
            s.process_id,
            (busyByPid.get(s.process_id) || 0) + (s.finish - s.start),
          );
        }
        finish = s.finish;
      }
      for (const row of r.rows) {
        assert.equal(busyByPid.get(row.process_id), row.burst_time);
        assert.ok(row.start_time >= row.arrival_time);
        assert.ok(row.finish_time >= row.start_time + row.burst_time);
        assert.equal(row.turnaround_time, row.finish_time - row.arrival_time);
        assert.equal(row.waiting_time, row.turnaround_time - row.burst_time);
        assert.equal(row.response_time, row.start_time - row.arrival_time);
        assert.ok(row.waiting_time >= 0);
      }
    }
  }
});

test("SRTF preempts longer running process and achieves optimal waiting time", () => {
  const r = schedule(tasks, "SRTF");
  assert.deepEqual(
    r.segments.map((s) => [s.process_id, s.start, s.finish]),
    [
      ["P1", 0, 2],
      ["P2", 2, 4],
      ["P3", 4, 5],
      ["P2", 5, 7],
      ["P4", 7, 11],
      ["P1", 11, 16],
    ],
  );
  assert.equal(r.average_waiting_time, 3);
  assert.equal(r.average_turnaround_time, 7);
});

test("Priority scheduling honors lower-number priority and round-trips 5-column CSV", () => {
  const csv = "P1,Bulk,0,5,3\nP2,Urgent,1,2,1\nP3,Medium,1,2,2";
  const parsed = parseProcesses(csv);
  assert.deepEqual(parseProcesses(serializeTasks(parsed)), parsed);
  const r = schedule(parsed, "PRIORITY");
  assert.deepEqual(
    r.segments.map((s) => s.process_id),
    ["P1", "P2", "P3"],
  );
});

test("Round Robin schedules time slices in FIFO ready order with idle gaps", () => {
  const rrTasks = parseProcesses("P1,A,0,5\nP2,B,1,3\nP3,C,2,1");
  const r = schedule(rrTasks, "RR", { quantum: 2 });
  assert.equal(r.quantum, 2);
  assert.deepEqual(
    r.segments.map((s) => [s.process_id, s.start, s.finish]),
    [
      ["P1", 0, 2],
      ["P2", 2, 4],
      ["P3", 4, 5],
      ["P1", 5, 7],
      ["P2", 7, 8],
      ["P1", 8, 9],
    ],
  );
  assert.deepEqual(
    r.rows.map((x) => [x.process_id, x.finish_time, x.waiting_time, x.response_time]),
    [
      ["P1", 9, 4, 0],
      ["P2", 8, 4, 1],
      ["P3", 5, 2, 2],
    ],
  );
});
test("Event start time to arrival and student count to burst time conversion", () => {
  assert.equal(timeToArrival("09:00"), 0);
  assert.equal(timeToArrival("10:00"), 1);
  assert.equal(timeToArrival("11:30"), 2);
  assert.equal(timeToArrival("14:00"), 5);
  assert.equal(studentsToBurst(35), 1);
  assert.equal(studentsToBurst(50), 1);
  assert.equal(studentsToBurst(60), 2);
  assert.equal(studentsToBurst(100), 2);
  assert.equal(studentsToBurst(200), 4);

  const eventCsv = 'E1,"Symposium",10:00,200\nE2,"Hackathon",09:00,35';
  const tasks = parseProcesses(eventCsv);
  assert.equal(tasks[0].arrival_time, 1);
  assert.equal(tasks[0].burst_time, 4);
  assert.equal(tasks[0].original_start_time, "10:00");
  assert.equal(tasks[0].expected_students, 200);

  assert.equal(tasks[1].arrival_time, 0);
  assert.equal(tasks[1].burst_time, 1);
  assert.equal(tasks[1].original_start_time, "09:00");
  assert.equal(tasks[1].expected_students, 35);
});
