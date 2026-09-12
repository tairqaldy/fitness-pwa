# 16 — Testing strategy, CI, performance and accessibility gates

## Purpose

Defines how every other spec is proven: the test pyramid, the harnesses, the GitHub Actions gates, and the **measured** performance, security and accessibility budgets. Satisfies the brief's non-functional requirements (LCP < 2.5 s on mid-range mobile, a per-route client-JS budget, WCAG AA, the Security list, "a full workout is loggable with no network and syncs later") and the acceptance line "All calculators covered by passing unit tests; smoke test green". Owns the per-phase Definition of Done every future session must satisfy before committing.

Every number here that could be measured **was** measured against the Phase-0 app in this repo on 2026-09-12, and the measurement is cited at the number. Where a measured number contradicts the brief, the contradiction is named and escalated in "Open questions" rather than papered over — that is the only honest way to write a gate, and it is what stops the first real perf run from forcing exactly the budget-raising PR §34 exists to prevent.

## Scope

Vitest 5 config (projects `unit`/node, `dom`/jsdom, with disjoint `include` globs) and coverage gates; the data-layer harness decision (`node:sqlite` + a `D1Database` shim, including the `raw()` mechanism that makes joined selects correct) and its degradation path; route-handler tests and the seam that makes them possible without mocking Workers; deterministic time and its ESLint enforcement; factories, a generated fixture DB, and r09's numeric vectors as the oracle; Playwright (the offline acceptance test incl. service-worker handling, the smoke suite enumerated 1:1 against the brief's acceptance checklist, the axe gate, the per-route JS measurement); the **security gates** (unauthenticated-route sweep, secret-shape grep over the built client bundle, rate limit, signed-URL expiry); `ci.yml` verbatim, `deploy.yml`, required checks, why deploy is gated, the migration drift + safety job; Lighthouse CI for LCP and the route budget table; `docs/DOD-CHECKLIST.md` and the "fix the code, never edit the test" rule.

### Out of scope

| Excluded | Owned by |
|---|---|
| `src/db/schema.ts`, `drizzle/migrations/`, `drizzle.config.ts`, `scripts/verify-schema.mjs` | `specs/02-data-model.md` (script body in r02 §2.6) |
| `tests/db/index-coverage.test.ts` (the `EXPLAIN QUERY PLAN` contract for P1–P15) and `tests/db/migration-replay.test.ts` | `specs/02-data-model.md` §16 |
| `wrangler.jsonc`, bindings, `open-next.config.ts`, `src/worker.ts`, `src/proxy.ts` | `specs/01-architecture.md` |
| `/api/health` — the unauthenticated liveness route this spec's offline probe and security sweep both use | `specs/01-architecture.md` §Files |
| The formulas, and the three policy decisions this spec asserts rather than re-decides | `specs/07-calculators.md` rules 20 / 39 / 40; oracle in `docs/research/r09-formulas-and-test-vectors.md` |
| Serwist config, `app/sw.ts`, `/~offline`, `public/_headers`, the Dexie outbox schema, `defaultCache`'s runtime-cache rules | `specs/05-pwa-offline-sync.md` (from r05) |
| Auth session shape behind the E2E storage state; which routes are unauthenticated | `specs/04-auth.md` (§367 route table) |
| Tokens the a11y gate measures (`--spacing-tap` = 56 px) | `specs/03-design-system.md` (r12 §C) |
| Production R2 key patterns and the signed-URL TTL the security gate asserts | `specs/10-body-photos.md` |
| Message catalogue keys the E2E assertions resolve through (`messages/{ru,en}.json`) | the spec owning each surface; loader is `src/i18n/request.ts` |
| The wrangler `dev` block, **if one is ever added** | `specs/01-architecture.md` — but nothing in this spec may depend on it (§10) |

## Files to create

| Path | Responsibility |
|---|---|
| `vitest.config.mts` | **Already exists** (Phase 0): extend it with `test.projects` — `unit` (node) + `dom` (jsdom) — each with its **own disjoint** `include` (§1), keeping the `@`→`src` alias and keeping coverage at the root level only. `.mts` is mandatory (r12 G9). |
| `tests/setup/dom.ts` | jsdom setup: `import "fake-indexeddb/auto"`, `matchMedia` / `navigator.vibrate` stubs. |
| `tests/harness/d1.ts` | `createD1()` — `node:sqlite`-backed `D1Database` shim; `makeTestDb()`; forces `PRAGMA foreign_keys = ON`; `raw()` via `setReturnArrays(true)`; `prepare()` rejects transaction-control SQL. |
| `tests/harness/d1.test.ts` | Harness self-tests: the duplicate-column positional test (§7c), the `meta` contract, the transaction-control rejection, the FK-enforcement assertion. A shim bug must fail here, not inside a repository test. |
| `tests/harness/migrate.ts` | Replays `drizzle/migrations/*.sql` (split on `--> statement-breakpoint`) into a shim DB. |
| `tests/harness/clock.ts` | `fixedClock()`, `appDay()` — the only place a test names a time. `appDay()` **delegates** to `src/lib/time.ts`; it never re-implements it. |
| `tests/factories/index.ts` | Deterministic `aWorkout` / `aWorkoutExercise` / `aSet` / `aMeasurement` / `aFoodEntry` / `aCheckin`. Instants are `Date`, converted at the factory boundary (§17, §21). |
| `tests/factories/types.test-d.ts` | Compile-only: every factory's return type is assignable to the real drizzle insert type. |
| `scripts/gen-fixture-seed.mjs` | Generates `tests/fixtures/seed.sql` from the factories + `src/db/schema.ts`; `--check` re-generates and diffs. |
| `tests/fixtures/seed.sql` | **Generated** literal-value 8-week fixture history (§22). Committed so `wrangler d1 execute --file` can load it, never hand-edited. |
| `tests/fixtures/seed.ts` | `seedFixture(db)` → typed id map the tests assert on. |
| `tests/calc/fixtures/r09-vectors.ts` | **Already exists** (Phase 0) — the numeric oracle, transcribed from r09 as typed tables. Extended, never replaced. There is no `tests/vectors/r09.json`. |
| `tests/calc/*.test.ts` | Table-driven unit tests for `src/lib/calc/**` (100 % coverage gate). Under `tests/`, not colocated, because each vitest project's `include` is scoped under `tests/`. |
| `tests/data/*.test.ts` | Repository tests against the shim through the real drizzle D1 driver. |
| `tests/routes/*.test.ts` | Handler tests: `handle(db, new Request(...), clock)` → `Response`. |
| `tests/security/*.test.ts` | The unauthenticated-route sweep, the rate-limit case, the signed-URL expiry case (§§31–35). |
| `scripts/check-no-client-secrets.mjs` | Greps a built output directory for secret-shaped strings and every value in `.dev.vars`; exits non-zero naming the file, the line and the pattern (§33). |
| `tests/fixtures/import/{hevy,strong,mfp}.csv` | Three small real-shape import fixtures for the `@smoke import` case (row shapes owned by `specs/15-data-portability.md` / r10). |
| `tests/dom/*.test.ts` | The only files the `dom` project runs: rest timer, outbox retry, anything needing jsdom + `fake-indexeddb`. |
| `playwright.config.ts` | Projects `smoke`, `a11y-ru`, `a11y-en`; `webServer` = the **preview** worker on `$E2E_PREVIEW_PORT`; Pixel-class viewport; `locale: "ru-RU"`; `retries: 0`. |
| `playwright.perf.config.ts` | Project `perf` only; `webServer` = `npm start` on `$E2E_NEXT_PORT`; `serviceWorkers: "block"`; its own authenticated `storageState`. Two files because Playwright's `webServer` is **global, not per-project** (§10). |
| `tests/e2e/global-setup.ts` | Migrations + fixture into local D1; signs in once and writes `storageState.json` **and** `storageState.perf.json`; writes the session cookie to `.lighthouseci/session.json` for LHCI; clears the test R2 prefix and KV. |
| `tests/e2e/helpers/sw.ts` | `installedAndPrecached()` — waits for SW activation and named precache entries. |
| `tests/e2e/helpers/offline.ts` | `goOffline()` / `goOnline()` / `outboxCount()` / `assertWireIsDead()`. |
| `tests/e2e/helpers/copy.ts` | `t(key)` — resolves an accessible name through `messages/<locale>.json` so no assertion hardcodes Russian or English (§20). |
| `tests/e2e/helpers/routes.ts` | Loads `perf-budgets.json` and resolves each route's concrete URL (incl. `/workout/[id]` from the fixture id map). The **one** canonical route list. |
| `tests/e2e/offline-workout.spec.ts` | **Acceptance test #1** — log a full workout offline, reconnect, it syncs. |
| `tests/e2e/smoke.spec.ts` | The brief's acceptance checklist, enumerated one-to-one (§29). |
| `tests/e2e/a11y.spec.ts` | axe with WCAG 2.1 AA tags over the canonical route list; zero violations **and** zero `incomplete`. |
| `tests/e2e/a11y-exceptions.json` | Bounded suppressions `{route, ruleId, kind, reason, issueUrl}`, max 3 total. |
| `tests/perf/bundle-budget.spec.ts` | Per-route gzipped client-JS measurement vs `perf-budgets.json`; also gates `sharedBaselineKb`. |
| `perf-budgets.json` | `{ definition, sharedBaselineKb, routes: RouteBudget[] }` — the single source of truth for the budget table, the a11y route list and LHCI's URLs. |
| `lighthouserc.cjs` | LHCI config as **JS**, not JSON, so it can read the canonical route list and the session cookie (§28). |
| `scripts/check-migration-safety.mjs` | Replays each new migration against reflection-generated rows; fails on row loss (r02 §4.1). |
| `.github/workflows/ci.yml` | **Replaces the existing file.** `verify` + `schema` + `e2e` + `perf`; identical on PR and main. The committed file's `deploy` job is **deleted** in the same PR — otherwise the repo has two deploy paths (§31). |
| `.github/workflows/deploy.yml` | Gated on a successful CI run via `workflow_run`; remote migrations, then deploy, then a read-only post-deploy check. |
| `docs/DOD-CHECKLIST.md` | The per-phase Definition-of-Done template. |

### package.json changes

CI runs `npm ci`, so a dev dependency that exists only in a `Verification` shell line does not exist. These go into `package.json` **and the lockfile in the same PR**, or every Playwright / LHCI / `dom` step fails on a clean clone. Every version was read from the npm registry on 2026-09-12.

```jsonc
// devDependencies — additions only. jsdom is pinned like everything else.
"@axe-core/playwright": "4.13.0",
"@lhci/cli": "0.15.1",              // bundles lighthouse@12.6.1
"@playwright/test": "1.63.0",
"fake-indexeddb": "6.2.5",
"jsdom": "30.0.1",

// scripts — additions only. `build` ALREADY emits public/sw.js:
//   "build": "next build && cross-env NODE_ENV=production serwist build serwist.config.mts"
// so the three SW greps in CI have a real file to grep. Do NOT change `build`.
"cf-typegen:check": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts && git diff --exit-code cloudflare-env.d.ts",
"db:verify": "node scripts/verify-schema.mjs",
"db:seed:local": "wrangler d1 execute fitness-pwa-db --local --file tests/fixtures/seed.sql",
"db:seed:check": "node scripts/gen-fixture-seed.mjs --check",
"test:e2e": "playwright test -c playwright.config.ts",
"test:perf": "playwright test -c playwright.perf.config.ts"
```

