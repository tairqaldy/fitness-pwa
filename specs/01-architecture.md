# 01 — Architecture, Cloudflare bindings, deploy & runtime

## Purpose

Defines the skeleton every other spec builds on: folder layout, the complete Cloudflare binding set,
the four config files in full, the env-var contract, how server code reaches D1/R2/KV, the cron
entrypoint, rate limiting, error handling, local dev, deploy and rollback. Satisfies the brief's
"Tech stack" paragraph, the Phase 0 DoD ("deploys, migration runs, page live"), the Security NFR
"no secrets in the client bundle", and the Cron Triggers half of Phase 8. Every constraint here is a
hard rule: violating one usually fails *silently* in production.

**This spec lands in two phases and its Verification is split to match.** Phase 0 ships the config,
the bindings, the error/log/rate-limit modules and the deploy path with `main` still pointing at
OpenNext's generated entry and no `triggers.crons`. Phase 8 flips `main` to `worker.ts` and adds the
five schedules. Every table below carries a **Phase** column; the Verification section has a
**Phase 0 gate** and a **Phase 8 gate**, and nothing in the Phase 8 gate is expected to pass before
Phase 8. This is deliberate: the committed `wrangler.jsonc` defers `triggers.crons` and `worker.ts`
"to the phase that ships scheduled jobs", and the brief puts crons in Phase 8.

## Scope

Folder layout and module boundaries (`src/app`, `src/components`, `src/db`, `src/server`,
`src/jobs`, `src/lib`, `tests`); every binding name incl. the four hardcoded OpenNext ones; the
one-off resource **provisioning** runbook; `wrangler.jsonc` / `open-next.config.ts` /
`next.config.ts` / `worker.ts` verbatim; the var-vs-secret contract and the `NEXT_PUBLIC_*` ban;
request lifecycle and the single Drizzle factory; the `scheduled` entrypoint + `cron_runs`
bookkeeping; Route Handler vs Server Action policy; the API error envelope, its retry
classification and structured logging; the `ratelimits` binding; one-command local dev; deploy,
rollback, `wrangler tail`; runtime limits as enforceable rules.

### Out of scope

