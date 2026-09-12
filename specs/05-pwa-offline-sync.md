# 05 — PWA shell, service worker and the offline-first sync engine

## Purpose

Makes the app installable, boot-able with no network, and makes every write survive a dead
connection. Satisfies the brief's non-functional requirement *"Offline-first: a full workout is
loggable with no network and syncs later (queue + background sync + conflict resolution)"*, Phase 1
DoD *"installs to home screen, works offline (shell)"* and Phase 2 DoD *"a full session logs OFFLINE
and syncs"*. Two halves: (A) the Serwist service-worker shell, (B) the Dexie outbox + batch sync
engine that every feature module writes through.

## Scope

- Serwist **configurator mode**: `serwist.config.mts`, `src/app/sw.ts`, `tsconfig.sw.json`, the
  `package.json` build order against `opennextjs-cloudflare build`, `public/_headers`.
- Manifest + icons via the App Router metadata API; `/~offline`; the SW update flow; the precache list
  and the complete runtime-caching table (one row per route class); the cache allowlist and every
  cache-purge trigger, logout included.
- The single Dexie database: schema, version ladder, mirror-row contract, the **wire-row contract**,
  `outbox`, `blobs`, `meta`.
- Write path, flush path, retry/backoff/poison cap, ordering, conflict resolution,
  `POST /api/sync/batch`, `POST /api/sync/pull`, and the registration seam for the out-of-band photo
  transport `specs/10` defines.
- `navigator.storage.persist()`, retention, eviction, quota pressure; the unsynced badge,
  permanent-failure UX, `settings/sync`, and the manual airplane-mode script.

### Out of scope

| Excluded | Owner |
|---|---|
| D1 DDL, columns, indexes, migrations | `specs/02-data-model.md` |
| Colour/motion tokens, bottom nav, sheet chrome | `specs/03-design-system.md` |
| Session cookie, `requireSession()`, login page, `logout()` | `specs/04-auth.md` |
| Which routes are prerendered; the server/client split; `wrangler.jsonc` | `specs/01-architecture.md` |
| Op payload semantics per feature (`workout.*`, `set.*`, …) | `specs/06`–`13` |
| Photo capture, derivatives, the R2 routes, and `dispatchPhotoOp`'s body | `specs/10-body-photos.md` |
| Web Push subscribe/send; the `push`/`notificationclick` listeners added to `src/app/sw.ts` | `specs/14-ai-coach-and-notifications.md` |
| Export/import, scheduled R2 backup | `specs/15-data-portability.md` |
| CI wiring of §Verification | `specs/16-testing-ci-quality.md` |

### Amendments this spec requires of others

Each is a one-line change in the owning spec; none is optional, and each is named at the behaviour
that depends on it. Listed here so an implementer can raise all five at once.

| # | Owner | Change | Needed by |
|---|---|---|---|
| 05→01.1 | `specs/01` | one more `ratelimits[]` entry `{ name:"SYNC_LIMITER", namespace_id:"1003", simple:{ limit:60, period:60 } }` + the `CloudflareEnv` field | Behaviour 25 |
| 05→02.1 | `specs/02` | the pull index is composite `(updated_at, id)`, not `(updated_at)` — P12's `<t>_updated_at_idx` becomes `<t>_updated_at_id_idx` on every mirrored table | Behaviour 28 |
| 05→03.1 | `specs/03` | i18n request config may not make the **root** layout dynamic: no `getLocale()`/`getRequestConfig()` above the client provider (01 line 27 assigns "i18n request config + locale cookie" to `specs/03`; `specs/13` line 40 assigns `next-intl` wiring to `specs/01` — that disagreement is 01's and 13's to settle, and either owner must carry this constraint) | Behaviour 6 |
| ~~05→06.1~~ | `specs/06` | **already satisfied, no action** — 06 rule 1 writes `meta.workoutActive = true` at session start and names 05 rule 13(d) as the reader; 06's own "amendment 06 requires of 05" (`workoutExercise.*` + the `workout_exercises` mirror table) is **granted** by this revision's `OP_TYPES` and `WRITABLE_TABLES` | Behaviour 13d, 35 |
| 05→10.1 | `specs/10` | already written as its own amendment 05.1 — `POST /api/photos` / `PUT /api/photos/{id}/{variant}` accept `X-Mutation-Id` and write the `mutations` row under it, so a replayed photo op is a `duplicate` and not a second object | Behaviour 36 |

## Files to create

Four rows are marked *(edit)* because Phase 0 already shipped them with settings this spec
contradicts; the flags that must change are named, because every one of those failures is silent.