`vitest@^5.0.0` and `@vitest/coverage-v8@^5.0.0` are already present.

## Interfaces

```ts
// tests/harness/d1.ts — the subset of D1Database drizzle-orm 0.45.2 actually calls. VERIFIED by reading
// drizzle-orm@0.45.2 `d1/session.js`: on the database only `.prepare(sql)` and `.batch(stmts)`; on the
// statement only `.bind()`, `.run()`, `.all()` (destructured as `{ results }`) and `.raw()`. `.first()`
// is never called. r02 §2.8 states the same.
export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch<T = unknown>(stmts: D1StatementLike[]): Promise<D1ResultLike<T>[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}
export interface D1StatementLike {
  bind(...values: readonly unknown[]): D1StatementLike;
  run<T = unknown>(): Promise<D1ResultLike<T>>;
  all<T = unknown>(): Promise<D1ResultLike<T>>;   // MUST resolve to { results: T[] }
  /** Rows as POSITIONAL value arrays. The load-bearing method — see §7c. Implemented with
   *  `StatementSync.setReturnArrays(true)`, NEVER `Object.values(all())`. */
  raw<T = readonly unknown[]>(): Promise<T[]>;
}
export interface D1ResultLike<T = unknown> {
  results: T[]; success: true;
  /** `changes` and `last_row_id` come from node:sqlite's `run()`, which returns EXACTLY
   *  `{ lastInsertRowid, changes }` and nothing else (verified on Node 24.12.0 by calling it).
   *  `duration`, `rows_read` and `rows_written` are therefore **always 0** — node:sqlite exposes
   *  no such counters and the shim will not fabricate them. A test asserting on those three is
   *  testing the shim, not D1; do not write one. */
  meta: { changes: number; last_row_id: number; rows_read: 0; rows_written: 0; duration: 0 };
}
import type { DatabaseSync } from "node:sqlite";
export function createD1(sqlite: DatabaseSync): D1Like;
export interface TestDb {
  d1: D1Like;                                     // used as `drizzle(td.d1 as unknown as D1Database, { schema })`
  db: DrizzleD1Database<typeof import("@/db/schema")>;
  sqlite: DatabaseSync;
  close(): void;
}
/** In-memory unless `file` is given. `seed: true` also loads tests/fixtures/seed.sql. */
export function makeTestDb(opts?: { seed?: boolean; file?: string }): Promise<TestDb>;

// tests/harness/clock.ts — epoch MILLISECONDS, UTC. Never `new Date()` with no arguments.
export type Clock = { now(): number };
export function fixedClock(iso: string): Clock;      // iso MUST carry an offset or Z: "2026-09-12T06:00:00+05:00"
export function advance(clock: Clock, ms: number): Clock;           // returns a NEW Clock
/** 'YYYY-MM-DD' in the app zone, mirroring the `local_day` column. DELEGATES to the app's own
 *  `todayInAppZone(at: Date)` from `src/lib/time.ts` (specs/01 §Interfaces) — this harness only
 *  adapts epoch-ms to Date and must contain no offset arithmetic of its own. A test oracle that
 *  re-implements the function under test can agree with itself while the app is wrong; and a
 *  hardcoded +05:00 is simply wrong before 2024-03-01, when Asia/Almaty was UTC+6 (r09 §8) —
 *  exactly the data specs/15's Hevy/Strong/MFP importer ingests. There is no
 *  ALMATY_UTC_OFFSET_MIN constant in this repo's tests. */
export function appDay(epochMs: number): string;

// tests/factories/index.ts — pure, deterministic; ids from a counter reset per test.
// Instants are `Date`, NOT numbers: specs/02 §4 models every `_at` column as
// `integer(n, { mode: "timestamp_ms" })` "surfaced as Date", so drizzle's insert type is `Date`,
// and the project runs `strict` + `exactOptionalPropertyTypes`. The Clock stays numeric;
// conversion happens at the factory boundary: `aWorkout() => ({ startedAt: new Date(clock.now()) })`.
// `tests/factories/types.test-d.ts` asserts the assignability so this cannot drift again.
export function resetFactories(): void;                                          // in beforeEach
export function aWorkout(o?: Partial<WorkoutInsert>): WorkoutInsert;             // startedAt: Date
export function aWorkoutExercise(o?: Partial<WorkoutExerciseInsert>): WorkoutExerciseInsert;
export function aSet(o?: Partial<SetInsert>): SetInsert;                          // weightKg, reps, rpe, rir
export function aMeasurement(o?: Partial<MeasurementInsert>): MeasurementInsert;  // kg, cm
export function aFoodEntry(o?: Partial<FoodEntryInsert>): FoodEntryInsert;        // kcal, grams
export function aCheckin(o?: Partial<CheckinInsert>): CheckinInsert;
```

```ts
// tests/e2e/helpers/{offline,sw,copy,routes}.ts
import type { BrowserContext, Page } from "@playwright/test";
/** Aborts every request at CONTEXT level (covers service-worker fetches) AND flips navigator.onLine.
 *  setOffline alone is NOT enough once a SW is active — Playwright #2311. */
export function goOffline(context: BrowserContext): Promise<void>;
export function goOnline(context: BrowserContext): Promise<void>;
/** Positive proof the wire is dead: a same-origin fetch that CANNOT be answered from any cache.
 *  Target is `/api/health` — unauthenticated by design (specs/01 §Files, specs/04 §367) and
 *  excluded by `src/proxy.ts`'s matcher, so a rejection can never be confused with a 401. It is
 *  fetched with a UNIQUE query string and `cache: "no-store"`, because `@serwist/next`'s
 *  `defaultCache` routes every same-origin `/api/` request through
 *  `NetworkFirst({ cacheName: "apis" })` (verified in @serwist/next@9.5.12
 *  `dist/index.worker.mjs`), which answers from cache when the network fails. A URL nothing has
 *  ever fetched has no cache entry, so the promise MUST reject. */
export function assertWireIsDead(page: Page): Promise<void>;
export function outboxCount(page: Page): Promise<number>;           // Dexie outbox rows; read-only
export const PRECACHE_NAME = "serwist-precache-v2";                 // r05 §8
export function installedAndPrecached(page: Page, required: readonly string[]): Promise<void>;
/** Resolves an accessible name through the message catalogue for the context's locale, so no
 *  assertion hardcodes a Russian or English string (§20). */
export function t(key: string, locale?: "ru" | "en"): string;

// tests/e2e/helpers/routes.ts + tests/perf/bundle-budget.spec.ts
export interface RouteBudget {
  route: string;            // the App Router pattern, e.g. "/workout/[id]"
  url: string;              // a concrete, navigable path; may contain a "${…}" placeholder
                            // resolved from the fixture id map, e.g. "/workout/${pplWorkoutIds[0]}"
  label: string;            // human surface name, printed in the budget report
  owner: string;            // the spec number that owns the surface
  maxRouteDeltaKb: number;  // COMMITTED ratchet: last measured route delta + 10 KB headroom
  targetDeltaKb: number;    // the ceiling this spec sets; raising past it is an owner decision (§25)
  status: "gated" | "measure";
}
export interface PerfBudgets {
  definition: string;       // the prose definition, restated in the file so it travels with the data
  sharedBaselineKb: number; // gated on its own line — see §25
  routes: RouteBudget[];
}
export function canonicalRoutes(idMap: FixtureIds): Promise<RouteBudget[]>;
/** Sums request.sizes().responseBodySize over every response whose resourceType() === "script", on
 *  a cold navigation with serviceWorkers: "block", partitioned into the shared baseline
 *  (`rootMainFiles` from .next/build-manifest.json) and the route delta (everything else).
 *  `finalUrl` is returned so the caller can prove the measured page is not a redirect target. */
export function measureRouteJs(
  page: Page, url: string,
): Promise<{ sharedBytes: number; deltaBytes: number; files: number; finalUrl: string }>;
```

## Behaviour

### The pyramid

1. **Vitest projects.** Declaring `test.projects` turns the root config into a container — verified in `vitest@5.0.0`'s shipped types: *"that config declares `projects` itself, it becomes a container: it doesn't run tests, only provides the projects it declares"*. A root-level `include` therefore no longer selects files, so each project gets its own **disjoint** glob and nothing runs twice:
   - `unit` — `environment: "node"`, `include: ["tests/{calc,data,routes,security,harness}/**/*.test.ts", "tests/*.test.ts"]`.
   - `dom` — `environment: "jsdom"`, `include: ["tests/dom/**/*.test.ts"]`, `setupFiles: ["tests/setup/dom.ts"]`.

   A new test file belongs in `tests/dom/` if and only if it needs a DOM or `fake-indexeddb`; everything else goes in the folder named after its layer. Coverage stays a **root-only** option (projects do not carry their own `coverage`), so one report covers both projects.
2. **Coverage thresholds.** Widen `coverage.include` to `["src/lib/**", "src/server/**"]`, keep global thresholds at `{ lines: 80, functions: 80, branches: 75, statements: 80 }`, and add one glob key `"src/lib/calc/**": { lines: 100, functions: 100, branches: 100, statements: 100 }`. **There is no precedence question**, because overlapping threshold sets are checked *independently and cumulatively*, not as overrides — verified by reading `vitest@5.0.0`'s `dist/chunks/index.B89dZ0-N.js` (`resolveThresholds`, ~line 15102): each glob key gets its own coverage map, and *"Global threshold is for all files, even if they are included by glob patterns"*. So calc files must satisfy both 100 and 80 — trivially consistent — and no file can slip through a gap.
3. **The oracle is `tests/calc/fixtures/r09-vectors.ts`** (Phase 0 already built it: `E1RM_VECTORS`, `NRM_CELLS`, `PCT1RM_GRID`, `COMPOSITE_VECTORS`, `R6_UNCAPPED_KG`, `NAVY_*`, `TREND_*`, `TDEE_*`, `PLATE_VECTORS_NEAREST`, `WARMUP_*`, `VOLUME_*`). It is TypeScript, not JSON, which is strictly better: `satisfies` pins the tuple shapes and the vectors import the real domain types. **Rule 2, restated correctly:** a calc test may not hardcode an expected number that is absent from that file, and a new vector must carry a comment citing its source — either an **r09 section** *or* the **owning spec section** (e.g. `spec 07 §11` for the e1RM inflation cap, `spec 13 §x` for the XP curve). The earlier "r09 section only" wording made the readiness score, per-muscle recovery, XP curve, streak adherence and macro-ring maths permanently untestable, because r09 has no section for any of them. Guard values are first-class vectors with their own source: `E1RM_VECTORS` already carries `r = 36 → brzycki 3600.0` ("absurd but finite"), `r = 37 → null` and `r = 38 → null`, all three sourced from r09 §1's recommendation block (`BRZYCKI_MAX_REPS = 36`; `if (reps >= 37) return null`).
4. Floats use `toBeCloseTo(expected, 6)` where the vector is given to 6 dp and `toBe` where r09 says *exactly*; guards compare strictly — `e1rm(100,1) === { kg: 100, source: "actual_single" }`, `brzycki(100,37) === null`, `plateMath(15,…).status === "BELOW_BAR"`.
5. **Data layer** — repositories in `src/server/**` run against a real SQLite DB built by replaying `drizzle/migrations/*.sql`, wrapped in the `D1Like` shim, driven through the real `drizzle-orm/d1` driver. No `vi.mock` of drizzle, no hand-written fake repository.
6. **Harness decision.** `@cloudflare/vitest-pool-workers` is **rejected for now**: `0.22.0` (latest, 2026-09-12) declares `peerDependencies.vitest: "^4.1.0"`, as does every published 0.20.x–0.22.0, while `stack-facts.md` pins `vitest@5.0.0` — no published version installs against our lockfile. Independently, r02 §4.15 records that miniflare/`workerd` would not start here at all (`internal error; reference = …` from every `--local` D1 command), making a workerd-dependent unit harness a single point of total failure. `better-sqlite3@13.0.3` is rejected as an avoidable native addon. **Chosen: `node:sqlite`** — Node 24.12.0 ships SQLite 3.50.4 (verified by running `select sqlite_version()` here), zero dependencies, identical on Windows and Linux, and the mechanism r02's drift guard already proved. `NODE_OPTIONS=--disable-warning=ExperimentalWarning` silences the experimental notice (verified).

