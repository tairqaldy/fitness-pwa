/**
 * The tables already shipped by migrations `0000_init` and `0001_credentials`, carried forward.
 *
 * ## Do not "tidy" this file
 *
 * Every definition below is **verbatim** from the migrations that are already applied to a
 * database holding real rows. It deliberately does NOT use the `src/db/columns.ts` factories,
 * even where a factory would be shorter: `tsNow("created_at")` adds a
 * `DEFAULT (unixepoch() * 1000)` that `integer("created_at", { mode: "timestamp_ms" }).notNull()`
 * does not have, and SQLite cannot `ALTER COLUMN`. drizzle-kit's answer to a changed default is
 * the 12-step recreate — `CREATE TABLE __new_users` / `INSERT … SELECT` / `DROP TABLE users` /
 * rename — and on D1 that `DROP TABLE` runs an implicit `DELETE FROM` inside the migration's
 * transaction, where `PRAGMA foreign_keys=OFF` is a documented no-op, so every `ON DELETE cascade`
 * child row is silently deleted while the migration reports success (reproduced in
 * `docs/research/r02-drizzle-d1-access-and-migrations.md` §4.1: 3 sets → 0).
 *
 * So: a cosmetic edit here is a data-loss event. New tables use the factories; these six do not.
 *
 * ## Two other frozen details
 *
 *  - **`users.birth_day` has no GLOB CHECK.** It shipped without one, and adding a CHECK to a
 *    shipped table is the same recreate. Zod enforces the `'YYYY-MM-DD'` format on write, and
 *    `tests/db/schema.test.ts` allow-lists this column by name so the omission stays deliberate.
 *  - **`settings.user_id` / `sessions.user_id` / `credentials.user_id` keep `ON DELETE cascade`.**
 *    Grandfathered (rule 12): `users` holds exactly one row that is never deleted and all three
 *    children are regenerable metadata. Every FK added after 0001 is `restrict` instead.
 *
 * Conventions for new tables live in `src/db/columns.ts`; the enum domains in `src/db/enums.ts`.
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
 * Login credentials: a PBKDF2-SHA256 password hash plus a TOTP secret.
 *
 * Why this shape (see docs/research/r04-auth-for-single-user-on-workers.md):
 *  - scrypt/bcrypt/argon2 do NOT run on workerd — PBKDF2 via WebCrypto is the only native
 *    option, so the iteration count and salt are stored explicitly to allow future upgrades.
 *  - `sessionVersion` is the revocation lever: bumping it invalidates every issued cookie
 *    without needing to enumerate sessions. It is only ever evaluated when a request actually
 *    reaches the Worker, so it never interferes with offline use.
 *  - Passkeys are deliberately additive later: they will mint the SAME session cookie, so
 *    nothing here has to change.
 */
export const credentials = sqliteTable("credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** PBKDF2-SHA256 derived key, base64url. */
  passwordHash: text("password_hash").notNull(),
  /** Per-user random salt, base64url. */
  passwordSalt: text("password_salt").notNull(),
  /** Stored so the cost can be raised later without invalidating existing passwords. */
  passwordIterations: integer("password_iterations").notNull(),
  /** Base32 TOTP shared secret. */
  totpSecret: text("totp_secret").notNull(),
  /** Set once the user has proved they can generate a valid code from their authenticator. */
  totpConfirmedAt: integer("totp_confirmed_at", { mode: "timestamp_ms" }),
  /** Bump to revoke every outstanding session cookie at once. */
  sessionVersion: integer("session_version").notNull().default(1),
  /**
   * Last accepted TOTP step counter. TOTP codes are valid for a 30s window, so without this a
   * captured code could be replayed inside its own window.
   */
  lastTotpStep: integer("last_totp_step"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
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
