/**
 * Canonical database schema (Cloudflare D1 / SQLite) — Drizzle definitions.
 *
 * CONVENTIONS (see DECISIONS.md; these are enforced everywhere, no exceptions):
 *  - **ids**: `text` primary keys holding a sortable, client-generatable id (see
 *    `src/lib/ids.ts`). Never an autoincrement integer — ids must be mintable offline so a
 *    row created on the phone with no network keeps its identity when it syncs.
 *  - **instants**: `integer({ mode: "timestamp_ms" })` — ALWAYS `_ms`, never plain
 *    `"timestamp"`, which silently truncates to whole seconds. Mixing the two modes across
 *    tables is a guaranteed off-by-1000 bug. Column name ends in `_at`.
 *  - **local calendar days**: `text` `'YYYY-MM-DD'` in the user's timezone (Asia/Almaty).
 *    Column name ends in `_day`. A "day" is a human concept and must not drift with UTC.
 *  - **booleans**: `integer({ mode: "boolean" })` — SQLite has no boolean type.
 *  - **weights, RPE, RIR**: `real`. Microloading needs 1.25 kg plates, so integers do not fit.
 *    PR detection therefore compares with an epsilon, never `===` (see src/lib/calc).
 *  - **counts (kcal, millilitres, grams of macro)**: `integer` — they are genuinely whole.
 *  - **JSON**: `text({ mode: "json" })`, always parsed through a Zod schema at the boundary.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * The single user. A table rather than a constant so that measurements, goals and sessions
 * have a real foreign key, and so an export/restore round-trip is uniform.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  /** Needed by the Mifflin-St Jeor prior and the US Navy body-fat equations. */
  sex: text("sex", { enum: ["male", "female"] }),
  birthDay: text("birth_day"),
  heightCm: integer("height_cm"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Per-user preferences. One row per user; split from `users` so it can change freely. */
export const settings = sqliteTable("settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  locale: text("locale", { enum: ["ru", "en"] })
    .notNull()
    .default("ru"),
  timezone: text("timezone").notNull().default("Asia/Almaty"),
  /** kg/cm only for now; the column exists so an import from a lb-based app can record intent. */
  unitSystem: text("unit_system", { enum: ["metric", "imperial"] })
    .notNull()
    .default("metric"),
  theme: text("theme", { enum: ["dark", "light", "system"] })
    .notNull()
    .default("dark"),
  /** Default rest between sets, in seconds. */
  defaultRestSeconds: integer("default_rest_seconds").notNull().default(120),
  /** Smallest loadable increment, in grams (2.5 kg = 2500). Drives the plate calculator. */
  barbellIncrementG: integer("barbell_increment_g").notNull().default(2500),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Auth sessions. Opaque token id in a cookie; the row is the source of truth so a device can
 * be revoked. `expires_at` is checked on every request.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    // Lets the cleanup cron delete expired rows with a single ranged scan.
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Cron bookkeeping. A failed cron is otherwise completely invisible — there is no browser to
 * show a 500 to (docs/research/r01-cron-triggers-on-opennext.md §4.7). Every scheduled
 * invocation writes exactly one row here, success or failure.
 *
 * `cron` is the raw expression from `ScheduledController.cron`; `job` is our logical name.
 */
export const cronRuns = sqliteTable(
  "cron_runs",
  {
    id: text("id").primaryKey(),
    cron: text("cron").notNull(),
    job: text("job").notNull(),
    /**
     * The slot this invocation was scheduled for (`ScheduledController.scheduledTime`), NOT
     * when it actually started. This is the idempotency key: Cloudflare may retry a cron,
     * and a retry carries the same `scheduledTime` but a different `startedAt`. Keying the
     * unique index on `startedAt` would therefore guard nothing.
     */
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    ok: integer("ok", { mode: "boolean" }).notNull().default(false),
    error: text("error"),
    /** Free-form per-job result (counts, ids touched) for debugging. */
    detail: text("detail", { mode: "json" }),
  },
  (t) => [
    // Serves "recent runs of job X", the dashboard/observability query.
    index("cron_runs_job_started_idx").on(t.job, t.startedAt),
    // The real idempotency guard: one row per (job, scheduled slot). A retried cron hits
    // this constraint instead of sending a duplicate Telegram message.
    uniqueIndex("cron_runs_job_slot_idx").on(t.job, t.scheduledAt),
  ],
);

/**
 * Marker table so a deploy can assert that migrations actually ran, independently of
 * wrangler's own `d1_migrations` bookkeeping — which is known to drift from the real schema
 * (docs/research/r02-drizzle-d1-access-and-migrations.md).
 */
export const schemaMeta = sqliteTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Settings = typeof settings.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type CronRun = typeof cronRuns.$inferSelect;
