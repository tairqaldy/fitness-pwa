/**
 * Workout logging: the write-hot path and the only history in the app that cannot be recomputed.
 *
 * Four tables, and the middle one exists for a reason that is easy to miss:
 *
 *     workouts ──< workout_exercises ──< sets
 *                        │                │
 *                   exercises ────────────┘
 *     personal_records ──> exercises, sets
 *
 * **`workout_exercises` is not a join table for tidiness.** Without it, "3×5 bench, then squats,
 * then bench again for a back-off set" is unrepresentable, and a superset cannot be first-class:
 * both need a per-workout *occurrence* of an exercise that carries its own position and target.
 * `sets` still denormalises `workout_id`, `exercise_id` and `local_day` off it, because every
 * analytics query filters on those and a three-table join per set on the dashboard is not worth
 * the normal form.
 *
 * **Rest is data, never a pseudo-row.** `sets.rest_after_sec` records it. A "rest row" in `sets`
 * would corrupt every `count(*)`, every volume sum and every `position` sequence.
 *
 * **Every FK here is `onDelete: "restrict"`, and that is load-bearing.** `wrangler d1 migrations
 * apply` runs a file as one transaction, where `PRAGMA foreign_keys=OFF` is a documented no-op,
 * and `DROP TABLE` performs an implicit `DELETE FROM` that *does* fire ON DELETE actions. Under
 * `cascade`, drizzle-kit's 12-step recreate of `workouts` would therefore silently delete every
 * set while reporting success (r02 §4.1, reproduced: 3 → 0). Under `restrict` the same implicit
 * delete raises a FK violation and the whole migration rolls back. Any future migration that
 * recreates one of these tables will fail, loudly, which is the intended outcome — it has to be
 * hand-written instead.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { bool, fk, jsonCol, kg, localDay, pk, syncCols, ts } from "../columns";
import { E1RM_SOURCES, PR_KINDS, SET_TYPES } from "../enums";
import { exercises } from "./library";
import { users } from "./core";

/** `'YYYY-MM-DD'`. Written into every CHECK rather than shared, so the DDL is greppable. */
const DAY_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";

