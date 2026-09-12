# 08 — Exercise library, media pipeline and search

## Purpose

Gets the exercise catalogue (876 records, 1,746 images) out of `yuhonas/free-exercise-db` into D1 + R2 via one re-runnable seed script,
and puts it behind a picker that ranks and filters instantly with no network. Satisfies brief module 2 and is a prerequisite for the Phase
2 DoD "a full session logs OFFLINE and syncs". Two brief claims are corrected on verified grounds: the dataset holds **876** exercises,
not 1000+, and its media are **static JPEG pairs**, not GIF/video ([r07 §4, §6](../docs/research/r07-exercise-dataset.md)). Whether 876
static pairs are accepted as the product, or a paid animated set is bought instead, is **not settled here** — it is Open question 4.

## Scope

Seed pipeline (pinned download, verified tarball extraction, Zod validation, taxonomy normalisation, slug and `load_mode` derivation,
deterministic R2 keys, batched literal-SQL D1 upsert, dry-run, report, exit codes, local vs remote); the canonical muscle (17) and
equipment (13 + `unknown`) taxonomies and their mapping from raw dataset strings, exported for every other module; the `load_mode`
heuristic and its user override, owed to this spec by [`specs/06-workouts.md`](06-workouts.md) line 31; the catalogue sync endpoint and the
Dexie projection that makes search work offline; fuzzy search (normalisation, RU transliteration and its fold, deterministic ranking,
filters, virtualised bottom-anchored list); the detail view (media, instructions, muscles, history, e1RM series); custom exercises (fields,
id namespacing, slug, soft delete, one merged search space); favourites; the authenticated R2 read path; the licence attribution block and
the two screens that render it; the RU-language decision for an English-only dataset.

### Out of scope

| Excluded | Owner |
|---|---|
| D1 DDL, migrations, Drizzle schema files, soft-delete policy | `specs/02-data-model.md` |
| Colour tokens, `BottomSheet`, tap-target tokens, haptics API | `specs/03-design-system.md` |
| The session check every route here calls | `specs/04-auth.md` |
| Dexie database + version ladder, outbox/mirror stores, sync queue, service-worker route table | `specs/05-pwa-offline-sync.md` |
| Set logging, `sets.e1rm_kg` write, ghosting, PR detection | `specs/06-workouts.md` |
| `e1rm()` / Epley / Brzycki / RPE / `isCountedSet` / `totalVolumeKg` math | `specs/07-calculators.md` |
| Routine builder consuming the picker | `specs/09-programs.md` |
| User photo upload/serve pipeline (`photos` table) | `specs/10-body-photos.md` |
| SVG body map, volume rollups, muscle heatmap, **the visx e1RM chart component** | `specs/12-analytics-dashboard.md` |
| Export/import of exercises, the Settings → Data screen | `specs/15-data-portability.md` |
| Vitest/Playwright config, axe harness, CI wiring | `specs/16-testing-ci-quality.md` |
| `next-intl` wiring, `messages/{ru,en}.json` ownership, locale cookie | `specs/03-design-system.md` (per [r11](../docs/research/r11-i18n-on-next16-workers.md)) |

## Files to create

| Path | Responsibility |
|---|---|
| `scripts/seed-exercises/pin.mts` | Pinned commit SHA, dataset sha256, expected counts — the only place these literals live. |
| `scripts/seed-exercises/fetch.mts` | Download the codeload tarball once into `.cache/`, extract via `tar`, verify sha256, or reuse a valid cache. |
| `scripts/seed-exercises/raw-schema.mts` | Zod schema for a raw record from measured domains; its enums are the drift detector. |
| `scripts/seed-exercises/jpeg-size.mts` | Dependency-free JPEG SOF walker → `{width,height}` (rule 8). |
| `scripts/seed-exercises/transform.mts` | Raw → `exercises` rows + muscle links + image manifest; slug, `load_mode`, `bytes`, dimensions. |
| `scripts/seed-exercises/sql.mts` | Literal-SQL emitter: `'`-escaping, UTF-8 no BOM, ≤90,000-byte statements, upsert form. |
| `scripts/seed-exercises/{d1,r2}.mts` | Shells `wrangler d1 execute` + UPSERT probe; `aws4fetch` HEAD-then-PUT with per-key backoff. |
| `scripts/seed-exercises/{report,main}.mts` | `SeedReport` + console table + `.cache/seed-report.json`; CLI flags, orchestration, exit codes. |
| `scripts/translate-exercise-names.mts` | One-off RU name pass (rule 37); writes `seed/exercise-names.ru.json` + `seed/ai-prompt-logs.sql`. |
| `seed/exercise-names.ru.json` | Committed `fedb:<id>` → `{ ru, reviewed }` map. **Seed input only** — D1 `exercises.name_ru` is the source of truth. |
| `src/lib/exercise/taxonomy.ts` | Muscle/equipment keys, dataset maps, rollups, volume-weight seed constants, `loadModeFor`. Zero imports. |
| `src/lib/exercise/types.ts` | `ExerciseId`, `ExerciseWireRow`, `ExerciseIndexRow`, `CatalogBundle`, `UsageRow`. |
| `src/lib/exercise/{normalize,rank,filter,window}.ts` | Pure: normalisation + translit + fold + collation; scoring; facets; virtualisation math. |
| `src/lib/exercise/{catalog-client,catalog-version}.ts` | Dexie read/write + projection, version check, sync trigger, usage counters; `CATALOG_REV`. |
| `src/server/exercises/{catalog,custom,history}.ts` | Bundle build + KV cache; custom CRUD + duplicate detection; history + e1RM series. |
| `src/app/api/reference/exercise-catalog/route.ts` | `GET` bundle (`?part=index\|details`), ETag = version. Under `/api/reference/` so spec 05's SWR entry matches. |
| `src/app/api/exercises/usage/route.ts` | `GET` `setCount` + `lastSetAtMs` for the ranking boost. |
| `src/app/api/exercises/route.ts`, `exercises/[id]/route.ts` | `GET`/`POST` custom; `PATCH` (fields, `nameRu`, `loadMode`, `isFavourite`) / `DELETE` (soft). |
| `src/app/api/exercises/[id]/history/route.ts` | `GET` history + e1RM series. |
| `src/app/api/media/exercise/[sourceId]/[idx]/route.ts` | Authenticated R2 read path with ETag/304. Under `/api/media/` so spec 05's CacheFirst entry matches. |
| `src/app/(app)/exercises/page.tsx`, `exercises/[id]/page.tsx` | Library browse page; detail page. |
| `src/app/(app)/settings/about/page.tsx`, `src/app/licences/page.tsx` | Data-sources screen mounting `DataSourceNotice`; vendored Unlicense text. |
| `src/components/exercise/ExercisePickerSheet.tsx` | The hot path: sheet, bottom-anchored search, results, create CTA. |
| `src/components/exercise/{ExerciseSearchInput,ExerciseResultRow,ExerciseFilterChips,VirtualList}.tsx` | Combobox input + live region; 72px row; facet chips with counts; windowed list. |
| `src/components/exercise/{ExerciseDetail,ExerciseMedia,MuscleChips,FavouriteToggle}.tsx` | Detail composition; 2-position viewer; muscle chips; star affordance. |
| `src/components/exercise/{CustomExerciseForm,DataSourceNotice}.tsx` | Create/edit form with duplicate warning; licence/attribution block. |
| `docs/ATTRIBUTION.md` | The same attribution as prose ([r07 §Step 5](../docs/research/r07-exercise-dataset.md)). |
| `tests/fixtures/exercises.sample.json` | 12 records copied verbatim from the pinned dataset, covering every edge case. |
| `tests/unit/exercise-{taxonomy,normalize,rank,filter,window,history,slug,loadmode,jpeg}.test.ts` | One file per pure concern (cases in V1). |
| `tests/unit/{seed-sql,attribution}.test.ts` | SQL emitter bytes + upsert SET list; attribution sentence rendered. |
| `tests/e2e/exercise-picker.spec.ts` | Offline picker open + type + select; offline media; keyboard-open thumb band; axe on the open sheet. |

### Changes owed to other specs

This spec creates none of the files below. Each row is an **explicit contribution request** to the named owner; nothing here ships until
they land.

