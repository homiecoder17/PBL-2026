export const RESOURCE_OPTIONS = [
  "Projector",
  "Computers / Lab",
  "Wi-Fi / High-speed LAN",
  "Microphone / PA Audio",
  "Stage",
  "Whiteboards",
  "Air Conditioning (AC)",
];

export const EVENT_CATEGORIES = [
  { value: "workshop", label: "Hands-on Workshop / Lab" },
  { value: "seminar", label: "Academic Seminar / Talk" },
  { value: "lecture", label: "Guest Lecture / Colloquium" },
  { value: "competition", label: "Hackathon / Competition" },
  { value: "cultural", label: "Showcase / Cultural Event" },
];

export const PRIORITY_LEVELS = [
  { value: "normal", label: "Standard Queue" },
  { value: "high", label: "High Priority (Departmental)" },
  { value: "urgent", label: "Urgent (Exam / Official)" },
];

const TOKEN_SYNONYMS = {
  projector: ["projector", "dual projectors", "smart projector", "dual displays", "displays"],
  computers: ["computer", "computers", "workstation", "workstations", "linux", "computer lab", "lab"],
  lab: ["lab", "workstations", "computers"],
  "wi-fi": ["wi-fi", "wifi", "lan", "gigabit", "high-speed"],
  lan: ["lan", "gigabit", "high-speed", "wi-fi", "wifi"],
  "high-speed lan": ["gigabit lan", "high-speed lan", "lan", "wi-fi", "wifi"],
  microphone: ["microphone", "mic", "pa", "audio", "surround audio", "concert audio"],
  "pa audio": ["pa", "audio", "microphone", "mic", "concert audio", "surround audio"],
  audio: ["audio", "pa", "microphone", "mic", "concert audio", "surround audio"],
  stage: ["stage", "auditorium", "stage lights"],
  whiteboards: ["whiteboard", "whiteboards"],
  ac: ["ac", "central ac", "air conditioning"],
  seating: ["seating", "capacity", "auditorium", "hall"],
};

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);
  return h * 60 + m;
}

