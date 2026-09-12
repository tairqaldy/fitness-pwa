/**
 * Retry policy for the offline outbox. Pure — `rng` and `nowMs` are always injected.
 *
 * Two ideas do the work here.
 *
 * **Jittered exponential backoff.** Without jitter every queued op retries on the same tick, so
 * a server that just came back up is hit by the whole queue at once and knocked over again.
 * ±20% spread is enough to break that lockstep while keeping the schedule predictable enough to
 * reason about.
 *
 * **A poison cap measured in BOTH attempts and wall-clock age.** Attempts alone are not enough:
 * an op that fails, waits out a 30-minute backoff, fails again, and so on would take days to
 * exhaust 24 attempts, and in the meantime it blocks every op behind it for the same entity. The
 * 24-hour age cap is the rule that actually fires in practice.
 */

export const BACKOFF_BASE_MS = 2_000;
/** 30 minutes. Past this, waiting longer does not help; the network is not coming back sooner. */
export const BACKOFF_CAP_MS = 1_800_000;

export const POISON_ATTEMPTS = 24;
/** 24 hours. In practice this is what retires a stuck op, not the attempt count. */
export const POISON_AGE_MS = 86_400_000;

/**
 * Delay before the next attempt.
 *
 * `attempts` counts SERVER-ACKNOWLEDGED failures only — a request that never left the device
 * because it was offline is not a failure and must not advance the backoff, or an hour in a
 * basement gym would push the queue into a 30-minute wait the moment signal returns.
 */
export function nextAttemptDelayMs(attempts: number, rng: () => number = Math.random): number {
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
  // Cap the exponent before the shift so 2**1024 never becomes Infinity.
  const exponent = Math.min(safeAttempts, 40);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_CAP_MS);
  // ±20% jitter; exactly `base` when rng() === 0.5, which keeps the tests readable.
  return Math.round(base * (0.8 + 0.4 * rng()));
}

/**
 * True once an op should stop being retried and be surfaced to the user instead.
 *
 * `firstFailedAt` is null until the server has actually rejected the op once, so an op that has
 * simply never been sent can never be poisoned by age.
 */
export function isPoisoned(
  op: { attempts: number; firstFailedAt: number | null },
  nowMs: number,
): boolean {
  if (op.attempts >= POISON_ATTEMPTS) return true;
  if (op.firstFailedAt === null) return false;
  return nowMs - op.firstFailedAt >= POISON_AGE_MS;
}

export type FailureKind = "transient" | "permanent" | "auth" | "rateLimit";

/**
 * Classify a failed request so the caller knows whether to retry, re-authenticate, or give up.
 *
 * A null status means the fetch never completed (offline, DNS, TLS) — always transient.
 * 4xx is permanent because replaying a request the server has already understood and refused
 * will keep failing; the two exceptions are 401/403 (fixable by signing in again) and 408/429
 * (explicitly retryable).
 */
export function classifyFailure(info: {
  status: number | null;
  code?: string | undefined;
}): FailureKind {
  const { status } = info;
  if (status === null) return "transient";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rateLimit";
  if (status === 408) return "transient";
  if (status >= 500) return "transient";
  if (status >= 400) return "permanent";
  return "transient";
}

const RETRY_AFTER_MIN_MS = 1_000;
const RETRY_AFTER_MAX_MS = 600_000;
const RETRY_AFTER_DEFAULT_MS = 60_000;

/**
 * Parse a `Retry-After` header. Accepts both documented forms — delta-seconds and an HTTP-date —
 * and clamps the result, because a server (or a proxy) is perfectly capable of asking us to wait
 * a week, and an outbox that honours that is indistinguishable from a broken one.
 */
export function retryAfterMs(header: string | null, nowMs: number): number {
  if (header === null) return RETRY_AFTER_DEFAULT_MS;
  const trimmed = header.trim();
  if (trimmed === "") return RETRY_AFTER_DEFAULT_MS;

  const clamp = (ms: number) => Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, ms));

  // delta-seconds: digits only. `Number("12abc")` is NaN, but `parseInt` would accept it, so
  // the regex guard matters.
  if (/^\d+$/.test(trimmed)) return clamp(Number(trimmed) * 1000);

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return RETRY_AFTER_DEFAULT_MS;
  // A date in the past means "retry now", which the floor turns into the minimum wait.
  return clamp(asDate - nowMs);
}