| File | Owner | Exact edit |
|---|---|---|
| `package.json` | `specs/01-architecture.md` | devDependency `aws4fetch@1.0.20` (verified ESM, zero `require(`, [r03 §2(i)](../docs/research/r03-r2-uploads-and-image-delivery.md)); script `"seed:exercises": "node --env-file-if-exists=.env.seed --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-exercises/main.mts"` |
| `tsconfig.json` | `specs/01-architecture.md` | `"allowImportingTsExtensions": true` (legal under `noEmit: true`; VERIFIED with the repo's `tsc`, exit 0) |
| `src/db/schema/library.ts` + one additive migration | `specs/02-data-model.md` | `exercises + name_ru_reviewed=false` (new column, constant default ⇒ no rule-21 gate). Also: 02's §Data calls the app KV cache `APP_CACHE`; `specs/01` declares `CACHE_KV` and owns bindings — 02 should say `CACHE_KV`. |
| `src/db/local.ts` (Dexie ladder) | `specs/05-pwa-offline-sync.md` | `db.version(2).stores({ catalogIndex: "id, origin, equipment, category, *search", catalogDetails: "id", catalogUsage: "id, lastSelectedAtMs" })` — three **local-only projection** stores the sync engine never reads or writes (rule 19) |
| `src/lib/sync/ops.ts` | `specs/05-pwa-offline-sync.md` | `OP_TYPES += "exercise.create" \| "exercise.patch" \| "exercise.delete"`; `exercises` leaves `PULL_ONLY` for `source='user'` rows only — the server rejects (`status:"rejected"`) any op whose `entityId` starts `fedb:` except a `exercise.patch` touching only `name_ru`/`name_ru_reviewed`/`load_mode`/`is_favourite` |
| `src/components/analytics/e1rm-chart.tsx` | `specs/12-analytics-dashboard.md` | No change — this spec **imports** it via `next/dynamic`. Recharts is not used anywhere (12 rule 24); this spec creates no chart component. |
| `messages/{ru,en}.json` | `specs/03-design-system.md` | Extend, do not create: the `ExerciseLibrary` namespace (rule 38). Path is repo-root `messages/` per [r11 §File layout](../docs/research/r11-i18n-on-next16-workers.md); `specs/10`'s `src/i18n/messages/` is drift and should be corrected there. |
| `docs/DECISIONS.md` | shared, append-only, owned by nobody (`specs/04-auth.md` §Files) | V9 appends the measured wire-size baseline |

## Interfaces

```ts
// src/lib/exercise/taxonomy.ts — imported by the seed script AND the app. No dependencies.
export const MUSCLE_KEYS = ["abdominals","abductors","adductors","biceps","calves","chest",
  "forearms","glutes","hamstrings","lats","lower_back","middle_back","neck","quadriceps",
  "shoulders","traps","triceps"] as const;                       // 17, 1:1 with the dataset
export const EQUIPMENT_KEYS = ["barbell","dumbbell","ez_bar","cable","machine","kettlebell",
  "resistance_band","medicine_ball","exercise_ball","foam_roller","bodyweight","other",
  "unknown"] as const;                                           // 13
export type MuscleKey = (typeof MUSCLE_KEYS)[number];
export type EquipmentKey = (typeof EQUIPMENT_KEYS)[number];
export type Category = "strength"|"stretching"|"plyometrics"|"powerlifting"
                     | "olympic_weightlifting"|"strongman"|"cardio";
export type Level = "beginner"|"intermediate"|"expert";
export type Mechanic = "compound"|"isolation";        // null in 87 dataset records
export type Force = "push"|"pull"|"static";           // null in 30 dataset records
export type MuscleRole = "primary"|"secondary";
/** = 02's LOAD_MODE, re-exported so the seed script needs no `src/db` import. */
export type LoadMode = "external"|"bodyweight"|"bodyweight_plus"|"assisted"|"duration"|"distance";
export const DATASET_MUSCLE_MAP: Readonly<Record<string, MuscleKey>>;        // 17 entries, total
export const DATASET_EQUIPMENT_MAP: Readonly<Record<string, EquipmentKey>>;  // 12 + "" for null
export const MUSCLE_ROLLUP: Readonly<Record<MuscleKey,
  "chest"|"back"|"shoulders"|"arms"|"legs"|"core"|"hips"|"neck">>;
/** Seed input for 02's `volume_weights` table ONLY. Runtime readers use the table (rule 40). */
export const VOLUME_WEIGHT_SEED: Readonly<Record<MuscleRole, number>> = { primary: 1.0, secondary: 0.5 };
export function toMuscleKey(raw: string): MuscleKey;                       // throws on unknown
export function toEquipmentKey(raw: string | null): EquipmentKey;
export function loadModeFor(a: { category: Category; equipment: EquipmentKey;
  normalizedName: string }): LoadMode;                                     // rule 6b
export function slugify(name: string): string;                             // rule 6c, no collision logic
```

```ts
// src/lib/exercise/types.ts
export type ExerciseId = `fedb:${string}` | `usr:${string}`;
/** EXACTLY what crosses the wire in `CatalogBundle`. No derived fields — see rule 13. */
export interface ExerciseWireRow {
  id: ExerciseId; origin: "catalog" | "custom";
  sourceId: string | null;                   // dataset id; null for custom
  slug: string;
  name: string;                              // English (dataset) or the user's own
  nameRu: string | null;                     // null ⇒ display falls back to `name`
  nameRuReviewed: boolean;
  equipment: EquipmentKey; category: Category; level: Level; loadMode: LoadMode;
  mechanic: Mechanic | null; force: Force | null;
  primary: MuscleKey[];                      // 1–2 catalog, 1–3 custom
  secondary: MuscleKey[];                    // 0–10
  images: Array<{ idx: number; v: string; w: number; h: number; bytes: number }>;  // v = sha256[0:8]
  hasInstructions: boolean; isFavourite: boolean;
  deletedAtMs: number | null;                // 02 rule 25 — the archive mechanism. Never a hard delete.
}
/** The Dexie `catalogIndex` row: wire row + fields derived locally, never transmitted. */
export interface ExerciseIndexRow extends ExerciseWireRow {
  search: string[];                          // 4 normalised haystacks (rule 13), multiEntry-indexed
}
export interface ExerciseDetailRow { id: ExerciseId; instructions: string[] }   // [] is legal
export interface CatalogBundle {
  version: string;              // "a859101d-m9x2k7-r1" (rule 18)
  sourceCommit: string;         // 40-hex
  count: number; index: ExerciseWireRow[]; details?: ExerciseDetailRow[];
}
/** Dexie `catalogUsage`. Two DIFFERENT quantities with two names — never compared with `>` (rule 20). */
export interface UsageRow {
  id: ExerciseId;
  setCount: number; lastSetAtMs: number | null;            // SERVER truth, from `sets`. One writer: rule 20.
  selectionCount: number; lastSelectedAtMs: number | null; // LOCAL only, monotonic. One writer: rule 22.
}
export type ServerUsageRow = Pick<UsageRow, "id" | "setCount" | "lastSetAtMs">;
```

```ts
// src/lib/exercise/{normalize,rank,filter,window}.ts — all pure, no I/O, no React, no `Intl` (rule 15b)
/** NFKD → strip combining marks ONLY after a Latin base → NFC → lowercase → `ё`→`е` →
 *  `' ’ ` → "" → [^\p{L}\p{N}] → " " → collapse. Cyrillic `й` survives (rule 14a). */
export function normalizeQuery(s: string): string;
export function tokenize(s: string): string[];
export function translitRu(s: string): string;             // rule 14b table; runs on RAW Cyrillic
export function foldTranslit(s: string): string;           // rule 14c many-to-one collapse
/** [normalizeQuery(name), normalizeQuery(nameRu), normalizeQuery(translitRu(nameRu)),
 *  foldTranslit(slot2)] — always length 4, "" for a null nameRu. */
export function buildSearchFields(r: Pick<ExerciseWireRow,"name"|"nameRu">): string[];
/** Pinned collation key: Latin block then Cyrillic block, each alphabetical, `ё` after `е`.
 *  Frozen table in this file — NOT `Intl.Collator`, so client and server agree bit-for-bit. */
export function collationKey(normalized: string): string;
export function compareCollated(a: string, b: string): -1 | 0 | 1;

export const SCORE_TIER_SCALE = 1000;
export const TIER = { exact: 1000, namePrefix: 800, wordStart: 600, allTokens: 450 } as const;
export const MAX_BOOST = 330;            // 150 favourite + 120 usage + 60 recency
export const MAX_FIELD_PENALTY = 8;
export interface RankContext {
  locale: "ru" | "en";
  usage: ReadonlyMap<ExerciseId, UsageRow>;
  nowMs: number;                                     // injected — never Date.now() inside
}
/** null = no match (row excluded). Higher is better. `score = tier * SCORE_TIER_SCALE
 *  + boosts − fieldPenalty`, so `tierOf(score) = Math.floor(score / SCORE_TIER_SCALE)`. */
export function scoreExercise(r: ExerciseIndexRow, normalizedQuery: string, c: RankContext): number | null;
export function rankExercises(rows: readonly ExerciseIndexRow[], query: string,
  filters: ExerciseFilters, ctx: RankContext): ExerciseIndexRow[];

export interface ExerciseFilters {
  muscles: MuscleKey[];          // OR within facet; matches primary OR secondary
  equipment: EquipmentKey[];     // OR within; "other" also selects "unknown"
  categories: Category[]; levels: Level[]; mechanic: Mechanic | null;
  origin: "all" | "custom" | "catalog";
  favouritesOnly: boolean; withMediaOnly: boolean; includeDeleted: boolean;  // default false
}
export const EMPTY_FILTERS: ExerciseFilters;
export function matchesFilters(row: ExerciseIndexRow, f: ExerciseFilters): boolean;
export function facetCounts(rows: readonly ExerciseIndexRow[], f: ExerciseFilters):
  { muscles: Record<MuscleKey, number>; equipment: Record<EquipmentKey, number> };
/** Ordinary TOP-anchored math over the REVERSED render order (rule 23). `rowPx` is a
 *  parameter, never a literal. `maxScrollTopPx` is the bottom = rank 1. */
export function windowSlice(a: { scrollTopPx: number; viewportPx: number; rowPx: number;
  count: number; overscanRows: number }):
  { startIndex: number; endIndex: number; padTopPx: number; totalPx: number;
    maxScrollTopPx: number };                                                  // end exclusive
```

```ts
// scripts/seed-exercises/raw-schema.mts
export const RawExercise = z.object({
  id: z.string().regex(/^[0-9a-zA-Z_-]+$/), name: z.string().min(1),
  force: z.enum(["static","pull","push"]).nullable(),   // absent from upstream `required`
  level: z.enum(["beginner","intermediate","expert"]),
  mechanic: z.enum(["isolation","compound"]).nullable(),
  equipment: z.enum(["medicine ball","dumbbell","body only","bands","kettlebells","foam roll",
    "cable","machine","barbell","exercise ball","e-z curl bar","other"]).nullable(),
  primaryMuscles: z.array(z.enum(DATASET_MUSCLE_NAMES)).min(1).max(2),
  secondaryMuscles: z.array(z.enum(DATASET_MUSCLE_NAMES)).max(10),
  instructions: z.array(z.string()),
  category: z.enum(["powerlifting","strength","stretching","cardio","olympic weightlifting",
    "strongman","plyometrics"]),
  images: z.array(z.string()),
}).strict()                                             // .strict() ⇒ a new upstream key throws
  .refine((r) => new Set(r.primaryMuscles).size === r.primaryMuscles.length,
          "duplicate muscle within primaryMuscles")     // rule 4(c) — PK (exercise_id,muscle,role)
  .refine((r) => new Set(r.secondaryMuscles).size === r.secondaryMuscles.length,
          "duplicate muscle within secondaryMuscles")
  .refine((r) => !r.primaryMuscles.some((m) => r.secondaryMuscles.includes(m)),
          "muscle present in BOTH primaryMuscles and secondaryMuscles");  // would credit 1.5×
```

```ts
// scripts/seed-exercises/{main,report}.mts
export interface SeedOptions {
  target: "local" | "remote";                // default "local"
  images: "skip" | "upload" | "local";       // default: local→"skip", remote→"upload"
  dryRun: boolean; only: "all" | "json" | "images";
  concurrency: number;                       // default 8
  limit: number | null;                      // first N records; smoke tests only
  force: boolean;                            // re-PUT even when sha256 matches
  forceDownload: boolean;                    // re-fetch even when a cache exists (rule 3)
}
export interface SeedReport {
  startedAt: string;                         // ISO-8601 UTC
  durationMs: number; options: SeedOptions; sourceCommit: string; jsonSha256: string;
  extracted: { jpgFiles: number };           // must be 1746 — rule 3
  parsed: { records: number; imageRefs: number; muscleLinks: number; withoutImages: number;
            withoutInstructions: number; twoPrimary: number; slugCollisions: number;
            loadModes: Record<LoadMode, number>; nameRuPresent: number;
            dimensions: Record<string, number> };   // "850x567" → count, recorded not asserted
  sql: { statements: number; bytes: number; maxStatementBytes: number; path: string };
  d1: { applied: boolean; rowsWritten: number | null };
  r2: { planned: number; uploaded: number; skipped: number; failed: string[]; bytes: number };
  exitCode: 0 | 1 | 2 | 3 | 4;
}
```

```ts
// src/server/exercises/{custom,history}.ts
export const CustomExerciseInput = z.object({
  name: z.string().trim().min(1).max(80),
  nameRu: z.string().trim().max(80).nullable().default(null),
  equipment: z.enum(EQUIPMENT_KEYS), category: z.enum(CATEGORY_KEYS),
  level: z.enum(["beginner","intermediate","expert"]).default("intermediate"),
  mechanic: z.enum(["compound","isolation"]).nullable().default(null),
  force: z.enum(["push","pull","static"]).nullable().default(null),
  loadMode: z.enum(LOAD_MODE).default("external"),   // 02's LOAD_MODE — NOT NULL, so never omitted
  primary: z.array(z.enum(MUSCLE_KEYS)).min(1).max(3),
  secondary: z.array(z.enum(MUSCLE_KEYS)).max(10).default([]),
  instructions: z.array(z.string().max(500)).max(20).default([]),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(96),   // client-computed, server re-slugs
  id: z.string().regex(/^usr:[0-9A-HJKMNP-TV-Z]{26}$/).optional(),  // client ULID ⇒ idempotent POST
}).superRefine((v, ctx) => { /* no muscle in both arrays; no duplicates within either */ });
export interface CreateResult { row: ExerciseWireRow;
  duplicateOf: { id: ExerciseId; name: string; tier: number } | null; }  // advisory, non-blocking

export interface ExerciseHistoryResponse {     // weights kg, timestamps epoch ms
  exerciseId: ExerciseId;
  sessions: Array<{ workoutId: string; localDay: string;    // "YYYY-MM-DD", Asia/Almaty
    startedAtMs: number; topSetE1rmKg: number | null;
    /** `totalVolumeKg(sets)` from specs/07 — COUNTED sets only, per `isCountedSet`. */
    volumeKg: number;
    /** EVERY non-deleted set of this exercise in the session, warmups included and
     *  flagged by `setType`; the caller renders them all, `volumeKg` counts a subset. */
    sets: Array<{ weightKg: number | null; assistKg: number | null; reps: number | null;
                  rpe: number | null; rir: number | null;
                  setType: (typeof SET_TYPES)[number]; e1rmKg: number | null; isPr: boolean }>
  }>;                                                                     // newest first, 30
  e1rmSeries: Array<{ localDay: string; e1rmKg: number }>;   // best point per day, oldest first
  bestE1rmKg: number | null; lastPerformedAtMs: number | null;
}
/** Pure, testable, the only thing V11 exercises. Reads STORED `e1rmKg`; never recomputes (rule 28). */
export function buildE1rmSeries(sets: ReadonlyArray<{ localDay: string; e1rmKg: number | null }>):
  Array<{ localDay: string; e1rmKg: number }>;
```

## Behaviour

### Seed pipeline

1. **Invocation.** `npm run seed:exercises -- [flags]`; script body `node --env-file-if-exists=.env.seed
   --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-exercises/main.mts`. VERIFIED here (Node v24.12.0): Node runs `.mts`
   natively, resolves explicit `.ts` specifiers, accepts both flags — no `tsx`, no build step. The script imports shared app code by
   relative path *with* the extension (`../../src/lib/exercise/taxonomy.ts`), which needs `allowImportingTsExtensions: true` in
   `tsconfig.json`. Never the `@/` alias. Both the script entry and the compiler flag are **owed by `specs/01`** — see §Changes owed.
2. **Never a Worker route** — dev machine only. A route dies on D1's 1000-queries-per-invocation cap and the R2 loop's CPU cost ([r07
   Gotcha 11](../docs/research/r07-exercise-dataset.md)).
3. **Step 1 — fetch and extract.** One request to `https://codeload.github.com/yuhonas/free-exercise-db/tar.gz/${EXDB_COMMIT}` (99,767,288
   bytes, ~60 s) with `EXDB_COMMIT=a859101d633a01c4a1a920d6a8ce41dabba0705f` (no tags exist and `main` moves, so the SHA is the only
   pinnable ref). Extraction is `tar -xzf <tarball> -C .cache/` via `node:child_process.execFile("tar", …)` — **not** a library. VERIFIED
   on this machine: `C:\Windows\System32\tar.exe` is `bsdtar 3.8.8 / libarchive 3.8.8` (ships with Windows 10 1803+) and Git Bash carries
   GNU tar 1.35; both accept `-xzf … -C …`. The tarball's top-level directory is `free-exercise-db-${EXDB_COMMIT}/`. A non-zero exit, or an
   extracted `.jpg` count ≠ **1,746**, ⇒ **exit 2** naming the count. `--force-download` re-fetches unconditionally.
   **The sha256 is computed on the bytes actually about to be used**, cache or fresh download alike: hash the extracted
   `dist/exercises.json` and require
   `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`. A mismatch is **exit 2** with both hashes and never a silent
   re-download — upstream may have swapped the images for placeholders, so a human re-reviews ([r07 Gotcha
   19](../docs/research/r07-exercise-dataset.md)). A cache that hashes correctly makes step 1 offline and re-runnable.