| Excluded | Owner |
|---|---|
| Tables, columns, indexes, drizzle schema, migration files, seeding, `drizzle.config.ts` | `specs/02-data-model.md` |
| Design tokens, fonts, Tailwind/shadcn setup, i18n request config + locale cookie + `src/i18n/config.ts` | `specs/03-design-system.md` |
| Session cookie, `proxy.ts` body, `requireSession()`, login routes, `constantTimeEqualUtf8` | `specs/04-auth.md` |
| Serwist config, `public/_headers`, `sw.ts`, manifest, Dexie/IndexedDB, sync queue | `specs/05-pwa-offline-sync.md` |
| R2 upload/serve handlers, image variants, `photos` table | `specs/10-body-photos.md` |
| AI provider abstraction, model ids, `ai_prompt_logs`, AI spend budget | `specs/11-nutrition-ai.md` |
| Cron **step bodies** (rollup, XP, messages, push, Telegram) and `src/jobs/nightly-rollup.ts` | `specs/13-gamification.md`, `specs/14-ai-coach-and-notifications.md` |
| Backup payload format, manifest and gzip framing | `specs/15-data-portability.md` |
| `ci.yml`'s `verify` job, vitest/playwright harness, coverage gates | `specs/16-testing-ci-quality.md` |
| **npm scripts** — incl. `cf-typegen:check`, `db:verify`, `db:seed:local` and `db:reset` (this spec's Risks row depends on the last one; spec 16 §128 already owns the first three and must add `db:reset`) | `specs/16-testing-ci-quality.md` |

## Files to create

Phase **P0** = the Phase 0 gate; **P8** = the Phase 8 gate.

| Path | Phase | Responsibility |
|---|---|---|
| `src/server/cf.ts` | P0 | One of **two** modules allowed to import `@opennextjs/cloudflare`. `getEnv()`, `getCtx()`, `getEnvAsync()`, `WorkerEnv`. |
| `src/server/http.ts` | P0 | `jsonOk()`, `jsonError()`, `requestId()`, `route()`, `ApiErrorBody`. |
| `src/server/errors.ts` | P0 | `AppError`, `ApiErrorCode`, `httpStatusFor()`, `RETRYABLE`, `PARKS_QUEUE`. |
| `src/server/log.ts` | P0 | `makeLogger()`/`loggerFromEnv()` — one JSON line per event, redaction list, `withTiming()`. |
| `src/server/rate-limit.ts` | P0 | `checkRateLimit()` over the `ratelimits` binding + the 429 body. |
| `scripts/check-runtime-rules.mjs` | P0 | Offline guard for the eight static rules in Behaviour §31. |
| `tests/unit/{time,http-envelope}.test.ts` | P0 | The cases named in the Phase 0 gate. |
| `worker.ts` | P8 | Custom entry: delegates `fetch` to OpenNext, adds `scheduled`, re-exports the three OpenNext Durable Objects. |
| `src/jobs/types.ts`, `src/jobs/registry.ts` | P8 | `CronJobContext`/`CronJobResult`/`STUCK_AFTER_MS`; `CRON_SCHEDULE`, the `JOBS` dispatch table + `runCronJob()`. |
| `src/jobs/{daily-reminder,streak-at-risk,weekly-review,backup-to-r2}.ts` | P8 | One module per cron: framework-free, takes `env`, returns `CronJobResult`. **The job always runs; each step carries its own gate** (§21). Step bodies owned by specs 13/14/15. |
| `src/app/api/cron/[job]/route.ts` | P8 | Manual trigger guarded by `CRON_SECRET`; 404 on any mismatch. |
| `src/app/api/system/diagnostics/route.ts` | P8 | Session-gated: last run per cron job + the app-zone clock. **No binding probes** — those stay in `/api/health`. |
| `tests/unit/{cron-routes,jobs-gate}.test.ts` | P8 | The cases named in the Phase 8 gate. |

`src/jobs/nightly-rollup.ts` is created by `specs/13-gamification.md` (Phase 7, i.e. **before**
Phase 8); this spec only routes it. If Phase 8 is ever attempted first, create it as a three-line
stub returning `{ ran: false, skippedReason: "not-implemented" }` and let spec 13 replace the body —
`src/jobs/registry.ts` imports it statically, so without the file nothing in the Phase 8 gate
compiles.

### Files to modify (already committed by Phase 0 scaffolding)

| Path | Phase | Exact change |
|---|---|---|
| `wrangler.jsonc` | P0 | Adopt the block below: adds `PHOTOS`/`EXERCISE_MEDIA`/`BACKUPS`, `NUTRITION_CACHE`, `ratelimits`, `secrets.required`, `dev.port`, `APP_ORIGIN`/`LOG_LEVEL`/`VAPID_PUBLIC_KEY`; renames `MEDIA` → `PHOTOS`; removes `DEFAULT_LOCALE`. See the ADDED/REMOVED note. |
| `wrangler.jsonc` | P8 | `main` → `"worker.ts"`; add `triggers.crons`. Nothing else changes. |
| `src/app/api/health/route.ts` | P0 | `getCloudflareContext()` → `getEnv()` from `@/server/cf` (guard (b)); `env.MEDIA` → `env.PHOTOS` (3 call sites); extend the probe set to all six storage bindings (§38); wrap in `checkRateLimit(AUTH_LIMITER, "health")`. The **probing** body and the 503-on-failure behaviour are deliberately kept — see §38. |
| `.dev.vars.example` | P0 | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` → drop it (that name is banned and would inline `undefined`; the public key is a `var`, not a secret). Add `VAPID_SUBJECT`. Keep `USDA_FDC_KEY`. |
| `.github/workflows/ci.yml` | P0 | The existing `deploy` job only (spec 16 owns `verify`): insert `npx wrangler d1 migrations apply DB --remote` **before** `npm run deploy` (§34). A second `deploy.yml` is deliberately **not** created — two deploy paths is a drift hazard. |
| `cloudflare-env.d.ts` | P0, P8 | Regenerated by `npm run cf-typegen` after every `wrangler.jsonc` edit; **committed** (§33). |

### Files reused as-is

`src/lib/time.ts` (`APP_TIME_ZONE`, `dayKeyOf`, `todayInAppZone`, `addDays`, `daysBetween`,
`isDayKey` — already committed, framework-free, takes `nowMs: number`), `src/lib/ids.ts`
(`ulid(now, randomBytes?)`, 26-char Crockford — specs/02 §53), `src/server/db/index.ts`,
`src/lib/env.ts` (secrets on the **Next** side only — see the env-var contract),
`open-next.config.ts` and `next.config.ts` (both already match this spec).

## Interfaces

### Provision (one-off, before the first deploy)

Nothing below is a placeholder: each command prints the literal that goes into `wrangler.jsonc`.
Run them once per account, in this order. Two D1 databases and two R2 buckets already exist (their
ids are pasted in the config); the three `create` lines are the resources Phase 0 has not made yet.

```bash
# Already provisioned by Phase 0 — listed so a fresh account can reproduce them:
#   npx wrangler d1 create fitness-pwa-db         -> database_id 015af493-640c-448e-b8a6-3223321d4fe6
#   npx wrangler d1 create fitness-pwa-cache-db   -> database_id 57c19114-c433-4697-b43c-e40d6c054f59
#   npx wrangler r2 bucket create fitness-pwa-media   # binding PHOTOS (see the naming note)
#   npx wrangler r2 bucket create fitness-pwa-cache   # binding NEXT_INC_CACHE_R2_BUCKET
#   npx wrangler kv namespace create CACHE_KV     -> id 9b0bf0d15d694b1c9efa0b6a643f07cc

npx wrangler r2 bucket create fitness-pwa-exercise-media   # -> binding EXERCISE_MEDIA (no id needed)
npx wrangler r2 bucket create fitness-pwa-backups          # -> binding BACKUPS       (no id needed)
npx wrangler kv namespace create NUTRITION_CACHE           # prints `id` -> paste into kv_namespaces

npx web-push generate-vapid-keys          # public key -> vars.VAPID_PUBLIC_KEY; private -> secret
npx wrangler secret put SESSION_SECRET    # >= 32 bytes
npx wrangler secret put CRON_SECRET       # Phase 8
npx wrangler secret put VAPID_PRIVATE_KEY # + VAPID_SUBJECT, and the optional keys as features land
npm run cf-typegen                        # regenerate + commit cloudflare-env.d.ts
```

**`APP_ORIGIN` bootstrap.** The first deploy prints the real `*.workers.dev` origin. Paste it into
`vars.APP_ORIGIN`, re-run `cf-typegen`, and deploy again. Guard (c) (§31) **fails while the value
still contains `<`, `REPLACE_ME`, `localhost` or `example.com`**, so a forgotten paste is a red
build, not a poisoned isolate (r01 §4.3). Until the paste, only the first hello-world deploy is
possible — which is exactly the Phase 0 order.

**Bucket naming.** `PHOTOS` is bound to the already-created `fitness-pwa-media`. R2 bucket names are
immutable, so "renaming" it means create + copy + delete for zero functional gain; the binding name
is what every spec references (`specs/10` §453, `specs/11` §324, `specs/15` §117), and the binding
name is `PHOTOS`. The mismatch is deliberate and recorded here so nobody "fixes" it.

### `wrangler.jsonc` (full)

From [r12 §H](../docs/research/r12-scaffold-tailwind4-shadcn.md) + [r01 §3.2](../docs/research/r01-cron-triggers-on-opennext.md),
reconciled against the committed file. `ratelimits[].simple.period` accepts **only** `10` or `60`
(verified in `node_modules/wrangler/config-schema.json`). `secrets.required` makes `wrangler types`
emit those names on `CloudflareEnv` *and* `NodeJS.ProcessEnv` (verified by running
`wrangler types` here, wrangler 4.131.1) — that is what types `env.CRON_SECRET` inside `scheduled`,
where `process.env` is not reliable (§9a).

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fitness-pwa", // MUST equal package.json "name" and services[].service below
  // PHASE 0: ".open-next/worker.js". PHASE 8: "worker.ts" — r01 §2.1 verified that a custom entry
  // is the only way to get a `scheduled` handler, and it is pointless before crons exist.
  "main": "worker.ts",
  "compatibility_date": "2026-09-01", // >= 2024-12-30 required by OpenNext
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "observability": { "enabled": true }, // without this a failed cron leaves no trace at all
  "dev": { "port": 8787 }, // pinned: every local URL in this repo says 8787 (specs/16 §9)
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "fitness-pwa-db",
      "database_id": "015af493-640c-448e-b8a6-3223321d4fe6",
      // MUST equal drizzle.config.ts `out`, which specs/02 §53 pins to "./drizzle/migrations".
      "migrations_dir": "drizzle/migrations"
    },
    // Separate database on purpose: OpenNext creates its own `revalidations` table, which would
    // pollute the app schema and every drift check (r02 §4.11). specs/02 §452: never repoint this
    // binding at fitness-pwa-db.
    {
      "binding": "NEXT_TAG_CACHE_D1",
      "database_name": "fitness-pwa-cache-db",
      "database_id": "57c19114-c433-4697-b43c-e40d6c054f59"
    }
  ],
  // Four buckets, so retention and blast radius stay separate concerns. THIS FILE is the single
  // source of truth for bucket and binding names (it supersedes specs/08 §36's tentative name and
  // specs/15 §638's "one content bucket" reading).
  "r2_buckets": [
    { "binding": "PHOTOS", "bucket_name": "fitness-pwa-media" }, // user photos (specs/10, /11)
    { "binding": "EXERCISE_MEDIA", "bucket_name": "fitness-pwa-exercise-media" }, // seeded library (specs/08)
    { "binding": "BACKUPS", "bucket_name": "fitness-pwa-backups" }, // exports + archives (specs/15)
    { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "fitness-pwa-cache" }
  ],
  "kv_namespaces": [
    { "binding": "CACHE_KV", "id": "9b0bf0d15d694b1c9efa0b6a643f07cc" }, // app caches, `sys:*`
    { "binding": "NUTRITION_CACHE", "id": "<id printed by `kv namespace create`>" } // OFF/FDC (specs/11)
  ],
  "services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "fitness-pwa" }],
  // NO `durable_objects` and NO `migrations` block: `open-next.config.ts` omits the `queue`
  // override to match. Declaring one without the other is a documented silent failure (r12 §G11).
  // Decision record: Open questions 2.
  "ratelimits": [
    { "name": "AUTH_LIMITER", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
    { "name": "AI_LIMITER", "namespace_id": "1002", "simple": { "limit": 12, "period": 60 } }
  ],
  // Declares the secrets the Worker cannot run without. Effect (verified): `wrangler types` emits
  // them as `string` on CloudflareEnv, and local dev warns when one is missing. PHASE 0 lists only
  // SESSION_SECRET; "CRON_SECRET" is added in PHASE 8, when the cron route that needs it exists
  // (Open questions 3: whether an unset required secret also blocks a deploy is UNVERIFIED).
  "secrets": { "required": ["SESSION_SECRET", "CRON_SECRET"] },
  "vars": {
    "APP_TZ": "Asia/Almaty",
    "APP_ORIGIN": "https://fitness-pwa.<subdomain>.workers.dev", // fill from the first deploy; guard (c)
    "AI_PROVIDER": "google",
    "LOG_LEVEL": "info",
    "VAPID_PUBLIC_KEY": "<public key from `web-push generate-vapid-keys`>" // public by design (r06 §4.3)
  },
  // PHASE 8. ALL UTC. Asia/Almaty is UTC+5 year-round, no DST (r01 §4.6). No expression uses the
  // weekday field (§21). Every entry needs a byte-identical CRON_SCHEDULE row. All are daily
  // => >= 1 h interval => the 15-min CPU bucket (§4).
  "triggers": {
    "crons": [
      "20 19 * * *", // 00:20 Almaty — nightly rollup: day close, XP, achievement sweep (specs/13 §20)
      "30 15 * * *", // 20:30 Almaty — streak-at-risk nudge
      "0 16 * * *", // 21:00 Almaty — daily "log your day" reminder
      "5 3 * * *", // 08:05 Almaty — daily announce + monthly-report (day 1) + Monday weekly review
      "0 18 * * *" // 23:00 Almaty — daily sweep + watchdog + Sunday backup to R2
    ]
  }
}
```

**ADDED / REMOVED vs the committed `wrangler.jsonc`** (so the diff is intentional, not accidental):

- ADDED: `dev.port`, `secrets.required`, `ratelimits`, `EXERCISE_MEDIA`, `BACKUPS`,
  `NUTRITION_CACHE`, `vars.APP_ORIGIN`, `vars.LOG_LEVEL`, `vars.VAPID_PUBLIC_KEY`, and at Phase 8
  `triggers.crons` + the `main` flip.
- RENAMED: `MEDIA` → `PHOTOS` (same bucket). Forces the `src/app/api/health/route.ts` edit above —
  without it `cf-typegen` removes the property and `npm run typecheck` fails.
- REMOVED: `vars.DEFAULT_LOCALE`. The committed `src/i18n/config.ts` already exports
  `DEFAULT_LOCALE = "ru"` as a code constant (r11 §811's shape), so the var is a second source of
  truth for a value that is never read from `env`. `src/i18n/config.ts` is the source of truth;
  specs/03 owns it.
- UNCHANGED: `name`, `compatibility_date`, `compatibility_flags`, `assets`, `observability`,
  `DB`/`NEXT_TAG_CACHE_D1` ids and names, `migrations_dir`, `NEXT_INC_CACHE_R2_BUCKET`, `CACHE_KV`
  id, `WORKER_SELF_REFERENCE`, `vars.APP_TZ`, `vars.AI_PROVIDER`.

### `open-next.config.ts` and `next.config.ts` (full)

Both already match the committed files; reproduced so the binding/override pairing is auditable in
one place. r12 §H ships `queue: doQueue`, and r12 §G11 says verbatim to "either add it or delete the
`queue:` line" — Phase 0 deleted it, and Open questions 2 ratifies that. `initOpenNextCloudflareForDev()`
after the default export is what gives `next dev` real bindings.

```ts
// open-next.config.ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

// NO `queue` override: the do-queue override needs a NEXT_CACHE_DO_QUEUE Durable Object binding,
// and configuring one without the other fails silently (r12 §G11). Add both together in the phase
// that first calls revalidatePath()/revalidateTag().
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  tagCache: d1NextTagCache,
});
```

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = { typescript: { ignoreBuildErrors: false } };

export default nextConfig;

// Gives `next dev` the real D1/R2/KV bindings. Must come after the default export.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
```

### `worker.ts` (full) — Phase 8

From [r01 §3.1](../docs/research/r01-cron-triggers-on-opennext.md), verified end to end including
the deploy hard-failure when the DO re-export is missing.

```ts
// worker.ts — custom Worker entry. wrangler `main` points HERE from Phase 8 on.
// HARD RULES:
//  (1) never call getCloudflareContext() in this file or anything it imports — it THROWS outside a
//      fetch request (r01 §2.4); use the `env` parameter.
//  (2) never read process.env here or anywhere under src/jobs/**. OpenNext populates it from
//      init(request, env) on the FETCH path only, so in `scheduled` it is empty on a cold isolate
//      and populated on a warm one (r01 §4.3) — intermittent by construction. Secrets come off
//      `env`, which is why they are declared in wrangler.jsonc `secrets.required`.
//  (3) never delete the DO re-export at the bottom.
//  (4) everything imported here is bundled by wrangler's esbuild, not Next: no `next/*`, no
//      "server-only", no "use client", no "@opennextjs/cloudflare" (r01 §4.11). The `@/*` tsconfig
//      alias DOES resolve in that bundle — verified here: `wrangler deploy --dry-run` (4.131.1)
//      inlined an `@/lib/*` import — but this file uses relative paths so the entry never relies on it.
// @ts-ignore generated at build time
import { default as openNextHandler } from "./.open-next/worker.js";
import {
  CRON_SCHEDULE, runCronJob, type CronJobResult, type CronName, type WorkerEnv,
} from "./src/jobs/registry"; // WorkerEnv is declared in src/jobs/types.ts, NOT in cf.ts, so that
                             // nothing reachable from here can pull in @opennextjs/cloudflare.
import { ulid } from "./src/lib/ids"; // 26-char Crockford ULID, already vendored (specs/02 §53)
import { loggerFromEnv, type Logger } from "./src/server/log";

/** wrangler.jsonc `triggers.crons` -> job, derived from ONE table so the two cannot drift (§36). */
const CRON_ROUTES: Record<string, CronName> = Object.fromEntries(
  CRON_SCHEDULE.map((row) => [row.cron, row.job]),
);

export default {
  // A method, not `fetch: openNextHandler.fetch`, so a future upstream `this` cannot break us.
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    return openNextHandler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    const log = loggerFromEnv(env); // LOG_LEVEL is a var, so it IS on `env` here (§29)
    const job = CRON_ROUTES[controller.cron];
    if (!job) {
      log("error", { msg: "cron.unrouted", cron: controller.cron });
      controller.noRetry(); // misconfiguration, not transient
      return;
    }
    const scheduledAt = controller.scheduledTime; // epoch ms, the schedule's own slot
    const startedAt = Date.now();
    // Start row first: finished_at IS NULL and older than STUCK_AFTER_MS is how we detect a
    // 15-min kill. Upsert on the UNIQUE (job, scheduled_at) index because a retry reuses the slot
    // — and it MUST clear the previous attempt's outcome columns, or a retried run inherits the
    // old finished_at/error and reads as finished (§25).
    await safe(log, job, () =>
      env.DB.prepare(
        "insert into cron_runs (id, job, cron, scheduled_at, started_at, ok) values (?, ?, ?, ?, ?, 0)" +
          " on conflict (job, scheduled_at) do update set started_at = excluded.started_at," +
          " finished_at = null, ok = 0, error = null, detail = null",
      )
        .bind(ulid(startedAt), job, controller.cron, scheduledAt, startedAt)
        .run(),
    );
    try {
      // `await`, not ctx.waitUntil: failures must surface in the invocation outcome.
      const result = await runCronJob(job, {
        env, ctx, scheduledTime: new Date(scheduledAt), cron: controller.cron,
      });
      await finish(log, env, job, scheduledAt, startedAt, true, null, result);
    } catch (error) {
      await finish(log, env, job, scheduledAt, startedAt, false, String(error), null);
      throw error; // marks the invocation "error" in Workers Logs / wrangler tail
    }
  },
} satisfies ExportedHandler<WorkerEnv>;

async function finish(
  log: Logger, env: WorkerEnv, job: CronName, scheduledAt: number, startedAt: number,
  ok: boolean, error: string | null, result: CronJobResult | null,
): Promise<void> {
  const durMs = Date.now() - startedAt;
  // `ran` is persisted SEPARATELY from `ok`, in the `detail` column specs/02 already declares. A
  // fully skipped run is a successful invocation that produced nothing, and the System card must
  // never render it as "the weekly review went out" (§25, UX notes).
  const ran = result?.ran ?? false;
  const skippedReason = result?.skippedReason ?? null;
  log(ok ? "info" : "error", { msg: "cron.finished", job, ok, ran, skippedReason, error, durMs });
  await safe(log, job, () =>
    env.DB.prepare(
      "update cron_runs set finished_at = ?, ok = ?, error = ?, detail = ?" +
        " where job = ? and scheduled_at = ?",
    )
      .bind(Date.now(), ok ? 1 : 0, error, JSON.stringify({ ran, skippedReason }), job, scheduledAt)
      .run(),
  );
}

/** Bookkeeping must never mask the job's own error. */
async function safe(log: Logger, job: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    log("error", { msg: "cron.bookkeeping_failed", job, error: String(e) });
  }
}

