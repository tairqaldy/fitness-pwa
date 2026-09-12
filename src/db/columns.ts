/**
 * Column factories. Every table in `src/db/schema/**` is built from these and nothing else.
 *
 * The point is not brevity — it is that a convention written once cannot be half-applied. Each
 * factory below encodes a decision from `specs/02-data-model.md` that has already gone wrong in
 * some other codebase:
 *
 *  - `ts()` is ALWAYS `mode: "timestamp_ms"`. `mode: "timestamp"` does
 *    `Math.floor(unix / 1e3)` inside drizzle's driver mapping (verified in
 *    `drizzle-orm/sqlite-core/columns/integer.js`), so a rest timer loses its sub-second part and
 *    mixing the two modes across tables is a guaranteed off-by-1000. There is deliberately no
 *    second-precision factory here to reach for.
 *  - `localDay()` is `text`, never derived from a UTC epoch in SQL. Almaty is UTC+5, so local
 *    00:00–05:00 belongs to the *previous* UTC date; deriving it in SQL drops a day from the
 *    streak and mis-buckets the heatmap (r09 §8 calls this the highest-risk analytics bug).
 *  - `jsonCol()` is plain `text`, NOT `text({ mode: "json" })`. `SQLiteTextJson.mapFromDriverValue`
 *    calls `JSON.parse` inside drizzle's result mapping, so one malformed row throws and takes the
 *    entire `SELECT` with it — the raw text is unreachable by the time app code runs, which is the
 *    exact opposite of the degraded-row promise. Reads go through `src/db/json.ts` (rule 6).
 *  - `syncCols()` returns FRESH builders on every call. Sharing one object across two tables
 *    shares the underlying column builders, which drizzle then binds to whichever table won the
 *    race.
 *
 * Units, for the two factories that are structurally identical to `real()` and exist only to say
 * so at the call site: `kg()` is a logged or measured mass in kilograms (integer kg is impossible
 * with 1.25 kg microloading), `unitReal()` is a 0..1 fraction — never a percentage; `0.85`, and
 * `85` is rejected by the CHECK that always accompanies it.
 */
import { sql } from "drizzle-orm";
import { integer, real, text } from "drizzle-orm/sqlite-core";

/** Primary key: 26-char Crockford-base32 ULID from `src/lib/ids.ts`, minted by the writer. */
export const pk = () => text("id").primaryKey();

/**
 * A foreign-key column. The `.references()` call stays at the table, because the target and the
 * `onDelete` action are per-relationship — and every new FK is `restrict`, never `cascade`
 * (rule 11: drizzle-kit's 12-step recreate of a parent fires ON DELETE actions inside the
 * migration transaction and silently empties the children).
 */
export const fk = (n: string) => text(n);

/** An instant: epoch **milliseconds** UTC, surfaced as `Date`. Column name ends `_at`. */
export const ts = (n: string) => integer(n, { mode: "timestamp_ms" });

/** `ts()` with a SQL INSERT default. `defaultNow()` is deprecated and emits julianday maths. */
export const tsNow = (n: string) =>
  ts(n)
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

/**
 * INSERT default AND an ORM-level bump on every UPDATE, so an UPDATE that forgets `updated_at`
 * is still visible to the sync pull. Emits no DDL beyond the plain default.
 *
 * This is a backstop, not the contract: for a row captured offline the origin device's clock is
 * the truth, so the sync applier writes the clamped client `updated_at` verbatim (rule 3).
 */
export const tsTouch = (n: string) => tsNow(n).$onUpdate(() => new Date());

/** `'YYYY-MM-DD'` in Asia/Almaty, computed by `toLocalDay()` at write time. Always GLOB-CHECKed. */
export const localDay = (n = "local_day") => text(n);

/** `'YYYY-Www'` in Asia/Almaty, computed at write time. Always GLOB-CHECKed. */
export const isoWeek = (n: string) => text(n);

/** SQLite has no boolean; drizzle maps `0`/`1`. drizzle-kit emits the literal keyword `false`. */
export const bool = (n: string) => integer(n, { mode: "boolean" });

/** A logged or measured mass, kilograms. Column name ends `_kg`. */
export const kg = (n: string) => real(n);

/** A `0..1` scalar — confidence, credit, multiplier. Fractions, never percent. */
export const unitReal = (n: string) => real(n);

/**
 * A JSON payload. SQL type `text`, TS type `string` — drizzle NEVER parses it (rule 6), and
 * `.$type<T>()` is banned because it would assert a shape imported rows do not have.
 */
export const jsonCol = (n: string) => text(n);

/**
 * The four columns every syncable table carries. Spread as `...syncCols()`.
 *
 * `rev` is not decoration: every accepted UPDATE sets `rev = rev + 1` in the same statement, and
 * a write whose `client_rev` is below the stored `rev` at equal `updated_at` is a conflict, not a
 * silent overwrite. Without it the last-write-wins tiebreak is a coin flip on ties.
 *
 * `deleted_at` is the soft delete: user data is never row-deleted, and every query filters
 * `deleted_at IS NULL` (rule 25).
 */
export const syncCols = () => ({
  createdAt: tsNow("created_at"),
  updatedAt: tsTouch("updated_at"),
  rev: integer("rev").notNull().default(1),
  deletedAt: ts("deleted_at"),
});