export const workouts = sqliteTable(
  "workouts",
  {
    id: pk(),
    userId: fk("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Asia/Almaty calendar day, computed by `toLocalDay()` at write time. Never derived in SQL. */
    localDay: localDay().notNull(),
    startedAt: ts("started_at").notNull(),
    /** NULL while the workout is in progress. The "is there a live session" predicate. */
    endedAt: ts("ended_at"),
    durationSec: integer("duration_sec"),
    title: text("title"),
    notes: text("notes"),
    /**
     * Bodyweight at the time of the session, snapshotted. Without it a bodyweight-exercise e1RM is
     * meaningless a year later, because the load was the user's mass on that day, not today's.
     */
    bodyweightKg: kg("bodyweight_kg"),
    /** Both derived at finish, from the session's sets. Stored so the feed is one read. */
    volumeKg: kg("volume_kg"),
    hardSets: integer("hard_sets"),
    /**
     * Geofence outcome only. There is **no coordinate column here, ever**: distance is computed in
     * the browser, the bucket is a text label, and the single coordinate in this database is the
     * one overwritable `gym_geofence` row. Rule 11 guarantees that a later migration to drop a
     * coordinate column from this table — the most FK-encumbered one in the schema — would fail,
     * so declining to add it now is the only chance to decline.
     */
    gymWithinGeofence: bool("gym_within_geofence"),
    gymDistanceBucket: text("gym_distance_bucket"),
    /**
     * Stable per-source key for an imported session, so re-applying the same export file is a
     * no-op instead of a duplicate history. NULL for sessions logged in this app.
     */
    importKey: text("import_key"),
    ...syncCols(),
  },
  (t) => [
    /**
     * P1 (date-range feed) and P2 (calendar heatmap). `deleted_at` is a trailing column purely to
     * keep the plan on `USING COVERING INDEX` once rule 25's mandatory `AND deleted_at IS NULL` is
     * applied — measured: without it the plan degrades to plain `USING INDEX`, and making the
     * index partial instead does NOT restore the covering property.
     */
    index("workouts_local_day_idx").on(t.localDay, t.deletedAt),
    index("workouts_started_at_idx").on(t.startedAt),
    uniqueIndex("workouts_import_key_uq").on(t.importKey),
    /** P12, the sync pull. Composite because a finish-workout batch shares one millisecond. */
    index("workouts_updated_at_id_idx").on(t.updatedAt, t.id),
    check("workouts_local_day_fmt", sql`${t.localDay} GLOB '${sql.raw(DAY_GLOB)}'`),
  ],
);

/**
 * One occurrence of an exercise inside one workout. See the module header for why this is not
 * redundant with `sets.exercise_id`.
 *
 * `position` is 0-based, dense and **explicit** — never row order. SQLite makes no promise about
 * the order of an unordered `SELECT`, and the user drags these around.
 *
 * `superset_group` is an integer scoped to THIS workout: two entries sharing a value are performed
 * back to back. It is not a FK to anything, because a superset has no existence outside the
 * session it happened in.
 */
export const workoutExercises = sqliteTable(
  "workout_exercises",
  {
    id: pk(),
    workoutId: fk("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "restrict" }),
    exerciseId: fk("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    supersetGroup: integer("superset_group"),
    targetSets: integer("target_sets"),
    targetRepsLow: integer("target_reps_low"),
    targetRepsHigh: integer("target_reps_high"),
    notes: text("notes"),
    ...syncCols(),
  },
  (t) => [
    /** Makes a replayed offline write a no-op rather than a duplicate row at the same slot. */
    uniqueIndex("workout_exercises_workout_id_position_uq").on(t.workoutId, t.position),
    index("workout_exercises_workout_id_idx").on(t.workoutId),
    index("workout_exercises_exercise_id_idx").on(t.exerciseId),
    index("workout_exercises_updated_at_id_idx").on(t.updatedAt, t.id),
  ],
);

/**
 * The logged set. 25 columns — which is a budget, not trivia: a parameterised multi-row INSERT
 * caps at `floor(100 / columnCount)` bound parameters per statement on D1, so **4 rows** per
 * statement here, not the ~250 a reading of the 100 KB limit suggests. Bulk paths use literal SQL.
 * (`import_batch_id` is not yet declared; when `15-data-portability.md` adds it the cap drops
 * to 3, and the bound-params test has to be re-asserted.)
 *
 * Three columns carry the module's subtlest decisions:
 *
 *  - **`assist_kg` is assistance, not load.** An assisted pull-up machine displays the weight it
 *    takes *off* you. Folding it into `weight_kg` inverts the entire progression: the user gets
 *    stronger and the chart goes down.
 *  - **`e1rm_kg` is `NULL`, never `0`, whenever the number would be dishonest** — `reps > 12`,
 *    `reps < 1`, `reps >= 37` (Brzycki's pole, which yields `Infinity` and poisons every `max()`
 *    for that lift permanently), `load_mode ∈ {duration, distance}`, or effective load ≤ 0.
 *    `sets_e1rm_finite` is the database backstop against an `Infinity` or a negative landing here.
 *  - **`e1rm_source` is NULL exactly when `e1rm_kg` is**, enforced by `sets_e1rm_source_paired`.
 *    The composite e1RM is `max(Epley, Brzycki, RPE-table)` — three epistemically different
 *    estimators — so without the label a PR the user disputes is undiagnosable.
 */
export const sets = sqliteTable(
  "sets",
  {
    id: pk(),
    workoutId: fk("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "restrict" }),
    workoutExerciseId: fk("workout_exercise_id")
      .notNull()
      .references(() => workoutExercises.id, { onDelete: "restrict" }),
    exerciseId: fk("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    /** Denormalised from the workout. Every date-range query reads it, never `started_at`. */
    localDay: localDay().notNull(),
    /** 0-based within the `workout_exercise`, dense. */
    position: integer("position").notNull(),
    setType: text("set_type", { enum: SET_TYPES }).notNull(),
    /** External load. NULL for a pure bodyweight set — which is different from `0`. */
    weightKg: kg("weight_kg"),
    /** Assistance removed by the machine. See the doc comment above. */
    assistKg: kg("assist_kg"),
    reps: integer("reps"),
    /** 0.5 steps. `6.5` is real logged data, so this cannot be an integer. */
    rpe: real("rpe"),
    /** `10 − rpe`. Stored because the user may log either one and neither is derivable offline. */
    rir: real("rir"),
    distanceM: real("distance_m"),
    durationSec: integer("duration_sec"),
    restAfterSec: integer("rest_after_sec"),
    supersetRound: integer("superset_round"),
    e1rmKg: kg("e1rm_kg"),
    e1rmSource: text("e1rm_source", { enum: E1RM_SOURCES }),
    isPr: bool("is_pr").notNull().default(false),
    /** `PR_KINDS[]` when `is_pr`, else NULL. Read through `src/db/json.ts`, never by drizzle. */
    prKindsJson: jsonCol("pr_kinds_json"),
    completedAt: ts("completed_at").notNull(),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex("sets_workout_exercise_id_position_uq").on(t.workoutExerciseId, t.position),
    /**
     * COVERING for P3 (per-exercise history / previous-set ghosting) and P4 (the e1RM curve).
     * `weight_kg, reps, e1rm_kg` are the projected columns and `deleted_at` is trailing purely so
     * rule 25's mandatory `AND deleted_at IS NULL` does not strip the covering property. Neither
     * appears in the index name, which is named after what the query *searches* on.
     */
    index("sets_exercise_id_completed_at_idx").on(
      t.exerciseId,
      t.completedAt,
      t.weightKg,
      t.reps,
      t.e1rmKg,
      t.deletedAt,
    ),
    /** P5: rolling-7-day volume per muscle, joined to `exercise_muscles` on `exercise_id`. */
    index("sets_local_day_exercise_id_idx").on(t.localDay, t.exerciseId, t.deletedAt),
    /** P9: session detail reads the sets of a workout directly, without the join. */
    index("sets_workout_id_idx").on(t.workoutId),
    /**
     * P8, the PR feed. Partial: PR sets are a tiny fraction of the table, so the index stays small
     * on the write-hot path. Named for its predicate rather than its column — the one index in
     * this module whose name is not its leading column, and allow-listed in the naming test.
     */
    index("sets_is_pr_idx")
      .on(t.completedAt)
      .where(sql`is_pr = 1 AND deleted_at IS NULL`),
    index("sets_updated_at_id_idx").on(t.updatedAt, t.id),
    check("sets_reps_sane", sql`${t.reps} IS NULL OR (${t.reps} >= 0 AND ${t.reps} <= 500)`),
    check("sets_weight_sane", sql`${t.weightKg} IS NULL OR (${t.weightKg} BETWEEN 0 AND 1000)`),
    check("sets_e1rm_finite", sql`${t.e1rmKg} IS NULL OR (${t.e1rmKg} > 0 AND ${t.e1rmKg} < 2000)`),
    check("sets_rpe_range", sql`${t.rpe} IS NULL OR (${t.rpe} BETWEEN 1 AND 10)`),
    /** Rule 10: a stored e1RM without its estimator is an undiagnosable number. */
    check("sets_e1rm_source_paired", sql`(${t.e1rmKg} IS NULL) = (${t.e1rmSource} IS NULL)`),
    check("sets_local_day_fmt", sql`${t.localDay} GLOB '${sql.raw(DAY_GLOB)}'`),
  ],
);

/**
 * Personal-record history. Append-only: a new best inserts a row and clears the old row's flag in
 * one `db.batch()`; nothing is ever updated in place, so "what was my best in March" stays
 * answerable.
 *
 * **`origin_key` is the replay guard, not `set_id`.** `set_id` is nullable and SQLite treats NULLs
 * as distinct in a UNIQUE index, so `U(set_id, kind)` guards nothing for an imported history row,
 * a manual entry, or an aggregate `session_volume` PR — a re-applied import could insert unlimited
 * duplicates. `origin_key` is NOT NULL: the set id when there is one, otherwise
 * `'<source>:<import_key>'` or `'manual:<ULID>'`. `set_id` stays, nullable, purely as the FK that
 * makes a PR tappable through to the set that earned it.
 *
 * PR detection compares with an epsilon, never a bare `>` — `candidate > best + 0.01` for the
 * kilogram kinds, exact integer equality for `max_reps` — because sums and e1RM are not exact in
 * binary64 and a bare comparison flaps on noise.
 */
export const personalRecords = sqliteTable(
  "personal_records",
  {
    id: pk(),
    exerciseId: fk("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: PR_KINDS }).notNull(),
    /** Kilograms for every kind except `max_reps`, where it is a rep count. */
    value: real("value").notNull(),
    /** The reps that produced an `e1rm` or `max_weight` PR, so the row is explainable. */
    repsAtValue: integer("reps_at_value"),
    setId: fk("set_id").references(() => sets.id, { onDelete: "restrict" }),
    originKey: text("origin_key").notNull(),
    localDay: localDay().notNull(),
    achievedAt: ts("achieved_at").notNull(),
    isCurrent: bool("is_current").notNull().default(true),
    supersededAt: ts("superseded_at"),
    ...syncCols(),
  },
  (t) => [
    /** The replay guard. See the doc comment above for why it is not `(set_id, kind)`. */
    uniqueIndex("personal_records_origin_key_kind_uq").on(t.originKey, t.kind),
    /**
     * P7: makes "exactly one current best per exercise per kind" a database guarantee rather than
     * an application convention. Partial, so superseded history rows do not collide with it.
     */
    uniqueIndex("personal_records_exercise_id_kind_uq")
      .on(t.exerciseId, t.kind)
      .where(sql`is_current = 1`),
    /** P8: the reverse-chronological PR feed. */
    index("personal_records_achieved_at_idx").on(t.achievedAt),
    index("personal_records_exercise_id_kind_achieved_at_idx").on(
      t.exerciseId,
      t.kind,
      t.achievedAt,
    ),
    index("personal_records_updated_at_id_idx").on(t.updatedAt, t.id),
    check("personal_records_local_day_fmt", sql`${t.localDay} GLOB '${sql.raw(DAY_GLOB)}'`),
  ],
);

export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;
export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type NewWorkoutExercise = typeof workoutExercises.$inferInsert;
/** Named `WorkoutSet`, not `Set`: shadowing the global `Set` in every importer is not worth it. */
export type WorkoutSet = typeof sets.$inferSelect;
export type NewWorkoutSet = typeof sets.$inferInsert;
export type PersonalRecord = typeof personalRecords.$inferSelect;
export type NewPersonalRecord = typeof personalRecords.$inferInsert;
