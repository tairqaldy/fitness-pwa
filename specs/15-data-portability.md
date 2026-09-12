# 15 — Export, import and backup

## Purpose

Own the data. This module defines the **backup payload format** every other spec defers to
(`01-architecture.md` §33, `02-data-model.md` §31, `10-body-photos.md` rules 67–69,
`14-ai-coach-and-notifications.md` §36): a CSV set with one file per table, a streamed NDJSON wire
format, and one canonical JSON form carrying `schemaVersion`. It imports Hevy / Strong /
MyFitnessPal CSV, restores our own backup with a byte-level round-trip guarantee, supplies the
payload for the `backup` cron step `14` owns, and hard-deletes everything — D1 rows *and* R2 objects
— on request. Satisfies brief §11 and the acceptance line "CSV/JSON export + Hevy/Strong/MFP import
work".

## Scope

The export envelope, canonical serialisation and the exact CSV headers; streaming export inside the
Worker's 128 MB / CPU budget; the three third-party parsers with header-**name** based dialect
sniffing; exercise-name → `exercises.id` mapping with fuzzy match and manual confirmation; lb → kg
and mi → m conversion; timezone interpretation of naive vendor timestamps through full ICU; the
dry-run preview; import idempotency (dedupe keys, the `import_batches` ledger, the `import_fills`
before-image ledger, per-batch rollback); our own restore and the round-trip proof; the backup
payload written to R2 `BACKUPS`, its retention and its restorability check; the full data-deletion
path.

### Out of scope

- Canonical DDL — **02-data-model.md**. It already owns `import_batches` and `import_staging`; this
  spec names only the columns it needs *added* and the two tables it adds. Every addition is listed
  as an explicit amendment in **Data**.
- Bindings, `wrangler.jsonc`, `triggers.crons`, `CRON_ROUTES`, `worker.ts`, `src/jobs/registry.ts`,
  `src/jobs/backup-to-r2.ts`, `AppError` / `ApiErrorCode` / `httpStatusFor` / `jsonError`
  — **01-architecture.md**.
- The cron **step chain** on `0 18 * * *`, the Almaty-Sunday gate on the `backup` step, `cron_runs`,
  failure alerting, the weekly Telegram report — **14-ai-coach-and-notifications.md** (14 rule 12,
  14:362). This spec owns only the **body** of `src/jobs/steps/backup.ts`.
- `photos` table, upload/serve routes, R2 photo keys, `photos.csv`'s header,
  `listPhotoObjectsForManifest()` / `PhotoManifestObject` (`src/server/photos/manifest.ts`, 10:298)
  and `sweepDeletedPhotoObjects()` — **10-body-photos.md**. This spec consumes the first three
  verbatim and **does not** invoke the sweeper: 10 rule 66 assigns that to a new `photo-gc` step in
  14's chain (10's amendment 14.1). The only R2 photo deletion here is the full purge (rule 60).
- `normalizeQuery` / `tokenize` / `translitRu` and the exercise catalogue —
  **08-exercise-library.md**. This spec reuses them and adds only vendor-name parsing.
- The offline outbox and Dexie stores — **05-pwa-offline-sync.md**. This spec only *gates* on
  `outbox`, client-side (rule 11).
- e1RM / EMA / streak / TDEE computation — **07-calculators.md**, **12-analytics-dashboard.md**,
  **13-gamification.md**. This spec asserts their outputs match the backup (RT-4), never rewrites them.
- Auth and rate limiting on these routes — **04-auth.md**. Every route here is authenticated.
- CI wiring of the tests below, `tests/harness/**`, `tests/fixtures/seed.sql` —
  **16-testing-ci-quality.md**.

## Files to create