| Path | Responsibility |
|---|---|
| `serwist.config.mts` *(exists — verify only)* | `@serwist/cli` config via `serwist()` from `@serwist/next/config`: globs, `globIgnores`, `/~offline`, BUILD_ID revision. The shipped file already matches Behaviours 2–5; change nothing |
| `tsconfig.sw.json` *(exists — verify only)* | `lib:["esnext","webworker"]`, `skipLibCheck:true`, `types:[]`, `include:["src/app/sw.ts"]` |
| `src/app/sw.ts` *(edit)* | **Flip three flags** the shipped file has backwards: `skipWaiting: true → false`, `clientsClaim: true → false`, `navigationPreload: true → false` (Behaviours 11, 13). Then replace `runtimeCaching: defaultCache` with `[...ourEntries, ...defaultCache]`, and add our `sync`/`message`/`activate` listeners **before** `serwist.addEventListeners()` |
| `src/app/manifest.ts` *(edit)* | Shipped file has one `maskable` icon at 512 only. Needs **separate `any` and `maskable` entries at both 192 and 512** (Behaviour 15) |
| `src/app/~offline/page.tsx` *(edit)* | Shipped file is RU-only static text. Needs **both locale message bundles imported at build time**, the locale picked client-side from `meta.locale`, the unsynced count, and the retry button (Behaviour 14) |
| `src/app/layout.tsx` *(edit)* | **Remove `getLocale()` from `next-intl/server` and the server-side `NextIntlClientProvider`** — the shipped root layout reads the locale cookie, which is exactly the landmine Behaviour 6 forbids. Add `<SerwistProvider swUrl="/sw.js" reloadOnOnline={false}>`; keep `viewport`/`appleWebApp`; must stay **static** |
| `public/_headers` | `no-cache, no-store, must-revalidate` + `Service-Worker-Allowed: /` for `/sw.js`; `immutable` for `/_next/static/*` |
| `public/icons/{icon,icon-maskable}-{192,512}.png`, `apple-touch-icon.png`, `badge-72.png` | Static icon set. `icon-maskable-192.png` and `badge-72.png` are missing from the repo |
| `src/db/local.ts` | The one `Dexie` subclass: version ladder, store index strings, `versionchange`/`blocked` handlers, `resetLocalDb()` |
| `src/db/local-types.ts` | `MirrorMeta`, `OutboxOp`, `BlobRow`, `MetaRow` |
| `src/lib/sync/ops.ts` | `OpType` union, `MirrorTable`, per-op Zod schemas, batch/pull envelope schemas (shared client↔server) |
| `src/lib/sync/wire.ts` | `toWireRow()` / `fromWireRow()` — the **only** two places a D1 row changes shape (Behaviour 35) |
| `src/lib/sync/outbox.ts` | `enqueue`, `claimBatch`, `ackOp`, `failOp`, `killOp`, `killGroup`, `retryDead`, `discardDead` |
| `src/lib/sync/apply-local.ts` | `writeLocal()` — mirror upsert + `prevJson` capture + outbox insert in one Dexie `rw` transaction |
| `src/lib/sync/flush.ts` | DOM-free flush loop, imported by both the page and `src/app/sw.ts`; calls `dispatchPhotoOp` for photo ops |
| `src/lib/sync/pull.ts` | `pullChanges()` + `applyServerRows()` |
| `src/lib/sync/backoff.ts` | `nextAttemptDelayMs()`, `classifyFailure()`, `isPoisoned()` (pure) |
| `src/lib/sync/schedule.ts` | Triggers: enqueue debounce, `online`, `visibilitychange`, `focus`, `pageshow`, timer, `sync.register()` |
| `src/lib/sync/runtime.ts` | `getDeviceId()`, `requestPersistence()`, `getQuota()`, `evictBlobs()`, `useSyncStatus()` |
| `src/lib/sync/cache-names.ts` | `OUR_RUNTIME_CACHES`, `VOLATILE_PAGE_CACHES`, `DEFAULT_CACHE_NAMES`, `cacheAllowlist()`, `purgeVolatileCaches()` (imported by `sw.ts` and by 04's `logout()`) |
| `src/components/pwa/{sw-update-gate,sync-badge,install-hint}.tsx` | Waiting-SW prompt (workout-aware); bottom-nav sync chip; iOS add-to-Home-Screen hint |
| `src/components/i18n/locale-provider.tsx` | Client locale provider; owns `document.documentElement.lang` (Behaviour 6) |
| `src/app/settings/sync/page.tsx` | Sync queue + dead-op resolution |
| `src/server/sync/apply-op.ts` | `OP_APPLIERS` registry — `{ schema, parents, reads, apply }` per op; feature specs register into it |
| `src/server/sync/conflict.ts` | `resolvePatch()`, `clampClientTime()` (pure) |
| `src/server/sync/cursor.ts` | Keyset cursor encode/decode + per-entity `changesSince()` |
| `src/app/api/sync/{batch,pull}/route.ts` | `POST` batch (idempotent per op id) and `POST` pull, both session-gated |
| `scripts/assert-pwa-build.mjs` | Post-build assertions (offline HTML, SW manifest sanity, `skipWaiting: false`, every quoted default cache name still present in the installed `@serwist/next` worker) |
| `scripts/assert-installable.mjs` | Parses `/manifest.webmanifest` and asserts r05 §8's five Chromium install criteria |
| `tests/fixtures/sync-seed.sql` | The `users`/`settings`/`exercises` parent rows §Verification §3 needs in a fresh local D1 |
| `tests/fixtures/sync-ops.json` | One batch: `workout.create` → `workoutExercise.create` → `set.create`, parents first |
| `tests/unit/sync/{backoff,conflict,outbox,cursor,wire,cache-names,mirror-tables}.test.ts` | Vitest units |
| `tests/e2e/offline-workout.spec.ts` | Playwright airplane-mode round trip |

## Interfaces

```ts
// src/db/local-types.ts — a mirror row is the D1 row from specs/02-data-model.md under its camelCase
// TS keys, converted once by src/lib/sync/wire.ts (Behaviour 35), plus MirrorMeta. Units are D1's:
// kg, kcal, grams, epoch-ms instants.
export interface MirrorMeta {
  id: string;                 // ULID minted by the client (02 rule 1), identical in D1
  updatedAt: number;          // epoch ms; device clock at the local edit — the LWW basis (02 rule 3)
  rev: number | null;         // D1 `syncCols().rev` (integer from 1); null until first ack, and
                              // permanently null for `settings`, which has no `rev` (Behaviour 35)
  dirty: 0 | 1;               // 1 while an outbox op for this row is unacked
  deleted: 0 | 1;             // derived: 1 iff deletedAt !== null
  deletedAt: number | null;   // epoch ms, retained verbatim — Behaviour 27 compares against it
  prProvisional?: 0 | 1 | undefined;  // local-only, set rows; never sent, never accepted from server
}
export type Mirror<T> = T & MirrorMeta;
export type MirrorRow<T> = { table: MirrorTable } & Mirror<T>;   // one `mirror` store, key [table+id]
export type OutboxStatus = "pending" | "inflight" | "failed" | "dead";

export interface OutboxOp {
  seq?: number | undefined;   // Dexie `++` auto-increment PK; assigned on add(), monotonic
  id: string;                 // mutation ULID = `mutations.id`; THE idempotency key, never reminted
  kind: OpType;               // → mutations.kind
  entityTable: MirrorTable; entityId: string;         // → mutations.entity_table / entity_id
  payloadJson: unknown;       // structured clone; validated against OP_SCHEMAS[kind] before insertion
  prevJson: unknown | null;   // the mirror row as it was BEFORE this op's upsert; null = row is new.
                              // The only thing that makes `settings/sync`'s Отклонить buildable
                              // offline (Behaviour 32). Never sent to the server.
  clientRev: number | null;   // mirror.rev at edit time; null for creates. Crosses to D1 as
                              // `mutations.client_rev = clientRev ?? 0` (Behaviour 25)
  updatedAt: number;          // epoch ms, device clock at the edit; written to the row's updated_at
  status: OutboxStatus;
  attempts: number;           // server-acknowledged failures only
  firstFailedAt: number | null;  // epoch ms of the first server-acknowledged failure; the poison clock
  nextAttemptAt: number;      // epoch ms
  leaseUntil: number;         // epoch ms; 0 unless status === "inflight"
  lastError: string | null;
  deadCode: string | null;    // set with status "dead": "rejected" | "parent_dead" | "expired" | …
  blobKey: string | null;     // → blobs.key, for photo ops
  createdAt: number;          // epoch ms
}
export interface BlobRow { key: string; blob: Blob; bytes: number; contentType: string;
  createdAt: number; uploaded: 0 | 1 }
/** meta keys, complete: pullCursor, schemaVersion, deviceId, locale, hydration, persisted,
 *  persistApiAvailable, workoutActive (written by specs/06 rule 1, read here), flags. */
export interface MetaRow { key: string; value: unknown }
export const MAX_BLOB_BYTES = 8 * 1024 * 1024;   // = specs/10's own 8 MiB gate; enforced at enqueue
```

```ts
// src/lib/sync/ops.ts  (zod 4.6.2)

/** The COMPLETE writable set. Enumerated, not summarised: a table absent here cannot be written
 *  offline at all, which is a product decision, not an omission. `exercise.*` is restricted to
 *  `'usr:<ULID>'` ids (02 rule 2) and `food.*` to `source = 'user'` rows; the server rejects
 *  anything else. */
export const OP_TYPES = [
  "workout.create","workout.patch","workout.delete","workout.restore",
  "workoutExercise.create","workoutExercise.patch","workoutExercise.delete",
  "set.create","set.patch","set.delete",
  "exercise.create","exercise.patch","exercise.delete",
  "program.create","program.patch","program.delete",
  "routine.create","routine.patch","routine.delete",
  "routineExercise.create","routineExercise.patch","routineExercise.delete",
  "bodyMeasurement.create","bodyMeasurement.patch","bodyMeasurement.delete",
  "photo.upload","photo.delete",                       // out-of-band transport, Behaviour 36
  "checkin.upsert",
  "goal.create","goal.patch","goal.delete",
  "food.create","food.patch",
  "meal.create","meal.patch","meal.delete",
  "mealItem.create","mealItem.patch","mealItem.delete",
  "foodEntry.create","foodEntry.patch","foodEntry.delete",
  "waterLog.create","waterLog.patch","waterLog.delete",
  "settings.patch",
] as const;                                            // 46 ops
export type OpType = (typeof OP_TYPES)[number];

/** D1 table names the client mirrors. 02 owns the set; `tests/unit/sync/mirror-tables.test.ts`
 *  asserts this union against 02's barrel so it cannot drift (Behaviour 35). */
export const WRITABLE_TABLES = ["workouts","workout_exercises","sets","exercises","programs",
  "routines","routine_exercises","body_measurements","photos","daily_checkins","goals","foods",
  "meals","meal_items","food_entries","water_logs","settings"] as const;
export const PULL_ONLY_TABLES = ["personal_records","tdee_snapshots","deload_blocks","streak_state",
  "streak_ledger","xp_ledger","achievement_unlocks","quests"] as const;
/** Carries 02's `syncCols()` but is deliberately NOT mirrored: `specs/15` writes it server-side
 *  during an import and the client never reads it. Named so "complete" is checkable. */
export const SYNCED_NOT_MIRRORED = ["import_batches"] as const;
export type MirrorTable = (typeof WRITABLE_TABLES)[number] | (typeof PULL_ONLY_TABLES)[number];
export const PULL_ONLY: ReadonlySet<MirrorTable>;      // = PULL_ONLY_TABLES
export const OP_SCHEMAS: Record<OpType, z.ZodType>;    // reject server-owned fields (Behaviour 26)
export const MAX_OPS_PER_BATCH = 50;                   // justified in Behaviour 39

export const OpEnvelope = z.object({
  id: z.string().length(26), seq: z.number().int().nonnegative(), kind: z.enum(OP_TYPES),
  entityTable: z.enum([...WRITABLE_TABLES, ...PULL_ONLY_TABLES]),
  entityId: z.string().min(1).max(64),
  clientRev: z.number().int().nullable(), updatedAt: z.number().int(),
  payload: z.unknown(),                                // = the local OutboxOp.payloadJson
});
/** No `.max()`: the handler counts `ops.length` BEFORE parsing and returns 413, so an over-long
 *  body is never indistinguishable from a malformed one (Behaviour 25). */
export const SyncBatchRequest = z.object({ deviceId: z.string().length(26),
  clientTimeMs: z.number().int(), ops: z.array(OpEnvelope).min(1) });

/** `applied` / `conflict` / `rejected` are `mutations.status` (02); `duplicate` replays a stored
 *  result; `skipped` was never inserted. */
export type OpResultStatus = "applied" | "duplicate" | "conflict" | "skipped" | "rejected";
export interface OpResult { opId: string; status: OpResultStatus; rev: number | null;
  row: WireRow | null; error: { code: string; message: string } | null }
export interface SyncBatchResponse { serverTimeMs: number; results: OpResult[] }  // results[i] ↔ ops[i]

export interface Cursor { ts: number; id: string }                 // keyset on (updated_at, id)
export interface SyncPullRequest { cursors: Partial<Record<MirrorTable, Cursor | null>>;
  limit: number /* 1..500, default 500 */ }
export interface SyncPullResponse { serverTimeMs: number;
  changes: Partial<Record<MirrorTable, WireRow[]>>;                // incl. tombstones
  cursors: Partial<Record<MirrorTable, Cursor | null>>; hasMore: boolean }
```

```ts
// src/lib/sync/wire.ts — the ONE conversion boundary (Behaviour 35). Both directions are pure.
/** camelCase keys, every instant an epoch-ms NUMBER, every boolean 0|1, `localDay` a
 *  'YYYY-MM-DD' string. No `Date`, no ISO-8601 string, ever. */
export type WireRow = Record<string, string | number | null | unknown[] | Record<string, unknown>>;
export function toWireRow(table: MirrorTable, row: Record<string, unknown>): WireRow;   // server
export function fromWireRow<T>(table: MirrorTable, wire: WireRow): Mirror<T>;           // client

// src/lib/sync/apply-local.ts
export async function writeLocal<T extends MirrorMeta>(args: { entity: MirrorTable; row: T;
  type: OpType; payload: unknown; blob?: Blob | undefined }): Promise<{ opId: string; seq: number }>;

// src/lib/sync/flush.ts — no DOM, no React: imported by the page AND by src/app/sw.ts
export interface FlushResult { attempted: number; applied: number; conflicts: number; dead: number;
  retryInMs: number | null;
  reason: "ok" | "empty" | "offline" | "transient" | "rateLimit" | "auth" | "blocked" }
export async function flushOutbox(opts?: { maxBatches?: number | undefined;
  signal?: AbortSignal | undefined }): Promise<FlushResult>;

// src/lib/sync/backoff.ts — pure
export const BACKOFF_BASE_MS = 2_000, BACKOFF_CAP_MS = 1_800_000;
export const POISON_ATTEMPTS = 24, POISON_AGE_MS = 86_400_000;   // 24 h — the rule that really bites
/** base(a) = min(BACKOFF_BASE_MS * 2**a, BACKOFF_CAP_MS); returned value is
 *  round(base * (0.8 + 0.4 * rng())), i.e. ±20 % jitter, and exactly `base` when rng() === 0.5. */
export function nextAttemptDelayMs(attempts: number, rng?: () => number): number;
export function isPoisoned(op: Pick<OutboxOp, "attempts" | "firstFailedAt">, nowMs: number): boolean;
export type FailureKind = "transient" | "permanent" | "auth" | "rateLimit";
export function classifyFailure(i: { status: number | null; code?: string | undefined }): FailureKind;
/** Parsed `Retry-After` (delta-seconds or HTTP-date), clamped to [1_000, 600_000]; 60_000 default. */
export function retryAfterMs(header: string | null, nowMs: number): number;

// src/lib/sync/cache-names.ts — imported by sw.ts AND by specs/04's logout()
export const OUR_RUNTIME_CACHES = ["r2-photos","exercise-media","reference-data"] as const;
export const VOLATILE_PAGE_CACHES = ["pages","pages-rsc","pages-rsc-prefetch","others"] as const;
export const DEFAULT_CACHE_NAMES: readonly string[];   // the 18 names in Behaviour 9's note
/** Built at RUNTIME from the constructed entries, never hard-coded — see Behaviour 10. */
export function cacheAllowlist(entries: RuntimeCaching[]): Set<string>;
export async function purgeVolatileCaches(): Promise<string[]>;   // returns the names deleted

// src/lib/sync/runtime.ts
export type SyncState = "synced" | "pending" | "syncing" | "offline" | "failed" | "blocked";
export function useSyncStatus(): { state: SyncState; pending: number; dead: number;
  lastSyncedAt: number | null; oldestPendingAt: number | null };
export async function requestPersistence(): Promise<boolean | null>;  // null = API absent
export async function getQuota(): Promise<{ usage: number; quota: number; ratio: number }>;
export async function evictBlobs(targetBytes: number): Promise<number>;   // returns bytes freed

// src/server/sync/apply-op.ts — one registry entry per op, so Behaviour 22's parent rule and
// Behaviour 39's budget are mechanical rather than prose.
export interface OpApplier<P> {
  schema: z.ZodType<P>;
  /** The entity ids this payload depends on. Behaviour 22 reads it; it is NOT optional. */
  parents(payload: P): string[];
  /** Declared read budget, ≤ 4. Behaviour 39 sums it before admitting the op. */
  reads: 0 | 1 | 2 | 3 | 4;
  apply(ctx: ApplyCtx, payload: P): Promise<{ statements: SQLStatement[]; row: WireRow }>;
}
export const OP_APPLIERS: { [K in OpType]: OpApplier<never> };

// src/server/sync/conflict.ts — pure. LWW on updated_at, tiebroken by rev (02 rule 3).
export function clampClientTime(clientMs: number, serverMs: number): number;  // [-365d, +300s]
export function resolvePatch(a: { storedUpdatedAt: number; storedRev: number;
  storedDeletedAt: number | null; incomingUpdatedAt: number; incomingClientRev: number | null;
  isDelete: boolean; isRestore: boolean }):
  { action: "apply" | "conflict"; reason: "newer" | "revTiebreak" | "stale" | "tombstoned" };
```

## Behaviour

### A. PWA shell

1. **Mode.** Serwist configurator mode (`@serwist/next/config` + `@serwist/cli`, both `9.5.12`),
   `swSrc: "src/app/sw.ts"`, `swDest: "public/sw.js"`. `@serwist/turbopack` is forbidden: its SW is a
   Worker-rendered route served with `Cache-Control: s-maxage=31536000`, unfixable by `_headers`
   (measured, `docs/research/r05-serwist-pwa-on-next16.md` §5c).
2. **BUILD ORDER — the footgun.** `opennextjs-cloudflare build` runs your `package.json` **build
   script**, then copies `public/*` into `.open-next/assets/*` (r05 §4a, §4c). So:
   `"build": "next build && cross-env NODE_ENV=production serwist build serwist.config.mts"` and
   `"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"`. Running `serwist build`
   **after** `opennextjs-cloudflare build` deploys an app with no `/sw.js` and prints no warning.
   `opennextjs-cloudflare build` must never appear inside `build` (recursion, r05 Gotcha 11).
3. `cross-env NODE_ENV=production` is load-bearing: under `NODE_ENV=development` esbuild's implicit
   define collapses `defaultCache` to one `NetworkOnly` route — the SW installs green and caches
   nothing (r05 Gotcha 1). Never pass `esbuildOptions.minify: false`.
4. `globIgnores` **must** include `public/_headers`, `public/_redirects`, `public/_routes.json`:
   Cloudflare 404s those paths and one 404 in the manifest throws `bad-precaching-response`, killing
   the whole install (r05 Gotcha 2).
5. **Precache list** = `.next/static/**` + every prerendered route's HTML (`precachePrerendered`,
   default true) + `public/**` minus the ignores +
   `additionalPrecacheEntries: [{ url: "/~offline", revision: <.next/BUILD_ID> }]`, with
   `maximumFileSizeToCacheInBytes: 2 * 1024 * 1024` stated explicitly. Exercise GIFs/videos live in
   R2 and are runtime-cached, never in `public/`.