4. **Step 2 — validate.** Parse every record with `RawExercise`. Warn-only tripwires: `records !== 876`, `imageRefs !== 1746`. **Exit 3**
   on (a) any Zod error, (b) a duplicate `id`, (c) a duplicate muscle inside `primaryMuscles`/`secondaryMuscles` or a muscle present in
   **both** — the first would abort the D1 apply with a raw `exercise_muscles` PK error, the second would silently credit that muscle
   1.0 + 0.5 = 1.5 in specs/12 forever — (d) an `images[n]` whose directory ≠ the record `id`, or (e) an unknown
   muscle/equipment/category string. Never validate against upstream `schema.json`: its draft-04 tuple `items` constrains only element 0,
   so a bogus muscle at index 1 passes ([r07 Gotcha 2](../docs/research/r07-exercise-dataset.md)).
5. **Never derive `id` from `name`** (only 840/876 match `name.replace(/ /g,"_")`; deriving yields 36 wrong image paths).
   `exercises.id = "fedb:" + record.id`, `source = 'free-exercise-db'`, `source_id = record.id`, read from the record ([r07 Gotcha
   17](../docs/research/r07-exercise-dataset.md)).
6. **Derivations, all deterministic and unit-tested.**
   (a) **Taxonomy mapping.** Exhaustive by construction; `toMuscleKey` throws on anything unlisted, and that throw is the drift signal.
   Dataset muscle string → `MuscleKey` (rollup):

   | | | |
   |---|---|---|
   | `abdominals`→`abdominals` (core) | `abductors`→`abductors` (hips) | `adductors`→`adductors` (hips) |
   | `biceps`→`biceps` (arms) | `calves`→`calves` (legs) | `chest`→`chest` (chest) |
   | `forearms`→`forearms` (arms) | `glutes`→`glutes` (legs) | `hamstrings`→`hamstrings` (legs) |
   | `lats`→`lats` (back) | **`lower back`→`lower_back`** (back) | **`middle back`→`middle_back`** (back) |
   | `neck`→`neck` (neck) | `quadriceps`→`quadriceps` (legs) | `shoulders`→`shoulders` (shoulders) |
   | `traps`→`traps` (back) | `triceps`→`triceps` (arms) | — |

   Equipment (value → key, measured counts): `barbell`→`barbell` 170, `dumbbell`→`dumbbell` 123, `other`→`other` 122, `body
   only`→`bodyweight` 111, `cable`→`cable` 81, **`null`→`unknown` 77**, `machine`→`machine` 67, `kettlebells`→`kettlebell` 56,
   `bands`→`resistance_band` 20, `medicine ball`→`medicine_ball` 17, `exercise ball`→`exercise_ball` 12, `foam roll`→`foam_roller` 11, `e-z
   curl bar`→`ez_bar` 9. Category: lowercase, `olympic weightlifting`→`olympic_weightlifting`. **`e-z curl bar` must not collapse into
   `barbell`** — different bar mass, or every EZ-bar plate calculation is ~10 kg wrong ([r07 Gotcha
   30](../docs/research/r07-exercise-dataset.md)).

   (b) **`load_mode`.** 02's `exercises.load_mode` is `NOT NULL` and 06 line 31 delegates it here. `loadModeFor` is a 5-branch
   heuristic on the normalised name, evaluated **in this order** (first match wins):
   1. `/(^|\s)assisted(\s|$)/` → **`assisted`** — 06 rule 24 then shows an *Assist* field writing `sets.assist_kg`, never `weight_kg`.
   2. `category === "cardio"` → **`duration`**. All 14 cardio records are timed; none carries distance metadata, so `distance` is reachable
      only by user override. Deliberately no name regex — `Bicycling_Stationary` covers no ground.
   3. `category === "stretching"` (123 records) → **`duration`**.
   4. `equipment === "bodyweight"` → **`bodyweight_plus`** if `/(^|\s)weighted(\s|$)/`, else **`bodyweight`**.
   5. otherwise → **`external`**.

   This is what gives `sets.assist_kg` a driver, bodyweight e1RM its `workouts.bodyweight_kg` signal (02 rule 10), and the plate
   calculator its "is this a barbell lift" answer. **The user can override it** from the detail view (rule 41), and a re-seed never
   overwrites it (rule 8).

   (c) **`slug`.** 02 makes `exercises.slug` `NOT NULL` with `U(slug)`, so the seed cannot omit it. `slugify(name)` = `normalizeQuery(name)`
   with spaces → `-`, capped at 96 chars; collisions are resolved by appending `-2`, `-3`, … in **`id`-ascending order**, which makes the
   whole slug set a pure function of the pinned dataset. The collision count lands in the report.
7. **Step 3 — SQL.** Literal values only, so D1's 100-bound-parameter cap never applies; `'` escaped as `''` (7 names contain one); UTF-8
   **without BOM** (the data carries `¾ ° —`, which PowerShell's ANSI default mangles); no `BEGIN`/`COMMIT`; parents before children;
   every statement ≤90,000 bytes against D1's 100,000-byte cap ([r02 §2.7](../docs/research/r02-drizzle-d1-access-and-migrations.md), [r07
   Gotchas 7, 8, 10](../docs/research/r07-exercise-dataset.md)). Statement order, against **02's real table names**:
   `exercises` upsert → `DELETE FROM exercise_muscles WHERE exercise_id IN (SELECT id FROM exercises WHERE source = 'free-exercise-db')` →
   insert links → the same delete/insert pair for `exercise_media` → `volume_weights` upsert from `VOLUME_WEIGHT_SEED`. There is no
   `exercises_catalog`, no `exercises_custom`, no `exercise_images` and no `exercise_prefs` — 02 rule 23 keeps seeded and user rows in
   **one** `exercises` table because search, filters, import matching and `sets.exercise_id`'s FK would otherwise need a UNION.
8. **Idempotency is `ON CONFLICT(id) DO UPDATE SET`, never `INSERT OR REPLACE`** (REPLACE is DELETE+INSERT in SQLite and, with
   `sets.exercise_id → exercises.id`, either cascades or aborts — [r07 Gotcha 12](../docs/research/r07-exercise-dataset.md)). The `INSERT`
   column list is exactly 02's NOT NULL set plus the nullables the dataset fills: `id, source, source_id, source_commit, name, name_ru,
   slug, force, level, mechanic, equipment, category, load_mode, instructions_json, image_licence, created_at, updated_at, rev`. The
   `DO UPDATE SET` list is **narrower on purpose**: `source_commit, name, slug, force, level, mechanic, equipment, category,
   instructions_json, image_licence, updated_at = <run ms>, rev = rev + 1`, plus
   `name_ru = CASE WHEN name_ru_reviewed = 0 THEN excluded.name_ru ELSE name_ru END`. It never touches `load_mode`, `name_ru_reviewed`,
   `is_favourite` or `deleted_at` — those are user-owned once written, and a re-seed must not undo an override. Child tables are
   delete-then-insert only because they hold no user data and 02 rule 25 lists exactly that as a permitted hard delete. `source_commit` =
   `EXDB_COMMIT`.
9. **JPEG dimensions and bytes.** `jpeg-size.mts` walks the segment chain with no dependency: require `FF D8`, then loop — skip
   `FF 01`/`FF D0..D7` (no payload), read every other marker's 2-byte big-endian length and skip it (so `APP0..APPn`, `DQT`, `DHT`,
   Exif and JFIF thumbnails are stepped over, not scanned for), and stop at the **first** `SOF` marker `FF C0..CF` excluding `C4` (DHT),
   `C8` (JPG) and `CC` (DAC) — covering baseline `SOF0`, extended `SOF1` and **progressive `SOF2`**. Counting from the byte immediately
   after the two marker bytes: `+0..1` is the segment length, `+2` the sample precision, **`+3..4` the big-endian `u16` height** and
   **`+5..6` the width**. No SOF, a zero dimension, or a length that runs past the buffer ⇒ **exit 3** naming the file.
   `bytes` is the file size, carried straight from the manifest into `exercise_media.bytes` (02 has the column; [r07's manifest
   shape](../docs/research/r07-exercise-dataset.md) `[{ r2Key, localPath, sha256, bytes, width, height }]` already produces it).
10. **Step 4 — R2.** Keys are stable and **not** commit-scoped: `exercises/<source_id>/<idx>.jpg`. Upload via
    `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` signed with `aws4fetch@1.0.20` ([r03
    §2(i)](../docs/research/r03-r2-uploads-and-image-delivery.md)) — never 1,746 `wrangler r2 object put` calls, which sit on the REST
    limit of 1,200 requests / 5 min. Per object: `HEAD` → if present with `src-sha256` equal to the manifest sha256, **skip**; else `PUT`
    with `Content-Type: image/jpeg`, `Cache-Control: private, max-age=31536000, immutable`, custom metadata `src-sha256`, `exdb-commit`,
    `w`, `h`. Concurrency 8; on 429 back off **per key** (1/2/4 s — R2 caps one write per second per key) then mark it failed; residual
    failures ⇒ **exit 4** after the rest finish. A completed seed re-runs as 1,746 HEADs and 0 PUTs; an interrupted run resumes where it
    stopped.
11. **Local vs remote.** `--target=local` → `wrangler d1 execute fitness-pwa-db --local --file=…` with `--images=skip` by default (local dev
    renders the placeholder instead of filling a throwaway `.wrangler/state`). `--target=remote` → `wrangler d1 execute fitness-pwa-db
    --remote --file=… -y` plus `--images=upload`. `--images=local` shells `wrangler r2 object put … --local` at concurrency 4 (**flag
    support UNVERIFIED** — check `wrangler r2 object put --help` first). Creds from gitignored `.env.seed`: `R2_ACCOUNT_ID`,
    `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_EXERCISE_BUCKET`; missing creds with `--images=upload` ⇒ exit 1 **before** the download.
12. **Dry run.** `--dry-run` does fetch, extract, validate, transform, SQL emission and all R2 HEADs and writes the report, but runs no
    `wrangler d1 execute` and no `PUT`. Prints statement count, max statement bytes, the first statement truncated to 400 chars, the
    `load_mode` and dimension histograms, and the uploaded/skipped split it *would* produce. Exit 0.

### Search and the local copy

13. **Search runs only on the client, over one Dexie store.** No server search endpoint exists: one ranking implementation, no drift, and
    the gym case (no signal) is the default case. The picker linearly scans ~930 rows per keystroke — at that size a scan beats any index.
    `search` is **derived locally and never transmitted**: `CatalogBundle.index` is `ExerciseWireRow[]`, and `buildSearchFields` runs inside
    the Dexie transaction that writes `catalogIndex`, so the compiler (two distinct types) enforces the wire budget. The four haystacks are
    `[normalizeQuery(name), normalizeQuery(nameRu), normalizeQuery(translitRu(nameRu)), foldTranslit(slot2)]`.
14. **Normalisation order is fixed, and it is not the obvious one.**
    (a) `normalizeQuery` runs **after** any transliteration, never before, and its diacritic stripping is **Latin-only**:
    `NFKD` → `.replace(/(\p{Script=Latin})\p{M}+/gu, "$1")` → `NFC` → lowercase → `ё`→`е` → drop `' ’ \``  → `[^\p{L}\p{N}]`→`" "` →
    collapse. NFKD decomposes `й` to `и + U+0306`; stripping marks unconditionally would turn it into `и`, making rule 14(b)'s `й y`
    entry unreachable and quietly corrupting every Cyrillic haystack. The Latin-only guard plus the NFC recomposition keeps `й` intact,
    while `é`→`e` still works. `ё`→`е` **is** folded, because Russians routinely type `е` for `ё` and the haystack must match either.
    (b) **RU transliteration** is our own single-pass table applied to the **raw** `nameRu`, so a Latin keyboard still finds RU names:
    `а a · б b · в v · г g · д d · е e · ё e · ж zh · з z · и i · й y · к k · л l · м m · н n · о o · п p · р r · с s · т t · у u · ф f ·
    х kh · ц ts · ч ch · ш sh · щ sch · ъ ∅ · ы y · ь ∅ · э e · ю yu · я ya`. Not a standard; it only has to be deterministic and
    unit-tested.
    (c) **`foldTranslit` closes the one-way gap.** The table above is invisible to the user, so `shchuka`, `huka`, `jim` and `zim` would
    find nothing above the subsequence tier. `foldTranslit` is an idempotent many-to-one collapse applied to **both** haystack slot 2 and
    the query, longest-match first: `shch|sch|sh → s`, `zh|j → z`, `ch|ts → c`, `kh → h`, `ya → a`, `yu → u`, `y → i`, then runs of the
    same letter collapse to one. So `жим` → `zhim` → `zim` and a query of `jim`, `zhim` or `zim` all reach it; `щука` → `schuka` → `suka`
    and `shchuka`/`schuka`/`shuka` all fold to the same `suka`. Matches on the folded slot carry the largest field penalty, so canonical
    spellings always win.