| Path | Responsibility |
|---|---|
| `src/db/schema/portability.ts` | `exercise_aliases` + `import_fills` tables and the added `import_key` / `import_batch_id` columns (contributed to 02) |
| `src/lib/export/envelope.ts` | `SCHEMA_VERSION`, `BackupEnvelope` Zod schema, `upcasts` registry |
| `src/lib/export/canonical.ts` | Canonical serialiser: table sort, row sort by `id`, key sort, shortest round-trip numbers, volatile-key drop. **Platform-free** — runs in the Worker *and* in Node |
| `src/lib/export/ndjson.ts` | NDJSON frame encoder/decoder as `TransformStream`s; owns the `crypto.DigestStream` tee (rule 1) |
| `src/lib/export/pager.ts` | Keyset pager `id > ? ORDER BY id LIMIT n` over any Drizzle table |
| `src/lib/export/csv.ts` | RFC-4180 writer: CRLF, BOM, `NULL` vs `""`, `.` decimal |
| `src/lib/export/headers.ts` | Derives every CSV header row from the Drizzle schema in DDL order |
| `src/lib/export/zip.ts` | Streaming ZIP via `fflate/browser` (`Zip`, `ZipDeflate`) |
| `src/lib/import/csv.ts` | RFC-4180 tokenizer as a `TransformStream`: BOM strip, `,`/`;` sniff, CRLF/LF, `CsvError` with a 1-based line and byte offset |
| `src/lib/import/sniff.ts` | `sniff()` — source, dialect, unit system, column map; **header line only** |
| `src/lib/import/units.ts` | `KG_PER_LB`, `lbToKg`, `miToM`, `parseStrongDuration` |
| `src/lib/import/tz.ts` | `wallClockToUtcMs()` — naive local → epoch ms via `Intl`, the inverse of 02's `toLocalDay` |
| `src/lib/import/canonical.ts` | `CanonicalImportRow` union + Zod; units already normalised |
| `src/lib/import/adapters/{hevy,strong,mfp}.ts` | One streaming parser per source |
| `src/lib/import/dedupe.ts` | `workoutImportKey()` and siblings — pure |
| `src/lib/import/match/vendor-name.ts` | Vendor-name parsing: strip literal quotes, split the trailing equipment parenthetical |
| `src/lib/import/match/dice.ts` | Bigram Sørensen–Dice coefficient over padded, **deduplicated** bigram sets |
| `src/lib/import/match/exercise.ts` | `matchExercise()` → auto / confirm / new |
| `src/lib/import/plan.ts` | `buildPlan()` — streaming, resumable dry run; writes no user data |
| `src/server/export/run.ts` | Export runner shared by routes and the cron step; takes `db`, `env` |
| `src/server/export/photo-manifest.ts` | Adapts 10's `listPhotoObjectsForManifest()` into `BackupEnvelope.r2.objects` — D1 columns only, **no `head()`** (rule 8) |
| `src/server/import/stage.ts` | Writes normalised rows into `import_staging` in bounded chunks |
| `src/server/import/apply.ts` | Staged → `db.batch()` insert; fills through `import_fills`; ledger; report |
| `src/server/import/rollback.ts` | Revert fills from their before-images, then `DELETE … WHERE import_batch_id = ?` child → parent |
| `src/server/backup/write.ts` | Streams the backup + manifest to R2 `BACKUPS`, resumable |
| `src/server/backup/verify.ts` | `verifyBackup()` — gunzip, Zod, counts, body hash, R2 `head()` per manifest object |
| `src/server/backup/retention.ts` | Pure retention planner → keys to delete |
| `src/server/backup/promote.ts` | Monthly promotion as a streamed `get` → `put` (R2's binding has **no** copy — r03 §1) |
| `src/server/backup/archive.ts` | Sharded photo-bytes archive (quarterly; also callable on demand) |
| `src/server/data/purge.ts` | `previewPurge()`, `purgeEverything()` — hard delete: D1 `DELETE FROM`, R2 prefix sweep, KV sweep |
| `src/jobs/steps/backup.ts` | The `backup` **step body** (14 owns its name, order and Sunday gate): write → verify → promote monthly → prune retention → prune stale staging → archive on a quarter boundary |
| `src/app/api/export/json/route.ts` | `GET` → streamed `.ndjson` |
| `src/app/api/export/backup.json/route.ts` | `GET` → the canonical JSON document, **bounded** (rule 3) |
| `src/app/api/export/csv/[table]/route.ts` | `GET` → one streamed CSV |
| `src/app/api/export/zip/route.ts` | `GET` → streamed ZIP: `manifest.json` + `csv/<table>.csv` |
| `src/app/api/import/analyze/route.ts` | `POST` file → `ImportPlan` or `202 { batchId, resumeCursor }`; writes no user data |
| `src/app/api/import/apply/route.ts` | `POST` `{ batchId, confirmations }` → applies the staged plan |
| `src/app/api/import/[batchId]/rollback/route.ts` | `POST` → undo one applied batch |
| `src/app/api/backups/route.ts` | `GET` ledger from R2 `BACKUPS`; `POST` run a manual backup |
| `src/app/api/backups/verify/route.ts` | `POST` `{ key }` → restorability check; writes nothing |
| `src/app/api/backups/download/route.ts` | `GET` `?key=` → pipes `R2ObjectBody.body` through |
| `src/app/api/data/purge/route.ts` | `GET` preview counts; `POST` → hard delete, gated on a typed phrase |
| `src/app/(app)/settings/data/page.tsx` | The Data screen: export, import, backups, danger zone |
| `src/components/data/{export-card,import-sheet,import-plan-table,exercise-match-sheet,unit-confirm-sheet,backup-list,danger-zone}.tsx` | The seven pieces of that screen |
| `messages/{ru,en}.json` → namespace `Data` | Extend, never create. Every `PlanNote` code renders from here (rules 31, 38) |
| `tests/fixtures/import/**` | 14 pinned CSV fixtures: one per verified dialect + the malformed one |
| `tests/fixtures/export/hard-cases.sql` | Loaded **after** `tests/fixtures/seed.sql` (16); adds every hard case in r10 §2.5 that the shared seed does not carry |
| `tests/fixtures/export/golden-{backup.canon.json,headers.txt}` | Golden shape; CI fails on drift. `golden-backup.canon.json` is produced by `canonicalise()` itself, so `cmp` and the golden file cannot disagree |
| `tests/integration/helpers/fake-r2.ts` | `makeFakeR2()` — an in-memory `R2Bucket` implementing exactly r03 §1's seven methods. 16's `makeTestDb()` has no R2 (16 rule 6d) |
| `tests/unit/import/*.test.ts` | `csv`, `sniff`, `units`, `tz`, `hevy`, `strong`, `mfp`, `match`, `dedupe` |
| `tests/unit/export/*.test.ts` | `canonical`, `csv`, `headers`, `upcast`, `retention`, `params` (the ≤ 90-bound-parameter static count) |
| `tests/integration/roundtrip.test.ts` | **RT-1, RT-2, RT-4, RT-5, RT-6** via `makeTestDb()` (16 `tests/harness/d1.ts`) + `fixedClock()` + `makeFakeR2()` |
| `tests/integration/backup-step.test.ts` | The step body against `makeTestDb()` + `makeFakeR2()`, with `scheduledTime` forced to a Sunday and to a Monday |
| `tests/e2e/data-portability.spec.ts` | **RT-3** and rule 56's verify against real R2 (`opennextjs-cloudflare preview`), plus: import a Strong fixture, preview, apply, roll back. The checklist's plain "export works" line stays in 16's `tests/e2e/smoke.spec.ts` |
| `scripts/build-canon.mjs` | Six-line `esbuild` bundle of `src/lib/export/canonical.ts` → `dist-scripts/canonical.mjs`. `esbuild@0.28.2` is already a devDependency, so no TS loader is added |
| `scripts/canon.mjs` | Plain Node ESM. NDJSON → canonical JSON through `dist-scripts/canonical.mjs`. One job only |
| `scripts/latest-backup-key.mjs` | Prints the newest `BACKUPS` manifest key by calling `GET /api/backups` — separate from `canon.mjs` |
| `scripts/wipe-d1.sql` | FK-safe `DELETE FROM` for every app table, child → parent; never touches `d1_migrations`. Used only by the proof and by purge |

## Interfaces

```ts
// src/lib/export/envelope.ts
export const SCHEMA_VERSION = 1 as const;

/** Envelope metadata keys are camelCase (so `schemaVersion` is literally the brief's field);
 *  row objects inside `tables` use the exact snake_case D1 column names, so a CSV row and a
 *  JSON row carry identical field names. */
export const BackupEnvelope = z.object({
  schemaVersion: z.literal(1),                 // integer; the ONLY field the importer branches on
  format: z.literal("fitness-app-tair/backup"),
  appVersion: z.string(),                      // VOLATILE — diagnostic only, never control flow
  exportedAt: z.string(),                      // VOLATILE — ISO-8601 UTC, `Z`, seconds
  d1Migration: z.string(),                     // VOLATILE — diagnostic only
  runKey: z.string().nullable(),               // VOLATILE — cron: cron_runs.scheduled_at as yyyy-mm-ddTHH-mm-ssZ
  lastClientFlushAtMs: z.number().int().nullable(),   // VOLATILE — max(mutations.received_at), rule 11
  timezone: z.literal("Asia/Almaty"),          // the zone every `local_day` column is expressed in
  units: z.object({ mass: z.literal("kg"), length: z.literal("cm"), energy: z.literal("kcal"),
    volume: z.literal("ml"), distance: z.literal("m"), duration: z.literal("s") }),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  derivedColumns: z.record(z.string(), z.array(z.string())),   // table → column names, rule 50
  r2: z.object({
    binding: z.literal("BACKUPS"),             // 01:95 / 01 §Binding registry — the backup bucket
    objects: z.array(PhotoManifestObject),     // from 10's src/server/photos/manifest.ts
  }),
});
export type BackupEnvelope = z.infer<typeof BackupEnvelope>;
export type Upcast = (doc: unknown) => unknown;   // pure, total; pinned by a fixture forever
export const upcasts: Record<number, Upcast>;     // upcasts[1]: v1→v2, upcasts[2]: v2→v3, …

// src/lib/export/ndjson.ts
export type NdjsonFrame =
  | { type: "header"; envelope: BackupEnvelope }               // ALWAYS line 1
  | { type: "row"; table: string; data: Record<string, unknown> }
  | { type: "footer"; rowsWritten: number; sha256: string };
/** The footer's `sha256` is the SHA-256 of every **uncompressed** byte emitted BEFORE the footer
 *  line — header + all row lines, LF-terminated. Computed incrementally by teeing the encoded
 *  stream into `new crypto.DigestStream("SHA-256")` and awaiting `.digest` when the source closes;
 *  `crypto.subtle.digest` is one-shot and would require buffering the whole payload, which is the
 *  very 128 MB OOM rules 2-3 exist to prevent.
 *  VERIFIED on workerd 1.20260911.1 @ compatibility_date 2026-09-01 by a probe Worker:
 *  `crypto.DigestStream` is a `WritableStream<ArrayBuffer|ArrayBufferView>` with
 *  `readonly digest: Promise<ArrayBuffer>` and `bytesWritten`, and it hashed "hello" to
 *  2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824. */
export function ndjsonEncoder(): TransformStream<NdjsonFrame, Uint8Array>;
export function ndjsonDecoder(): TransformStream<Uint8Array, NdjsonFrame>;

// src/lib/export/canonical.ts — platform-free: no `node:*` import, no binding access.
// Runs in Node (scripts/canon.mjs) AND in the Worker (GET /api/export/backup.json, rule 3).
/** Keys dropped before serialising, so two exports of the same D1 state are byte-identical.
 *  Without this RT-1 can never pass: the two exports it compares are taken seconds apart, so
 *  `exportedAt` differs and the footer hash differs with it. */
export const CANON_VOLATILE_KEYS = ["exportedAt", "appVersion", "d1Migration", "runKey",
  "lastClientFlushAtMs"] as const;
/** Drops CANON_VOLATILE_KEYS from the header envelope and drops the `footer` frame entirely.
 *  Tables sorted by name, rows by `id`, object keys sorted, numbers in shortest round-trip
 *  form, 2-space indent, LF, no trailing newline. Idempotent. */
export function canonicalise(frames: AsyncIterable<NdjsonFrame>): Promise<string>;
export const CANON_MAX_ROWS = 200_000;          // GET /api/export/backup.json refusal thresholds
export const CANON_MAX_BYTES = 48 * 1024 * 1024;

// src/lib/export/pager.ts
export function pageRows<T extends SQLiteTable>(
  db: DB, table: T, opts?: { pageSize?: number },      // default 1000; keyset on `id`
): AsyncGenerator<T["$inferSelect"][]>;

// src/server/export/run.ts
export type ExportTarget =
  | { kind: "ndjson"; sink: WritableStream<Uint8Array>; gzip?: boolean }
  | { kind: "csvZip"; sink: WritableStream<Uint8Array> }
  | { kind: "singleCsv"; table: string; sink: WritableStream<Uint8Array> };
export type ExportResult = { counts: Record<string, number>; bytes: number; sha256: string;
  manifest: BackupEnvelope };
export function runExport(db: DB, env: CloudflareEnv, target: ExportTarget): Promise<ExportResult>;

// src/lib/import/units.ts
export const KG_PER_LB = 0.45359237;      // exact by definition; the constant r10 §1.2.4 derives with
export const M_PER_MILE = 1609.344;
export function lbToKg(lb: number): number;         // rounds HALF-UP to 2 dp — Behaviour 22
export function miToM(mi: number): number;
/** `"1h 43m" | "59m" | "38min" | "264h 1m" | "82"` → seconds; null when unparseable. */
export function parseStrongDuration(raw: string): { seconds: number; suspicious: boolean } | null;

// src/lib/import/tz.ts — the inverse of `toLocalDay` (02 `src/db/local-day.ts`)
/** Naive local wall-clock → epoch ms, resolved through full ICU. NEVER a fixed offset.
 *  ALGORITHM — exactly four `Intl` reads, no iteration, no `while` loop:
 *    1. guess = Date.UTC(y, m-1, d, H, M, S)                      // the wall clock read as if UTC
 *    2. Probe the offset a DAY EITHER SIDE, which is what surfaces BOTH sides of a transition:
 *         oBefore = offsetMinutes(guess - 86_400_000)
 *         oAfter  = offsetMinutes(guess + 86_400_000)
 *       (Probing at `guess` itself is WRONG: inside a fold it yields one offset and the second
 *        candidate is never generated, so the fold silently resolves to the LATER instant.)
 *    3. candidates = unique([guess - oBefore*60_000, guess - oAfter*60_000]), ascending
 *    4. formatsBack(t) := formatting t in `tz` reproduces the requested y/m/d/H/M/S exactly
 *         - two formatBack → AMBIGUOUS (a fold):     return candidates[0]  — EARLIER WINS
 *         - one formatsBack → UNIQUE:                return it
 *         - none formatsBack → NONEXISTENT (a gap):  return candidates.at(-1) — SHIFT FORWARD
 *  `offsetMinutes` reads `Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "longOffset" })`.
 *  The ±24 h window assumes no IANA zone has two offset changes inside 24 h, which none has.
 *  VERIFIED on workerd 1.20260911.1: Asia/Almaty is GMT+06:00 through 2024-02-29T17:59:59.999Z and
 *  GMT+05:00 from 2024-02-29T18:00:00.000Z (local 2024-03-01 00:00 +06:00 was set BACK to
 *  2024-02-29 23:00 +05:00). So local 2024-02-29 23:00:00-23:59:59 occurs TWICE, and Asia/Almaty
 *  has no historical gap — the gap branch is exercised by a DST zone in the test, never by APP_TZ.
 *  A probe Worker ran this exact algorithm over all seven vectors in Verification and produced
 *  every stated answer, including `ambiguous → 2024-02-29T17:00:00Z` and Berlin's
 *  `nonexistent → 2026-03-29T01:30:00Z` (local 03:30). */
export function wallClockToUtcMs(p: { year: number; month: number; day: number;
  hour: number; minute: number; second: number }, tz?: string): number;
export function classifyWallClock(p: Parameters<typeof wallClockToUtcMs>[0], tz?: string):
  { kind: "unique" | "ambiguous" | "nonexistent"; candidates: number[]; chosen: number };

// src/lib/import/csv.ts — the tokenizer, and the ONLY producer of malformed-quoting errors.
export type CsvError = { kind: "malformed-quoting"; line: number; byteOffset: number };
export type CsvRow = { line: number; cells: string[] };
/** Streaming, so a 25 MB file never exists as one string (nor as a ~50 MB UTF-16 one).
 *  A malformed field errors the stream with `CsvError`; nothing half-parses. */
export function csvTokenizer(o: { delimiter: "," | ";" }): TransformStream<Uint8Array, CsvRow>;

// src/lib/import/sniff.ts
export type ImportSource = "hevy-workouts" | "hevy-measurements" | "strong"
  | "mfp-nutrition" | "mfp-measurement" | "mfp-exercise" | "ours";
export type SniffResult =
  | { ok: true; source: ImportSource; dialect: string; delimiter: "," | ";"; hasBom: boolean;
      lineEnding: "LF" | "CRLF"; unitSystem: "metric" | "imperial" | "per-row" | "unknown";
      columnMap: Record<string, number>; headerLine: string }
  | { ok: false; reason: "unknown-format" | "unverified-format" | "ours-csv-not-importable";
      detail: string; headerLine: string };
/** `headerLine` is the first line only — cut by the tokenizer at the first LF, capped at 64 KiB.
 *  `malformed-quoting` is NOT a sniff outcome: sniff sees line 1 and could never report line 2
 *  (rule 19). It comes from `csvTokenizer` as a `CsvError`. */
export function sniff(headerLine: string, fileName: string): SniffResult;

// src/lib/import/canonical.ts — units ALREADY normalised: kg, m, s, cm, kcal, g, ml.
// `setType` values are 02's SET_TYPES: "warmup" | "working" | "drop" | "failure" | "amrap".
// EVERY local-day field is `localDay` — 02 rule 5 fixes the name, 02:8 forbids renaming it.
export type CanonicalImportRow =
  | { kind: "workout"; tmpId: string; startedAtMs: number; endedAtMs: number | null;
      durationSec: number | null; title: string | null; notes: string | null;
      localDay: string; sourceLines: number[] }
  | { kind: "workoutExercise"; tmpId: string; workoutTmpId: string; position: number;
      sourceName: string; supersetGroup: number | null; notes: string | null }
  | { kind: "set"; workoutExerciseTmpId: string; position: number;
      setType: (typeof SET_TYPES)[number]; weightKg: number | null; reps: number | null;
      rpe: number | null; rir: number | null; distanceM: number | null;
      durationSec: number | null; restAfterSec: number | null; supersetRound: number | null;
      completedAtMs: number }
  | { kind: "bodyMeasurement"; localDay: string; measuredAtMs: number;
      fields: Record<string, number> }        // keys are 02 column names, e.g. `weight_kg`
  // `slot` is 02's `food_entries.slot` domain, spelled out because 02 exports no `FOOD_SLOTS`
  // tuple — per 02 rule 13 it is an app-owned enum validated by Zod at the write boundary only.
  | { kind: "foodEntry"; localDay: string; vendorMeal: string;
      slot: "breakfast" | "lunch" | "dinner" | "snack";
      timeLocal: string | null; ordinal: number; eatenAtMs: number; kcal: number;
      proteinG: number | null; carbG: number | null; fatG: number | null; fiberG: number | null;
      microsPctDv: Record<string, number>; label: string | null }
  | { kind: "dailyCheckin"; localDay: string; steps: number };

// src/lib/import/match/exercise.ts
// `EquipmentKey` is 08's, imported from '@/lib/exercise/taxonomy' (08:102) — the 13 keys of 02's
// `EQUIPMENT` tuple. This module defines no equipment type of its own.
export type MatchDecision =
  | { status: "auto"; exerciseId: string; score: number }
  | { status: "confirm"; candidates: { exerciseId: string; name: string; score: number }[] }
  | { status: "new"; proposedName: string; equipment: EquipmentKey | null };
export function matchExercise(sourceName: string,
  catalogue: readonly { id: string; name: string; equipment: EquipmentKey | null }[],
  aliases: ReadonlyMap<string, string>): MatchDecision;      // normalised alias → exercise id
// All four are UNVERIFIED-tunable (open question 3): no source in r07 or r10 derives them.
// `match.test.ts` pins BEHAVIOUR on the fixture catalogue, never these numbers.
export const AUTO_THRESHOLD = 0.80;
export const CONFIRM_THRESHOLD = 0.50;
export const EQUIPMENT_DISAGREE_FACTOR = 0.6;
export const EQUIPMENT_AGREE_BONUS = 0.08;

// src/lib/import/dedupe.ts — pure; `sha16` = first 16 hex chars of SHA-256
export function workoutImportKey(src: ImportSource, startedAtMs: number, title: string | null): string;
export function foodEntryImportKey(src: ImportSource, localDay: string, vendorMeal: string,
  timeLocal: string | null, ordinal: number): string;
/** Fill-only targets get NO row column — their key lives in `import_fills` (rule 41), so a second
 *  source filling the same day still has its own key on the same row. `kind` is a column name. */
export function fillImportKey(src: ImportSource, localDay: string, kind: string): string;

// src/lib/import/plan.ts
export type PlanNoteCode =
  | "strong-rest-timer-rows" | "strong-note-rows" | "strong-supersets-lost"
  | "strong-warmup-position-lost" | "strong-warmups-excluded-from-vendor-charts"
  | "strong-duration-suspicious" | "strong-blank-weight-unit"
  | "hevy-superset-order-lost" | "hevy-duplicate-exercise-instances"
  | "hevy-unparseable-timestamp"
  | "mfp-no-food-identity" | "mfp-strength-not-imported" | "mfp-cardio-not-imported";
/** `message` is a DEVELOPER-FACING diagnostic. The UI NEVER renders it — it renders
 *  `Data.notes.<code>` from `messages/{ru,en}.json` with `count` interpolated (rules 31, 38). */
export type PlanNote = { code: PlanNoteCode; count: number; message: string; sampleLines: number[] };
export type ImportPlan = {
  batchId: string; source: ImportSource; dialect: string;
  filename: string; bytes: number; sha256: string; duplicateOfBatchId: string | null;
  creates: Record<string, number>;        // table → rows that WILL be inserted
  duplicates: Record<string, number>;     // rows skipped by dedupe key
  fills: { table: string; column: string; count: number }[];   // fields that will be filled
  skipped: PlanNote[];                    // pseudo-rows and unusable rows
  warnings: PlanNote[];                   // lossy conversions; features that cannot survive
  unmatchedExercises: { sourceName: string; occurrences: number; decision: MatchDecision }[];
  needsUnitConfirmation: null | { field: "weight"; min: number; median: number; max: number;
    guess: "kg" | "lb"; guessBasis: string };
  blocking: PlanNote[];                   // non-empty ⇒ apply is refused (rule 63)
};
export const ANALYZE_MAX_BYTES = 25 * 1024 * 1024;   // UNVERIFIED-tunable budget (open question 3)
export const ANALYZE_ROWS_PER_INVOCATION = 20_000;   // staged canonical rows before yielding a cursor
export const ANALYZE_QUERIES_PER_INVOCATION = 800;   // under r02's hard 1000 (r02 §4.8)
export const PLAN_SAMPLE_CAP = 200;                  // report_json is CHECKed ≤ 65536 bytes (02)
/** Streaming and resumable, exactly like `applyImport`: a 25 MB Strong export is ~250k rows and a
 *  whole-file `CanonicalImportRow[]` would exceed the 128 MB isolate rule 2 protects. */
export function buildPlan(a: { db: DB; body: ReadableStream<Uint8Array>; filename: string;
  batchId?: string; resumeCursor?: string | null }):
  Promise<ImportPlan | { status: "partial"; batchId: string; resumeCursor: string }>;

// src/server/import/apply.ts
export type ImportReport = {
  batchId: string; status: "applied" | "aborted"; appliedAtMs: number | null;
  rowsSeen: number; rowsImported: number; rowsSkipped: number;
  inserted: Record<string, number>; filled: { table: string; column: string; count: number }[];
  createdCustomExerciseIds: string[];
  notes: PlanNote[]; error: string | null;            // serialised ≤ 65536 bytes (02 MAX_JSON_BYTES)
};
export function applyImport(a: { db: DB; env: CloudflareEnv; batchId: string;
  confirmations: {
    exercises: Record<string, { exerciseId: string } | { createCustom: true }>;
    weightUnit?: "kg" | "lb";
    onDuplicateWorkout?: "skip" | "replace";     // default "skip"
    recomputeDerived?: boolean;                  // default FALSE for third-party sources
  };
  resumeCursor?: string | null;
}): Promise<ImportReport | { status: "partial"; batchId: string; resumeCursor: string }>;

// src/server/backup/verify.ts
export type VerifyResult = { ok: boolean; key: string; schemaVersion: number;
  bodySha256Match: boolean; srcSha256Match: boolean; countsMatch: boolean;
  r2: { checked: number; missing: string[]; sizeMismatched: string[]; sha256Absent: string[] };
  rowErrors: { table: string; id: string | null; message: string }[] };
export function verifyBackup(db: DB, env: CloudflareEnv, key: string): Promise<VerifyResult>;

// src/server/backup/retention.ts — pure
export type BackupKind = "weekly" | "monthly" | "manual" | "archive";
export const RETAIN = { weekly: 8, monthly: 12, manual: 5, archive: 4 } as const;
export function planRetention(entries: { key: string; kind: BackupKind;
  createdAtMs: number }[], now: Date): { keep: string[]; delete: string[] };

// src/app/api/backups — the ledger the Data screen and the Verification proof both read, because
// wrangler 4.131.1 has NO R2 object-listing command (Verification preamble).
export type BackupListEntry = { key: string; kind: BackupKind; bytes: number;
  uploadedAtMs: number; srcSha256: string | null;
  manifestKey: string | null; verifyKey: string | null;
  verified: boolean | null; danglingKeys: number | null };   // both read from the .verify.json sibling

// src/server/data/purge.ts
export type PurgePreview = { d1Rows: Record<string, number>; photoObjects: number;
  backupObjects: number; backupBytes: number; kvKeys: number };
export function previewPurge(a: { db: DB; env: CloudflareEnv }): Promise<PurgePreview>;
export function purgeEverything(a: { db: DB; env: CloudflareEnv; keepFinalExport: boolean;
  deleteExistingBackups: boolean }):
  Promise<{ d1RowsDeleted: Record<string, number>; r2PhotoObjectsDeleted: number;
            backupObjectsDeleted: number; backupObjectsKept: number;
            kvKeysDeleted: number; finalExportKey: string | null }>;
```

