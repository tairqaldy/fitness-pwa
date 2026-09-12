# 02 — Full Drizzle/D1 schema, indexes and migration policy

## Purpose

The single canonical definition of every D1 table, column, constraint and index. Satisfies the
brief's "Data model" section including `plus indexes for date-range and per-exercise queries`, and
fixes the conventions every other module obeys: ULID text primary keys, epoch-ms UTC instants,
`'YYYY-MM-DD'` Asia/Almaty local days, kg/cm/kcal/g units. **No other spec may define, rename or
widen a table; they reference the names here.** Because several sibling specs were written against
draft names, this spec also carries an explicit **cross-spec name reconciliation** table (§Behaviour
rule 27) recording which name won and which spec must change. Also fixes the migration, seeding and
delete policy.

## Scope

`src/db/**` (the schema, column helpers, enum tuples, JSON codecs, local-day arithmetic, the wire
converter), `drizzle.config.ts`, `drizzle/migrations/**`, the four `db:*` package scripts, the
drift-guard / migration-safety / seed-generator scripts, the delete policy, and the index catalogue
naming the query pattern each index serves.

**Repo state as actually read on 2026-09-13** (not as the earlier draft of this spec assumed):
`drizzle/migrations/0000_init.sql` shipped `users`, `settings`, `sessions`, `cron_runs`,
`schema_meta`; `drizzle/migrations/0001_credentials.sql` is **already committed and applied** and
shipped a sixth table, `credentials`. `meta/_journal.json` has entries `idx 0` and `idx 1`. This spec
**carries all six forward unchanged** and adds **47** tables, for **53** total. The first migration
this spec generates is therefore **`0002_*.sql`**, never `0001_*`. The table count is never asserted
as a literal in a test — it is derived from `getTableConfig()` at test time (rule 16), because it is
the kind of number every future migration changes.

### Out of scope

| Excluded | Owner |
|---|---|
| Request-time D1 access, `force-dynamic`, cron entrypoint, `src/server/db/index.ts`, **every binding name and `wrangler.jsonc` itself** | `01-architecture.md` |
| Session lifecycle, PBKDF2/TOTP/WebAuthn (`auth_credentials`, `auth_events`, `auth_throttle` semantics) | `04-auth.md` |
| Outbox flush order, conflict UX, Dexie store declarations, Serwist wiring | `05-pwa-offline-sync.md` |
| e1RM / EMA / TDEE / plate / volume *arithmetic* and constants, `SECONDARY_MUSCLE_CREDIT`'s value | `07-calculators.md` |
| Seed download + R2 upload execution | `08-exercise-library.md` |
| Photo upload route, variants, signed URLs | `10-body-photos.md` |
| OFF/FDC fetch, mapping, AI correction loop | `11-nutrition-ai.md` |
| `muscle_week_rollups` recompute/verify logic (here: only its DDL) | `12-analytics-dashboard.md` |
| Streak/XP/achievement *rules* (here: only the ledgers) | `13-gamification.md` |
| Export writer, three CSV importers, round-trip test | `15-data-portability.md` |
| CI **wiring** of `db:verify` into the `schema` job (the script lines themselves are owned here) | `16-testing-ci-quality.md` |
| a11y tokens, contrast values, touch-target sizes for the two surfaces in §UX notes | `03-design-system.md` |

## Files to create

| Path | Responsibility |
|---|---|
| `src/db/enums.ts` | Frozen `as const` tuples + derived TS unions |
| `src/db/columns.ts` | Column factories `pk/fk/ts/tsNow/tsTouch/localDay/isoWeek/bool/jsonCol/kg/unitReal/syncCols` |
| `src/db/json.ts` | Zod codec per JSON column; the only parse boundary; `JSON.parse` lives here, not in drizzle |
| `src/db/local-day.ts` | `toLocalDay`, `localDayBoundsMs`, `rolling7dDays`, `isoWeekOf` — Asia/Almaty, **hardcoded two-era offset table**, no `Intl` at runtime |
| `src/db/wire.ts` | `toWire`/`fromWire`: the one place a `timestamp_ms` `Date` becomes an epoch-ms `number` on the HTTP boundary (rule 4) |
| `src/db/schema/{core,library,workouts,programs,body,nutrition,wellness,gamification,analytics,system}.ts` | The 47 new tables, grouped as below |
| `src/db/schema.ts` | **Existing file becomes a barrel** re-exporting `./schema/*`; the only path `drizzle.config.ts` and `drizzle({schema})` read. The move must generate **no** migration |
| `drizzle/migrations/0002_*.sql` + `meta/**` | Generated, committed, **immutable once applied** |
| `docs/db/schema.snapshot.sql` | Human-reviewable `drizzle-kit export --sql`, committed, freshness-checked in CI |
| `scripts/verify-schema.mjs` | Offline drift guard ([r02 §2.6](../docs/research/r02-drizzle-d1-access-and-migrations.md)), extended to CHECKs. CLI: `--check` (default, exit 1 on drift), `--write` (regenerate the snapshot), `--against=<file>` (compare a `wrangler d1 export` dump instead of `drizzle-kit export`) |
| `scripts/check-migration-safety.mjs` | Fails CI on unapproved destructive DDL (rule 21) |
| `scripts/seedgen.mjs` | Emits `seed/*.sql`, literal values, ≤ 90 KB per statement (r02 §2.7) |
| `seed/` | Generated, committed: `seed/exercises.sql`, `seed/volume_weights.sql` |
| `tests/db/fixtures/seed.sql` | The minimal FK-complete fixture: one `users`, `settings`, `exercises`, `workouts`, `workout_exercises`, `sets` row. Required by Verification step 7 and by 16's row-count gate |
| `tests/db/conventions.test.ts` | Local-day boundary, JSON codec, byte caps, epsilon, rounding, `rev`/`updated_at` rules |
| `tests/db/index-coverage.test.ts` | `EXPLAIN QUERY PLAN` assertions for P1–P24 **plus** the "no index without a pattern" enumeration |
| `tests/db/migration-replay.test.ts` | Replays `drizzle/migrations/*.sql` on `node:sqlite`, asserts row survival |

| Path to **modify** (surgical, named lines only) | Change |
|---|---|
| `package.json` `scripts` | Add exactly: `"db:verify": "node scripts/verify-schema.mjs"`, `"db:snapshot": "node scripts/verify-schema.mjs --write"`, `"db:verify:live": "node scripts/verify-schema.mjs --against=.artifacts/live.sql"`, `"db:seed:local": "wrangler d1 execute fitness-pwa-db --local --file=seed/exercises.sql"`. This supersedes `16-testing-ci-quality.md` line 128's claim to own `db:verify`; 16 owns only the CI job that calls it |
| `eslint.config.mjs` | Append one config object (rule 20) restricted to `src/**`: `"no-restricted-syntax": ["error", { selector: "CallExpression[callee.property.name='transaction']", message: "D1 is auto-commit only (r02 §4.6) — use db.batch()." }]` |
| `.gitignore` | Add `.artifacts/` — the scratch dir Verification step 8 writes the live dump into, cross-platform, never `/tmp` |

Reused as-is: `src/lib/ids.ts` (`ulid(now, randomBytes?)`, `ulidTime`, `isUlid`, 26-char Crockford,
already vendored), `src/server/db/index.ts`, `drizzle.config.ts` (`out: "./drizzle/migrations"` ==
`wrangler.jsonc` `migrations_dir`), `src/lib/calc/` (constants).

## Interfaces

```ts
// src/db/columns.ts
export const pk = () => text("id").primaryKey();                 // ULID from src/lib/ids.ts
export const fk = (n: string) => text(n);
export const ts = (n: string) => integer(n, { mode: "timestamp_ms" });   // epoch-MS UTC → Date
export const tsNow = (n: string) => ts(n).notNull().default(sql`(unixepoch() * 1000)`);
/** INSERT default AND an ORM-level bump on every UPDATE. Emits no extra DDL (verified). */
export const tsTouch = (n: string) => tsNow(n).$onUpdate(() => new Date());
export const localDay = (n = "local_day") => text(n);   // 'YYYY-MM-DD' Almaty, app-computed
export const isoWeek = (n: string) => text(n);          // 'YYYY-Www' Almaty, app-computed
export const bool = (n: string) => integer(n, { mode: "boolean" });
export const kg = (n: string) => real(n);               // logged/measured mass, kilograms
export const unitReal = (n: string) => real(n);         // 0..1 confidence / credit / multiplier
/** JSON. SQL type `text`, TS type `string` — drizzle NEVER parses (rule 6). */
export const jsonCol = (n: string) => text(n);
/** Spread as `...syncCols()` — returns FRESH builders; never share one object across tables. */
export const syncCols = () => ({ createdAt: tsNow("created_at"), updatedAt: tsTouch("updated_at"),
  rev: integer("rev").notNull().default(1), deletedAt: ts("deleted_at") });

// src/db/enums.ts — MUSCLES/EQUIPMENT/EX_* are the *measured* domains of free-exercise-db
// @a859101d (docs/research/r07-exercise-dataset.md §4 + its two taxonomy tables).
export const MUSCLES = ["abdominals","abductors","adductors","biceps","calves","chest","forearms",
  "glutes","hamstrings","lats","lower_back","middle_back","neck","quadriceps","shoulders","traps",
  "triceps"] as const;                                  // exactly 17, 1:1 with the dataset
export const EQUIPMENT = ["barbell","dumbbell","ez_bar","cable","machine","kettlebell",
  "resistance_band","medicine_ball","exercise_ball","foam_roller","bodyweight","other",
  "unknown"] as const;                                  // 13; 'unknown' == dataset null (77 rows)
export const EX_CATEGORY = ["strength","stretching","plyometrics","powerlifting",
  "olympic_weightlifting","strongman","cardio"] as const;
export const MUSCLE_ROLES = ["primary","secondary"] as const;
export const EX_LEVEL = ["beginner","intermediate","expert"] as const;
export const EX_FORCE = ["push","pull","static"] as const;       // nullable: 30/876 records
export const EX_MECHANIC = ["compound","isolation"] as const;    // nullable: 87/876 records
export const LOAD_MODE = ["external","bodyweight","bodyweight_plus","assisted","duration",
  "distance"] as const;                                 // ours; seeded heuristically, user-editable
export const SET_TYPES = ["warmup","working","drop","failure","amrap"] as const;
/** Which estimator produced sets.e1rm_kg. Required by 07 (`E1rmSource`) and 12. */
export const E1RM_SOURCES = ["actual_single","epley","brzycki","rpe"] as const;
export const PR_KINDS = ["e1rm","max_weight","max_reps","session_volume"] as const;
export const PHOTO_KIND = ["progress","food"] as const;
export const POSES = ["front","side","back"] as const;
export const FOOD_SOURCES = ["user","off","fdc","ai"] as const;
export const FOOD_BASIS = ["100g","100ml","serving"] as const;          // 11 rule 'basis'
export const ENTRY_STATUS = ["draft","confirmed"] as const;             // 11: day totals hinge on it
export const MEAL_SLOTS = ["breakfast","lunch","dinner","snack"] as const;
export const CORRECTION_KINDS = ["none","edited","items_removed","items_added","replaced"] as const;
export const TDEE_STATUS = ["no_estimate","prior_only","calibrating","ready"] as const;
export const PRIMARY_GOALS = ["muscle","fatloss","strength","health"] as const;   // 13 item 1
/** 7 original + 7 required by 13 item 2 = 14. Adding a value is Zod-only (rule 13). */
export const XP_SOURCES = ["set","workout","checkin","pr","quest","streak_day","achievement",
  "nutrition_day","food_photo","body","photo","gym_checkin","week_target","week_review"] as const;

// src/db/local-day.ts — Asia/Almaty. NO runtime Intl, NO tz library (none is installed; see rule 5).
export const APP_TZ = "Asia/Almaty";
/** The one tz transition this app can encounter: 2024-02-29T18:00:00Z, UTC+6 → UTC+5. */
export const ALMATY_UTC5_FROM_MS = 1_709_229_600_000;
export const ALMATY_ERA_FLOOR_MS = 1_104_537_600_000;   // 2005-01-01T00:00:00Z; below → throw
export function toLocalDay(instantMs: number): string;                        // 'YYYY-MM-DD'
export function localDayBoundsMs(day: string): { startMs: number; endMs: number };
export function rolling7dDays(nowMs: number): { from: string; to: string };   // both inclusive
export function isoWeekOf(day: string): string;                              // 'YYYY-Www'

// src/db/json.ts — the ONLY place a JSON column is read or written
export function parseJson<T extends z.ZodType>(s: T, raw: string | null): z.infer<T>;    // throws
export function tryParseJson<T extends z.ZodType>(s: T, raw: string | null):
  { ok: true; value: z.infer<T> } | { ok: false; error: string; raw: string };
export function toJson<T extends z.ZodType>(s: T, v: z.infer<T>): string;  // validates + caps, then
                                                                          // JSON.stringify
export const MAX_JSON_BYTES = 65_536;   // enforced as UTF-8 BYTES, both in Zod and in SQL (rule 6)

// src/db/wire.ts — the D1 ⇄ HTTP boundary. 05 types every instant as `number`; drizzle gives `Date`.
export function toWire<T>(row: T): WireOf<T>;     // Date → epoch-ms number, recursively
export function fromWire<T>(row: WireOf<T>): T;   // number → Date; rejects a non-integer

// Owned by 07-calculators, but the schema depends on them:
// PR_EPSILON_KG = 0.01, MAX_REPS_FOR_E1RM = 12, BRZYCKI_MAX_REPS = 36.
```

