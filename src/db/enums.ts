/**
 * Frozen `as const` tuples and the TS unions derived from them.
 *
 * Two different kinds of tuple live here and they are NOT interchangeable:
 *
 *  1. **Measured domains of an external dataset** — `MUSCLES`, `EQUIPMENT`, `EX_CATEGORY`,
 *     `EX_LEVEL`, `EX_FORCE`, `EX_MECHANIC`, `MUSCLE_ROLES`. These are the exact distinct value
 *     sets of free-exercise-db @a859101d (876 records), counted, not guessed. They carry a SQL
 *     `CHECK` as well as a Zod enum, because a new upstream muscle must **throw** at seed time
 *     rather than default to something plausible (rule 24). Adding a value to one of these is a
 *     migration, and on a table with inbound FKs that migration is a recreate — so it is a
 *     decision, not a typo fix.
 *  2. **App-owned domains likely to grow** — `LOAD_MODE`, `SET_TYPES`, `E1RM_SOURCES`, `PR_KINDS`.
 *     These are validated by Zod at the write boundary ONLY, with no SQL CHECK, precisely so that
 *     adding a value later is a code change instead of a table recreate (rule 13). SQLite cannot
 *     `ALTER TABLE ADD CONSTRAINT`, so a CHECK must be in a table's first migration or never.
 *
 * `text(col, { enum })` in the schema is type-level only and emits no DDL. Where a CHECK is
 * wanted, both have to be written; where it is not, the `{ enum }` is the whole enforcement.
 */

/**
 * The 17 muscle keys, 1:1 with the dataset. There is deliberately no anterior/lateral/posterior
 * deltoid split: the dataset has none, so an extra key would be permanently un-populatable, and
 * every dashboard would show an empty row for it. r09's `front_delts` maps to `shoulders`.
 */
export const MUSCLES = [
  "abdominals",
  "abductors",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "forearms",
  "glutes",
  "hamstrings",
  "lats",
  "lower_back",
  "middle_back",
  "neck",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const;

/** 13 values. `'unknown'` is the dataset's null equipment (77 records), made explicit. */
export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "ez_bar",
  "cable",
  "machine",
  "kettlebell",
  "resistance_band",
  "medicine_ball",
  "exercise_ball",
  "foam_roller",
  "bodyweight",
  "other",
  "unknown",
] as const;

export const EX_CATEGORY = [
  "strength",
  "stretching",
  "plyometrics",
  "powerlifting",
  "olympic_weightlifting",
  "strongman",
  "cardio",
] as const;

export const MUSCLE_ROLES = ["primary", "secondary"] as const;

export const EX_LEVEL = ["beginner", "intermediate", "expert"] as const;

/** Nullable in the dataset: 30 of 876 records have no `force`. */
export const EX_FORCE = ["push", "pull", "static"] as const;

/** Nullable in the dataset: 87 of 876 records have no `mechanic`. */
export const EX_MECHANIC = ["compound", "isolation"] as const;

/**
 * Ours, not the dataset's. Seeded heuristically and therefore **expected** to be user-edited,
 * which is why editing it is a first-class mutation that recomputes stored e1RM (rule 33).
 *
 * `bodyweight_plus` adds external load to bodyweight; `assisted` SUBTRACTS it, because an
 * assisted machine displays assistance — folding that into `weight_kg` inverts the progression.
 */
export const LOAD_MODE = [
  "external",
  "bodyweight",
  "bodyweight_plus",
  "assisted",
  "duration",
  "distance",
] as const;

/**
 * Set kinds. Zod-only, no SQL CHECK (rule 13) — this list grows.
 *
 * NOTE: `src/lib/calc/types.ts` has its own narrower `SetType` (`warmup|working|drop|failure`)
 * because the volume rules are only defined for those four. This tuple is the storage domain and
 * is a strict superset; a calculator taking an `'amrap'` set is 07's decision to make, not a
 * reason to drop the value from the database.
 */
export const SET_TYPES = ["warmup", "working", "drop", "failure", "amrap"] as const;

/**
 * Which estimator produced `sets.e1rm_kg`. Stored WITH the number, because the brief's e1RM is
 * `max(Epley, Brzycki, RPE-table)` — three epistemically different estimators — and without the
 * label a "PR" the user disputes is undiagnosable. `actual_single` means no estimation happened.
 */
export const E1RM_SOURCES = ["actual_single", "epley", "brzycki", "rpe"] as const;

export const PR_KINDS = ["e1rm", "max_weight", "max_reps", "session_volume"] as const;

export type Muscle = (typeof MUSCLES)[number];
export type Equipment = (typeof EQUIPMENT)[number];
export type ExCategory = (typeof EX_CATEGORY)[number];
export type MuscleRole = (typeof MUSCLE_ROLES)[number];
export type ExLevel = (typeof EX_LEVEL)[number];
export type ExForce = (typeof EX_FORCE)[number];
export type ExMechanic = (typeof EX_MECHANIC)[number];
export type LoadMode = (typeof LOAD_MODE)[number];
export type StoredSetType = (typeof SET_TYPES)[number];
export type E1rmSourceName = (typeof E1RM_SOURCES)[number];
export type PrKind = (typeof PR_KINDS)[number];
