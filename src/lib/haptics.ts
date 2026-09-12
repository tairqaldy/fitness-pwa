/**
 * Haptic feedback.
 *
 * HONEST LIMITATION: the Vibration API is not supported by Safari on iOS at all — there is no
 * polyfill and no workaround from a web app. Every call here is therefore best-effort and
 * silent on failure, and no interaction may depend on a vibration being felt. On iOS the
 * corresponding feedback has to be visual (the confetti burst, a colour flash) plus, where the
 * user has granted permission, a notification.
 *
 * Patterns are deliberately short. A long buzz in a quiet gym is embarrassing, and Chrome
 * ignores patterns over a few seconds anyway.
 */

type Pattern = readonly number[];

/** A single crisp tap: a set was logged. */
export const HAPTIC_TAP: Pattern = [12];
/** Rest is over. Two pulses so it is distinguishable from a set being logged. */
export const HAPTIC_REST_DONE: Pattern = [80, 60, 80];
/** A personal record. Longer and rhythmic — this one is meant to be noticed. */
export const HAPTIC_PR: Pattern = [40, 40, 40, 40, 160];

export function vibrate(pattern: Pattern): void {
  // `navigator.vibrate` is absent on iOS Safari and may throw if the document is not focused.
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate([...pattern]);
  } catch {
    // Not worth surfacing: haptics are an enhancement, never a signal the user relies on.
  }
}

/** True when the user has asked for less motion; callers should also skip confetti. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