`sets` in full — the hot path, and the pattern every other table follows:

```ts
// src/db/schema/workouts.ts
export const sets = sqliteTable("sets", {                // 26 columns → bulk-insert cap 3 rows
  id: pk(),
  workoutId: fk("workout_id").notNull().references(() => workouts.id, { onDelete: "restrict" }),
  workoutExerciseId: fk("workout_exercise_id").notNull()
    .references(() => workoutExercises.id, { onDelete: "restrict" }),
  exerciseId: fk("exercise_id").notNull().references(() => exercises.id, { onDelete: "restrict" }),
  localDay: localDay().notNull(),          // denormalised from the workout; all date queries use it
  position: integer("position").notNull(), // 0-based within the workout_exercise, dense
  setType: text("set_type", { enum: SET_TYPES }).notNull(),
  weightKg: kg("weight_kg"),               // external load; NULL for a pure bodyweight set
  assistKg: kg("assist_kg"),               // assisted machines store ASSISTANCE, not load
  reps: integer("reps"),
  rpe: real("rpe"),                        // 0.5 steps; 6.5 is real data (r10 gotcha 15)
  rir: real("rir"),                        // RIR = 10 − RPE (r09 §2)
  distanceM: real("distance_m"), durationSec: integer("duration_sec"),
  restAfterSec: integer("rest_after_sec"), // rest is DATA, never a pseudo-row (r10 §2.1 rule 7)
  supersetRound: integer("superset_round"),
  e1rmKg: kg("e1rm_kg"),                   // DERIVED at write time; NULL when suppressed (rule 10)
  e1rmSource: text("e1rm_source", { enum: E1RM_SOURCES }),   // which estimator; NULL iff e1rm_kg is
  isPr: bool("is_pr").notNull().default(false),
  prKindsJson: jsonCol("pr_kinds_json"),   // PR_KINDS[] when isPr, else NULL
  completedAt: ts("completed_at").notNull(),
  importBatchId: fk("import_batch_id").references(() => importBatches.id, { onDelete: "restrict" }),
  ...syncCols(),
}, (t) => [
  uniqueIndex("sets_workout_exercise_id_position_uq").on(t.workoutExerciseId, t.position),
  // COVERING for P3/P4. `deleted_at` is the TRAILING column purely so rule 25's mandatory
  // `AND deleted_at IS NULL` does not strip the COVERING property — measured, see rule 16.
  index("sets_exercise_id_completed_at_idx")
    .on(t.exerciseId, t.completedAt, t.weightKg, t.reps, t.e1rmKg, t.deletedAt),
  index("sets_local_day_exercise_id_idx").on(t.localDay, t.exerciseId, t.deletedAt),
  index("sets_workout_id_idx").on(t.workoutId),
  index("sets_is_pr_idx").on(t.completedAt).where(sql`is_pr = 1 AND deleted_at IS NULL`),
  index("sets_updated_at_id_idx").on(t.updatedAt, t.id),      // P12, composite keyset (rule 3)
  index("sets_import_batch_id_idx").on(t.importBatchId),
  check("sets_reps_sane", sql`${t.reps} IS NULL OR (${t.reps} >= 0 AND ${t.reps} <= 500)`),
  check("sets_weight_sane", sql`${t.weightKg} IS NULL OR (${t.weightKg} BETWEEN 0 AND 1000)`),
  check("sets_e1rm_finite", sql`${t.e1rmKg} IS NULL OR (${t.e1rmKg} > 0 AND ${t.e1rmKg} < 2000)`),
  check("sets_rpe_range", sql`${t.rpe} IS NULL OR (${t.rpe} BETWEEN 1 AND 10)`),
  check("sets_local_day_fmt", sql`${t.localDay} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
]);
```

All 53 tables. `→t` is `.references(() => t.id, { onDelete: "restrict" })`; `?` nullable, everything
else NOT NULL; `U(…)` unique index, `I(…)` index, `C(…)` CHECK, `P(…)` composite PK. Unless noted
every table has `id: pk()` + `...syncCols()` + `I(updated_at, id)`, every `local_day`/`_on`/`_day`
column carries a `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'` CHECK, and every `_at` is
epoch-ms. Names are DB snake_case (TS keys are the camelCase equivalents). `B(col)` means the byte
cap `CHECK (length(CAST(col AS BLOB)) <= 65536)` — **`length()` counts characters, not bytes**
(rule 6).

**Index names on new tables are `<table>_<searched columns>_<idx|uq>`** — named after the columns the
query pattern *searches or orders on*, which is what the P-table refers to. Trailing columns present
only to make an index covering (`deleted_at`, `weight_kg`, `reps`, `e1rm_kg`) and partial-index
predicates are **not** in the name, so `sets_exercise_id_completed_at_idx` is
`.on(exercise_id, completed_at, weight_kg, reps, e1rm_kg, deleted_at)` and `workouts_local_day_idx`
is `.on(local_day, deleted_at)`. Without that clause the naming test and the P-table cannot agree.
Five names are allow-listed exceptions: the four grandfathered ones in the carried-forward block, and
`import_batches_applied_sha_uq`, whose spelling is fixed by `15-data-portability.md`.