6. **Every offline-reachable route must be prerendered (`○`).** The root layout may not touch
   `cookies()`, `headers()`, `searchParams`, `draftMode()` or an uncached `fetch`: a dynamic root
   layout leaves only `_global-error.html` prerendered, which Serwist ignores, so the manifest gets
   zero HTML and `/~offline` never enters it (r05 §6c). Consequences, all decided here rather than
   left open:
   (a) the locale is resolved **client-side** — both RU and EN message bundles ship to the client
   (~+12 KB gz, accepted); `next-intl`'s cookie / `getRequestConfig` path (r11) may not be used in
   the root layout, which is amendment 05→03.1 and must be carried by whichever of `specs/01` /
   `specs/03` ends up owning `next-intl` wiring;
   (b) Phase 0's `src/app/layout.tsx` **currently violates this** — it calls `getLocale()` from
   `next-intl/server`, which reads the locale cookie. Removing that call is part of this spec's edit;
   (c) the root layout ships `<html lang="ru">` (r05 §2d), so `src/components/i18n/locale-provider.tsx`
   sets `document.documentElement.lang` from `meta.locale` on mount and on every locale change.
   Without it every EN page declares Russian — a WCAG 3.1.1 failure, and a screen reader reading
   English with a Russian voice. Asserted in the a11y test (§Verification).
7. **`fallbacks` does not precache**, and its matcher must stay
   `({ request }) => request.destination === "document"` or the offline HTML is returned for failed
   JSON/image fetches. `navigateFallback` / `navigateFallbackDenylist` **do not exist** in
   `serwist@9.5.12`'s `SerwistOptions` (verified in `serwist/dist/index.d.mts`; the r05 §2c snippet is
   wrong) — `fallbacks.entries` is the whole mechanism.
8. **Route order.** The `Serwist` constructor calls `this.registerRoute(new PrecacheRoute(...))` before
   iterating `runtimeCaching` (verified in `serwist/dist/index.mjs`), and the router matches in
   registration order per method — so precached HTML beats every network strategy and prerendered
   routes are offline-first by construction. Our entries are spread **before** `...defaultCache` so
   they beat its `apis` entry.
9. **Runtime caching table.** `runtimeCaching: [...ourEntries, ...defaultCache]`.

   | Route class | Matcher | Strategy | Cache name | Expiration |
   |---|---|---|---|---|
   | App shell: prerendered HTML, `_next/static/**`, `public/**` | `PrecacheRoute` (auto, first) | precache, revisioned per BUILD_ID | `cacheNames.precache` — **never a literal** | pruned on `activate` |
   | User photos (R2) | `sameOrigin && /^\/api\/photos\//` | `CacheFirst` + `CacheableResponsePlugin({statuses:[200]})` + `RangeRequestsPlugin` + `ExpirationPlugin({maxEntries:240, maxAgeSeconds:2_592_000, purgeOnQuotaError:true})` | `r2-photos` | 240 entries / 30 d |
   | Exercise media (R2) | `sameOrigin && /^\/api\/media\//` | `CacheFirst`, statuses `[200]`, + `ExpirationPlugin({maxEntries:400, maxAgeSeconds:7_776_000, purgeOnQuotaError:true})` | `exercise-media` | 400 entries / 90 d |
   | Reference GETs (exercise catalog, OFF/USDA) | `sameOrigin && /^\/api\/reference\//` | `StaleWhileRevalidate` + `ExpirationPlugin({maxEntries:64, maxAgeSeconds:604_800, purgeOnQuotaError:true})` | `reference-data` | 64 entries / 7 d |
   | **All other `/api/*`**, incl. `/api/sync/*`, `/api/auth/*` | `sameOrigin && pathname.startsWith("/api/")` | `NetworkOnly` | — | — |
   | RSC prefetch payloads | `RSC:1` + `Next-Router-Prefetch:1` (default) | `NetworkFirst` | `pages-rsc-prefetch` | 32 / 24 h |
   | RSC payloads | `RSC:1` (default) | `NetworkFirst` | `pages-rsc` | 32 / 24 h |
   | Non-precached same-origin documents | default catch-all | `NetworkFirst` | `others`, `pages` | 32 / 24 h |
   | Static assets missed by the manifest | default regexes | `SWR` / `CacheFirst` | `static-image-assets`, `static-js-assets`, `next-static-js-assets`, `static-style-assets`, `static-font-assets`, `static-audio-assets`, `static-video-assets`, `static-data-assets`, `next-data`, `next-image` | 24 h – 720 h |
   | Cross-origin GET | `!sameOrigin` | `NetworkFirst` | `cross-origin` | 32 / 1 h |
   | Any non-GET | no route registered | passthrough to network | — | — |

   The three `ExpirationPlugin` entries above are **explicit and load-bearing**: without a plugin the
   quoted limits are decoration and `evictBlobs()` becomes the only bound on photo-cache growth.
   `ExpirationPlugin` is exported from `serwist` and is what `defaultCache` itself uses (verified:
   `node_modules/@serwist/next/dist/index.worker.mjs` imports and constructs it, 19 occurrences).
   `RangeRequestsPlugin` is **not** decoration either: `specs/10` rule 59 names this exact cache row
   and states that `206` + `Content-Range` support on `/api/photos/{id}/{variant}` is load-bearing
   *because* of it, so a range-capable strategy is required, not optional.

   **Default cache names, complete and verified** by enumerating `cacheName:` in the installed
   `node_modules/@serwist/next@9.5.12/dist/index.worker.mjs` (the three `pages*` names come from
   `PAGES_CACHE_NAME.{html,rsc,rscPrefetch}`, the other fifteen are string literals): `apis`,
   `cross-origin`, `google-fonts-stylesheets`, `google-fonts-webfonts`, `next-data`, `next-image`,
   `next-static-js-assets`, `others`, `pages`, `pages-rsc`, `pages-rsc-prefetch`,
   `static-audio-assets`, `static-data-assets`, `static-font-assets`, `static-image-assets`,
   `static-js-assets`, `static-style-assets`, `static-video-assets` — 18 names, which is
   `DEFAULT_CACHE_NAMES`. `google-fonts-*` stays empty because `next/font` self-hosts under
   `/_next/static/media`, but the names still belong in the allowlist.

   **Authenticated mutations are never cached:** `Route`'s `method` defaults to `GET` (verified in
   `serwist/dist/index.d.mts`), we register nothing for POST/PUT/DELETE, and Serwist's JSDoc is
   explicit — *"Without a default handler, unmatched requests will go against the network as if there
   were no service worker present."* Never call `setDefaultHandler(_, "POST")`. Authenticated
   *reads*, by contrast, **are** cached — which is why Behaviour 37 exists.
10. **The `activate` purge, and the bug it would otherwise be.** Our extra `activate` listener deletes
    `VOLATILE_PAGE_CACHES` unconditionally (RSC skew: precached HTML belongs to build *N* while
    `pages-rsc*` may hold payloads from build *N+1* referencing chunk hashes that HTML never loads),
    then deletes any cache absent from `cacheAllowlist([...ourEntries, ...defaultCache])`.

    **The allowlist is built at runtime and the precache name is never written as a literal.**
    `cacheAllowlist()` is `new Set([cacheNames.precache, cacheNames.runtime, ...entries.map(e =>
    typeof e.handler === "object" && "cacheName" in e.handler ? e.handler.cacheName : null)
    .filter(Boolean)])`. Verified: `cacheNames` and `setCacheNameDetails` are public exports of
    `serwist` (`dist/index.mjs` export list), `Strategy.cacheName: string` is a public instance
    property (`dist/chunks/types-BB8lYSAv.d.ts:222`), and every `defaultCache` entry's handler is a
    `Strategy` instance constructed with a `cacheName`.

    A literal would be **wrong, and wrong only in production**. Verified in
    `node_modules/serwist/dist/chunks/waitUntil-BDu76Zx7.js`: `_cacheNameDetails = { precache:
    "precache-v2", prefix: "serwist", suffix: typeof registration !== "undefined" ?
    registration.scope : "" }` and `_createCacheName` joins `[prefix, name, suffix]` with `-` after
    dropping empties. With `cacheId` unset (Behaviour 11) the real precache name is therefore
    `serwist-precache-v2-https://<host>/` — and `serwist-precache-v2` is absent from it. Hard-coding
    the short form puts the precache outside its own allowlist, so the first activation of every
    update deletes the offline shell and `/~offline`, silently, and passes in any harness where
    `registration.scope` is empty. `tests/unit/sync/cache-names.test.ts` asserts `cacheAllowlist()`
    contains `cacheNames.precache` and all 18 `DEFAULT_CACHE_NAMES`; the Playwright case asserts a
    key starting `serwist-precache-v2-` and a `caches.match("/~offline")` hit **after** an update.
11. `navigationPreload: false` (explicit): navigations are answered from the precache, so a preload is
    wasted mobile data. `cacheId` is not set; the names are read at runtime (Behaviour 10) rather
    than relied on as literals, so this stays a free choice.
12. **Serving `/sw.js`.** A static asset at the origin root, served by Cloudflare before the Worker, so
    max scope is already `/` and `SerwistProvider` already passes `scope: "/"`. `public/_headers` sets
    `Cache-Control: no-cache, no-store, must-revalidate` plus a redundant `Service-Worker-Allowed: /`;
    `headers()` in `next.config.ts` cannot reach it (r05 §5d, Gotcha 12).