15. **Ranking rule.**
    (a) **`score = tier × SCORE_TIER_SCALE (1000) + boosts − fieldPenalty`.** Tiers: exact equality **1000**; name starts with the query
    **800**; some word in the name starts with it **600**; every query token is a word-prefix somewhere, any order **450**; ordered
    character subsequence **200 − min(150, gaps × 5)** (so 50–200, in steps of 5); else `null` (excluded). `boosts` ∈ `[0, 330]`:
    favourite **+150**; usage `min(120, round(30 × log2(1 + setCount)))`; recency on `max(lastSetAtMs, lastSelectedAtMs)` **+60** if ≤7 d,
    **+30** if ≤30 d, else 0. `fieldPenalty` ∈ `[0, 8]`: **0** on whichever field is actually displayed, **4** on the other-locale name,
    **6** on the canonical transliteration, **8** on the folded transliteration. The displayed field is slot 1 when
    `locale === "ru" && nameRu !== null`, otherwise slot 0 — so a catalogue row with no RU translation is *not* penalised in RU locale for
    displaying its English name, which the earlier fixed-slot rule did to all 876 rows.
    Because `MAX_BOOST (330) + MAX_FIELD_PENALTY (8) = 338 < 1000` and the smallest gap between two tier values is 5 (⇒ 5,000 in score
    units), **boosts order rows only inside a tier and can never cross one.** Worked: a tier-600 row with `setCount = 40` last trained
    yesterday scores `600 × 1000 + min(120, round(30 × log2 41)) + 60 = 600_180`, and an unused tier-800 row scores `800_000` — so the
    heavily-used word-start match still ranks below the unused prefix match, and an exact-name match at `1_000_000` is unbeatable. That is
    the point: typing an exercise's exact name surfaces it first, always. (The previous additive formula let 800 + 150 + 120 + 60 = 1130
    beat an exact match at 1000, and its own worked example, "930", was arithmetically wrong.)
    (b) **Tie-break, and why there is no `Intl` here.** score desc → shorter normalised displayed name → `compareCollated` → `id` asc.
    `compareCollated` compares a **pinned collation key** built from a frozen weight table in `normalize.ts` (Latin block, then Cyrillic
    block, each alphabetical, `ё` immediately after `е`; anything else falls through to its code unit at a higher offset). `Intl.Collator`
    is banned for the same reason `specs/07` rule 6 bans it: rule 30 runs `scoreExercise` **on the server** for duplicate detection, so the
    identical comparator executes in workerd and in the browser against different ICU builds, and V1 asserts deterministic collated order.
16. **Empty query = recent first:** rows with `setCount > 0 || selectionCount > 0` by `max(lastSetAtMs, lastSelectedAtMs)` desc (max 8,
    under a "Recent" header), then the filtered remainder by `compareCollated(displayed name)` then `id` asc.
17. **Filters** are AND across facets, OR inside a facet, applied *before* scoring. A muscle chip matches `primary` **or** `secondary`.
    The `other` equipment chip also selects `unknown` and is labelled "Other / unspecified (199)" — 22.7% of the library has no usable
    equipment value and must never be silently hidden ([r07 Gotcha 29](../docs/research/r07-exercise-dataset.md)). Chip counts come from
    `facetCounts()` evaluated against the *other* facets' selection. Rows with `deletedAtMs !== null` are excluded unless `includeDeleted`.