```
core.ts — SHIPPED IN 0000/0001, CARRIED FORWARD VERBATIM (do not regenerate). The four index names
below violate the new convention and are GRANDFATHERED, not renamed: a rename is a DROP+CREATE on
tables the running app reads, for zero behavioural gain. The naming test skips exactly these four:
users            id, email, display_name?, sex? ∈male|female, birth_day?, height_cm? INT,
                 created_at, updated_at — NOTE: `birth_day` has no GLOB CHECK (shipped without one;
                 rule 13's corollary makes adding one a table recreate). Zod enforces it on write.
settings         user_id PK →users ON DELETE cascade (grandfathered, rule 12), locale='ru',
                 timezone='Asia/Almaty', unit_system='metric' /*display intent; storage is kg*/,
                 theme='dark', default_rest_seconds=120, barbell_increment_g=2500, updated_at
sessions         id, user_id→users ON DELETE cascade (grandfathered), created_at, expires_at,
                 last_seen_at, user_agent?, I(user_id) AS sessions_user_idx,
                 I(expires_at) AS sessions_expires_idx
credentials      user_id PK →users ON DELETE cascade, password_hash, password_salt,
                 password_iterations INT, totp_secret, totp_confirmed_at?, session_version=1,
                 last_totp_step?, created_at, updated_at — single-row, shipped in 0001. FROZEN: it
                 cannot hold 04-auth's eight `recovery` rows, so 0002 supersedes it (rule 28).
cron_runs        id, cron, job, scheduled_at /*the idempotency key, not started_at*/, started_at,
                 finished_at?, ok=false, error?, detail? json,
                 I(job,started_at) AS cron_runs_job_started_idx,
                 U(job,scheduled_at) AS cron_runs_job_slot_idx /*`_idx` suffix on a UNIQUE index*/
schema_meta      key PK, value, updated_at

core.ts — ADDED. Every `settings` addition is `ALTER TABLE ADD COLUMN` with a **constant** default
and **no CHECK**: a CHECK on a shipped table is a full drizzle-kit recreate (rule 21, measured), so
every cap or domain on these columns is Zod-only at the write boundary.
settings       + bar_mass_g=20000, ez_bar_mass_g=7500, plate_inventory_json='[]',
                 streak_freeze_budget=2, streak_grace_per_week=1, weekly_target_sessions=4,
                 session_version INT=1 /*04-auth reads it on every authenticated request*/,
                 primary_goal='muscle' /*13 item 1, ∈PRIMARY_GOALS*/,
                 start_weight_kg? /*10 reads it*/, allow_unverified_templates=false /*09 reads it*/
                 — `ai_provider` is deliberately NOT here: see rule 29.
volume_weights   role ∈MUSCLE_ROLES PK, credit unitReal C(0..1), updated_at — no syncCols;
                 seeded primary=1.0 / secondary=0.5
auth_credentials user_id→users, kind /*password|totp|recovery|passkey*/, label?, material, counter?,
                 backed_up?, created_at, last_used_at?, revoked_at?, I(kind),
                 U(kind) WHERE kind IN ('password','totp') AND revoked_at IS NULL
                 — no syncCols; 04-auth owns semantics. Multi-row, which is why it replaces
                   `credentials` rather than extending it (rule 28).
auth_events      at_ms, kind, ok, reason?, ip?, ua?, I(at_ms) — no syncCols; append-only (04 §Data)
auth_throttle    id='singleton' C(id='singleton'), consecutive_failures=0, locked_until_ms?,
                 updated_at — no syncCols; upserted (04 §Data)

library.ts
exercises        id='fedb:<dataset id>' | 'usr:<ULID>', source /*free-exercise-db|user*/,
                 source_id?, source_commit?, name, name_ru?, slug, force? ∈EX_FORCE,
                 level ∈EX_LEVEL, mechanic? ∈EX_MECHANIC, equipment ∈EQUIPMENT,
                 category ∈EX_CATEGORY, load_mode ∈LOAD_MODE='external',
                 instructions_json='[]' B(instructions_json), image_licence='unknown-third-party',
                 is_favourite=false, import_batch_id?→import_batches, U(slug), U(source,source_id),
                 I(equipment), I(import_batch_id), C(equipment∈…), C(category∈…), C(level∈…)
exercise_muscles exercise_id→exercises, muscle ∈MUSCLES, role ∈MUSCLE_ROLES,
                 P(exercise_id,muscle,role), I(muscle,role,exercise_id), C(muscle ∈ the 17 keys),
                 C(role∈…) — no syncCols (rebuilt on re-seed)
exercise_media   exercise_id→exercises, idx C(0..3), r2_key U, sha256, width, height, bytes,
                 P(exercise_id,idx) — no syncCols

workouts.ts (sets is above)
workouts         user_id→users, local_day, started_at, ended_at? /*null while in progress*/,
                 duration_sec?, title?, notes?, routine_id?→routines,
                 bodyweight_kg? /*snapshot; makes bodyweight-exercise e1RM meaningful*/,
                 volume_kg?, hard_sets? /*both DERIVED at finish*/,
                 gym_within_geofence? bool, gym_distance_bucket? /*text bucket, never a coordinate
                 — see rule 30*/, import_batch_id?→import_batches, import_key? U,
                 I(local_day,deleted_at), I(started_at), I(import_batch_id)
workout_exercises workout_id→workouts, exercise_id→exercises, position /*0-based, dense,
                 explicit — never row order*/, superset_group? /*int, scoped to THIS workout*/,
                 target_sets?, target_reps_low?, target_reps_high?, notes?,
                 import_batch_id?→import_batches,
                 U(workout_id,position), I(workout_id), I(exercise_id)
                 — exists so "same exercise twice in one workout" is representable and supersets
                   are first-class (r10 §2.2, §1.2.6, gotchas 12–13)
personal_records exercise_id→exercises, kind ∈PR_KINDS, value /*kg, or reps for max_reps*/,
                 reps_at_value?, set_id?→sets, origin_key /*NOT NULL — see rule 31*/, local_day,
                 achieved_at, is_current=true, superseded_at?,
                 U(origin_key,kind) /*replay-safe for set-backed AND imported rows*/,
                 U(exercise_id,kind) WHERE is_current=1, I(achieved_at),
                 I(exercise_id,kind,achieved_at) — append-only history

programs.ts
programs         name, description?, kind /*ppl|upper_lower|full_body|531|gzclp|nsuns|custom*/,
                 is_active=false, started_on?, weeks_per_cycle?
routines         program_id?→programs, name, day_index, notes?, I(program_id,day_index)
routine_exercises routine_id→routines, exercise_id→exercises, position, target_sets,
                 target_reps_low?, target_reps_high?, target_rpe?, rest_sec?, superset_group?,
                 progression_scheme, increment_g?, U(routine_id,position), I(exercise_id)
deload_blocks    program_id→programs, starts_on, ends_on, volume_multiplier, intensity_multiplier,
                 source /*scheduled|ai_suggested|manual*/, accepted_at?, U(program_id,starts_on)
                 — 09-programs proposes a larger, differently-named set of program tables; that is
                   Open question 5 and must be settled BEFORE 0002 is generated.

body.ts
body_measurements local_day, measured_at, weight_kg?, trend_kg? /*DERIVED EMA, r09 §4*/,
                 trend_excluded=false /*outlier: kept and shown, not folded into the trend*/,
                 waist_cm?, neck_cm?, hips_cm?, chest_cm?, shoulder_cm?,
                 biceps_l_cm?, biceps_r_cm?, forearm_l_cm?, forearm_r_cm?, thigh_l_cm?,
                 thigh_r_cm?, calf_l_cm?, calf_r_cm? /*L/R pairs, required by 10 amendment 1:
                 unilateral asymmetry is the point, and one averaged column cannot express it.
                 All REAL — a tape reads to 0.5 cm and Navy BF is sensitive*/,
                 body_fat_pct? /*DERIVED Navy*/, body_fat_method?, notes?,
                 import_batch_id?→import_batches, import_key? U,
                 I(local_day,deleted_at), I(measured_at), I(import_batch_id)
                 — deliberately NOT unique on local_day (rule 15)
photos           kind ∈PHOTO_KIND, r2_key U, thumb_key?, orig_key?, content_type, bytes, width,
                 height, sha256?, r2_etag? /*unquoted form*/, taken_at, local_day, uploaded_at,
                 pose? ∈POSES, notes?, r2_purged_at? /*the GC watermark, rule 26*/,
                 I(kind,taken_at,deleted_at), I(sha256),
                 I(deleted_at) WHERE deleted_at IS NOT NULL AND r2_purged_at IS NULL,
                 C(kind∈…), C(pose IS NULL OR kind='progress')

nutrition.ts — `foods` IS the durable nutrition cache (r08 §5.1 step 1); KV holds raw upstream JSON
foods            source ∈FOOD_SOURCES, source_id? /*gtin13 | fdcId — this is 11's `source_ref`*/,
                 barcode?, name, name_ru?, slug, brand?, basis ∈FOOD_BASIS='100g',
                 energy_source? /*'energy-kcal_100g'|'energy-kj_100g'|'958'|'computed' — 11 rule*/,
                 kcal_100g?, protein_100g?, carb_100g?, fat_100g?, fiber_100g?, sugar_100g?,
                 sat_fat_100g?, sodium_mg_100g?, serving_grams? /*all REAL — OFF returns
                 fractions*/, serving_label?, micronutrients_json? B(micronutrients_json),
                 confidence? unitReal C(confidence IS NULL OR confidence BETWEEN 0 AND 1),
                 fetched_at? /*11's `source_fetched_at`*/, verified_by_user=false,
                 is_favourite=false, U(source,source_id), I(barcode), I(slug), C(source∈…),
                 C(basis∈…)
meal_templates   name, notes? — named multi-item meals (11's name; 02's old `meals`)
meal_template_items meal_template_id→meal_templates, food_id→foods, grams REAL, position,
                 U(meal_template_id,position)
food_entries     local_day, eaten_at, meal_slot ∈MEAL_SLOTS, food_id?→foods, photo_id?→photos,
                 label?, basis ∈FOOD_BASIS='100g', source ∈FOOD_SOURCES,
                 status ∈ENTRY_STATUS='confirmed' /*day totals and the TDEE window BOTH exclude
                 'draft' — 11's correctness hinges on it*/, grams? REAL,
                 kcal? INT, protein_g? INT, carb_g? INT, fat_g? INT, fiber_g? INT
                 /*derived energy/macros are whole — rule 8*/,
                 ai_estimate_json? B(ai_estimate_json), corrected_json? B(corrected_json),
                 confidence? unitReal C(0..1 or NULL), correction_kind? ∈CORRECTION_KINDS,
                 delta_kcal? INT, delta_pct? REAL, ai_log_id?→ai_prompt_logs, confirmed_at?,
                 import_batch_id?→import_batches, import_key? U,
                 I(local_day,status,eaten_at), I(photo_id), I(food_id), I(import_batch_id),
                 C(status∈…), C(meal_slot∈…)
water_logs       local_day, logged_at, ml INT, I(local_day), I(logged_at)
fasting_sessions started_at, ended_at?, target_seconds?, notes?, I(started_at),
                 U(ended_at) WHERE ended_at IS NULL /*at most one open fast — 11 rule 38*/
nutrition_targets effective_on /*local day*/ U, kcal INT, protein_g INT, carb_g INT, fat_g INT,
                 fiber_g INT, water_ml INT, goal_rate_kg_per_week REAL, floored=false,
                 tdee_estimate_id?→tdee_estimates, computed_at
                 — append-only; never updated in place (11 §Data)
tdee_estimates   week_ending /*local day*/, tdee_kcal REAL, tdee_data_kcal? REAL, prior_kcal REAL,
                 prior_kind /*msj|katch*/, blend_weight REAL, complete_days INT, weigh_ins INT,
                 status ∈TDEE_STATUS, capped=false, suspect_weight_swing=false,
                 trend_start_kg?, trend_end_kg?, mean_intake_kcal? REAL, computed_at,
                 U(week_ending,computed_at), I(week_ending,computed_at)
                 — append-only; never UPDATE (r09 §5 step 6). A week is CORRECTABLE by appending a
                   newer row; every reader takes `MAX(computed_at)` for the week (rule 32).

wellness.ts
daily_checkins   local_day U, sleep_hours? REAL, sleep_quality?, mood?, energy?,
                 soreness_json? B(soreness_json) /*Partial<Record<Muscle,0..3>>*/, steps?,
                 resting_hr?, readiness? REAL /*DERIVED*/, notes?,
                 import_batch_id?→import_batches, import_key? U
goals            kind /*bodyweight|kcal|protein|carbs|fat|sessions_per_week|e1rm|bodyfat — `carbs`
                 and `fat` added for 12's ring 3*/, exercise_id?→exercises, target_value REAL,
                 unit, starts_on, ends_on?, achieved_at?, I(kind,ends_on)

gamification.ts
streak_state     id='singleton' C(id='singleton'), current_days, current_weeks, longest_days,
                 longest_weeks, freezes_remaining, grace_used_this_week, last_active_day?,
                 adherence_pct? REAL, recomputed_at
streak_ledger    local_day U, status /*active|rest|grace|freeze|missed*/, workout_id?→workouts,
                 reason?, applied_at — append-only day ledger, upsert-by-day
xp_ledger        awarded_at, local_day, source_kind ∈XP_SOURCES, source_id, xp INT, reason?,
                 U(source_kind,source_id) /*award-once*/, I(local_day)
achievement_unlocks achievement_key PK /*catalogue lives in code, not a table*/, unlocked_at,
                 local_day, progress? REAL, source_id?, seen_at?
quests           week_start_day, key, target_value REAL, progress_value=0, completed_at?,
                 U(week_start_day,key)
gym_checkins     local_day, at, within_geofence? bool /*NULL when manual*/, distance_bucket,
                 accuracy_bucket, method, I(local_day) — **no coordinate column, ever** (13 §24)
gym_geofence     id='singleton' C(id='singleton'), lat REAL, lon REAL /*rounded to 4 dp by the
                 writer*/, radius_m INT, label? — the ONLY coordinate in D1, one overwritable row
weekly_reviews   iso_week PK C(GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'), generated_at,
                 payload_json B(payload_json), ai_summary? /*written by 14*/, reflection?,
                 delivered_at? — no syncCols
monthly_report_cards month PK C(GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'), generated_at,
                 payload_json B(payload_json) — no syncCols
year_in_review   year INTEGER PK, generated_at, payload_json B(payload_json) — no syncCols

analytics.ts — derived caches only; never a source of truth
muscle_week_rollups iso_week C(GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'), muscle ∈MUSCLES,
                 credited_hard_sets REAL, credited_tonnage_kg REAL, primary_sets REAL,
                 secondary_sets REAL, updated_at, P(iso_week,muscle), I(iso_week),
                 C(muscle ∈ the 17 keys) — no syncCols; 12 owns recompute/verify

system.ts
mutations        id PK = client-minted ULID, kind, entity_table, entity_id, client_rev,
                 received_at, applied_at?, status /*applied|conflict|rejected*/,
                 result_json? B(result_json), I(received_at) — no syncCols; server idempotency ledger
push_subscriptions endpoint U, p256dh, auth, expiration_time?, label?, platform?, created_at,
                 last_ok_at?, last_error_at?, last_error_code?, fail_count=0 — no syncCols; r06 §5.1
telegram_state   id='singleton' C(id='singleton'), chat_id, webhook_set_at?, secret_rotated_at?,
                 last_update_id?, last_ok_at?, last_error_at?, last_error? — no syncCols
notification_log channel /*push|telegram*/, kind, local_day, sent_at, ok, detail?,
                 U(channel,kind,local_day) — no syncCols; "already sent today" guard (r01 §4.8)
ai_prompt_logs   created_at, local_day, provider, model /*pinned id, NEVER a floating alias*/,
                 prompt_version, feature, outcome, schema_name?, attempt?, locale?,
                 input_ref /*R2 key or sha256 — never image bytes*/, output_json? B(output_json),
                 output_r2_key?, repairs_json? B(repairs_json), degraded=false,
                 input_tokens?, output_tokens?, cached_input_tokens?, tokens_missing=false,
                 cost_usd? REAL, latency_ms?, finish_reason?, ok, error?, error_code?,
                 entry_id?, delta_kcal? INT, delta_pct? REAL,
                 I(created_at), I(feature,created_at), I(prompt_version,model) — no syncCols
coach_insights   generation, locale, window_start_day, window_end_day, severity,
                 source /*model|template*/, headline, body_json B(body_json),
                 stats_json B(stats_json), actions_json? B(actions_json),
                 status /*new|read|proposed|accepted|dismissed*/, entity_id?,
                 ai_log_id?→ai_prompt_logs, I(generation,created_at), I(status) — 14 §Data
import_batches   source /*hevy|strong|mfp-nutrition|mfp-exercise|mfp-measurement|ours*/, dialect?,
                 filename, bytes, sha256, schema_version?, started_at, finished_at?,
                 status /*staged|applied|aborted|rolled_back*/, rolled_back_at?, rows_seen,
                 rows_imported, rows_skipped, report_json? B(report_json),
                 unit_confirm_json? B(unit_confirm_json),
                 U(sha256) WHERE status='applied' AS import_batches_applied_sha_uq
import_staging   batch_id→import_batches, table_name, row_index, row_json B(row_json),
                 U(batch_id,table_name,row_index), I(batch_id,table_name) — no syncCols
exercise_aliases alias_norm PK, exercise_id→exercises, source, score REAL,
                 decided_by C(∈'auto','user'), created_at, I(exercise_id) — no syncCols; derived and
                 rebuildable, so it must not fight sync (15 §Data)
```

## Behaviour

