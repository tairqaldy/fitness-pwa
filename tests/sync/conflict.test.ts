import { describe, expect, it } from "vitest";

import { clampClientTime, resolvePatch, type ResolveInput } from "@/lib/sync/conflict";

const SERVER = 1_789_221_376_000;
const DAY = 86_400_000;

describe("clampClientTime", () => {
  it("passes an ordinary client time through unchanged", () => {
    expect(clampClientTime(SERVER - 5_000, SERVER)).toBe(SERVER - 5_000);
  });

  it("allows a few minutes of ordinary forward skew", () => {
    expect(clampClientTime(SERVER + 120_000, SERVER)).toBe(SERVER + 120_000);
  });

  it("clamps a far-future clock, which would otherwise create an unwritable row", () => {
    // A phone set to 2099 could stamp a row no later edit can ever beat under last-write-wins,
    // permanently freezing it with no error shown to anyone.
    const far = clampClientTime(SERVER + 100 * 365 * DAY, SERVER);
    expect(far).toBe(SERVER + 300_000);
  });

  it("clamps a clock more than a year behind", () => {
    expect(clampClientTime(SERVER - 5 * 365 * DAY, SERVER)).toBe(SERVER - 365 * DAY);
  });

  it("keeps data rather than rejecting it — a wrong clock loses ordering, not the workout", () => {
    expect(clampClientTime(0, SERVER)).toBe(SERVER - 365 * DAY);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("falls back to server time for %s", (_label, value) => {
    expect(clampClientTime(value, SERVER)).toBe(SERVER);
  });
});

function anInput(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    storedUpdatedAt: SERVER,
    storedRev: 3,
    storedDeletedAt: null,
    incomingUpdatedAt: SERVER + 1_000,
    incomingClientRev: 3,
    isDelete: false,
    isRestore: false,
    ...over,
  };
}

describe("resolvePatch", () => {
  it("applies a strictly newer edit", () => {
    expect(resolvePatch(anInput())).toEqual({ action: "apply", reason: "newer" });
  });

  it("rejects a stale edit", () => {
    expect(resolvePatch(anInput({ incomingUpdatedAt: SERVER - 1_000 }))).toEqual({
      action: "conflict",
      reason: "stale",
    });
  });

  describe("deletes", () => {
    it("wins even when older than the stored row", () => {
      // Losing a deletion is worse than losing an edit: the user explicitly asked for the row
      // to go, and resurrecting it looks like the app is broken.
      expect(resolvePatch(anInput({ isDelete: true, incomingUpdatedAt: SERVER - 60_000 }))).toEqual(
        { action: "apply", reason: "newer" },
      );
    });

    it("lets an explicit restore through as an undo", () => {
      expect(
        resolvePatch(anInput({ isRestore: true, storedDeletedAt: SERVER, incomingUpdatedAt: 0 })),
      ).toEqual({ action: "apply", reason: "newer" });
    });
  });

  describe("tombstones", () => {
    it("refuses an ordinary edit to a deleted row, even a newer one", () => {
      // A stale device must not resurrect a set the user deleted on their phone.
      expect(
        resolvePatch(anInput({ storedDeletedAt: SERVER, incomingUpdatedAt: SERVER + 10_000 })),
      ).toEqual({ action: "conflict", reason: "tombstoned" });
    });
  });

  describe("exact updatedAt ties", () => {
    it("lets the higher rev win, so the outcome does not depend on arrival order", () => {
      expect(resolvePatch(anInput({ incomingUpdatedAt: SERVER, incomingClientRev: 4 }))).toEqual({
        action: "apply",
        reason: "revTiebreak",
      });
    });

    it("applies an equal rev — this is a device replaying its own op", () => {
      expect(resolvePatch(anInput({ incomingUpdatedAt: SERVER, incomingClientRev: 3 }))).toEqual({
        action: "apply",
        reason: "revTiebreak",
      });
    });

    it("rejects a lower rev", () => {
      expect(resolvePatch(anInput({ incomingUpdatedAt: SERVER, incomingClientRev: 1 }))).toEqual({
        action: "conflict",
        reason: "stale",
      });
    });

    it("treats a never-synced client (null rev) as rev 0, which cannot outrank a stored row", () => {
      expect(resolvePatch(anInput({ incomingUpdatedAt: SERVER, incomingClientRev: null }))).toEqual(
        { action: "conflict", reason: "stale" },
      );
    });

    it("lets a null rev win against a rev-0 stored row", () => {
      expect(
        resolvePatch(anInput({ incomingUpdatedAt: SERVER, incomingClientRev: null, storedRev: 0 })),
      ).toEqual({ action: "apply", reason: "revTiebreak" });
    });
  });

  it("is deterministic: the same input always resolves the same way", () => {
    const input = anInput({ incomingUpdatedAt: SERVER, incomingClientRev: 3 });
    const runs = Array.from({ length: 5 }, () => resolvePatch(input));
    expect(new Set(runs.map((r) => `${r.action}:${r.reason}`)).size).toBe(1);
  });
});