18. **Catalogue sync.** `GET /api/reference/exercise-catalog?part=index` returns `CatalogBundle` with `ETag: "<version>"`, `Cache-Control:
    private, max-age=0, must-revalidate`, and 304 on `If-None-Match`. The path sits under `/api/reference/` **because that is the only
    prefix spec 05's service worker gives a `StaleWhileRevalidate` (`reference-data`, 64 entries / 7 d)**; anything under
    `/api/exercises/` falls into its `NetworkOnly` catch-all.
    **`version` is derived from content, never hand-bumped:** `version = sourceCommit.slice(0,8) + "-" +
    maxUpdatedAtMs.toString(36) + "-r" + CATALOG_REV`, where `maxUpdatedAtMs` is
    `SELECT max(updated_at) FROM exercises WHERE source = 'free-exercise-db'` (one indexed read against 02's `exercises_updated_at_idx`).
    Every write that can change the bundle — a re-seed, an RU-name correction, a `load_mode` override — bumps `updated_at` through 02's
    `syncCols()`, so the version moves on its own and `CATALOG_REV` is reserved for **shape** changes. The serialised body is cached in KV
    binding **`CACHE_KV`** (spec 01 owns bindings and reserves the `cache:ex:*` prefix for this spec) under
    `cache:ex:catalog:<version>:index` / `:details`, always with `expirationTtl: 2_592_000` (30 d) — spec 01 requires a TTL on every write,
    and old versions then really do expire. A KV hit skips the table reads entirely.
    On boot and on first picker open the client compares the stored version, fetches `index` if it differs, writes it to `catalogIndex` in
    one Dexie transaction, then fetches `details` from an **idle callback with an explicit polyfill**:
    `const ric = window.requestIdleCallback ?? ((cb) => setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 200));`.
    `requestIdleCallback` is **not available on the primary install target**: caniuse (fetched 2026-09-12) lists Safari on iOS 13.4–26.6 and
    Safari 26.6–27 as "Disabled by default" (a WebKit feature flag) and every earlier version as unsupported, so a bare call throws
    `TypeError` on iPhone and `catalogDetails` would be permanently empty — which would make rule 26's instruction list permanently empty on
    the one device this app is built for. Estimated index ≈150 KB raw (no `search`), details ≈700 KB raw; wire sizes after Cloudflare's
    `Content-Encoding` are **not measured** — record them per V9. Every route here is `export const dynamic = "force-dynamic"` so a
    prerender cannot bake the dev machine's D1 rows into production; `getCloudflareContext()` is called per request, never at module top
    level, and the drizzle instance is never memoised in a module global ([r02
    §2.1](../docs/research/r02-drizzle-d1-access-and-migrations.md)).
19. **The catalogue owns its own Dexie stores; the sync engine never touches them.** Spec 05 declares one generic `mirror` store keyed
    `[table+id]` and lists `exercises` among its **pull-only** mirror tables, so a bundle write into `mirror` would clobber `rev`/`dirty`
    and a sync pull would wipe the derived `search`. Instead this spec contributes **`catalogIndex` / `catalogDetails` / `catalogUsage`**
    (see §Changes owed) as *local-only projections*: nothing in `src/lib/sync` reads or writes them, and they are excluded from the pull
    cursor. Custom exercises still arrive through the normal sync as `mirror` rows with `table: "exercises"`; `projectExercises()` runs at
    the end of every successful pull and every local `writeLocal()` touching `exercises`, upserting each `usr:` mirror row into
    `catalogIndex` with its `search` fields rebuilt. One store therefore backs one scan over both origins, while the sync engine keeps a
    single authoritative mirror. The version bump is `db.version(2)`, made by `specs/05` in `src/db/local.ts`.
20. **`setCount` — server truth, exactly one writer.** `GET /api/exercises/usage` returns the top 200 `{ id, setCount, lastSetAtMs }`
    derived from `sets` (one GROUP BY over 02's covering `sets_exercise_id_completed_at_idx`), and it is the **only** writer of those two
    fields on `catalogUsage`; the client overwrites them wholesale on boot and after every successful sync pull, and a failed refresh
    leaves the stored values alone. There is no max-merge and no `>` comparison, because the earlier design compared a count of logged sets
    with a count of picker selections — incommensurable quantities whose meaning depended on which side wrote last.
21. **Picker states.** (a) *Catalogue present*: results render synchronously — no spinner, ever. (b) *Absent, online*: 8 shimmer rows
    while fetching, with "create custom exercise" already enabled. (c) *Absent, offline*: blocking empty state
    `ExerciseLibrary.catalogNotLoaded` plus the create action. (d) *Fetch failed*: inline error row with `ExerciseLibrary.retry`; a stored
    catalogue is never discarded because a refresh failed. (e) *Zero results*: `ExerciseLibrary.noResults` with
    `ExerciseLibrary.clearFilters` (only when filters are active) and a primary `ExerciseLibrary.createFromQuery` prefilled with the query.
    Every string is a message key — rule 38.
22. **Selection** returns `{ id, name, equipment, loadMode, primary }` to the caller (specs 06/09), closes the sheet, fires a light haptic,
    and increments the **local-only** `selectionCount` and stamps `lastSelectedAtMs` **on selection** (not on set completion). That alone
    lifts the row's recency boost to +60, so the session's second search already ranks it higher, offline, with no server round trip — and
    it never contaminates `setCount`.
23. **Virtualisation and the upward-growing list.** The scroller renders the ranked array in **reverse order** — worst match at the top of
    the DOM, best match at the bottom, immediately above the input — and is parked at `maxScrollTopPx` on open. That keeps `scrollTopPx`
    ordinary top-anchored scroll math (no `column-reverse`, whose inverted `scrollTop` semantics would break `padTopPx`, and no
    `ResizeObserver`): `windowSlice()` renders at most `ceil(viewportPx / rowPx) + 2 × overscanRows` nodes (`overscanRows = 4`) with a
    `padTopPx` spacer inside a `totalPx` container, and the component maps `reversedIndex → rankIndex = count − 1 − reversedIndex` when
    rendering, so no array is copied per keystroke. **"Scroll resets" means `scrollTop = maxScrollTopPx`** — the bottom, i.e. rank 1 — on
    any query or filter change. `rowPx` is a **parameter** supplied by the caller from the active mode's token (`--spacing-gym`, 72px);
    `windowSlice` contains no literal row height, proved by a V1 case at `rowPx: 88`.

### Detail view

24. **Media.** Up to two images (start/end position) from `/api/media/exercise/<sourceId>/<idx>?v=<sha8>`, `loading="lazy"`,
    `decoding="async"`, and the **stored** `width`/`height` as attributes — dimensions vary (`850x567` dominant, `500x750` and `850x1275`
    verified outliers), so a hardcoded aspect ratio crops heads and costs CLS ([r07 Gotcha 14](../docs/research/r07-exercise-dataset.md)).
    Position 1/2 is a segmented toggle with a crossfade, never an autoplay loop: these are stills, and only the selected position is in the
    DOM, so one image is fetched at a time.
    **Deviation from the brief's "responsive AVIF images via R2/Images", stated rather than hidden.** v1 serves the original JPEGs
    unmodified: no `srcset`, no `sizes`, no resize, no AVIF/WebP, no Cloudflare Images. Measured worst case ([r07 §6](../docs/research/r07-exercise-dataset.md)):
    per image min 15,378 · p50 54,678 · p90 78,421 · p99 114,957 · **max 919,342** bytes, so a detail view costs ~55 KB typically and
    **1.84 MB** for the single worst pair if the user toggles position. Accepted for v1 on four grounds: the images are **not on any LCP
    path** (rule 25 keeps every list row photo-free, and `/exercises` is budgeted 120 KB gz by `specs/16` rule 21), one position is loaded
    at a time, spec 05's `exercise-media` CacheFirst entry makes the second view free for 90 days, and the encoder dependency a resize
    would add is exactly what the seed script currently avoids. The key scheme reserves `…/<idx>.display.webp` (≈800 px) beside
    `…/<idx>.thumb.webp` so a derived-variant pass is additive. Open question 2 owns the decision, for rows **and** the detail view.
25. **List rows carry no photo** — a monogram tile (initials + primary-muscle colour dot) instead. 30 visible rows would mean 30 requests
    of ~55 KB (dataset p50) for a 56px tile, on gym Wi-Fi, on the hottest path; and 3 exercises have no images at all. Photos appear in
    the detail view and the exercise header only.
26. **Instructions** render as an ordered list up to 24 steps. The 5 records with `instructions: []` show
    `ExerciseLibrary.noInstructions`; never read `instructions[0]` as a preview without a length check ([r07 Gotcha
    4](../docs/research/r07-exercise-dataset.md)).
27. **Muscles.** Primary chips filled, secondary outlined, up to 10 secondary in a horizontally scrolling row — no silent truncation.
    Tapping a chip opens the library filtered by that muscle.
28. **History and e1RM.** `GET /api/exercises/[id]/history` returns the 30 most recent sessions; offline the same view is computed from
    the local Dexie mirror. `sets[]` carries **every** non-deleted set including warmups, each flagged by `setType`, while `volumeKg` is
    `totalVolumeKg(sets)` from `specs/07` — **counted sets only, per `isCountedSet`**, which keeps drop/failure/amrap work in the total and
    makes this view agree with the analytics dashboard (the earlier "working sets only" silently discarded three of 02's five `SET_TYPES`).
    `e1rmSeries` = `buildE1rmSeries()` over the **stored** `sets.e1rm_kg` per Asia/Almaty calendar day, keeping the maximum per day and
    skipping `null`; the formula is owned by `specs/07` and this module never recomputes it. The chart is `specs/12`'s visx
    `src/components/analytics/e1rm-chart.tsx`, imported with `next/dynamic` — **Recharts is not used anywhere** (12 rule 24: 147,530 B gz
    is 72% of a route budget). 0 sessions → `ExerciseLibrary.noHistory` and no chart element at all; exactly 1 point → the value as a large
    numeral, no axes.

### Custom exercises, favourites, deletion

29. **Id namespacing.** `usr:<26-char ULID>` generated **client-side** with `crypto.getRandomValues` — never `Math.random`, never an
    autoincrement integer — so the offline queue owns a stable id before the row reaches the server and a retried `POST` is idempotent
    (returns the stored row, 200, not a duplicate) ([r03 §5](../docs/research/r03-r2-uploads-and-image-delivery.md), [r07 Gotcha
    13](../docs/research/r07-exercise-dataset.md)). The client also computes a provisional `slug`; the server re-slugs on collision
    (`-2`, `-3`, …) and returns the row, so 02's `U(slug)` can never 409 a legitimate create. The seed writes only `fedb:` ids, so a
    re-seed can never collide with or renumber a user row.
30. **Duplicate detection is advisory.** On create the server scores the new name against the catalogue with the same `scoreExercise`; a
    best `Math.floor(score / SCORE_TIER_SCALE) >= 600` returns as `duplicateOf` and the form offers
    `ExerciseLibrary.duplicateSuggestion` with both paths. It never blocks the create. This is why rule 15(b)'s comparator must be
    `Intl`-free: the same function runs here in workerd and in the browser.
31. **Delete is always soft.** `DELETE /api/exercises/[id]` sets `deleted_at` (02 rule 25: soft delete is the default for all user data,
    and a custom exercise is not one of the six permitted hard deletes) and returns 200 with `{ deletedAtMs }`. There is **no** hard-delete
    branch and no bespoke `archived` column: `deleted_at` already gives the wanted semantics — the row vanishes from search while every
    logged set stays intact — and it is the tombstone spec 05's LWW conflict resolution needs. `sets.exercise_id`'s `onDelete: "restrict"`
    means a real row removal would fail loudly at the database anyway. Catalogue rows are never deletable. **Catalogue rows are also not
    hideable in v1** — the earlier `exercise_prefs.hidden` claim referenced a table 02 does not define; if hiding is wanted it is one
    additive `exercises.hidden` column plus a `matchesFilters` branch, and it belongs in a later phase, not in a spec that cannot amend 02.
32. **Favourites are implemented end to end, on 02's existing column.** `exercises.is_favourite` (02 line 188) is the store; a star
    affordance sits on the result row's trailing edge and in the detail header; the toggle is an `exercise.patch` op (see §Changes owed) so
    it works offline and survives reinstall through the pull; `ExerciseFilters.favouritesOnly` filters on it; and it is the single largest
    ranking boost (+150). `PATCH /api/exercises/[id]` accepts `{ isFavourite }` for **both** origins — favouriting a seeded row is one of
    the four fields rule 8's narrowed `DO UPDATE SET` deliberately never overwrites.
33. **Custom exercises have no media in v1** — the monogram placeholder everywhere, which keeps the user-photo pipeline
    (`specs/10-body-photos.md`) out of the picker's hot path.

### Media read path, licensing, i18n

34. **The route never builds an R2 key from user input.** It validates `sourceId` against `^[0-9a-zA-Z_-]{1,64}$` (the dataset's verified
    id pattern) and `idx` against `^[0-3]$` (02's `exercise_media.idx` CHECK is `C(0..3)`; the seed only ever writes 0 and 1). **A
    malformed `sourceId` or `idx` is `400`** — distinct from `404`, which means "the pattern was fine and no `exercise_media` row exists",
    so a test can tell path rejection from a missing record. It requires a session (`401` before any R2 call), looks up `exercise_media` by
    `('fedb:' + sourceId, idx)` and uses the **stored** `r2_key` (02 makes it `UNIQUE`). Then `bucket.get(key, { onlyIf: req.headers })`,
    `writeHttpMetadata(headers)`, `ETag` from `httpEtag` (already quoted), and **`304`** for a matched `If-None-Match` on GET — not the
    `412` Cloudflare's own sample returns, which makes browsers re-download forever ([r03
    §3](../docs/research/r03-r2-uploads-and-image-delivery.md)). **No `Range` support and never a `206`:** nothing in the app
    range-requests a still, and spec 05 attaches `RangeRequestsPlugin` only to `/api/photos/`, so advertising ranges here would be dead
    code the service worker cannot honour.
35. **`Cache-Control: private, max-age=31536000, immutable` when `?v` equals the stored `sha256[0:8]`; `private, max-age=0,
    must-revalidate` when it does not.** A deliberate departure from r07's suggested `public`: the route is auth-gated and the media are
    unlicensed third-party content, so they must never enter a shared cache. `immutable` is honest only because `v` changes when the bytes
    change.
36. **Attribution is owed even though the Unlicense requires none, and it is mounted on a real page.** `DataSourceNotice` renders the text
    from [r07 §Step 5](../docs/research/r07-exercise-dataset.md): provenance, pinned commit `a859101d` (2026-08-30), retrieval 2026-09-12,
    derivation from `wrkout/exercises.json`, and the image paragraph — origin unknown, the original author does not hold the copyright,
    included for private personal use and **not licensed for redistribution**. It is mounted from `src/app/(app)/settings/about/page.tsx`
    (created here, because no other spec owns an About or Data-sources screen — `specs/15` owns only `settings/data`), linked from
    `/settings`, and the full Unlicense text is vendored at `src/app/licences/page.tsx` (also created here). The same fact is stored per
    row as `exercises.image_licence = 'unknown-third-party'` (02 line 187) so a future purge is programmatic rather than from memory.
37. **The exercise-media bucket is private and separate** from the user-photo bucket: binding `EXERCISE_MEDIA`, bucket
    **`fitness-exercise-media`** verbatim from [`specs/01-architecture.md`](01-architecture.md) line 94, which owns binding names. (02's
    §Data calls the same bucket `MEDIA`; that is drift and is flagged in §Changes owed.) Never `r2.dev`, never a public custom domain — a
    public bucket would publish unlicensed media. A whole-media swap is then a bucket swap with no schema change.
38. **i18n decision: an AI first pass curated over time — RU names in D1, English instructions, bilingual search.**
    (a) `scripts/translate-exercise-names.mts` produces `seed/exercise-names.ru.json` (`fedb:<id>` → `{ ru, reviewed:false }`) **once**, and
    the seed writes it into **`exercises.name_ru`** so D1 stays the source of truth for every consumer (import matching, export, the AI
    coach) — the earlier read-time merge from a JSON file left 02's `name_ru` column permanently NULL. The JSON file remains committed seed
    input and is reviewable; `exercises.name_ru_reviewed` (owed to 02) carries the review state, and rule 8's `CASE` lets a corrected JSON
    file update only unreviewed rows.
    (b) **The user can correct any name in the app** — the brief's principle is "honest data (show AI confidence, **let the user
    correct**)", and a repo file plus a redeploy is not correctability. The detail view has a rename field; `PATCH /api/exercises/[id]
    { nameRu }` sets `name_ru` **and** `name_ru_reviewed = true`, syncs as an `exercise.patch` op, and bumps `updated_at`, which moves the
    catalogue version (rule 18) so every client refetches.
    (c) In RU locale the row shows the RU name primary **and the English name as a dimmed secondary line while `nameRuReviewed === false`**,
    so an unreviewed machine translation is always checkable against the original; `true` hides it. A missing entry falls back to the
    English name — no error, no placeholder.
    (d) Instructions stay English in both locales in v1, with `ExerciseLibrary.instructionsEnglishOnly`; wrong RU instructions in the gym
    are worse than English ones. (e) Search always matches EN, RU, RU-translit and the fold regardless of locale, so a bad RU name can
    never make an exercise unfindable. wger was rejected as an RU source: **10 Russian translations of 862 exercises**, plus per-row
    CC-BY-SA share-alike obligations ([r07 §8, Gotchas 23–25](../docs/research/r07-exercise-dataset.md)).
    (f) **The translation script's provider path, and what is UNVERIFIED.** It is a dev-machine Node script, so it does **not** import
    `getTextModel()` (app code that reads provider config from the Worker env). It reads `GOOGLE_GENERATIVE_AI_API_KEY` from `.env.seed`
    directly and calls `generateObject` with the pinned id **`gemini-2.5-flash-lite`** — `specs/11`'s `AI_MODELS.google.text.primary`,
    priced $0.10 in / $0.40 out per 1M tokens in [stack-facts §"Gemini model IDs + price"](../docs/research/stack-facts.md). Never a
    floating alias. Cost estimate for 876 names batched 50 per call (~18 calls, ~1.5 K in / ~1.5 K out per call ⇒ ~27 K in / ~27 K out):
    **≈$0.014 total**, i.e. rounding error. The `ai_prompt_logs` rows are **not** written by the script directly (D1 is not reachable from
    plain Node): the script emits `seed/ai-prompt-logs.sql` with one literal `INSERT` per call — `provider`, `model`, `prompt_version`
    `"exercise_names_ru@1"`, `feature`, `input_ref = "sha256:<hex of the batch>"`, token counts, `cost_usd`, `latency_ms` — applied by the
    same `wrangler d1 execute` step as the rest of the seed. **UNVERIFIED:** that `gemini-2.5-flash-lite` returns usable RU exercise names
    at this batch size, and the real token counts; both are measurable on the first run and land in `ai_prompt_logs`.
39. **Every user-facing string is a message key in the `ExerciseLibrary` namespace**, extended into repo-root `messages/{ru,en}.json` (the
    path [r11 §File layout](../docs/research/r11-i18n-on-next16-workers.md) fixes and `specs/03` owns). The catalogue seed file is
    `seed/exercise-names.ru.json`, deliberately **outside** `messages/` so next-intl's `messages/${locale}.json` loader can never pick it
    up. Keys, RU / EN:

    | Key | ru | en |
    |---|---|---|
    | `catalogNotLoaded` | Библиотека упражнений ещё не загружена. Подключитесь один раз, чтобы скачать (~250 КБ). | The exercise library hasn't been downloaded yet. Connect once to fetch it (~250 KB). |
    | `noResults` | Ничего не найдено по «{query}» | Nothing found for “{query}” |
    | `clearFilters` | Сбросить фильтры | Clear filters |
    | `createFromQuery` | Создать «{query}» как своё упражнение | Create “{query}” as a custom exercise |
    | `retry` | Повторить | Retry |
    | `recentHeader` | Недавние | Recent |
    | `equipmentOther` | Другое / не указано ({count}) | Other / unspecified ({count}) |
    | `noInstructions` | В источнике нет инструкций для этого упражнения. | The source has no instructions for this exercise. |
    | `instructionsEnglishOnly` | Инструкции доступны только на английском. | Instructions are available in English only. |
    | `noHistory` | Вы ещё не выполняли это упражнение | You haven't done this exercise yet |
    | `duplicateSuggestion` | Похоже на «{name}» — использовать его? | Looks like “{name}” — use that one? |
    | `favourite` / `unfavourite` | В избранное / Убрать из избранного | Add to favourites / Remove from favourites |
    | `archive` | Удалить упражнение | Delete exercise |
    | `renameRu` | Исправить название | Fix the name |
    | `imageAlt` | {name} — позиция {n} | {name} — position {n} |

40. **`volume_weights` is the runtime source; `VOLUME_WEIGHT_SEED` is only its seed input.** 02 line 180 defines the table (`role` PK,
    `credit`, seeded 1.0 / 0.5) and 02 rule 24 repeats the seeding, so two sources of truth would let a tuned row and a TypeScript constant
    disagree while the heatmap silently reads whichever the caller touched. Rule 7's SQL upserts the table **from** the constant, `specs/12`
    reads the table, and V4 asserts the seeded rows equal the constant.
41. **`load_mode` is user-editable.** The detail view exposes it as a select (the six `LOAD_MODE` values with plain-language labels);
    `PATCH /api/exercises/[id] { loadMode }` writes it for both origins and syncs as an `exercise.patch`. Rule 8 keeps a re-seed from
    reverting it. This is the escape hatch for every row the rule-6(b) heuristic gets wrong — an assisted machine the dataset named without
    "assisted", a distance-logged cardio row, a weighted dip.
42. **UPSERT probe**, run as seed step 3.5 before the first apply: `CREATE TABLE IF NOT EXISTS _upsert_probe(id TEXT PRIMARY KEY, n
    INTEGER)`, two upserts, `SELECT`, assert `n = 2`, drop. Cloudflare does not document UPSERT support ([r07 §Step
    3](../docs/research/r07-exercise-dataset.md)); failure ⇒ **exit 1** naming the fallback (`UPDATE`, then
    `INSERT … WHERE changes() = 0`).

## Data

D1 DDL is owned by `specs/02-data-model.md` and the names below are **its** names, not r07's two-table sketch; shapes are what this module
reads and writes.

- **`exercises`** (02 `library.ts`) — one table for seeded **and** user rows, per 02 rule 23. Seed writes `source='free-exercise-db'` rows;
  custom CRUD writes `source='user'`. `id` = `fedb:<source_id>` | `usr:<ULID>`, `source`, `source_id?`, `source_commit?`, `name`,
  `name_ru?`, **`name_ru_reviewed`** (owed to 02), `slug` **NOT NULL `U(slug)`**, `force?`, `level`, `mechanic?`, `equipment`, `category`,
  **`load_mode`** (`NOT NULL`, default `'external'`), `instructions_json` (`'[]'` ×5, `C(len≤65536)`), `image_licence`, `is_favourite`,
  `...syncCols()` (`created_at`, `updated_at`, `rev`, `deleted_at`), `U(source,source_id)`, `I(equipment)`, `I(updated_at)`.
- **`exercise_muscles`** (seed + custom writes; filters and specs/12 read) — `exercise_id → exercises.id` (a real FK with
  `onDelete:"restrict"`; the old "no FK because a second table holds `usr:` rows" rationale is moot under one table), `muscle`, `role`,
  `P(exercise_id,muscle,role)`, `I(muscle,role,exercise_id)`. No `syncCols` — rebuilt on re-seed. 877 primary + 1,719 secondary = 2,596
  seeded rows. Rule 4(c) makes a duplicate or a primary/secondary overlap an exit-3 abort, not a PK error and not a 1.5× credit.
- **`exercise_media`** (seed writes; media route + bundle read) — `exercise_id → exercises.id`, `idx C(0..3)`, `r2_key` **UNIQUE**,
  `sha256`, `width`, `height`, **`bytes`**, `P(exercise_id,idx)`. 1,746 rows, all `idx ∈ {0,1}`.
- **`volume_weights`** (seed writes; specs/12 reads) — `role` PK, `credit`, `updated_at`. Upserted from `VOLUME_WEIGHT_SEED` (rule 40).
- **`ai_prompt_logs`** (seed writes, via emitted SQL) — one row per translation batch (rule 38f).
- **Read-only here:** `sets` (`exercise_id` — a **real FK** to `exercises.id` with `onDelete:"restrict"`, TEXT, never an integer;
  `weight_kg REAL`, `assist_kg REAL`, `reps`, `rpe REAL`, `rir REAL`, `set_type ∈ SET_TYPES`, `e1rm_kg REAL`, `is_pr`, `local_day`),
  `workouts` (`local_day TEXT` Asia/Almaty, `started_at INTEGER`, `bodyweight_kg REAL`).
- **KV `CACHE_KV`** (binding per `specs/01`, which reserves the `cache:ex:*` prefix): `cache:ex:catalog:<version>:index`,
  `cache:ex:catalog:<version>:details` — the exact serialised response bodies, always written with `expirationTtl: 2_592_000`.
- **R2 `EXERCISE_MEDIA`** (bucket `fitness-exercise-media`): `exercises/<source_id>/<idx>.jpg` — 1,746 objects, 98,671,281 bytes
  (94.10 MiB), ≈$0.0015/month storage, ≈$0.0079 one-off Class A. Custom metadata `src-sha256`, `exdb-commit`, `w`, `h`. **No commit SHA in
  the key** — that would force a full re-upload per bump and orphan the old set. Reserved: `exercises/<source_id>/<idx>.thumb.webp`,
  `exercises/<source_id>/<idx>.display.webp`.
- **IndexedDB** — three **local-only projection** stores this spec requests from `specs/05` as `db.version(2)` (§Changes owed):
  `catalogIndex: "id, origin, equipment, category, *search"` (the `*search` multiEntry index the fuzzy scan needs is declared here, not
  assumed), `catalogDetails: "id"`, `catalogUsage: "id, lastSelectedAtMs"`. The catalogue version and fetch time live in spec 05's existing
  `meta` store under `catalogVersion` / `catalogFetchedAtMs`. Custom-exercise rows stay in spec 05's `mirror` store and are *projected*
  into `catalogIndex` (rule 19); nothing here writes `mirror`.
- **Gitignored artefacts:** `.cache/free-exercise-db-<commit>/`, `.cache/exercises.sql`, `.cache/images.manifest.json`,
  `.cache/seed-report.json`.

## UX notes

- The picker is a **bottom sheet**, not a page: `specs/03`'s `BottomSheet` with its default snap points **`[0.55, 0.92]`** (03 rule 10 —
  never a bespoke "60%/full"; a true 1.0 would collide with the safe-area insets 03 manages), swipe-down to dismiss, opened over the live
  workout so the session never unmounts. The library *page* is for browsing; the logging path never navigates away.
- **The search field sits at the bottom of the sheet, directly above the keyboard, and results grow upward from it**, so the top result is
  closest to the thumb. Do not move the input to the top out of habit. **Mechanism, named:** the results scroller is normal-order with the
  ranked array rendered in reverse (rule 23), parked at `maxScrollTopPx`; the keyboard inset comes from **`window.visualViewport`** —
  `kbInset = Math.max(0, window.innerHeight − visualViewport.height − visualViewport.offsetTop)`, recomputed on its `resize` and `scroll`
  events, rAF-throttled, written to a `--kb-inset` custom property the sheet pads with. `VisualViewport` is the only cross-platform option
  here (caniuse, fetched 2026-09-12: Safari on iOS **13+**, Chrome 61+); `interactive-widget=resizes-content` is Chromium-only and
  `env(keyboard-inset-height)` needs the VirtualKeyboard API, which iOS does not ship — neither is used. This is the same hazard `specs/03`
  rule 11 built the NumberPad to dodge.
- The keyboard auto-opens only when the sheet was opened from the "add exercise" action, not from a filter chip or the library page.
- Haptics: light impact on row select and chip toggle; nothing on scroll; nothing on sheet open. Confetti belongs to PRs, not here.
- Skeleton = 8 rows of 72px, each a shimmering 40px monogram square plus two grey bars (60%/35%). Never a centred spinner.
- Motion: sheet spring per `specs/03-design-system.md`; media toggle crossfades 150 ms. Under `prefers-reduced-motion` the crossfade
  becomes an instant swap and the sheet slide an opacity fade.
- **a11y — the full combobox contract**, because `specs/16` rules 25–26 run axe with WCAG 2.1 AA tags on `/exercises` and fail CI on **any**
  violation (max 3 suppressions repo-wide). The input is `role="combobox"` with `aria-expanded`, `aria-controls="exercise-listbox"`,
  `aria-autocomplete="list"` and `aria-activedescendant` pointing at an option inside that listbox — `aria-activedescendant` on a bare
  textbox is not a valid ARIA composite and announces nothing. The listbox is `role="listbox"` with an `aria-label`; each rendered row is
  `role="option"` with `aria-selected`, **`aria-setsize`** = the filtered total (up to 930) and **`aria-posinset`** = the **rank** index + 1,
  which is what makes a 14-of-930 virtualised window announce "option 3 of 930" instead of "of 14" — and which is also why the reversed DOM
  order is safe, since `aria-posinset` carries the true position. Rows are **72px, and ≥72px in GYM MODE** (`--spacing-gym`) — never
  smaller, correcting an earlier "≥56px in gym mode" that inverted `specs/03` rule 8's floor and would have shrunk targets for a sweaty,
  gloved, one-handed user. The result count is announced in a polite live region debounced to 300 ms so keystrokes do not interrupt each
  other; the full name is the accessible name and the muscle/equipment line is `aria-describedby`; chips are `role="switch"` with
  `aria-checked`; images use the localised `ExerciseLibrary.imageAlt` and the monogram placeholder is `aria-hidden`.

## Risks

| Risk | Mitigation |
|---|---|
| **Image copyright is unknown-to-infringing** — the original author states the images were scraped and that he does not hold the rights ([r07 §2](../docs/research/r07-exercise-dataset.md)). | Private bucket, auth-gated route, `private` cache headers, per-row `image_licence`, the `/settings/about` + `/licences` screens **created by this spec** (rule 36), media layer swappable behind one route. Owner decision: Open question 1. |
| **Upstream deletes or replaces the images** (their issue #13 discusses exactly that). | The sha256 tripwire hashes the bytes about to be used and aborts with exit 2 on any provenance; R2 already holds our copy; nothing hotlinks `raw.githubusercontent.com`. |
| **A re-seed destroys logged sets or reverts user edits** via a REPLACE cascade, renumbered ids, or a too-wide `DO UPDATE SET`. | Upsert only; string ids read from the record; namespaced prefixes; the narrowed SET list of rule 8; a unit test asserts the SQL contains no `REPLACE`, no `DELETE FROM exercises`, and that `load_mode`/`name_ru_reviewed`/`is_favourite`/`deleted_at` never appear in a SET clause; V5 diffs the `sets` count and a hand-set favourite across a re-run. |
| **D1 UPSERT is undocumented.** | The probe in rule 42 runs before every apply, with a documented fallback. |
| **Mojibake in the seed file on Windows** (`¾ ° —`). | Explicit UTF-8 without BOM from Node `fs`; a unit test asserts the `3/4 Sit-Up` bytes round-trip and byte 0 is not `0xEF`. |
| **The picker janks on a low-end phone** as custom exercises accumulate. | Fixed-height windowing over a parameterised `rowPx`, `useDeferredValue` on the query, four haystacks precomputed at Dexie-write time, plus a Playwright budget of <150 ms to first painted result. |
| **The Dexie copy is evicted or stale**, leaving a silently empty picker. | Content-derived version checked on boot and on picker open; a stored catalogue is never discarded on a failed refresh; the offline empty state names the fix; the projection stores are local-only so a sync pull cannot wipe them. |
| **`requestIdleCallback` throws on iPhone**, leaving instructions permanently empty. | The explicit polyfill in rule 18, plus V10 running the assertion on a **WebKit** Playwright project, not only Chromium. |
| **Unreviewed RU translations read as authoritative** and mislead in the gym. | `name_ru_reviewed` per row; the English name stays visible until reviewed; search matches both; an in-app rename sets `reviewed = true` (rule 38b). |
| **22.7% of the library has no usable equipment value**, so chips imply a false partition. | An explicit merged "Other / unspecified (199)" chip; facet counts always sum to the visible total, asserted by a unit test. |
| **1,746 R2 PUTs hit a rate limit.** | S3 endpoint (not the REST path), concurrency 8, per-key exponential backoff on 429, HEAD-skip resume, exit 4 on residual failure. |
| **A 919 KB JPEG ships whole to a 390 px phone** (the brief's AVIF NFR is not met). | Deviation stated with measured numbers in rule 24; one position in the DOM at a time; `exercise-media` CacheFirst for 90 d; no images on any list row or LCP path; derived-variant keys reserved. Owner decision: Open question 2. |

## Verification

Run from the repo root; each check must produce the stated observable result.

- **V1 — units.** `npx vitest run tests/unit/exercise-*.test.ts tests/unit/seed-sql.test.ts` → PASS, 0 failures. Required cases:
  **taxonomy** — `DATASET_MUSCLE_MAP` has exactly 17 entries mapping to 17 distinct keys and `DATASET_EQUIPMENT_MAP` exactly 13;
  `toMuscleKey("quads")` throws; `toEquipmentKey(null) === "unknown"`; `toEquipmentKey("e-z curl bar") === "ez_bar"` (**not** `barbell`);
  every key has a rollup; `VOLUME_WEIGHT_SEED.primary === 1.0 && .secondary === 0.5`.
  **loadmode** — the five branches in rule 6(b)'s order over a fixture table: `{category:"strength",equipment:"machine",name:"assisted
  pull up"}` → `assisted`; `{cardio, …}` → `duration` (never `distance`); `{stretching, bodyweight, …}` → `duration` (branch 3 precedes
  branch 4); `{strength, bodyweight, "weighted dip"}` → `bodyweight_plus`; `{strength, bodyweight, "3 4 sit up"}` → `bodyweight`;
  `{strength, barbell, …}` → `external`; plus the verified dataset record `3_4_Sit-Up` (`body only`, `strength`) → `bodyweight`.
  **slug** — `slugify("Child's Pose") === "childs-pose"`; `slugify("Farmer's Walk") === "farmers-walk"` (both of the 7 apostrophe names in
  the fixture); `slugify("3/4 Sit-Up") === "3-4-sit-up"`; `slugify("Bicycling, Stationary") === "bicycling-stationary"`; two fixture names
  slugifying identically produce `x` and `x-2` in `id`-ascending order, stable across two runs.
  **normalize** — `normalizeQuery("Child's Pose") === "childs pose"`; `normalizeQuery("3/4 Sit-Up") === "3 4 sit up"`;
  `normalizeQuery("Café") === "cafe"`; **the full write-time pipeline** on `Жим лёжа` yields
  `["", "жим лежа", "zhim lezha", "zim leza"]` for a row with that `nameRu` — `ё` folded to `е` in slot 1 while slot 2 keeps rule 14(b)'s
  `ё e`; the same pipeline on `Йога` yields `йога` in slot 1 (the `й` **survives**, it does not become `и`) and `yoga` in slot 2;
  `translitRu("Щука") === "schuka"`; `foldTranslit("schuka") === foldTranslit("shchuka") === foldTranslit("shuka")`;
  `buildSearchFields` returns 4 entries with `""` in slots 2–4 for a null `nameRu`; `compareCollated` output is **byte-identical with
  `globalThis.Intl` deleted**.
  **rank**, over a fixture of 12 names copied verbatim from the pinned dataset (`3/4 Sit-Up`, `Pallof Press`, `Push Press`, `Farmer's Walk`,
  `Child's Pose`, `Iron Cross`, `Side Bridge`, `Side Jackknife`, `Kettlebell Halo`, `Kettlebell Halo With Overhead Extension`,
  `Bicycling, Stationary`, `Lying Close-Grip Barbell Triceps Extension Behind The Head`) — `"pallof press"` scores `Pallof Press` at exactly
  `1_000_000`; `"push"` gives `Push Press` `800_000` while `Side Bridge` returns `null`; `"press"` puts both press rows in tier 600 ordered
  by name length; `"farmers"` matches `Farmer's Walk` after apostrophe stripping; `"kholo"` matches `Kettlebell Halo` only through the
  subsequence tier (`tierOf(score) <= 200`); a **RU-query** `жим` matches a row whose `nameRu` is `Жим лёжа`, and so do `jim` and `zhim`
  (fold tier, penalty 8); a tier-600 row with `setCount = 40` and `lastSetAtMs = nowMs − 86_400_000` scores **`600_180`** and still ranks
  **below** an unused tier-800 row at `800_000`; **the tier invariant**, asserted exhaustively — for every ordered pair of distinct tier
  values and every extreme of (favourite, `setCount ∈ {0, 40}`, recency ∈ {none, 7 d, 30 d}, `fieldPenalty ∈ {0, 8}`),
  `tierOf(scoreLow) < tierOf(scoreHigh)` and `scoreLow < scoreHigh`; a row with `nameRu === null` scores **identically** in `locale:"ru"`
  and `locale:"en"`; two calls with a frozen `nowMs` return identical output.
  **filter** — a muscle chip matches a secondary-only row; `other` returns `other + unknown`; facet counts sum to the filtered total;
  `favouritesOnly` returns exactly the `isFavourite` rows; rows with `deletedAtMs !== null` are excluded by default and included under
  `includeDeleted`.
  **window** — `windowSlice({scrollTopPx:0,viewportPx:720,rowPx:72,count:876,overscanRows:4})` →
  `{startIndex:0,endIndex:14,padTopPx:0,totalPx:63072,maxScrollTopPx:62352}`; at `scrollTopPx: maxScrollTopPx` `endIndex` clamps to 876;
  `count:0` → `startIndex === endIndex === 0` and `maxScrollTopPx === 0`; the **same call at `rowPx: 88`** returns
  `totalPx: 77088` with no other change in shape, proving no row height is hardcoded.
  **jpeg** — hand-built byte arrays: `FFD8` + an `APP0` segment whose length must be skipped + `SOF0` declaring 1275×850 + `FFD9` →
  `{width:850,height:1275}`; the same with `SOF2` (progressive) → the same result; a `DHT` (`FFC4`) before the SOF is skipped, not mistaken
  for one; a segment length running past the buffer throws; a buffer with no SOF throws.
  **history** — `buildE1rmSeries` keeps the per-day maximum, drops `null` entries, and returns days oldest-first (V11 owns the vectors).
  **seed-sql** — `Child's Pose` emits `'Child''s Pose'`; no statement >90,000 bytes; output contains `ON CONFLICT(id) DO UPDATE SET` and
  neither `INSERT OR REPLACE` nor `BEGIN`; **no `SET` clause mentions `load_mode`, `name_ru_reviewed`, `is_favourite` or `deleted_at`**, and
  the `name_ru` SET clause is the `CASE WHEN name_ru_reviewed = 0` form; the emitted `exercises` INSERT column list **covers every NOT NULL
  column that has no SQL default**, computed from `getTableColumns(exercises)` rather than typed out, so a future NOT NULL addition in 02
  fails this test instead of the seed (this is the check the missing `slug` and `load_mode` would have tripped); byte 0 is not `0xEF`; `¾`
  survives as `0xC2 0xBE`.
- **V2 — dry run.** `npm run seed:exercises -- --dry-run` → exit 0; report shows `extracted.jpgFiles=1746`, `records=876`,
  `imageRefs=1746`, `muscleLinks=2596`, `withoutImages=3`, `withoutInstructions=5`, `twoPrimary=1`, `maxStatementBytes<=90000`,
  `d1.applied=false`, `r2.uploaded=0`, and prints the `loadModes` and `dimensions` histograms.
- **V3 — tripwire.** Flip one byte of the cached `.cache/free-exercise-db-<commit>/dist/exercises.json`, re-run V2 → exit code **2** and a
  message naming both hashes. The hash is computed on the bytes about to be parsed, so a corrupted **cache** fails exactly like a corrupted
  download and never triggers a silent 99.8 MB re-fetch; `--force-download` is the deliberate escape hatch.
- **V4 — local seed.** `npm run seed:exercises -- --target=local` → exit 0; then `npx wrangler d1 execute fitness-pwa-db --local --command
  "<sql>"` for: `SELECT COUNT(*) FROM exercises WHERE source='free-exercise-db'` → `876`; `… exercise_muscles` → `2596`;
  `… exercise_media` → `1746`; `SELECT COUNT(*) FROM exercises WHERE equipment IN ('other','unknown')` → `199`; `… WHERE force IS NULL` →
  `30`; `… WHERE mechanic IS NULL` → `87`; `… WHERE instructions_json = '[]'` → `5`; `SELECT COUNT(*) FROM exercises WHERE slug IS NULL OR
  slug = ''` → `0`; `SELECT COUNT(*) FROM (SELECT slug FROM exercises GROUP BY slug HAVING COUNT(*) > 1)` → `0`;
  `SELECT load_mode FROM exercises WHERE id='fedb:3_4_Sit-Up'` → `bodyweight`;
  `SELECT COUNT(*) FROM exercises WHERE category='cardio' AND load_mode<>'duration'` → `0`;
  `SELECT COUNT(*) FROM exercises WHERE category='stretching' AND load_mode<>'duration'` → `0`;
  `SELECT COUNT(*) FROM exercises WHERE load_mode NOT IN ('external','bodyweight','bodyweight_plus','assisted','duration','distance')` →
  `0`; `SELECT COUNT(*) FROM exercise_muscles WHERE exercise_id='fedb:Kettlebell_Halo_With_Overhead_Extension' AND role='primary'` → `2`;
  `SELECT COUNT(*) FROM exercise_media WHERE width IS NULL OR height IS NULL OR width <= 0 OR height <= 0 OR bytes <= 0` → `0`;
  `SELECT COUNT(*) FROM exercise_media WHERE height > width` → **≥ 2** (r07 verified the `500x750` and `850x1275` portrait outliers, but
  names no ids, so the count is the assertion and `SELECT width || 'x' || height, COUNT(*) FROM exercise_media GROUP BY 1 ORDER BY 2 DESC`
  is **recorded** into the report — the top bucket must be `850x567`); `SELECT role, credit FROM volume_weights ORDER BY role` →
  `primary|1.0` and `secondary|0.5`, equal to `VOLUME_WEIGHT_SEED`.
- **V5 — idempotency, cascade and user-edit survival.** With ≥1 logged `sets` row present, plus one hand-set
  `UPDATE exercises SET is_favourite=1, load_mode='assisted', name_ru='Тест', name_ru_reviewed=1 WHERE id='fedb:3_4_Sit-Up'`, re-run V4 →
  exit 0, every count identical, `SELECT COUNT(*) FROM sets` unchanged, and that row still reads
  `is_favourite=1, load_mode='assisted', name_ru='Тест'`.
- **V6 — remote + images.** `npm run seed:exercises -- --target=remote --images=upload` → exit 0 with `r2.uploaded=1746, skipped=0,
  failed=[]`; immediately re-run → `uploaded=0, skipped=1746`.
- **V7 — media route.** First get the version token the URL needs:
  `V=$(npx wrangler d1 execute fitness-pwa-db --remote --json --command "SELECT substr(sha256,1,8) AS v FROM exercise_media WHERE
  exercise_id='fedb:3_4_Sit-Up' AND idx=0" | jq -r '.[0].results[0].v')`. Then: unauthenticated
  `curl -i "$BASE/api/media/exercise/3_4_Sit-Up/0?v=$V"` → `401`. With a session cookie → `200`, `Content-Type: image/jpeg`, quoted `ETag`,
  `Cache-Control: private, max-age=31536000, immutable`, and a `Content-Length` equal to
  `SELECT bytes FROM exercise_media WHERE exercise_id='fedb:3_4_Sit-Up' AND idx=0`; repeat with `-H "If-None-Match: <etag>"` → `304`, no
  body; wrong `?v=` → `200` + `private, max-age=0, must-revalidate`; `-H "Range: bytes=0-99"` → `200` with the **whole** body, never `206`;
  `..%2F..%2Fsecret/0` and `/3_4_Sit-Up/7` → **`400`** (pattern rejection, asserted separately from a missing row);
  `Kettlebell_Halo/0` → **`404`** (valid pattern, that record has no images).
- **V8 — bundle contract.** `curl -sD- "$BASE/api/reference/exercise-catalog?part=index" -o idx.json` → `200` + `ETag`; `jq '.count,
  (.index|length)'` → `876 876`; `jq '[.index[]|select(.images|length==0)]|length'` → `3`; `jq '[.index[]|select(has("search"))]|length'` →
  `0` (rule 13 — `search` never crosses the wire); `jq '[.index[]|select(.loadMode==null or .slug==null)]|length'` → `0`; `jq -r .version`
  matches `^[0-9a-f]{8}-[0-9a-z]+-r[0-9]+$`; re-request with `If-None-Match` → `304`; `?part=details` → `jq
  '[.details[]|select(.instructions|length==0)]|length'` → `5`. Then **the version really is content-derived**:
  `PATCH /api/exercises/fedb:3_4_Sit-Up { "nameRu": "Скручивания ¾" }` → re-request → `.version` differs, `.index[] | select(.id ==
  "fedb:3_4_Sit-Up") | .nameRu` is the new value, and `.nameRuReviewed` is `true` — with **no** `CATALOG_REV` edit and no redeploy.
- **V9 — measured wire sizes** (recorded, then enforced): log both parts' `Content-Length` (with `Accept-Encoding: gzip, br`) as a
  `docs/DECISIONS.md` entry naming the commit. The gate is **relative to that recorded baseline, not a round number**: the step fails when
  either part exceeds **1.3 ×** the committed baseline, so a regression trips it and the first run simply records. (The previous "400 KB"
  ceiling sat ~8× above a body that gzips to roughly 50 KB and could never fire.)
- **V10 — offline picker, on Chromium *and* WebKit.** `npx playwright test tests/e2e/exercise-picker.spec.ts` → PASS on both projects:
  loads online once, waits for `meta.catalogVersion` in IndexedDB, asserts **`catalogDetails` is non-empty** (the rule-18 polyfill assertion
  — this is the step that would fail on WebKit with a bare `requestIdleCallback`), `context.setOffline(true)`, reloads, opens the picker,
  types `press`; asserts the first result row is painted <150 ms after the last key event, the input is `role="combobox"` with
  `aria-expanded="true"` and an `aria-activedescendant` resolving to an `role="option"` inside the controlled listbox, a rendered option
  carries `aria-setsize` equal to the announced total and an `aria-posinset` of `1` for the top match, **the top result's bounding box lies
  in the bottom third of the viewport with the keyboard open** (mobile WebKit, the thumb-band assertion for the bottom-anchored layout), no
  successful `/api/` request occurred, an exercise image in the detail view renders **from the `exercise-media` Cache Storage entry while
  offline** (asserted via `caches.open("exercise-media").then(c => c.keys())`), and selecting a row closes the sheet and adds the exercise to
  the open workout. Finally `new AxeBuilder({ page }).include('[role="dialog"]')` over the **open sheet** → zero violations.
- **V11 — e1RM series builder only.** `npx vitest run tests/unit/exercise-history.test.ts` → PASS. Rule 28 forbids this module from
  recomputing e1RM, so the test feeds **pre-computed** `sets.e1rm_kg` values — one per Asia/Almaty day, oldest first — into
  `buildE1rmSeries` and asserts the output. The inputs are the six [r09 §1](../docs/research/r09-formulas-and-test-vectors.md) vectors as
  `specs/07`'s `e1rm(weightKg, reps, rpe?)` would have stored them (the formula vectors themselves belong to spec 07's own test file, which
  exports `epley`, `brzycki`, `e1rm`, `e1rmFromRpe` — **there is no `e1rmBase()`**; 07 line 237 says so explicitly):
  V1 `(100, 1, null)` → `100.0000`; **V2 `(100, 5, 8)` → `123.3046` — the RPE branch, `100 / 0.811`; without the RPE argument this vector
  is `116.6667`, which is why it must be written out**; V3 `(100, 10, null)` → `133.3333`; V4 `(100, 12, null)` → `144.0000`;
  V5 `(100, 6, null)` → `120.0000`; V6 `(100, 37, null)` → **`null`** (Brzycki's pole). Expected series:
  `[100.0000, 123.3046, 133.3333, 144.0000, 120.0000]` in day order, V6's day contributing **no point** rather than `Infinity`; a day with
  two sets keeps only the maximum. Plus one volume case: a session of `[warmup 40×10, working 100×5, drop 80×8]` has
  `volumeKg === totalVolumeKg(sets)` from `specs/07` — the warmup excluded, **the drop set included** — while `sets[]` returns all three
  rows with their `setType`.
- **V12 — attribution, on a routed page.** `grep -c "not licensed for redistribution" docs/ATTRIBUTION.md` → `1`; `npx vitest run
  tests/unit/attribution.test.ts` → PASS (the same sentence rendered by `DataSourceNotice`); and a Playwright step visits
  **`/settings/about`** and asserts the sentence is visible there, plus that `/licences` returns 200 containing `"THE SOFTWARE IS PROVIDED
  \"AS IS\""` — a component that renders correctly but is mounted nowhere is not attribution.

## Open questions

1. **Ship the 1,746 scraped JPEGs at all?** A legal-risk acceptance, not an engineering trade-off, so it needs an explicit owner yes ([r07
   Open decision A](../docs/research/r07-exercise-dataset.md)). *A:* ship them into the private auth-gated bucket exactly as specified —
   best gym UX for unfamiliar movements, $0.0015/month, practical risk very low but non-zero while the app stays private, single-user and
   undistributed. *B:* text-only catalogue with monogram and muscle-map visuals, zero exposure. **Recommend A** on the four conditions
   already built in (private bucket, per-row `image_licence`, swappable media layer, the `/settings/about` + `/licences` screens) — but take
   B now if the app might ever go public, because adding images later is cheap and removing them later is not.
2. **Do we ever generate derived image variants — for rows *and* for the detail view?** The brief's NFR asks for "responsive AVIF images via
   R2/Images" and rule 24 ships neither. *A (specified):* originals only, no photos in list rows, zero image requests on the hot path; a
   ~55 KB typical and 919 KB worst-case single image in the detail view, cached 90 d. *B:* add an encode pass at seed time producing
   `…/<idx>.display.webp` (~800 px, ≈15 KB) and `…/<idx>.thumb.webp` (320 px), +3,492 objects and ~10 MB, served with `srcset`/`sizes` —
   which costs one image-encoding dependency in a script that currently has none, and a re-run of the 99.8 MB fetch. **Recommend A for
   Phase 2**; the key scheme already reserves both variant names, so B is additive whenever a real gym session shows the originals are too
   slow.
3. **Who reviews the 876 RU names, and when?** *A (specified):* commit the AI pass with `reviewed:false`, let the visible English secondary
   line carry the risk, and let the owner correct names **in the app** (rule 38b) as they come up. *B:* block Phase 2 on a full manual
   review (~2–3 h). **Recommend A** — the fallback is always on screen, the correction path is now in-product rather than a repo edit plus a
   redeploy, and the names actually used get reviewed first by attrition.
4. **876 static photo pairs, or buy a licensed animated set?** ([r07 Open decision B](../docs/research/r07-exercise-dataset.md).) The brief
   says "1000+ exercises with GIF/video"; this dataset cannot satisfy either half, and §Purpose asserts the correction rather than asking
   for it — which is the owner's call, not this spec's. *A:* accept 876 with static start/end JPEG pairs, and amend the brief's numbers.
   Free, public-domain text, zero runtime dependency, ships in Phase 2. *B:* buy `wrkout.xyz` (the original author's commercial successor,
   2,500+ exercises with images and video; he describes the full set as requiring "some pretty substantial one-off payment" — actual price
   **UNVERIFIED**) or RepDB (`exercise-dataset.com`, paid tier adds transparent-background animations; price **UNVERIFIED**). Either also
   resolves question 1 outright, because the licence would be explicit. **Recommend A now**: the swappable media layer (rule 37) keeps B
   cheap later, and a price nobody has quoted cannot be traded off today.