1. Every PK is `TEXT` holding a 26-char Crockford-base32 **ULID** from `src/lib/ids.ts`, minted by the
   writer (usually the offline client, at capture time) and never rewritten. Lexicographic order is
   chronological to the millisecond, so `ORDER BY id` is a valid tiebreak. No
   `INTEGER PRIMARY KEY AUTOINCREMENT` anywhere — required by
   [r10 §2.5 RT-2](../docs/research/r10-import-export-formats.md), and it is what makes an offline
   write idempotent: replaying it is an upsert on the same PK. (r10 suggested UUIDv7; ULID wins
   because the photo `id` **is** the `{id}` segment of
   [r03 §5](../docs/research/r03-r2-uploads-and-image-delivery.md)'s verified R2 key scheme, and
   Workers' `crypto.randomUUID()` is v4 — random, not sortable. Both satisfy RT-2.)
2. Deviations from rule 1, all deliberate: `exercises.id` is `'fedb:<dataset id>'` for seeded rows so
   re-seeding is a deterministic `ON CONFLICT(id) DO UPDATE`, and `'usr:<ULID>'` for user rows;
   `streak_state` / `telegram_state` / `auth_throttle` / `gym_geofence` use the literal id
   `'singleton'` pinned by a CHECK, making "create if missing" an upsert with no read; `settings`
   (shipped) and `credentials` (shipped) are keyed by `user_id`; and `volume_weights`,
   `achievement_unlocks`, `schema_meta`, `weekly_reviews`, `monthly_report_cards`, `year_in_review`,
   `exercise_aliases` and `muscle_week_rollups` are keyed by their natural key.
3. **Sync, in full.** The server idempotency boundary is `mutations`. Every mutating call carries a
   client-minted mutation ULID; the handler inserts it **first**, and a PK conflict means "already
   applied" → return the stored `result_json` without re-running side effects. This is what makes the
   outbox safe to flush twice. Then, exactly:
   - **Conflict resolution** is last-write-wins on `updated_at`, tiebroken by `rev`, **per row** (not
     per field). A loser is stored as `status='conflict'` with its payload so `05-pwa-offline-sync.md`
     can surface it.
   - **`rev` is not decoration.** Every accepted UPDATE sets `rev = rev + 1` **in the same
     statement**; a write whose `client_rev` is less than the stored `rev` (with equal `updated_at`)
     is a conflict, not a silent overwrite. Without this the tiebreak is a no-op and per-row LWW
     degenerates into a coin flip on ties. Asserted in `conventions.test.ts`.
   - **`updated_at` is set explicitly by every writer**, client and server. `tsTouch()` gives it both
     a SQL INSERT default *and* drizzle's `$onUpdate` bump (verified present in
     `node_modules/drizzle-orm/column-builder.d.ts:211-217`, and verified to emit **no** DDL beyond
     the plain default), so an UPDATE that forgets it is still visible to the sync pull. That is a
     backstop, not the contract: for a row captured offline the origin device's clock is the truth, so
     appliers write the clamped client `updated_at` verbatim and must never lean on the default
     (`05-pwa-offline-sync.md` rule at line 376 says the same thing from the other side). `created_at`
     carries the same hazard — the DB default stamps *server* time on a row captured hours earlier —
     so the applier writes `created_at` explicitly too, clamped to
     `[serverNow − 365 d, serverNow + 300 s]`.
   - **Pull is a composite keyset**, never a single-value cursor:
     `WHERE (updated_at, id) > (:ts, :id)` — expanded as
     `updated_at > :ts OR (updated_at = :ts AND id > :id)` — `ORDER BY updated_at, id LIMIT :n`, and
     the cursor stored in Dexie `meta` is the pair `{ts, id}` of the last row returned. A
     finish-workout `db.batch()` commits `workouts` + N `sets` + PR + streak + XP at one
     epoch-millisecond, so many rows sharing one `updated_at` is the normal case here; advancing a
     single-value cursor to `max(updated_at)` would silently skip the rest of that millisecond
     forever. This matches `05-pwa-offline-sync.md` line 385 verbatim. Tested with 200 rows sharing
     one millisecond split across a page boundary.
4. **Instants** are `integer({mode:"timestamp_ms"})`, epoch-**milliseconds** UTC, surfaced as `Date`,
   column name ends `_at`. Never `mode:"timestamp"` — it `Math.floor`s to whole seconds and the rest
   timer needs sub-second (r02 §2.8); modelling them as `Date` is what stops a seconds/ms mix-up from
   compiling. Default is `sql\`(unixepoch() * 1000)\``, not the deprecated `defaultNow()`.
   **Wire contract:** because drizzle surfaces these as `Date` and `05-pwa-offline-sync.md` types
   every instant as `number`, `/api/sync/{batch,pull}` and every other JSON boundary carry an
   **epoch-ms integer**, never an ISO string. The conversion lives in exactly one module,
   `src/db/wire.ts` (`toWire`/`fromWire`); serialising a raw row is a lint-visible bug because
   `JSON.stringify(new Date())` yields an ISO string that `fromWire` rejects. Mirror rows in Dexie are
   the **wire** shape (numbers), so the "same names as D1" claim is about column *names*, not types.
5. **Local calendar days** are `TEXT 'YYYY-MM-DD'` in Asia/Almaty, column name ends `_day`/`_on`,
   computed by `toLocalDay()` at write time on `workouts`, `sets`, `body_measurements`,
   `food_entries`, `water_logs`, `daily_checkins`, `photos`, `streak_ledger`, `xp_ledger`,
   `personal_records`, `quests`, `gym_checkins`, `ai_prompt_logs`, `notification_log`,
   `nutrition_targets`, `tdee_estimates`. **Never derived from a UTC epoch in SQL**: Almaty is UTC+5,
   so local `00:00–05:00` belongs to the previous UTC date, which would drop a day from the streak and
   mis-bucket the heatmap — r09 §8 calls this the highest-risk bug in analytics.
   **The implementation, decided.** No tz library is installed (verified: no `luxon`, `date-fns-tz`,
   `@date-fns/tz`, `tzdata` or Temporal polyfill in `node_modules`) and r09 §8 forbids a runtime
   `Intl` dependency for a *stored* value, so `toLocalDay` is a **hardcoded two-era offset table**:
   `+06:00` for instants `< ALMATY_UTC5_FROM_MS`, `+05:00` at or after it, where
   `ALMATY_UTC5_FROM_MS = 1_709_229_600_000` (`2024-02-29T18:00:00Z` — the instant Kazakhstan's
   UTC+6 → UTC+5 change took effect; local time went from `2024-03-01T00:00+06:00` back to
   `2024-02-29T23:00+05:00`). Verified exact against Node's own IANA tzdata for **every 5-hour step
   from 2005-01-01 to 2031-01-01: zero mismatches.** Kazakhstan observed DST before 2005, which the
   table cannot express, so `toLocalDay` **throws** below `ALMATY_ERA_FLOOR_MS`
   (`2005-01-01T00:00:00Z`) rather than returning a wrong day; an importer hitting that rejects the
   row with a named error. `Intl.DateTimeFormat` appears **only** in `conventions.test.ts` as a
   cross-check oracle, never in shipped code. Format is CHECKed with a GLOB pattern on every new
   table (`users.birth_day`, shipped without one, is the documented exception).
6. **JSON columns are plain `text(n)`; `mode: "json"` is banned.** Verified in
   `node_modules/drizzle-orm/sqlite-core/columns/text.js:48`: `SQLiteTextJson.mapFromDriverValue`
   calls `JSON.parse` **inside drizzle's result mapping**, so one malformed row throws and takes the
   *entire* `SELECT` with it — `tryParseJson` never runs and the raw text is unreachable by the time
   app code is called. That is the exact opposite of the degraded-row promise in §UX notes, and rule
   6's own rationale (rows "from an import, a restore or an older `schema_version`") names precisely
   the rows that would crash instead of degrade. The SQL type is `text` either way, so this costs no
   migration. Consequences: the TS type of a JSON column is `string`, every read goes through
   `parseJson`/`tryParseJson` and every write through `toJson`, and `.$type<T>()` is still banned
   because it would assert a shape imported rows do not have.
   **The byte cap is `B(col)` = `CHECK (length(CAST(col AS BLOB)) <= 65536)`, not `length(col)`.**
   Verified on SQLite 3.50.4: for a 6-character Cyrillic string `length()` is `6` while
   `length(CAST(x AS BLOB))` is `12`. This is an RU-default app (`locale='ru'`), so `notes`,
   `name_ru` and Russian AI output are ~2 bytes/char and `length(col) <= 65536` would really cap at
   ~128 KB. `octet_length()` also works on 3.50.4 but D1's SQLite build version is unpublished, so the
   portable `CAST … AS BLOB` form is the one that ships. Verified that drizzle-kit 0.31.10 emits it
   verbatim inside `CREATE TABLE`. `toJson` enforces the same cap in UTF-8 bytes before the write, so
   a writer never has to be truncated into an unqueryable row; anything genuinely larger (a full AI
   response) goes to R2 and the column keeps the key (`ai_prompt_logs.output_r2_key`) — D1's row cap
   is 2 MB.
7. **Booleans** are `integer({mode:"boolean"})`. drizzle-kit emits `DEFAULT false`, storing integer
   `0`; that D1's SQLite build accepts the `false` keyword is UNVERIFIED (r02 §2.8) — hence the probe
   in Verification. 0000 already ships `ok integer DEFAULT false NOT NULL`, so the repo has bet on it.
8. **Three numeric kinds, one rule each.**
   (a) **Logged and measured** masses/lengths are `REAL`, `_kg` and `_cm`, because every formula and
   test vector in r09 is defined on kg doubles and the export contract fixes the column name and unit
   (r10 §2.1 rule 1); integer kg is impossible with 1.25 kg microloading (r02 §2.8).
   (b) **Equipment configuration** masses are `INTEGER` **grams** (`bar_mass_g`, `ez_bar_mass_g`,
   `increment_g`, and the already-shipped `barbell_increment_g`), because plate math is exact subset
   arithmetic and must not accumulate float error while summing eight plates.
   (c) **Quantities are `REAL`; derived energy and macro totals the user reads back are `INTEGER`.**
   Exhaustively, so the rounding test has an unambiguous input set:
   · `REAL` quantities — `meal_template_items.grams`, `food_entries.grams`, `foods.serving_grams`,
   `foods.kcal_100g`, `foods.protein_100g`, `foods.carb_100g`, `foods.fat_100g`, `foods.fiber_100g`,
   `foods.sugar_100g`, `foods.sat_fat_100g`, `foods.sodium_mg_100g`, `daily_checkins.sleep_hours`,
   `tdee_estimates.*_kcal` and `mean_intake_kcal`, `food_entries.delta_pct`,
   `muscle_week_rollups.credited_*`.
   · `INTEGER` derived totals — `food_entries.{kcal, protein_g, carb_g, fat_g, fiber_g, delta_kcal}`,
   `water_logs.ml`, `nutrition_targets.{kcal, protein_g, carb_g, fat_g, fiber_g, water_ml}`,
   `xp_ledger.xp`.
   The earlier draft of this rule listed `grams` as a "reference value from an external database",
   which was wrong: a hand-typed "150 g" is the single most user-entered number in the module. It is a
   quantity, so it is `REAL`.
   · `unitReal` — `0..1` scalars with a `BETWEEN 0 AND 1` CHECK: `volume_weights.credit`,
   `foods.confidence`, `food_entries.confidence`. The convention is **fractions, never percent**:
   `0.85`, and `85` is rejected by the CHECK (rule 24 / unit case `confidence`).
   Rounding of the INTEGER bucket happens once, at write, round-half-up, so a day's ring total is
   exactly the sum of the per-item numbers on screen — a total that disagrees with its visible parts
   by 3 kcal reads as a bug. `tdee_estimates` is deliberately **not** in that bucket: it is a model
   output, and truncating `2697.5` would defeat the sign-error vector (rule 32).
9. **Float comparison.** Plate-sized values (0.25/0.5/1.25/2.5 kg) are dyadic and so exact in
   binary64, but sums and e1RM are not. Never round before comparing (r09 §1) and never compare with a
   bare `>`: a PR requires `candidate > best + PR_EPSILON_KG (0.01)` for
   `e1rm`/`max_weight`/`session_volume`, and an exact integer compare for `max_reps`. 0.01 kg is below
   the smallest displayable difference and ~10 orders of magnitude above binary64 noise at these
   magnitudes, so detection can neither flap on noise nor miss a real increase. `e1rm_kg` is stored at
   write time and never recomputed inside a query.
