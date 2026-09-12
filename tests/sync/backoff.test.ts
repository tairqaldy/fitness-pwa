import { describe, expect, it } from "vitest";

import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  classifyFailure,
  isPoisoned,
  nextAttemptDelayMs,
  POISON_AGE_MS,
  POISON_ATTEMPTS,
  retryAfterMs,
} from "@/lib/sync/backoff";

/** rng() === 0.5 makes the jitter factor exactly 1, so the delay is exactly the base. */
const noJitter = () => 0.5;
const minJitter = () => 0;
const maxJitter = () => 1;

const NOW = 1_789_221_376_000;

describe("nextAttemptDelayMs", () => {
  it.each([
    [0, BACKOFF_BASE_MS],
    [1, 4_000],
    [2, 8_000],
    [3, 16_000],
    [10, BACKOFF_CAP_MS],
  ])("attempt %i waits %ims with no jitter", (attempts, expected) => {
    expect(nextAttemptDelayMs(attempts, noJitter)).toBe(expected);
  });

  it("caps rather than growing without bound", () => {
    expect(nextAttemptDelayMs(1_000, noJitter)).toBe(BACKOFF_CAP_MS);
  });

  it("does not overflow to Infinity at an absurd attempt count", () => {
    // 2 ** 5000 is Infinity; the exponent must be clamped before the shift.
    const delay = nextAttemptDelayMs(5_000, noJitter);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBe(BACKOFF_CAP_MS);
  });

  it("spreads +/-20% so a recovering server is not hit in lockstep", () => {
    expect(nextAttemptDelayMs(1, minJitter)).toBe(Math.round(4_000 * 0.8));
    expect(nextAttemptDelayMs(1, maxJitter)).toBe(Math.round(4_000 * 1.2));
  });

  it.each([
    ["negative", -5],
    ["NaN", Number.NaN],
    ["fractional", 0.4],
  ])("treats a %s attempt count as zero", (_label, value) => {
    expect(nextAttemptDelayMs(value, noJitter)).toBe(BACKOFF_BASE_MS);
  });
});

describe("isPoisoned", () => {
  it("retires an op after the attempt cap", () => {
    expect(isPoisoned({ attempts: POISON_ATTEMPTS, firstFailedAt: NOW }, NOW)).toBe(true);
    expect(isPoisoned({ attempts: POISON_ATTEMPTS - 1, firstFailedAt: NOW }, NOW)).toBe(false);
  });

  it("retires an op after 24h regardless of how few attempts it managed", () => {
    // The rule that actually fires: long backoffs mean an op can be stuck for a day on far
    // fewer than 24 attempts, blocking everything queued behind it.
    const op = { attempts: 6, firstFailedAt: NOW };
    expect(isPoisoned(op, NOW + POISON_AGE_MS - 1)).toBe(false);
    expect(isPoisoned(op, NOW + POISON_AGE_MS)).toBe(true);
  });

  it("never poisons an op the server has not yet rejected", () => {
    // An op that has only ever failed to send because the phone was offline must survive any
    // amount of time in a basement gym.
    expect(isPoisoned({ attempts: 0, firstFailedAt: null }, NOW + 10 * POISON_AGE_MS)).toBe(false);
  });
});

describe("classifyFailure", () => {
  it.each([
    ["no response at all (offline/DNS/TLS)", null, "transient"],
    ["500", 500, "transient"],
    ["503", 503, "transient"],
    ["408 request timeout", 408, "transient"],
    ["429 rate limited", 429, "rateLimit"],
    ["401 unauthenticated", 401, "auth"],
    ["403 forbidden", 403, "auth"],
    ["400 bad request", 400, "permanent"],
    ["404", 404, "permanent"],
    ["409 conflict", 409, "permanent"],
    ["422", 422, "permanent"],
    ["200", 200, "transient"],
  ])("classifies %s", (_label, status, expected) => {
    expect(classifyFailure({ status })).toBe(expected);
  });
});

describe("retryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(retryAfterMs("30", NOW)).toBe(30_000);
  });

  it("parses an HTTP-date relative to now", () => {
    const when = new Date(NOW + 45_000).toUTCString();
    // toUTCString has second resolution, so allow the truncation.
    expect(retryAfterMs(when, NOW)).toBeGreaterThanOrEqual(44_000);
    expect(retryAfterMs(when, NOW)).toBeLessThanOrEqual(45_000);
  });

  it("floors a past date at the minimum rather than returning a negative wait", () => {
    expect(retryAfterMs(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(1_000);
  });

  it("clamps an absurd wait — a server may well ask us to wait a week", () => {
    expect(retryAfterMs("604800", NOW)).toBe(600_000);
  });

  it("floors a zero wait so the queue cannot spin", () => {
    expect(retryAfterMs("0", NOW)).toBe(1_000);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["whitespace", "   "],
    ["garbage", "soon"],
    ["numeric with a suffix", "12abc"],
  ])("falls back to the default for %s", (_label, header) => {
    expect(retryAfterMs(header, NOW)).toBe(60_000);
  });
});