## Behaviour

### Export

1. `GET /api/export/json` streams NDJSON: line 1 the `header` frame, then one `row` frame per row
   (tables in name order, rows in `id` order), then the `footer` frame carrying the SHA-256 of
   every preceding **uncompressed** byte, computed incrementally through `crypto.DigestStream`
   (Interfaces). `Content-Type: application/x-ndjson`, `Content-Disposition: attachment`.
2. Rows come from `pageRows()` — keyset `WHERE id > ? ORDER BY id LIMIT 1000` — piped straight into
   the response body through a `TransformStream`. **No table is ever fully materialised.**
   `JSON.stringify(wholeDatabase)` is banned in review: the isolate has 128 MB (stack-facts.md) and
   `sets` + `ai_prompt_logs` grow without bound. That the body really streams is **VERIFIED** by
   reading the shipped wrapper rather than assumed: `@opennextjs/cloudflare@1.20.6`
   `dist/api/config.js:13` selects `wrapper: "cloudflare-node"`, and
   `@opennextjs/aws/dist/overrides/wrappers/cloudflare-node.js` declares `supportStreaming: true`,
   constructs the `ReadableStream` inside `writeHeaders(prelude)`, resolves the `Response`
   immediately and enqueues each chunk with `retainChunks: false`. **Corollary, load-bearing for
   rule 9:** response headers are committed at `writeHeaders` time, before the first body byte, so
   nothing computed *during* the body can ever appear in a header.
3. `backup.json` — the pretty envelope with a `tables` map — is the canonical, diffing, golden-file
   and RT-1 form. It is produced two ways from the same platform-free `canonicalise()`:
   `scripts/canon.mjs` in Node, and `GET /api/export/backup.json` in the Worker, so an owner with
   only a phone can still obtain the documented backup format. Canonicalisation must sort, so it
   buffers: the route **refuses** with `validation_failed` /
   `details.reason = "corpus-too-large-for-json"` when `sum(counts) > CANON_MAX_ROWS` or the NDJSON
   body exceeds `CANON_MAX_BYTES`, and the copy points at the `.ndjson` download. NDJSON remains the
   only unbounded artefact.
4. Soft-deleted rows are exported. `deleted_at` is a column, not an absence (02 rule 25), so
   `deleted_at`, `rev`, `created_at` and `updated_at` are part of every row and of the round-trip.
   An export that filtered `deleted_at IS NULL` would make restore resurrect deleted sets.
5. `GET /api/export/csv/[table]` streams one CSV: UTF-8 **with BOM**, CRLF, comma delimiter, RFC-4180
   quoting. Empty field = SQL `NULL`; `""` = empty string; booleans are literal `true`/`false`;
   numbers always use `.` (r10 §2.1 rules 8–9). The BOM is mandatory — the owner's locale is RU and
   Excel mojibakes Cyrillic without it. **The CSV set is read-only for spreadsheets and is not a
   restorable artefact** (rule 16's last row, and the export card's honest copy in UX notes).
6. `GET /api/export/zip` streams `manifest.json` + `csv/<table>.csv` for every table, built with
   `fflate@0.8.3`'s `Zip` + `ZipDeflate` imported from **`fflate/browser`**. Never the `Async*`
   classes and never the bare `"fflate"` specifier: that package's `exports` map resolves the `node`
   condition to a build calling `require('worker_threads')`, and `AsyncZipDeflate` constructs
   `new Worker(URL.createObjectURL(new Blob([…])))` — neither exists in workerd. Verified by reading
   `fflate@0.8.3/package.json` (exports map), `esm/index.mjs:16,18` and `esm/browser.js:12`.
   `fflate` is used for **ZIP only**; gzip is the platform's `CompressionStream` (rule 53).
7. Every CSV header row is **generated from the Drizzle schema in DDL column order** by
   `src/lib/export/headers.ts` — never hand-written — and pinned by
   `tests/fixtures/export/golden-headers.txt`, so a schema change that alters an export header fails
   CI instead of silently producing files the importer cannot read. `photos.csv`'s header is owned by
   **10 rule 68** and consumed verbatim. The local-day column is **`local_day` everywhere**: 02:65
   declares `export const localDay = (n = "local_day") => text(n)`, `sets` uses
   `localDay().notNull()` (02:~119), 02 rule 5 requires the `_day`/`_on` suffix, and 02:8 forbids any
   other spec renaming it — so `local_date` appears nowhere in this module, and its inverse helper is
   `toLocalDay` in `src/db/local-day.ts`, not `toLocalDate`. The three headers that carry the hard
   cases (r10 §2.2, with 02's real column names and this spec's added columns placed immediately
   before `...syncCols()`):
   - `workouts` (20): `id,user_id,local_day,started_at,ended_at,duration_sec,title,notes,routine_id,bodyweight_kg,volume_kg,hard_sets,gym_lat,gym_lon,import_key,import_batch_id,created_at,updated_at,rev,deleted_at`
   - `workout_exercises` (14): `id,workout_id,exercise_id,position,superset_group,target_sets,target_reps_low,target_reps_high,notes,import_batch_id,created_at,updated_at,rev,deleted_at`
   - `sets` (25): `id,workout_id,workout_exercise_id,exercise_id,local_day,position,set_type,weight_kg,assist_kg,reps,rpe,rir,distance_m,duration_sec,rest_after_sec,superset_round,e1rm_kg,is_pr,pr_kinds_json,completed_at,import_batch_id,created_at,updated_at,rev,deleted_at`
8. R2 media keys are exported **verbatim as opaque strings** — never re-derived, normalised or
   re-prefixed (r10 §2.4). `manifest.r2.objects` is `listPhotoObjectsForManifest()` from
   `src/server/photos/manifest.ts` (10:93, 10:298 — `PhotoManifestObject { key, bytes, sha256,
   contentType }`), one entry per non-null `r2_key` / `thumb_key` / `orig_key`, with `sha256` present
   on `display` only (10 rule 67). It reads **D1 columns only and issues no `head()`**, so the
   manifest costs nothing, adds no Class-B ops per export, and can be emitted in the header frame
   before the first row. Photo **bytes are not in this payload** — that is the archive (rule 55).
9. Object existence is checked on the **verify** and **restore** paths, never during export.
   `VerifyResult.r2` separates the three outcomes: `missing` (no object), `sizeMismatched` (`head()`
   size ≠ the manifest's `bytes`, checkable only where `bytes` is non-null, i.e. the `display`
   variant), and `sha256Absent` (a `thumb`/`orig` entry, or a `display` row whose `photos.sha256` is
   NULL — a reported **warning**, never a pass). The count reaches the UI through
   `GET /api/backups`'s `danglingKeys`, read from the sibling `.verify.json`, and through a
   persistent warning on the Data screen. A dangling key is a pre-existing bug; we surface it, never
   hide it. There is no `X-Export-Warnings` response header and there cannot be one — rule 2's
   corollary.
10. `ai_prompt_logs` is exported last. Its rows hold prompts, pinned model ids and cost, so the
    exported file inherits app auth and `BACKUPS` is a private bucket (r10 gotcha 27). Rows whose
    payload went to `output_r2_key` export the key, not the bytes.
11. **The outbox gate is a client precondition, and is stated as one.** The `outbox` is a Dexie store
    and a Worker cannot see it, so the *page* refuses to call the export or purge route while
    `outboxCount() > 0`, shows the pending count and offers "flush now". The client also sends the
    advisory header `X-Outbox-Pending: <n>`; the route refuses with `conflict` /
    `details.reason = "outbox-not-empty"` when it is non-zero, which stops a stale tab but is not a
    security boundary. An export taken mid-sync is not a backup. The scheduled backup has no access
    to the outbox at all, so it records `lastClientFlushAtMs = max(mutations.received_at)` in the
    envelope: a cron backup may legitimately lag the client by one flush, and the owner can see by
    exactly how much instead of being told it cannot happen.
12. `runExport()` parses its own header frame against `BackupEnvelope` before the first byte is
    written, so a broken export is a 500 at export time, not a surprise at restore time.
13. These are ordinary Node-runtime App Router handlers using `getCloudflareContext()`.
    `export const runtime = "edge"` is never used — unsupported by `@opennextjs/cloudflare`
    (stack-facts.md).

### Import — sniffing and parsing

14. `POST /api/import/analyze` takes the request body as a `ReadableStream`, tokenizes it through
    `csvTokenizer`, and flushes canonical rows into `import_staging` in chunks — it never holds the
    file, a decoded copy of it, or a whole-file `CanonicalImportRow[]` in memory. It **writes no user
    data**: it inserts an `import_batches` row with `status='staged'` and returns `ImportPlan`. On
    reaching `ANALYZE_ROWS_PER_INVOCATION` staged rows or `ANALYZE_QUERIES_PER_INVOCATION` D1
    queries it returns `202 { batchId, resumeCursor }` and the client re-`POST`s the remainder —
    the same contract apply uses (rule 45), so a large file can actually finish. A body longer than
    `ANALYZE_MAX_BYTES` is refused before parsing with `details.reason = "file-too-large"` and the
    copy "export a narrower date range".
15. `sniff()` reads only the first line plus the filename and is **header-name based, never
    positional**: strip a UTF-8 BOM, lowercase, trim, collapse internal whitespace, build a column
    map. The delimiter is chosen by comparing `,` and `;` counts **on the header line only**. MFP
    files match by filename **prefix glob** (`Nutrition-Summary*`, `Measurement-Summary*`,
    `Exercise-Summary*`) — the date suffix is noise and one real export had none (r10 §1.4.1).
