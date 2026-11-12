import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateVenueMatches,
  parseResourceTags,
} from "../src/venue-matcher.js";

const SAMPLE_VENUES = [
  {
    venue_id: 1,
    venue_name: "Main Auditorium",
    capacity: 500,
    resources: "Stage, Projector, Dual PA Audio, Central AC",
  },
  {
    venue_id: 2,
    venue_name: "Seminar Hall A",
    capacity: 100,
    resources: "Projector, Mic, Whiteboards, Wi-Fi",
  },
  {
    venue_id: 3,
    venue_name: "Innovation Lab 301",
    capacity: 80,
    resources: "Workstations, Gigabit LAN, Dual Displays, Projector, AC",
  },
  {
    venue_id: 4,
    venue_name: "Studio Room 12",
    capacity: 40,
    resources: "Whiteboards",
  },
];

test("parseResourceTags parses delimited strings and arrays without duplicates", () => {
  assert.deepEqual(
    parseResourceTags("Projector, Mic; Whiteboards / Projector"),
    ["Projector", "Mic", "Whiteboards"],
  );
  assert.deepEqual(parseResourceTags(["Projector", "Mic, Projector"]), [
    "Projector",
    "Mic",
  ]);
});

test("evaluateVenueMatches disqualifies capacity shortfalls and prefers right-sized match", () => {
  const req = {
    event_id: 99,
    event_date: "2026-12-01",
    start_time: "10:00",
    end_time: "12:00",
    event_size: 75,
    setup_minutes: 15,
    required_resources: "Projector, Computers / Lab, Wi-Fi / High-speed LAN",
    event_category: "workshop",
    av_support_needed: true,
  };

  const { candidates, recommendedVenueId } = evaluateVenueMatches(
    req,
    SAMPLE_VENUES,
    [],
  );

  // Studio Room 12 (40 seats < 75) must be disqualified
  const studio = candidates.find((c) => c.venue_id === 4);
  assert.equal(studio.capacityOk, false);
  assert.equal(studio.eligible, false);
  assert.match(studio.disqualifiers[0], /Too small/);

  // Innovation Lab 301 (80 seats => 94% fill + all lab resources + workshop match) should beat Main Auditorium (500 seats)
  assert.equal(recommendedVenueId, 3);
  assert.equal(candidates[0].venue_id, 3);
  assert.equal(candidates[0].eligible, true);
  assert.ok(candidates[0].score > candidates[1].score);
});

test("evaluateVenueMatches detects slot conflicts and ignores pending_schedule events", () => {
  const req = {
    event_id: 10,
    event_date: "2026-12-02",
    start_time: "14:00",
    end_time: "16:00",
    event_size: 60,
    setup_minutes: 15,
    required_resources: "Projector, Wi-Fi / High-speed LAN",
    event_category: "seminar",
  };

  const existing = [
    {
      event_id: 1,
      venue_id: 2,
      title: "Overlapping Colloquium",
      event_date: "2026-12-02",
      start_time: "15:00:00",
      end_time: "17:00:00",
      status: "scheduled",
    },
    {
      event_id: 2,
      venue_id: 3,
      title: "Unscheduled Queue Entry",
      event_date: "2026-12-02",
      start_time: "14:00:00",
      end_time: "16:00:00",
      status: "pending_schedule",
    },
  ];

  const { candidates, recommendedVenueId } = evaluateVenueMatches(
    req,
    SAMPLE_VENUES,
    existing,
  );

  const seminarA = candidates.find((c) => c.venue_id === 2);
  assert.equal(seminarA.available, false);
  assert.equal(seminarA.eligible, false);
  assert.equal(seminarA.conflicts.length, 1);
  assert.match(seminarA.disqualifiers[0], /Overlapping Colloquium/);

  const lab = candidates.find((c) => c.venue_id === 3);
  assert.equal(lab.available, true);
  assert.equal(lab.eligible, true);
  assert.ok(recommendedVenueId === 3 || recommendedVenueId === 1);
});

test("evaluateVenueMatches enforces setup buffer, strict equipment, and headroom filters", () => {
  const req = {
    event_id: 11,
    event_date: "2026-12-03",
    start_time: "11:10",
    end_time: "12:30",
    event_size: 95,
    setup_minutes: 20,
    required_resources: "Projector, Stage",
    event_category: "seminar",
    preferred_venue_id: 2,
  };

  const existing = [
    {
      event_id: 5,
      venue_id: 2,
      title: "Morning Briefing",
      event_date: "2026-12-03",
      start_time: "09:30:00",
      end_time: "11:00:00",
      status: "scheduled",
    },
  ];

  // Soft mode: Seminar Hall A has a 10m gap (tight vs 20m setup) and misses Stage, but remains eligible
  const soft = evaluateVenueMatches(req, SAMPLE_VENUES, existing);
  const semSoft = soft.candidates.find((c) => c.venue_id === 2);
  assert.equal(semSoft.available, true);
  assert.equal(semSoft.bufferClear, false);
  assert.equal(semSoft.minGapMinutes, 10);
  assert.equal(semSoft.eligible, true);
  assert.ok(semSoft.warnings.some((w) => /Tight gap/.test(w)));

  // Strict mode: Seminar Hall A is disqualified by buffer, missing Stage, and 10% headroom (5% < 10%)
  const strict = evaluateVenueMatches(req, SAMPLE_VENUES, existing, {
    strictResources: true,
    enforceBuffer: true,
    minHeadroomPct: 10,
  });
  const semStrict = strict.candidates.find((c) => c.venue_id === 2);
  assert.equal(semStrict.eligible, false);
  assert.equal(semStrict.disqualifiers.length, 3);
  assert.equal(strict.recommendedVenueId, 1);

  // Impossible demand returns null recommendation
  const impossible = evaluateVenueMatches(
    { ...req, event_size: 2000 },
    SAMPLE_VENUES,
    existing,
  );
  assert.equal(impossible.recommendedVenueId, null);
  assert.ok(impossible.candidates.every((c) => !c.eligible));
});