// Durable Objects generated by @opennextjs/cloudflare 1.20.6 — these three names are exactly what
// `dist/cli/templates/worker.d.ts` exports (verified in node_modules). `wrangler deploy` fails with
// "…Durable Objects, which are not exported in your entrypoint file" if a BOUND class is missing;
// re-exporting an unbound one is harmless (verified: a dry-run with no durable_objects block and
// the class exported succeeds). NEVER prune this line (r01 §2.3, §4.5).
// @ts-ignore generated at build time
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
```

### Binding registry

| Binding | Type | Used by |
|---|---|---|
| `DB` | D1 | all app data; `src/server/db`, `src/jobs/**` |
| `NEXT_TAG_CACHE_D1` | D1 (own database) | **OpenNext only** — tag cache. App code never touches it. |
| `PHOTOS` | R2 (`fitness-pwa-media`) | progress + food photos only (specs/10, /11) |
| `EXERCISE_MEDIA` | R2 | seeded exercise-library media — private, never `r2.dev` (specs/08) |
| `BACKUPS` | R2 | weekly/monthly/manual exports, quarterly photo archives (specs/15) |
| `NEXT_INC_CACHE_R2_BUCKET` | R2 | **OpenNext only** — incremental cache |
| `CACHE_KV` | KV | app caches, `sys:*` (see Data). **`APP_CACHE` in specs/02 §509 and specs/12 §440 is this same namespace; the binding name is `CACHE_KV`.** |
| `NUTRITION_CACHE` | KV | Open Food Facts / FDC lookups (specs/11) |
| `WORKER_SELF_REFERENCE` | Service (self) | OpenNext revalidation; cron escape hatch (§20) |
| `ASSETS` | Fetcher | **OpenNext only** — static assets |
| `AUTH_LIMITER` / `AI_LIMITER` | Rate limiter | login + health (specs/04) / AI routes (specs/11) |

Twelve bindings. `NEXT_CACHE_DO_QUEUE` is deliberately **absent** (Open questions 2); the other
three hardcoded OpenNext names are `NEXT_INC_CACHE_R2_BUCKET`, `NEXT_TAG_CACHE_D1` and
`WORKER_SELF_REFERENCE`, and a typo in any of them is a silent cache failure (`stack-facts.md`).
**No Cloudflare Images binding.** The brief's "responsive AVIF images" NFR is superseded by
[r03 §G11 / §843](../docs/research/r03-r2-uploads-and-image-delivery.md): there is no canvas AVIF
encoder on iOS or Firefox, and AVIF *input* to Cloudflare Images is Enterprise-only, so AVIF is a
dead end on both ends. Responsive delivery is client-side `createImageBitmap` → WebP/JPEG variants
(specs/10 §35, which states "AVIF is never requested") served through the Worker with the Cache API;
no zone and no `/cdn-cgi/image` transform is needed, which is why Open questions 1 costs nothing here.

### Env-var contract

Two mechanisms, and the difference is load-bearing:

- **`vars`** are on `env` everywhere, are typed by `wrangler types`, and are additionally mirrored
  onto `process.env` **inside the fetch path** (the generated `cloudflare-env.d.ts` declares
  `NodeJS.ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, …>>` for exactly the declared
  vars). They are visible in the dashboard and in source: never a secret.
- **Secrets** come from `wrangler secret put` / `.dev.vars`. On the **Next** side (route handlers,
  Server Actions, dynamic components) read them through the committed `src/lib/env.ts`, which reads
  `process.env` and throws `MissingSecretError` rather than returning a default — that works because
  OpenNext's `.open-next/cloudflare/init.js` calls `populateProcessEnv(url, env)` on the first
  request (r01 §4.3, quoted from source). In `worker.ts` and `src/jobs/**` that init has not
  necessarily run, so **secrets are read off `env`** (`env.CRON_SECRET`) and `src/lib/env.ts` may
  not be imported there — guard (h). Declaring a secret in `wrangler.jsonc` `secrets.required` is
  what makes `env.CRON_SECRET` typed.

| Name | Kind | Notes |
|---|---|---|
| `APP_TZ` | var | Always `Asia/Almaty`. Read by `/api/health` and `/api/system/diagnostics` as a regression canary; the value **code** uses is `APP_TIME_ZONE` in `src/lib/time.ts`, and §37 asserts the two agree. |
| `APP_ORIGIN` | var | The real public origin; typed `{ APP_ORIGIN: string }` by specs/04 §82. Never a placeholder host (§20, §31 guard (c), Risks). |
| `AI_PROVIDER` | var | `google` \| `anthropic` \| `openai`; read only by specs/11. |
| `LOG_LEVEL` | var | `debug` \| `info` \| `warn` \| `error`. Enforced by `loggerFromEnv(env)`; nothing calls a level-less `log()`. |
| `AI_MODEL_VISION`, `AI_MODEL_TEXT`, `AI_PRICE_IN_PER_MTOK`, `AI_PRICE_OUT_PER_MTOK` | var, optional | Required only when `AI_PROVIDER` is not `google`; specs/11 throws at boot if one is missing. Pinned ids only, never a `-latest` alias (`stack-facts.md`). |
| `VAPID_PUBLIC_KEY` | var | Public by design (r06 §4.3); reaches the client via a server render or route handler — **never** as `NEXT_PUBLIC_*`. |
| `NEXTJS_ENV` | var, local only | `development`, in `.dev.vars`. |
| `SESSION_SECRET` | **secret**, `required` | >= 32 bytes (r04 §3). |
| `CRON_SECRET` | **secret**, `required` from P8 | Guards `POST /api/cron/[job]`; read as `env.CRON_SECRET` in `scheduled` (§20, §26). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | **secret** | r06. The chat id identifies the owner and `vars` are source-visible, so it is a secret too. specs/14 adds them to `secrets.required` when its cron steps land (they run in `scheduled`). |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | **secret** | `VAPID_SUBJECT` is a `mailto:`/`https:` URI (r06 §4.3). |
| `GOOGLE_GENERATIVE_AI_API_KEY` | **secret** | Exact name required by `@ai-sdk/google` (`stack-facts.md`). |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | **secret**, optional | Only when `AI_PROVIDER` is switched. |
| `USDA_FDC_KEY` | **secret**, optional | Sent as USDA's `api_key` query param, server-side only (r08 §5.1). **This name supersedes `FDC_API_KEY` in specs/11 §383** — it is what the committed `src/lib/env.ts` and `.dev.vars.example` already use, and an unset key degrades silently. |
| `NUTRITIONIX_*` | **secret**, optional | Exact names owned by specs/11, which adds them to `WorkerEnv`. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | CI secret | GitHub Environment `production` only; never reaches the Worker. Scopes, from the committed `ci.yml`: Workers Scripts:Edit, D1:Edit, Workers KV Storage:Edit, Workers R2 Storage:Edit, Account Settings:Read (r12 §O). |

**`NEXT_PUBLIC_*` is banned outright.** Verified mechanism: `getNextPublicEnvironmentVariables()` in
`node_modules/next/dist/lib/static-env.js` walks `process.env` at **build** time and feeds the
literals to DefinePlugin. Our build runs in CI, where no Cloudflare var or secret exists, so such a
read inlines `undefined`; anything that did inline would be permanently baked into the client bundle.
Public runtime values reach the browser as a Server Component prop or a route-handler response.
Guard (g) greps `src/**`, `worker.ts` and `.dev.vars.example` for the prefix — the committed
`.dev.vars.example` currently violates this with `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and is on the
files-to-modify list.

### TypeScript surface

`src/server/db/index.ts`, `src/lib/ids.ts` and `src/lib/time.ts` are **already committed**; their
real signatures are restated here because rules §7-§14 constrain how they may be called. Copied
from the files, not from memory.

```ts
// src/jobs/types.ts — framework-free, so worker.ts and src/jobs/** can import it.
/** Every declared secret plus the optional ones wrangler does not type. Jobs take this, not
 *  CloudflareEnv. Declared HERE and re-exported by cf.ts, so importing the type never drags
 *  @opennextjs/cloudflare into the wrangler bundle (guard (f)). specs/11 adds NUTRITIONIX_*. */
