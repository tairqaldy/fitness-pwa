/**
 * The barrel. `@/lib/calc` is the only import path callers use.
 *
 * One entry point matters here for a reason beyond tidiness: the same arithmetic runs server-side in
 * the weekly Cron batch and client-side when spec 05's Dexie queue replays queued sets after a
 * sync. Both must agree bit-for-bit, so there is exactly one implementation of each formula and no
 * ambient time or locale anywhere inside it.
 *
 * `energy` is deliberately absent below: `tdee` re-exports it, so the prior-computing functions are
 * reachable as `@/lib/calc`, `@/lib/calc/tdee`, and `@/lib/calc/energy` without a duplicate star
 * export.
 */

export * from "./bodyfat";
export * from "./constants";
export * from "./e1rm";
export * from "./num";
export * from "./plates";
export * from "./round";
export * from "./rpe";
export * from "./tdee";
export * from "./time";
export * from "./trend";
export * from "./types";
export * from "./volume";
export * from "./warmup";
