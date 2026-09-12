/**
 * The exercise library: one catalogue table plus its two rebuildable satellites.
 *
 * **One `exercises` table holds both seeded and user-created rows.** The obvious alternative —
 * `exercises_catalog` + `exercises_custom` — was rejected because every `sets.exercise_id` FK,
 * every equipment filter, the fuzzy search and the import matcher would each need a UNION, and a
 * UNION cannot be indexed. `source` plus the id prefix gives the split's isolation without the
 * join cost: re-seed statements only ever touch `WHERE source = 'free-exercise-db'`.
 *
 * That is also why `id` is not a bare ULID here (the one deliberate deviation from rule 1, along
 * with the singletons): a seeded row's id is `'fedb:<dataset id>'`, which makes re-seeding a
 * deterministic `ON CONFLICT(id) DO UPDATE` with no lookup table, and a user row's id is
 * `'usr:<ULID>'`. Both are text, both are stable, and the prefix is readable in a FK column.
 *
 * `exercise_muscles` and `exercise_media` carry **no** `syncCols()` and are the only tables in
 * this module exempt from soft delete: they are derived from the dataset, hold no user data, and
 * are wiped and re-inserted on every re-seed. Giving them `deleted_at` would make a re-seed fight
 * the sync protocol for no gain.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { bool, fk, jsonCol, pk, syncCols } from "../columns";
import {
  EQUIPMENT,
  EX_CATEGORY,
  EX_FORCE,
  EX_LEVEL,
  EX_MECHANIC,
  LOAD_MODE,
  MUSCLES,
  MUSCLE_ROLES,
} from "../enums";

/**
 * `'a', 'b', 'c'` for a CHECK's `IN` list, derived from the frozen tuple so the DDL and the Zod
 * enum can never drift apart. `sql.raw` because a bound parameter cannot appear in DDL.
 *
 * Only the domains frozen by the external dataset get a CHECK (rule 13). App-owned enums that are
 * expected to grow — `load_mode`, `set_type`, `pr_kinds` — are Zod-only, because SQLite cannot
 * `ALTER TABLE ADD CONSTRAINT` and adding one later means the recreate described in `core.ts`.
 */
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const exercises = sqliteTable(
  "exercises",
  {
    id: pk(),
    /** `free-exercise-db` for a seeded row, `user` for one the user created. */
    source: text("source", { enum: ["free-exercise-db", "user"] }).notNull(),
    /** The upstream record id. NULL for user rows, which is why the unique below is composite. */
    sourceId: text("source_id"),
    /** The pinned dataset commit a seeded row came from, so a re-seed is auditable. */
    sourceCommit: text("source_commit"),
    name: text("name").notNull(),
    nameRu: text("name_ru"),
    slug: text("slug").notNull(),
    force: text("force", { enum: EX_FORCE }),
    level: text("level", { enum: EX_LEVEL }).notNull(),
    /** Nullable, like `force`: 87 of 876 dataset records state no mechanic. */
    mechanic: text("mechanic", { enum: EX_MECHANIC }),
    equipment: text("equipment", { enum: EQUIPMENT }).notNull(),
    category: text("category", { enum: EX_CATEGORY }).notNull(),
    /**
     * Seeded heuristically and therefore **expected** to be corrected by the user. Editing it is
     * a first-class mutation that recomputes `sets.e1rm_kg` and `sets.e1rm_source` for every
     * non-deleted set of this exercise and re-runs PR detection (rule 33) — because rule 10 makes
     * e1RM depend on `load_mode` while rule 9 freezes the number at write time.
     */
    loadMode: text("load_mode", { enum: LOAD_MODE }).notNull().default("external"),
    /** `string[]`, one entry per step. 5 of 876 dataset records ship an empty array. */
    instructionsJson: jsonCol("instructions_json").notNull().default("[]"),
    /**
     * The dataset ships images with no stated licence, so the default is the honest value rather
     * than a guess; the column exists so a future re-licensed or self-shot image can say so.
     */
    imageLicence: text("image_licence").notNull().default("unknown-third-party"),
    isFavourite: bool("is_favourite").notNull().default(false),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex("exercises_slug_uq").on(t.slug),
    /**
     * Composite, not `U(source_id)`: SQLite treats NULLs as distinct in a UNIQUE index, so user
     * rows (whose `source_id` is NULL) do not collide with each other, while two seeded rows
     * claiming the same upstream id do.
     */
    uniqueIndex("exercises_source_source_id_uq").on(t.source, t.sourceId),
    index("exercises_equipment_idx").on(t.equipment),
    index("exercises_updated_at_id_idx").on(t.updatedAt, t.id),
    check("exercises_equipment_domain", sql`${t.equipment} IN (${inList(EQUIPMENT)})`),
    check("exercises_category_domain", sql`${t.category} IN (${inList(EX_CATEGORY)})`),
    check("exercises_level_domain", sql`${t.level} IN (${inList(EX_LEVEL)})`),
    check(
      "exercises_instructions_json_bytes",
      sql`length(CAST(${t.instructionsJson} AS BLOB)) <= 65536`,
    ),
  ],
);

/**
 * Which muscles an exercise works, and in what role. The many-to-many the volume heatmap reads.
 *
 * The PK is `(exercise_id, muscle, role)` rather than a surrogate id because the row IS its
 * identity — there is no second fact to record about "bench press works chest as primary" — and a
 * natural PK makes the re-seed delete-and-reinsert idempotent without a lookup.
 */
export const exerciseMuscles = sqliteTable(
  "exercise_muscles",
  {
    exerciseId: fk("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    muscle: text("muscle", { enum: MUSCLES }).notNull(),
    role: text("role", { enum: MUSCLE_ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exerciseId, t.muscle, t.role] }),
    /**
     * The muscle drill-down ("tap a muscle, see the exercises"). Leading with `muscle` is the
     * whole point: the PK already serves `WHERE exercise_id = ?`, and this index serves the
     * opposite direction as a covering scan.
     */
    index("exercise_muscles_muscle_role_exercise_id_idx").on(t.muscle, t.role, t.exerciseId),
    check("exercise_muscles_muscle_domain", sql`${t.muscle} IN (${inList(MUSCLES)})`),
    check("exercise_muscles_role_domain", sql`${t.role} IN (${inList(MUSCLE_ROLES)})`),
  ],
);

/**
 * Up to four images per exercise, stored in R2 and referenced by key. Never the bytes: D1's row
 * limit is 2 MB and a single photo would blow it.
 *
 * `sha256` and `bytes` exist so a re-seed can skip an unchanged object instead of re-uploading
 * 1746 images, and so a corrupted upload is detectable without fetching the object.
 */
export const exerciseMedia = sqliteTable(
  "exercise_media",
  {
    exerciseId: fk("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    /** 0-based ordinal within the exercise. Explicit, because R2 has no ordering. */
    idx: integer("idx").notNull(),
    r2Key: text("r2_key").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exerciseId, t.idx] }),
    /** Keys are never reused — a re-crop mints a new one — which is what licenses `immutable`. */
    uniqueIndex("exercise_media_r2_key_uq").on(t.r2Key),
    check("exercise_media_idx_range", sql`${t.idx} BETWEEN 0 AND 3`),
  ],
);

export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;
export type ExerciseMuscle = typeof exerciseMuscles.$inferSelect;
export type NewExerciseMuscle = typeof exerciseMuscles.$inferInsert;
export type ExerciseMedium = typeof exerciseMedia.$inferSelect;
export type NewExerciseMedium = typeof exerciseMedia.$inferInsert;