export type WorkerEnv = CloudflareEnv & {
  GOOGLE_GENERATIVE_AI_API_KEY?: string; ANTHROPIC_API_KEY?: string; OPENAI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; TELEGRAM_WEBHOOK_SECRET?: string;
  VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; USDA_FDC_KEY?: string;
};

// src/server/cf.ts — one of two modules that import @opennextjs/cloudflare.
export type { WorkerEnv } from "@/jobs/types";
export function getEnv(): WorkerEnv;                    // throws outside a fetch request
export function getCtx(): ExecutionContext;
export function getEnvAsync(): Promise<WorkerEnv>;      // top-level/prerender escape hatch only

// src/server/db/index.ts — COMMITTED, verbatim signatures.
export type Db = DrizzleD1Database<typeof schema>;
export function dbFromEnv(env: Pick<CloudflareEnv, "DB">): Db; // the ONLY form valid in `scheduled`/`src/jobs/**`
export function getDb(): Db;                            // request-scoped; dynamic routes only
export function getDbAsync(): Promise<Db>;              // reads LOCAL bindings during `next build`
export { schema };
// There is no `DB` type alias, no `$client` and no `getEnvAsync` here. Rules below use these names.

// src/jobs/types.ts (continued) + registry.ts, which re-exports every name below.
export type CronJobContext = {
  env: WorkerEnv; ctx: ExecutionContext;
  scheduledTime: Date; // from controller.scheduledTime (epoch ms) — NEVER new Date()
  cron: string;
};
export type CronJobResult = { ran: boolean; skippedReason?: string };
export type CronName =
  | "nightly-rollup" | "daily-reminder" | "streak-at-risk" | "weekly-review" | "backup-to-r2";
export const CRON_NAMES: readonly CronName[];
/** The ONE table `worker.ts` and `wrangler.jsonc` both mirror (§36). */
export const CRON_SCHEDULE: ReadonlyArray<{ cron: string; job: CronName; almaty: string }>;
/** 15-min Duration cap + 1 min slack: below this a NULL finished_at means "still running". */
export const STUCK_AFTER_MS = 16 * 60_000;
export function runCronJob(name: CronName, c: CronJobContext): Promise<CronJobResult>;

// src/lib/time.ts — COMMITTED, framework-free; importable from worker.ts, jobs, server and client.
export const APP_TIME_ZONE = "Asia/Almaty";
export type DayKey = string;                            // 'YYYY-MM-DD' in APP_TIME_ZONE
export function dayKeyOf(instantMs: number): DayKey;
export function todayInAppZone(nowMs: number): DayKey;  // note: epoch ms, not a Date
export function addDays(day: DayKey, delta: number): DayKey;
export function daysBetween(from: DayKey, to: DayKey): number;
export function isDayKey(value: string): boolean;
// No weekday helper exists yet. The weekday gate uses the one-liner in §21 over `dayKeyOf`, so no
// second timezone implementation appears; `src/lib/calc/time.ts` (specs/07) owns the richer set.

// src/server/errors.ts + http.ts
export type ApiErrorCode = "unauthenticated" | "forbidden" | "not_found" | "validation_failed"
  | "payload_too_large" | "rate_limited" | "conflict" | "upstream_failed" | "internal";
export class AppError extends Error {
  constructor(code: ApiErrorCode, message: string, options?: { cause?: unknown; details?: unknown });
  readonly code: ApiErrorCode; readonly details?: unknown;
}
export function httpStatusFor(code: ApiErrorCode): 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502;
/** Safe to replay (specs/05 §24's `transient`): 429, 502, 500. */
export const RETRYABLE: ReadonlySet<ApiErrorCode>;      // rate_limited, upstream_failed, internal
/** Not retryable and not discardable: park the queue until re-auth (specs/05's `auth` reason). */
export const PARKS_QUEUE: ReadonlySet<ApiErrorCode>;    // unauthenticated
// Everything else (forbidden, not_found, validation_failed, payload_too_large, conflict) is
// TERMINAL: the replay queue must not re-enqueue it. A transport failure is NOT an ApiErrorBody —
// `fetch` throws a TypeError with no JSON at all, which specs/05 classifies as `offline` and which
// must not increment `attempts` (specs/05 §24).
export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; requestId: string; details?: unknown } };
export function requestId(request: Request): string;    // cf-ray header ?? crypto.randomUUID()
export function jsonOk<T>(data: T, init?: ResponseInit): Response;
export function jsonError(request: Request, error: unknown): Response; // never leaks a stack
/** THE wrapper every route handler uses (§19). Catches AppError and unknown throws alike. */
export function route<C>(
  handler: (request: Request, context: C) => Promise<Response>,
): (request: Request, context: C) => Promise<Response>;

// src/server/rate-limit.ts — per-colo, not global (r04 §4.15). null = allowed.
export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
export function checkRateLimit(l: RateLimiter, key: string, request: Request): Promise<Response | null>;

// src/server/log.ts — one JSON object per line; visible in `wrangler tail`. Framework-free, so
// worker.ts and src/jobs/** may import it.
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = { msg: string; requestId?: string; route?: string; job?: string;
  durMs?: number; code?: ApiErrorCode; status?: number; [k: string]: unknown };
export type Logger = (level: LogLevel, fields: LogFields) => void;
export function makeLogger(minLevel: LogLevel): Logger;
/** The only way LOG_LEVEL can be honoured where getEnv() throws: the caller passes `env`. */
export function loggerFromEnv(env: { LOG_LEVEL?: string }): Logger; // unknown value => "info"
export function withTiming<T>(log: Logger, fields: LogFields, fn: () => Promise<T>): Promise<T>;