export function parseResourceTags(input) {
  if (Array.isArray(input)) {
    return [
      ...new Set(
        input
          .flatMap((v) => String(v || "").split(/[,;/]+/))
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
  }
  return [
    ...new Set(
      String(input || "")
        .split(/[,;/]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function resourceMatches(venueResourcesText, tag) {
  const haystack = String(venueResourcesText || "").toLowerCase();
  const normalized = String(tag || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .trim();
  if (!normalized) return true;
  if (haystack.includes(normalized)) return true;

  const parts = normalized.split(/[/&]+|\s+/).map((p) => p.trim()).filter(Boolean);
  for (const part of [normalized, ...parts]) {
    if (part.length >= 2 && haystack.includes(part)) return true;
    const aliases = TOKEN_SYNONYMS[part];
    if (aliases && aliases.some((alias) => haystack.includes(alias))) return true;
  }
  return false;
}

function categoryFitsVenue(category, venue) {
  const text = `${venue.venue_name} ${venue.resources}`.toLowerCase();
  if (category === "workshop" || category === "competition") {
    return /lab|computer|workstation|lan|wi-fi/.test(text);
  }
  if (category === "cultural") {
    return /auditorium|stage|audio|lights/.test(text);
  }
  return /auditorium|seminar|projector|mic|audio/.test(text);
}

/**
 * Evaluates and ranks all venues against a queued faculty event request using
 * availability, setup buffers, event size vs hall capacity, resource tags,
 * AV/accessibility needs, preferred venue choice, and day congestion.
 */
export function evaluateVenueMatches(request, venues, scheduledEvents, options = {}) {
  const eventSize = Number(request.event_size || request.expected_attendance || 1);
  const reqStartMin = toMinutes(request.start_time);
  const reqEndMin = toMinutes(request.end_time);
  const setupMinutes = Number(request.setup_minutes ?? 15);
  const requiredTags = parseResourceTags(request.required_resources);
  const strictResources = Boolean(options.strictResources);
  const enforceBuffer = Boolean(options.enforceBuffer);
  const minHeadroomPct = Number(options.minHeadroomPct || 0);

  const evaluations = venues.map((venue) => {
    const capacity = Number(venue.capacity || 0);
    const sameDayEvents = scheduledEvents.filter(
      (ev) =>
        Number(ev.venue_id) === Number(venue.venue_id) &&
        ev.event_date === request.event_date &&
        ev.status === "scheduled" &&
        Number(ev.event_id) !== Number(request.event_id),
    );

    const conflicts = [];
    let minGapMinutes = Infinity;

    for (const ev of sameDayEvents) {
      const evStart = toMinutes(ev.start_time);
      const evEnd = toMinutes(ev.end_time);
      if (evStart < reqEndMin && evEnd > reqStartMin) {
        conflicts.push({
          event_id: ev.event_id,
          title: ev.title,
          start_time: String(ev.start_time).slice(0, 5),
          end_time: String(ev.end_time).slice(0, 5),
        });
      } else if (evEnd <= reqStartMin) {
        minGapMinutes = Math.min(minGapMinutes, reqStartMin - evEnd);
      } else if (evStart >= reqEndMin) {
        minGapMinutes = Math.min(minGapMinutes, evStart - reqEndMin);
      }
    }

    const available = conflicts.length === 0;
    const bufferClear = setupMinutes === 0 || minGapMinutes >= setupMinutes;
    const capacityOk = capacity >= eventSize;
    const fillPct = capacity > 0 ? Math.round((eventSize / capacity) * 100) : 0;
    const surplusSeats = capacity - eventSize;
    const headroomPct = capacity > 0 ? Math.round((surplusSeats / capacity) * 100) : 0;
    const headroomOk = capacityOk && headroomPct >= minHeadroomPct;

    const matchedResources = [];
    const missingResources = [];
    for (const tag of requiredTags) {
      if (resourceMatches(venue.resources, tag)) matchedResources.push(tag);
      else missingResources.push(tag);
    }
    const resourceRatio =
      requiredTags.length === 0 ? 1 : matchedResources.length / requiredTags.length;

    const avReady =
      !request.av_support_needed ||
      /projector|audio|mic|microphone|pa|stage|display/.test(
        String(venue.resources || "").toLowerCase(),
      );

    const preferred =
      Number(request.preferred_venue_id || 0) === Number(venue.venue_id);

    const disqualifiers = [];
    if (!available) {
      disqualifiers.push(
        `Time conflict with "${conflicts[0].title}" (${conflicts[0].start_time}–${conflicts[0].end_time})`,
      );
    }
    if (!capacityOk) {
      disqualifiers.push(`Too small (${capacity} seats < ${eventSize} expected)`);
    }
    if (capacityOk && !headroomOk) {
      disqualifiers.push(`Surplus (${headroomPct}%) below ${minHeadroomPct}% headroom filter`);
    }
    if (enforceBuffer && !bufferClear) {
      disqualifiers.push(
        `Turnover gap is ${minGapMinutes} min (strict ${setupMinutes} min buffer enabled)`,
      );
    }
    if (strictResources && missingResources.length > 0) {
      disqualifiers.push(`Missing required equipment: ${missingResources.join(", ")}`);
    }

    const eligible = disqualifiers.length === 0;
    let score = 0;
    const reasons = [];
    const warnings = [];

    if (available) {
      score += 20;
      reasons.push("Slot open");
    }
    if (bufferClear) {
      score += 10;
      if (Number.isFinite(minGapMinutes)) {
        reasons.push(`${minGapMinutes}m turnover gap`);
      } else {
        reasons.push("Clear buffer");
      }
    } else if (available) {
      warnings.push(`Tight gap (${minGapMinutes}m vs ${setupMinutes}m setup)`);
    }

    if (capacityOk) {
      let fitScore = 10;
      if (fillPct >= 60 && fillPct <= 95) fitScore = 30;
      else if (fillPct >= 40) fitScore = 22;
      else if (fillPct > 95) fitScore = 24;
      score += fitScore;
      reasons.push(`${fillPct}% fill (${surplusSeats} spare seats)`);
    }

    const resPts = Math.round(resourceRatio * 20);
    score += resPts;
    if (requiredTags.length > 0) {
      if (missingResources.length === 0) reasons.push("All equipment matched");
      else warnings.push(`Missing: ${missingResources.join(", ")}`);
    }

    if (preferred) {
      score += 10;
      reasons.push("Faculty preferred");
    }
    if (avReady) {
      score += 5;
    } else {
      warnings.push("Limited AV hardware listed");
    }
    if (categoryFitsVenue(request.event_category, venue)) {
      score += 5;
      reasons.push(`Suited for ${request.event_category || "event"}`);
    }

    return {
      venue_id: venue.venue_id,
      venue_name: venue.venue_name,
      capacity,
      resources: venue.resources,
      available,
      conflicts,
      bufferClear,
      minGapMinutes: Number.isFinite(minGapMinutes) ? minGapMinutes : null,
      capacityOk,
      headroomOk,
      fillPct,
      surplusSeats,
      headroomPct,
      matchedResources,
      missingResources,
      avReady,
      preferred,
      dayBookingCount: sameDayEvents.length,
      eligible,
      disqualifiers,
      reasons,
      warnings,
      score: Math.min(100, Math.max(0, score)),
    };
  });

  evaluations.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.capacity - b.capacity;
  });

  const recommended = evaluations.find((e) => e.eligible) || null;
  return {
    candidates: evaluations,
    recommendedVenueId: recommended ? recommended.venue_id : null,
  };
}
