/**
 * Shared types for the pure calculation layer.
 *
 * Everything here is already unit-normalised: kilograms, centimetres, kcal, epoch
 * milliseconds UTC for instants, and `'YYYY-MM-DD'` strings in `Asia/Almaty` for calendar
 * dates. Conversion happens at the UI edge (spec 03) and at the HTTP edge (Zod, spec 06),
 * never in here — a calculator that accepts two unit systems eventually gets fed the wrong one.
 *
 * `LocalDate` is deliberately a string and never a `Date`: a `Date` carries an instant, and an
 * instant silently re-derives a calendar day in whatever zone the runtime feels like. The whole
 * off-by-one class of bugs in r09 §8 comes from that re-derivation.
 */

/** The Navy body-fat equations are sex-specific and have no sex-neutral form (r09 §3). */
export type Sex = "male" | "female";

/** Warm-ups carry no tonnage and no hard-set credit; drop and failure sets carry both (r09 §8). */
export type SetType = "warmup" | "working" | "drop" | "failure";

/**
 * Which formula produced an e1RM. Persisted alongside the number, because a "PR" the user
 * disputes is undiagnosable without it, and because spec 06 gates PR confetti on it (r09 §2).
 */
export type E1rmSource = "actual_single" | "epley" | "brzycki" | "rpe";

/** `'YYYY-MM-DD'` in `Asia/Almaty`. Stored at write time, never re-derived at read time. */
export type LocalDate = string;

/** A logged set, already unit-normalised. `rpe`/`rir` are `null` when the user did not log one. */
export type CalcSet = {
  exerciseId: string;
  type: SetType;
  /** kg, `>= 0`. Zero means bodyweight — a real value, not a missing one. */
  weightKg: number;
  /** Positive integer. */
  reps: number;
  /** 6..10 in 0.5 steps, or `null`. */
  rpe: number | null;
  /** `10 - rpe`. Spec 02 designates exactly one of the two the source of truth. */
  rir: number | null;
};

/** A set carrying the Almaty calendar day it belongs to, for rolling-window aggregation. */
export type DatedSet = CalcSet & { localDate: LocalDate };

/** Per-exercise muscle credit, supplied as data by spec 08. `credit` is a fraction in `(0, 1]`. */
export type MuscleCredit = { muscle: string; credit: number };

/** `[plateKg, pairsAvailable]`. Pairs, never loose plates: 3 x 10 kg is one usable pair. */
export type PlateInventory = ReadonlyArray<readonly [number, number]>;

/** Why a plate result is what it is. The UI must be able to say *why*, so this is never `null`. */
export type PlateStatus = "EXACT" | "ROUNDED" | "BELOW_BAR" | "NO_INVENTORY";
