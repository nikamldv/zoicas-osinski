"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { punctualityStatus } = require("../attendance-punctuality");

const cases = [
    ["exact arrival", "2026-11-23", "08:00:00", "2026-11-23T08:00:00", "PÜNKTLICH"],
    ["early arrival", "2026-11-23", "08:00:00", "2026-11-23T07:59:59", "PÜNKTLICH"],
    ["late arrival", "2026-11-23", "08:00:00", "2026-11-23T08:00:01", "VERSPÄTET"],
    ["next day with earlier clock time", "2026-11-23", "08:00:00", "2026-11-24T07:00:00", "VERSPÄTET"],
    ["previous calendar day", "2026-11-23", "08:00:00", "2026-11-22T07:00:00", "NICHT_BEWERTBAR"],
    ["midnight rolls over", "2026-11-23", "23:59:59", "2026-11-24T00:00:00", "VERSPÄTET"],
    ["spring forward spans the gap", "2026-03-29", "03:00:00", "2026-03-29T01:59:59", "PÜNKTLICH"],
    ["spring forward nonexistent scheduled time", "2026-03-29", "02:30:00", "2026-03-29T03:00:00", "NICHT_BEWERTBAR"],
    ["fall back repeated time with indeterminate order", "2026-10-25", "02:30:00", "2026-10-25T02:15:00", "NICHT_BEWERTBAR"],
    ["fall back repeated time with determinate order", "2026-10-25", "03:00:00", "2026-10-25T02:30:00", "PÜNKTLICH"],
    ["missing scheduled time", "2026-11-23", null, "2026-11-23T08:00:00", "NICHT_BEWERTBAR"],
    ["missing scheduled date", null, "08:00:00", "2026-11-23T08:00:00", "NICHT_BEWERTBAR"],
    ["missing check-in", "2026-11-23", "08:00:00", null, "NICHT_ERFASST", null]
];

for (const [label, scheduledDate, scheduledTime, checkIn, expected, attendanceId = 1] of cases) {
    test(label, () => assert.equal(punctualityStatus({ attendanceId, scheduledDate, scheduledTime, checkIn }), expected));
}

