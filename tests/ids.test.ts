import { describe, expect, it } from "vitest";

import { isUlid, MAX_ULID_TIME, ulid, ulidTime } from "@/lib/ids";

/** Fixed entropy so every assertion below is deterministic. */
const ZEROS = new Uint8Array(16);
const MAXES = new Uint8Array(16).fill(255);

describe("ulid", () => {
  it("produces a 26-character id", () => {
    expect(ulid(0, ZEROS)).toHaveLength(26);
  });

  it("encodes the epoch as all zeros", () => {
    expect(ulid(0, ZEROS)).toBe("00000000000000000000000000");
  });

  it("round-trips the timestamp", () => {
    const now = 1_789_221_376_000;
    expect(ulidTime(ulid(now, ZEROS))).toBe(now);
  });

  it("round-trips the maximum representable timestamp", () => {
    expect(ulidTime(ulid(MAX_ULID_TIME, ZEROS))).toBe(MAX_ULID_TIME);
  });

  it("sorts lexicographically in chronological order", () => {
    // The core property the whole schema relies on: ORDER BY id === ORDER BY created_at.
    const ids = [3_000, 1_000, 2_000].map((t) => ulid(t, ZEROS));
    expect([...ids].sort()).toEqual([ulid(1_000, ZEROS), ulid(2_000, ZEROS), ulid(3_000, ZEROS)]);
  });

  it("keeps sorting correctly across a base32 digit rollover", () => {
    // 32 -> 33 crosses a digit boundary; a naive decimal encoder breaks here.
    expect(ulid(31, ZEROS) < ulid(32, ZEROS)).toBe(true);
    expect(ulid(32, ZEROS) < ulid(33, ZEROS)).toBe(true);
  });

  it("varies with entropy at the same timestamp", () => {
    expect(ulid(1_000, ZEROS)).not.toBe(ulid(1_000, MAXES));
  });

  it("uses only Crockford base32 characters, never I L O or U", () => {
    const id = ulid(1_789_221_376_000, MAXES);
    expect(id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
    expect(id).not.toMatch(/[ILOU]/);
  });

  it("generates unique ids with real entropy", () => {
    const seen = new Set(Array.from({ length: 1_000 }, () => ulid(1_000)));
    expect(seen.size).toBe(1_000);
  });

  describe("guards", () => {
    it.each([
      ["negative", -1],
      ["fractional", 1.5],
      ["beyond 48 bits", MAX_ULID_TIME + 1],
      ["NaN", Number.NaN],
    ])("rejects a %s timestamp", (_label, value) => {
      expect(() => ulid(value, ZEROS)).toThrow(RangeError);
    });

    it("rejects short entropy rather than silently padding", () => {
      expect(() => ulid(0, new Uint8Array(4))).toThrow(RangeError);
    });
  });
});

describe("isUlid", () => {
  it("accepts a generated id", () => {
    expect(isUlid(ulid(1_789_221_376_000))).toBe(true);
  });

  it.each([
    ["too short", "0000"],
    ["too long", "0".repeat(27)],
    // Must be an id that actually CONTAINS letters — the all-zeros id is unchanged by
    // toLowerCase() and would make this case vacuous.
    ["lowercase", ulid(1_789_221_376_000, MAXES).toLowerCase()],
    ["ambiguous letter I", "I".repeat(26)],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(isUlid(value)).toBe(false);
  });
});