// route bodies
type HealthCheck = { ok: true; detail?: string } | { ok: false; error: string };
type HealthBody = {                        // HTTP 200 when ok, 503 when any probe failed (§38)
  ok: boolean;
  checks: { d1: HealthCheck; migrations: HealthCheck; photos: HealthCheck;
            exerciseMedia: HealthCheck; backups: HealthCheck; kv: HealthCheck;
            nutritionCache: HealthCheck };
  runtime: { tz: string; localeSample: string };        // tz === APP_TIME_ZONE or §37 fails
};
type DiagnosticsBody = {                   // session-gated; no binding I/O (§38)
  crons: Array<{ job: CronName; cron: string;
                 lastOkAt: number | null;          // newest ok=1 finished_at, ran or skipped
                 lastRanAt: number | null;         // newest ok=1 finished_at with detail.ran === true
                 lastSkippedReason: string | null; // from the newest ok=1 run with detail.ran === false
                 lastErrorAt: number | null; lastError: string | null;
                 stuckSince: number | null }>;     // started_at, per §25's stuck definition
  now: { epochMs: number; appZoneDay: DayKey };
};
```

## Behaviour

Numbered rules; `scripts/check-runtime-rules.mjs` (§31) enforces every statically checkable one.
Numbering is stable: siblings cite §12, §19, §21, §25 and §28 by number.

**Runtime limits**

1. `export const runtime = "edge"` MUST NOT appear anywhere — unsupported (`stack-facts.md`). The
   default Node.js runtime is the only runtime.
2. 128 MB per isolate: never buffer a whole R2 object, table dump or base64 photo — stream
   (`R2ObjectBody.body`) or page. The backup job streams to R2.
3. CPU per HTTP request is **30 s by default** (5 min is the opt-in ceiling). We do not set
   `limits.cpu_ms` — r01 §2.10 marks as UNVERIFIED whether it also *lowers* a cron's 15-min budget.
   A route needing > 30 s CPU is a design error.
4. CPU per Cron Trigger is **conditional** (r01 §4.1): **30 s at an interval < 1 h, 15 min at >= 1 h**.
   All five crons are daily, so all sit in the 15-min bucket; adding a sub-hourly cron cuts the budget
   30x and is forbidden outright. Five triggers is also the entire **Workers Free** per-account budget
   (250 on Paid, which `stack-facts.md` assumes) — a sixth needs an owner decision, not a config edit.
5. Cron wall-clock **Duration is a hard 15 min** and network waits count against it (not against CPU).
   Every job bounds its work — at most N items per run, remainder next run — never "loop until done".
6. Crons run on UTC; Asia/Almaty is UTC+5 all year, no DST (r01 §4.6). Every expression states its
   Almaty time in a comment.

**Request lifecycle and bindings**

7. Bindings reach server code one way: `getCloudflareContext()`, whose store exists only inside the
   generated `fetch` handler (r02 §2.1). **Exactly two modules may import it** — `src/server/cf.ts`
   and the committed `src/server/db/index.ts`, which is itself an accessor module and documents the
   same rules in its header. Everything else calls `getEnv()`/`getDb()` or takes `env` as a
   parameter; guard (b) fails a third import site.
8. The sync form works in route handlers, Server Actions, dynamic server components and `proxy.ts`;
   it **throws** at module top level, in a prerendered route, and inside `scheduled` (r02 §2.1).
9. **Module-scope binding access is banned** — no `const db/env/bucket = …` at module scope anywhere.
   It throws at import time, *appears* to work in `next dev` (plain process global there), and a
   cached D1 handle invites `Cannot perform I/O on behalf of a different request` (r02 §2.1).

   **Corollary §9a — `process.env` is a fetch-path-only mechanism.** OpenNext's
   `init(request, env)` populates it once per isolate from the first *request* (r01 §4.3, quoted
   from source). Inside `scheduled` it is therefore empty on a cold isolate and populated on a warm
   one — the worst kind of bug, because it works in testing. Secrets in `worker.ts` and
   `src/jobs/**` come off `env`; `src/lib/env.ts` is Next-side only (guard (h)).

10. `getDb()` builds the Drizzle client **per request**; `drizzle()` does no I/O, so there is nothing
    worth memoising (r02 §2.2). Within a request pass `db` down as an argument.
11. `dbFromEnv(env)` is the only DB accessor permitted in `src/jobs/**` and `worker.ts`.
12. Any page or handler touching a binding MUST declare `export const dynamic = "force-dynamic"`. A
    prerendered D1 read bakes the developer's laptop database into production HTML (r02 §4.2) — the
    highest-consequence rule here.
13. `getEnvAsync()`/`getDbAsync()` are only for unavoidable top-level or prerender use: they read
    local bindings during `next build` and cannot work in the deployed worker (the async fallback
    does `await import("wrangler")`, deliberately unbundled — r02 §2.1). Each call site needs a
    justifying comment.
14. `drizzle(…, { casing: "snake_case" })` must match `drizzle.config.ts`; specs/02 owns both values
    and the committed `dbFromEnv` already passes it.

**Route handlers vs Server Actions**

15. Anything with a file, photo or binary body is a **Route Handler** — Server Actions have a 1 MB
    default body cap (r03 Recommendation).
16. Anything the offline queue replays is a **Route Handler**: Background Sync has no React runtime
    and must re-POST a plain `Request` (specs/05).
17. Server Actions are allowed only for < 32 KB form mutations from a client component, and each MUST
    call `requireSession()` itself and validate with Zod — `proxy.ts` does not cover Server Functions
    (r04 §4.4).
18. API routes always answer JSON; an auth failure on a non-navigation request is `401 JSON`, never a
    `302` (a redirect resolving to 200 HTML poisons the Serwist precache — r04 §4.2).
19. **Every route handler is `export const POST = route(async (req) => …)`** — `route()` from
    `src/server/http.ts` is the single wrapper, so an `AppError` becomes `jsonError(request, error)`
    and an unknown throw becomes `{ code: "internal" }` with a `requestId` and **no** stack in the
    body. Mapping: 401 unauthenticated, 403 forbidden, 404 not_found, 400 validation_failed, 413
    payload_too_large, 409 conflict, 429 rate_limited, 502 upstream_failed, 500 internal. This
    supersedes the `422 { error: "validation", issues }` shape sketched in specs/16 §8, which defers
    the envelope to this spec; it composes with specs/16 §7's five-line adapter
    (`export const POST = route((req) => createWorkout(getDb(), req, systemClock))`).

**Cron entrypoint**

20. `scheduled` dispatches `controller.cron` through `CRON_ROUTES` and calls the job **directly** with
    `env`. The `WORKER_SELF_REFERENCE` hop is reserved for jobs needing the Next runtime
    (`revalidateTag`, `next/og`), and the call form is exactly:
    `await env.WORKER_SELF_REFERENCE.fetch(new Request(new URL("/api/cron/" + job, env.APP_ORIGIN), { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } }))`
    (r01 §3.1, verified reaching a real route handler in r01 §2.6). The mechanism matters: it is a
    **global** `fetch()` to our own hostname that `global_fetch_strictly_public` loops back through
    Cloudflare's front door while `scheduled` still reports success (r04 §2.9, §4.3 item 3) — the
    service binding is the thing that avoids that, because it dispatches worker-to-worker.
    (Whether such a request also skips Cloudflare Access enforcement is **UNVERIFIED** — r04's own
    list of unverified claims — which is one more reason we are not deploying Access.) A synthetic
    or placeholder hostname here poisons `__NEXT_PRIVATE_ORIGIN` for the isolate's whole life
    (r01 §4.3, reproduced), hence `env.APP_ORIGIN` and guard (c).
21. **No cron expression uses the weekday field, and no job is gated as a whole.** Cloudflare
    documents weekdays as `1-7` with **Sunday = 1** (r01 §2.8), contradicting the usual 0-6
    convention and r01 §3.1's own Monday/Sunday labels; so all five schedules are daily and every
    weekday/day-of-month condition is a **step-level** gate inside the job, exactly as specs/14
    §355-357 composes them (`weekly-review` announces unlocks daily, reports on day 1, and does the
    review + TDEE recompute only on an Almaty Monday; `backup-to-r2` sweeps and runs the watchdog
    daily and backs up only on an Almaty Sunday). A step computes its own gate from
    `scheduledTime` — `new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, weekday: "short" }).format(at)`
    or `dayKeyOf(at.getTime()).endsWith("-01")` — and returns `{ ran: false, skippedReason }`. The
    job returns `ran: true` if **any** step ran. An unverifiable config ambiguity becomes a
    unit-tested pure function.
22. New scheduled work is added as a **gated step inside one of the five routed jobs**, never as a new
    trigger or `CronName`: specs/13, /14 and /15 compose ~nine logical steps that way.
23. A job derives "today" from `scheduledTime` in Asia/Almaty — never `new Date()`, never SQL
    `date('now')`, which is UTC in D1 (r11 §8.3).
24. Every job is idempotent: scheduled-retry policy is UNVERIFIED (r01 §4.8), so guard on a natural
    key — `notification_log(channel, kind, local_day)` UNIQUE for anything user-facing (specs/02) —
    and upsert, never blind-insert. `noRetry()` is for permanent errors only (unknown cron).
25. Bookkeeping is two statements around the job, both through `safe()`. The start statement upserts
    on the UNIQUE `(job, scheduled_at)` index **and clears `finished_at`, `ok`, `error`, `detail`**,
    because a retry reuses the slot and must not inherit the previous attempt's outcome. The finish
    statement sets `finished_at`/`ok`/`error` plus `detail = {"ran":…,"skippedReason":…}`. Therefore:
    `ok = 1, ran = true` is a real run; `ok = 1, ran = false` is an honest skip and renders as
    "skipped — not Monday", never as success; `ok = 0` carries the error string; and
    **`finished_at IS NULL AND started_at < now - STUCK_AFTER_MS` (16 min) is "stuck"** — a 15-min
    kill or an eviction. A currently-executing cron is *not* stuck, which is why the grace window
    exists. Bookkeeping failure is logged and swallowed, never masking the job's own error. Without
    this layer a cron can fail for days undetected — no browser, no 500, no user (r01 §4.7).
    This spec writes **no KV key**: `sys:cron:last-ok:<job>` belongs entirely to specs/14 (which
    specs/15 §649 already records as its writer) and is neither written nor read here.
26. `POST /api/cron/[job]` runs the same function on demand, and the comparison primitive is named,
    not left to the implementer: `safeEqual(header, env.CRON_SECRET)` from the **committed**
    `src/lib/auth/password.ts` (it length-checks first — `crypto.subtle.timingSafeEqual`'s
    mismatched-length behaviour is undocumented, r06 §G16 — then uses that extension when present
    and a constant-time XOR fallback in plain Node so the unit tests work). This supersedes the
    `constantTimeEqualUtf8`/`constantTimeEqualBytes` names sketched in specs/04 §112-116.
    **`safeEqual("", "")` returns `true`**, so the route rejects an empty header or an empty
    `env.CRON_SECRET` *before* calling it — that inverse is the quietest possible hole (specs/04
    §19). A `false` result, an unknown `[job]`, an empty header or an empty secret all return
    **404** (not 401), so the route is indistinguishable from one that does not exist.
27. Retiring a cron means setting `triggers.crons` to the remaining list (or `[]`) and deploying;
    **deleting the block leaves old schedules firing** against new code (r01 §4.4). An orphan hits
    the `cron.unrouted` branch, which logs and does not retry.

**Rate limiting, logging, dev, deploy**

28. `AUTH_LIMITER` (10/60 s) guards login (`"auth:login"`), recovery (`"auth:recover"`) and
    `/api/health` (`"health"`) — distinct keys are independent per-colo counters, so no third
    binding is needed (specs/04 §20). `AI_LIMITER` (12/60 s) guards every AI route, keyed on
    pathname. The binding returns only `{ success }`, so the 429 carries `Retry-After: 60` and
    `details: { retryAfterSeconds: 60 }` taken from the configured `period` — never a guessed value.
    **Authority split, because specs/11 §322 also rate-limits the AI routes:** `AI_LIMITER` is the
    per-colo burst brake that short-circuits *before* any KV read; specs/11's `rl:ai:<route>:<bucket>`
    KV counter is the account-wide per-minute cap and `ai:spend:*` the daily spend cap. Edge limits
    are per-colo, not global (r04 §4.15) — a courtesy brake, not a security control; the durable
    ceilings live in KV and D1.
29. One JSON object per `console` call, emitted through a `Logger` so `LOG_LEVEL` is actually
    enforced: request code uses `makeLogger`/`loggerFromEnv(getEnv())`, and `worker.ts`/`src/jobs/**`
    use `loggerFromEnv(env)` (there is no bare `console.log` in either). Fields always include `msg`,
    plus `requestId` on the request path and `job`/`durMs` on the cron path. Never log a session
    cookie, any `*_SECRET`/`*_KEY`/`*_TOKEN` value, photo bytes, or a full AI prompt (that belongs in
    `ai_prompt_logs`). `observability.enabled` retains these; `wrangler tail --format json --status
    error` shows them live.
30. Local dev is **one command, `npm run dev`**. Local binding state lives in `.wrangler/state/v3/`
    (D1 in `.wrangler/state/v3/d1/`): verified that `getLocalPersistencePath()` resolves
    `.wrangler/state` relative to the wrangler config for both the dev runtime and
    `wrangler d1 … --local` (r02 §2.5), so they share one database. `.wrangler/` is disposable and
    git-ignored; reset = `rm -rf .wrangler/state/v3/d1` + re-apply + re-seed (r02 §4.14), packaged as
    `npm run db:reset` by specs/16. `npm run preview` (real workerd, port 8787) is mandatory before
    every deploy and after any change to `worker.ts`, assets or `_headers`. **Crons never fire on a
    schedule locally** (r01 §4.12).
31. `scripts/check-runtime-rules.mjs` fails on: (a) `runtime = "edge"`; (b) `getCloudflareContext`
    imported anywhere but `src/server/cf.ts` and `src/server/db/index.ts`; (c) a placeholder host
    literal (`example.com`, `localhost`, `internal`, `127.0.0.1`) in `worker.ts` or `src/jobs/**`,
    **and — in `wrangler.jsonc` with `//` comments stripped — any `<`, `REPLACE_ME`, `example.com`
    or `localhost`**, which is what catches an unfilled `APP_ORIGIN`, `NUTRITION_CACHE` id or
    `VAPID_PUBLIC_KEY` before it ships; (d) a `src/app/**` file importing `@/server/db` without
    `dynamic = "force-dynamic"`; (e) a missing or shortened DO re-export in `worker.ts`; (f) a
    `next/*`, `server-only`, `"use client"` or `@opennextjs/cloudflare` import reachable from
    `worker.ts` or `src/jobs/**`; (g) the literal `NEXT_PUBLIC_` in `src/**`, `worker.ts` or
    `.dev.vars.example`; (h) a `process.env` read, or an import of `src/lib/env.ts` under any
    spelling (`@/lib/env`, `./src/lib/env`, `../lib/env`), in `worker.ts` or `src/jobs/**`.
    It prints `runtime rules OK (8/8)`.
32. `npm run build` stays `next build && <serwist step>`: `opennextjs-cloudflare build` invokes
    `npm run build` itself (r05 §4a, source-verified), so putting it there is infinite recursion.
33. `npm run cf-typegen` runs after **every** `wrangler.jsonc` change and `cloudflare-env.d.ts` is
    committed. CI runs `cf-typegen:check` (credential-free, non-zero when stale; owned by specs/16
    §128) in the order `cf-typegen:check` → `typecheck`/`lint` → `opennextjs-cloudflare build`,
    because `next build` type-checks `worker.ts` (r12 §G, r01 §3.5). Anything that needs the
    generated `.open-next/worker.js` — `wrangler deploy --dry-run` included — runs **after**
    `npx opennextjs-cloudflare build`, never before: on a clean tree esbuild cannot resolve
    `worker.ts`'s import of it and the dry-run errors out before printing a single binding.
34. Deploy: push `main` → Environment `production` → `npx wrangler d1 migrations apply DB --remote`
    (the positional accepts the *binding* name — verified by real run in r02 §2.5, so a database
    rename cannot break CI) → `npm run deploy` (which also `PUT`s `triggers.crons`). Migrations run
    **before** the worker deploy so new code never meets an old schema; cron changes take up to
    15 min to appear (r01 §4.9). The `deploy` job stays `workflow_dispatch`-gated as committed: a bad
    automatic deploy to a single-user app is worse than a slow one.
35. Rollback: `npx wrangler versions list` then `npx wrangler rollback <version-id> --message "…" -y`
    — always the **explicit** version id (the positional is optional in `--help`, but the implicit
    form rolls back to whatever wrangler picks). Both verified against wrangler 4.131.1 `--help`;
    `npx wrangler deployments list` shows what is live. Rollback reverts **code only** — D1
    migrations are forward-only, so every migration must be backward-compatible with the previous
    worker version (additive columns; never rename in the same deploy as the code using the new name).
36. **`CRON_SCHEDULE` in `src/jobs/registry.ts` is the single cron table**; `worker.ts` derives
    `CRON_ROUTES` from it and `wrangler.jsonc` mirrors it. The mirror is asserted by a **string**
    comparison, not by parsing: `wrangler.jsonc` is JSONC — the committed file has line comments
    *and* trailing commas, and the schema itself declares `allowTrailingCommas: true` — so
    `JSON.parse` throws and no JSONC parser is a dependency of this repo. The test strips
    `//`-comments with a regex, slices the `"crons": [ … ]` block and compares the string literals
    it finds against `CRON_SCHEDULE.map(r => r.cron)`.
37. **`env.APP_TZ` must equal `APP_TIME_ZONE`.** `/api/health` echoes `runtime.tz` and a Playwright
    smoke assertion compares it to the constant; a mismatch means a config edit landed without the
    code, which would silently move "today" by five hours.
38. **`/api/health` is the binding prober; `/api/system/diagnostics` is the cron reporter.** Health
    stays unauthenticated and information-free (ok/error per binding, no ids, names or row contents),
    write-then-deletes `__health/probe` in all three R2 buckets and both KV namespaces, asserts the
    expected table set exists in D1, and returns **503** when any probe fails — that is the only
    signal that survives a deploy with no session, and a read-only check would pass against a bucket
    we cannot write to. The two OpenNext-only bindings (`NEXT_INC_CACHE_R2_BUCKET`,
    `NEXT_TAG_CACHE_D1`) are deliberately **not** probed: app code never touches them and a failure
    there shows up as a cache miss, not as data loss. Cost is seven probes — 2 D1 queries plus 15
    R2/KV operations (R2 Class A at $4.50/M, so pennies even under abuse) — bounded by
    `checkRateLimit(AUTH_LIMITER, "health")`. Diagnostics therefore does **no** binding I/O: it reads
    `cron_runs` (one query, last 14 days, reduced in JS — no `json_extract` dependency) plus the
    clock, and the System card fetches both endpoints.

## Data

Canonical definitions live in `specs/02-data-model.md`; this spec only states what it needs.

- **D1 `DB` writes:** `cron_runs(id, cron, job, scheduled_at, started_at, finished_at?, ok, error?,
  detail?)` with `UNIQUE(job, scheduled_at)` and `INDEX(job, started_at)` — exactly the committed
  `drizzle/migrations/0000_init.sql` shape. The PK is a ULID from `ulid(startedAt)`; timestamps are
  epoch-ms INTEGER; `ok` is `0|1` (SQLite has no boolean). **`detail` holds
  `{"ran":boolean,"skippedReason":string|null}`** — that is how an honest skip is distinguished from
  a real run without a schema change (§25). `error` holds **only** real errors, never a skip reason.
- **D1 `DB` reads:** `cron_runs` only (diagnostics). Everything else belongs to a feature spec.
- **Foreign tables in `DB`:** `d1_migrations` (wrangler-owned). No app code reads or writes it and no
  drift check may drop it. OpenNext's `revalidations` is kept out of `DB` entirely by giving
  `NEXT_TAG_CACHE_D1` its own database (r02 §4.11).
- **KV** — keys are `<domain>:<subject>[:<version>]` and **every** write passes `expirationTtl`
  (minimum 60 s). This spec writes and reads **no KV key**; it only fixes the convention and the
  ownership: `CACHE_KV` holds `sys:cron:last-ok:<job>` (specs/14), `auth:session_version`
  (specs/04), `cache:ex:*` (specs/08), `gami:snapshot:v1` (specs/13), `notify:*` (specs/14) and
  `dash:v1:*`/`tdee:v1:*` (specs/12, called `APP_CACHE` there — same namespace, binding `CACHE_KV`);
  `NUTRITION_CACHE` holds the `off:*`/`fdc:*`/`ai:spend:*` keys owned by specs/11. KV is a cache
  only — a miss is never an error, and no session state, WebAuthn challenge or authoritative counter
  may live there (r04 §4.8).
- **R2** — `PHOTOS`: `photos/{progress|food}/{yyyy}/{mm}/{ULID}/{display|thumb|orig}.{ext}`
  (r03 §5, specs/10). `EXERCISE_MEDIA`: `exercises/<source_id>/<idx>.jpg` (specs/08).
  `BACKUPS` — **specs/15's layout is ratified verbatim**, because it is the most specific and the
  only gzip-aware one:
  ```
  backups/<yyyy>/<mm>/fitness-<run_key>.ndjson.gz        (+ .manifest.json, .verify.json)
  backups/monthly/<yyyy>/fitness-<run_key>.ndjson.gz     (+ .manifest.json)
  backups/manual/<yyyy>/<mm>/fitness-<ISO>.ndjson.gz     (+ .manifest.json)
  backups/archive/<yyyy>-Q<n>/photos-<yyyy>-<mm>.zip     (+ archive.manifest.json)
  ```
  This **supersedes** `specs/02` §513's `backups/{yyyy}/{mm}/backup-<ISO>.ndjson` and answers
  `specs/15`'s open question 1 with its option (b): a dedicated `BACKUPS` bucket, so nothing that
  sweeps photos can reach a backup. Keys are lowercase `[a-z0-9/._-]`, never reused, and contain no
  PII.
- **Amendments this spec requires in siblings** (all one-liners, listed so they are not forgotten):
  `specs/02` §512-513 — `MEDIA` → `EXERCISE_MEDIA`, `APP_CACHE` → `CACHE_KV`, and the `BACKUPS` key
  layout above; `specs/15` §117 `z.literal("PHOTOS")` → `z.literal("BACKUPS")` and §636-647's
  "one content bucket" → `BACKUPS`; `specs/11` §383 `FDC_API_KEY` → `USDA_FDC_KEY`; `specs/16` §8's
  `422` validation envelope → §19's `400 validation_failed`.
- **IndexedDB:** none owned here; specs/05 owns every store.

## UX notes

- The only user-visible surface owned here is a **System card** at the bottom of Settings: per cron
  job the last **run** and the last **skip** as separate lines (relative time, RU/EN) — "обновлено
  2 ч назад" vs "пропущено — не понедельник", never one dressed as the other — plus `stuck` in the
  error style, the `/api/health` probe list, and the app-zone clock (server epoch ms + `appZoneDay`,
  which catches a timezone regression instantly). A page section, not a sheet — it is never needed
  one-handed mid-workout.
- That card is the only place a raw error string may render, truncated to 140 chars inside a
  tap-to-expand `<details>`. Its `<summary>` is the one interactive control this spec owns and it
  gets `min-h-tap` (`--spacing-tap`, 56 px — specs/03 §223, above the 44 px WCAG floor) with a full-
  width hit area. Elsewhere errors are a toast: one human sentence plus the `requestId` in
  `text-xs font-numeric` (12 px, the design system's smallest stock size, specs/03 §222) so a bug
  report is copy-pasteable. Truncated error text and the requestId both use the body-copy foreground
  token, contrast >= 4.5:1 (specs/03 §239-240's measured pairs); error red is never used for
  long-form copy.
- Errors get **no** haptic and nothing beyond the toast's spring entrance — failure must never feel
  like a game event. A 429 reads "Slow down for a moment" with the 60 s retry window, not red alarm.
- Skeleton: three fixed-height shimmer rows in the System card so Settings does not reflow.
- a11y: toast container `role="status"` `aria-live="polite"`; 5xx toast `role="alert"`
  `aria-live="assertive"`. Probe state is conveyed as text ("OK" / "unreachable"), never colour alone.

## Risks

| Risk | Mitigation |
|---|---|
| `getCloudflareContext()` on a cron path; the thrown message blames `next.config.ts`, which is correct, costing an hour (r01 §2.4, §4.2) | Jobs take `env`; two import sites only; guard (b) in §31 |
| A synthetic self-fetch hostname poisons `__NEXT_PRIVATE_ORIGIN` for the isolate → sporadic Server Action rejections and wrong redirects, nothing logged (r01 §4.3, verified) | Direct job calls; the verbatim service-binding call form in §20; guard (c), which now also scans `wrangler.jsonc` |
| A secret read via `process.env` inside `scheduled` works on a warm isolate and is `undefined` on a cold one (r01 §4.3) | §9a; `secrets.required` types `env.CRON_SECRET`; guard (h) |
| A prerender bakes the laptop's D1 rows into production HTML (r02 §4.2) | §12 + guard (d) + a `npm run preview` check on every data route |
| The DO re-export removed by a lint autofix or `knip` → deploy hard-fails (r01 §4.5) | Comment block, guard (e), and `opennextjs-cloudflare build && wrangler deploy --dry-run` in CI (in that order — §33) |
| New binding without `cf-typegen` → `Property 'X' does not exist on type 'CloudflareEnv'` (r01 §4.13); the generated `WORKER_SELF_REFERENCE: Service<typeof import("./worker").default>` is circular, so a broken `worker.ts` produces type errors on `env` itself (works — verified r01 §4.13) | `cf-typegen:check` in CI; committed `cloudflare-env.d.ts`; read `worker.ts` errors before `env` errors |
| Weekday numbering (`Sunday = 1`) silently shifts the weekly report by a day | §21: no cron uses the weekday field; step gates unit-tested |
| A sub-hourly cron silently cuts CPU from 15 min to 30 s (r01 §4.1) | `tests/unit/cron-routes.test.ts` asserts every interval >= 1 h |
| A cron fails unnoticed for days, or a step gate is stuck closed and reads as success (r01 §4.7) | `cron_runs` with `detail.ran` separate from `ok` (§25) + `stuckSince` + the System card's run/skip split + `observability.enabled` + specs/14's watchdog step |
| `proxy.ts` on OpenNext is experimental/unsupported for Node middleware (r11 §3, r04 §4.5) | `proxy.ts` is a UX redirect only; `requireSession()` inside every handler/action is the boundary (specs/04) |
| A secret leaks into the client bundle | Only `VAPID_PUBLIC_KEY` is public; `NEXT_PUBLIC_*` banned; guard (g) covers `.dev.vars.example` too |
| `migrations_dir` vs `drizzle.config.ts` `out` drift → "no migrations to apply" on a stale schema | Both are the literal `drizzle/migrations` (committed `wrangler.jsonc`; `drizzle.config.ts` `out: "./drizzle/migrations"`, specs/02 §53); the Phase 0 gate greps both files for the same string rather than asserting agreement in prose |
| `.wrangler/` deleted or fresh clone → empty local DB that looks like a code bug (r02 §4.14) | `npm run db:reset` (specs/16 §128 owns the script) documented and repeatable; seeding always scripted |
| `wrangler --local` will not start on some machines (`internal error; reference = …`, r02 §4.15) | Every `--local` line in the gates below is skippable; specs/16 §6's `E2E_BASE_URL` path runs the same checks against a deployed preview |

## Verification

### Phase 0 gate

```bash
# The script is owned by specs/16 §128 and is not in package.json yet. Until it lands the
# equivalent is: npm run cf-typegen && git diff --exit-code cloudflare-env.d.ts
npm run cf-typegen:check   # PASS: "Types at cloudflare-env.d.ts are up to date." exit 0 (r12 §G10)
npm run typecheck && npm run lint            # PASS: exit 0
node scripts/check-runtime-rules.mjs         # PASS: "runtime rules OK (8/8)" exit 0
npx vitest run tests/unit                    # PASS: all green

# migrations_dir and drizzle `out` are the SAME LITERAL — grep, do not trust prose.
grep -c '"migrations_dir": "drizzle/migrations"' wrangler.jsonc   # PASS: 1
grep -c 'out: "./drizzle/migrations"' drizzle.config.ts           # PASS: 1

# The bundle must exist before wrangler can resolve `main` (§33). This also runs `npm run build`.
npx opennextjs-cloudflare build
npx wrangler deploy --dry-run --outdir .dryrun
# PASS: exactly this binding table (verified by running it here, wrangler 4.131.1), and NOT the
# string "which are not exported in your entrypoint file":
#   env.CACHE_KV (…)                        KV Namespace
#   env.NUTRITION_CACHE (…)                 KV Namespace
#   env.DB (fitness-pwa-db)                 D1 Database
#   env.NEXT_TAG_CACHE_D1 (fitness-pwa-cache-db)  D1 Database
#   env.PHOTOS (fitness-pwa-media)          R2 Bucket
#   env.EXERCISE_MEDIA (…)                  R2 Bucket
#   env.BACKUPS (…)                         R2 Bucket
#   env.NEXT_INC_CACHE_R2_BUCKET (…)        R2 Bucket
#   env.WORKER_SELF_REFERENCE (fitness-pwa) Worker
#   env.AUTH_LIMITER (10 requests/60s)      Rate Limit
#   env.AI_LIMITER (12 requests/60s)        Rate Limit
#   env.ASSETS                              Assets
# followed by the vars as "Environment Variable" rows. Rate limiters and Assets DO appear; there is
# no NEXT_CACHE_DO_QUEUE row (Open questions 2).

npm run db:migrate:local                     # PASS: "Resource location: local", 0 errors
ls .wrangler/state/v3/d1                     # PASS: directory exists
```

Two shells, because `next dev` never exits — `npm run dev && curl …` would hang forever:

```bash
# terminal A
npm run dev
# terminal B — poll for readiness (any HTTP status means the server answered), then assert
until curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health | grep -qE '200|503'; do sleep 1; done
curl -s http://localhost:3000/api/health
# PASS: HTTP 200 and {"ok":true,"checks":{…7 probes all ok…},"runtime":{"tz":"Asia/Almaty",…}}
#       503 with the failing probe named is the correct FAILURE output, not a hang.
```

```bash
npm run deploy                        # PASS: deploy succeeds; note the printed *.workers.dev origin
# -> paste it into vars.APP_ORIGIN, `npm run cf-typegen`, commit, deploy again
curl -s https://<APP_ORIGIN host>/api/health   # PASS: 200 {"ok":true,…} from the real Worker
npx wrangler versions list            # PASS: the new version is listed first
npx wrangler rollback <version-id> --message "verify rollback" -y   # PASS: that version becomes active
```

Unit cases (pure functions only; formula vectors belong to `specs/07-calculators.md`, which uses
[`r09-formulas-and-test-vectors.md`](../docs/research/r09-formulas-and-test-vectors.md) §1 e1RM,
§3 Navy BF, §4 EMA, §5 adaptive TDEE — none of them are this spec's concern):

- `time.test.ts` — `todayInAppZone(Date.parse("2026-09-12T18:30:00Z")) === "2026-09-12"`;
  `todayInAppZone(Date.parse("2026-09-12T19:30:00Z")) === "2026-09-13"` (UTC+5 crossing);
  the §21 weekday one-liner gives `Mon` for `2026-09-14T03:05:00Z` and `Sun` for
  `2026-09-13T18:00:00Z` (23:00 Almaty); the same offset holds for a January date (no DST);
  `APP_TIME_ZONE === "Asia/Almaty"`.
- `http-envelope.test.ts` — `httpStatusFor` covers all nine codes; `RETRYABLE` is exactly
  `{rate_limited, upstream_failed, internal}` and is disjoint from `PARKS_QUEUE`; `route()` turns an
  `AppError` into its mapped status and an unknown throw into `500 { code: "internal" }`;
  `jsonError` output matches `ApiErrorBody`, carries `requestId`, and contains neither `"stack"` nor
  any value from `.dev.vars.example`.

### Phase 8 gate

Expected to fail before Phase 8 lands (and before `specs/13` has created
`src/jobs/nightly-rollup.ts`). Re-run the whole Phase 0 gate first — `main` has changed.

```bash
npx vitest run tests/unit                    # PASS: cron-routes + jobs-gate now green too
npx opennextjs-cloudflare build && npx wrangler deploy --dry-run --outdir .dryrun
# PASS: same 12 bindings, no "not exported in your entrypoint file"
```

- `cron-routes.test.ts` — the `wrangler.jsonc` `crons` literals (comment-stripped, §36) equal
  `CRON_SCHEDULE.map(r => r.cron)`; every `CRON_NAMES` entry is routed exactly once; every
  expression's minimum interval >= 3600 s; no expression has a non-`*` weekday field;
  `CRON_SCHEDULE.length <= 5`.
- `jobs-gate.test.ts` — the **Monday-gated step** of `weekly-review` returns
  `{ ran: false, skippedReason }` on the six non-Monday vectors and `{ ran: true }` on the Monday
  vector, while the job itself returns `ran: true` on every day because its daily announce step ran
  (specs/14 §355-357); the Sunday-gated step of `backup-to-r2` likewise; a job whose every step
  skipped returns `{ ran: false }`.

Two shells again — `npm run preview` does not exit:

```bash
# terminal A
npm run preview -- --port 8787
# terminal B
until curl -s -o /dev/null http://localhost:8787/api/health; do sleep 1; done

# The pinned convention for the whole repo: /cdn-cgi/local/scheduled on port 8787, ?format=json.
# It needs no flag (wrangler dev hard-codes unsafeTriggerHandlers) and it accepts ?time= to
# override controller.scheduledTime, which is how a Monday is tested (r01 §2.9, verified).
# Downstream specs must use this form, not /__scheduled (which needs --test-scheduled).
curl -s "http://localhost:8787/cdn-cgi/local/scheduled?cron=5+3+*+*+*&format=json"
# PASS: {"outcome":"ok","noRetry":false}
curl -s "http://localhost:8787/cdn-cgi/local/scheduled?cron=5+3+*+*+*&time=1789355100000&format=json"
# PASS: outcome ok. 1789355100000 = 2026-09-14T03:05:00Z = Monday 08:05 Almaty (checked with
# Intl.DateTimeFormat here), so the Monday-gated step runs and detail.ran is true below.
curl -s "http://localhost:8787/cdn-cgi/local/scheduled?cron=9+9+*+*+*&format=json"
# PASS: outcome ok AND a terminal-A log line containing "msg":"cron.unrouted"
npx wrangler d1 execute DB --local --command \
  "select job, ok, finished_at, detail from cron_runs order by started_at desc limit 5"
# PASS: a weekly-review row with a non-null finished_at, ok=1, and detail {"ran":true,…}
curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8787/api/cron/weekly-review
# PASS: 404 (no secret); 200 with a correct x-cron-secret header; 404 with a wrong one
```

```bash
npm run deploy                        # PASS: prints the five schedules it PUT
npx wrangler tail --format json --status error
# PASS: a forced failure shows one JSON line with "msg":"cron.finished","ok":false and no secret value
```

## Open questions

1. **Decision record — `workers.dev` subdomain, not a custom domain, through Phase 8.**
   (a) `*.workers.dev`: zero DNS work, a fixed `APP_ORIGIN` after the bootstrap paste above, but no
   zone features and a scruffy PWA install identity. (b) Custom domain: required for Cloudflare
   Access, for a zone-cached R2 custom domain, or for `Workers Routes` in the deploy token.
   **Decided: (a), revisit in Phase 9.** Cost of (a) is exactly one thing — no zone-level edge cache
   for public exercise media, which specs/08 serves through the Worker with the Cache API meanwhile.
   It costs nothing on images: the AVIF/`/cdn-cgi/image` path is already ruled out by r03 §G11
   independently of the domain (see Binding registry), and specs/10 §35 owns the client-side variant
   pipeline that replaces it. Open for the owner only in that the literal origin string cannot be
   written here — it is printed by the first deploy.
2. **Decision record — no `NEXT_CACHE_DO_QUEUE`, no `queue: doQueue`, no `migrations` block.**
   Phase 0 shipped `wrangler.jsonc` and `open-next.config.ts` with both halves omitted and a written
   rationale; r12 §G11 says verbatim to "either add it or delete the `queue:` line", and r12 §H's own
   `wrangler.jsonc` omits the namespace. **Decided: ratify Phase 0.** The binding, the override and
   the `migrations: [{ tag: "v1", new_sqlite_classes: ["DOQueueHandler"] }]` entry are added
   **together** in the phase that first calls `revalidatePath()`/`revalidateTag()`; the DO re-export
   in `worker.ts` stays regardless, because re-exporting an unbound class is harmless (verified) and
   is what makes that later change a one-line config edit. Reversing this now would cost a DO
   namespace we never call plus a `new_sqlite_classes` migration that is awkward to undo, and buy
   nothing before ISR exists. Consequence already applied: the dry-run asserts **12** bindings.
3. **Does `secrets.required` change `wrangler deploy` behaviour when a listed secret is unset?**
   Verified here: it makes `wrangler types` emit the names on `CloudflareEnv` and `NodeJS.ProcessEnv`,
   and the schema documents "local dev validation with warnings for missing secrets". Whether a
   **deploy** warns or *fails* is **UNVERIFIED** — it cannot be tested without pushing a real deploy.
   Not blocking (the Phase 0 gate sets both secrets before the first deploy), but if it turns out to
   fail the deploy, `CRON_SECRET` must move into `secrets.required` only in Phase 8, which is why the
   env-var contract already marks it "`required` from P8".
