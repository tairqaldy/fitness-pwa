/**
 * The canonical D1 schema, as one module.
 *
 * This file is a **barrel and nothing else**. It is the single path `drizzle.config.ts` and
 * `drizzle({ schema })` read, so every table has to be reachable from here or drizzle-kit will
 * decide the table was deleted and generate a `DROP TABLE` for it. The tables themselves live in
 * `./schema/*.ts`, grouped by the feature that owns them:
 *
 *  - `core`     — `users`, `settings`, `credentials`, `sessions`, `cron_runs`, `schema_meta`.
 *                 Already shipped in migrations 0000/0001 and carried forward verbatim; read that
 *                 file's header before touching it, because a cosmetic edit there deletes rows.
 *  - `library`  — `exercises`, `exercise_muscles`, `exercise_media`.
 *  - `workouts` — `workouts`, `workout_exercises`, `sets`, `personal_records`.
 *
 * Splitting the file must generate **no** migration: `export *` changes nothing drizzle-kit can
 * see, so `drizzle-kit generate` on the move alone reports "No schema changes".
 *
 * Shared building blocks are deliberately NOT re-exported here — importers take them from their
 * own modules, so that `import * as schema from "@/db/schema"` contains tables and row types only
 * and drizzle's relational layer has nothing extra to walk:
 *  - `@/db/columns` — the column factories every new table is built from.
 *  - `@/db/enums`   — the frozen enum tuples and their derived unions.
 *  - `@/db/json`    — the only place a JSON column is parsed or serialised (rule 6).
 */
export * from "./schema/core";
export * from "./schema/library";
export * from "./schema/workouts";