13. **Update flow.** `skipWaiting: false`, `clientsClaim: false`; with `skipWaiting` falsy the Serwist
    constructor installs its own `{type:"SKIP_WAITING"}` `message` listener (verified in `index.mjs`).
    Phase 0 shipped both flags `true`, which makes the whole gate dead code — hence the CI grep in
    §Verification, because nothing about the failure is visible at runtime.
    `SwUpdateGate`: (a) reads `navigator.serviceWorker.getRegistration()` on mount and treats a
    non-null `reg.waiting` as "update ready" — an event-only approach misses an already-waiting SW,
    because `SerwistProvider` registers inside its `useState` initialiser, before effects attach;
    (b) also listens to `window.serwist.addEventListener("waiting", …)`; (c) calls
    `window.serwist.update()` on `visibilitychange → visible`, max once per 60 min;
    (d) **suppresses the prompt while `meta.workoutActive === true`** — that key is in the documented
    `meta` set (`MetaRow`) and is written by `specs/06` rule 1 at session start, which already names
    this rule as its reader; this spec only reads it, and reads a missing key as `false`;
    (e) on tap calls `messageSkipWaiting()` and
    reloads on `"controlling"`. `reloadOnOnline={false}` — the default `true` reloads on every
    `online` event, discarding in-progress set entry (r05 Gotcha 5).
