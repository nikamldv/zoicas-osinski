"use strict";

const berlin = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function berlinWallTime(value) {
    const parts = Object.fromEntries(berlin.formatToParts(value).map(({type, value}) => [type, value]));
    return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute + ":" + parts.second;
}

// MySQL DATETIME stores Berlin wall time without an offset. Check both sides
// of a DST transition to detect nonexistent or repeated local times.
function possibleInstants(wallTime) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wallTime)) return [];
    const nominal = Date.parse(wallTime + "Z");
    if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 19) !== wallTime) return [];
    const candidates = new Set();
    for (const dayOffset of [-86400000, 86400000]) {
        const sample = nominal + dayOffset;
        const offset = Date.parse(berlinWallTime(sample) + "Z") - sample;
        const candidate = nominal - offset;
        if (berlinWallTime(candidate) === wallTime) candidates.add(candidate);
    }
    return [...candidates];
}

function punctualityStatus({ attendanceId, scheduledDate, scheduledTime, checkIn }) {
    if (attendanceId == null) return "NICHT_ERFASST";
    const scheduled = possibleInstants(scheduledDate + "T" + scheduledTime);
    const actual = possibleInstants(checkIn);
    if (!scheduled.length || !actual.length) return "NICHT_BEWERTBAR";
    // An earlier calendar day is not an arrival for the scheduled visit.
    if (checkIn.slice(0, 10) < scheduledDate) return "NICHT_BEWERTBAR";
    const comparisons = new Set(actual.flatMap(arrival => scheduled.map(start => arrival <= start)));
    if (comparisons.size !== 1) return "NICHT_BEWERTBAR";
    return comparisons.has(true) ? "PÜNKTLICH" : "VERSPÄTET";
}

module.exports = { berlinWallTime, possibleInstants, punctualityStatus };