16. Verified formats and their discriminators, expressed **only as required and forbidden header
    names** (r10 §1.2–§1.4). One `sniff.test.ts` case per row:

    | Source / dialect | Required header names | Forbidden header names | Units |
    |---|---|---|---|
    | `hevy-workouts` | `exercise_title`, `set_index`, `set_type`, `superset_id` | — | `weight_kg`+`distance_km` ⇒ metric; `weight_lbs`+`distance_miles` ⇒ imperial. The unit is **in the column name**; there is no unit column |
    | `strong` S1 | `Duration`, `RPE`, `Set Order` | `Weight Unit`, `Workout #`, `Duration (sec)`, `Workout Duration` | **absent from the file → ask** |
    | `strong` S2 | `Weight Unit`, `Workout Duration`, `RPE`, `Distance Unit` | `Workout #`, `Duration (sec)` | per-row `lbs`/`kg`/**blank** |
    | `strong` S3 | `Workout #`, `Duration (sec)`, and `Weight (kg)` *or* `Weight (lbs)` | `Weight Unit` | unit in the header name; `Weight (lbs)` is UNVERIFIED — sniff for it, never hardcode |
    | `strong` S4 | `Weight Unit`, `Distance Unit` | `RPE`, `Duration`, `Workout Duration`, `Duration (sec)` | per-row `Weight Unit` |
    | `mfp-nutrition` | `Date`, `Meal`, `Calories`, `Vitamin A` | — | fixed: kcal, g, mg, %DV. `Time` and `Note` are each independently present-or-absent (N1/N2/N3) |
    | `mfp-exercise` | `Date`, `Exercise`, `Type`, `Steps` | — | col 8 is named `Kilograms` **or** `Pounds` |
    | `mfp-measurement` | `Date`, `Weight`, **and exactly two columns** | anything else | **absent from the file → ask (rule 26)** |
    | `ours` | line 1 parses as `{"type":"header",…}` | — | fixed |
    | *our own CSV export* | our generated header for that table | — | `ok: false`, `reason: "ours-csv-not-importable"` — copy: "this is the spreadsheet export; import the `.ndjson` or `backup.json` instead" |

17. Column **count** is never a **rejection** criterion — MFP nutrition is legitimately 20 or 21
    columns, and any `if (cols.length !== 20) throw` rejects real files (r10 gotcha 16). A count may
    be used only as a **tiebreak hint**, after rule 16's name sets have already selected a dialect.
    `mfp-measurement`'s "exactly two columns" is the single place a count is load-bearing, and there
    it is a *width* test that routes wider files into rule 18, never a throw. S1 and S4 are
    distinguished by names alone (`Duration`+`RPE` versus `Weight Unit`+`Distance Unit`), not by both
    being 12 columns.
18. Formats r10 marks `UNVERIFIED` get **validate → report → abort**, never a guessed parser: Hevy
    `Export Measurements` (§1.2.7), any `mfp-measurement` wider than `Date,Weight` (§1.4.3), any MFP
    nutrition file with a `Food` column (§1.4.2), Strong's oldest dialect (recognised by a header
    literally **named** `lbs` or `mi.`, §1.3.1), and Strong's whole-line-quoted variant. `sniff()`
    returns `reason: "unverified-format"`, `plan.blocking` is non-empty, and the UI shows the
    detected header row **verbatim** with a copy button and "send this file to the developer".
    **Zero rows parsed, zero rows written.**
19. Malformed quoting fails loudly from the **tokenizer**, with the 1-based line number and byte
    offset, never a half-parse: `csvTokenizer` errors its stream with `CsvError`, and the route maps
    it to `validation_failed` / `details = { reason: "malformed-quoting", line, byteOffset }` (rule
    63). It is deliberately *not* a `SniffResult` outcome, because `sniff()` sees line 1 only and
    could never report line 2. The malformed fixture must produce exactly
    `{ kind: "malformed-quoting", line: 2 }`.
20. Hevy timestamps parse with a tolerant `d{1,2} MMM yyyy, HH:mm` matcher against an explicit
    English month table — never `Date.parse()`. Both `1 Dec 2025, 10:53` and `02 Jul 2025, 17:56`
    must parse; both paddings occur in real exports (r10 §1.2.3). A non-match is a per-row skip
    counted as `hevy-unparseable-timestamp` and carrying its line number, never a silent `NaN` or an
    epoch-1970 date. Strong timestamps are `YYYY-MM-DD HH:mm:ss`, uniform across all dialects (§1.3.2).
21. Every vendor timestamp is naive local wall-clock, interpreted in `Asia/Almaty` via
    `wallClockToUtcMs()`, whose algorithm, fold rule ("earlier instant wins") and gap rule ("shift
    forward") are pinned in Interfaces — **never a hardcoded `+05:00`**. workerd ships full ICU and
    reports `GMT+06:00` for `Asia/Almaty` before `2024-02-29T18:00:00Z` (r11 §8.2, re-verified here
    by probe Worker on workerd 1.20260911.1), so a fixed +5 shifts every pre-2024-03-01 session by an
    hour. `local_day` comes from the **local** fields directly: reading these stamps as UTC moves
    late-evening sessions to the next day and breaks the calendar heatmap, the streak ledger and
    every daily rollup (r10 gotcha 11).
22. `lbToKg` uses `KG_PER_LB = 0.45359237` and rounds **half-up to 2 dp**, which recovers the
    original kg from vendor float dust: `88.18 → 40.00`, `220.46 → 100.00`, `225.97 → 102.50` (Hevy
    stores kg and converts on export, r10 §1.2.4). Imported weights are **never** snapped to the
    owner's plate lattice; that rewrites history. A separate opt-in "normalise imported weights"
    action uses `plateMath()` from 07-calculators, default off.
23. A Strong row with a blank `Weight Unit` and a non-zero `Weight` is unresolvable: skipped and
    counted as `strong-blank-weight-unit`, never defaulted to kg (r10 gotcha 14 — 32 real rows in
    one file). Blank on a bodyweight row is fine.
24. Any **non-numeric `Set Order`** is a tag or pseudo-row in **every** Strong dialect, not only S3:
    `W`→`warmup`, `D`→`drop`, `F`→`failure`; `Note` → attach `Notes` to the current
    `workoutExercise` and emit **no** set; `Rest Timer` → set `rest_after_sec` on the **previous**
    set of the current exercise and emit **no** set. Both pseudo-row classes are counted in
    `skipped` with exact counts. This is the module's highest-impact rule: `Rest Timer` was 748 of
    1623 rows in one real export, and a naive `for (row of rows) insertSet(row)` doubles the set
    count, halves average weight and injects 0 kg × 0 rep sets into e1RM, volume and PR detection
    while reporting success (r10 §1.3.6, gotcha 3).
25. Hevy `set_type` maps to 02's `SET_TYPES`: `normal`→**`working`**, `warmup`→`warmup`,
    `dropset`→**`drop`**, `failure`→`failure`. A numeric Strong `Set Order` is `working`. Nothing is
    ever smuggled into the `position` column — that is the `Set Order = "W"` lesson (r10 §2.1 rule 5).
26. `mfp-measurement` carries no unit anywhere in the file or filename. `buildPlan()` returns
    `needsUnitConfirmation` with parsed `min`/`median`/`max` and a `guess` inferred from existing
    `body_measurements` history (plausibility when there is none), and **apply is refused without an
    explicit `confirmations.weightUnit`** (r10 Part 4, option (a) prefilled with (b)'s guess).
    Guessing wrong puts the bodyweight trend, the EMA, Navy body fat and the TDEE prior out by 2.2×.
27. MFP `Vitamin A`, `Vitamin C`, `Calcium`, `Iron` are **% of daily value, not a mass**. They travel
    in `CanonicalImportRow.microsPctDv` under `*_pct_dv` keys and are stored only inside
    `food_entries.ai_estimate_json`'s `importedMicrosPctDv` object — **never as mg**, where they are
    a silent order-of-magnitude corruption no unit test catches, because the numbers are plausible
    (r10 §1.4.2, gotcha 4). `Saturated Fat`, `Trans Fat`, `Fiber`, `Sugar` (g) and `Cholesterol`,
    `Potassium` (mg) carry no unit suffix in the header and are mapped explicitly by name.
28. MFP row granularity flips on the presence of a `Time` column: without it, exactly one row per
    `(Date, Meal)`; with it, one row per logged entry, up to 7 per `(Date, Meal)`, and `Time` often
    blank (r10 §1.4.2). `ordinal` is the 0-based index within `(Date, Meal, Time)` in file order,
    which is what makes the dedupe key stable across re-imports. Summing naively across both shapes
    double-counts calories in one of them. **Mapping into 02's real columns:** the vendor's `Meal`
    string goes into `food_entries.label` **verbatim** — it is user-editable and `Post-Workout` is
    real observed data, so it is never an enum — while `slot` is derived by a pinned lowercase map
    (`breakfast|lunch|dinner|snack[s]`) with **`snack` as the fallback for every other name**.
    `eaten_at` is `wallClockToUtcMs(localDay + (Time ?? the slot's default hour))`. Macro columns are
    02's: `kcal`, `protein_g`, `carb_g`, `fat_g`, `fiber_g` — all `INTEGER`, rounded half-up once at
    write (02 rule 8c).
29. MFP exercise names get **one balanced layer of literal `"` stripped after CSV decoding**: the raw
    bytes `"""Walking, 3.5 mph, brisk pace"""` RFC-4180-decode to a value that still contains the
    quotes (r10 §1.4.4), and leaving them fills the table with quote-prefixed duplicates.
30. From `mfp-exercise` only `Steps` is imported, into `daily_checkins.steps`. `Strength` rows have
    no per-set model at all and are **not** imported; `Cardio` rows are not either. Both are reported
    with exact counts (`mfp-strength-not-imported`, `mfp-cardio-not-imported`).
31. Losses are reported, never absorbed. `PlanNoteCode` is a **closed union** (Interfaces) and every
    member has an RU and an EN string under `Data.notes.<code>` in `messages/{ru,en}.json`, with
    `{count}` interpolated. The UI renders from the code; it never renders `PlanNote.message`:

    | code | RU | EN |
    |---|---|---|
    | `strong-rest-timer-rows` | Пропущено строк «Rest Timer»: {count} | {count} Rest Timer rows skipped |
    | `strong-note-rows` | Пропущено строк-заметок: {count} | {count} Note rows skipped |
    | `strong-supersets-lost` | Суперсеты из Strong не переносятся — в файле нет такого столбца | Supersets could not be imported from Strong |
    | `strong-warmup-position-lost` | Разминочных подходов без исходного номера: {count} | {count} warm-up sets imported without their original position |
    | `strong-warmups-excluded-from-vendor-charts` | Strong не учитывает разминку в своих итогах — наши суммы будут больше | Strong excludes warm-ups from its own totals, so our numbers will differ |
    | `strong-duration-suspicious` | Подозрительная длительность тренировки: {count} — импортировано как есть | {count} suspicious workout durations, imported as-is |
    | `strong-blank-weight-unit` | Строк с пустой единицей веса пропущено: {count} | {count} rows skipped: blank weight unit |
    | `hevy-superset-order-lost` | Из Hevy сохранена только группировка суперсетов, не порядок A1→B1→A2→B2 | Only superset grouping survives from Hevy, not A1→B1→A2→B2 order |
    | `hevy-duplicate-exercise-instances` | Упражнение повторяется в одной тренировке: {count} — сохранено отдельными блоками | {count} repeated exercises in one workout kept as separate blocks |
    | `hevy-unparseable-timestamp` | Строк с неразобранной датой пропущено: {count} | {count} rows skipped: unparseable date |
    | `mfp-no-food-identity` | В экспорте MyFitnessPal нет названий продуктов — записи без продукта | MyFitnessPal's export has no food names, so entries carry no food |
    | `mfp-strength-not-imported` | Силовых строк MyFitnessPal не импортировано: {count} | {count} MyFitnessPal strength rows not imported |
    | `mfp-cardio-not-imported` | Кардио-строк MyFitnessPal не импортировано: {count} | {count} MyFitnessPal cardio rows not imported |

32. Workouts group on **contiguous runs of rows**, never `(title, start_time, exercise_title)`. An
    exercise boundary is `set_index`/`Set Order` resetting **or** `exercise_title` changing; the same
    exercise twice non-contiguously in one workout yields **two** `workout_exercises` rows with
    distinct `position`. Verified real in Hevy; grouping by name merges them and loses a set (r10
    §1.2.6). Row order is load-bearing data.
33. Supersets group on `(workout, superset_id)`, never on `superset_id` alone — `0` and `1` recur
    across unrelated workouts and months (r10 §1.2.5). Strong always yields `superset_group = null`.
34. `rpe` accepts 0.5 steps in `[1,10]` (02's `sets_rpe_range` CHECK). `6.5` is real Strong data and
    illegal in Hevy's API enum, so a Hevy-shaped validator is banned: it would reject the row, and a
    lenient one would round it (r10 §1.3.7, gotcha 15).

### Exercise-name mapping

35. `parseVendorName()` strips one balanced `"` layer, splits the **trailing parenthetical** into an
    equipment token (`(Barbell)`, `(Dumbbell)`, `(Cable)`, `(Machine)`, `(Smith Machine)`,
    `(Bodyweight)`) mapped into 02's `EQUIPMENT` keys, and passes the remainder through
    `normalizeQuery()` from `src/lib/exercise/normalize.ts` (08). This module defines no second
    normaliser.
36. Matching is a fixed, deterministic ladder:
    1. `aliases` hit on the normalised name → `auto`, `1.0`.
    2. Exact normalised catalogue-name hit → `auto`, `1.0`.
    3. Bigram Sørensen–Dice `2|A∩B| / (|A|+|B|)` where `A` and `B` are **deduplicated `Set`s of
       character bigrams** over the normalised name padded with exactly one leading and one trailing
       space — so a one-character name still yields two bigrams, and a repeated bigram cannot inflate
       the score. Then `× EQUIPMENT_DISAGREE_FACTOR` if both sides yield an equipment token and they
       disagree, `+ EQUIPMENT_AGREE_BONUS` (capped at `1.0`) if they agree. Ties break by shorter
       catalogue name, then `id` byte order — never catalogue iteration order, never `Math.random`.
    4. `≥ AUTO_THRESHOLD` → `auto`; `CONFIRM_THRESHOLD ≤ s < AUTO_THRESHOLD` → `confirm` with the
       top 5; `< CONFIRM_THRESHOLD` → `new`. The four constants are UNVERIFIED-tunable (open
       question 3); `match.test.ts` pins behaviour against the fixture catalogue, not the numbers.
37. **Nothing is auto-created.** Every `new` and `confirm` appears in the dry run, and apply is
    refused while any entry lacks a confirmation; `auto` decisions are shown and overridable.
    Confirmed decisions are written to `exercise_aliases`, so the next import of the same vendor
    names is fully automatic. Both the created custom `exercises` rows **and** the
    `exercise_aliases` rows they are referenced from carry `import_batch_id`, and rollback deletes the
    alias rows **before** the exercise rows (rule 42): `exercise_aliases.exercise_id` is
    `ON DELETE restrict` (02 rule 11), D1 enforces FK constraints (quoted in r02 §4.1) and 16's
    harness forces `PRAGMA foreign_keys = ON` (16 rule 6c), so the reverse order is a guaranteed
    constraint failure in tests *and* in production.

### Dry run, idempotency, apply

38. The plan is the product, not a log line. `import-plan-table.tsx` shows creates per table,
    duplicates skipped, fields to be filled, every `skipped`/`warnings` entry with its count and up
    to 3 sample line numbers, the unmatched list, and the unit question. **Every note renders from
    `PlanNote.code` through the `Data.notes.*` catalogue with `count` interpolated (rule 31);
    `PlanNote.message` is a developer diagnostic and never reaches the screen**, so an RU-default
    owner never sees English. Wording per r10 §2.6: "312 workouts, 4,102 sets. 748 Rest Timer rows
    skipped. Supersets could not be imported from Strong. 16 warm-up sets imported without their
    original position."
39. Normalised rows are staged in `import_staging` (02: `batch_id`, `table_name`, `row_index`,
    `row_json` CHECK ≤ 65536, `U(batch_id,table_name,row_index)`), never held across requests in
    memory and never as one blob: `report_json` is also capped at 65536 bytes, so it holds the
    summary with sample lists capped at `PLAN_SAMPLE_CAP` — the full detail lives in the staged rows.
40. **File-level idempotency:** `import_batches.sha256` gets
    `CREATE UNIQUE INDEX import_batches_applied_sha_uq ON import_batches(sha256) WHERE status='applied'`.
    The index is partial, so the two cases are decided separately rather than hedged:
    - the file was already **applied** → analyze short-circuits and returns **`200`** with the earlier
      report's plan and `duplicateOfBatchId` set. A double-tap cannot double-import, and the owner
      sees what happened rather than an error. Re-*applying* an applied batch is the only path that
      is refused, and it is `conflict` / `details.reason = "already-applied"`.
    - the file is still **`staged`** → analyze returns a fresh plan with `duplicateOfBatchId` pointing
      at the stale batch, and in the same request marks that batch `aborted` and deletes its
      `import_staging` rows, so repeated analyzes cannot accumulate staging.
41. **Row-level idempotency** — the case that matters, because Hevy and Strong exports are cumulative
    and every new export contains all older workouts:
    - `workouts.import_key = ${source}:${startedAtMs}:${sha16(normalizeQuery(title ?? ""))}`, with
      `CREATE UNIQUE INDEX workouts_import_key_uq ON workouts(import_key) WHERE import_key IS NOT NULL AND deleted_at IS NULL`.
      The index **must** be partial. Soft delete sets `deleted_at` and leaves the row and its
      `import_key` in place (rule 4), so under a total unique index
      `onDuplicateWorkout: "replace"` would raise a UNIQUE constraint failure the moment it inserted
      the replacement — and because `db.batch()` is one SQLite transaction (16 rule 6b), the whole
      batch would abort.
    - A workout whose `import_key` exists **and is not soft-deleted** is skipped **whole** and counted
      as a duplicate. Sets are never merged into an existing workout — set-level merge has no safe
      identity. `onDuplicateWorkout: "replace"` soft-deletes the existing workout and its children
      and inserts fresh rows in the same batch; the partial index makes that legal, and replacing the
      same workout twice is legal too.
    - `food_entries.import_key = ${source}:${localDay}:${vendorMeal}:${timeLocal ?? "null"}:${ordinal}`,
      with the same partial-index shape. Insert-only.
    - `body_measurements` and `daily_checkins` are **fill-only** and get **no `import_key` column**.
      One column could hold only one source's key, while three sources (MFP weight, Hevy
      measurements, MFP steps) legitimately fill *different columns of the same day* — and 02 rule 15
      deliberately allows several `body_measurements` rows per `local_day`, so "the same row" needs
      defining. One ledger solves both, `import_fills` (Data): `fillImportKey(source, localDay,
      column)` is unique per `(import_key, column_name)`, a fill is skipped when that pair already
      exists, and the row a fill targets is **the existing row for that `local_day` with the smallest
      `measured_at`** — deterministic, and it never invents a second row for a day that has one. If
      no row exists for that day, one is INSERTed carrying `import_batch_id`. A non-null existing
      field is never overwritten, and every field actually written is listed in the report and in
      `import_fills` together with its `old_value_json`.
42. **Rollback has two halves, because a fill is not an insert.**
    `POST /api/import/[batchId]/rollback`: (1) reverts every `import_fills` row of the batch by
    writing `old_value_json` back into `(table_name, row_id, column_name)`, then deletes those ledger
    rows — an owner's pre-existing weigh-in is restored to exactly what it was, never destroyed;
    (2) **hard** deletes rows whose `import_batch_id` was set **at INSERT time**, child → parent —
    `sets` → `workout_exercises` → `workouts` → `food_entries` → `daily_checkins` →
    `body_measurements` → `exercise_aliases` → `exercises` — chunked into `db.batch()` calls; then
    sets `status='rolled_back'`. Half (2) is the one import path that bypasses soft delete, because
    those rows were never the owner's own data; half (1) exists precisely because a filled row *was*.
    Rollback of a `replace` batch is refused (`conflict` / `details.reason = "rollback-refused"`) —
    the replaced originals are soft-deleted, not recoverable in place — and the UI says so *before*
    the owner picks `replace`. **Rule 42 does not apply on the restore path: see rule 47.**
43. Apply writes through `db.batch()` only. There is no `db.transaction()` on D1 — drizzle emits raw
    `begin`/`commit`, D1 is auto-commit, and it type-checks then fails at runtime (r02 §4.6). Chunk
    so that `rows × columns ≤ 90` bound parameters **per statement** — 90, not 100, for the same
    headroom 10 rule 65 keeps against r02's hard ceiling of 100 (r02:1051, §4.7). With this spec's
    added columns `sets` is **25** columns → **3** rows per multi-row insert (75 params),
    `food_entries` is 24 → 3, `workouts` is 20 → 4; or one statement per row at ≤ 50 rows per batch.
    Stay under 1000 queries per invocation and never hand D1 an empty batch (r02 §2.7, §2.8, §4.8).
    `tests/unit/export/params.test.ts` counts parameters statically (16 rule 6a) so the next added
    column fails CI instead of production — which is exactly how 02:115's stale "24 columns → cap 4
    rows" comment would otherwise have survived into a runtime failure.
44. Apply runs with side effects disabled (RT-5): no web push, no Telegram, no achievement unlocks,
    no streak-ledger notifications, no `ai_prompt_logs` writes. Derived columns are recomputed
    **after** the batch commits, as a separate pass, and that pass is opt-in (`recomputeDerived`,
    default **false** for third-party sources) so an import never rewrites the PR feed or moves
    historical PR dates (r10 gotcha 6).
45. If apply nears the CPU budget it returns `202 { batchId, resumeCursor }` and the client
    re-`POST`s; `status` stays `'staged'` until the final chunk lands. Partial application is visible
    only through `import_batch_id` and `import_fills`, and rollback cleans up both.

### Our own restore, and the round-trip guarantee

46. `POST /api/import/apply` on a batch whose `source` is `"ours"` is a **restore**, not a merge. The
    file reaches it exactly the way every other source does — `POST /api/import/analyze` sniffs and
    stages the NDJSON, then `POST /api/import/apply { batchId, confirmations: {} }` applies the
    staged plan. **There is no second route and no `?mode=restore` parameter**; a raw-body restore
    endpoint would need its own staging contract inside one request, which rule 49 forbids.
    `schemaVersion > SCHEMA_VERSION` → refuse (`conflict` / `details.reason = "schema-too-new"`):
    "this backup was made by a newer version of the app". `<` → apply `upcasts[v]` in sequence over
    the parsed document **before any DB write**; each upcast is pure and pinned by a fixture forever.
    `appVersion` and `d1Migration` are diagnostics and never control flow (r10 §2.3).
47. Restore reuses every `id` verbatim (RT-2): no surrogate keys, no autoincrement, no renumbering —
    which is exactly why 02's PKs are client-minted 26-char ULIDs. `rev`, `created_at`,
    `updated_at`, `deleted_at`, `import_key` and `import_batch_id` all round-trip **unchanged**.
    Restored rows keep the `import_batch_id` they were exported with; the restore's own batch id is
    **never** stamped onto them, and no `import_fills` row is written for a restore — so rule 42's
    "every inserted row carries `import_batch_id`" is an *import* rule, not a restore rule, and the
    two do not contradict. This is also why `import_batch_id` is a plain `TEXT` provenance column
    with **no foreign key** (Data): after `scripts/wipe-d1.sql` the referenced `import_batches` row is
    gone, and an FK would fail the restore of every previously-imported row with foreign keys on.
    `import_batches`, `import_fills` and `exercise_aliases` are themselves exported and restored, so
    provenance survives too. The RT fixture therefore **must** contain one imported workout with a
    non-null `import_batch_id` and `import_key`.
48. Restore **never mints an R2 key** (RT-3). After restore, every key-bearing column is `===` the
    string in the backup — the full set, from 02's and 10's real column lists, is
    `photos.r2_key`, `photos.thumb_key`, `photos.orig_key`, `ai_prompt_logs.output_r2_key` and
    `exercise_media.r2_key`, plus `photos.sha256`, `photos.r2_etag` (the **bare, unquoted** form,
    r03 G17) and `photos.r2_purged_at`, which changes what a missing object *means*. **There is no
    `archive_key` column anywhere in the schema.** Before writing anything, restore `head()`s every
    `manifest.r2.objects` entry: a `missing` object whose row has `r2_purged_at IS NULL`, or a
    `sizeMismatched` object, **fails the import closed**; a `missing` object whose row is already
    purged, and every `sha256Absent` entry, are reported warnings. Be precise about what that proves:
    `head(key)` returns size, etag and `customMetadata` (r03 §1, and the upload path stores the digest
    as `customMetadata.sha256` at r03:456), so it proves **existence, size and the stored sha256
    *claim*** — it is not a checksum of the bytes, and a truncated-then-repadded object would pass.
    A real digest over photo bytes is computed in exactly one place, rule 55's quarterly archive DoD.
    Restore never nulls a key and never substitutes a placeholder — a dangling key makes the compare
    slider silently show the wrong body, which is worse than a failed restore (r10 gotcha 7). A key
    change is a migration with its own `schemaVersion` bump and an explicit rewrite table in the
    manifest, never a side effect of restore.
49. Restore stages into `import_staging`, validates counts and FKs against `manifest.counts`, and
    only then performs the wipe-and-swap in a single `db.batch()` (RT-6). A restore that dies halfway
    leaves the previous database intact, never a half-wiped one.
50. Columns named in `manifest.derivedColumns` are imported **verbatim**, then recomputed, and the
    recomputation **asserts equality** against what was imported. A mismatch is a loud, row-naming
    failure in the report, never a silent overwrite (RT-4) — this is how "we changed the Epley
    constant and quietly rewrote three years of PRs" is caught. `derivedColumns` is a real
    `table → [column]` map using 02's own names, and the tolerance depends on the **type**, because a
    kilogram epsilon is meaningless for a boolean, a percentage or a kcal integer:

    | `table.column` | tolerance | source |
    |---|---|---|
    | `sets.e1rm_kg`, `workouts.volume_kg` | `PR_EPSILON_KG = 0.01` | 02:111 / 07 — the same epsilon PR detection uses, so RT-4 cannot fail on a difference too small to move a PR |
    | `body_measurements.trend_kg` | `1e-6` | r09 §4 pins the EMA chain to 6 dp (`… 82.108806`) |
    | `body_measurements.body_fat_pct`, `daily_checkins.readiness`, `streak_state.adherence_pct`, `tdee_snapshots.blend_w` | `1e-9` | r09 §6's float epsilon — both sides are the same pure function of the same inputs, so only binary64 noise can differ |
    | `sets.is_pr`, `sets.pr_kinds_json`, `workouts.hard_sets`, `xp_ledger.xp`, `streak_state.{current_days,current_weeks,longest_days,longest_weeks}`, `tdee_snapshots.tdee_est`, `quests.progress_value`, `achievement_unlocks.progress` | **exact `===`** | booleans, integers and JSON strings have no representable noise |

51. **RT-1:** `canon(E(I(W(D), E(D)))) === canon(E(D))` as a **byte-for-byte string equality** on the
    canonical JSON — not "semantically equal", not "same row counts". This is achievable *only*
    because `canonicalise()` drops `CANON_VOLATILE_KEYS` and the whole `footer` frame (Interfaces):
    the two exports are taken seconds apart, so `exportedAt` differs by construction and
    `footer.sha256` differs with it, and without the drop `cmp` would always print output — which the
    spec itself would then call an RT-1 failure. `W` means **D1 only**; R2 is left intact and RT-3
    verifies every key still resolves with a matching size. This is r10 Part 4 **Option A**, adopted
    as the Phase 9 DoD. Option B (wipe D1 *and* R2, restore photo bytes) is rule 55's separate
    deliverable: doing B first risks Phase 9 sliding on multipart plumbing while the far likelier
    failure — a bad migration wrecking D1 — goes uncovered.

### Scheduled R2 backup

52. `src/jobs/steps/backup.ts` is a `CronStep` (14 `src/jobs/steps/types.ts`, 14:49), invoked by 14's
    `backup-to-r2` chain — `achievement-sweep` → `watchdog` → [`photo-gc`, 10 amendment 14.1] →
    `backup` — on cron `"0 18 * * *"` (23:00 Almaty, 14:362). **14 owns the Almaty-Sunday gate and
    the step order; this step body has no gate of its own** and runs whenever it is called, which is
    also what makes it testable on any weekday. It derives every date from
    `CronJobContext.scheduledTime` (01:319) — never `new Date()` (14 rule 14). It takes `env` from
    that context: `getCloudflareContext()` throws in a cron handler in both modes (r02 §2.3,
    r01 §4.2), and everything reachable from `worker.ts` stays framework-free (r01 §4.11). All crons
    are daily, so all sit in the 15-min CPU bucket (r01 §4.1); wall-clock Duration is a hard 15 min
    and network waits count against it.
53. Each run writes into R2 **`BACKUPS`** (`fitness-backups`, 01:95, 01:260, and the 13-binding
    deploy assertion at 01:591) — **never `PHOTOS`**. A bucket no photo sweep can reach is the whole
    point of 01 giving backups their own binding, and it is why rules 9, 58 and 60 need no `backups/`
    carve-out. Keys follow 01:525's `backups/{weekly|monthly|manual|archive}/…` layout and 01's
    lowercase `[a-z0-9/._-]` rule:

    ```
    backups/weekly/<yyyy>/<mm>/fitness-<local_day>.ndjson.gz   (+ .manifest.json, .verify.json)
    backups/monthly/<yyyy>/fitness-<local_day>.ndjson.gz       (+ .manifest.json)
    backups/manual/<yyyy>/<mm>/fitness-<ISO>.ndjson.gz         (+ .manifest.json, .verify.json)
    backups/archive/<yyyy>-q<n>/photos-<yyyy>-<mm>.zip         (+ archive.manifest.json)
    ```

    The scheduled name carries the **Almaty local day**, adopting 14:385 verbatim: "the R2 key
    contains the local date; `put` overwrites it → byte-identical rewrite, never a duplicate object".
    A retried firing therefore rewrites one object instead of creating a second, which a
    `scheduled_at`-derived name would not. `cron_runs.scheduled_at` still identifies the run — it
    travels in the envelope as `runKey`, not in the key. Manual backups use the full ISO instant, so
    several in one day are distinct. The `.manifest.json` sibling is uncompressed and holds the
    envelope, `counts` and the body SHA-256, so the ledger and the verify path can read the header
    cheaply. Object `customMetadata` carries `src-sha256`; **both it and the footer's `sha256` cover
    the UNCOMPRESSED NDJSON bytes.** Gzip is `new CompressionStream("gzip")` and the verify/restore
    path uses `new DecompressionStream("gzip")` — both **VERIFIED** on workerd 1.20260911.1 @
    compatibility_date 2026-09-01 by a probe Worker that round-tripped 1000 bytes through
    `pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip"))`. That
    retires 14:524's "UNVERIFIED on workerd" caveat and removes any need for an `fflate` gzip
    fallback. No backup state lives in KV: KV is a cache only, a miss is never an error, and no
    authoritative counter may live there (01 §Data, r04 §4.8). Resume state for a part-finished
    multipart upload is a sibling `….resume.json`, deleted on completion.
54. Retention (`planRetention`, pure): keep the last **8** weekly; the run whose Almaty local day is
    ≤ 7 is also **promoted** to `backups/monthly/…` and **12** monthlies are kept; **5** manual; **4**
    quarterly archives. R2's Workers binding has **no copy operation** — r03 §1 lists exactly
    `head`, `get`, `put`, `createMultipartUpload`, `resumeMultipartUpload`, `delete`, `list` — so
    promotion is a streamed `get(weeklyKey).body → put(monthlyKey, body, { customMetadata })` in
    `promote.ts`, carrying `src-sha256` across. It doubles the step's wall clock for exactly one
    object per month, which is budgeted and stated rather than hidden behind the word "copied". Keys
    are ISO-prefixed, so lexicographic order is chronological: GC is `list({ prefix, cursor })`
    paginated on `truncated`, then `delete()` on the tail in ≤ 1000-key chunks
    (`delete(keys: string | string[])` verified in r03 §1; the per-call cap is UNVERIFIED, 1000 is
    safe; `DeleteObject` is free).
55. On the first Sunday of a quarter the step also runs `archive.ts`, which writes **sharded** photo
    archives — one ZIP per year-month, `backups/archive/<yyyy>-q<n>/photos-<yyyy>-<mm>.zip`, plus one
    `archive.manifest.json` — never one monolithic file. `fflate`'s streaming `Zip` shows no Zip64
    *write* path (Zip64 appears only in its unzip reader, `esm/browser.js`), so each shard must stay
    well under 4 GiB; sharding also makes the step resumable per month. Its DoD is the **only** place
    a real digest of photo bytes is computed: delete the R2 photo prefix, restore from the archive,
    and every photo returns with a SHA-256 — taken with `crypto.DigestStream` over the restored bytes
    — matching `photos.sha256`. Rows whose `sha256` is NULL are reported, never passed.
56. **The step verifies its own backup.** Right after the upload it runs `verifyBackup()` — re-reads
    the object, gunzips it with `DecompressionStream("gzip")`, recomputes the body digest
    incrementally and compares it to both the footer's `sha256` and `customMetadata["src-sha256"]`,
    Zod-validates every row, compares `counts` against the manifest, and `head()`s every
    `manifest.r2.objects` entry with rule 9's three-way outcome — then writes the result to a sibling
    `….verify.json`. A failure throws, so `cron_runs.ok = 0` and 14's alerting fires: a silently
    missing or corrupt backup is the worst failure in this area. An unverified backup is reported in
    the UI as **not yet a backup**.
57. The owner verifies restorability two ways, both risk-free: `POST /api/backups/verify` runs the
    same `verifyBackup()` on demand and writes nothing; and the full round-trip proof
    (Verification step 3) runs against the **local** D1 using a downloaded production backup.
58. `import_staging` rows, and `import_batches` rows still in `status='staged'`, older than **7 days**
    are deleted by the same step. Because 14 gates the step on Almaty Sunday, worst-case retention is
    13 days — stated rather than implied. **This step does not sweep R2 photo objects.** 10 rule 66
    assigns `sweepDeletedPhotoObjects()` to a new `photo-gc` step in 14's chain (10's amendment 14.1),
    correcting 10's earlier claim that this rule invoked it; the only place this spec deletes a photo
    object is the full purge (rule 60).

### Full deletion

59. `POST /api/data/purge` requires `{ phrase, keepFinalExport, deleteExistingBackups }`. The phrase
    is compared as `phrase.normalize("NFC").trim() === PHRASE`, where `PHRASE` is the NFC form of
    `УДАЛИТЬ ВСЁ` (RU is default) or `DELETE EVERYTHING` — exact case, NFC-normalised because `Ё`
    arrives composed from some keyboards and decomposed from others, and a naive `===` would reject a
    correctly typed phrase. Plus the re-auth challenge from 04 (`verifyPassword`, and `verifyTotp`
    when a TOTP credential is enrolled). Refused while the outbox is non-empty (rule 11's advisory
    header, plus the page's own gate).
60. Order: (1) unless `keepFinalExport: false`, write a final backup under `backups/manual/…` and
    return its key; (2) **hard** `DELETE FROM` every app table in FK-safe child → parent order via
    chunked `db.batch()` (`scripts/wipe-d1.sql`'s order), counting rows per table — this is the only
    place in the app that issues a real `DELETE` of user history, because soft delete is the default
    everywhere else (02 rule 25) — never touching `d1_migrations` or `NEXT_TAG_CACHE_D1`; (3) sweep
    R2 `PHOTOS` **entirely** with paginated `list({ prefix: "photos/", cursor })` + `delete()` in
    ≤ 1000-key chunks; (4) sweep R2 `BACKUPS` only when `deleteExistingBackups` is true, and even
    then skip the key written in step 1 while `keepFinalExport` is true; (5) sweep KV `CACHE_KV`
    **entirely** with a paginated `list({ prefix, cursor })` + `delete()` loop over each of its
    prefixes (`sys:`, `cache:`, `cron:`, `notify:`, `coach:`) — legitimate because it is a cache and
    01 guarantees a miss is never an error; (6) return the counts. **`EXERCISE_MEDIA` and KV
    `NUTRITION_CACHE` are never touched**: the first is seeded library media in its own bucket
    (01:93, keys `exercises/<source_id>/<idx>.jpg` — it was never inside `PHOTOS`, so there is no
    `exercises/media/**` carve-out to make), the second caches public food databases, not user data.
61. The client half is not optional. On `200` the page calls `resetLocalDb()` (05 `src/db/local.ts`),
    unregisters the service worker, purges every `caches.keys()` entry, clears `localStorage`, and
    hard-reloads to onboarding. A purge that leaves the `outbox`, `mirror` and `blobs` stores
    populated re-syncs the deleted data back on the next flush.
62. Deletion is irreversible and says so **honestly**. `GET /api/data/purge` returns `PurgePreview`,
    read live before the phrase field is enabled, and the confirmation names the exact per-table row
    counts and photo-object count **and** — in the same weight of type — how many existing backup
    objects and how many bytes will **survive**, each of them containing the full corpus including
    `ai_prompt_logs`. `deleteExistingBackups` is a checkbox next to that sentence, default **off**.
    Claiming "irreversible" while 8 weekly and 12 monthly full backups sit in R2 would be a lie, and
    naming only the D1 counts would be a half-truth.

### Errors, empty and loading states

63. Every route answers through 01's contract and **only** 01's contract: an `AppError` carrying one
    of 01:337's eight `ApiErrorCode` values, rendered by `jsonError(request, error)` into
    `ApiErrorBody = { error: { code, message, requestId, details? } }` (01 rule 19, 01:347). This
    module invents no code, no status and no wire shape — the module-specific discriminator lives in
    `details.reason`:

    | Condition | `code` | status | `details` |
    |---|---|---|---|
    | invalid body / Zod failure | `validation_failed` | 400 | `{ reason: "bad-body", issues }` |
    | no session | `unauthenticated` | 401 | — |
    | body > `ANALYZE_MAX_BYTES` | `validation_failed` | 400 | `{ reason: "file-too-large", bytes, maxBytes }` |
    | `sniff` → `unknown-format` | `validation_failed` | 400 | `{ reason: "unknown-format", headerLine }` |
    | `sniff` → `unverified-format` | `validation_failed` | 400 | `{ reason: "unverified-format", headerLine }` |
    | `sniff` → `ours-csv-not-importable` | `validation_failed` | 400 | `{ reason: "ours-csv-not-importable", headerLine }` |
    | tokenizer `CsvError` | `validation_failed` | 400 | `{ reason: "malformed-quoting", line, byteOffset }` |
    | missing exercise or unit confirmations | `validation_failed` | 400 | `{ reason: "missing-confirmations", exercises, weightUnit }` |
    | `plan.blocking` non-empty | `conflict` | 409 | `{ reason: "plan-blocked", notes }` |
    | `X-Outbox-Pending` non-zero | `conflict` | 409 | `{ reason: "outbox-not-empty", pending }` |
    | re-apply of an applied batch | `conflict` | 409 | `{ reason: "already-applied", batchId, appliedAtMs }` |
    | rollback of a `replace` batch | `conflict` | 409 | `{ reason: "rollback-refused", batchId }` |
    | `schemaVersion > SCHEMA_VERSION` | `conflict` | 409 | `{ reason: "schema-too-new", schemaVersion, supported }` |
    | canonical JSON over budget | `validation_failed` | 400 | `{ reason: "corpus-too-large-for-json", rows, bytes }` |
    | unknown backup key | `not_found` | 404 | `{ reason: "backup-not-found", key }` |
    | R2 or D1 refused the operation | `upstream_failed` | 502 | `{ reason: "r2-failed" \| "d1-failed" }` |
    | anything else | `internal` | 500 | — |

    `POST /api/backups/verify` on a **corrupt** backup is a `200` carrying
    `VerifyResult.ok === false` — the report is the product, not an error. Never a bare 500 without a
    `code`. Open question 2 records that 413/415/422 would be more RFC-accurate and that widening
    `ApiErrorCode` / `httpStatusFor` is 01's decision, not this spec's.
64. Empty states: no data → export disabled, "nothing to export yet"; no backups → "the first backup
    runs Sunday 23:00 — run one now"; a plan with zero creates and non-zero duplicates → "this file
    has already been imported — nothing to do".
65. **Offline state**, because every action on this screen needs the network and the app is
    offline-first everywhere else. With `navigator.onLine === false` or a failed `/api/health`:
    export, import, backup-refresh and purge are **disabled** with "this needs a connection"; the
    last known backup timestamp and count still render from the cached `GET /api/backups` response;
    the danger zone is hard-disabled with the phrase field removed from the tab order; and an offline
    import attempt is never queued into the outbox — a 25 MB file has no business in IndexedDB.
66. Loading: analyze shows a determinate bar driven by bytes parsed; apply shows rows written of rows
    planned. Both cancel, and cancelling before apply deletes the staged rows and marks the batch
    `aborted`.

## Data

**02-data-model.md is the canonical D1 definition** and already owns `import_batches` and
`import_staging`. Nothing here renames anything: the local-day column is **`local_day`** and its
helper is **`toLocalDay`** in `src/db/local-day.ts` (02:41, 02:65, 02:97, 02 rule 5, 02:8). This
module needs these *additions*, and **02 must carry every one of them in its migration**:

1. `import_batches`: **widen the `source` CHECK from 02:293's six values to this spec's seven
   `ImportSource` values** — `hevy-workouts`, `hevy-measurements`, `strong`, `mfp-nutrition`,
   `mfp-measurement`, `mfp-exercise`, `ours`. Without this widening every Hevy import fails on
   insert. Add `dialect TEXT`; add `'rolled_back'` to the `status` CHECK and a `rolled_back_at`
   timestamp; add `unit_confirm_json TEXT` CHECK ≤ 65536; add
   `CREATE UNIQUE INDEX import_batches_applied_sha_uq ON import_batches(sha256) WHERE status='applied'`.
   **Migration-safety note:** those seven strings are embedded in every `import_key` and every
   `import_fills.import_key` (rule 41), so they are a permanent data format — they can be added to,
   never renamed.
2. New table `exercise_aliases` — `alias_norm TEXT PRIMARY KEY`,
   `exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE restrict`, `source TEXT NOT NULL`,
   `score REAL NOT NULL`, `decided_by TEXT NOT NULL CHECK IN ('auto','user')`,
   `import_batch_id TEXT`, `created_at` (`tsNow`). Indexes
   `exercise_aliases_exercise_id_idx (exercise_id)` and `exercise_aliases_import_batch_id_idx`. No
   `syncCols` — it is derived, rebuildable, and must not fight sync. `import_batch_id` is what lets
   rule 42 delete an alias before its exercise; without it the `ON DELETE restrict` FK makes rollback
   of a batch that created a custom exercise permanently impossible.
3. New table `import_fills` — the fill before-image and dedupe ledger (rule 41). `id: pk()`,
   `batch_id TEXT NOT NULL`, `import_key TEXT NOT NULL`, `table_name TEXT NOT NULL`,
   `row_id TEXT NOT NULL`, `column_name TEXT NOT NULL`, `old_value_json TEXT` CHECK ≤ 65536,
   `new_value_json TEXT` CHECK ≤ 65536, `created_at` (`tsNow`).
   `U(import_key, column_name)`, `I(batch_id)`, `I(table_name, row_id)`. No `syncCols`.
4. `import_batch_id TEXT` on `workouts`, `workout_exercises`, `sets`, `body_measurements`,
   `food_entries`, `daily_checkins`, `exercises`, `photos` — each with its own index. **Plain TEXT
   provenance, deliberately with no `REFERENCES import_batches(id)`**: rule 47 explains why an FK
   would fail every restore after a wipe, and 02 rule 11 would force `onDelete:"restrict"`, which
   would additionally block `import_batches` retention deletes.
5. `import_key TEXT` on `workouts`, `food_entries` and `photos`, each with
   `CREATE UNIQUE INDEX <table>_import_key_uq ON <table>(import_key) WHERE import_key IS NOT NULL AND deleted_at IS NULL`
   — **partial**, for the reason spelled out in rule 41. `body_measurements` and `daily_checkins` get
   **no** `import_key` column; their provenance lives in `import_fills`. `photos.import_key` is
   written only by the archive-restore path (rule 55), as `archive:<yyyy>-q<n>:<r2_key>`, so a
   partially completed archive restore can be re-run: it skips objects it already inserted instead of
   aborting the whole batch on `photos.r2_key`'s total UNIQUE index. 10 rule 68 pins `photos.csv`'s
   header and already expects both of these columns.
6. Update 02:115's comment on `sets` from `24 columns → bulk-insert cap 4 rows` to
   `25 columns → bulk-insert cap 3 rows` (rule 43), and add the equivalent note to `food_entries`
   (24 → 3). A stale comment here is how the 100-bound-parameter ceiling gets crossed silently.

**Amendments required in `10-body-photos.md`:** none. 10 rules 66–69 and
`src/server/photos/manifest.ts` (10:93, 10:298) already define `listPhotoObjectsForManifest()` and
`PhotoManifestObject`, already own `photos.csv`'s header, and already reassign the R2 sweep to 14's
`photo-gc` step. This spec consumes all of it verbatim; rules 8, 9, 48 and 58 are written against it.

**Amendment required in `16-testing-ci-quality.md`:** `almatyDay()`'s fixed
`ALMATY_UTC_OFFSET_MIN = 300` (16:93) is correct only for instants at or after
`2024-02-29T18:00:00Z`. 16's own fixture history is 8 weeks ending in 2026, so nothing there breaks,
but the doc comment must say so — and `tests/unit/import/tz.test.ts` asserts literal ISO strings
rather than calling `almatyDay()` for any pre-2024 vector.

Reads and writes every other app table for export and restore: `settings`, `volume_weights`,
`exercises`, `exercise_muscles`, `exercise_media`, `exercise_aliases`, `programs`, `routines`,
`routine_exercises`, `deload_blocks`, `workouts`, `workout_exercises`, `sets`, `personal_records`,
`body_measurements`, `photos`, `foods`, `meals`, `meal_items`, `food_entries`, `water_logs`,
`tdee_snapshots`, `daily_checkins`, `goals`, `streak_state`, `streak_ledger`, `xp_ledger`,
`achievement_unlocks`, `quests`, `mutations`, `push_subscriptions`, `telegram_state`,
`notification_log`, `ai_prompt_logs`, `cron_runs`, `import_batches`, `import_staging`,
`import_fills`. It never touches `d1_migrations` or `NEXT_TAG_CACHE_D1`, and it excludes `users`,
`sessions` and `auth_credentials` — 04:42 keeps auth rows out of the export and the R2 backup.

Conventions inherited and relied on (02 §Interfaces, r02 §2.8): timestamps are
`integer({ mode: "timestamp_ms" })` (never `mode: "timestamp"` — it truncates to whole seconds);
booleans are `integer({ mode: "boolean" })`; weights/RPE/RIR are `real`; **`local_day TEXT`** is
`YYYY-MM-DD` computed in app code by `toLocalDay()` with a `GLOB` CHECK, never derived from a UTC
epoch in SQL; JSON columns are `jsonCol` with a ≤ 65536 CHECK; `syncCols()` adds `created_at`,
`updated_at`, `rev`, `deleted_at` to every user table.

**R2 `BACKUPS`** (binding at 01:95, bucket `fitness-backups`; key layout from 01:525). Written by
this module and by nothing else:

```
backups/weekly/<yyyy>/<mm>/fitness-<local_day>.ndjson.gz   (+ .manifest.json, .verify.json)
backups/monthly/<yyyy>/fitness-<local_day>.ndjson.gz       (+ .manifest.json)
backups/manual/<yyyy>/<mm>/fitness-<ISO>.ndjson.gz         (+ .manifest.json, .verify.json)
backups/archive/<yyyy>-q<n>/photos-<yyyy>-<mm>.zip         (+ archive.manifest.json)
```

Plus the transient `….resume.json` sibling. Keys stay lowercase `[a-z0-9/._-]`, are never reused,
and contain no PII (01 §Data).

**R2 `PHOTOS`** — read-only here: `photos/{kind}/{yyyy}/{mm}/{ULID}/{variant}.{ext}` (r03 §5,
specs/10), `head()`ed on the verify and restore paths (rules 9, 48) and read for the quarterly
archive (rule 55). Written never; deleted only by the full purge (rule 60).
**R2 `EXERCISE_MEDIA`** — `exercise_media.r2_key` values round-trip as opaque strings (rule 48); the
bucket itself is never read, written or deleted here.

**KV `CACHE_KV`**: read-only here (`cron:last-ok:backup-to-r2`, written by 14) **except during
purge**, where rule 60 step 5 sweeps it entirely with a paginated `list({ prefix, cursor })` +
`delete()` loop. This module adds no KV key of its own — see rule 53. **KV `NUTRITION_CACHE`** is
never touched, in purge or otherwise.

**IndexedDB** (Dexie, owned by 05-pwa-offline-sync.md): reads the `outbox` count to gate export and
purge **client-side** (rule 11), and calls that spec's `resetLocalDb()` on purge. Defines no store
and no index.

## UX notes

- The Data screen is a full **page** at `Settings → Data`, not a sheet: it is the one place where a
  wrong tap is unrecoverable, so it gets its own route, an explicit back affordance, and no
  swipe-to-dismiss.
- Import is a **bottom sheet** with three stops (`file → plan → applying`) dragged up from that
  page, so the file picker and the confirm button both land in the bottom third of a 6.7" screen.
  The plan table scrolls inside the sheet; the primary action stays pinned to the sheet's bottom
  edge, thumb-reachable one-handed.
- The unmatched-exercise resolver is a **separate stacked sheet** over the plan, one name at a time,
  with a 56 px primary candidate button and a search field. Resolving 40 names must be 40 taps, not
  40 dropdown interactions.
- Haptics: one light impact when analyze completes; a success notification haptic on apply; a
  **warning** haptic the first time the danger-zone phrase field gains focus. No haptic per match
  confirmation — 40 buzzes is punishment.
- Animation: plan counts spring up from 0 over ~400 ms (`motion`); the apply bar is a width
  transition only. `prefers-reduced-motion` disables both and renders final values at once.
- Skeletons: 3 shimmer rows at the real row height for the backup list; a 6-row skeleton for the
  plan table while analyze streams. Never a spinner over an empty screen.
- The export card offers three artefacts and labels them honestly, because two restore and one does
  not: **`.ndjson`** ("the backup — import this back into the app"), **`backup.json`** ("the same
  data, readable and diff-able; unavailable on a very large history"), and **`.zip` of CSVs** ("for
  spreadsheets only — this one cannot be imported back"). The permanent, non-dismissible note sits
  under the ZIP button, where it is true: **"do not open and re-save this in Excel."** In an RU
  locale Excel turns `102.5` into text and `.` into `,`, and our own importer then reads `102,5` as
  two columns (r10 gotcha 20).
- Destructive controls (`purge`, `rollback`, `replace`) never take the lime accent — the accent is
  reserved for the safe action. The destructive action is outlined red on the OLED-black canvas and
  stays disabled until the phrase matches exactly.
- a11y: the plan table is a real `<table>` with a `<caption>` and `scope="col"` headers so a screen
  reader can navigate it; the phrase field has `aria-describedby` pointing at the live row-count
  **and surviving-backup-count** summary (rule 62); `aria-live="polite"` announces analyze completion
  and apply progress at 25 % steps; every note is a list item whose accessible name includes its
  count, rendered from the RU/EN catalogue (rule 31) — severity is never colour alone, and never
  English on an RU device.

## Risks

| Risk | Mitigation |
|---|---|
| A naive Strong import doubles set counts and poisons e1RM/PR/volume with 0 kg × 0 rep sets (`Rest Timer` = 748/1623 rows in a real export) | Rule 24 + `tests/unit/import/strong.test.ts` asserting exact skip counts on the pinned fixture |
| An imperial Hevy file read as kg → a 185 kg bench "PR", confetti, a permanently poisoned `personal_records` | Header-**name** indexing only (rules 15–17); a test asserting `weight_lbs` headers yield kg; `recomputeDerived` defaults to false |
| A semicolon Strong file parsed with `,` → "1 workout imported", exit 0 | Delimiter sniff on the header line (rule 15); one fixture per dialect; a test asserting S2 yields ≥ 1 set |
| A dialect table keyed on column *count* would contradict rule 17 and reject real files | Rule 16 is expressed purely as required/forbidden header **names**; count is a tiebreak hint only (rule 17) |
| A fixed `+05:00` shifts pre-2024 history an hour, breaking the heatmap, the streak ledger and daily rollups | `wallClockToUtcMs()` via `Intl` with the algorithm, fold and gap rules pinned (rule 21, Interfaces) and vectors either side of the verified `2024-02-29T18:00:00Z` transition |
| An ambiguous wall clock inside the fold resolves differently in two runs | `classifyWallClock` + "earlier instant wins", asserted on `2024-02-29 23:00` |
| `JSON.stringify(wholeDatabase)` OOMs the 128 MB isolate as the corpus grows | NDJSON + keyset paging on export, streaming resumable analyze on import (rules 1–3, 14); the canonical-JSON route refuses over budget; review ban on whole-table reads |
| A one-shot `crypto.subtle.digest` forces the whole payload into memory, reintroducing the OOM | `crypto.DigestStream` tee, verified in workerd (Interfaces, rule 53) |
| OpenNext buffers route-handler responses, so every export OOMs regardless of our care | Verified against the shipped wrapper: `cloudflare-node`, `supportStreaming: true`, `ReadableStream` created in `writeHeaders` (rule 2), plus a first-byte-latency assertion in Verification step 3b |
| `fflate` resolved through the `node` condition pulls in `worker_threads`, or `AsyncZipDeflate` throws on a missing `Worker` | Import `fflate/browser`, sync classes only, ZIP only (rule 6); a build assertion that the bundle contains no `worker_threads` |
| A half-wiped database from "wipe then insert" under a CPU ceiling | Stage in `import_staging`, swap in one `db.batch()` (rule 49, RT-6) |
| A restore fires hundreds of notifications, unlocks achievements, rewrites streaks | Side effects disabled during apply (rule 44, RT-5); an integration test asserting zero push/Telegram calls |
| A dangling `r2_key` after restore makes the compare slider show the wrong body | `head()` every manifest object before writing; fail closed (rule 48, RT-3) |
| `head()` mistaken for an integrity check, so a corrupted object passes verify | Rule 48 states exactly what `head()` proves; real digests only in rule 55's archive DoD; `sha256Absent` is a reported warning, never a pass |
| Export filters `deleted_at IS NULL`, so restore resurrects deleted sets | Rule 4 + an RT-1 fixture containing a soft-deleted row |
| Re-importing next month's cumulative Hevy export duplicates every workout | `workouts.import_key` + partial unique index + whole-workout skip (rule 41); a test that importing the same fixture twice leaves counts unchanged |
| `onDuplicateWorkout: "replace"` hits a UNIQUE violation and aborts the whole batch | The index is partial on `deleted_at IS NULL` (rule 41); a roundtrip case replaces the same workout **twice** |
| Rollback of a fill-only import destroys a weigh-in the owner entered by hand | `import_fills` before-images; rollback reverts fields rather than deleting rows (rules 41–42) |
| Row-level dedupe fails for the second source that fills the same day | The key lives in `import_fills` keyed `(source, local_day, column)`, not in one row column (rule 41) |
| Rollback of a batch that created a custom exercise is refused forever by `exercise_aliases`' RESTRICT FK | `exercise_aliases.import_batch_id` + child-first delete order (rules 37, 42); an integration case that rolls two created exercises back to zero |
| Restore fails on an FK from `import_batch_id` to a wiped `import_batches` row | `import_batch_id` is plain TEXT with no FK; `import_batches`/`import_fills`/`exercise_aliases` are themselves exported (rule 47, Data) |
| RT-1 can never pass because `exportedAt` differs between the two exports | `CANON_VOLATILE_KEYS` + footer drop in `canonicalise()`; the golden file is produced by the same function (rule 51) |
| MFP weight guessed as kg when it was lb → trend, EMA, Navy BF and the TDEE prior all out by 2.2× | Apply refused without an explicit unit confirmation (rule 26) |
| A guessed parser for an `UNVERIFIED` format writes plausible garbage | Validate → report → abort, zero rows parsed (rule 18) |
| An export taken mid-sync silently omits queued offline workouts | Client gate + advisory header (rule 11); the cron records `lastClientFlushAtMs` so the gap is visible rather than denied |
| A backup written into `PHOTOS` is reachable by a photo sweep | Backups live in the dedicated `BACKUPS` bucket (rule 53), which is what 01:95 created it for |
| "Deletion is irreversible" while 20 full backups survive in R2 | Rule 62's preview names surviving backups and bytes, with a `deleteExistingBackups` checkbox |
| Only a `.ndjson` exists, so the owner can never obtain the documented backup format from a phone | `GET /api/export/backup.json` produces canonical JSON in the Worker, bounded and refusing loudly (rule 3) |
| The CSV ZIP is advertised as re-importable and is not | Rule 5 + rule 16's `ours-csv-not-importable` outcome + the export card's three honest labels |
| An RU-default owner reads English import notes | `PlanNote.message` is never rendered; every code has an RU string (rules 31, 38) |
| The Data screen fails opaquely with no connection | Rule 65's explicit offline state |
| A corrupt backup discovered only during a real disaster | The step verifies its own output and throws on failure (rule 56); on-demand verify route (rule 57) |

## Verification

Unit tests are `vitest@5.0.0` (stack-facts.md). These cases must exist by name:

- `tests/unit/import/units.test.ts` — `lbToKg`: `88.18→40.00`, `220.46→100.00`, `225.97→102.50`,
  `45→20.41`, `0→0`; `miToM(1)=1609.344`; `parseStrongDuration`: `"1h 43m"→6180`, `"59m"→3540`,
  `"38min"→2280`, `"82"→82`, `"264h 1m"→{seconds:950460,suspicious:true}`, `""→null`, `"x"→null`.
- `tests/unit/import/tz.test.ts` — every vector below came from a probe Worker on workerd
  1.20260911.1 @ `compatibility_date 2026-09-01`, and each is asserted as a **literal ISO string**,
  never through 16's fixed-offset `almatyDay()`:
  `2026-09-12 19:56 → 2026-09-12T14:56:00Z` (+05:00);
  `2023-07-15 12:00 → 2023-07-15T06:00:00Z` (**+06:00**, r11 §8.2);
  `2024-02-28 12:00 → 2024-02-28T06:00:00Z` (+06:00, before the change);
  `2024-03-02 12:00 → 2024-03-02T07:00:00Z` (+05:00, after it);
  the **fold** — `classifyWallClock(2024-02-29 23:00)` is
  `{ kind: "ambiguous", candidates: [2024-02-29T17:00:00Z, 2024-02-29T18:00:00Z] }` and
  `wallClockToUtcMs` returns the **earlier**, `2024-02-29T17:00:00Z`;
  the **gap** branch against a DST zone, since Asia/Almaty has none —
  `classifyWallClock({…2026-03-29 02:30…}, "Europe/Berlin")` is
  `{ kind: "nonexistent", candidates: [2026-03-29T00:30:00Z, 2026-03-29T01:30:00Z] }` and the chosen
  instant is the **later**, `2026-03-29T01:30:00Z`, which is Berlin 03:30 (+02:00) — shifted forward
  by the one-hour gap;
  and `toLocalDay(wallClockToUtcMs(2026-09-12 23:30)) === "2026-09-12"`
  (`2026-09-12T18:30:00Z`, the local-00:00–05:00-adjacent case 02 rule 5 and 16 rule 16 both demand).
  Run with `TZ=UTC` and `fixedClock()` (16 `tests/harness/clock.ts`) so the test exercises the
  production condition — the dev machine sits at UTC+5, which hides this bug (r11 §8.2).
- `tests/unit/import/csv.test.ts` — BOM stripped so `row["Date"]` resolves; CRLF and LF; a field with
  a comma, an escaped `""` and a newline; `,,` distinguished from `,"",`; the malformed fixture makes
  `csvTokenizer` error with `{ kind: "malformed-quoting", line: 2 }`.
- `tests/unit/import/sniff.test.ts` — one case per row of rule 16's table, asserted on **header
  names** only (S1 versus S4 with identical column counts is one of them); plus `hevy-measurements`,
  a wide `mfp-measurement`, a nutrition file with a `Food` column and a Strong header containing a
  column literally named `lbs`, all returning `reason: "unverified-format"`; plus our own generated
  `sets` CSV header returning `reason: "ours-csv-not-importable"`.
- `tests/unit/import/strong.test.ts` — on the `Rest Timer` fixture: emitted set count equals the
  non-pseudo row count; `skipped` carries the exact `Rest Timer` and `Note` counts; `W`/`D`/`F` map
  to `warmup`/`drop`/`failure`; `rest_after_sec` lands on the **preceding** set; `rpe 6.5` survives;
  a blank `Weight Unit` on a loaded row is skipped and warned; `strong-supersets-lost` present.
- `tests/unit/import/hevy.test.ts` — two non-contiguous `Running` blocks in one workout yield **two**
  `workout_exercises` rows; `superset_id 0` in two different workouts does not merge; both date
  paddings parse; an emoji title survives; `normal → working`, `dropset → drop`.
- `tests/unit/import/mfp.test.ts` — N1/N2/N3 all parse; with `Time`, up to 7 rows per `(Date, Meal)`
  with distinct `ordinal`s; `Vitamin A` never stored as mg and never outside
  `importedMicrosPctDv`; `"""Walking, 3.5 mph, brisk pace"""` yields one unquoted name; `Strength`
  and `Cardio` rows counted as not-imported; `Post-Workout` lands in `label` verbatim with
  `slot === "snack"`.
- `tests/unit/import/match.test.ts` — each ladder step against the pinned fixture catalogue;
  determinism under a shuffled catalogue; bigram **sets** (a name with a repeated bigram scores
  identically to its deduplicated form, and a one-character name yields two padded bigrams); the
  equipment-disagreement penalty; `3/4 Sit-Up` (a verified free-exercise-db name, r07 §3) matched
  from `3/4 Situp`; `Hand Gripper` → `new`.
- `tests/unit/import/dedupe.test.ts` — keys stable across two parses of the same file; title
  case/whitespace differences give the same key; a different `startedAtMs` does not; `fillImportKey`
  differs for two sources on the same `local_day` and the same column.
- `tests/unit/export/canonical.test.ts` — table/row/key ordering; `102.5` not `102.50`; `NULL` vs
  `""`; emoji and Cyrillic preserved; idempotent under re-canonicalisation; and **two frame streams
  differing only in `exportedAt`/`appVersion`/`d1Migration`/`runKey`/`lastClientFlushAtMs` and in the
  footer canonicalise to identical strings**.
- `tests/unit/export/headers.test.ts` — generated headers === `golden-headers.txt` byte for byte;
  every local-day header cell reads `local_day` and none reads `local_date`.
- `tests/unit/export/params.test.ts` — for every generated multi-row insert, `rows × columns ≤ 90`;
  `sets` is 25 columns and chunks at 3 rows; `food_entries` is 24 and chunks at 3.
- `tests/unit/export/retention.test.ts` — 10 weeklies → 8 kept; monthly promotion picks the run with
  Almaty local day ≤ 7; nothing deleted while under the cap.

Cross-module numeric vectors are read from `tests/vectors/r09.json` (16-testing-ci-quality.md), which
mirrors `docs/research/r09-formulas-and-test-vectors.md` — never retyped here: RT-4's
recompute assertion uses **V1–V6** (§1 — `Epley(100,5)=116.6667`, `Brzycki(100,5)=112.5000`,
`r=1 ⇒ 100.0000`, `r=37 ⇒ throw/null`); the opt-in weight-normalisation action uses plate vectors
**P1–P4** (§6, incl. `101.9 → 102.0` nearest vs `101.0` greedy); the `derivedColumns` assertions use
`TREND_ALPHA = 0.1` and `ENERGY_DENSITY_KCAL_PER_KG = 7700` (§9) with rule 50's per-type tolerances.

Resource names below are 01's, not the Phase-0 scaffold's: the D1 `database_name` is **`fitness-db`**
(01:82) and the buckets are **`fitness-photos`** and **`fitness-backups`** (01:93, 01:95).
`wrangler d1 execute` accepts "the name or binding of the DB", so the **binding `DB`** is used where
that makes a command survive a rename. Every `wrangler` invocation was checked against
`npx wrangler d1 --help` / `npx wrangler r2 --help` at **4.131.1**: `wrangler r2 object get` takes a
single positional `<bucket>/<key>` and has **no** `--key` flag, and **`wrangler r2 bucket object
list` does not exist** — 4.131.1 ships no object-listing command at all (`wrangler r2 object` has
only `get`, `put`, `delete`), so every listing assertion goes through this spec's own authenticated
`GET /api/backups`.

```bash
# $SESSION — the authenticated cookie header. 16's tests/e2e/global-setup.ts writes storageState.json
# on the first `npx playwright test`; derive the header from it once:
SESSION=$(node -p 'JSON.parse(require("node:fs").readFileSync("storageState.json","utf8")).cookies.map(c=>c.name+"="+c.value).join("; ")')

# 0. Static gates
npx tsc --noEmit && npx eslint . --max-warnings 0 && npx vitest run tests/unit
# PASS: exit 0 on all three.
! grep -rqE 'db\.transaction\(|from "fflate"|runtime = "edge"' src/
# PASS: exit 0. `!` inverts `grep -q`, so a MATCH fails the gate — a bare `grep` would exit 1 on
# success and break the `&&` chain. Unscoped "fflate" pulls the worker_threads build (rule 6).
! grep -rqE 'crypto\.subtle\.digest|local_date|localDate|toLocalDate' src/lib/export src/lib/import src/server/backup src/server/export
# PASS: exit 0. subtle.digest is one-shot (Interfaces); the column is local_day (02 rule 5, 02:8).

# 1. Golden shape — fails CI on accidental export-format drift
npx vitest run tests/unit/export/headers.test.ts
# PASS: generated headers === tests/fixtures/export/golden-headers.txt, byte for byte.

# 2. RT-1, RT-2, RT-4, RT-5, RT-6 on 16's node:sqlite D1 shim + makeFakeR2()
npx vitest run tests/integration/roundtrip.test.ts
# PASS: RT-1 asserted as a string equality; RT-2, RT-4, RT-5 and RT-6 each asserted individually.
# RT-3 is deliberately NOT here: 16 rule 6(d) puts real bindings, R2 and KV in the Playwright /
# preview lane, so RT-3 and rule 56's verify run in step 7.
# The fixture MUST contain: a 3-exercise superset; the same exercise twice in one workout; a
# warmup, a drop and a failure set; rpe = 6.5; a bodyweight set with weight_kg NULL; an assisted
# set with assist_kg; a duration-only cardio set; an emoji title; a Cyrillic note; a note with a
# comma, a double quote and a newline; one soft-deleted set; one progress photo and one food photo
# with real R2 keys; a NULL vs "" pair; ONE WORKOUT WITH A NON-NULL import_batch_id AND import_key
# (rule 47); one body_measurements row with an import_fills before-image; and one workout that has
# been `replace`d TWICE (rule 41).

# 3. The copy-pasteable round-trip proof — the Phase 9 DoD
node scripts/build-canon.mjs                      # esbuild → dist-scripts/canonical.mjs
npx wrangler d1 execute DB --local --file scripts/wipe-d1.sql
npx wrangler d1 execute DB --local --file tests/fixtures/seed.sql     # 16 owns it; load it FIRST,
npx wrangler d1 execute DB --local --file tests/fixtures/export/hard-cases.sql   # or hard-cases has
                                                  # dangling FKs to seed-owned `exercises`
npm run preview &                    # opennextjs-cloudflare build && opennextjs-cloudflare preview
curl -sf --cookie "$SESSION" localhost:8787/api/export/json > /tmp/a.ndjson
node scripts/canon.mjs /tmp/a.ndjson                        > /tmp/a.canon.json
npx wrangler d1 execute DB --local --file scripts/wipe-d1.sql
# Restore is analyze → apply, exactly like every other source (rule 46). No ?mode= exists.
BATCH=$(curl -sf --cookie "$SESSION" -F file=@/tmp/a.ndjson localhost:8787/api/import/analyze \
        | node -p 'JSON.parse(require("node:fs").readFileSync(0,"utf8")).batchId')
curl -sf --cookie "$SESSION" -X POST localhost:8787/api/import/apply \
     -H 'content-type: application/json' -d "{\"batchId\":\"$BATCH\",\"confirmations\":{}}"
curl -sf --cookie "$SESSION" localhost:8787/api/export/json > /tmp/b.ndjson
node scripts/canon.mjs /tmp/b.ndjson                        > /tmp/b.canon.json
cmp /tmp/a.canon.json /tmp/b.canon.json
# PASS: cmp prints nothing and exits 0. ANY output is an RT-1 FAILURE.
cmp /tmp/a.canon.json tests/fixtures/export/golden-backup.canon.json
# PASS: the golden file is produced by the same canonicalise(), so the two cannot disagree.

# 3b. The body really streams (rule 2's verified claim, re-asserted empirically)
curl -sN --cookie "$SESSION" -o /dev/null \
  -w 'first_byte=%{time_starttransfer}s total=%{time_total}s\n' localhost:8787/api/export/json
# PASS: on the hard-cases corpus first_byte is a small fraction of total. If they are equal the
# response was buffered and rules 1-6 must be rewritten around a cron-written R2 object.

# 4. Idempotency — rule 40's index is applied-only, so the file must actually be APPLIED
analyze() { curl -s -o /tmp/plan.json -w '%{http_code}\n' --cookie "$SESSION" \
  -F file=@tests/fixtures/import/strong-s3-resttimer.csv localhost:8787/api/import/analyze; }
analyze; B1=$(node -p 'JSON.parse(require("node:fs").readFileSync("/tmp/plan.json","utf8")).batchId')
# PASS: 200; creates > 0; duplicateOfBatchId === null.
curl -sf --cookie "$SESSION" -X POST localhost:8787/api/import/apply \
  -H 'content-type: application/json' -d "{\"batchId\":\"$B1\",\"confirmations\":{\"exercises\":{}}}"
analyze
# PASS: 200 (NOT 409). Body carries duplicateOfBatchId === "$B1" and the earlier report's plan,
#       every `creates` zero, duplicates > 0 — rule 40's APPLIED branch, the one the partial index
#       actually covers.
curl -s -o /tmp/re.json -w '%{http_code}\n' --cookie "$SESSION" -X POST \
  localhost:8787/api/import/apply -H 'content-type: application/json' \
  -d "{\"batchId\":\"$B1\",\"confirmations\":{\"exercises\":{}}}"
# PASS: 409, error.code === "conflict", error.details.reason === "already-applied".

# 5. The backup step body, both weekdays, with no dependence on today's date
npx vitest run tests/integration/backup-step.test.ts
# PASS: called with scheduledTime = 2026-09-13T18:00:00Z (Almaty Sunday) the step writes exactly
#       .ndjson.gz + .manifest.json + .verify.json under backups/weekly/2026/09/ in makeFakeR2(),
#       verify.ok === true, and no .resume.json survives. Called with 2026-09-14T18:00:00Z it does
#       the SAME thing — 14 owns the Sunday gate, not this body (rule 52), so the step is asserted
#       date-independent here and the gate is asserted in 14's own jobs-gate test.

# 6. The cron wiring, end to end (crons never fire on a schedule locally, r01 §4.12)
npx opennextjs-cloudflare preview --test-scheduled --port 8961 &
curl -s "http://127.0.0.1:8961/__scheduled?cron=0+18+*+*+*"      # PASS: "Ran scheduled event"
npx wrangler d1 execute DB --local \
  --command "select job, ok, error from cron_runs order by started_at desc limit 1"
# PASS: one row, job='backup-to-r2', ok=1, error IS NULL — on ANY weekday. Whether the `backup`
# STEP ran is 14's gate and is asserted there; this step makes no claim about it.
# The manual backup is the ungated path this spec owns, so it is runnable any day of the week:
curl -sf --cookie "$SESSION" -X POST localhost:8787/api/backups > /tmp/manual.json
curl -sf --cookie "$SESSION" localhost:8787/api/backups > /tmp/ledger.json
# PASS: the newest entry has kind="manual", verified === true, danglingKeys === 0, and non-null
#       manifestKey and verifyKey. (There is no `wrangler r2 bucket object list` at 4.131.1.)
KEY=$(node scripts/latest-backup-key.mjs)        # newest backups/**.manifest.json, via GET /api/backups
npx wrangler r2 object get "fitness-backups/$KEY" --local --file /tmp/m.json
node -e 'const m=require("/tmp/m.json"); process.exit(m.schemaVersion===1 &&
  m.format==="fitness-app-tair/backup" && m.timezone==="Asia/Almaty" &&
  m.r2.binding==="BACKUPS" ? 0 : 1)'
# PASS: exit 0.

# 7. RT-3 and the verify path against REAL R2 (16 rule 6d: real bindings live in this lane)
npx playwright test tests/e2e/data-portability.spec.ts
# PASS: RT-3 — after a wipe-and-restore every r2_key / thumb_key / orig_key / output_r2_key is ===
#       the backup string, head() resolves each manifest object with a matching size, a deliberately
#       deleted object makes the restore fail CLOSED, and a row whose r2_purged_at is set downgrades
#       to a warning; verifyBackup() on a byte-flipped object returns ok:false with
#       bodySha256Match:false; plus: import a Strong fixture; see the plan counts and the RU note
#       "Пропущено строк «Rest Timer»: 748"; resolve 2 unmatched names; apply; roll the batch back to
#       zero rows; and roll back a batch that created two custom exercises, asserting `exercises`
#       AND `exercise_aliases` both return to zero.

# 8. Full deletion, including R2
curl -sf --cookie "$SESSION" localhost:8787/api/data/purge > /tmp/preview.json   # rule 62's preview
# PASS: d1Rows, photoObjects, backupObjects and backupBytes are all non-zero before the purge.
curl -sf --cookie "$SESSION" -X POST localhost:8787/api/data/purge \
  -H 'content-type: application/json' \
  -d '{"phrase":"УДАЛИТЬ ВСЁ","keepFinalExport":true,"deleteExistingBackups":false}' > /tmp/final.json
npx wrangler d1 execute DB --local --command "select count(*) n from sets"
# PASS: n = 0 (a HARD delete — not a soft delete with deleted_at set).
npx wrangler r2 object get "fitness-photos/$ONE_PHOTO_KEY" --local --file /tmp/p
# PASS: the command FAILS — the object is gone. ($ONE_PHOTO_KEY is any photos/** key read from
#       /tmp/preview.json's sibling listing before the purge.)
npx wrangler r2 object get \
  "fitness-backups/$(node -p 'JSON.parse(require("node:fs").readFileSync("/tmp/final.json","utf8")).finalExportKey')" \
  --local --file /tmp/final.ndjson.gz
# PASS: exit 0 — keepFinalExport kept it, and deleteExistingBackups:false kept the historical
#       weeklies too, which is exactly what rule 62's confirmation has to say out loud.
```

## Open questions

1. **Does the round-trip proof run against production data, ever?** The DoD (rule 51) runs it on
   local D1 with a fixture. (a) Fixture only — fast, deterministic, CI-safe, but it never proves the
   real corpus restores. (b) Add a quarterly manual drill: download the latest production backup,
   restore it into local D1, and diff the canonical export against the downloaded file.
   **Recommend (b)**, as a checklist item in the quarterly archive run — the fixture proves the code
   and the drill proves the data, and only the drill would catch a row the schema permits but the
   exporter mis-serialises. *(The bucket, key layout and compression are no longer open. 01:95/260/525
   already decided the dedicated `BACKUPS` bucket and the `backups/{weekly|monthly|manual|archive}/…`
   layout; 14:385 already decided the local-day key and its `put`-overwrite retry idempotency; rule 53
   adopts both verbatim and `CompressionStream`/`DecompressionStream` are now verified on workerd.
   Two sibling strings must be amended to match, and both are one-line edits in their own specs:
   02:513's `backups/{yyyy}/{mm}/backup-<ISO>.ndjson` and 14:523's "`PHOTOS`, which 01 already
   designates for cron backups" — 01 designates `BACKUPS`.)*
2. **Should `ApiErrorCode` grow, or stay at eight?** Rule 63 maps every condition in this module into
   01:337's closed enum, so nothing is blocked and no cross-spec amendment is pending. But an
   oversized upload is genuinely `413`, an unrecognised CSV dialect is genuinely `415`, and an
   unprocessable plan is genuinely `422`, and all three are currently `400` with a `details.reason`.
   (a) Keep eight codes; clients switch on `details.reason`. (b) Widen `ApiErrorCode` and
   `httpStatusFor` **in 01** with `payload_too_large` / `unsupported_media_type` / `unprocessable`.
   **Recommend (a)** — one closed enum shared by every route, every client and `http-envelope.test.ts`
   is worth more than three RFC-accurate statuses, and `details.reason` is already the discriminator
   the UI needs. 01 owns the decision either way.
3. **The matching and budget constants are chosen, not calibrated.** `AUTO_THRESHOLD = 0.80`,
   `CONFIRM_THRESHOLD = 0.50`, `EQUIPMENT_DISAGREE_FACTOR = 0.6`, `EQUIPMENT_AGREE_BONUS = 0.08`,
   `ANALYZE_MAX_BYTES = 25 MB`, `PLAN_SAMPLE_CAP = 200` and `CANON_MAX_ROWS = 200_000` are all
   **UNVERIFIED-tunable**: no source in r07 or r10 derives any of them, and none is pinned by a test
   — the tests pin behaviour against the fixture catalogue instead (rule 36). (a) Ship these values
   and tune from the first real import. (b) Calibrate the four matching constants now against the
   full 876-record free-exercise-db catalogue (r07 §4) by running every pinned Hevy/Strong/MFP vendor
   name through the ladder at several threshold pairs and recording, in a research note, how many land
   auto / confirm / new at each. **Recommend (b) before the importer ships to the owner**: 40
   confirmation taps versus 4 is the difference between the feature being used and abandoned, and the
   measurement is a one-afternoon script over data we already have.