14. **`/~offline`** is static and **inlines both locale bundles** (`import ru from
    "@/../messages/ru.json"` and the EN equivalent, resolved at build time — no request-time API, no
    `getTranslations()`), because the page that must work with no network cannot fetch a message
    bundle. A client component picks the bundle from `meta.locale`, falling back to `ru`, renders the
    wordmark on OLED black, the copy ("Нет сети — данные сохраняются на устройстве" / "No network —
    your data is saved on this device"), the unsynced count read from Dexie, and a retry button
    ("Повторить" / "Retry") calling `location.reload()`. The Files table row says the same thing; the
    earlier "RU-only" wording is gone.
15. **Manifest & icons.** `src/app/manifest.ts` → `/manifest.webmanifest`; Next emits the
    `<link rel="manifest">` itself, so do **not** also set `metadata.manifest` (r05 §7b).
    `display:"standalone"` (required for iOS web push), `start_url:"/"`, `scope:"/"`,
    `background_color`/`theme_color` `#000000`, `lang:"ru"`, `prefer_related_applications:false`, and
    **separate `any` and `maskable` entries at 192 and 512** — the shipped file has a single maskable
    at 512 and no maskable 192. `viewport: { viewportFit:"cover", themeColor:"#000000" }`;
    `appleWebApp: { capable:true, statusBarStyle:"black-translucent", title:"Форма" }`;
    `metadata.icons.apple` → `public/icons/apple-touch-icon.png` (180×180, opaque) so the href
    carries no content-hash query. Never hand-write `apple-mobile-web-app-capable`.
16. **Listener order in `src/app/sw.ts`:** our `sync`, `message`, `activate` (and spec 14's `push`,
    `notificationclick`) listeners are added **before** `serwist.addEventListeners()`, per its JSDoc:
    *"Before calling it, add your own listeners should you need to."*

### B. Sync engine

17. **Dexie database `fit`**, one instance in `src/db/local.ts`, implementing the store layout
    `specs/02-data-model.md` §Data declares. v1:

    ```
    mirror: "[table+id], table, [table+updatedAt], [table+localDay]"
    outbox: "++seq, &id, status, [status+nextAttemptAt], [entityTable+entityId], createdAt"
    blobs:  "key, uploaded, createdAt"
    meta:   "&key"
    ```
    One generic `mirror` store, not one store per entity: a new feature adds rows, not a schema
    version. Rows are `MirrorRow<T>` where `T` is the D1 row under its camelCase TS keys, converted
    at exactly one boundary — see Behaviour 35, which is what makes the two compound indexes
    `[table+updatedAt]` (numeric) and `[table+localDay]` (string) actually populate. Two declared
    refinements of 02's sketch, both load-bearing: `outbox`'s PK is `++seq` with `&id` kept unique,
    because the ordering guarantees in 22 need a monotonic key that a corrected device clock cannot
    move; and `blobs` is added for offline photo bytes (02 lists no blob store).
    **Versioning is additive only** — a new store or index needs a new `db.version(n).stores({...})`,
    plus `.upgrade(tx => …)` when data must be rewritten; never rename a store in place (add the new
    one, copy in `upgrade`, drop the old with `{ old: null }`). Dexie ≥ 3 needs only the newest
    `stores()` for a fresh database, but the whole ladder stays in the file so an upgrade from any
    installed version works. `meta.schemaVersion` is asserted on open.
    `db.on("versionchange")` closes the connection and shows "Перезагрузите приложение";
    `db.on("blocked")` shows "Закройте другие вкладки".
18. **Write path.** Feature code never touches the network. `writeLocal()` runs one Dexie `rw`
    transaction over `["mirror","outbox","blobs"]`: **read the existing mirror row first and keep it
    as the op's `prevJson`** (`null` when there is none), upsert the mirror row with `dirty:1`,
    `updatedAt: Date.now()`, unchanged `rev`; store the blob if present (rejecting anything over
    `MAX_BLOB_BYTES`); `outbox.add()` with `status:"pending"`, `attempts:0`, `firstFailedAt:null`,
    `nextAttemptAt:0`. Any `local_day` in the payload is computed by `toLocalDay()` on the device,
    never derived server-side (02 rule 5, r02 §2.8). The UI re-renders from `useLiveQuery`, so the
    screen updates before the transaction settles — no spinner, no duplicated optimistic state in
    React. The op `id` is a ULID minted once, here, and reused for every retry forever: it **is**
    `mutations.id`, the idempotency key.
19. **`seq`** is Dexie's `++` auto-increment PK: monotonic, never reused, assigned inside the
    transaction, surviving reload. It orders ops within one device only; cross-device order is the
    server's arrival order.
20. **Flush triggers.** Background Sync is Chrome/Edge/Samsung only — Firefox and **all of Safari,
    including iOS, do not implement `SyncManager`** (MDN BCD `api/SyncManager.json`: Chrome 49,
    Firefox ✗, Safari ✗), so it is an optimisation, never the mechanism. All triggers: (a) 250 ms
    debounce after any enqueue while `navigator.onLine`; (b) `window online`;
    (c) `visibilitychange → visible`; (d) `window focus`; (e) `pageshow` (iOS BFCache restore);
    (f) a 30 s interval, only while the document is visible and the outbox is non-empty;
    (g) `registration.sync.register("fit-outbox")` after every enqueue when `"sync" in registration` —
    Chrome fires it only for a site that has had a window open, and retries it itself: *"If it fails,
    another sync is scheduled to retry. Retry syncs also wait for connectivity and employ an
    exponential back-off."*
21. **Claim / lease.** `claimBatch()` takes ops in ascending `seq` where `status==="pending" &&
    nextAttemptAt <= now`, or `status==="inflight" && leaseUntil < now` (crash recovery), caps at
    `MAX_OPS_PER_BATCH`, stops the prefix at the first `photo.*` op (Behaviour 36), and flips them to
    `inflight` with `leaseUntil = now + 60_000` in one Dexie transaction. The cap is a client-side
    invariant, so a `413` from the server can only ever mean a client bug — it is asserted in the
    outbox unit test. `navigator.locks.request("fit:flush", { ifAvailable: true }, …)` is used when
    present (Chrome 69 / Firefox 96 / Safari 15.4) only to avoid duplicate requests; the lease plus
    server idempotency is the real protection.
22. **Ordering guarantees.** The client always sends a contiguous ascending-`seq` prefix in one
    request; the server applies `ops[]` strictly in array order. When an op fails, every later op in
    the batch with the same `entityTable+entityId`, **or whose `OP_APPLIERS[kind].parents(payload)`
    names that id**, returns `skipped` and stays `pending`; unrelated ops still apply. `parents()` is
    a required registry member precisely so this rule has an implementation surface rather than being
    prose — e.g. `set.create` returns `[payload.workoutId, payload.workoutExerciseId,
    payload.exerciseId]`. A child op whose parent row is missing returns `skipped` with
    `code:"parent_missing"` — the server never auto-creates a parent stub.
23. **Per-op result handling.** `applied`/`duplicate` → `fromWireRow()` the `result.row` over the
    mirror row, set `rev`, clear `dirty` (only when no newer op for that row is queued), delete the
    outbox row, mark the blob `uploaded:1`. `conflict` → replace the mirror row with the server row,
    delete the op, show the "Сохранена более новая версия" toast. `skipped` → back to `pending`,
    `attempts` unchanged (this is also the `202` case for photo ops, `specs/10` rule 48).
    `rejected` → `dead` with `lastError` and `deadCode:"rejected"`, **and** the terminal-state
    cascade of Behaviour 38 runs.
24. **Retry & poison cap.** `attempts` increments only on a server-acknowledged `transient` failure
    (5xx, 408, timeout after a connection), never while `navigator.onLine === false`, and never for
    `rateLimit` — offline time and self-inflicted throttling must not consume the budget.
    `firstFailedAt` is stamped on the first such increment and never cleared except by a manual
    retry.
    `nextAttemptDelayMs(a) = round(min(2_000 * 2**a, 1_800_000) * (0.8 + 0.4 * rng()))` → 2 s, 4 s,
    8 s …; with zero jitter (`rng = () => 0.5`) the sequence is exact, `9 → 1_024_000`, and the
    30-minute cap **first binds at `a = 10`** (`2_000 * 2**10 = 2_048_000 > 1_800_000`). The earlier
    "`9 → 1800000`" vector was arithmetically wrong.
    An op becomes `dead` when `isPoisoned()`: `attempts >= POISON_ATTEMPTS (24)` **or**
    `now - firstFailedAt > POISON_AGE_MS (24 h)`. `POISON_ATTEMPTS` was 8, which meant ~8.5 min of
    cumulative backoff: a 20-minute D1 incident converted a whole synced-pending workout into `dead`
    ops needing per-op manual resolution, and made the 30-minute cap unreachable dead code. At 24 the
    cumulative sleep is ≈ 7.6 h, so the **24-hour elapsed-time rule is the one that actually fires** —
    a platform outage no longer kills a gym session, and a genuinely broken op still dies within a day.
    `classifyFailure`: 401/403 → `auth` (the whole flush pauses, no attempt counted, re-login banner);
    408/5xx/network → `transient`; **429 → `rateLimit`**; 400/409/422 and any `rejected` →
    `permanent` → immediately `dead`; **413 → `transient`**, deliberately, because 413 can only come
    from a client bug over-filling a batch and a `permanent` classification would mass-kill 51 ops.
    **`rateLimit` semantics, stated in full:** `attempts` does not increment, `firstFailedAt` is
    untouched, `nextAttemptAt = now + retryAfterMs(response.headers.get("Retry-After"), now)`, the
    flush returns `reason:"rateLimit"`, and `useSyncStatus()` reports `pending` — never `failed`,
    because nothing has failed. A `dead` op is never retried automatically and never deleted without a
    user action.
25. **Batch endpoint** `POST /api/sync/batch`, gated by `requireSessionOr401()`
    (`specs/04-auth.md`); the SW's `fetch()` carries the session cookie because the request is
    same-origin — `__Host-fa_session` over https, `fa_session` over http (04 rule 6; getting this
    wrong is why §Verification mints the cookie with a documented command instead of guessing the
    name). Order of operations per request:

    1. `checkRateLimit(env.SYNC_LIMITER, "sync:" + deviceId, request)` — 01's mechanism
       (`src/server/rate-limit.ts`), over one new `ratelimits[]` entry `SYNC_LIMITER {limit:60,
       period:60}` (amendment 05→01.1). A `429` carries `Retry-After`. **No KV counter**: KV is
       eventually consistent with a ~1 write/s-per-key ceiling, `specs/04` line 382 forbids
       security-relevant KV state outright, and it would cost 2 KV ops per batch.
    2. `ops.length > MAX_OPS_PER_BATCH` → **`413` before Zod runs**, so an over-long body is never
       reported as a malformed envelope. `SyncBatchRequest` therefore carries `.min(1)` and no
       `.max()`.
    3. Zod-parse the envelope; a failure is `400`.
    4. Admit ops against the query budget of Behaviour 39.

    Then, per op, in order: `SELECT status, result_json FROM mutations WHERE id = ?` → **if found,
    return it as `duplicate` without re-running side effects** (02 rule 3); else validate against
    `OP_APPLIERS[kind].schema`, run `apply()`, and write the domain statements **and** the `mutations`
    row in a single `db.batch([...])`, with the `mutations` PK as the race backstop for the
    page-flush/SW-flush overlap Behaviour 21 tolerates. If that batch fails **on the `mutations` PK
    conflict specifically**, it is retried exactly once as a read-and-replay (step 1 again) and
    returned as `duplicate`; it is never surfaced as an error. This ordering is the fix for the
    earlier text, which said both "insert first to detect the duplicate" and "insert inside the
    atomic batch" — mutually exclusive, because `db.batch()` is atomic and its own insert would
    conflict and roll the whole op back.
    `mutations.client_rev` is NOT NULL in 02, while a create has no base revision, so the applier
    writes `op.clientRev ?? 0`; `0` is unambiguous because 02's `rev` starts at 1, and `resolvePatch`
    treats incoming `0` and `null` identically. No amendment to 02 is needed for this.
    D1 has no transactions — `db.transaction()` compiles and fails at runtime (r02 §4.6) — so
    `db.batch()` is the only atomic unit, and putting the idempotency row inside it is what makes
    "recorded as applied" and "applied" inseparable. Budgets: ≤ 100 bound parameters per statement
    (r02 §4.7), the per-op limits of Behaviour 39, 30 s CPU per request (`stack-facts.md`); never
    `db.batch([])` (r02 §4.8). Responses: `200` with per-op results even when some ops fail; `401`
    unauthenticated; `400` malformed envelope; `413` > 50 ops; `429` + `Retry-After`; `503` on D1
    failure.
26. **Server-authoritative fields.** `is_pr`, e1RM, `personal_records`, XP, level, streaks,
    achievements, adaptive TDEE and `rev` are computed server-side and returned in `result.row`;
    the client never sends them and `OP_SCHEMAS` reject them when present. The client may show a
    **provisional** PR badge (`prProvisional:1`, formulas in `specs/06-workouts.md` /
    `docs/research/r09-formulas-and-test-vectors.md`); it renders in the unconfirmed style named in
    §UX notes, and when the canonical row disagrees the badge is cleared silently — confetti already
    shown is never retracted, and no "not actually a PR" message is produced.
27. **Conflict policy.** Workout logs are append-only, so creates cannot conflict: a create for an
    existing client-minted ULID is a `duplicate` no-op. For the edit surfaces (`*.patch`) the rule is
    02 rule 3 — **last-write-wins on `updated_at`, tiebroken by `rev`, per row (never per field)** —
    applied to the patched columns only. The incoming `updated_at` is the **origin device's clock**,
    clamped by the server to `[serverNow − 365 d, serverNow + 300 s]`; if it is greater than the
    stored `updated_at` (or equal with `clientRev >= storedRev`) the patch applies and `rev` is
    incremented; otherwise nothing is written and the op returns `conflict` plus the canonical row.
    Appliers write the clamped client `updated_at` **explicitly** — never leaning on 02's
    `unixepoch() * 1000` column default, which would overwrite the origin timestamp the comparison
    depends on. `mutations.received_at` is the server clock and is the only server-clock column here.

    **Where the loser's payload lives.** 02's `mutations` has no payload column, and adding one is a
    breaking change to a table this spec does not own, so `result_json` carries both shapes under one
    fixed envelope and nothing else changes:
    `{ kind: "result", canonical: { status, rev, row, error } }` for `applied` / `rejected`, and
    `{ kind: "conflict", canonical: { status:"conflict", rev, row, error:null }, incoming: <the
    rejected payload> }` for a loser. A `duplicate` replays **only the `canonical` member**, verbatim.
    `settings/sync` reads `incoming` for its human sentence, which is what 02 rule 3's "05 can surface
    it" promised. Both shapes fit 02's `C(length(result_json) <= 65536)` — an op payload plus one row
    is ~2 KB; an applier that would exceed it returns `rejected` with `code:"result_too_large"`
    rather than writing a row the CHECK will refuse.

    Per-field LWW is deliberately not implemented: it needs a timestamp per column in D1 and buys
    nothing here, because patches are small and the conflicting surfaces (a note, a corrected
    weight/reps, a measurement) are single-purpose. **Deletes are terminal and win regardless of
    timestamp**: `*.delete` sets `deleted_at` (soft delete is 02 rule 25, so tombstones reach the
    other device) and a concurrent `*.patch` returns `conflict`. Undelete needs an explicit
    `*.restore` whose `updated_at` exceeds the stored `deleted_at`, else `conflict`.
28. **Pull.** `POST /api/sync/pull` (POST, so the SW can never cache it) takes a per-entity keyset
    cursor and returns rows where `updated_at > ts OR (updated_at = ts AND id > :id)` ordered by
    `(updated_at, id)` (the shape 02 rule 3 fixes), ≤ 500 rows per entity, tombstones included, every
    row passed through `toWireRow()` (Behaviour 35). The cursor needs a **composite** index
    `(updated_at, id)` per mirrored table; 02's P12 currently specifies `<t>_updated_at_idx` on
    `updated_at` alone, so widening it is amendment 05→02.1 — the one D1 change this spec asks for.
    `applyServerRows()` writes each row into Dexie **unless** the local row is `dirty` with a newer
    `updatedAt` — a queued local edit wins until its own op resolves. Pull runs on cold start,
    on `online`, after a successful flush, on a `{type:"sync"}` push (`specs/14`), otherwise at most
    once per 60 s. First-ever hydration pulls the last 180 days and sets `meta.hydration="partial"`,
    then pages the remainder in the background and sets `"full"`.
29. **Persistence, with per-platform support stated rather than assumed.** `requestPersistence()`
    calls `navigator.storage.persist()` — MDN: it *"requests permission to use persistent storage,
    and returns a `Promise` that resolves to `true` if permission is granted"*; it is secure-context
    only and **not available in Web Workers**, so it runs on the page: once after the first completed
    workout, and on every cold start while `persisted()` is false.
    Support, **verified against MDN BCD `api/StorageManager.json` on `main`, 2026-09-12**:
    `persist` and `persisted` are `chrome 55`, `firefox 57`, **`safari 15.2`**, with
    `chrome_android` / `firefox_android` / `safari_ios` / `edge` all `"mirror"` and no
    `partial_implementation` or notes. So the API **does exist on the iPhone this spec targets** —
    but Safari grants persistence on its own heuristics and gives no prompt, so a `false` result is
    normal and must not read as a failure. `requestPersistence()` therefore returns
    `boolean | null` (`null` = API absent), caches both the availability and the result in
    `meta.persistApiAvailable` / `meta.persisted`, shows them in `settings/sync`, and never blocks.
    The **second, independent** iOS mitigation — and the load-bearing reason for the install hint —
    is WebKit's own exemption from the seven-day cap on script-writable storage, quoted verbatim from
    <https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/>: the cap is
    *"deleting all of a website's script-writable storage after seven days of Safari use without user
    interaction on the site"*, while *"Web applications added to the home screen are not part of
    Safari and thus have their own counter of days of use"*, *"Their days of use will match actual use
    of the web application which resets the timer"*, and *"We do not expect the first-party in such a
    web application to have its website data deleted."* A Home-Screen-installed app used regularly is
    therefore not subject to the seven-day sweep at all. (The earlier attribution of this to
    `r06 §6.1` was wrong — r06 §6.1 covers Web Push only.)
30. **Retention & eviction.** Mirror rows are kept indefinitely (a year of single-user logs is a few
    MB). A blob is deleted once its `photo.upload` op is acked; a blob whose op is still `pending` or
    `dead` is never evicted. On cold start and after every flush, `getQuota()`: at `ratio > 0.85` →
    `evictBlobs()` oldest-uploaded-first down to 100 MB, then purge `r2-photos` and `exercise-media`;
    at `ratio > 0.95` → a persistent warning row in `settings/sync`. An op still `pending` after 14
    days becomes `dead` with `deadCode:"expired"`. `mutations` is **never** pruned (02 rule 25 lists
    the only six hard-delete sites and this is not one), so the server's idempotency window is
    unbounded and always outlives the client's 14-day op TTL.
31. **Unsynced badge.** `useSyncStatus()` derives, in priority order: `dead > 0` → `failed` (amber dot
    + count, tap → `settings/sync`); Dexie blocked → `blocked`; `!navigator.onLine && pending > 0` →
    `offline` (cloud-slash + count); `inflight > 0` → `syncing`; `pending > 0` → `pending` (count);
    else `synced`, which renders **nothing** — no green tick for the normal case. This resolves the
    earlier open question about always-on chrome in favour of invisibility: speed of logging above all.
32. **Permanent-failure UX.** `settings/sync` lists every `dead` op newest-first with a human sentence
    ("Подход 3 × 100 кг, 12 окт"), the `deadCode`, and three actions: **Повторить** (`attempts = 0`,
    `firstFailedAt = null`, `status = "pending"`, applied to the whole group of Behaviour 38),
    **Открыть запись** (deep link), **Отклонить** (destructive confirm).
    **Отклонить is now buildable, which it previously was not.** It restores `prevJson` (Behaviour 18)
    into the mirror row with `dirty:0`, or deletes the mirror row entirely when `prevJson === null`;
    it then discards every **later** queued op for the same `entityTable+entityId`, because those
    were composed against the state being thrown away, and the row it restores is the `prevJson` of
    the **earliest** discarded op. Nothing here needs a server read, which matters because dead ops
    are most likely to be resolved while still offline. The previous wording — "revert the mirror row
    to its `rev` state" — had no mechanism: `rev` is an integer, not a row.
    Dead ops stay counted in the badge until resolved.
33. **SW-side flush.** The `sync` handler runs the same `flushOutbox()`. It opens Dexie with a 5 s
    timeout; if the open is `blocked` (an older page holds an older schema) it resolves the event and
    `postMessage({type:"FLUSH_NOW"})` to all clients instead of failing. The handler rejects only for a
    `transient` failure when `!event.lastChance`, so the browser retries with its own back-off; on
    `lastChance`, a `rateLimit`, or a permanent failure it resolves.
34. **Two-device traceability.** `deviceId` (ULID in `meta`, minted on first run) accompanies every
    batch and keys `SYNC_LIMITER`; `mutations` itself has no device column (02), so divergence is
    traced through `mutations.received_at` + `entity_table`/`entity_id`. Ops are never replayed to
    another device — the pull path carries rows, not ops.
35. **The wire-row contract — one boundary, stated once.** 02 says DB names are snake_case with
    camelCase TS keys (rule 4 area) and that instants are `integer({mode:"timestamp_ms"})`
    *"surfaced as `Date`"* (rule 4). So Drizzle hands a route handler `updatedAt: Date`, and
    `JSON.stringify` emits that as an **ISO-8601 string** — while `MirrorMeta.updatedAt` is a
    `number` and is simultaneously the LWW basis, the pull cursor and the Dexie index
    `[table+updatedAt]`. Left unstated, the first ack writes strings into a numeric index and every
    later LWW comparison compares a string to a number. 02's §Data line *"a row crosses the boundary
    untransformed"* is therefore refined here, not contradicted: same **names**, one shape change.

    The contract:
    - keys are **camelCase** — the Drizzle TS keys, identical to `MirrorRow`'s;
    - every instant (`createdAt`, `updatedAt`, `deletedAt`, `completedAt`, `takenAt`, …) is an
      **epoch-ms number**, never a `Date`, never an ISO string;
    - `deletedAt` is retained as `number | null`; `deleted: 0 | 1` is derived from it client-side and
      is never sent;
    - booleans are `0 | 1`;
    - `localDay` and every `_day`/`_on` column stay `'YYYY-MM-DD'` strings, so `[table+localDay]`
      populates;
    - JSON columns arrive already parsed (02 rule 6's `parseJson` runs server-side);
    - `rev` is `number | null` — `null` only for `settings`.

    The **only** two functions that change a row's shape are `toWireRow()` (server: Drizzle row →
    wire, used by both the batch results and pull) and `fromWireRow()` (client: wire → mirror row).
    Every `OP_APPLIERS[kind].apply()` returns its row through `toWireRow()`; Behaviour 23 and
    `applyServerRows()` both go through `fromWireRow()`. `tests/unit/sync/wire.test.ts` asserts
    round-tripping, that `typeof row.updatedAt === "number"` on both sides, and that no value in a
    wire row is a `Date` or matches `/^\d{4}-\d{2}-\d{2}T/`.

    **The `settings` exception, named rather than papered over.** `settings` is mirrored and writable
    (`settings.patch`) but it is 02's shipped `core.ts` row keyed by `user_id` with `updated_at` and
    **no `rev` and no `deleted_at`** — it does not carry `syncCols()`. So for `settings` alone:
    `rev` is permanently `null`, `clientRev` is always `null`, LWW is on `updated_at` with no
    tiebreak, `entityId` is `"me"` (02's `APP_USER_ID`), and there is no delete or restore op. This
    is why the op list is enumerated explicitly instead of being described as "every table carrying
    `syncCols()`" — that description was false in both directions.
    `tests/unit/sync/mirror-tables.test.ts` asserts
    `new Set([...WRITABLE_TABLES, ...PULL_ONLY_TABLES, ...SYNCED_NOT_MIRRORED])` equals the set of
    `getTableName(t)` over every table exported from `@/db/schema` whose columns include `rev`,
    `updated_at` **and** `deleted_at`, plus the single assertion that `settings` is in
    `WRITABLE_TABLES` and absent from that derived set. A new synced table in 02 fails this test
    until it is classified here.
36. **Photo bytes: the out-of-band transport, accepted from `specs/10`.** An 8 MiB `Blob` cannot ride
    an `application/json` array, so `photo.upload` and `photo.delete` **bypass `/api/sync/batch`**
    entirely. `specs/10` rule 48 defines the transport and calls it amendment 05.1; this behaviour is
    05 registering it, so the seam belongs to somebody:
    - `src/lib/sync/flush.ts` calls `dispatchPhotoOp` from `src/lib/photos/dispatch.ts` (`specs/10`)
      for any op whose `kind` starts `photo.`. One HTTP request per op, in `seq` order, interleaved
      with the JSON batches.
    - `claimBatch()` **stops its contiguous prefix immediately before** a `photo.*` op, and a photo op
      is dispatched **alone**: it never shares a request and never counts against
      `MAX_OPS_PER_BATCH`. `maxBatches` still bounds the loop, so a flush on gym LTE dispatches at
      most one multi-MB upload per iteration and the JSON ops behind it are not held hostage.
    - Status → outcome, `specs/10` rule 48's mapping, which is exactly this spec's vocabulary:
      `200`/`201` → `applied`; **`202` → `skipped`** (display row not there yet — back to `pending`,
      `attempts` unchanged, never a death); `401`/`403` → `auth`; `408`/`429`/`5xx`/network →
      `transient`/`rateLimit` per `classifyFailure`; `400`/`409`/`413`/`415`/`422` → `rejected` →
      `dead`.
    - **There is no "PUT succeeded but the batch failed" split**, because the byte upload *is* the op's
      apply: the same request that stores the object returns the canonical `photos` row, and the ack
      of Behaviour 23 runs on that response. A failed request leaves the blob and the op `pending`,
      so the bytes are never lost.
    - Idempotency needs the route's cooperation: `dispatchPhotoOp` sends `X-Mutation-Id: op.id` and
      `specs/10`'s handlers must write the `mutations` row under it (amendment 05→10.1). Without that
      a replayed `photo.upload` would create a second object; `photos.r2_key` being UNIQUE and the id
      being client-minted (02 rule 1) makes the failure a loud `409` rather than silent duplication,
      but a `duplicate` is the correct answer and only the `mutations` row gives it.
    - Ceiling: `MAX_BLOB_BYTES = 8 * 1024 * 1024`, enforced at `writeLocal()` so the client never
      queues bytes the server will `413`. It is `specs/10`'s own measured gate, not a new number.
37. **Logout and revocation purge the caches.** This spec owns every cache name, and `pages`,
    `pages-rsc`, `pages-rsc-prefetch`, `others` and `reference-data` are `NetworkFirst`/`SWR` caches
    of **authenticated GET responses** — "authenticated mutations are never cached" (Behaviour 9) is
    true and beside the point. So:
    - `specs/04`'s `logout()` (both plain and `?everywhere=1`) calls
      `purgeVolatileCaches()` from `src/lib/sync/cache-names.ts`, which deletes every name in
      `VOLATILE_PAGE_CACHES` plus `reference-data`, and `specs/10`'s `purgeR2PhotoCache()`, which
      clears `r2-photos` (already written as 10's amendment 04.1). `exercise-media` is public
      reference imagery and survives.
    - The same purge runs when the client detects a `session_version` mismatch — a `401` whose
      `details.reason` is `stale_version` (04 rule 10) — because that is a revocation the user did not
      initiate on this device.
    - **The Dexie mirror, `outbox` and `blobs` survive logout, deliberately.** This is a single-user
      app: the only identity that can log back in is the same one, and discarding an unflushed outbox
      would throw away exactly the gym data this spec exists to protect. Logout does not clear
      IndexedDB, does not cancel queued ops, and leaves blobs in place; the flush simply pauses on
      `auth` (Behaviour 24) until the session returns. The accepted consequence is 04 rule 27's, in
      its own words: locally cached data is readable by anyone holding the unlocked device.
      `resetLocalDb()` exists for a deliberate "forget this device" action in `settings/sync`, which
      warns about the pending count before running and is the only path that destroys local data.
38. **Terminal states cascade; nothing livelocks.** A `skipped` child whose parent has gone `dead`
    would otherwise be re-sent on all six flush triggers for 14 days, be counted as `pending` by
    `useSyncStatus()`, and never appear in `settings/sync` (which lists only `dead` ops) — a
    permanently non-zero badge with no explanation and no available action. So when an op becomes
    `dead`, `killGroup()` immediately marks every queued op whose `parents(payload)` names that op's
    `entityId`, and transitively their children, `dead` with `deadCode:"parent_dead"` and the parent's
    op id in `lastError`. `settings/sync` renders the group as one row with one Повторить and one
    Отклонить, so a whole failed workout is resolvable in a single action.
39. **The per-request D1 query budget, with the arithmetic shown.** Per op: **≤ 1** `mutations`
    duplicate-check read, **≤ 4** applier reads (`OP_APPLIERS[kind].reads`, a declared number —
    `specs/06`'s PR appliers really do read current-best-per-exercise and promote `is_current`), and
    **≤ 10** statements in the `db.batch()` (≤ 9 domain + the 1 `mutations` insert). That is ≤ 15
    queries per op. `50 × 15 = 750`, plus one session read, is **751 against r02 §2.7's hard ceiling
    of 1000 queries per Workers-Paid invocation** — 249 to spare for the 503 path and logging.
    That arithmetic is also the justification for `MAX_OPS_PER_BATCH = 50`, which previously had
    none: it is the largest round number that fits the 1000-query ceiling at the worst-case per-op
    budget, and it is comfortably more than one finished workout (1 `workout.create` + ~6
    `workoutExercise.create` + ~30 `set.create` + 1 `workout.patch` ≈ 38 ops), so a whole session
    flushes in one request.
    A server-side counter enforces it rather than trusting the arithmetic: at
    `MAX_QUERIES_PER_REQUEST = 900` the handler stops admitting ops and returns every remaining one as
    `skipped` with `code:"budget_exhausted"` — which the client already handles (back to `pending`,
    `attempts` unchanged, no cascade, because this is not a parent problem). An applier declaring
    `reads > 4` or emitting > 10 statements fails a unit test in `specs/16`'s registry conformance
    check, not in production.

## Data

D1 — all definitions are `specs/02-data-model.md`'s; nothing here redefines them. Written:
`mutations` (the idempotency ledger: `id` PK = the op ULID, `kind`, `entity_table`, `entity_id`,
`client_rev` **NOT NULL — written as `op.clientRev ?? 0`, Behaviour 25**, `received_at`, `applied_at`,
`status ∈ {applied,conflict,rejected}`, `result_json` carrying the two-shape envelope of
Behaviour 27) plus, via `OP_APPLIERS`, the 17 tables in `WRITABLE_TABLES`. Read for pull: those plus
the 8 server-owned tables in `PULL_ONLY_TABLES`. `import_batches` carries `syncCols()` but is neither
mirrored nor writable (`SYNCED_NOT_MIRRORED`); `settings` is writable and mirrored but carries only
`updated_at` — the exception Behaviour 35 spells out. The three columns this module depends on are in
02's `syncCols()`: `updated_at` (epoch ms, the LWW basis and pull cursor), `rev` (integer, the LWW
tiebreak), `deleted_at` (tombstone). The pull cursor needs a **composite** `(updated_at, id)` index
per mirrored table; 02's P12 specifies `updated_at` alone, so widening it is the single D1 addition
this spec requests (amendment 05→02.1).

KV: **none.** Rate limiting uses 01's `ratelimits` binding `SYNC_LIMITER` via `checkRateLimit()`
(amendment 05→01.1), not a KV counter — see Behaviour 25.
R2: none directly — `specs/10` owns photo objects; this module only queues the bytes and hands them
to `dispatchPhotoOp`.
IndexedDB (`fit`): the stores in Behaviour 17 (`mirror`, `outbox`, `blobs`, `meta`).
Cache Storage: `cacheNames.precache` and `cacheNames.runtime` (runtime values, never literals — the
precache resolves to `serwist-precache-v2-<registration.scope>`), our three
(`r2-photos`, `exercise-media`, `reference-data`), and the 18 `DEFAULT_CACHE_NAMES` listed in
Behaviour 9. The allowlist is computed by `cacheAllowlist()` in `src/lib/sync/cache-names.ts`; the
literal list exists only so CI can assert the installed `@serwist/next` still ships those names.

## UX notes

- The sync chip sits at the right edge of the bottom tab bar, inside the one-handed thumb arc —
  never a top-right badge. `role="status" aria-live="polite"`, RU/EN labels, `aria-atomic` count.
- Nothing about syncing ever blocks a tap: no modal, no full-screen spinner, no success toast. The
  only sync toast is `conflict` ("Сохранена более новая версия", 4 s, no undo).
- **A provisional PR badge always looks provisional.** The *celebration* is unchanged and fires
  immediately offline — `specs/03` rule 16's `fire()` → `haptic("pr")` → `variants.prBadge` pop, which
  `specs/06` rule 29 calls the provisional celebration. A moment is not a claim, so the *persistent*
  badge on the set row differs: while `prProvisional === 1` it renders as a 1 px `--lime-600` outline
  on a transparent fill with `--lime-600` text (7.73:1 on `#000000`, 03's measured contrast table)
  instead of 03 rule 16's solid lime fill, with `aria-label` "Рекорд не подтверждён" / "Record not yet
  confirmed". On ack it fills solid, silently; if the server disagrees it disappears with no toast and
  the confetti already shown is never retracted (Behaviour 26). Without this the user cannot tell a
  confirmed PR from a guess, and a PR that quietly vanishes reads as a bug — which the brief's honesty
  principle forbids.
- Haptics: none for sync, with one exception — a single light tick when the last op of a finished
  workout acks while the summary sheet is open. Sync must not compete with the PR haptic.
- The update prompt is a non-modal bar anchored above the tab bar, swipe-down dismissible, fully
  suppressed while `meta.workoutActive` is true.
- `settings/sync` is a page, not a sheet: destructive actions plus a scrolling list. Dead rows use
  swipe-left → Отклонить with a confirm, mirroring set deletion. A parent-dead group renders as one
  row, not N (Behaviour 38). The page also shows `meta.persisted` / `meta.persistApiAvailable` and,
  on iOS, the install hint's real reason.
- No skeletons for mirrored data — it renders synchronously from Dexie. The only skeleton is first-run
  hydration (3 shimmer cards, max 2 s, then the empty state).
- `/~offline` and the offline banner respect `prefers-reduced-motion`: the syncing arc becomes a
  static dot. `/~offline` renders in the user's locale from the inlined bundles (Behaviour 14).
- The iOS install hint appears at most twice, and only when `!isStandalone()`. It now has **two**
  load-bearing reasons, both cited at their real source: Web Push requires Home Screen installation
  (r06 §6.1), and a Home-Screen app has its own use counter and is exempt from WebKit's seven-day
  script-writable-storage sweep (Behaviour 29, quoting webkit.org/blog/10218).

## Risks

| Risk | Mitigation |
|---|---|
| `serwist build` running after `opennextjs-cloudflare build` → deployed app has no `/sw.js`, silently | The exact scripts in Behaviour 2 + `scripts/assert-pwa-build.mjs` asserting `.open-next/assets/sw.js` exists and is non-trivial |
| A hard-coded precache name putting the precache outside its own allowlist → the `activate` purge deletes the offline shell on every update, in production only | `cacheAllowlist()` is built from `cacheNames.precache` + the constructed entries (Behaviour 10); a unit test on the allowlist and a Playwright assertion on `caches.keys()` after an update |
| Phase 0's `sw.ts` shipping `skipWaiting/clientsClaim/navigationPreload: true` → `SwUpdateGate` is dead code, invisibly | Files table marks the file *(edit)* and names the three flags; `scripts/assert-pwa-build.mjs` greps `skipWaiting: false` |
| A dynamic root layout (auth, i18n cookie, theme) turns every route `ƒ` → no HTML in the manifest → no offline app, no error | CI assertion that `.next/server/app/~offline.html` and `index.html` exist; client-side locale (Behaviour 6, which Phase 0 currently violates); auth in `proxy.ts`/child layouts (r05 §6c) |
| `NODE_ENV=development` leaking into the build → SW caches nothing | `cross-env NODE_ENV=production` + CI `grep -q "google-fonts-webfonts" public/sw.js` |
| `public/_headers` entering the manifest → install throws, no SW at all | `globIgnores` (Behaviour 4) + curl checks that `/_headers` is 404 while `/sw.js` is 200 |
| `Date` crossing the wire as an ISO string into a numeric Dexie index → LWW silently compares string to number | One conversion boundary (Behaviour 35) + `wire.test.ts` asserting `typeof updatedAt === "number"` and no ISO-8601 values on either side |
| esbuild not resolving the `@/*` tsconfig path when bundling `src/app/sw.ts` (UNVERIFIED here) | `sw.ts` imports **relative** paths only; `typecheck` runs `tsconfig.sw.json` |
| SW and page on different Dexie schema versions after a deploy → blocked upgrade, flush hangs | `skipWaiting:false` keeps the new SW dormant while a page is open; 5 s open timeout + `FLUSH_NOW` fallback (Behaviour 33); `versionchange`/`blocked` handlers |
| Double flush from page + SW duplicating writes | Dexie lease + Web Locks + server idempotency on the op id (a duplicate returns the stored `canonical`) |
| Wrong device clock (travel, dead battery) → LWW garbage | `clampClientTime` to `[−365 d, +300 s]`; **`updated_at` is the clamped origin-device clock, written explicitly by the applier — never the server clock and never 02's column default; `received_at` is the server clock** (Behaviour 27) |
| A platform outage converting a whole pending workout into `dead` ops | `POISON_ATTEMPTS = 24` plus an elapsed-time poison rule of 24 h (Behaviour 24); `rateLimit` and offline time never consume the budget |
| A dead parent leaving its children `pending` forever, counted but unresolvable | `killGroup()` cascades `deadCode:"parent_dead"`; one row, one action in `settings/sync` (Behaviour 38) |
| Cross-build RSC payloads vs precached HTML → chunk 404 / hydration failure | Purge `VOLATILE_PAGE_CACHES` on every `activate` (Behaviour 10) |
| Authenticated reads staying in Cache Storage after logout or revocation | `purgeVolatileCaches()` + `purgeR2PhotoCache()` on logout and on a `stale_version` 401 (Behaviour 37) |
| No Background Sync on iOS (verified) → the queue waits for the app to open | Six client-side triggers (Behaviour 20); a Telegram/push nudge when `pending > 0` for > 24 h (`specs/14`) |
| Quota eviction wiping IndexedDB with unsynced ops | `navigator.storage.persist()` (present on every target incl. Safari 15.2+, verified — Behaviour 29), WebKit's Home-Screen exemption from the 7-day sweep, the quota watchdog, and never evicting a blob with a live op |
| Dexie/IndexedDB unavailable (Safari private mode) | `db.open()` failure renders a hard error screen ("Локальное хранилище недоступно") — logging is refused rather than silently lost |

## Verification

```bash
# 1. Build order + precache sanity — PASS = every command exits 0
npm run build
test -f .next/server/app/~offline.html
test -f public/sw.js && grep -q "google-fonts-webfonts" public/sw.js
grep -q '"/~offline"' public/sw.js
grep -q "skipWaiting: false"      src/app/sw.ts     # the invisible failure of Behaviour 13
grep -q "clientsClaim: false"     src/app/sw.ts
grep -q "navigationPreload: false" src/app/sw.ts
grep -rq "serwist-precache-v2\"" src/ && exit 1 || true   # no literal precache name anywhere
node scripts/assert-pwa-build.mjs   # manifest has >=1 .html entry, 0 entries matching
                                    # ^public/_(headers|redirects|routes), sw.js > 20 KB, and every
                                    # name in DEFAULT_CACHE_NAMES still appears in the installed
                                    # node_modules/@serwist/next/dist/index.worker.mjs
```

```bash
# 2. Deployed asset layer + installability — PASS = every command exits 0.
# `opennextjs-cloudflare preview` is populate-cache + `wrangler dev` (verified in
# node_modules/@opennextjs/cloudflare/dist/cli/commands/preview.js). We split it so the port, the
# persistence directory, the readiness wait and the kill are all explicit; these assertions only
# touch Cloudflare's static-asset layer, which populate-cache does not affect.
set -e
O=http://127.0.0.1:8787
STATE=.wrangler/state          # the SAME directory for the server and every d1 execute below
npx opennextjs-cloudflare build
test -f .open-next/assets/sw.js                                    # SW reached the asset bundle
npx wrangler dev --port 8787 --persist-to "$STATE" & SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
until curl -sf "$O/api/health" >/dev/null; do sleep 1; done         # readiness, not a race

curl -sD - -o /dev/null "$O/sw.js" | tr -d '\r' \
  | grep -qi '^cache-control: no-cache, no-store, must-revalidate'
curl -sD - -o /dev/null "$O/sw.js" | tr -d '\r' | grep -qi '^content-type:.*javascript'
test "$(curl -s -o /dev/null -w '%{http_code}' "$O/_headers")" = 404
curl -sD - -o /dev/null "$O/manifest.webmanifest" | tr -d '\r' \
  | grep -qi '^content-type: application/manifest+json'
node scripts/assert-installable.mjs "$O/manifest.webmanifest"
# ^ r05 §8's five Chromium criteria, scripted: name|short_name present; icons include 192 AND 512;
#   start_url present; display ∈ {fullscreen,standalone,minimal-ui}; prefer_related_applications
#   !== true. Exits non-zero with the failing criterion named.

# The brief's "passes Lighthouse PWA" acceptance item, reworded to what exists in lighthouse@13.4.1
# (the PWA category was removed; r05 §8, verified). This IS the replacement, not an alternative:
npx lighthouse "$O" --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags=--headless --output=json --output-path=/tmp/lh.json --quiet
node -e 'const r=require("/tmp/lh.json");
  const lcp=r.audits["largest-contentful-paint"].numericValue;
  const js=r.audits["total-byte-weight"].details.items
    .filter(i=>/\.js(\?|$)/.test(i.url)).reduce((a,i)=>a+i.totalBytes,0);
  if(lcp>2500) throw new Error("LCP "+lcp+"ms > 2500");
  if(js>200*1024) throw new Error("route JS "+js+"B gz > 200KB");
  if(r.categories.accessibility.score<1) throw new Error("a11y < 100");'
kill $SRV
```

```bash
# 3. Batch idempotency — PASS = every command exits 0.
set -e
O=http://127.0.0.1:8787
STATE=.wrangler/state
D1_DB=fitness-pwa-db                # = the `database_name` of the D1 binding in wrangler.jsonc (01)
JAR=$(mktemp)
npx opennextjs-cloudflare build
npx wrangler dev --port 8787 --persist-to "$STATE" & SRV=$!
trap 'kill $SRV 2>/dev/null || true; rm -f "$JAR"' EXIT
until curl -sf "$O/api/health" >/dev/null; do sleep 1; done

# A fresh local D1 has no parent rows, so by Behaviour 22 an unseeded set.create is `skipped`
# with parent_missing and the count below is 0. Migrate and seed FIRST, against the SAME
# --persist-to the dev server is using, or the assertions read an empty database.
npx wrangler d1 migrations apply "$D1_DB" --local --persist-to "$STATE"
npx wrangler d1 execute "$D1_DB" --local --persist-to "$STATE" \
  --file tests/fixtures/sync-seed.sql          # users id='me' + settings + one 'fedb:' exercise

# The local cookie is `fa_session` WITHOUT the __Host- prefix, because the origin is http and
# __Host- mandates Secure (04 rule 6). Sending __Host-fa_session here yields 401, not "applied".
TOTP=$(node -e 'const{TOTP,Secret}=require("otpauth");
  console.log(new TOTP({secret:Secret.fromBase32(process.env.DEV_TOTP_SECRET)}).generate())')
curl -sf -c "$JAR" -X POST "$O/api/auth/login" -H 'content-type: application/json' \
  -H "origin: $O" -d "{\"password\":\"$DEV_PASSWORD\",\"totp\":\"$TOTP\"}" | grep -q '"ok":true'
grep -q 'fa_session' "$JAR" && ! grep -q '__Host-' "$JAR"

# tests/fixtures/sync-ops.json — committed, not inlined, and parents come first:
#   workout.create → workoutExercise.create → set.create, with 02's column names
#   (`position`, not `orderIdx`), 06's NON-NULL set fields (workoutExerciseId, position,
#   setType, completedAt), a real seeded exercise id from sync-seed.sql, and clientRev null
#   on the creates (it crosses to mutations.client_rev as 0 — Behaviour 25).
for i in 1 2; do curl -sf -X POST "$O/api/sync/batch" -H 'content-type: application/json' \
  -b "$JAR" --data @tests/fixtures/sync-ops.json > "/tmp/batch$i.json"; done
test "$(grep -o '"status":"applied"'   /tmp/batch1.json | wc -l)" = 3
test "$(grep -o '"status":"duplicate"' /tmp/batch2.json | wc -l)" = 3

npx wrangler d1 execute "$D1_DB" --local --persist-to "$STATE" --json \
  --command "select (select count(*) from workouts) w, (select count(*) from sets) s,
                    (select count(*) from mutations) m" | tee /tmp/counts.json
node -e 'const r=require("/tmp/counts.json");const x=r[0].results[0];
  if(x.w!==1||x.s!==1||x.m!==3) throw new Error(JSON.stringify(x));'   # w=1 s=1 m=3

test "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$O/api/sync/batch" \
  -H 'content-type: application/json' --data @tests/fixtures/sync-ops.json)" = 401
kill $SRV
```

```bash
# 4. Tests — PASS = all green
npx vitest run tests/unit/sync
npx playwright test tests/e2e/offline-workout.spec.ts
```

Unit cases for the pure functions:

- `nextAttemptDelayMs` **base delay, `rng = () => 0.5` (zero jitter), exact**: `0→2000`, `1→4000`,
  `3→16000`, `9→1024000`, `10→1800000` (the cap first binds here, not at 9), `64→1800000`;
  non-decreasing; never `NaN` up to `attempts = 64`. **Jitter, separately**: for `attempts = 3` and
  1000 seeded `rng` draws every value is within `[12800, 19200]` (= `16000 × 0.8 … 1.2`) and the mean
  is within 1 % of 16000.
- `isPoisoned`: `{attempts:23, firstFailedAt: now-1h}` → false; `{attempts:24, …}` → true;
  `{attempts:2, firstFailedAt: now-25h}` → true; `{attempts:2, firstFailedAt: null}` → false.
- `classifyFailure`: `401,403→auth`; `408→transient`; `429→rateLimit`; `500,502,503→transient`;
  `400,409,422→permanent`; **`413→transient`** (a client bug must not mass-kill 51 ops);
  `null` (network) `→transient`. `retryAfterMs`: `"30"→30000`; `"0"→1000` (clamped);
  `"99999"→600000` (clamped); an HTTP-date 45 s out → `45000 ± 1000`; `null→60000`.
- `clampClientTime`: `serverNow+10 min → serverNow+300 s`; `serverNow−2 y → serverNow−365 d`; in-range
  unchanged. `cursor`: encode/decode round-trip; two rows sharing `updated_at` split across a `limit`
  boundary are each returned exactly once across two calls.
- `resolvePatch`: newer `updatedAt` wins; equal `updatedAt` with `clientRev >= storedRev` → apply,
  with a lower `clientRev` → `{conflict,"revTiebreak"}`; older → `{conflict,"stale"}`;
  incoming `clientRev` `0` and `null` behave identically; `storedDeletedAt != null` + patch →
  `{conflict,"tombstoned"}`; restore with `updatedAt > deletedAt` → apply, otherwise `conflict`.
- `wire`: `toWireRow` on a Drizzle row carrying `Date` instants emits numbers — `typeof
  row.updatedAt === "number"`, and no value in the object is a `Date` or matches
  `/^\d{4}-\d{2}-\d{2}T/`; `deletedAt` survives as `number | null`; booleans are `0|1`; `localDay`
  stays `'YYYY-MM-DD'`; `fromWireRow(toWireRow(x))` round-trips, sets `deleted` from `deletedAt`, and
  yields a `[table+updatedAt]`-indexable row.
- `cache-names`: `cacheAllowlist([...ourEntries, ...defaultCache])` contains `cacheNames.precache`,
  `cacheNames.runtime`, the three `OUR_RUNTIME_CACHES` and **all 18** `DEFAULT_CACHE_NAMES`; the
  returned set contains no name absent from that union; and `cacheNames.precache` is asserted to
  start with `"serwist-precache-v2"` and **not** to equal it.
- `mirror-tables`: the union assertion of Behaviour 35 against `@/db/schema`, plus the `settings`
  exception, plus `OP_TYPES` covering every table in `WRITABLE_TABLES` with at least one op and no op
  naming a table in `PULL_ONLY_TABLES`.
- `outbox` (fake-indexeddb): `seq` strictly increasing over 100 inserts; `claimBatch` returns ≤ 50 in
  `seq` order and **stops before the first `photo.*` op**; an expired lease is reclaimed; `attempts`
  does not increment while offline nor on a `rateLimit`; `attempts = 24` → `dead`;
  `firstFailedAt = now − 25 h` → `dead`; a duplicate `id` is rejected by the `&id` unique index;
  `killGroup()` on a dead parent marks a queued child `dead` with `deadCode:"parent_dead"`;
  `discardDead()` restores `prevJson` into the mirror with `dirty:0`, deletes the mirror row when
  `prevJson === null`, and also discards later ops for the same `entityTable+entityId`.
- PR reconciliation: replay the six e1RM vectors from
  `docs/research/r09-formulas-and-test-vectors.md` §1 ("Six test vectors") as `set.create` ops and
  assert each client `prProvisional` flag is replaced by the server `is_pr` from `result.row`, and
  that the client value is never persisted to `is_pr`.
- a11y: rendering the tree with `meta.locale = "en"` sets `document.documentElement.lang === "en"`;
  switching to `"ru"` updates it (Behaviour 6c).

Playwright (`tests/e2e/offline-workout.spec.ts`) — assertions are on **observable server state and
DOM**, never on service-worker-initiated requests, which `page`/`context` request events do not
reliably surface and which Background Sync may legitimately originate:

1. Install the SW; `context.setOffline(true)`; hard-reload → `/~offline` for an unvisited route, the
   precached shell for a prerendered one.
2. Log 12 sets across 2 exercises. Assert the sync chip's `role="status"` text contains the exact
   count **15** — 1 `workout.create` + 2 `workoutExercise.create` + 12 `set.create` — computed from
   the op list, not "12+". Assert `await page.evaluate(() => db.outbox.count())` is 15 and that
   `select count(*) from sets` in the local D1 is still 0 (the only reliable proof no flush landed).
3. `setOffline(false)`. Force the **page-side** flush path deterministically by stubbing
   `registration.sync` away in an `addInitScript` (`delete
   ServiceWorkerRegistration.prototype.sync`), so the flush cannot originate in the SW and its
   requests are observable. Assert exactly one `POST /api/sync/batch` carrying 15 ops.
4. Assert `select count(*) from sets` = 12 and `select count(*) from mutations` = 15 — one `mutations`
   row per op id — the chip returning to `synced` (rendering nothing), and a reload showing the sets
   with server `rev` values.
5. Update path: rebuild with a bumped BUILD_ID, reload twice so a second SW activates, then assert
   `(await caches.keys()).some(n => n.startsWith("serwist-precache-v2-"))` and
   `!!(await caches.match("/~offline"))` — i.e. the `activate` purge did **not** eat the precache
   (Behaviour 10).
6. Logout path: log in, visit two authenticated routes, `logout()`, then assert every name in
   `VOLATILE_PAGE_CACHES` plus `reference-data` and `r2-photos` is absent from `caches.keys()`, while
   `db.outbox.count()` and the `mirror` row count are unchanged (Behaviour 37).

Manual airplane-mode script — on a real phone, after Add to Home Screen. **PASS = every line.**

1. Launch installed app online, open the dashboard, start a workout. Enable Airplane Mode.
2. Log 10 sets over 3 exercises, including one superset and one deleted set. Every tap responds in
   < 100 ms, the rest timer runs, the chip shows the offline icon with a growing count.
3. Force-quit, relaunch, still offline: the workout is intact, the count unchanged, no login asked.
4. Take a progress photo offline: the blob queues and the thumbnail renders from the local blob. On
   reconnect the photo uploads through `dispatchPhotoOp`, alone in its own request (Behaviour 36),
   and the pending badge on the tile clears.
5. Disable Airplane Mode without opening the app (Android/Chrome): the count clears within ~1 min via
   Background Sync. On iOS it clears within 2 s of foregrounding.
6. Reopen: PR badges match the server (a provisional outline badge may disappear), `settings/sync`
   shows 0 failures. **Storage line, per platform:** on Android/Chrome `persisted = true`; on iOS
   Safari the API exists (verified, 15.2+) but persistence is granted heuristically, so
   `persisted = false` is a PASS provided `persistApiAvailable = true` and the page notes the
   Home-Screen exemption (Behaviour 29).
7. Edit the same set's weight on a second device while the phone is offline, then let the phone sync:
   the newer `updated_at` wins, the loser sees the "Сохранена более новая версия" toast, and
   both devices converge after one pull.

## Open questions

The three earlier questions are resolved, not deferred: static-shell i18n is option A and is now
Behaviour 6 plus amendment 05→03.1; the sync chip is invisible when synced (Behaviour 31); the
Lighthouse PWA item is reworded to r05 §8's checklist and is now §Verification block 2. What remains
open is only what another spec's owner must supply.

1. **`SYNC_LIMITER`'s `namespace_id` (blocking, amendment 05→01.1).** `specs/01` owns
   `wrangler.jsonc` and currently declares exactly two limiters (`AUTH_LIMITER` `1001`, `AI_LIMITER`
   `1002`). `1003` is this spec's assumption; the owner of 01 must confirm the id and that
   `{limit:60, period:60}` per `deviceId` is right for a two-device single user. Until the binding
   exists, `POST /api/sync/batch` has nothing to call `checkRateLimit()` against and Behaviour 25
   step 1 is unbuildable.
2. **Who carries the "root layout stays static" i18n constraint (blocking, amendment 05→03.1).**
   `specs/01` line 27 assigns "i18n request config + locale cookie" to `specs/03`; `specs/13` line 40
   assigns `next-intl` wiring to `specs/01`. Those two disagree, `next-intl` appears in no other
   spec's body, and Phase 0 has already shipped a root layout that calls `getLocale()` — so the
   constraint is currently asserted only by the spec that does not own it. One of 01/03 must adopt it
   by name before the layout edit lands, or the precache manifest silently goes back to zero HTML.
3. **Does `specs/09` need client-side `deload_blocks` writes?** This spec classifies `deload_blocks`
   as `PULL_ONLY` on the reading that scheduled and AI-suggested blocks are server-generated, while
   02's `source` enum includes `manual`. If a user can create or accept a deload block offline, 09
   must request `deloadBlock.create/patch/delete` as an amendment here; the `mirror-tables` test will
   pass either way, so nothing catches this automatically.
4. **Does `settings` need `syncCols()` (non-blocking, but it should be decided once)?** 02's shipped
   `core.ts` `settings` row has `updated_at` only — no `rev`, no `deleted_at` — so `settings.patch`
   is the one op with no LWW tiebreak (Behaviour 35). Two `settings.patch` ops from two devices in the
   same millisecond resolve arbitrarily. For a two-device single user that is acceptable and this spec
   ships it, but if 02's owner would rather add `rev INTEGER NOT NULL DEFAULT 1` (an additive
   `ALTER TABLE ADD COLUMN` with a constant default — 02 rule 21 needs no gate for it, and it is the
   established pattern for every other `settings` addition), the exception in Behaviour 35 disappears
   and `settings` joins the ordinary path.
