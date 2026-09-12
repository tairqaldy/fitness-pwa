/**
 * Conflict resolution for the sync engine. Pure.
 *
 * The model is last-write-wins on `updatedAt`, tiebroken by `rev`. That is safe here for a
 * specific reason, not by hand-waving: workout logs are effectively append-only. Two devices
 * almost never edit the SAME set row; they add different rows. The genuinely conflicting cases
 * are edits and deletes of one row from two devices, and those are what the rules below pin
 * down.
 *
 * The device clock is not trusted. A phone with a wrong clock could otherwise write a row dated
 * 2099 that no later edit can ever beat — a permanently unwritable row, with no error message.
 */

/** A year in the past. Older than this and the client clock is simply wrong, not just skewed. */
const MAX_CLOCK_LAG_MS = 365 * 24 * 60 * 60 * 1000;
/** Five minutes into the future is ordinary skew; beyond that we refuse to record it. */
const MAX_CLOCK_LEAD_MS = 300_000;

/**
 * Clamp a client-supplied timestamp into a believable window around server time.
 *
 * Clamping rather than rejecting is deliberate: a user with a misconfigured clock should still
 * be able to log a workout. They lose ordering precision, not their data.
 */
export function clampClientTime(clientMs: number, serverMs: number): number {
  if (!Number.isFinite(clientMs)) return serverMs;
  const floor = serverMs - MAX_CLOCK_LAG_MS;
  const ceiling = serverMs + MAX_CLOCK_LEAD_MS;
  return Math.min(ceiling, Math.max(floor, Math.round(clientMs)));
}

export type ResolveInput = {
  /** What the server currently holds. */
  storedUpdatedAt: number;
  storedRev: number;
  storedDeletedAt: number | null;
  /** What the client is asking for, already clamped by `clampClientTime`. */
  incomingUpdatedAt: number;
  /** The `rev` the client had when it made the edit; null for a create. */
  incomingClientRev: number | null;
  isDelete: boolean;
  isRestore: boolean;
};

export type ResolveResult = {
  action: "apply" | "conflict";
  reason: "newer" | "revTiebreak" | "stale" | "tombstoned";
};

/**
 * Decide whether an incoming patch wins.
 *
 * Rules, in order:
 *  1. A delete always wins over a concurrent edit. Losing a deletion is worse than losing an
 *     edit: the user explicitly asked for the row to go, and silently resurrecting it looks
 *     like the app is broken. A restore is an explicit undo and is likewise allowed through.
 *  2. Writing to a tombstoned row is a conflict, so a stale device cannot resurrect a set the
 *     user deleted on their phone.
 *  3. Otherwise strictly-newer wins.
 *  4. On an exact `updatedAt` tie — common when two edits land in the same millisecond, and
 *     when a device replays its own op — the higher `rev` wins. Without this the outcome would
 *     depend on arrival order, which is not deterministic.
 */
export function resolvePatch(input: ResolveInput): ResolveResult {
  const {
    storedUpdatedAt,
    storedRev,
    storedDeletedAt,
    incomingUpdatedAt,
    incomingClientRev,
    isDelete,
    isRestore,
  } = input;

  // Rule 1: an explicit delete or restore is an intent, not a value edit.
  if (isDelete || isRestore) return { action: "apply", reason: "newer" };

  // Rule 2: the row is deleted; an ordinary edit must not bring it back.
  if (storedDeletedAt !== null) return { action: "conflict", reason: "tombstoned" };

  // Rule 3.
  if (incomingUpdatedAt > storedUpdatedAt) return { action: "apply", reason: "newer" };
  if (incomingUpdatedAt < storedUpdatedAt) return { action: "conflict", reason: "stale" };

  // Rule 4: exact tie. A client that has never synced (null rev) cannot outrank a stored row.
  const clientRev = incomingClientRev ?? 0;
  return clientRev >= storedRev
    ? { action: "apply", reason: "revTiebreak" }
    : { action: "conflict", reason: "stale" };
}