10. `sets.e1rm_kg` is **`NULL`, not `0`**, whenever the number would be dishonest: `reps > 12`,
    `reps < 1`, `reps >= 37` (Brzycki's pole → `Infinity`, which poisons every `max()` forever),
    `load_mode ∈ {duration, distance}`, or effective load ≤ 0. `sets_e1rm_finite` is the database
    backstop against an `Infinity` or a negative landing in the column. Effective load is
    `(load_mode needs bodyweight ? workouts.bodyweight_kg : 0) + weight_kg − assist_kg`; `assist_kg`
    exists because assisted machines display *assistance*, and folding it into `weight_kg` inverts the
    whole progression (r09 §1 gotchas). **`e1rm_source` is written with it and is NULL exactly when
    `e1rm_kg` is NULL** (`CHECK ((e1rm_kg IS NULL) = (e1rm_source IS NULL))`), because the brief's
    e1RM is `max(Epley, Brzycki, RPE-table)` — three epistemically different estimators — and r09 §2
    states outright that without the label *"a 'PR' the user disputes is undiagnosable"*. 07 owns the
    `E1rmSource` union; 12 rule 18's hollow dot reads this column instead of proxying it with
    `rir > 0`.
11. **No new `ON DELETE CASCADE`; every FK added here is `onDelete:"restrict"`.** From r02 §4.1:
    `wrangler d1 migrations apply` runs a file as one transaction, `PRAGMA foreign_keys=OFF` is a
    documented no-op inside a transaction, and `DROP TABLE` performs an implicit `DELETE FROM` that
    *does* fire ON DELETE actions — so drizzle-kit's 12-step recreate of a parent silently deletes
    every child row while reporting success (reproduced: 3 sets → 0). Under `RESTRICT` that same
    implicit delete raises a FK violation and the whole migration transaction rolls back, converting
    the most dangerous thing in this stack from silent data loss into a loud failure. Consequence: any
    migration recreating a table with inbound FKs will fail, which is intended — it must be
    hand-written (stage child rows out and back, or restate the child FKs in the same file) and pass
    rule 21.
12. Two cascades are **grandfathered**: `settings.user_id` and `sessions.user_id`, both in 0000;
    `credentials.user_id` (0001) is a third. Tolerable because `users` holds exactly one row that is
    never deleted and all three children are regenerable metadata, not history — but a recreate of
    `users` would still drop them, so such a migration must be hand-written. See open question 3.
13. `CHECK` is used on **enum domains frozen by an external dataset** (`muscle`, `role`, `equipment`,
    `category`, `level`, `photos.kind`, `pose`), on **structural invariants** (`local_day`/`iso_week`
    GLOB, singleton ids, JSON byte caps, `sets` sanity ranges, `0..1` scalars, the
    `e1rm_kg`/`e1rm_source` pairing) and on **two enums whose values the UI branches on where a wrong
    value is a silent wrong total** (`food_entries.status`, `food_entries.meal_slot`,
    `foods.basis`) — and on nothing else. App-owned enums likely to grow (`set_type`, `pr_kinds`,
    `goals.kind`, `xp_ledger.source_kind`, `E1RM_SOURCES`, `PRIMARY_GOALS`) are validated by Zod at
    the write boundary only, because SQLite cannot `ALTER TABLE ADD CONSTRAINT` and adding a CHECK
    later triggers the rule-11 recreate. Corollary: **a CHECK on a table with inbound FKs, or on any
    already-shipped table, must be in that table's first migration or never.** That is why every
    `settings` column added above carries no CHECK. `text(…, {enum})` is type-level only and emits no
    DDL — the CHECK is separate and both must be written. drizzle-kit 0.31.10 does emit
    `CONSTRAINT "name" CHECK(expr)` inside SQLite `CREATE TABLE` (verified by generating one), so
    these are real DDL and not decoration.
14. UNIQUE constraints exist to make a replayed offline write a no-op rather than a duplicate:
    `mutations.id`, `daily_checkins.local_day`, `streak_ledger.local_day`,
    `xp_ledger(source_kind, source_id)`, `achievement_unlocks.achievement_key`,
    `quests(week_start_day, key)`, `tdee_estimates(week_ending, computed_at)`,
    `nutrition_targets.effective_on`, `notification_log(channel, kind, local_day)`,
    `cron_runs(job, scheduled_at)`, `personal_records(origin_key, kind)`,
    `push_subscriptions.endpoint`, `photos.r2_key`, `exercise_media.r2_key`,
    `foods(source, source_id)`, `exercises(source, source_id)`, `exercises.slug`,
    `sets(workout_exercise_id, position)`, `workout_exercises(workout_id, position)`,
    `routine_exercises(routine_id, position)`, `import_staging(batch_id, table_name, row_index)`,
    `import_batches(sha256) WHERE status='applied'`, `import_key` on `workouts`,
    `body_measurements`, `food_entries`, `daily_checkins`, and the two partial uniques
    `auth_credentials(kind)` and `fasting_sessions(ended_at) WHERE ended_at IS NULL`.
15. `personal_records`' partial unique index on `(exercise_id, kind) WHERE is_current = 1` makes "one
    current best per exercise per kind" a database guarantee; promotion is one `db.batch()` (clear the
    old flag, insert the new row). `body_measurements` deliberately has **no** uniqueness on
    `local_day` — r09 §4 averages multiple same-day readings before the EMA, so one row per day would
    silently discard weigh-ins.
16. **Index contract.** `tests/db/index-coverage.test.ts` runs `EXPLAIN QUERY PLAN` for every row
    below and asserts the plan **contains the exact expected string**, positively. It must never
    assert the absence of `SCAN TABLE`: verified on SQLite 3.50.4 that a genuine full table scan
    reports `SCAN sets`, so a `SCAN TABLE` assertion is a no-op that passes on an unindexed schema.
    Where a scan is legitimate the expected plan string is pinned exactly, and the suite carries a
    **negative fixture** — drop the index, re-run, expect failure — so the test is proven able to
    fail.
    Every query in the table already carries rule 25's mandatory `AND deleted_at IS NULL`, because
    measured on SQLite 3.50.4: `SELECT weight_kg, reps, e1rm_kg FROM sets WHERE exercise_id=?` gives
    `SEARCH sets USING COVERING INDEX …`, and adding `AND deleted_at IS NULL` degrades it to
    `SEARCH sets USING INDEX …`. **Appending `deleted_at` as the trailing index column restores
    `USING COVERING INDEX`; making the index partial does not** (measured: a partial
    `WHERE deleted_at IS NULL` index still reports plain `USING INDEX`). Hence the trailing
    `deleted_at` on `sets_exercise_id_completed_at_idx`, `sets_local_day_exercise_id_idx`,
    `workouts_local_day_idx`, `photos_kind_taken_at_idx` and `body_measurements_local_day_idx`.
    **No index exists without a justification here**, and that is mechanical, not aspirational: the
    test enumerates `getTableConfig(t).indexes` for all 53 tables and fails on any index that is
    neither a P-row below, nor a `<t>_updated_at_id_idx` (P12), nor a rule-14 UNIQUE. Every index
    costs the logging path and `sets` is the write-hot table.

| # | Pattern | Query shape | Index | Expected plan fragment |
|---|---|---|---|---|
| P1 | Date-range workout feed | `workouts WHERE local_day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY local_day DESC` | `workouts_local_day_idx` | `SEARCH workouts USING INDEX workouts_local_day_idx` |
| P2 | Calendar heatmap counts | `SELECT local_day, count(*) FROM workouts WHERE deleted_at IS NULL GROUP BY 1` | `workouts_local_day_idx` (`local_day, deleted_at`) | `SCAN workouts USING COVERING INDEX workouts_local_day_idx` — a full index scan is correct here; the table is never touched |
| P3 | Per-exercise history / **ghosting** | `sets WHERE exercise_id=? AND deleted_at IS NULL ORDER BY completed_at DESC LIMIT 12` | `sets_exercise_id_completed_at_idx` | `SEARCH sets USING COVERING INDEX sets_exercise_id_completed_at_idx` |
| P4 | e1RM progression curve | `sets WHERE exercise_id=? AND completed_at>? AND deleted_at IS NULL` | same | `SEARCH sets USING COVERING INDEX sets_exercise_id_completed_at_idx` |
| P5 | Rolling-7-day volume per muscle | `sets JOIN exercise_muscles USING(exercise_id) WHERE sets.local_day BETWEEN ? AND ?` | `sets_local_day_exercise_id_idx` drives; `exercise_muscles` PK prefix serves the join | `SEARCH sets USING INDEX sets_local_day_exercise_id_idx` + `SEARCH exercise_muscles USING PRIMARY KEY` |
| P6 | Muscle drill-down (tap a muscle) | `exercise_muscles WHERE muscle=?` | `exercise_muscles_muscle_role_exercise_id_idx` | `SEARCH exercise_muscles USING COVERING INDEX` |
| P7 | Current PRs | `personal_records WHERE is_current=1` | `personal_records_exercise_id_kind_uq` (partial) | `SCAN personal_records USING COVERING INDEX personal_records_exercise_id_kind_uq` — a partial-index scan; the table has one row per exercise×kind so a scan is correct |
| P8 | PR feed / set-level PR flags | `personal_records ORDER BY achieved_at DESC` · `sets WHERE is_pr=1` | `personal_records_achieved_at_idx` · `sets_is_pr_idx` (partial) | `SCAN personal_records USING INDEX personal_records_achieved_at_idx` · `SCAN sets USING INDEX sets_is_pr_idx` |
| P9 | Session detail | `workout_exercises WHERE workout_id=?` then `sets WHERE workout_id=?` | `workout_exercises_workout_id_idx`, `sets_workout_id_idx` | `SEARCH … USING INDEX <name>` each |
| P10 | Day nutrition / macro rings | `food_entries WHERE local_day=? AND status='confirmed'` · `water_logs WHERE local_day=?` | `food_entries_local_day_status_eaten_at_idx`, `water_logs_local_day_idx` | `SEARCH … USING INDEX <name>` each |
| P11 | Bodyweight trend | `body_measurements WHERE local_day>? AND deleted_at IS NULL ORDER BY local_day` | `body_measurements_local_day_idx` | `SEARCH body_measurements USING INDEX body_measurements_local_day_idx` |
| P12 | Sync pull (keyset) | `<t> WHERE updated_at>? OR (updated_at=? AND id>?) ORDER BY updated_at, id` | `<t>_updated_at_id_idx` on every syncable table | `SEARCH <t> USING INDEX <t>_updated_at_id_idx` |
| P13 | Barcode lookup | `foods WHERE barcode=?` | `foods_barcode_idx` | `SEARCH foods USING INDEX foods_barcode_idx` |
| P14 | Photo timeline / compare slider | `photos WHERE kind='progress' AND deleted_at IS NULL ORDER BY taken_at DESC` | `photos_kind_taken_at_idx` | `SEARCH photos USING INDEX photos_kind_taken_at_idx` |
| P15 | R2 GC sweep | `photos WHERE deleted_at IS NOT NULL AND r2_purged_at IS NULL` | `photos_deleted_at_idx` (partial, rule 26) | `SCAN photos USING INDEX photos_deleted_at_idx` |
| P16 | Session list / revoke-all | `sessions WHERE user_id=?` | `sessions_user_idx` (grandfathered name) | `SEARCH sessions USING INDEX sessions_user_idx` |
| P17 | Expired-session cleanup cron | `sessions WHERE expires_at < ?` | `sessions_expires_idx` (grandfathered) | `SEARCH sessions USING INDEX sessions_expires_idx` |
| P18 | Cron history for a job | `cron_runs WHERE job=? ORDER BY started_at DESC` | `cron_runs_job_started_idx` (grandfathered) | `SEARCH cron_runs USING INDEX cron_runs_job_started_idx` |
| P19 | Cron replay guard | `cron_runs WHERE job=? AND scheduled_at=?` | `cron_runs_job_slot_idx` (grandfathered UNIQUE, `_idx` suffix) | `SEARCH cron_runs USING INDEX cron_runs_job_slot_idx` |
| P20 | Equipment filter in the library | `exercises WHERE equipment=? AND deleted_at IS NULL` | `exercises_equipment_idx` | `SEARCH exercises USING INDEX exercises_equipment_idx` |
| P21 | Program day board | `routines WHERE program_id=? ORDER BY day_index` · `routine_exercises WHERE exercise_id=?` | `routines_program_id_day_index_idx`, `routine_exercises_exercise_id_idx` | `SEARCH … USING INDEX <name>` each |
| P22 | AI spend + bias aggregates | `ai_prompt_logs WHERE created_at>=?` · `… WHERE feature=? AND created_at>=?` · `… WHERE prompt_version=? AND model=?` | `ai_prompt_logs_created_at_idx`, `ai_prompt_logs_feature_created_at_idx`, `ai_prompt_logs_prompt_version_model_idx` | `SEARCH ai_prompt_logs USING INDEX <name>` each |
| P23 | Import staging read-back / rollback | `import_staging WHERE batch_id=? AND table_name=?` · `<t> WHERE import_batch_id=?` | `import_staging_batch_id_table_name_idx`, `<t>_import_batch_id_idx` | `SEARCH … USING INDEX <name>` each |
| P24 | Muscle-week chart · alias match · coach feed · goals · gym days | `muscle_week_rollups WHERE iso_week=?` · `exercise_aliases WHERE exercise_id=?` · `coach_insights WHERE status=?` and `WHERE generation=? ORDER BY created_at` · `goals WHERE kind=? AND ends_on>=?` · `gym_checkins WHERE local_day=?` · `body_measurements WHERE measured_at>?` · `food_entries WHERE photo_id=?` / `WHERE food_id=?` · `foods WHERE slug=?` · `photos WHERE sha256=?` · `water_logs WHERE logged_at>?` · `fasting_sessions WHERE started_at>?` · `mutations WHERE received_at>?` · `auth_events ORDER BY at_ms DESC` | `muscle_week_rollups_iso_week_idx`, `exercise_aliases_exercise_id_idx`, `coach_insights_status_idx`, `coach_insights_generation_created_at_idx`, `goals_kind_ends_on_idx`, `gym_checkins_local_day_idx`, `body_measurements_measured_at_idx`, `food_entries_photo_id_idx`, `food_entries_food_id_idx`, `foods_slug_idx`, `photos_sha256_idx`, `water_logs_logged_at_idx`, `fasting_sessions_started_at_idx`, `mutations_received_at_idx`, `auth_events_at_ms_idx` | `SEARCH … USING INDEX <name>` each |

