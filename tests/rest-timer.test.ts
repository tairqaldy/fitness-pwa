import { describe, expect, it } from "vitest";

import {
  adjustRestTimer,
  clampRestSec,
  formatCountdown,
  isElapsed,
  MAX_REST_SEC,
  MIN_REST_SEC,
  overrunMs,
  plannedSec,
  progress,
  remainingMs,
  startRestTimer,
} from "@/lib/rest-timer";

const T0 = 1_789_221_376_000;

describe("startRestTimer", () => {
  it("sets an absolute deadline from the duration", () => {
    const timer = startRestTimer(T0, 120);
    expect(timer.startedAtMs).toBe(T0);
    expect(timer.deadlineAtMs).toBe(T0 + 120_000);
    expect(plannedSec(timer)).toBe(120);
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a %s duration", (_label, value) => {
    expect(() => startRestTimer(T0, value)).toThrow(RangeError);
  });

  it("allows a zero duration", () => {
    expect(isElapsed(startRestTimer(T0, 0), T0)).toBe(true);
  });
});

describe("remaining time is derived from the clock, not accumulated", () => {
  // This is THE property that makes the timer survive the screen locking. A ticking counter
  // would be throttled or frozen while backgrounded and come back wrong.
  it("is correct after an arbitrarily long gap with no ticks", () => {
    const timer = startRestTimer(T0, 180);
    // Simulate the phone sleeping for 3 minutes: no interval ever fired.
    expect(remainingMs(timer, T0 + 179_000)).toBe(1_000);
    expect(remainingMs(timer, T0 + 180_000)).toBe(0);
    expect(remainingMs(timer, T0 + 10 * 60_000)).toBe(0);
  });

  it("never reports negative remaining time", () => {
    const timer = startRestTimer(T0, 60);
    expect(remainingMs(timer, T0 + 600_000)).toBe(0);
  });

  it("reports overrun separately so the UI can show '+over'", () => {
    const timer = startRestTimer(T0, 60);
    expect(overrunMs(timer, T0 + 60_000)).toBe(0);
    expect(overrunMs(timer, T0 + 80_000)).toBe(20_000);
    // Before the deadline there is no overrun.
    expect(overrunMs(timer, T0 + 10_000)).toBe(0);
  });

  it("marks elapsed exactly at the deadline, not one tick later", () => {
    const timer = startRestTimer(T0, 90);
    expect(isElapsed(timer, T0 + 89_999)).toBe(false);
    expect(isElapsed(timer, T0 + 90_000)).toBe(true);
  });
});

describe("adjustRestTimer", () => {
  it("extends the deadline", () => {
    const timer = adjustRestTimer(startRestTimer(T0, 60), 30);
    expect(remainingMs(timer, T0)).toBe(90_000);
  });

  it("trims the deadline", () => {
    const timer = adjustRestTimer(startRestTimer(T0, 120), -30);
    expect(remainingMs(timer, T0)).toBe(90_000);
  });

  it("never moves the deadline before the start, so the timer cannot go backwards in time", () => {
    const timer = adjustRestTimer(startRestTimer(T0, 60), -600);
    expect(timer.deadlineAtMs).toBe(T0);
    expect(remainingMs(timer, T0)).toBe(0);
  });

  it("keeps the original start instant", () => {
    expect(adjustRestTimer(startRestTimer(T0, 60), 30).startedAtMs).toBe(T0);
  });
});

describe("progress", () => {
  it("runs 0 to 1 across the rest period", () => {
    const timer = startRestTimer(T0, 100);
    expect(progress(timer, T0)).toBe(0);
    expect(progress(timer, T0 + 50_000)).toBeCloseTo(0.5, 10);
    expect(progress(timer, T0 + 100_000)).toBe(1);
  });

  it("clamps past the deadline instead of exceeding 1", () => {
    expect(progress(startRestTimer(T0, 10), T0 + 100_000)).toBe(1);
  });

  it("returns 1 for a zero-length timer rather than dividing by zero", () => {
    expect(progress(startRestTimer(T0, 0), T0)).toBe(1);
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "0:00"],
    [1_000, "0:01"],
    [59_000, "0:59"],
    [60_000, "1:00"],
    [90_000, "1:30"],
    [600_000, "10:00"],
    [3_599_000, "59:59"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });

  it("rounds up, so a fresh 90s timer reads 1:30 and never flashes 1:29", () => {
    expect(formatCountdown(89_999)).toBe("1:30");
    expect(formatCountdown(1)).toBe("0:01");
  });

  it("treats negative input as zero", () => {
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("clampRestSec", () => {
  it.each([
    [0, MIN_REST_SEC],
    [1, MIN_REST_SEC],
    [90, 90],
    [999_999, MAX_REST_SEC],
    [90.4, 90],
    [Number.NaN, MIN_REST_SEC],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampRestSec(input)).toBe(expected);
  });
});