### The shim, and the four places node:sqlite is not D1

7. The shim lives only in `tests/harness/d1.ts`; no production file knows about it. When the pool ships a `vitest ^5` peer **and** `wrangler d1 execute --local` works on the dev machine, add a third project `d1` using the pool and leave `unit`/`dom` alone — every repository test goes through `makeTestDb(): TestDb`, so one file changes. Until then each gap is covered by name, and every claim below was checked by running it on Node 24.12.0:

   **(a) Parameter and statement limits.** A static test counts bound parameters against **100** and statement byte length against **90 000 bytes** — the number `scripts/gen-fixture-seed.mjs` and r02's `MAX_STATEMENT_BYTES = 90_000` both use, chosen as deliberate **headroom under D1's 100 KB hard limit** (r02 §2.7 quotes the limits table: *"Maximum SQL statement length — 100,000 bytes (100 KB)"*, and it applies per statement inside a `batch()`). 90 KB is the number everywhere in this spec; 100 KB is only ever named as the hard limit it leaves room under.

   **(b) Transactions.** `db.transaction()` compiles and then fails at runtime on D1 (r02 §4.6). Reproducing that needs a **mechanism**, because `transaction()` is a method on the *drizzle* object, not on `D1Database` — `drizzle-orm@0.45.2`'s `d1/session.js` issues `begin` / `commit` / `rollback` through the ordinary `prepare`/`run` path, and `node:sqlite` accepts `BEGIN` and `COMMIT` happily through both `exec()` and `prepare().run()` (verified). So: **`createD1().prepare(sql)` throws when the trimmed SQL matches `/^(begin|commit|rollback|savepoint|release)\b/i`.** Paired with an ESLint `no-restricted-syntax` ban on `db.transaction` (r02 §4.6's own suggestion) so the same mistake is caught at lint time, before a test ever runs. `batch()` still wraps its statements in one real SQLite transaction, issued by the shim itself rather than by generated SQL.

   **(c) `raw()` is the highest-risk line in the harness.** `drizzle-orm@0.45.2` `d1/session.js` routes `all()` and `get()` through `values()` whenever the query has `fields` or a `customResultMapper` — i.e. essentially every typed drizzle select — and `values()` calls `this.stmt.bind(...params).raw()`, after which `mapResultRow` maps the row **positionally**. The obvious implementation is silently wrong: `node:sqlite` in object mode **collapses duplicate column names**. Verified: `prepare("select 1 as id, 2 as id, 3 as x").all()` returns `[{ id: 2, x: 3 }]` — two columns became one and a value vanished. Building `raw()` as `Object.values(all())` therefore misaligns every joined select (`sets JOIN exercise_muscles`, `workouts JOIN workout_exercises`) and yields *wrong data, not an error*. The correct mechanism is `StatementSync.setReturnArrays(true)` (verified present; the same query then returns `[[1, 2, 3]]`):

   ```ts
   raw: async <T>() => {
     stmt.setReturnArrays(true);
     try { return stmt.all(...bound) as T[]; }
     finally { stmt.setReturnArrays(false); }   // the all() path must stay in object mode
   },
   ```

   `tests/harness/d1.test.ts` asserts exactly this: a select taking the same column name from two tables returns two distinct positional values, and the `all()` path still returns objects afterwards.

   **(d) Foreign keys are forced ON explicitly**, so the setting is never implicit and never depends on a Node version. The *justification* in the earlier draft was false: `new DatabaseSync(":memory:").prepare("PRAGMA foreign_keys").get()` returns `{ foreign_keys: 1 }` on Node 24.12.0 — `DatabaseSync` enables FK enforcement by **default**. Forcing it is still right, because D1 *"enforces that foreign key constraints are valid within all queries and migrations"* (quoted in r02 §4.1) and because the cascade-delete disaster of r02 §4.1 is invisible without it. `tests/harness/d1.test.ts` asserts the pragma reads `1` after `makeTestDb()`.

   **(e) Real bindings, `getCloudflareContext()`, R2, KV and Cron** are covered by Playwright against `opennextjs-cloudflare preview` (real miniflare) and by the nightly run against a deployed Worker. The concrete Cron probe is named in §30's table (the Cron row).

### Route handlers

8. This spec imposes a contract on specs 01/02: every `src/app/api/**/route.ts` is a ≤5-line adapter (`export const POST = (req: Request) => createWorkout(getDb(), req, systemClock)`) and all logic lives in `src/server/handlers/*.ts` as `(db, req: Request, clock: Clock) => Promise<Response>`. Tests call the handler directly, so `getCloudflareContext()` is never reached from vitest and r02 §2.1's failure modes cannot surface as flakiness. A handler that calls `getCloudflareContext()` itself is a review-blocking defect.
9. Handler tests assert status, `Content-Type` and the Zod-validated body. **An invalid body returns `400`**, not 422, with `specs/01-architecture.md`'s envelope, verbatim from its §Interfaces:

   ```ts
   type ApiErrorBody = { error: { code: ApiErrorCode; message: string; requestId: string; details?: unknown } };
   ```

   with `code === "validation_failed"`. Spec 01's mapping line is explicit: *"400 validation_failed"*. So the assertion is `res.status === 400`, `body.error.code === "validation_failed"`, and `typeof body.error.requestId === "string"` and non-empty — **not** a top-level `error: "validation"` string and **not** an `issues` array; spec 01 exposes Zod's detail, when it exposes it at all, through the optional `details` field, and no test may require it to be present. Minimum three cases per handler: happy path, Zod rejection (400), idempotent replay (same mutation ULID twice → one row, same body both times, per specs/02 §3). The last is what the offline outbox depends on.

### Servers, ports and which project talks to which

