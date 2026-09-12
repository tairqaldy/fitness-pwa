/**
 * Rest-timer arithmetic.
 *
 * **The timer is a deadline, never a countdown that ticks.** A `setInterval` that decrements a
 * counter is wrong on a phone: the moment the screen locks or the app is backgrounded, timers
 * are throttled to once a minute or frozen outright, and the user comes back to a timer that
 * says 40 s left when 3 minutes have passed. Storing the absolute `deadlineAtMs` and deriving
 * the remaining time from the current clock on every paint makes backgrounding a non-event —
 * the interval only drives repaints, never the value.
 *
 * Everything here is pure and takes `nowMs` explicitly.
 */

/** A running or finished rest period. */
export type RestTimer = {
  /** When the timer was started, epoch ms. Kept for analytics and for "add 30s" arithmetic. */
  startedAtMs: number;
  /** Absolute instant the rest ends, epoch ms. THE source of truth. */
  deadlineAtMs: number;
};

export function startRestTimer(nowMs: number, durationSec: number): RestTimer {
  if (!Number.isFinite(durationSec) || durationSec < 0) {
    throw new RangeError(`rest timer: invalid duration ${durationSec}`);
  }
  return { startedAtMs: nowMs, deadlineAtMs: nowMs + Math.round(durationSec * 1000) };
}

/**
 * Milliseconds left, clamped at zero.
 *
 * Never negative: an overrun is reported as 0 remaining plus a separate `overrunMs`, so the UI
 * can say "+1:20 over" without every consumer having to guard a negative.
 */
export function remainingMs(timer: RestTimer, nowMs: number): number {
  return Math.max(0, timer.deadlineAtMs - nowMs);
}

export function overrunMs(timer: RestTimer, nowMs: number): number {
  return Math.max(0, nowMs - timer.deadlineAtMs);
}

export function isElapsed(timer: RestTimer, nowMs: number): boolean {
  return nowMs >= timer.deadlineAtMs;
}

/** Shift the deadline. Negative trims; the deadline never moves before the start instant. */
export function adjustRestTimer(timer: RestTimer, deltaSec: number): RestTimer {
  const shifted = timer.deadlineAtMs + Math.round(deltaSec * 1000);
  return { ...timer, deadlineAtMs: Math.max(timer.startedAtMs, shifted) };
}

/** Total planned rest, in whole seconds. */
export function plannedSec(timer: RestTimer): number {
  return Math.round((timer.deadlineAtMs - timer.startedAtMs) / 1000);
}

/**
 * Fraction elapsed, 0..1, for a progress ring. Returns 1 for a zero-length timer rather than
 * dividing by zero.
 */
export function progress(timer: RestTimer, nowMs: number): number {
  const total = timer.deadlineAtMs - timer.startedAtMs;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - timer.startedAtMs) / total));
}

/**
 * `M:SS`, or `MM:SS` past ten minutes. Rounds UP, so a timer started at 90 s reads "1:30"
 * immediately rather than flashing "1:29" — a counter that appears to skip its first second
 * looks broken.
 */
export function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Rest presets offered in the UI, in seconds. Chosen to match how people actually rest:
 * short for isolation, 2-3 min for compounds, 5 for heavy singles.
 */
export const REST_PRESETS_SEC = [60, 90, 120, 180, 300] as const;

/** Clamp a user-entered rest duration to something sane. */
export const MIN_REST_SEC = 5;
export const MAX_REST_SEC = 60 * 60;

export function clampRestSec(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_REST_SEC;
  return Math.min(MAX_REST_SEC, Math.max(MIN_REST_SEC, Math.round(seconds)));
}