17. **`drizzle-kit generate` creates; `wrangler d1 migrations apply` applies. No exceptions.**
    `drizzle.config.ts` has no `driver` and no `dbCredentials`, making it structurally impossible for
    drizzle-kit to reach a database (r02 §2.4) — which also means `npm run db:studio` cannot connect
    to remote D1; if that is ever wanted it needs a separate `drizzle.config.studio.ts` CI never sees,
    never a `driver` bolted onto the main config. Never `drizzle-kit push`, never `drizzle-kit
    migrate`, never `wrangler d1 migrations create` — it numbers from the max file prefix while
    drizzle numbers from `meta/_journal.json`, and they collide (verified, r02 §4.5).
    `drizzle-kit generate` must **never** run in CI: an ambiguous rename prompts and dies with
    `Interactive prompts require a TTY terminal` (r02 §4.12). `out` must stay equal to
    `wrangler.jsonc`'s `migrations_dir` (`drizzle/migrations`).
18. **An applied migration file is immutable.** `d1_migrations` records the filename, not a content
    hash, so an edit is never noticed and never reapplied (r02 §4.4). Fix forward with a new file.
    Order is always `db:generate` → **read the generated SQL** → `db:migrate:local` → app works →
    `db:snapshot` → commit → CI `db:verify` **plus a snapshot-freshness diff** →
    `db:migrate:remote` → `db:verify:live`.
19. `db:verify` replays `drizzle/migrations/*.sql` and `drizzle-kit export --sql` into two in-memory
    `node:sqlite` databases and compares `pragma_table_info`/`index_list`/`index_info`/
    `foreign_key_list` as order-independent sets. **This spec extends r02's script three ways**: it
    also diffs normalised `sqlite_master.sql` (the pragma-only fingerprint is blind to CHECK
    constraints — exactly where rule 13 lives); `MIGRATIONS_DIR` is `drizzle/migrations`, not r02's
    `migrations`, so the `OK:` line names the real path; and `--against=<file>` fingerprints a
    `wrangler d1 export` dump instead of `drizzle-kit export`, which is how the live check runs.
    `--write` regenerates `docs/db/schema.snapshot.sql`, and **CI fails when the committed snapshot
    differs from a fresh `--write`** — without that check rule 18's deploy-time reference can sit
    stale forever and nobody finds out.
    `IGNORE_TABLES = {d1_migrations, __drizzle_migrations, _cf_KV, revalidations}`. The OpenNext tag
    cache already has its own database, keeping `revalidations` out of our schema (r02 §3 rule 7) —
    do not repoint `NEXT_TAG_CACHE_D1` at `fitness-pwa-db`.
20. `db.transaction()` is banned by the `no-restricted-syntax` rule this spec adds to
    `eslint.config.mjs` (exact selector and message in §Files to modify): it compiles and then fails
    at runtime because D1 is auto-commit only (r02 §4.6). `db.batch()` is the only atomic unit, and
    every all-or-nothing operation — "finish workout" = `workouts` update + N `sets` +
    `personal_records` promotion + `streak_ledger` upsert + `xp_ledger` insert — must fit one batch
    inside **100 bound parameters per statement** and **1000 statements per invocation**. Guard
    `db.batch([])`; an empty final chunk throws (r02 §4.8). Parameterised multi-row inserts cap at
    `floor(100 / columnCount)` — for `sets`' 26 columns that is **3 rows**, not the ~250 a 100 KB
    reading suggests (r02 §4.7); bulk paths use literal SQL.
21. **ASK BEFORE breaking changes.** `scripts/check-migration-safety.mjs` fails CI when a migration
    contains `DROP TABLE`, `DROP COLUMN`, `__new_`, `PRAGMA foreign_keys`, a `NOT NULL` added to an
    existing column, a new `UNIQUE` on a populated table, or a column type change — unless the file's
    first line is `-- APPROVED-BREAKING: <owner decision, date, reason>`. Adding that line requires
    stopping and asking the owner in-session, with the generated SQL and a row-count impact estimate.
    Additive changes (new table, new nullable column, new column with a **constant** default — the
    only form SQLite's `ALTER TABLE ADD COLUMN` accepts, which is why every `settings` addition above
    has a literal default — and new indexes) need no gate. An id-format change is always breaking.
    **The `__new_` tripwire fires on *any* drizzle-kit CHECK / UNIQUE / NOT NULL / type / default
    change on an existing table, not only on hand-written DDL.** Measured with drizzle-kit 0.31.10:
    adding one column *plus* a table-level CHECK to an existing `settings` emitted
    `PRAGMA foreign_keys=OFF;` → `CREATE TABLE __new_settings … CONSTRAINT … CHECK(…)` →
    `INSERT INTO __new_settings(…) SELECT … FROM settings` → `DROP TABLE settings` → rename →
    `PRAGMA foreign_keys=ON;` — three tripwires at once, and the `SELECT` even names the
    not-yet-existing column, so the migration would fail outright. That is the whole reason rule 13's
    corollary exists and why no `settings` addition here carries a CHECK.
22. Exercise seeding is a dev-machine script, never a Worker: pinned commit
    `a859101d633a01c4a1a920d6a8ce41dabba0705f`, sha256
    `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`, expected 876 records and 1746
    images ([r07 seeding plan](../docs/research/r07-exercise-dataset.md)). `scripts/seedgen.mjs` emits
    `seed/exercises.sql` with **literal values** (zero bound parameters), ≤ 90 KB per statement,
    parents before children, and **no `BEGIN`/`COMMIT`** — D1 rejects a transaction inside a
    transaction. Applied with an explicit target flag, which is never optional:
    `wrangler d1 execute fitness-pwa-db --local --file=seed/exercises.sql` (and `--remote -y` for
    production). Omitting `--local`/`--remote` is the mistake that seeds the wrong database.