10. **Playwright has no per-project `webServer`** — the `webServer` array is global and every entry starts for every run — so the two-server topology needs **two config files**:

    | Config | Projects | Server | Base URL |
    |---|---|---|---|
    | `playwright.config.ts` | `smoke`, `a11y-ru`, `a11y-en` | `npx opennextjs-cloudflare preview --port $E2E_PREVIEW_PORT` | `http://127.0.0.1:$E2E_PREVIEW_PORT` |
    | `playwright.perf.config.ts` | `perf` | `npm start -- --port $E2E_NEXT_PORT` | `http://127.0.0.1:$E2E_NEXT_PORT` |

    `E2E_PREVIEW_PORT` defaults to `8787` (wrangler's documented default) and `E2E_NEXT_PORT` to `3000`. The port is passed **explicitly on the command line** and read from the env — never from `wrangler.jsonc`'s `dev.port`, which **does not exist**: the committed `wrangler.jsonc` has no `dev` block and `specs/01-architecture.md` never defines that key (both grepped 2026-09-12). A config that silently defaults to a port nothing is listening on is how an E2E suite spends an afternoon "flaking", so each config asserts its server answered before the first test: `global-setup.ts` fetches `/api/health` and fails with the port in the message if it does not get a 200.

    If `E2E_BASE_URL` is set, both configs skip `webServer` and run against that URL (a Workers preview deployment) — the escape hatch when workerd will not start locally, so r02 §4.15 can cost local convenience but never block the suite.

11. **What `perf` actually runs against, measured.** The earlier draft chose `next start` because it "keeps the perf gate workerd-free". That justification is **false and is deleted.** `next start` loads `next.config.ts`, which calls `initOpenNextCloudflareForDev()`; that function is gated only on `globalThis.AsyncLocalStorage` (`shouldContextInitializationRun()` in `@opennextjs/cloudflare/dist/api/cloudflare-context.js`), with **no `NODE_ENV` check** — so it boots Miniflare/workerd and installs the context symbol `getCloudflareContextSync()` needs. Proven here on 2026-09-12 against this repo's build: `npx next start` logged `✓ Running next.config.ts took 855ms` and `Using secrets defined in .dev.vars`, `GET /` returned **200**, and `GET /api/health` returned **200** with `{"checks":{"d1":{"ok":true},"migrations":{"ok":true},"r2":{"ok":true},"kv":{"ok":true}}}`.

    So the choice stands but for the real reason: **`next start` is where the byte budget is *defined***, because Next's own `compress: true` produces the gzip stream we measure, and LCP/TBT/CLS are Next-side properties. `perf` keeps it, and the preconditions are now explicit: the `perf` config's global setup asserts `/api/health` returns 200 with every binding `ok` **before** any measurement, and a budget route that renders an error page fails the gate loudly instead of being measured as a cheap 5 KB.
12. **Both perf gates run signed in.** The brief requires auth on all routes, and unauthenticated navigation to `/`, `/workouts`, `/analytics`, … redirects (proven: `GET /login` today 307s to `/setup`), so an unauthenticated run would measure the same page fourteen times and report a green gate on a broken app. Therefore:
    - `playwright.perf.config.ts` uses its own `storageState: "storageState.perf.json"` — a **fresh, signed-in** state written by `global-setup.ts`, with `serviceWorkers: "block"` so a warm SW cache can never flatter a byte measurement. State is not shared with `smoke`, but both are authenticated.
    - `measureRouteJs()` returns `finalUrl`, and the spec asserts `new URL(finalUrl).pathname === requestedPath`. A silent auth regression turns the gate **red**, not green.
    - LHCI gets a session through `ci.collect.settings.extraHeaders` (§28).

### The acceptance test — "log a full workout offline and sync it"

13. `tests/e2e/offline-workout.spec.ts` is the first file of `smoke` and runs serially:
    1. `browser.newContext({ serviceWorkers: "allow", storageState: "storageState.json", locale: "ru-RU", timezoneId: "Asia/Almaty" })`. `serviceWorkers` is set **explicitly** so that a future config change to `"block"` cannot silently delete the subject under test — Playwright's documented default is already `'allow'` (verified at playwright.dev/docs/api/class-browser: *"Defaults to `'allow'`."*), so this is hygiene, not a fix.
    2. `page.goto("/")`, then `installedAndPrecached(page, ["/~offline", "/workout/new"])`, polling `navigator.serviceWorker.ready` then `caches.open(PRECACHE_NAME)` until every required URL matches. `/~offline` is there because `additionalPrecacheEntries` puts it there (r05 §6b, and `serwist.config.mts` in this repo); a regression fails here first and names the cause.
    3. Warm the route: `page.goto("/workout/new")` once **online**, so its chunks and RSC payload are in the SW caches. This models reality (open the app at home, lose signal in the basement gym) — a stated precondition, not a cheat.
    4. `goOffline(context)`. Assert the offline badge by accessible name via `t("offline.badge")`, then `assertWireIsDead(page)` — the positive proof described in §Interfaces.
    5. Log a full workout: 3 exercises × 3 sets with weight/reps/RPE, one superset, one rest-timer expiry, then finish. Assert the live e1RM readout and the PR toast — pure-client computations that must not need network.
    6. Assert `outboxCount(page) >= 1`, then **hard-reload while still offline** and assert the session is restored from IndexedDB and `/workout/new` is served from precache.
    7. `goOnline(context)`; `await expect.poll(() => outboxCount(page)).toBe(0)` with a 30 s timeout.
    8. Verify server-side persistence **through the app's own read path**, never by querying D1 from the test: navigate to `/workouts?fresh=1` and assert the workout, its set count and its volume load. That is what makes one test valid against both `preview` and `E2E_BASE_URL`.
14. **How offline is simulated, exactly.** `goOffline` does **both** `await context.route("**/*", (r) => r.abort("internetdisconnected"))` **and** `await context.setOffline(true)`. `setOffline` alone is insufficient — it does not stop requests once a service worker is in play (Playwright issue #2311; Chromium and Firefox affected, WebKit not). `context.route` is the right level because *"browserContext.route() sees the request"* made by a service worker, and `route.request().serviceWorker()` is truthy for those (Playwright "Service Workers" docs). Requests the SW answers from Cache Storage never touch the network and so are never routed — exactly why step 3's warming matters, and exactly why the wire-is-dead probe uses a URL that has never been fetched. `goOnline` calls `context.unroute("**/*")` then `setOffline(false)`.
15. The app must ship `reloadOnOnline={false}` (r05 gotcha 5: the default `true` reloads on every `online` event, discarding an in-progress workout). A regression makes step 7 reload mid-assertion and the test fails — intended detection, not a flake. Asserted directly: a sentinel set on `window` before reconnect must survive the drain.
16. Every spec file gets a fresh context.

### Deterministic time

17. **No function under `src/lib/**` or `src/server/**` may read the clock.** Time enters as `nowMs: number` (epoch ms, UTC) or an injected `Clock`. The only file allowed to call `Date.now()` is `src/server/clock.ts` (exporting `systemClock`), with one `eslint-disable-next-line`. r09 already writes the calculators this way — `rolling7dWindow(nowUtc: Date)` takes the instant as an argument. Factories convert at their boundary (`startedAt: new Date(clock.now())`) because the schema's insert type is `Date`; the `Clock` itself stays numeric so `advance()` is plain arithmetic.
18. Enforced in `eslint.config.mjs` (extending r12 §J) for `src/lib/**` and `src/server/**`: `no-restricted-syntax` on `NewExpression[callee.name='Date'][arguments.length=0]`, `CallExpression[callee.object.name='Date'][callee.property.name='now']`, `MemberExpression[object.object.name='Temporal'][object.property.name='Now']` and `MemberExpression[property.name='transaction']` on a `db` object (§7b); plus `no-restricted-globals` on `performance` outside `src/components/**` (the rest timer may use `performance.now()` client-side; nothing that writes to D1 may).
19. Pure code therefore needs no fake timers — tests pass `fixedClock("2026-09-12T06:00:00+05:00")`. `vi.useFakeTimers()` is allowed **only** in the `dom` project, for rest-timer and outbox-retry tests, paired with `vi.useRealTimers()` in `afterEach`. In Playwright use `page.clock`, never real waiting. Date strings in assertions come from `appDay()`, never `toLocaleDateString` with the runner's locale, and every calendar-shaped test includes one instant in local `00:00–05:00`, because UTC+5 puts those on the previous UTC date (r09 §8). One vector covers an instant **before 2024-03-01**, asserting the UTC+6 behaviour `src/lib/time.ts` must produce; `appDay()` delegating to the app is what makes that assertion meaningful rather than circular.

### Locale contract

20. The app's default locale is Russian — `wrangler.jsonc` sets `DEFAULT_LOCALE: "ru"`, the brief says "i18n RU/EN (default RU)", and the served page today is `<html lang="ru">` (verified). So:
    - Both Playwright configs pin `use: { locale: "ru-RU", timezoneId: "Asia/Almaty" }`. A suite whose accessible names depend on the runner's machine locale is not a gate.
    - **No assertion hardcodes a display string.** Accessible names, empty-state copy and CTA labels are asserted through `t(key)` (`tests/e2e/helpers/copy.ts`), which reads `messages/ru.json` / `messages/en.json`. A copy change is then a catalogue change, and a *missing* key fails the test with the key name.
    - `a11y-ru` and `a11y-en` are two projects over the same route list. EN is gated too, because `html-has-lang` / `valid-lang` are WCAG rules: a locale switch that fails to update `lang` fails the a11y gate, and without an EN project the failure would appear only in production.
    - One smoke case switches locale and asserts `document.documentElement.lang` follows, so an a11y failure of that shape is diagnosable in one line instead of being blamed on axe.

### Factories, fixtures, states

21. Factories are pure: `resetFactories()` resets an integer counter, ids run deterministically, timestamps derive from the test's `Clock`. A factory never inserts — it returns an insert object so a test can mutate before writing.
22. **`tests/fixtures/seed.sql` is generated, not authored.** `scripts/gen-fixture-seed.mjs` reads `src/db/schema.ts` and emits literal-value inserts in r02 §2.7 shape (no `BEGIN`/`COMMIT`, **parents before children**, every statement under 90 KB). `npm run db:seed:check` re-generates and diffs in the `schema` CI job, so a schema change that the fixture has not followed is reported there, by table name, before any data test runs. Hand-editing the `.sql` is a review-blocking defect.

    The table list is taken from `specs/02-data-model.md`'s model, **not** from the brief's draft — the draft named three tables that do not exist (`progress_photos`, `streaks`, `achievements`) and omitted the ones the tests need. Insert order, parents first:

    `users` → `settings` → `volume_weights` → `exercises` → `exercise_muscles` → `programs` → `routines` → `routine_exercises` → `workouts` → `workout_exercises` → `sets` → `personal_records` → `body_measurements` → `photos` → `foods` → `food_entries` → `water_logs` → `daily_checkins` → `tdee_snapshots` → `streak_state` → `streak_ledger` → `xp_ledger` → `achievement_unlocks` → `quests` → `ai_prompt_logs`

    Notes on the corrections: `photos` (not `progress_photos`); `streak_state` **and** `streak_ledger` (not `streaks`); `achievement_unlocks` (not `achievements` — the catalogue lives in code, per specs/02); `users` is mandatory because `PRAGMA foreign_keys` is forced ON and every other row hangs off it; `workout_exercises` is mandatory because sets hang off it and supersets are modelled there; `exercise_muscles` is mandatory because the rolling-7-day per-muscle volume query is `sets JOIN exercise_muscles` (specs/02 P5); `xp_ledger`, `streak_ledger`, `quests` and `tdee_snapshots` are mandatory because the gamification and adaptive-TDEE tests exist to read history.

    Contents: **8 weeks** — 24 workouts across a PPL split, ~430 sets with at least one PR per lift, 40 bodyweight readings, 50 food entries, 56 checkins, one `tdee_snapshots` row per week. The weight series deliberately straddles the outlier boundary in **both** directions: **one reading 3.5 kg off the trend (excluded) and one exactly 3.0 kg off (kept)**, because r09 §4's rule is `Math.abs(r.kg - T) > OUTLIER_ABS_KG` — strictly greater, so a 3.0 kg deviation is *inside* the band and a fixture built from "two 3 kg outliers" would have made the mandated rejection case fail. It also contains one 5-day gap, for §26's gap-policy assertion. `seedFixture(db)` returns a typed id map (`{ pplWorkoutIds, benchExerciseId, prSetId, … }`); tests reference those names, never literal row ids, and `tests/e2e/helpers/routes.ts` resolves `/workout/[id]` from `pplWorkoutIds[0]`.
23. Empty, loading and error states are test subjects. For every list surface the suite asserts all three: empty (fresh DB → the copy resolved through `t()` and its CTA), loading (a skeleton node before data resolves), error (handler forced to 500 → the error card with a retry that demonstrably re-fetches).

### Performance gates

24. **Client-JS budget, measured.** `tests/perf/bundle-budget.spec.ts` navigates each canonical route in a fresh context with `serviceWorkers: "block"` and an empty cache, sums `request.sizes().responseBodySize` over every response with `resourceType() === "script"`, and splits the total into:
    - **shared baseline** — the files listed in `.next/build-manifest.json`'s `rootMainFiles`, which App Router loads on **every** route before any page-specific chunk;
    - **route delta** — everything else.

    `responseBodySize` is documented as the **encoded** size and `next start` gzips by default (`compress: true` is the verified default in `next@16.3.5`, `dist/server/config-shared.js:115`), so the measured number is gzipped bytes **where the response is above Next's compression size threshold**; Next's bundled `compression` skips small bodies and never emits brotli, so a sub-threshold chunk is counted uncompressed. That makes the measurement slightly pessimistic and fully reproducible, which is what a gate needs. Polyfills (`polyfillFiles`) are **excluded** from the budget: they are delivered via `nomodule` and no target browser downloads them (measured: 38.7 KB gzipped, which would otherwise distort every row). Deliberately **not** parsed from `.next/app-build-manifest.json`: that file does not exist in Next 16 — `shared/lib/constants.js` defines only `build-manifest.json` and Turbopack's `client-build-manifest.json`, so a script carried over from a Next 13–15 recipe would silently measure zero and pass forever.
25. **The measured Phase-0 baseline, and why the budget is expressed as `shared + delta`.** Measured on 2026-09-12 against the built app in this repo (`.next/build-manifest.json`, `zlib.gzipSync` at the default level 6):

    | Item | Files | Gzipped |
    |---|---|---|
    | `rootMainFiles` (every route pays this) | 5 | **127.1 KB** |
    | `polyfillFiles` (`nomodule` only, excluded) | 1 | 38.7 KB |
    | `lowPriorityFiles` | 3 | 0.5 KB |

    The app at that point had one login page, one setup page, a placeholder dashboard and no features. A flat per-route total budget is therefore arithmetically impossible to write honestly: eight of the twelve numbers in this spec's previous draft were already blown before a single feature existed. So the budget has **two independent line items**:

    - `sharedBaselineKb` — a gate of its own, committed at **145 KB** (127.1 measured + 18 KB of headroom for the root layout's providers, the bottom nav and the theme shell). This is the single most valuable number in the file to attack: 1 KB saved here is 14 KB saved across the route list.
    - `maxRouteDeltaKb` per route — a **ratchet**. The committed value is always *last measured delta + 10 KB*. A route whose surface does not exist yet has `status: "measure"`: the step prints its number and does **not** fail. The phase that ships the surface flips it to `"gated"` in the same PR, with the measured number. Rule §46 then applies: raising a gated number needs a spec change and a reason.
    - `targetDeltaKb` — the ceiling this spec sets for the finished surface. Exceeding it is not a test edit at all; it is an owner decision, because it is where the brief's total ceiling gets spent.

26. Budget (`perf-budgets.json`) — **fourteen** routes. This is the one canonical list; `tests/e2e/a11y.spec.ts` and `lighthouserc.cjs` both read this file rather than keeping their own copies, which is what previously let a "twelve routes" a11y list (`/workout/new`, no `/workout/[id]`) drift from a "twelve routes" budget list (`/workout/[id]`, no `/workout/new`). `/workout/new` and `/workout/[id]` are **two rows**, because they are two surfaces: an exercise picker and GYM MODE. Total = `sharedBaselineKb` (145) + `targetDeltaKb`.

    | Route | Concrete URL | Surface | Owner | target Δ KB | total KB |
    |---|---|---|---|---|---|
    | `/~offline` | `/~offline` | offline fallback | 05 | 5 | 150 |
    | `/login` | `/login` | auth | 04 | 10 | 155 |
    | `/setup` | `/setup` | first-run setup | 04 | 15 | 160 |
    | `/settings` | `/settings` | settings, export/import | 15 | 35 | 180 |
    | `/workouts` | `/workouts` | session history | 06 | 40 | 185 |
    | `/workout/new` | `/workout/new` | exercise picker | 06 | 40 | 185 |
    | `/exercises` | `/exercises` | library + fuzzy search | 08 | 45 | 190 |
    | `/programs` | `/programs` | routine builder | 09 | 45 | 190 |
    | `/workout/[id]` | `/workout/${pplWorkoutIds[0]}` | **GYM MODE** | 06 | 55 | 200 |
    | `/nutrition/camera` | `/nutrition/camera` | capture + correction loop | 11 | 55 | 200 |
    | `/body` | `/body` | trend + compare slider | 10 | 55 | 200 |
    | `/nutrition` | `/nutrition` | day view + macro rings | 11 | 55 | 200 |
    | `/` | `/` | dashboard (both heatmaps) | 12 | 75 | **220** ⚠ |
    | `/analytics` | `/analytics` | charts | 12 | 145 | **290** ⚠ |

    `/workout/[id]` is capped hardest relative to its feature weight on purpose: it must work offline, one-handed, in a basement, so charts and exercise media are dynamic imports there, never static.

    The two ⚠ rows exceed the brief's 200 KB per-route ceiling and **this spec does not pretend otherwise**. At a 127 KB measured floor the brief's ceiling is a ~70 KB per-route allowance, which rules out `recharts@3.10.1` (~100 KB gzipped alone) and `@visx/visx` on the same route. That is a product decision about which chart library ships, not a test detail, so it is Open question 3 with a recommendation — and until it is answered, `/` and `/analytics` stay `status: "measure"` and the step prints their numbers loudly every run.
27. Budget failures are **hard** for any row whose `status` is `"gated"`, and for `sharedBaselineKb`. The step prints `route / shared / delta / budget / delta-vs-budget / status` for all fourteen routes on every run, pass or fail, so a regression is attributable to one commit. Raising a gated number requires the same PR to touch this spec with the reason; raising it past `targetDeltaKb` requires an owner decision recorded in `DECISIONS.md`.
28. **LCP.** `@lhci/cli@0.15.1` (bundles `lighthouse@12.6.1`) against `next start`, `numberOfRuns: 3`, with Lighthouse's **default mobile emulation** — a Moto G Power (2022), 412×823, DPR 1.75, `mobileSlow4G` (verified in Lighthouse's `core/config/constants.js`). That *is* the brief's "mid-range mobile", so no custom throttling is configured; inventing one makes the number incomparable to PageSpeed Insights.

    `lighthouserc.cjs` is **JavaScript**, not JSON, for three reasons the earlier JSON draft could not satisfy: it must read the canonical route list, it must inject a session, and it must start its own server.

    ```js
    // lighthouserc.cjs — shape only; every key below is a real LHCI option (verified against
    // GoogleChrome/lighthouse-ci docs/configuration.md, 2026-09-12).
    const { readFileSync } = require("node:fs");
    const budgets = JSON.parse(readFileSync("perf-budgets.json", "utf8"));
    const { cookie } = JSON.parse(readFileSync(".lighthouseci/session.json", "utf8"));
    const ORIGIN = `http://127.0.0.1:${process.env.E2E_NEXT_PORT ?? 3000}`;
    module.exports = {
      ci: {
        collect: {
          // Nothing is listening after a Playwright run tears down its own webServer, so LHCI
          // starts its own. Without this the step fails with connection errors on the first run.
          startServerCommand: `npm start -- --port ${process.env.E2E_NEXT_PORT ?? 3000}`,
          startServerReadyPattern: "Ready in",     // next@16.3.5 prints "✓ Ready in 180ms" (measured)
          startServerReadyTimeout: 60000,          // LHCI's default is 10000 — too short for a cold start
          numberOfRuns: 3,
          url: budgets.routes.map((r) => ORIGIN + r.url),   // SAME origin/port as playwright.perf.config.ts
          settings: {
            onlyCategories: ["performance"],
            // Lighthouse has no session mechanism of its own. Without this every URL measures
            // the login page and the gate is meaningless. `global-setup.ts` mints the cookie.
            extraHeaders: JSON.stringify({ cookie }),
          },
        },
        assert: { assertions: { /* §28 continued */ } },
        upload: { target: "filesystem", outputDir: ".lighthouseci" },
      },
    };
    ```

    `ci.upload.target: "filesystem"` is kept as a workflow artifact — **never** `"temporary-public-storage"`, which would publish a personal health app's screenshots.

    **Assertions, split by what the brief actually requires.** The brief asks for "LCP < 2.5 s on mid-range mobile", so that is the only unconditional hard gate:

    ```jsonc
    {
      "largest-contentful-paint": ["error", { "maxNumericValue": 2500, "aggregationMethod": "median" }],
      "cumulative-layout-shift":  ["error", { "maxNumericValue": 0.1,  "aggregationMethod": "median" }],
      "total-blocking-time":      ["error", { "maxNumericValue": 300,  "aggregationMethod": "median" }],
      "categories:performance":   ["error", { "minScore": 0.9 }]
    }
    ```

    …with a documented exemption: for `/` and `/analytics` — the two ⚠ routes — `total-blocking-time` and `categories:performance` are `"warn"`, not `"error"`, via a second `assertMatrix` entry keyed on those URLs. Reason, written down rather than discovered later: on an emulated Moto G Power over `mobileSlow4G`, a ≥0.9 performance score and ≤300 ms TBT on a route carrying a 127 KB floor **plus** a chart library is optimistic, and §46 forbids relaxing a gate under pressure — so the honest move is to declare the exemption now and record the intent to tighten it in the phase that finishes those routes. LCP stays `error` on all fourteen, because that is the brief's number and it is achievable with a server-rendered shell. `aggregationMethod` is explicit because the default is `"optimistic"` (verified values in `@lhci/utils@0.15.1` `src/assertions.js`: `median`, `optimistic`, `pessimistic`, `median-run`; presets `lighthouse:all|recommended|no-pwa`).
29. **No PWA gate.** There is no Lighthouse PWA category and no installability audit any more (r05 §8: `grep -i pwa` over Lighthouse's shipped category list → 0 hits). The brief's "passes Lighthouse PWA" is replaced by four checks: a smoke test fetches `/manifest.webmanifest` and asserts `name`, a 192px and a 512px icon, `start_url`, `display: "standalone"` and no `prefer_related_applications: true`; `GET /sw.js` → 200 `text/javascript` with a short `Cache-Control`; exactly one activated SW at scope `/`; and `grep -q "google-fonts-webfonts" public/sw.js` in CI proves the SW was built with `NODE_ENV=production` (r05 gotcha 1 — a dev-built SW installs happily and caches nothing).

### The smoke suite, one row per acceptance-checklist line

30. `tests/e2e/smoke.spec.ts` is enumerated **one-to-one** against `specs/00-brief.md`'s "Final acceptance checklist", with the checklist line quoted next to each `test()` name. The earlier draft covered four of nine and silently dropped the rest.

    | Brief line (quoted) | Test | Asserts |
    |---|---|---|
    | "Installable PWA, passes Lighthouse PWA + performance budget" | `@smoke manifest + sw` | the four §29 checks |
    | "Log a full workout fully offline, then it syncs on reconnect" | `tests/e2e/offline-workout.spec.ts` | §13 in full |
    | "Rest timer, e1RM, PR-with-confetti, supersets, plate calc all work" | `@smoke gym mode` | timer expiry + haptic, live e1RM readout, PR toast + confetti mounted then gone, a superset pair rendered as one group, plate calculator output for a 100 kg target |
    | "Food photo to multi-item macros with confidence, user edits, saved; barcode works" | `@smoke food photo loop` | a fixture photo yields ≥2 items; **a confidence value is visible for each**; the user edits one macro; after save, the **edited** value is what `/nutrition` reads back (not the AI's). Plus a barcode scan resolving to a `foods` row. This is the brief's honest-data principle and nothing else asserted it. |
    | "SVG muscle heatmap + calendar heatmap render from real data" | `@smoke heatmaps` | both render from the fixture, ≥1 muscle region non-zero, the calendar cell for a known fixture workout day is filled, and the muscle total equals the per-muscle sum (guards r09 §8's 72 %-double-count trap) |
    | "Streak survives a grace day (no hard reset to zero); achievements unlock" | `@smoke streak grace` | with a grace day in the fixture ledger, `streak_state.current_days` did **not** reset to 0 and the day's `streak_ledger.status` is `grace`; one `achievement_unlocks` row appears and its toast is announced |
    | "Weekly report delivered to Telegram via Cron Trigger" | `@smoke cron weekly report` | invokes the scheduled handler on the preview server directly — `GET /cdn-cgi/local/scheduled?cron=<weekly expr>&format=json` (the probe `specs/01-architecture.md` §Verification and `specs/13-gamification.md` already use) — then asserts a `cron_runs` row with `ok = 1` and a `notification_log` row for `channel = "telegram"`, `kind = "weekly_report"`, today's `local_day`. The Telegram HTTP call itself is stubbed at the network layer; delivery to the real API is the nightly run's job. |
    | "CSV/JSON export + Hevy/Strong/MFP import work" | `@smoke export` / `@smoke import` | export downloads and parses for both formats; **import** stages a Hevy CSV, a Strong CSV and an MFP CSV (three fixtures under `tests/fixtures/import/`) and asserts `import_batches.status = "applied"` with `rows_imported > 0` and no `rows_skipped` for the happy fixture. Import was missing entirely from the earlier draft. |
    | "All calculators covered by passing unit tests; smoke test green" | the `unit` project + this file | §§1–4, 46 |

### Security gates

31. The brief's Security NFR lists five testable properties and the earlier draft gated only one of them. These are cheaper than the a11y gate and protect more, so they are first-class:
32. **Unauthenticated-route sweep.** `tests/security/auth-required.test.ts` is table-driven over the route manifest (`.next/routes-manifest.json` plus a glob over `src/app/api/**/route.ts`), and for every route **not** on `specs/04-auth.md` §367's unauthenticated allow-list (`/api/health`, `/api/auth/**`, `/api/telegram`, `/api/cron/**`, `/login`, `/setup`, `/~offline`, `/manifest.webmanifest`, `/sw.js`, the icons) asserts that a request with no session cookie returns **401** and `Content-Type: application/json` — never a 302 to HTML, per specs/01 §18. The allow-list is a literal array in the test; **adding a route to it is a review-blocking change**, which is the point.
33. **No secrets in the client bundle.** A ten-line, zero-flake CI step greps the built client output — `.next/static/**` and `.open-next/assets/**` — for secret-shaped strings: `CRON_SECRET`, `SESSION_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`, any `AI_`-prefixed or `CLOUDFLARE_`-prefixed identifier, `sk-`/`AIza` key prefixes, and **every value in `.dev.vars`** (read line by line, so a real local secret that leaked into a client component fails the build even if its name is new). It runs after `npm run build` and before anything expensive.
34. **Rate limits.** One handler test per rate-limited surface (the AI food-estimate route and the auth routes): N+1 calls through the injected `RateLimiter` returns **429** with `error.code === "rate_limited"` on the last, per specs/01's mapping. The limiter is injected, so this is a handler test, not an E2E flake.
35. **Signed R2 URLs.** One test asserts a photo URL produced by the app is signed and carries an expiry, and that a request with a deliberately past expiry is rejected. The key pattern and the TTL belong to `specs/10-body-photos.md`; this spec asserts only "signed, and expires".

### Accessibility gate

36. `tests/e2e/a11y.spec.ts` runs `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze()` (`@axe-core/playwright@4.13.0`; `AxeBuilder` is both the named and default export, verified in its shipped `index.d.ts`) over the **canonical fourteen routes from `perf-budgets.json`**, in both `a11y-ru` and `a11y-en`. `best-practice` tags are excluded — the gate is WCAG AA, and best-practice noise is how a11y gates get switched off.
37. `expect(results.violations).toEqual([])` **and** `expect(results.incomplete).toEqual([])`. The `incomplete` array is not noise here: it is where `color-contrast` lands when a node sits on a gradient, an image or a translucent layer — and the brief's design system is "subtle glassy layers" over OLED black, so the contrast rule will frequently return `incomplete` rather than `violations`. Asserting only `violations` would evaporate this spec's only contrast coverage. Suppression for either array goes only through `tests/e2e/a11y-exceptions.json`, and the spec asserts `exceptions.length <= 3` **in total across both kinds**, with a non-empty `issueUrl` on each, so the list cannot become a permanent waiver.
38. Each route is scanned again **with its primary bottom sheet open** (log-set, food-correction, plate calculator), because focus trapping and `aria-modal` are where Radix misuse shows and a closed sheet renders nothing to scan.
39. Two things axe cannot assert, in the same spec:
    - **Tap targets**, on every route — not only GYM MODE. Every interactive control in each route's **persistent chrome** (the bottom tab bar, the central FAB, every sheet trigger) plus every control inside GYM MODE has a bounding box ≥ 56×56 CSS px (`--spacing-tap`; shadcn's default button is 32 px — r12 G12). The bottom nav and the FAB are used on every screen, so scoping this to one route measured the least important case.
    - With `colorScheme: "dark"` + `reducedMotion: "reduce"` the app renders and no element on the critical path reports a non-zero `getAnimations()` duration.

### CI

40. `.github/workflows/ci.yml`, verbatim — r12 §N's verified credential-free baseline plus `schema`, `e2e`, `perf`. It **replaces** the committed `ci.yml`, whose `deploy` job is deleted in the same PR: `deploy.yml` (§42) takes over, and leaving both would give the repo two deploy paths with different gates. Step order is load-bearing: `next typegen` must precede `tsc --noEmit` or a clean clone fails with `Cannot find name 'LayoutProps'` (r12 G1).

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  NEXT_TELEMETRY_DISABLED: "1"
  WRANGLER_SEND_METRICS: "false"
  NODE_OPTIONS: "--disable-warning=ExperimentalWarning"
  E2E_PREVIEW_PORT: "8787"
  E2E_NEXT_PORT: "3000"
  CI: "true"

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Generate Next route types
        run: npm run typegen
      - name: Typecheck (src + tests)
        run: npx tsc --noEmit
      - name: Cloudflare env types are in sync
        run: npm run cf-typegen:check
      - name: Lint
        run: npm run lint
      - name: Format check
        run: npm run format:check
      - name: Unit + data + route + security tests (coverage)
        run: npm run test:coverage
      - name: Build (Next + service worker)
        run: npm run build
      - name: No secrets in the client bundle
        run: node scripts/check-no-client-secrets.mjs .next/static
      - name: Service worker was built in production mode
        run: grep -q "google-fonts-webfonts" public/sw.js
      - name: _headers is not in the precache manifest
        run: if grep -q '"/_headers"' public/sw.js; then echo "globIgnores regression"; exit 1; fi
      - name: Offline fallback was prerendered
        run: test -f .next/server/app/~offline.html
      - name: Build (OpenNext worker)
        run: npx opennextjs-cloudflare build
      - name: No secrets in the worker assets
        run: node scripts/check-no-client-secrets.mjs .open-next/assets
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: coverage
          path: coverage/
          retention-days: 7

  schema:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Migrations replay exactly to src/db/schema.ts
        run: npm run db:verify
      - name: Committed human-readable snapshot is current
        run: |
          npx drizzle-kit export --sql > /tmp/live-export.sql
          diff -u docs/db/schema.snapshot.sql /tmp/live-export.sql
      - name: Journal/snapshot chain is intact
        run: npx drizzle-kit check
      - name: Fixture seed matches the current schema
        run: npm run db:seed:check
      - name: Applied migration files were not edited
        run: |
          git diff --name-only origin/main...HEAD -- drizzle/migrations \
            | grep -E 'drizzle/migrations/[0-9]{4}_.*\.sql' > /tmp/changed.txt || true
          while read -r f; do
            [ -z "$f" ] && continue
            if git cat-file -e "origin/main:$f" 2>/dev/null; then
              echo "ERROR: $f already exists on main and must never be edited (r02 4.4)"
              exit 1
            fi
          done < /tmp/changed.txt
      - name: New migrations do not destroy rows
        run: node scripts/check-migration-safety.mjs

  e2e:
    runs-on: ubuntu-latest
    needs: [verify, schema]
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Local D1 schema + fixture
        run: |
          npm run db:migrate:local
          npm run db:seed:local
      - name: Build Next + worker
        run: |
          npm run typegen
          npm run build
          npx opennextjs-cloudflare build
      - name: Smoke + accessibility (preview worker, :8787)
        run: npm run test:e2e
      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

  perf:
    runs-on: ubuntu-latest
    needs: [verify]
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Local D1 schema + fixture
        run: |
          npm run db:migrate:local
          npm run db:seed:local
      - run: npm run typegen && npm run build
      # Starts `next start` itself, signs in, writes storageState.perf.json AND
      # .lighthouseci/session.json, then measures. LHCI reuses the same origin and port.
      - name: Per-route client-JS budget
        run: npm run test:perf
      - name: Lighthouse (LCP, 3 runs, mobile)
        run: npx lhci autorun --config=lighthouserc.cjs
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: lighthouse
          path: .lighthouseci/
          retention-days: 7
```

41. **PR vs main.** Identical job set — a gate that only runs on `main` is a gate that only ever fails after merge. The only differences: `cancel-in-progress` is `true` here and `false` for deploy, and LHCI's machine-dependent numbers are absorbed by the median of three runs. No CI job needs a Cloudflare credential; every step is offline-safe, including `opennextjs-cloudflare build`, which only bundles (r12 §N). **Required checks on `main`:** `verify`, `schema`, `e2e`, `perf` — all four always run, with no `paths` filters, because a required check that gets skipped blocks merges indefinitely.
42. **Why deploy is gated, and what it may touch.** Deploy runs `wrangler d1 migrations apply --remote` against the one production database. There is no staging copy and no cheap point-in-time restore on our plan, so an unverified migration is unrecoverable data loss — r02 §4.1 shows a migration that reports *success* while silently deleting every row in `sets`. So `deploy.yml` is r12 §O's workflow with four changes:
    - (a) `on: workflow_run: { workflows: [CI], types: [completed], branches: [main] }` plus `workflow_dispatch`, with `if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'`, so a push cannot race CI.
    - (b) `actions/checkout@v7` pins `ref: ${{ github.event.workflow_run.head_sha || github.sha }}`.
    - (c) after `db:migrate:remote` it runs `node scripts/verify-schema.mjs --live` (live D1 schema vs `docs/db/schema.snapshot.sql`, r02 §2.6).
    - (d) after `npm run deploy` it runs `npx playwright test -c playwright.config.ts --grep @post-deploy` with `E2E_BASE_URL` set to the production URL. **`@post-deploy` is strictly read-only.** It may assert: `/api/health` → 200 with every binding `ok`; `/manifest.webmanifest` parses and matches §29; exactly one activated SW at scope `/`; and an unauthenticated `GET` of one `/api/**` route → 401. It may **not** create a workout, upload a photo or write any row — Open question 2 rejects production writes precisely because "nightly runs would write real workouts and real R2 photos into the single user's own history", and a post-deploy smoke test that logs a workout is the same mistake with a different name. Because it is read-only and runs after production has already been migrated, `@post-deploy` is the **one** place `retries: 1` is allowed (§46c), with the reason stated in the config: a single network hiccup must not red-flag a deploy that already succeeded.

    Secrets the deploy workflow needs, stated so nobody discovers them at 2 a.m.: `CLOUDFLARE_API_TOKEN` (with **`D1 — Edit`** added by hand; the "Edit Cloudflare Workers" template omits D1 — r12 §O), `CLOUDFLARE_ACCOUNT_ID`, and the app's own `SESSION_SECRET` plus the E2E credentials the read-only check signs in with — §41's "no job needs a Cloudflare credential" is about **CI**, and deploy is deliberately the exception. It keeps `environment: production`, which gates those secrets and can require manual approval — Cloudflare: *"Don't store the value of `CLOUDFLARE_API_TOKEN` in your repository"* (r12 §O).
43. **The migration-drift job, specified.** `schema` does six independent things, cheapest first, and needs no secrets so it runs on every PR: (1) `db:verify` — r02 §2.6's offline guard: replay `drizzle/migrations/*.sql` into `node:sqlite`, compare against `drizzle-kit export --sql` as order-independent `PRAGMA table_info` / `index_list` / `index_info` / `foreign_key_list` sets, ignoring `d1_migrations`, `_cf_KV`, `revalidations`, `__drizzle_migrations` — structural, not DDL text, because `ALTER TABLE ADD COLUMN` appends while `export` emits declaration order; (2) a `diff` of the committed human-readable `docs/db/schema.snapshot.sql`, the only artefact a person can review; (3) `drizzle-kit check` for journal/snapshot collisions; (4) `db:seed:check`, so fixture drift is named here rather than as fourteen unrelated data-test failures; (5) the immutability check, because `d1_migrations` records a **filename, not a hash**, so an edited already-applied migration is invisible forever (r02 §4.1/§4.4); (6) `scripts/check-migration-safety.mjs`.
44. **`scripts/check-migration-safety.mjs`, and why it cannot use the fixture.** For each migration **added** in this PR it must prove migration `N` destroys no rows. The obvious design — build the DB at `N-1`, load `tests/fixtures/seed.sql`, count, apply `N`, re-count — **cannot work**, because `seed.sql` is written against the *current* (post-`N`) schema: the moment migration `N` adds a table, a column or a `NOT NULL` column, the seed fails to load at `N-1` and the only automated defence against r02's headline data-loss finding goes red on exactly the PRs it exists to guard. So the row source is **schema-agnostic and generated by reflection**, with no committed artefact to drift:

    1. Build a DB from `drizzle/migrations/*` up to `N-1`.
    2. Read `PRAGMA table_info` and `PRAGMA foreign_key_list` for every table except the four excluded ones; topologically sort parents before children.
    3. Insert **3 synthetic rows per table**. Values come from a generator keyed on declared type and column-name suffix: `_day`/`_on` → `'2026-09-12'` (satisfies the GLOB CHECK specs/02 puts on those columns), `_at` → an epoch-ms integer, `_kg`/`_cm` → a REAL, `id` → a 26-char ULID-shaped string, a FK column → an id already inserted into its parent, a column whose CHECK text contains quoted literals → the **first** literal (so enum CHECKs pass), otherwise the column's own `dflt_value`.
    4. Record `count(*)` per table; apply file `N` **in one transaction with `PRAGMA foreign_keys = ON`** — exactly how `wrangler d1 migrations apply` executes it, since it batches the file and batches are transactions (r02 §2.5/§4.1); re-count.
    5. **Fail** if any table's count decreased or any table vanished.

    If the generator cannot populate a table, the script **fails**, naming the table, the column and the constraint it could not satisfy. It never skips: a silent skip is what turns this guard into decoration, and a column the generator cannot fill is a signal that specs/02 grew a constraint shape nobody has tested.
45. `npm run test:coverage` = `vitest run --coverage`; `npm run test` stays `vitest run` for local speed. `tsc --noEmit` must cover `tests/**`, so `tsconfig.json`'s `include` gains `tests` and its `types` array stays absent — an explicit `types` allow-list disables every other `@types/*` (r05 gotcha 9). This is also why factories must return `Date`: with `strict` + `exactOptionalPropertyTypes`, a factory returning `number` for a `timestamp_ms` column does not compile, and `verify` would fail before a single test ran.

### The rule

46. **Fix the code, never edit the test to make it pass.** A red test is a claim about the contract; making the claim quieter does not change the contract. (a) A committed expected value may change only in a commit that also changes `specs/**` or `docs/research/**`, and the message must carry a `Test-Change-Reason:` trailer naming the spec section; `verify` emits a GitHub annotation with the diff of any `*.test.ts` / `*.spec.ts` / `tests/calc/fixtures/*.ts` hunk that changes a literal. (b) Never `it.skip`, `test.fixme`, `test.fail`, a relaxed `--max-warnings`, `expect.soft` on a gate assertion, or a widened `toBeCloseTo` precision to get green; deleting a test is a spec change. (c) Flake is a defect in the test or the app, never a reason for retries — `retries: 0` in both Playwright configs, with the single stated exception of `@post-deploy` (§42d); a genuinely timing-dependent wait uses `expect.poll` / `toPass` with an explicit timeout, never `waitForTimeout`. (d) Flipping a `perf-budgets.json` row from `"gated"` to `"measure"` is the same offence as `it.skip` and is reviewed as such.
47. **Per-phase Definition of Done** — `docs/DOD-CHECKLIST.md`, copied into every PR description and ticked before committing:

```text
DoD — Phase <n>: <name>

[ ] npm run typecheck exits 0 (typegen ran first) and covers tests/**
[ ] npm run lint and npm run format:check exit 0
[ ] npm run test:coverage green; src/lib/calc/** still at 100% coverage
[ ] Every new pure function is table-driven from tests/calc/fixtures/r09-vectors.ts
    (or a new vector added there, with a comment citing an r09 section or the owning spec section)
[ ] No new clock read in src/lib/** or src/server/** (the ESLint rule proves it)
[ ] Every new table/column: migration generated by drizzle-kit generate, npm run db:verify green,
    npm run db:seed:check green, docs/db/schema.snapshot.sql regenerated and read by eye
[ ] node scripts/check-migration-safety.mjs green (no table lost rows)
[ ] Every new route handler: happy path + Zod-400 (error.code === "validation_failed") + idempotent-replay test
[ ] Every new /api route is on the 401 sweep, or its addition to the allow-list was reviewed
[ ] No secrets in the client bundle (the grep step is green)
[ ] Every new surface: empty, loading (skeleton) and error state asserted, copy via t(key)
[ ] npm run test:e2e green, including the offline acceptance test and both a11y locales
[ ] a11y: zero violations AND zero incomplete; the exception list is no longer than before
[ ] npm run test:perf green; every route this phase shipped flipped from "measure" to "gated"
    with its measured number; perf-budgets.json otherwise unchanged
[ ] npx lhci autorun --config=lighthouserc.cjs green (LCP < 2500 ms, median of 3, mobile)
[ ] This phase's DoD line from specs/00-brief.md is demonstrably true — paste the command and its output
[ ] No test was weakened, skipped or deleted to get green; no budget row was un-gated
[ ] Decisions recorded in DECISIONS.md; PROGRESS.md updated
[ ] Committed and pushed
```

## Data

Tests read and write the **same** D1 tables the app does; `specs/02-data-model.md` owns every definition and this spec never restates a column list. The fixture's table list, insert order and the three corrections to the brief's draft model are in §22.

Index behaviour is **not** this spec's business: `specs/02-data-model.md` §16 owns `tests/db/index-coverage.test.ts`, which asserts `EXPLAIN QUERY PLAN` for patterns P1–P15 names the intended index and contains no `SCAN TABLE`. This spec adds only a caveat that belongs next to those assertions: they run on `node:sqlite`'s SQLite 3.50.4 with no `ANALYZE` and no `sqlite_stat1`, and the plan text is version-dependent, so they are a **regression canary for our own SQL** — proof that a query still uses the index it was written for — and **not** a guarantee about D1's planner. Treat a change in the plan text as a signal to read the query, not as a D1 outage.

- Test databases are `:memory:` unless a test needs two connections, in which case `makeTestDb({ file })` writes under the OS temp dir and deletes it in `afterAll`. Never under `.wrangler/` — disposable app state (r02 §4.14).
- `d1_migrations`, `__drizzle_migrations`, `revalidations` and `_cf_KV` are excluded from every schema comparison and from `check-migration-safety.mjs`. `revalidations` is created *in our database* by `opennextjs-cloudflare populate-cache` (r02 §2.6), which is also why `NEXT_TAG_CACHE_D1` points at a separate `fitness-pwa-cache-db` database.
- **KV**: no test asserts a cache key; one data-layer test asserts only that a cold miss and a warm hit return byte-identical JSON. E2E uses the namespace miniflare creates; `global-setup.ts` clears it.
- **R2**: E2E uploads go under key prefix `test/<runId>/…`, deleted by `global-setup.ts` on the next run. No test writes a production photo key. One security test asserts the delivery URL is signed and expires (§35).
- **IndexedDB**: the outbox store (name and schema owned by `specs/05-pwa-offline-sync.md`) is read by `outboxCount()` via `page.evaluate`, read-only. `fake-indexeddb@6.2.5` backs the `dom` project.

## UX notes

- The a11y spec drives the UI the way a thumb does: it opens bottom sheets by tapping the trigger, not by an imperative API, and asserts focus lands inside the sheet and returns to the trigger on dismiss.
- Swipe-to-complete and swipe-to-delete use `page.mouse` (down, three moves, up). A single `dragTo` does not emit the intermediate pointer events Motion's gesture handling needs, and a test that passes with one move is not testing the gesture.
- Haptics: `navigator.vibrate` is stubbed in `dom` and spied in E2E via `page.addInitScript`. The suite asserts a vibration on PR detection, rest-timer expiry and set completion — and **no** vibration under `prefers-reduced-motion: reduce`.
- Confetti: asserted present (PR toast plus a canvas node) then asserted **gone** within 4 s. A stuck animation layer swallows taps in GYM MODE, which axe cannot see.
- Skeletons: for every canonical route the perf spec asserts a skeleton node in the first paint of a throttled navigation. A blank first paint is what makes LCP fail, and the byte budget alone will not catch it.
- The offline badge, the pending-outbox count and the "synced" confirmation are three distinct visible states; the acceptance test asserts all three, in that order, by accessible name resolved through `t()` — so the user can always tell whether the gym session is safe, in whichever language they are reading.
- The food-photo loop's confidence value is a **visible** UI element, not a database field: the smoke test reads it off the screen. An app that stores confidence and never shows it fails the brief's honest-data principle while passing a naive test.

## Risks

| Risk | Mitigation |
|---|---|
| `node:sqlite` accepts SQL D1 rejects (parameter / statement-size limits), so a query passes CI and fails in production. | A static test counts bound parameters against 100 and statement byte length against 90 000 bytes — headroom under D1's 100 KB hard limit (r02 §4.7); batch chunking asserted directly; the nightly run exercises the real Worker. |
| The shim's `raw()` collapses duplicate column names, so every joined select returns wrong data *silently*. | `raw()` is `setReturnArrays(true)`, never `Object.values(all())`; `tests/harness/d1.test.ts` asserts two same-named columns come back as two positional values (§7c). |
| `db.transaction()` passes in tests and fails in production — the opposite of the intent. | `prepare()` throws on transaction-control SQL, and ESLint bans `db.transaction` outright (§7b). |
| `workerd` will not start on the dev machine, blocking `e2e` locally (r02 §4.15). | `E2E_BASE_URL` runs identical specs against a deployed preview; the ubuntu runner is the authority. Surface it in Phase 0, not Phase 2. |
| The pool gains a `vitest ^5` peer and we have drifted too far to adopt it. | Every data-layer test goes through `makeTestDb(): TestDb`; adoption changes one file. Re-check the peer range each phase boundary. |
| The offline test flakes because precaching had not finished before `goOffline`. | `installedAndPrecached()` polls Cache Storage for *named* entries instead of sleeping; `retries: 0` means a flake is triaged, not retried away. |
| `setOffline(true)` lets SW-mediated requests through, so the test passes while offline is broken (Playwright #2311). | `goOffline` also aborts at `context.route` level, and the test asserts a *positive* denial via `assertWireIsDead()`. |
| The offline probe is answered from the `apis` runtime cache, so "offline" looks real while it is not. | The probe URL carries a unique query string and `cache: "no-store"`, so `defaultCache`'s `NetworkFirst({cacheName:"apis"})` has nothing to fall back to (§Interfaces). |
| One 404 in the precache manifest kills the whole SW, so every offline test fails for an unrelated-looking reason (r05 gotcha 2). | CI greps the built `public/sw.js` for `"/_headers"` and fails if `globIgnores` regressed, before Playwright runs. |
| The perf or Lighthouse run measures the login page and reports green. | Both run signed in; `measureRouteJs()` returns `finalUrl` and the spec asserts it equals the requested path; LHCI carries the session via `extraHeaders` (§§12, 28). |
| Bytes measured against `next start` differ from what Cloudflare serves (Brotli). | The budget is *defined* as gzip-where-above-Next's-compression-threshold against `next start` — one reproducible definition. Brotli only shrinks it; the nightly LHCI run against the deployed URL catches the reverse. |
| The budget gate is impossible to satisfy, so somebody disables it. | The shared 127.1 KB floor is measured and gated separately; per-route rows are a ratchet with an explicit `"measure"` state; the two routes that cannot meet the brief's ceiling are named, not hidden, and escalated as Open question 3. |
| LCP passes on a warm runner and fails on a real phone. | Lighthouse's default Moto G Power + `mobileSlow4G`, median of 3, plus the nightly run against the deployed Worker. |
| 100 % coverage on `src/lib/calc` degenerates into assertion-free tests. | The vectors are the oracle; review requires a new *vector* for a new branch, not a new call. |
| `tests/fixtures/seed.sql` drifts from the schema and every data test fails at once, masking the real change. | It is generated; `db:seed:check` in the `schema` job reports drift first, with the offending table named. |
| `check-migration-safety.mjs` goes red on exactly the PRs it guards, because the fixture cannot load at `N-1`. | Its rows are generated by reflection over `PRAGMA table_info` at `N-1`; no committed artefact is involved (§44). |
| A future session "fixes" a red test instead of the code. | Rule §46: the `Test-Change-Reason:` trailer, the literal-diff annotation, and the DoD lines about weakening tests and un-gating budget rows. |

## Verification

```bash
# 0. one-time — these belong in package.json + the lockfile (see "package.json changes"),
#    NOT only here, or `npm ci` in CI installs none of them.
npm i -D @playwright/test@1.63.0 @axe-core/playwright@4.13.0 @lhci/cli@0.15.1 \
         jsdom@30.0.1 fake-indexeddb@6.2.5
npx playwright install --with-deps chromium

# 1. Pure functions. PASS = all files pass AND "src/lib/calc | 100 | 100 | 100 | 100".
npx vitest run --project=unit --coverage

# 2. Unit cases that MUST exist. Every number comes from tests/calc/fixtures/r09-vectors.ts,
#    which comes from docs/research/r09-formulas-and-test-vectors.md. Never recomputed here.
#  tests/calc/e1rm.test.ts   E1RM_VECTORS: epley(100,1)=103.333333, brzycki(100,1)=100 exactly;
#                 brzycki(100,5)=112.5 exactly  <- the 37-vs-36 denominator trap (r09 §1);
#                 epley(100,10)=brzycki(100,10)=133.333333; brzycki(100,12)=144.0; epley(100,6)=120.0;
#                 the three guard vectors, all sourced from r09 §1's recommendation block
#                 (BRZYCKI_MAX_REPS = 36): r=36 -> 3600.0 (absurd but finite), r=37 -> null, r=38 -> null
#  tests/calc/e1rm-composite.test.ts   COMPOSITE_VECTORS R1-R6 for max(Epley, Brzycki, RPE):
#                 R2 (100,5,RPE 8) -> 123.304562 via RPE, beating Epley's 116.666667 — the brief's
#                 composite rule, which no earlier test covered; R6 (100,12,RPE 8) asserts spec 07
#                 rule 11's inflation cap fires (158.4, with R6_UNCAPPED_KG 159.489633 asserted NOT
#                 to be the answer); reps=7 at RPE 10 is NOT asserted — r09 §2 says the winner there
#                 is a floating-point coin flip (0.024 kg apart)
#  tests/calc/navy.test.ts   M1 (waist 85, neck 38, h 178)->16.4360; M2 (100,40,178)->25.5011;
#                 F1 (waist 72, hip 96, neck 32, h 165)->26.4059; F2 (88,105,34,165) per r09 §3
#  tests/calc/trend.test.ts  the 10-day worked series (r09 §4); T[1]===W[1]; TREND_ALPHA 0.1;
#                 half-life 6.578813 d; mean lag 9 d;
#                 GAP POLICY: spec 07 rule 20 decided policy (b) gap-aware alpha, per r09 §4's own
#                 recommendation — one missed day gives TREND_AFTER_ONE_MISSED_DAY_KG 81.974133
#                 (alphaEff 0.19), and the skip-missing 82.037925 must FAIL. The earlier
#                 "5-day gap carried forward" expectation asserted the REJECTED policy.
#                 OUTLIER BOUNDARY, both sides: 3.5 kg off the trend -> excluded; exactly
#                 OUTLIER_ABS_KG (3.0) off -> kept, because the rule is `> 3`, not `>= 3`
#  tests/calc/tdee.test.ts   the 4-week worked example (r09 §5); 7700 kcal/kg; 28-day window;
#                 <14 intake days -> prior only; week-over-week delta clamped to 250 kcal/d
#  tests/calc/plates.test.ts bar 20 kg, minIncrement 1.0 kg (r09 §6): 100.0 EXACT [25,15];
#                 62.5 EXACT [20,1.25]; 101.9 -> greedy 101.0 (-0.9) vs nearest 102.0 (+0.1),
#                 default nearest; 15.0 -> {status:'BELOW_BAR', plates:[], achieved:20.0}
#  tests/calc/warmup.test.ts W1 100 -> 40.00/50.00/60.00 exact; W2 87.5 -> 35.00/43.50/52.50 (r09 §7)
#  tests/calc/volume.test.ts credits come from the `volume_weights` table, not a literal — specs/02
#                 seeds PRIMARY 1.0 / SECONDARY 0.5 and spec 07 rule 40 decided it, resolving r09
#                 §8's open 0.5-vs-1.0 question; COUNTED_SET_TYPES excludes warmup;
#                 hard set requires RIR<=4 AND, per spec 07 rule 39, a NULL rir on a counted set
#                 COUNTS as hard (r09 §8 flagged this as the silently-divergent case and
#                 recommended exactly this) — asserted explicitly, both rir:null and rir:4.5;
#                 rolling7dWindow across the Asia/Almaty 00:00-05:00 boundary (r09 §8)
npx vitest run --project=unit tests/calc

# 3. Harness self-tests FIRST — a shim bug must not surface as a repository-test mystery.
#    PASS = green, including "two same-named columns return two positional values".
npx vitest run --project=unit tests/harness

# 4. Data layer + route handlers + security. PASS = green with zero mocks of drizzle or Cloudflare.
npx vitest run --project=unit tests/data tests/routes tests/security

# 5. Schema drift + fixture drift + migration safety. PASS = all four exit 0.
npm run db:verify                          # "OK: drizzle/migrations/ replays exactly to src/db/schema.ts (N tables)."
npm run db:seed:check                      # "OK: tests/fixtures/seed.sql matches src/db/schema.ts."
node scripts/check-migration-safety.mjs    # "OK: <n> new migration(s), no table lost rows."
npx drizzle-kit check                      # "Everything's fine"

# 6. THE acceptance criterion. PASS = "1 passed", and in the trace: precache hit for /workout/new,
#    the /api/health?probe=<uuid> fetch REJECTED, outbox 1 -> 0 after goOnline, the workout on
#    /workouts?fresh=1 with the right set count and volume load.
npm run db:migrate:local && npm run db:seed:local
npm run typegen && npm run build && npx opennextjs-cloudflare build
npx playwright test -c playwright.config.ts tests/e2e/offline-workout.spec.ts

# 7. Accessibility, both locales. PASS = 0 violations AND 0 incomplete across all 14 routes and
#    their sheets (failure prints route, locale, ruleId, selector).
npx playwright test -c playwright.config.ts --project=a11y-ru --project=a11y-en

# 8. Per-route client JS. PASS = a shared-baseline line under 145 KB, then 14 rows, every "gated"
#    row under budget and every "measure" row merely printed:
#      shared baseline           127.1 KB / 145 KB  OK
#      /workout/[id]  GYM MODE    48.2 KB / 55 KB   OK    (gated)
#      /analytics     charts     138.7 KB /  —      MEASURE
npm run typegen && npm run build && npm run test:perf

# 9. LCP. PASS = "All assertions passed!" (failure: largest-contentful-paint expected <= 2500
#    found 3120). LHCI starts its own `next start` — nothing is listening after step 8.
npx lhci autorun --config=lighthouserc.cjs

# 10. Service worker facts (r05). PASS = every line exits 0; `set -e` makes the block fail fast.
#     `npm run build` already emits public/sw.js (`next build && serwist build serwist.config.mts`).
set -e
grep -q "google-fonts-webfonts" public/sw.js          # production-built SW (r05 gotcha 1)
! grep -q '"/_headers"' public/sw.js                  # globIgnores did not regress (r05 gotcha 2)
test -f .next/server/app/~offline.html                # offline fallback was prerendered
npx opennextjs-cloudflare preview --port "${E2E_PREVIEW_PORT:-8787}" &
PREVIEW_PID=$!
until curl -fs "http://127.0.0.1:${E2E_PREVIEW_PORT:-8787}/api/health" >/dev/null; do sleep 1; done
test "$(curl -fs -o /dev/null -w '%{http_code}' "http://127.0.0.1:${E2E_PREVIEW_PORT:-8787}/sw.js")" = 200
curl -fsI "http://127.0.0.1:${E2E_PREVIEW_PORT:-8787}/sw.js" | grep -qi 'content-type: *text/javascript'
kill $PREVIEW_PID
set +e

# 11. The whole gate, as CI runs it. PASS = exit 0 at every stage — the brief's
#     "acceptance checklist green" line. Both Playwright configs are named explicitly, because a
#     bare `playwright test` would pick one config and start the wrong server.
npm run typecheck && npm run lint && npm run format:check \
  && npm run test:coverage && npm run db:verify && npm run db:seed:check \
  && node scripts/check-migration-safety.mjs \
  && npm run build && node scripts/check-no-client-secrets.mjs .next/static \
  && npx opennextjs-cloudflare build \
  && npm run test:e2e && npm run test:perf \
  && npx lhci autorun --config=lighthouserc.cjs
```

## Open questions

1. **Does the `perf` job block a PR, or only `main`?** *Option A — blocking on PRs (recommended):* a budget that is advisory is a budget already blown by Phase 6, and the failure names the route and the delta so the fix stays local; costs ~4 min per PR. *Option B — advisory on PRs, blocking on `main`:* faster reviews, but a regression lands and then blocks every subsequent merge until someone bisects it. **Recommendation: A** — one PR per phase in a single-user repo, so four minutes is cheap insurance.
2. **Where does the nightly run point?** *Option A — a dedicated Workers preview deployment (recommended):* `nightly.yml` deploys `main` to a preview alias and runs `smoke` + `a11y` + LHCI against it via `E2E_BASE_URL` — real edge, real D1 and R2, and it never touches the user's data. *Option B — production itself:* no extra infrastructure, but nightly runs would write real workouts and real R2 photos into the single user's own history. **Recommendation: A**, with the preview bound to a separate `fitness-pwa-preview-db` D1 database — one free database and one secret-scoped workflow. (§42d already restricts the post-deploy check to read-only assertions so that it does not violate this answer whichever way it goes.)
3. **The brief's 200 KB per-route ceiling is arithmetically incompatible with the measured shared baseline — which gives?** This is a product decision and needs a written answer before `/` and `/analytics` can be gated. Measured facts: the App Router shared floor is **127.1 KB gzipped** today with no features shipped; `recharts@3.10.1` is roughly 100 KB gzipped on its own; `@visx/visx@4.0.0` is a second chart library on the same route. So the brief's ceiling is a ~70 KB per-route allowance and cannot hold both. *Option A — keep 200 KB as an absolute ceiling:* `/analytics` ships exactly one chart library, chosen in Phase 6, loaded through a dynamic import behind a skeleton, with the heatmaps as hand-written SVG and no charting dependency; the dashboard's two heatmaps stay dependency-free. *Option B — raise the ceiling to 300 KB for `/` and `/analytics` only,* keeping 200 KB everywhere else, and accept a slower first load on the two routes nobody opens mid-set. **Recommendation: A**, because the brief's own priority order puts GYM MODE and offline first and because two chart libraries on one route is a dependency decision, not a performance constraint. Until this is answered both routes stay `status: "measure"`; the answer goes in `DECISIONS.md` and flips them to `"gated"`.
4. **Does the `a11y-en` project gate, or only report?** English is the second locale, not the default, and `html-has-lang` / `valid-lang` are the only WCAG rules that can differ between them. *Option A — gate both (recommended):* the extra cost is one more pass over fourteen routes, roughly two minutes, and it catches a locale switch that forgets `lang` before a user does. *Option B — gate RU, report EN.* **Recommendation: A**, revisited only if the a11y job exceeds its 25-minute timeout.