23. Seeding is idempotent via `INSERT … ON CONFLICT(id) DO UPDATE SET`, **never `INSERT OR REPLACE`**
    (a DELETE+INSERT — how you lose logged sets). `exercise_muscles`/`exercise_media` rows for seeded
    ids are deleted and re-inserted; they hold no user data. Re-seed statements only ever touch
    `WHERE source = 'free-exercise-db'`. One `exercises` table holds seeded and user rows (not r07's
    or 08's two-table split) because fuzzy search, filters, import matching and every `sets.exercise_id`
    FK would otherwise need a UNION; `source` plus the id prefix gives the split's isolation without
    the join cost. The D1 SQL docs do not state UPSERT support explicitly (r07 step 3), so
    **Verification step 6b probes it remotely before any seed runs** — the singleton-upsert pattern in
    rule 2 depends on the same feature.
24. Zod enums are the seed-time drift detector: a new upstream muscle, equipment or category must
    **throw**, never default. Upstream `schema.json` is draft-04 tuple form and validates only array
    element 0, so it must not be trusted (r07 gotcha 2). Seed tolerates the measured edges: null
    `force`/`mechanic`/`equipment`, `images: []` (3 records), `instructions: []` (5 records), two
    `primaryMuscles` (1 record). `volume_weights` is seeded `primary = 1.0`, `secondary = 0.5` from
    `seed/volume_weights.sql`; the *value* is 07's decision, the *seeding* is this spec's.
25. **Soft delete is the default for all user data**: `deleted_at` epoch-ms, never a row removal;
    queries filter `deleted_at IS NULL`. Hard delete is allowed in exactly six places:
    `push_subscriptions` on a 404/410 from the push service (r06), `exercise_muscles`/`exercise_media`
    on re-seed, `import_staging` after a successful swap, expired `sessions` (cleanup cron), and
    retention purges of `cron_runs` (90 days) and `ai_prompt_logs` (365 days, only once the row is in
    an R2 backup).
26. R2 objects are never deleted in a request. A cron sweeps
    `photos WHERE deleted_at IS NOT NULL AND r2_purged_at IS NULL` (`photos_deleted_at_idx`, P15),
    batch-deletes the key prefix (r03 §6), and **stamps `r2_purged_at`** so the row leaves the sweep
    predicate. Without that watermark the row matches forever, every run re-issues billed Class A
    deletes for keys already gone, and the partial index grows monotonically; `photos` is not in rule
    25's hard-delete list, so the row itself stays. Keys are never reused — a re-crop mints a new id —
    which is what licenses `Cache-Control: immutable`. Import/restore (r10 RT-6) stages into
    `import_staging`, validates counts and FKs, then wipe-and-swaps in one `db.batch()`, reusing every
    `id` verbatim and **never minting an R2 key**.
27. **Cross-spec name reconciliation.** Several sibling specs were drafted against names that differ
    from this one. This spec is authoritative; the table records which name won, and which spec must
    be edited. No implementer should have to guess.

| Their name | Winner (here) | Why | Must change |
|---|---|---|---|
| `local_date` (06, 07, 10, 12, 15) | **`local_day`** | This spec's own suffix rule is `_day`/`_on`, and it is already shipped as `users.birth_day`; `week_start_day`/`week_ending` would otherwise read inconsistently | 06, 07, 10, 12, 15 |
| `tdee_snapshots` (02 draft, 14) | **`tdee_estimates`** | 07 and 11 both own this table's producers and both call it `tdee_estimates`; 14 only writes it | 14 |
| `tdee_est` / `tdee_data` / `prior` (02 draft) | **`tdee_kcal` / `tdee_data_kcal` / `prior_kcal`** | 07's explicit column list; the `_kcal` suffix is this spec's unit rule | — |
| `meals` / `meal_items` (02 draft) | **`meal_templates` / `meal_template_items`** | 11's names, and the draft's own comment already said "meal TEMPLATES" | — |
| `food_entries.calories/protein/carbs/fat` (11) | **`kcal` / `protein_g` / `carb_g` / `fat_g`** | 12 reads the `_g` names, and rule 8 hangs the rounding guarantee on unit-suffixed columns; a macro column with no unit is exactly the ambiguity this spec exists to remove | 11 |
| `food_entries.slot` (02 draft) | **`meal_slot`** | 11's name; `slot` alone is meaningless next to `superset_group` | — |
| `foods.source_ref` / `source_fetched_at` (11) | **`source_id` / `fetched_at`** | Matches `exercises.source_id` and the shared `U(source, source_id)` shape | 11 |
| `foods.fdc_id` (11 index request) | **no such column** | `U(source, source_id)` with `source='fdc'` already serves it; a second column would be a second truth | 11 |
| `sets.type` (09, 13) | **`set_type`** | `type` is a reserved-ish word and ambiguous against `pr_kinds`; 06 and 07 already use `set_type` | 09, 13 |
| `exercises_catalog` / `exercises_custom` / `exercise_images` / `exercise_prefs` (08) | **`exercises` / `exercise_media` / `exercises.is_favourite`** | Rule 23: one table, because every `sets.exercise_id` FK and every filter would otherwise need a UNION | 08 |
| `sync_ops` (05) | **`mutations`** | Already flagged to 01 by 06; `mutations` is the shipped-spec name and 05's Dexie store is a different object | 05 |
| `streaks` (15 export list) | **`streak_state` + `streak_ledger`** | Two tables, one cache and one ledger (13 §9) | 15 |
| `settings.sex` / `settings.height_cm` (10) | **`users.sex` / `users.height_cm`** | Shipped on `users` in 0000 | 10 |
| `settings.default_bar_kg` (09) | **`settings.bar_mass_g`** | Rule 8(b): configuration masses are integer grams | 09 |
| `app_user` (14 read list) | **`users`** | Shipped name | 14 |

28. **`credentials` → `auth_credentials`, with a stated data move.** The shipped `credentials` table
    is single-row (`user_id` PK) and cannot hold 04-auth's eight `kind='recovery'` rows, one
    `'password'`, one `'totp'` and future `'passkey'` rows, so it is superseded rather than extended.
    Migration `0002` therefore (a) creates `auth_credentials`, (b) adds
    `settings.session_version INTEGER NOT NULL DEFAULT 1`, and (c) carries the live row across with
    hand-written SQL in the same file:
    `INSERT INTO auth_credentials(id, user_id, kind, material, created_at) SELECT …, user_id,
    'password', 'pbkdf2-sha256$' || password_iterations || '$' || password_salt || '$' ||
    password_hash, created_at FROM credentials`, the same for `'totp'` from `totp_secret` (with
    `counter = last_totp_step`), and
    `UPDATE settings SET session_version = (SELECT session_version FROM credentials)`. `credentials`
    is then **frozen and unread** — not dropped, because `DROP TABLE` is rule-21 gated and 04's code
    is still live at 0002 time. Dropping it is a separate, explicitly `-- APPROVED-BREAKING`
    migration once 04 ships, and `verify-schema.mjs` will flag it until then as a table with no
    schema counterpart, which is why it stays declared in `core.ts`.
29. **`settings.ai_provider` is deliberately absent.** The brief's contract is *"one module exports
    `getVisionModel()`/`getTextModel()` reading `AI_PROVIDER` … swappable by env change alone"*, and
    `wrangler.jsonc` already ships `vars.AI_PROVIDER = "google"`. A DB column would make that claim
    false and give two selectors that can silently disagree. The env var is the single source; 11
    owns the abstraction. Flagged to 11's owner.
30. **No coordinate history, ever.** `workouts.gym_lat`/`gym_lon` are **removed** before the first
    migration, per 13 §24 and its required-addition 8: distance is computed in the browser, the
    check-in payload schema is `.strict()` so a `lat`/`lng` field is a 400, and the only coordinate in
    D1 is `gym_geofence`'s single overwritable row at 4 dp. The workout row keeps only
    `gym_within_geofence?` and `gym_distance_bucket?`; anything richer joins `gym_checkins` on
    `local_day`. This had to be settled now: rule 11 guarantees that recreating `workouts` — the most
    FK-encumbered table in the schema — to drop two columns would fail, so after 0002 is applied the
    columns would be permanent.
31. **`personal_records.origin_key` replaces `set_id` as the replay guard.** `set_id` is nullable and
    SQLite treats NULLs as distinct in a UNIQUE index, so `U(set_id, kind)` guards nothing for an
    imported Hevy/Strong history row, a manual entry, or an aggregate `session_volume` PR — a replayed
    import could insert unlimited duplicates. `origin_key` is NOT NULL and is the set id when there is
    one, otherwise `'<import_batch source>:<import_key>'` or `'manual:<ULID>'`; `U(origin_key, kind)`
    is the guard. `set_id` stays, nullable, as the FK for drill-down. Tested with a double-applied
    import batch, not only with a double-written set.
32. **A week's TDEE estimate is correctable by appending.** `U(week_ending, computed_at)` replaces
    `U(week_ending)`: Cloudflare does retry crons (which is why `cron_runs U(job, scheduled_at)`
    exists), a user can edit past intake, and a fixed bug must be able to produce a new number. r09
    §5 step 6's "never overwrite" means *keep the history*, not *one row per week forever*. The table
    stays append-only — no UPDATE, and it is correctly absent from rule 25's hard-delete list. **Every
    reader takes the newest row for the week**: `ORDER BY week_ending DESC, computed_at DESC LIMIT 1`
    for the card, and a `MAX(computed_at)` groupwise filter for a series; `nutrition_targets` pins the
    exact row it used via `tdee_estimate_id`, so a past target is reproducible.
33. **Editing `exercises.load_mode` invalidates stored e1RM, and that is handled, not ignored.**
    `load_mode` is seeded heuristically, so the user correcting it is the *expected* case, and rule 10
    makes `e1rm_kg` depend on it while rule 9 freezes it at write time. Therefore a `load_mode` change
    is a mutation of kind `exercise.load_mode_change` whose applier, in the same request: recomputes
    `e1rm_kg` **and** `e1rm_source` for every non-deleted `sets` row of that exercise in chunked
    `db.batch()` calls (≤ 1000 statements, ≤ 100 bound params each), re-runs PR detection for that
    exercise, bumps each touched row's `rev` and `updated_at` so the change reaches the client, and
    writes one `notification_log`-style in-app note naming how many sets moved. `e1rm_source` makes
    every number attributable, so a disputed PR is diagnosable. Tested: flipping `load_mode` leaves no
    `sets` row whose stored `e1rm_kg` differs from a fresh recompute.

## Data

This spec *is* the canonical D1 definition. It does **not** define bindings.

- **Bindings are owned by [`01-architecture.md` §Binding registry](./01-architecture.md)**, which
  declares itself the single source of truth for bucket and namespace names, and `wrangler.jsonc` is
  outside this spec's scope. The earlier draft invented `APP_CACHE`, `PHOTOS`+`MEDIA`+`BACKUPS`
  against a `wrangler.jsonc` that ships only `CACHE_KV` and `MEDIA`, and 12 has already propagated
  the phantom `APP_CACHE`. The real names, from 01: KV **`CACHE_KV`** and **`NUTRITION_CACHE`**; R2
  **`PHOTOS`**, **`EXERCISE_MEDIA`**, **`BACKUPS`**. Code that reads `env.APP_CACHE` gets
  `undefined`. Reconciling `wrangler.jsonc` (today: one `MEDIA` bucket) to 01's registry is 01's job
  and must land before any spec reads `env.PHOTOS`.
- **Key and prefix shapes this spec fixes** (the names are 01's; the shapes are ours, because they
  mirror columns defined here): `CACHE_KV` → `dash:v1:<local_day>`, `tdee:v1:<week_ending>`;
  `NUTRITION_CACHE` → `off:p:v2:<gtin13>`, `off:m:v2:<gtin13>` (miss), `fdc:f:v1:<fdcId>`
  (r08 §5.3; `expirationTtl` minimum is 60 s). Every key is version-prefixed so a shape change is a
  prefix bump rather than a stale-shape parse. KV is volatile and `foods` is durable, so a cold KV
  never loses history.
- **R2 prefixes that mirror a column defined here**: `PHOTOS` →
  `photos/{progress|food}/{yyyy}/{mm}/{ULID}/{display|thumb|orig}.{ext}` (r03 §5) — the `{ULID}` is
  `photos.id`, which is why rule 1 pins ULID. `EXERCISE_MEDIA` → `exercises/<source_id>/<idx>.jpg`
  (r07 step 4, no commit SHA in the key) — that pair is `exercise_media(exercise_id, idx)`.
  `BACKUPS` → `backups/{yyyy}/{mm}/backup-<ISO>.ndjson`. Object metadata carries `src-sha256` and
  `exdb-commit`. **D1 stores keys only, never bytes.**
- **IndexedDB is owned end to end by [`05-pwa-offline-sync.md`](./05-pwa-offline-sync.md)** — its
  `outbox` (`seq` `++` PK, `id`, `entityTable`, `entityId`, `clientRev`, `updatedAt`, `status`,
  `nextAttemptAt`, `leaseUntil`, …), `mirror` + `MirrorMeta` (`dirty`, `deleted`, `rev`,
  `prProvisional`), `blobs`, `meta`, and 06's `sessionDraft`. The earlier draft restated a
  contradicting subset here; that description is deleted rather than duplicated, because two
  declarations of one store is how they drift. This spec constrains Dexie in exactly two ways: mirror
  **column names** equal D1's, and mirror **instants are the wire shape** — epoch-ms `number`, per
  rule 4 — so `src/db/wire.ts` is the only translator. The pull cursor in `meta` is the composite
  pair `{ts, id}` of rule 3, not a single value.

## UX notes

- `sets.local_day` is written by the **client**, from the device clock, at set-completion time. A
  wrong clock means a wrong streak, so the workout screen shows the resolved local day in the session
  header — one glance, before anything syncs, is the whole mitigation. Because it *is* the whole
  mitigation it is not allowed to be decorative: the readout meets AA contrast at ≥ 16 px, sits in the
  header's persistent row (never behind a tap), and is announced via `aria-live="polite"` when the
  resolved day changes. Tokens and exact values are `03-design-system.md`'s.
- A soft-deleted set vanishes optimistically but the row survives, so undo is a real undo (same `id`)
  rather than a re-create. Swipe-to-delete must not mint a new id on undo.
- Any list reading a JSON column renders a **degraded row, never a crash**, when `tryParseJson` fails:
  the raw text behind a "couldn't read this" chip with a copy button. Honest data over a blank screen.
  Rule 6's plain-`text` columns are what make this reachable at all — with `mode:"json"` the whole
  `SELECT` would have thrown first. The chip is a real button: ≥ 44 × 44 px, AA-contrast label, and an
  accessible name that says what it does («показать исходные данные» / "show the raw value"), not just
  the glyph.
- `personal_records` drives the confetti. Because the partial unique index is a database guarantee,
  the animation fires exactly once per real PR even if the outbox flushes the set twice.

## Risks

| Risk | Mitigation |
|---|---|
| A future migration recreates a parent table and wipes children (r02 §4.1) | `onDelete:"restrict"` turns the silent cascade into a rolled-back migration (rule 11); `tests/db/migration-replay.test.ts` asserts row counts before/after on a seeded `node:sqlite` copy; rule 21 gates the DDL |
| UTC-vs-Almaty off-by-one corrupts streaks and the heatmap (r09: highest-risk analytics bug) | `local_day` stored not derived, GLOB CHECKed, computed by a hardcoded two-era offset table with **no runtime `Intl` and no tz dependency** (rule 5), verified against IANA tzdata for every 5-hour step 2005→2031, and throwing below 2005 rather than guessing; tested at `00:30` and `23:59` local on both sides of the 2024 cutover |
| A CHECK silently missing on remote — the pragma fingerprint ignores CHECKs | `db:verify` extended to diff normalised `sqlite_master.sql` (rule 19) + deploy-time `wrangler d1 export --no-data` through `--against` |
| `Infinity`/negative `e1rm_kg` at `reps >= 37` permanently poisons `max()` | `NULL` not `0` (rule 10) plus `sets_e1rm_finite` as the DB backstop |
| A stored `e1rm_kg` silently goes wrong when the user corrects a heuristic `load_mode` | Rule 33: the edit recomputes every affected set and re-runs PR detection; `e1rm_source` makes each number attributable; tested for staleness |
| `DEFAULT false` rejected by D1's SQLite build (UNVERIFIED, r02 §2.8) — 0000 already bets on it | One-command remote probe in Verification step 6a, run before any real data exists |
| D1 UPSERT support is undocumented, and both seeding and every singleton depend on it (r07 step 3) | Verification step 6b probes `ON CONFLICT … DO UPDATE` remotely before the first seed |
| 100-bound-parameter limit breaks "finish workout" on a big session | Literal-SQL bulk path; `floor(100/columns)` asserted per table from `getTableColumns()` (`sets` = 3) |
| The `src/db/schema.ts` → barrel refactor changes generated DDL by accident | Verification step 1 asserts `db:generate` emits **no** migration for the move alone. The "what if drizzle-kit reports 0 tables" branch is **resolved, not deferred**: `drizzle-kit@0.31.10` was run against a two-file barrel of the exact shape above and exported both tables correctly, so `schema: "./src/db/schema.ts"` stays and no glob is needed |
| Adding a muscle or a set type later forces a table recreate | Rule 13 splits enums into dataset-frozen (CHECK) and app-owned (Zod-only) so the growable ones stay free |
| `ai_prompt_logs` dominates DB and backup size and holds full prompts (r10 gotcha 27) | Large payloads to `output_r2_key`, byte CHECK, 365-day purge, backups inherit app access control |
| A sibling spec ships against a draft column name and fails to compile | Rule 27's reconciliation table names the winner and the spec that must change; Verification step 10 greps every backticked table name in `specs/*.md` against `src/db/schema/` and fails on an unknown one |
| The R2 GC sweep re-deletes purged keys forever and bills Class A ops | `photos.r2_purged_at` watermark + the partial index it narrows (rule 26, P15) |

## Verification

```bash
# 1 Barrel refactor is DDL-neutral. PASS: "No schema changes, nothing to migrate" (no new .sql)
npm run db:generate
# 2 Full schema codegen + local apply. PASS: 0002_*.sql created (0001_credentials.sql already
#   exists and is already applied); "Migrations applied successfully"
npm run db:generate && npm run db:migrate:local
# 3 Drift guard. PASS: stdout starts with "OK: drizzle/migrations replays exactly to
#   src/db/schema.ts (" and the parenthesised table count is > 0 and equals
#   Object.keys(await import("src/db/schema.ts")).length as counted by the test — never a literal
npm run db:verify
# 4 Journal/snapshot chain. PASS: "Everything's fine"
npx drizzle-kit check
# 5 Committed snapshot is fresh. PASS: no diff (exit 0)
npm run db:snapshot && git diff --exit-code docs/db/schema.snapshot.sql
# 6 Destructive-DDL gate. PASS: exit 0 on the real migrations; exit 1 on a DROP TABLE fixture
node scripts/check-migration-safety.mjs
# 6a D1 accepts drizzle-kit's `DEFAULT false` (r02 §2.8 UNVERIFIED). PASS: b=0, t=integer
npx wrangler d1 execute fitness-pwa-db --remote -y --command \
 "CREATE TABLE _probe(b integer DEFAULT false NOT NULL); INSERT INTO _probe DEFAULT VALUES; \
  SELECT b, typeof(b) AS t FROM _probe; DROP TABLE _probe;"
# 6b D1 supports UPSERT (rule 23, and every singleton in rule 2). PASS: v=2
npx wrangler d1 execute fitness-pwa-db --remote -y --command \
 "CREATE TABLE _u(id text primary key, v integer); INSERT INTO _u VALUES('a',1); \
  INSERT INTO _u VALUES('a',2) ON CONFLICT(id) DO UPDATE SET v=excluded.v; \
  SELECT v FROM _u; DROP TABLE _u;"
#   6a/6b both create and drop a scratch table outside the migration log, which rule 19's live-schema
#   check is designed to flag. Acceptable, and only here: both run BEFORE 0002 is applied remotely,
#   both drop the table in the same statement list, and step 8's `--against` runs afterwards — so a
#   leaked `_probe`/`_u` is caught rather than tolerated.
# 7 RESTRICT is live (rule 11). Seed first: an EMPTY database makes the DELETE match zero rows and
#   exit 0, which is how this step used to pass without testing anything.
npx wrangler d1 execute fitness-pwa-db --local --file=tests/db/fixtures/seed.sql
npx wrangler d1 execute fitness-pwa-db --local --command \
 "DELETE FROM workouts WHERE id=(SELECT workout_id FROM sets LIMIT 1);"
#   PASS: stderr contains "FOREIGN KEY constraint failed"
npx wrangler d1 execute fitness-pwa-db --local --command "SELECT count(*) AS c FROM sets;"
#   PASS: c=1 — the set row survived
# 8 Remote apply, then live-schema equality against the committed snapshot. PASS: no diff
mkdir -p .artifacts
npm run db:migrate:remote
npx wrangler d1 export fitness-pwa-db --remote --no-data --output=.artifacts/live.sql
npm run db:verify:live
# 9 Unit + query-plan tests. PASS: all green
npx vitest run tests/db
# 10 No spec references a table this schema lacks. PASS = no output
node -e "…grep every \`backticked\` snake_case identifier in specs/*.md against getTableConfig names…"
```

Unit cases (numeric oracles in
[`docs/research/r09-formulas-and-test-vectors.md`](../docs/research/r09-formulas-and-test-vectors.md)):

- `local-day`: `2026-09-06T19:30:00Z → '2026-09-07'` and `2026-09-06T18:59:59Z → '2026-09-06'`
  (r09 §8's off-by-one demo); `rolling7dDays(2026-09-13T02:30:00Z)` = `{from:'2026-09-07',
  to:'2026-09-13'}`; the cutover pair `2024-02-28T18:30:00Z → '2024-02-29'` (UTC+6 — at UTC+5 it
  would be `'2024-02-28'`, which is the whole point) and `2024-03-05T18:30:00Z → '2024-03-05'`
  (UTC+5); `toLocalDay(ALMATY_UTC5_FROM_MS - 1) → '2024-02-29'`; an instant below
  `ALMATY_ERA_FLOOR_MS` **throws**; and a property test comparing `toLocalDay` to an
  `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Almaty'})` oracle at every 5-hour step from
  2005-01-01 to 2031-01-01 with **zero** mismatches.
- `json`: codec round-trip per column; a row containing the literal text `'{oops'` — inserted via
  `wrangler d1 execute` — still lets the list query succeed and `tryParseJson` returns `ok:false`
  with the raw text and never throws; `toJson` rejects an over-cap payload; a 40 000-character
  Cyrillic payload (≈80 000 bytes) is **rejected** by both `toJson` and the SQL
  `length(CAST(col AS BLOB))` CHECK, while 40 000 ASCII characters is accepted.
- `sync`: `rev` increments on every accepted UPDATE and a stale-equal `client_rev` yields
  `status='conflict'`; an UPDATE that omits `updated_at` still advances it (the `$onUpdate` backstop);
  200 rows sharing one `updated_at`, paged at 50 with the composite `(updated_at, id)` cursor, return
  all 200 exactly once; `toWire`/`fromWire` round-trip every `timestamp_ms` column as an epoch-ms
  integer and `fromWire` rejects an ISO string.
- `e1rm storage`: r09 §1 vectors **V1–V6** — `V1(100,1)=100.0000` with
  `e1rm_source='actual_single'` (not Epley's 103.3333), `V3(100,10)=133.3333`, `V4(100,12)=144.0000`,
  **V6 `(100,37)` stores NULL for both `e1rm_kg` and `e1rm_source`**, and a hand-inserted `Infinity`
  is rejected by `sets_e1rm_finite`; a row with `e1rm_kg` set and `e1rm_source` NULL is rejected.
- `load-mode backfill`: flipping an exercise's `load_mode` from `external` to `bodyweight_plus`
  leaves **no** set whose stored `e1rm_kg` differs from a fresh recompute, and re-runs PR detection.
- `pr epsilon`: `119.60 → 119.605` is not a PR; `119.60 → 119.62` is; writing the same set twice
  yields exactly one `personal_records` row and one `xp_ledger` row; **applying the same import batch
  twice** yields exactly one `personal_records` row per `(origin_key, kind)` even though `set_id` is
  NULL throughout.
- `rounding`: for a fixture whose exact values end in `.5`, `sum(kcal per item) === day total`, and
  a `status='draft'` row is excluded from both.
- `confidence`: `0.85` is accepted; `85` is rejected by the CHECK on both `foods.confidence` and
  `food_entries.confidence`; `NULL` is accepted.
- `volume aggregation`: the r09 §8 10-set week yields volume **3270.0 kg** and, with r09's
  `front_delts` mapped to **`shoulders`** (the 17-key domain has no anterior/lateral/posterior
  deltoid split and r07 §4 forbids inventing one, so an extra key would be un-populatable), all
  three muscles are asserted: credited hard sets chest **6.0** / shoulders **2.5** / triceps **3.5**,
  per-muscle tonnage chest **2850.0** / shoulders **1185.0**, via `sets_local_day_exercise_id_idx`.
  The sum over muscles (5640.0) deliberately exceeds the tonnage (3270.0) — r09 §8's by-design
  double count; the test asserts both numbers so no dashboard tile can quietly pick the wrong one.
- `trend_kg`: the r09 §4 10-day series persists `82.000000 … 82.108806` to 6 dp with `T[1] === W[1]`.
- `tdee_estimates`: the r09 §5 4-week example stores `tdee_data_kcal = 2697.5` and
  `tdee_kcal = 2697.5` as **REAL** (a sign error gives 2202.5, and the columns are REAL precisely so
  the two cannot collide under truncation), `prior_kcal = 2770.625`, `blend_weight = 1.0`; appending
  a second row for the same `week_ending` with a later `computed_at` succeeds and the reader returns
  the newer one.
- `index-coverage`: for P1–P24, `EXPLAIN QUERY PLAN` **contains** the expected fragment from the
  table above (`USING INDEX <exact name>` or `USING COVERING INDEX <exact name>`, with the four
  legitimate-scan rows pinned as full strings); the suite never asserts on the string `SCAN TABLE`;
  a negative fixture drops `sets_exercise_id_completed_at_idx` and asserts P3 **fails**; and the
  enumeration over `getTableConfig(t).indexes` for all 53 tables leaves no index unaccounted for.
- `bound-params`: `floor(100 / columnCount)` from `getTableColumns()` per table (`sets` → 3); a
  multi-row insert one row above it is rejected by the guard.
- `naming`: every index on a table created by this spec matches
  `^<table>_[a-z0-9_]+_(idx|uq)$` and its name-part columns are a prefix of its actual column list
  (so a covering tail is allowed but a wrong leading column is not), with five explicit allow-listed
  names — `sessions_user_idx`, `sessions_expires_idx`, `cron_runs_job_started_idx`,
  `cron_runs_job_slot_idx`, `import_batches_applied_sha_uq`; every `local_day`/`_on`/`_day` column on
  a new table has a GLOB CHECK, with `users.birth_day` as the single documented exception.

## Open questions

1. **Does a null `rir` on a `working` set count as a hard set?** (a) yes, the user did the work;
   (b) no, `rir <= 4` is the definition. **Recommend (a)** — (b) makes two dashboard tiles silently
   disagree for anyone who does not log RPE. It is a `WHERE` clause, not a schema change.
2. **Convert the three grandfathered `ON DELETE cascade` FKs (rule 12) to `RESTRICT`, or leave them?**
   (a) convert in the next migration that touches `settings`/`sessions`/`credentials` — one rule
   everywhere, at the cost of one approved-breaking recreate of three small tables; (b) leave them,
   documented. **Recommend (a)**, while all three tables are still effectively empty and the recreate
   is free. Note that rule 28 already touches `settings`, so (a) is nearly free at 0002.
3. **`ai_prompt_logs` retention.** (a) keep forever (complete audit trail, dominates backup size);
   (b) purge past 365 days once the row is in an R2 backup. **Recommend (b)**, as a cron job whose
   deleted count lands in `cron_runs`.
4. **When does `credentials` get dropped?** (a) in the same `0002` as the data move, which makes 0002
   `-- APPROVED-BREAKING` and breaks 04's currently-live code the moment it is applied; (b) frozen at
   0002 and dropped in a separate approved-breaking migration once 04 ships `auth_credentials`.
   **Recommend (b)** — rule 28 is written for it — but it must be decided before 0002 is generated,
   because `verify-schema.mjs` will report `credentials` every run until it is resolved.
5. **`09-programs.md` proposes a different, larger program model** — `program_days`,
   `program_schedule`, `exercise_progression_state`, `deload_events`, a much wider `programs`, and
   `routines`/`routine_exercises` columns (`order_index`, `tier`, `planned_sets_json`,
   `progression_strategy`, `progression_config_json`, `est_minutes`, `is_deleted`) that do not match
   the four tables declared here. This is a genuine conflict, not a naming one, and it is **not
   resolvable inside this spec**: 09 owns program semantics, 02 owns the DDL, and rule 21 makes
   adding a UNIQUE or a CHECK to these tables expensive after 0002 is applied. **Recommend adopting
   09's model wholesale into `programs.ts` before 0002 is generated**, with `deload_blocks` replaced
   by `deload_events` and 09's `is_deleted` flags folded into this spec's `deleted_at`. Owner
   decision required; until it lands, `programs.ts` above is provisional and is the only part of this
   schema that is.
6. **`sets` columns 09 wants but 06/07 do not mention** — `target_reps`, `target_weight_kg`,
   `target_rpe`, `is_prefilled`, and `workouts.{program_schedule_id, was_deload}`. All are nullable
   additive columns, so `ALTER TABLE ADD COLUMN` adds them later for free and deferring is safe; but
   each one pushes `sets` further past the `floor(100/columns)` bulk-insert cliff (26 columns → 3
   rows; 30 → 3; 34 → 2). **Recommend adding them only with question 5's answer**, and re-asserting
   the `bound-params` case when they land.
