# 10 — Body measurements, trend weight and progress photos

## Purpose

Owns everything the user records *about their body*: weigh-ins, tape measurements, US Navy body fat,
and progress photos with capture, compare and privacy. Satisfies brief module 4 ("BODY & PHOTOS")
and Phase 4's DoD ("compare + trend render"). Sole writer of `body_measurements` and `photos`, sole
owner of the photo upload/serve/sign routes and of `sweepDeletedPhotoObjects()` — the single R2
sweeper, which **[`14-ai-coach-and-notifications.md`](./14-ai-coach-and-notifications.md) must run as
a new `photo-gc` step inside its existing `backup-to-r2` cron** (amendment 14.1 below; this spec
previously mis-cited spec 15 rule 58, which is about `import_staging`, not photos).

Two brief clauses are deliberately **superseded**, both on r03 evidence:

- **"R2 presigned upload"** — [r03 §1](../docs/research/r03-r2-uploads-and-image-delivery.md) proves
  an R2 *binding* cannot presign (`grep -i presign` over `@cloudflare/workers-types` returns zero
  matches; presigning needs S3 API credentials) and r03 §2 disqualifies it for an offline-first app.
  We upload through an authenticated Route Handler.
- **"responsive AVIF images via R2/Images"** — r03 G11: AVIF *input* is Enterprise-only, so an AVIF
  object we store could never be re-transformed; combined with G10 (iOS silently answers a WebP
  request with PNG) AVIF is a dead end on both ends. We ship feature-detected WebP with a JPEG
  fallback and fixed variant sizes instead of a responsive transform pipeline.

The brief's per-route JS budget is **not** superseded: `/body` is capped at **135 KB gzipped**, owned
and enforced by [`16-testing-ci-quality.md`](./16-testing-ci-quality.md) rule 21. Recharts and the
full-screen viewer are therefore dynamic imports on this route, never static.

## Scope

Weigh-in flow (one tap from the dashboard, remembers the last value, offline-safe); the canonical
measurement set with L/R as separate columns, kg/cm, hard ranges plus soft typo heuristics; trend
weight presentation (EMA line over raw dots, dashboard shows **trend**, weekly rate with a
confidence level, copy rules); Navy body-fat input gating and band presentation; progress-photo
capture (pose presets, ghost overlay, client downscale, metadata handling), the upload and read
routes, offline queueing and the flush transport for photo bytes, timeline, compare, date-range
filter; photo privacy (authenticated reads, short-lived signed share URLs, cache purge on delete, the
R2 sweep that actually removes the objects); and the photo guarantees the exporter relies on.

`settings.unit_system` is a **display intent** column (02 L167) and **does not affect this module in
v1**: every input, readout, axis and tooltip here is kg/cm. `LB_PER_KG` exists solely as the unit-slip
typo heuristic (rule 7), never as a display conversion. Honouring `unit_system` in the weigh-in sheet
and the rate badge is deferred, and named as such in Open questions.

### Out of scope

| Excluded | Owner |
|---|---|
| `trendWeight`, `navyBodyFatPct`, `navyBodyFatPctDetailed`, `leanMassKg`, `localDateFromInstant` + their r09 vectors | `07-calculators.md` |
| Canonical DDL, enums (`POSES`, `PHOTO_KIND`, `SEX`), `src/lib/ids.ts` ULIDs, `toLocalDay`, migrations | `02-data-model.md` |
| `requireSessionOr401()`, cookies, re-auth, secret storage | `04-auth.md` |
| Dexie schema (the one generic `mirror` store), `outbox`/`blobs` stores, the flush loop, quota/eviction, `r2-photos` runtime cache | `05-pwa-offline-sync.md` |
| Sheet/chart/button primitives, tokens, haptics helper, **`src/components/app/photo-compare.tsx`** (03 L71) | `03-design-system.md` |
| Dashboard composition and `dash:v1:<local_day>` caching, body-composition analytics | `12-analytics-dashboard.md` |
| Adaptive TDEE (reads `trend_kg`), food photos and the `photos/food/…/ai.jpg` object (rule 64) | `11-nutrition-ai.md` |
| Cron registration and schedules, weekly report delivery | `14-ai-coach-and-notifications.md` |
| Export/import formats, manifest assembly, quarterly photo archive, full purge | `15-data-portability.md` |
| `wrangler.jsonc` bindings (`PHOTOS`, `DB`), env/secret inventory, runtime rules, logging policy | `01-architecture.md` |
| Per-route JS budgets (`/body` = 135 KB gz) | `16-testing-ci-quality.md` |

## Files to create

| Path | Responsibility |
|---|---|
| `src/app/(app)/body/page.tsx` | Body hub shell: trend card, rate, BF band, measurement history, photo strip. |
| `src/app/(app)/body/measurements/page.tsx` | Tape-measurement form shell (page, not sheet — 13 inputs). |
| `src/app/(app)/body/photos/page.tsx` | Timeline shell: month-grouped thumb grid, pose filter. |
| `src/app/(app)/body/photos/{capture,compare}/page.tsx` | Full-bleed capture shell; compare shell (slider + overlay modes). |
| `src/app/api/body/series/route.ts` | `GET` trend series (stored columns) + latest values + BF + rate for a date range. |
| `src/app/api/body/measurements/route.ts` | `POST` weigh-in or tape row; `PATCH` one row; recompute trend + BF. |
| `src/app/api/body/measurements/[id]/route.ts` | `DELETE` soft-delete one row + forward trend recompute. |
| `src/app/api/body/measurements/recompute-bodyfat/route.ts` | `POST` re-derive `body_fat_pct` over a date range after a height edit (rule 18). |
| `src/app/api/photos/route.ts` | `GET` photo metadata list; `POST` create (`display` bytes + D1 row). |
| `src/app/api/photos/[id]/route.ts` | `GET` **metadata JSON** for one photo; `DELETE` soft-delete + cache purge. |
| `src/app/api/photos/[id]/[variant]/route.ts` | `GET` variant bytes (session only); `PUT` attach `thumb`/`orig`. |
| `src/app/api/photos/[id]/sign/route.ts` | `POST` mint a 120 s HMAC-signed share URL. |
| `src/app/api/photo-share/[id]/[variant]/route.ts` | `GET` a signed variant — **outside** `/api/photos/`, so 05's `r2-photos` matcher never caches it (rule 60). |
| `src/lib/body/fields.ts` | Canonical field registry: key, column, ranges, `softDeltaCm`, sex gating, site hint. |
| `src/lib/body/validation.ts` | Zod payloads; hard ranges; jump / unit-slip / asymmetry warnings. |
| `src/lib/body/rate.ts` | Weekly rate of change + confidence classification (pure, over stored trend values). |
| `src/lib/body/bodyfat-band.ts` | Gates inputs, wraps `navyBodyFatPctDetailed` into a ±SEE band. |
| `src/lib/body/local-model.ts` | Offline read model: `mirror` rows (`table:'body_measurements'` / `'photos'`) → the same view shapes the API returns (rule 27, rule 50). |
| `src/lib/photos/prepare.ts` | Client downscale/encode (orientation applied, metadata dropped). |
| `src/lib/photos/keys.ts` | Build/parse `photos/{kind}/{yyyy}/{mm}/{ULID}/{variant}.{ext}`. |
| `src/lib/photos/enqueue.ts` | Composes prepared variants into spec 05 `blobs` rows + `photo.upload` ops. |
| `src/lib/photos/dispatch.ts` | The `photo.upload` / `photo.delete` HTTP transport spec 05's flusher calls (rule 48). |
| `src/lib/photos/cache.ts` | `purgeCachedPhoto(id)` / `purgeR2PhotoCache()` over `caches.open('r2-photos')`. |
| `src/lib/photos/sniff.ts` | Magic-byte type sniff + `hasEmbeddedMetadata()` reject guard (server). |
| `src/lib/photos/signed-url.ts` | HMAC-SHA256 mint/verify over `id\|variant\|exp`; key is injected, never read from `env` here. |
| `src/server/body/queries.ts` | D1 reads: row series, latest values, photo lists, compare pairs. |
| `src/server/body/mutations.ts` | D1 writes via `db.batch()`; trend backfill; BF recompute. |
| `src/server/body/trend-series.ts` | **Server-only** adapter: per-day averaging + sort → `trendWeight()` → rows to persist (rule 9). |
| `src/server/photos/store.ts` | `env.PHOTOS` put/get/delete with `httpMetadata` + `customMetadata`. |
| `src/server/photos/manifest.ts` | `listPhotoObjectsForManifest()` + `PhotoManifestObject` — consumed verbatim by spec 15 rule 8. |
| `src/server/photos/gc.ts` | `sweepDeletedPhotoObjects()` — purge + orphan reconciliation (rules 63–65). |
| `src/components/body/WeighInSheet.tsx` | Bottom sheet: big stepper, prefilled, one confirm button. |
| `src/components/body/TrendChart.tsx` | Recharts (dynamic import): raw dots + EMA line + hollow excluded dots. |
| `src/components/body/RateBadge.tsx` | `−0.42 kg/wk` + confidence chip + tooltip copy. |
| `src/components/body/BodyFatCard.tsx` | Band, ±SEE ribbon, missing-input CTA list, method disclosure. |
| `src/components/body/MeasurementForm.tsx` | Registry → inputs, L/R pairing, inline soft warnings. |
| `src/components/body/DateRangePicker.tsx` | Shared range state for chart, timeline and compare. |
| `src/components/photos/CaptureScreen.tsx` | Pose chooser, camera/file branch, shutter, post-capture review + note. |
| `src/components/photos/GhostOverlay.tsx` | Previous same-pose photo at adjustable opacity + guides. |
| `src/components/photos/PhotoTimeline.tsx` | Thumb grid, pending-upload badges, long-press menu. |
| `src/components/photos/PhotoViewer.tsx` | Full-screen `display` viewer (dynamic import), same-pose swipe. |
| `tests/unit/body-{validation,rate,trend-contract}.test.ts` | Ranges/warnings; rate tiers; r09 vectors through this module. |
| `tests/unit/photos-{keys,sniff,signed-url,prepare}.test.ts` | Key round-trip; magic bytes + metadata; HMAC; downscale math. |
| `tests/e2e/body-photos.spec.ts` | Weigh-in → trend; capture → upload → compare; delete → sweep. |

Reused, not created: `src/lib/ids.ts` (`ulid()`), `src/lib/calc` (spec 07), `src/lib/sync/*` and
`src/db/local.ts` (spec 05), `src/db/local-day.ts` (`toLocalDay`, spec 02),
`src/server/require-session.ts` (spec 04), `src/components/app/photo-compare.tsx` (spec 03 — rules 53–54
specify its props and behaviour; this module does **not** create a second copy). Edited:
`src/i18n/messages/{ru,en}.json` (`body.*`, `photos.*`).

## Interfaces

**One naming rule, stated once.** Every D1 column and every Dexie `mirror` row field is
**`local_day`** — 02 rule 5 fixes the convention (`column name ends _day/_on`, written by
`toLocalDay()` at write time, CHECKed with a `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`).
The TypeScript field on the *view* types below is **`localDate`**, because that is spec 07's
`TrendPoint`/`WeightReading` field name and a re-spelling at the calc boundary would be worse. The
mapping is exactly `row.local_day ⇄ view.localDate`, applied in `src/server/body/queries.ts` and
`src/lib/body/local-model.ts` and nowhere else. No wire format, index or SQL string in this spec says
`local_date`.

```ts
// src/lib/body/fields.ts — the canonical set. L/R are separate columns, never averaged at rest.
export type MeasurementKey =
  | 'neckCm' | 'shoulderCm' | 'chestCm' | 'waistCm' | 'hipsCm'
  | 'bicepsLCm' | 'bicepsRCm' | 'forearmLCm' | 'forearmRCm'
  | 'thighLCm' | 'thighRCm' | 'calfLCm' | 'calfRCm';

export interface MeasurementField {
  key: MeasurementKey;
  column: string;                 // snake_case D1 column, e.g. 'biceps_l_cm'
  unit: 'cm';
  min: number; max: number;       // HARD range in cm; outside ⇒ reject (our convention, UNVERIFIED)
  softDeltaCm: number;            // |value − previous| above this ⇒ confirm, never block (rule 15)
  step: 0.5;                      // stepper increment; free text accepts 0.1
  pairKey?: MeasurementKey;       // contralateral field
  navy?: 'male' | 'female' | 'both';
  siteHintKey: string;            // i18n key; sex-dependent for waistCm (r09 §3)
}
export const MEASUREMENT_FIELDS: readonly MeasurementField[];
export const NAVY_REQUIRED: { male: MeasurementKey[]; female: MeasurementKey[] };
/** Asymmetry threshold, per pair. Our convention, UNVERIFIED as published. */
export const ASYMMETRY_SOFT_CM = 3;

// src/lib/body/validation.ts   (payload shapes for spec 05's bodyMeasurement.* OP_SCHEMAS)
/** Our convention, UNVERIFIED as published: a plausibility fence, not a clinical range. */
export const WEIGH_IN_HARD_KG = { min: 25, max: 300 } as const;        // kg
/** First-entry plausibility ceiling: above this, offer the lb reading (rule 7). Our convention. */
export const FIRST_ENTRY_SUSPECT_KG = 150;
export const LB_PER_KG = 2.2046226218;                                 // typo heuristic only, never display
export const measurementCreate: z.ZodType<{
  id: string;                     // ULID from src/lib/ids.ts, minted on the client
  localDate: string;              // 'YYYY-MM-DD' Asia/Almaty → the local_day column
  measuredAtMs: number;           // epoch ms (device clock; server clamps per 05 rule 24)
  weightKg: number | null;        // kg, 1 dp
  /** cm. Absent key ⇒ leave the column alone. Explicit `null` ⇒ clear it (rule 17). */
  values: Partial<Record<MeasurementKey, number | null>>;
  notes: string | null;
}>;
export const measurementPatch: z.ZodType<
  Partial<Omit<z.infer<typeof measurementCreate>, 'id'>> & { id: string; baseRev: number }>;

export type SoftWarning =
  | { kind: 'jump'; field: MeasurementKey | 'weightKg'; delta: number; previous: number }
  | { kind: 'unitSlip'; field: 'weightKg'; entered: number; asKg: number }
  | { kind: 'firstEntrySuspect'; field: 'weightKg'; entered: number; asKg: number }
  | { kind: 'asymmetry'; left: MeasurementKey; right: MeasurementKey; deltaCm: number };
/** Pure. Hard-range failures are Zod issues; these never block a save. `[]` is a valid result.
 *  `reference` is the trend when there is one, else the previous raw reading, else null (rule 7). */
export function softWarningsForWeighIn(
  kg: number, reference: { kind: 'trend' | 'previousReading'; kg: number } | null): SoftWarning[];
export function softWarningsForMeasurements(
  next: Partial<Record<MeasurementKey, number | null>>,
  previous: Partial<Record<MeasurementKey, number>> | null): SoftWarning[];

// src/server/body/trend-series.ts — SERVER ONLY (rule 9). An ESLint no-restricted-import boundary
// forbids importing this from src/components/** or src/app/(app)/**; Verification greps for it.
export interface MeasurementRow {
  id: string; localDate: string; measuredAtMs: number;
  weightKg: number | null; trendKg: number | null; trendExcluded: boolean;
}
export interface DayTrend {
  localDate: string; avgKg: number; trendKg: number; excluded: boolean;
  readingCount: number; carrierRowId: string;      // the MAX(measuredAt) row that stores trendKg
}
/** Runs over FULL history (never a window). Averages same-localDate readings, sorts, calls
 *  trendWeight(). null only when calc rejects the input — callers surface it, never zero-fill. */
export function buildDayTrends(rows: readonly MeasurementRow[]): DayTrend[] | null;

// src/lib/body/local-model.ts + the GET /api/body/series response — both produce these shapes.
// trendKg/excluded are READ from the stored column, never recomputed client-side (12 rule 20).
export interface SeriesReading { id: string; measuredAtMs: number; kg: number; excluded: boolean }
export interface SeriesPoint {
  localDate: string;              // = local_day
  kg: number;                     // the day's average of readings
  trendKg: number;                // stored
  excluded: boolean;              // stored
  readingCount: number;
  readings: SeriesReading[];      // the raw dots (rule 20) and the "last weigh-in" source (rule 22)
}
export interface LatestMeasurement {
  rowId: string; localDate: string; measuredAtMs: number;
  weightKg: number | null; trendKg: number | null;
  values: Partial<Record<MeasurementKey, number>>;
  bodyFatPct: number | null; bodyFatMethod: string | null;
  notes: string | null;
}
export type Freshness = { asOfLocalDate: string | null; stale: boolean };   // stale ⇔ offline tail

// src/lib/body/rate.ts — reads stored trend values only; never re-seeds an EMA.
export type RateConfidence = 'none' | 'low' | 'medium' | 'high';
export interface WeeklyRate {
  kgPerWeek: number | null;               // kg/week; null iff confidence === 'none'
  pctBodyweightPerWeek: number | null;
  confidence: RateConfidence; readingsInWindow: number; spanDays: number; windowDays: 14;
  /** What the UI must say when confidence === 'none' (rule 21/24 share one string). */
  emptyReason: null | { kind: 'needReadings'; missing: number } | { kind: 'needSpan'; minDays: 7 };
}
export function weeklyRateOfChange(s: readonly SeriesPoint[], todayLocalDate: string): WeeklyRate;

// src/lib/body/bodyfat-band.ts
export interface BodyFatBand {
  pct: number;                   // percentage points, 1 dp for display
  seePp: number;                 // 3.5 male | 3.7 female (r09 §3) — RIBBON GEOMETRY ONLY
  lowPp: number; highPp: number; // pct ∓ seePp, clamped to [2, 60]; never rendered as text (rule 31)
  method: 'us-navy-metric';      // persisted verbatim in body_measurements.body_fat_method
}
export type BodyFatResult =
  | { ok: true; band: BodyFatBand }
  | { ok: false; missing: MeasurementKey[]; needsHeight: boolean; needsSex: boolean }
  | { ok: false; implausible: true };                  // from navyBodyFatPctDetailed (amendment 07.1)
/** heightCm comes from users.height_cm, which is INTEGER — whole centimetres only. */
export function bodyFatBand(sex: 'male' | 'female' | null, heightCm: number | null,
  values: Partial<Record<MeasurementKey, number>>): BodyFatResult;

// src/lib/photos/{keys,prepare,sniff,signed-url,enqueue,dispatch,cache}.ts
export type PhotoKind = 'progress' | 'food';                   // = PHOTO_KIND (spec 02)
export type Pose = 'front' | 'side' | 'back';                   // = POSES (spec 02)
/** 'ai' is spec 11's vision input (11 rule 9). It is a real key shape so parsePhotoKey must accept
 *  it, but it is NOT client-prepared, NOT in VARIANT_SPEC, NOT a photos column, and is owned by
 *  ai_prompt_logs.input_ref for retention and export (rule 64, rule 66). */
export type PhotoVariant = 'display' | 'thumb' | 'orig' | 'ai';
export type UploadableVariant = Exclude<PhotoVariant, 'ai'>;
export const VARIANT_SPEC: Record<UploadableVariant, { maxEdgePx: number; quality: number }>;
// display 1600/0.82 · thumb 320/0.70 · orig 2560/0.88 — all three re-encoded (r03 §4(d))
export function photoKey(a: { kind: PhotoKind; id: string; localDate: string;
  variant: PhotoVariant; ext: 'jpg' | 'webp' }): string;   // yyyy/mm SPLIT FROM localDate (rule 45)
export function parsePhotoKey(key: string):
  | { kind: PhotoKind; yyyy: string; mm: string; id: string; variant: PhotoVariant } | null;

export interface PreparedVariant {
  variant: UploadableVariant; blob: Blob; contentType: 'image/jpeg' | 'image/webp';
  widthPx: number; heightPx: number; bytes: number; sha256Hex: string;
}
/** Applies EXIF orientation then re-encodes from a bitmap — which drops ALL metadata (r03 G4).
 *  Re-encodes as JPEG whenever blob.type !== the requested type, so PNG never reaches the wire. */
export function prepareVariants(f: File, v: readonly UploadableVariant[]): Promise<PreparedVariant[]>;
export function detectLossyType(): Promise<'image/webp' | 'image/jpeg'>;          // r03 G10
export function sniffImageType(b: Uint8Array): 'image/jpeg' | 'image/webp' | 'image/png' | null;
/** True when the bytes carry any embedded metadata container for their declared type (rule 42):
 *  JPEG  — APP1 `Exif\0\0`, APP1 XMP `http://ns.adobe.com/xap/1.0/\0`, or APP13 Photoshop/IPTC, before SOS
 *  WebP  — a RIFF chunk with FourCC `EXIF` or `XMP ` (trailing 0x20) — verified against the WebP
 *          container spec: 12-byte `RIFF`+LE32 size+`WEBP` header, then fourcc + LE32 size + payload
 *          + one 0x00 pad byte when the size is odd
 *  PNG   — an `eXIf`, `tEXt`, `zTXt` or `iTXt` chunk (PNG Extensions 1.5.0 / W3C PNG 3rd ed.) */
export function hasEmbeddedMetadata(b: Uint8Array,
  declaredType: 'image/jpeg' | 'image/webp' | 'image/png'): boolean;

export const SIGNED_URL_TTL_MS = 120_000;
/** Key material is INJECTED (the route reads env.PHOTO_URL_SIGNING_KEY and passes it); this module
 *  never calls getCloudflareContext(), so the unit test injects a fixed key and workerd never sees a
 *  top-level importKey. */
export function mintSignedPhotoUrl(a: { key: ArrayBuffer | CryptoKey; origin: string;
  id: string; variant: PhotoVariant; nowMs: number }): Promise<{ url: string; expiresAtMs: number }>;
export function verifySignedPhotoUrl(a: { key: ArrayBuffer | CryptoKey; id: string;
  variant: PhotoVariant; expSec: number; sig: string; nowMs: number }): Promise<boolean>;  // constant-time

/** One BlobRow + one photo.upload op per uploadable variant, all with entityId = photoId so a retry
 *  is idempotent. Preferred order display → thumb → orig; arrival order is NOT required (rule 45). */
export function enqueuePhoto(meta: { id: string; kind: PhotoKind; pose: Pose | null;
  takenAtMs: number; notes: string | null }, variants: readonly PreparedVariant[],
): Promise<{ queued: true } | { queued: false; reason: 'quota' }>;

/** THE TRANSPORT (rule 48). Spec 05's flusher calls this for photo.* ops instead of putting them in
 *  the /api/sync/batch JSON envelope — an 8 MiB Blob cannot travel that path. */
export type PhotoOpOutcome = 'applied' | 'skipped' | 'conflict' | 'rejected' | 'auth' | 'transient';
export function dispatchPhotoOp(op: OutboxOp, blob: Blob | null): Promise<{
  outcome: PhotoOpOutcome; status: number | null; reason?: string }>;

export function purgeCachedPhoto(id: string): Promise<void>;   // the three byte URLs (rule 59)
export function purgeR2PhotoCache(): Promise<void>;            // whole cache; called by 04's logout()

// src/server/photos/manifest.ts — consumed verbatim by 15 rule 8.
export interface PhotoManifestObject { key: string; bytes: number; sha256: string | null;
  contentType: string }
export function listPhotoObjectsForManifest(): Promise<PhotoManifestObject[]>;

// src/server/photos/gc.ts — the single sweeper (rules 63–65).
export interface SweepResult {
  purgedRows: number; purgedObjects: number;
  reconciledPrefixes: number; orphanObjects: number; truncated: boolean;
}
export function sweepDeletedPhotoObjects(a?: {
  /** Max rows to purge this run. Default 500. */
  limit?: number;
  /** Also reconcile R2 against D1 for these `yyyy/mm` prefixes (rule 65). Omit to skip. */
  reconcileMonths?: readonly string[];
  /** Hard per-run object cap across purge + reconcile. Default 4000. */
  maxObjects?: number;
}): Promise<SweepResult>;
```

Wire formats — every handler calls `requireSessionOr401()` first (spec 04 rule 10), **except**
`GET /api/photo-share/{id}/{variant}`, which is gated by the signature instead (rule 60):

```
GET   /api/body/series?from=YYYY-MM-DD&to=YYYY-MM-DD
      200 { points: SeriesPoint[], latest: LatestMeasurement | null, bodyFat: BodyFatResult,
            rate: WeeklyRate, freshness: Freshness }
      — points carry the STORED trend_kg for every local_day in range; nothing is recomputed here.
POST  /api/body/measurements            201 MeasurementWriteResult
PATCH /api/body/measurements            200 MeasurementWriteResult
      409 { conflict: 'stale' | 'revTiebreak', row: LatestMeasurement }   — the LWW winner (02 rule 3)
DELETE /api/body/measurements/{id}      204   (soft delete + forward trend recompute)
POST  /api/body/measurements/recompute-bodyfat  { from?, to? }  200 { rows: number }
      MeasurementWriteResult = { id, localDate, trendKg: number|null, bodyFatPct: number|null,
        rate: WeeklyRate, trendTail: { localDate, trendKg, rowId }[], trendTailTruncated: boolean }

GET   /api/photos?kind=progress&pose=front&from=&to=&cursor=   200 { photos: PhotoMeta[], nextCursor }
      PhotoMeta = { id, kind, pose, localDate, takenAtMs, width, height, contentType, bytes,
        sha256, hasThumb, hasOrig, notes, uploadedAtMs }
POST  /api/photos    raw bytes of `display`; Content-Type: image/jpeg | image/webp
      headers X-Photo-Id (ULID), -Kind, -Pose, -Taken-At (epoch ms), -Width, -Height, -Sha256, -Notes?
      — there is NO X-Photo-Local-Date: the server derives local_day from -Taken-At (rule 45)
      201 { id, key, localDate } · 200 identical replay · 400 · 401 · 409 (same id, different sha)
      · 413 · 415 · 422
PUT   /api/photos/{id}/{thumb|orig}   raw bytes + the same size/hash headers
      200 { key } · 202 (row not there yet — re-queue, do NOT kill the op) · 400 · 401 · 409 · 413 · 415 · 422
GET   /api/photos/{id}                200 PhotoMeta        (JSON — never bytes; rule 59)
GET   /api/photos/{id}/{display|thumb|orig}   200/206/304 bytes, session-gated
POST  /api/photos/{id}/sign  { variant }      201 { url, expiresAtMs }
GET   /api/photo-share/{id}/{variant}?exp=<epochSec>&sig=<b64url>   200/206 bytes · 403 · 404
DELETE /api/photos/{id}               204
```

## Behaviour

**Weigh-in**

1. The dashboard weight card's whole surface opens `WeighInSheet` — one tap, no intermediate screen,
   `?sheet=weigh-in` so Back dismisses it.
2. It prefills the **last raw reading** (not the trend) read from the Dexie `mirror` store —
   `where('[table+localDay]').between(['body_measurements', from], ['body_measurements', to])`, then
   the row with the greatest `measured_at` and a non-null `weight_kg` — so it is instant and correct
   offline. With no such row the field is empty with the numeric keypad focused. **There is no
   start-weight fallback**: `settings.start_weight_kg` does not exist in 02 and this spec does not ask
   for it. There is no KV key either — the mirror is the local read model and
   `12-analytics-dashboard.md` owns any dashboard caching (`dash:v1:<local_day>`).
3. Stepper: 0.1 kg per tap, 0.5 kg on long-press repeat. Free text takes one decimal; a second
   decimal is truncated on blur, never silently rounded mid-typing.
4. Confirm is optimistic: the sheet closes in ≤250 ms, the mirror row and card update at once, and a
   `bodyMeasurement.create` op goes to spec 05's outbox. No spinner on this path.
5. Hard range `WEIGH_IN_HARD_KG` (25–300 kg, our convention) ⇒ inline error, confirm disabled. The
   only weigh-in state that blocks a save.
6. Outlier soft warning, **only when a trend exists**: `|kg − trendKg| > 3`
   (r09 §4 `OUTLIER_ABS_KG`, labelled there "our convention, UNVERIFIED as published"): inline,
   non-modal — "86.4 kg? That's 4.1 kg from your trend. Save anyway / Edit". One extra tap saves.
7. **`reference === null` is a real branch, not a gap.** `softWarningsForWeighIn` takes the trend when
   the mirror has one, otherwise the previous raw reading, otherwise `null`. (a) With a reference,
   unit slip fires when `|kg / reference.kg − LB_PER_KG| < 0.05`: "Looks like pounds — 180 lb is
   81.6 kg. Use 81.6 / Keep 180". (b) With **no** reference — the first-ever weigh-in — a value above
   `FIRST_ENTRY_SUSPECT_KG` (150 kg, our convention) emits `firstEntrySuspect` with the same two-button
   copy, because `180` typed by a lb-thinking user passes the 25–300 hard range and would otherwise
   seed the EMA (`T[0] = W[0]`, 07 rule 19) and poison the adaptive-TDEE prior for weeks. Nothing
   auto-converts, ever. `[]` warnings is a valid result.
8. Each weigh-in is **its own row**; `body_measurements` is deliberately not unique on `local_day`
   (spec 02 rule 15, *"`body_measurements` deliberately has no uniqueness on `local_day`"*).
   `buildDayTrends` averages same-day readings *before* the EMA, because r09 §4 requires it and spec
   07's `trendWeight` returns `null` on duplicate dates (07 rule 22).
9. **Trend persistence, and exactly how it batches.** Any write touching `weight_kg` reruns
   `buildDayTrends` over **full history** on the server and persists the result forward from the
   oldest affected day. One `db.batch()` when the affected tail is **≤ 400 statements**; above that,
   ordered chunks of 400 from the oldest affected day forward (r02 L1340 recommends ≤ 500 statements
   per batch; D1 has no transactions, so `db.batch()` is the only atomic unit — r02 §2.2/§4.6). Each
   statement stays under 100 bound parameters and a run stays under 1000 queries per invocation
   (r02 L1051, L1261). **A partial failure is safe and needs no compensation**: the EMA is a pure
   function of the rows strictly before the first affected day, so a re-run recomputes from the same
   seed and converges. The response reports `trendTailTruncated: true` and returns only the tail it
   actually wrote in `trendTail`; the client then refetches `GET /api/body/series` rather than
   assuming the mirror is current.
10. A backfilled date therefore rewrites the trend forward. `trendTail` is what the client writes into
    the mirror — it never guesses a trend value.
11. **Same-day attribution, stated so it is implementable.** `buildDayTrends` yields one point per
    local day. That day's `trend_kg` is written to exactly one row — the one with `MAX(measured_at)`
    for the day (`DayTrend.carrierRowId`) — and every other row sharing the day gets
    `trend_kg = NULL`. Readers (this spec's chart, 11's adaptive TDEE, 12's dashboard) take the day's
    trend from `trend_kg IS NOT NULL`, so a day contributes exactly one trend point and never two.
    `trend_excluded` is the property of the *day's averaged point*, so it is written to **every** row
    sharing that `local_day` — the raw reading is kept and charted but did not move the EMA
    (r09 §4 flag-don't-drop; 07 rule 21).
12. `buildDayTrends` ⇒ `null` is a bug, not a data state: show "Trend unavailable", log it, and leave
    `trend_kg` untouched. Never render 0 or the raw value in the trend slot.

**Measurements**

13. The canonical set is exactly the 13 `MeasurementKey` sites; the four paired sites are separate
    L/R columns and are never averaged at rest. Weight lives on the same row, nullable, so a
    tape-only or scale-only session is one row either way.
14. Hard ranges (reject, inline; our convention, UNVERIFIED as published): neck 25–70, shoulder
    70–170, chest 60–170, waist 45–200, hips 60–200, biceps 15–70, forearm 15–50, thigh 30–110,
    calf 20–70 cm. Height is **`users.height_cm`**, validated 120–230 and stored as `INTEGER`
    (02 L164 `height_cm? INT`) — whole centimetres, so a 0.5 cm height is not representable and the
    form's height input has `step=1`.
15. Soft warnings (confirm, never block) read the registry: `|Δ|` vs the previous value of the same
    field `> field.softDeltaCm`, and `|L − R| > ASYMMETRY_SOFT_CM` (3 cm) on a pair. `softDeltaCm` is
    per field, not a flat number — neck 3, shoulder 6, chest 5, waist 5, hips 5, biceps 3, forearm
    2.5, thigh 5, calf 3 cm (our convention, UNVERIFIED as published): a 5 cm neck jump is a typo
    where a 5 cm shoulder jump is a Monday. Chips under the field, never dialogs.
16. The waist site hint is sex-dependent — male "at navel level", female "narrowest part of the
    abdomen" (r09 §3). The wrong hint is a data-quality bug, not a copy nit.
17. The form is a page: one row per site, pairs side by side, sticky Save. A key **absent** from
    `values` leaves its column alone (so a waist-only week is one tap and two digits); an explicit
    `null` **clears** it, which is the only way to undo a mistyped measurement. A `PATCH` whose
    `baseRev` loses the 02 rule 3 LWW comparison returns **409** with the winning row; through
    `POST /api/sync/batch` the same collision surfaces as spec 05's `conflict` result and the client
    replaces the mirror row (05 rule 23).
18. Height is read from `users.height_cm`, never copied per row. Because `body_fat_pct` and
    `body_fat_method` are persisted at write time, a later height edit cannot retro-change history.
    Recomputing old rows is an explicit action **owned by this module**:
    `POST /api/body/measurements/recompute-bodyfat` with an optional `{ from, to }`, surfaced as
    "Recalculate body fat" on `/body` (not in settings, which owns no body route), chunked under the
    same rule-9 budgets and reporting the row count it rewrote.
19. `DELETE /api/body/measurements/{id}` soft-deletes (`deleted_at`, 02 rule 25 — *"soft delete is the
    default for all user data"*), returns **204**, and reruns rule 9's forward recompute because
    removing a reading changes every later trend value. The confirm dialog names the date and the
    weight; the outbox op is `bodyMeasurement.delete` (already in 05's `OP_TYPES`, 05 L114) and
    travels the normal `/api/sync/batch` path.

**Trend weight**

20. Raw readings render as dots (`SeriesPoint.readings`, so two weigh-ins on one day are two dots),
    the EMA as a line **over** them. An `excluded` reading renders **hollow** — transparent fill, a
    1.5 px full-opacity stroke in the muted-foreground token, matching 12 rule 20's "grey and hollow"
    — never an alpha-composited fill: 03 computes contrast from the shipped hex and a graphical object
    must clear **3:1** against the chart ground, which 40 % alpha does not. It stays tappable and
    carries an `aria-label` saying it did not move the trend.
21. 0 readings ⇒ empty state + "Log your first weigh-in", no axes. Exactly 1 ⇒ the dot only, no line,
    no rate, and the **shared** empty-rate string from `WeeklyRate.emptyReason` (rule 24) — there is
    one string per state, used identically here and on the rate badge.
22. The dashboard headline is **`trend_kg`** at 1 dp, never the last reading; the last reading is a
    sub-line ("last 82.6 kg · 2 d ago") taken from `LatestMeasurement.weightKg` /
    `measuredAtMs`, or from the newest entry in the last `SeriesPoint.readings`. Every dashboard delta
    or arrow is computed from trend values.
23. `weeklyRateOfChange` uses a 14-day window ending at `todayLocalDate` over the **stored** trend
    values of the day points in the window:
    `kgPerWeek = (T_last − T_first) / spanDays × 7`. `spanDays <= 0` (a single day, or two readings on
    one day) ⇒ `confidence: 'none'`, `kgPerWeek: null` — no division, no ±7× extrapolation.
24. **Confidence, as monotone thresholds with no gaps** (each test applied in order):
    - `none` when `readingsInWindow < 2` **or** `spanDays < 7`;
    - otherwise `low`;
    - upgrade to `medium` when `readingsInWindow >= 3` **and** `spanDays >= 10`;
    - upgrade to `high` when `readingsInWindow >= 5` **and** `spanDays >= 12`.

    Five readings over 11 days is therefore `medium`, not the old rule's `none`. When `none`, hide the
    number and show the string `emptyReason` names: `needReadings` ⇒ "Need {missing} more weigh-in(s)
    for a rate" — a **deficit**, so one reading says "Need 1 more", never "Need 2 more" —
    `needSpan` ⇒ "A rate needs at least 7 days of weigh-ins".
25. A `low` rate renders at **full opacity** in the muted-foreground token with the "low confidence"
    chip carrying the signal; a numeric readout must clear **4.5:1** (brief WCAG AA, 03's measured
    contrast regime), which a 60 % alpha does not. The rate is never shown without a confidence chip.
    Display 2 dp `kg/wk`; the tooltip adds %BW/wk against the current trend.
26. **Copy rules.** (a) Every bodyweight number is labelled "Trend" or "Last weigh-in", never a bare
    "Weight". (b) No causal or moral language — no "you gained", no "should", no "only", no guilt.
    (c) The smoothing tooltip says "averages roughly the last 9 days of weigh-ins": 9 d is the EMA's
    mean lag, the half-life is 6.58 d (r09 §4), so "9-day half-life" must never be written. (d) Body
    fat always carries its band and method in the same sentence. (e) RU and EN both carry every
    `body.*` key — a missing RU string here is a release blocker, not a fallback.
27. **The offline read model, stated explicitly** (the brief's offline-first NFR; 05 routes all other
    `/api/*` to `NetworkOnly`, 05 L233, so `/body` must not depend on a fetch). `src/lib/body/local-model.ts`
    builds the *same* `SeriesPoint[]` / `LatestMeasurement` / `WeeklyRate` / `BodyFatResult` shapes
    from `mirror` rows where `table === 'body_measurements'`, using the **mirrored `trend_kg` and
    `trend_excluded` columns** — reading a stored column is not the client-side recompute that rule 9
    and 12 rule 20 forbid. `GET /api/body/series` is an **online refresh** of the same view, never the
    only source. The BF card uses the mirrored `body_fat_pct`/`body_fat_method` of the latest row that
    has one; the rate is computed from mirrored trend values. Whenever the newest mirrored row is
    older than the newest *local* outbox write, or the last successful pull is over 24 h old,
    `Freshness.stale` is true and the card shows an "as of {date}" line — a stale number is labelled,
    never hidden and never silently recomputed.

**Navy body fat**

28. A number appears only when `users.sex`, `users.height_cm`, `neckCm`, `waistCm` — plus `hipsCm` for
    female — are all present; otherwise the card names each missing input as a button deep-linking to
    that field (`missing` / `needsHeight` / `needsSex`). Never 0, never a dash-with-number, never a
    partial estimate.
29. Metric equations only, `Math.log10`, via spec 07 (r09 §3, 07 rule 16). The imperial form must not
    exist in the codebase: cm into the inch constants overstates BF by 6.52 pp, and mixing forms
    leaves an unexplainable step in the history. `bodyfat-band.ts` **never re-implements the formula**
    — the `no imperial constants` grep gate would not catch a second copy of the metric one either,
    and two copies drift.
30. `{ ok: false, implausible: true }` comes from **`navyBodyFatPctDetailed`** (amendment 07.1): the
    existing `navyBodyFatPct` returns a bare `number | null` and cannot distinguish the 2–60 pp
    physiological gate (07 rule 18) from bad input or `waist − neck <= 0` (07 rule 17), and this module
    is forbidden from re-deriving it. It shows "Check your neck and waist entries", never a number.
31. Presentation is a band. **One surface per purpose, decided once:** the shaded ribbon on the BF
    chart is drawn from `seePp` (3.5 male / 3.7 female), and **every string the user reads or hears
    says "±3–4 percentage points"** — inline `16.4 % ±3–4`, screen reader "16.4 percent, plus or minus
    3 to 4 percentage points". `lowPp`/`highPp` exist only to position the ribbon and are never
    rendered as text, because r09 §3 marks the 2-dp SEE values (`3.52`/`3.72`) `UNVERIFIED` and
    instructs reporting "±3–4 percentage points". Never 2 dp on the percentage, never a bar-to-goal
    on BF.
32. `body_fat_pct` is computed server-side on write, persisted with `body_fat_method =
    'us-navy-metric'`, and declared in the export manifest's derived columns so a restore verifies
    rather than trusts it (r10 RT-4).

**Photo capture**

33. Poses are `front | side | back` (spec 02 `POSES`). Capture opens on the pose shot least recently;
    a chip row switches it in one tap. The chip row is exhaustive — there is no "other" pose. A photo
    may also be saved with **`pose = null`** (02 allows it: `C(pose IS NULL OR kind='progress')`);
    the timeline groups those under "Unposed" and compare never offers them. The post-capture review
    takes an optional one-line note, written to `photos.notes` (02 L233).
34. Path A (preferred): `getUserMedia({ video: { facingMode: 'environment' } })` preview with
    `GhostOverlay` above it. `UNVERIFIED`: camera availability inside an installed iOS standalone PWA,
    so path A is feature-detected and any rejection falls through to path B.
35. Path B: `<input type="file" accept="image/*" capture="environment">`. The ghost overlay then
    appears **after** capture over the taken photo, with an opacity slider and Retake — alignment help
    survives, one step later.
36. `GhostOverlay` shows the newest non-deleted photo of the **same pose** at 35% opacity (slider
    0–70%), a vertical centre line, and a draggable horizontal guide remembered per pose in
    `localStorage`.
37. On shutter, `prepareVariants` derives all three uploadable variants from the one file:
    `createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth, resizeHeight,
    resizeQuality: 'high' })` → `OffscreenCanvas.convertToBlob`, falling back to `<canvas>.toBlob`
    below iOS 16.4 (r03 §4(d), G4, G5). Never upscale a small source.
38. Output type is feature-detected `image/webp` else `image/jpeg`, and `content_type` is read back
    from `blob.type` (r03 G10 — "Always read `blob.type` back and store that, never the type you asked
    for"). **PNG can never reach the wire.** Whenever `blob.type !== the requested type` —
    unconditionally, not only past some size ratio — `prepareVariants` re-encodes that variant as
    `image/jpeg` and re-reads `blob.type`; if it is still neither jpeg nor webp the capture fails
    locally with "This device couldn't encode the photo" and nothing is queued. Consequently `ext`
    stays `'jpg' | 'webp'`, the accepted request `Content-Type` set stays `image/jpeg | image/webp`,
    and `sniffImageType` returning `'image/png'` on the server is **always a 415** — a real bug
    report, not a tolerated path. AVIF is never requested (r03 G11).
39. **`orig` is a 2560 px re-encode, not the camera file.** Re-encoding from a bitmap discards all
    EXIF, so orientation is *applied* and metadata (GPS included) is *gone*; we deliberately diverge
    from r03's optional "untouched original" because the untouched file carries location data and,
    as HEIC, could never be re-transformed on our plan (r03 G11). Rule 42's server guard is the
    enforcement, not this rule's good intentions.
40. The `id` is a ULID from `src/lib/ids.ts` minted on the **client** at capture (r03 §5), so the key,
    the queued ops and every retry are idempotent.

**Upload**

41. `POST /api/photos` is a Route Handler with a raw body — never a Server Action (1 MB cap, r03 G2),
    never `multipart/form-data` — doing `put(key, await request.arrayBuffer())`, never a stream (G1).
42. Gates in order: session → read the body to an `ArrayBuffer` and check **`byteLength` ≤ 8 MiB**
    (413) — `Content-Length` is client-controlled and absent on a chunked request, so it is a cheap
    pre-filter only, never the gate → `sniffImageType` matches the declared `Content-Type`, and
    `'image/png'` is a 415 by rule 38 → `hasEmbeddedMetadata(bytes, declaredType) === false`
    (422 "metadata present"), which now covers the WebP default path (RIFF `EXIF` / `XMP ` chunks) and
    PNG (`eXIf`/`tEXt`/`zTXt`/`iTXt`), not JPEG APP1 alone → SHA-256 of the body equals
    `X-Photo-Sha256` (400). `sha256` is stored for the `display` variant only.
43. Idempotency: same `id` **and** same `sha256` ⇒ **200** with the existing key, nothing written —
    200, not 409, because 05 rule 24 maps 409 to `permanent ⇒ dead` and a benign replay must never
    kill the op or tell the user the photo failed. **409 is reserved for one case**: the same `id`
    presented with a *different* `sha256`, which is a genuine client bug and correctly permanent.
44. `put` carries `httpMetadata: { contentType, cacheControl: 'private, max-age=31536000, immutable' }`
    and `customMetadata: { sha256, w, h }` (r03 §3). Keys are never reused — which licenses
    `immutable`; a re-crop mints a new ULID (spec 02 rule 26, *"R2 objects are never deleted in a
    request… Keys are never reused — a re-crop mints a new id"*).
45. Order is R2 then D1, and the D1 insert completes the operation. **`local_day` is derived
    server-side** from `X-Photo-Taken-At` via spec 07's `localDateFromInstant`, per 02 rule 5
    (*"computed by `toLocalDay()` at write time… never derived from a UTC epoch in SQL"*); the key's
    `yyyy/mm` are split from **that same string**, so the month in the key can never disagree with the
    `local_day` rule 65's per-month reconciliation navigates by. There is no `X-Photo-Local-Date`
    header. `thumb_key`/`orig_key` start null and are filled by the two `PUT`s; a null `thumb_key`
    renders `display` in the grid — degraded, never broken. **Arrival order is not required**: a
    `thumb`/`orig` `PUT` for an `id` with no row yet writes nothing and returns **202**, so spec 11's
    parallel display+thumb upload (11 rule 9) is legal and the op is re-queued rather than killed.
    Objects written without their row are caught by rule 65's reconciliation.
46. **Photos do wait offline.** `enqueuePhoto` writes one spec-05 `BlobRow` per uploadable variant and
    one `photo.upload` op each (preferred order `display` → `thumb` → `orig`, `entityId = photoId`),
    plus the `mirror` row (`table: 'photos'`) so the timeline renders immediately from the local blob.
    That optimistic row's `local_day` is `toLocalDay(takenAtMs)` — 02's own helper, the same function
    the server calls in rule 45, so the two agree unless the device clock is wrong; the server's value
    replaces it when the op is acked (05 rule 23 replaces the mirror row with `result.row`). Spec 05
    owns the flush loop, the 100 MB blob budget and eviction; a blob whose op is still pending is never
    evicted (05 rule 30).
47. Capture refuses **before** the shutter when spec 05's `getQuota()` ratio is already > 0.85 —
    "Storage is full — connect to Wi-Fi so waiting photos can upload" — so no allowed shot is lost.
48. **The flush transport for photo bytes, since nobody else defines it.** `POST /api/sync/batch` is a
    JSON envelope of ≤ 50 ops validated against `OP_SCHEMAS[kind]` and applied by `OP_APPLIERS[kind]`
    in one `db.batch()` (05 rules 23–25) — an 8 MiB `Blob` cannot travel it. So `photo.*` ops **bypass
    `/api/sync/batch`** and go through `dispatchPhotoOp`, one HTTP request per op, in `seq` order
    alongside the JSON batches:

    | op kind | payload | method + URL | body | headers from the op + `BlobRow` |
    |---|---|---|---|---|
    | `photo.upload` (`variant: 'display'`) | `{ id, kind, pose, takenAtMs, variant, width, height, sha256, notes }` | `POST /api/photos` | `blobs[op.blobKey].blob` | `Content-Type: BlobRow.contentType`; `X-Photo-Id`, `-Kind`, `-Pose`, `-Taken-At`, `-Width`, `-Height`, `-Sha256`, `-Notes?` |
    | `photo.upload` (`variant: 'thumb' \| 'orig'`) | same | `PUT /api/photos/{id}/{variant}` | same | `Content-Type`, `X-Photo-Width`, `-Height`, `-Sha256` |
    | `photo.delete` | `{ id }` | `DELETE /api/photos/{id}` | none | — |

    `dispatchPhotoOp` maps the response to a spec-05 outcome: `200`/`201` → `applied` (mark the blob
    `uploaded:1`, delete the op); **`202` → `skipped`** (back to `pending`, `attempts` unchanged, per
    05 rule 23 — this is the display-not-there-yet case, never a death); `401`/`403` → `auth` (flush
    pauses); `408`/`429`/`5xx`/network → `transient`; `400`/`409`/`413`/`415`/`422` → `rejected` ⇒
    `dead` with the reason. This is amendment 05.1 — 05 must register the dispatcher rather than
    schema-validating an 8 MiB blob into a JSON array.
49. Errors as the user sees them: `auth` ⇒ re-auth then retry; `rejected` ⇒ the op goes `dead` with the
    reason, surfaced in `settings/sync` and on the tile as "This photo couldn't be uploaded" with
    Retry/Discard; `transient` uses spec 05's backoff. A 200 replay and a 202 re-queue are **never**
    surfaced as an error.

**Viewing**

50. The timeline groups by Almaty month, newest first, 3-up `thumb` grid, using stored
    `width`/`height` to reserve each box (no CLS). Skeleton = 9 grey tiles at the stored aspect ratio.
    Offline it lists from the `mirror` rows where `table === 'photos'` (the `[table+localDay]` index
    for the range filter), rendering queued photos from their `BlobRow` with a pending badge; `GET
    /api/photos` is the online refresh, not the only source (it is `NetworkOnly` under 05's matcher).
51. Tapping a tile opens the full-screen `display` viewer; horizontal swipe moves to the adjacent
    photo **of the same pose**, with a pose/date caption.
52. Compare defaults A and B to the oldest and newest photo of the selected pose inside the active
    range. "Same pose only" is on by default; off shows a warning chip that cross-pose compare
    misleads.
53. The compare UI is spec 03's `src/components/app/photo-compare.tsx` (03 L71) — this module does not
    build a second one. This spec specifies its contract: props
    `{ aUrl, bUrl, mode: 'divider' | 'opacity', value: number, onValueChange, aria: { label, valueText } }`,
    and the divider is a draggable clip (`clip-path: inset()` on the top image, pointer-driven) that is
    **also** a real `<input type="range">` with `aria-label`/`aria-valuetext`; the visible divider is
    that input's styled thumb, not a parallel control.
54. Opacity mode swaps the divider for one 0–100 % cross-fade over the same A/B pair, so switching
    modes never resets the selection — `mode` changes, `aUrl`/`bUrl` do not.
55. Range presets 1 m / 3 m / 6 m / 1 y / All / Custom in one shared state, filtering chart, timeline
    and compare candidates so all three agree. Because trend values are read from the stored column
    (rule 27), the same day shows the **same** `trendKg` at 1 m and at All.
56. Fewer than 2 photos in the active pose+range ⇒ "Need 2 photos in the same pose" + Capture CTA.
    Compare never silently falls back to another pose or a wider range.

**Privacy and delete**

57. No photo is ever served from a public bucket or an `r2.dev` URL (r03 §3); every read route requires
    either a session (rule 58) or a valid signature (rule 60) before touching R2.
58. Session reads carry `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options:
    nosniff`, `ETag` from `object.httpEtag`, `Accept-Ranges: bytes`, `304` on a matched
    `If-None-Match` (not 412 — r03 G8) and `206` + `Content-Range` on a range (G9). `public` is
    forbidden: the edge cache keys on path, so a public response reaches unauthenticated requests
    (G6); `Cf-Cache-Status: BYPASS` is correct here and is documented beside the header (G7).
59. Spec 05 runtime-caches `sameOrigin && /^\/api\/photos\//` in `r2-photos` (`CacheFirst`,
    `CacheableResponsePlugin({statuses:[200]})`, Range plugin, 240 entries / 30 d — 05 L230), which is
    why `206` support is load-bearing. Because that matcher is **status-only**, there are exactly
    **three cacheable byte URLs per photo** and this module must delete all three on delete:
    `/api/photos/{id}/display`, `/api/photos/{id}/thumb`, `/api/photos/{id}/orig`. There is no fourth:
    `GET /api/photos/{id}` returns **metadata JSON**, not display bytes — the old bare-id byte alias
    is deleted precisely because it was a second Cache Storage key for the same bytes and
    `purgeCachedPhoto` would have missed whichever form the viewer actually requested. `purgeCachedPhoto(id)`
    does the three deletes; `purgeR2PhotoCache()` clears the whole cache and is called by 04's
    `logout()` (amendment 04.1) and by 15 rule 61's full purge. Spec 04 rule 25 already states locally
    cached photos are readable on an unlocked device — that is the accepted boundary.
60. **Share URLs are signed and live outside the cached prefix.** Any URL that can leave the app
    (share sheet, archive download, debug link) is
    `GET /api/photo-share/{id}/{variant}?exp=<epochSec>&sig=<base64url HMAC-SHA256 over "id|variant|exp">`,
    TTL 120 s, key from secret `PHOTO_URL_SIGNING_KEY` (amendment 01.1) via
    `crypto.subtle.sign('HMAC', …)` — never a homegrown scheme (r03 §3). The route lives under
    `/api/photo-share/`, **not** `/api/photos/`, **by construction**: the Cache Storage API ignores
    `Cache-Control` entirely, so a `no-store` header would not have kept a 200 signed response out of
    `r2-photos`, and a cached copy would then outlive both the 120 s TTL and rule 63's purge. Under
    05's table this path falls to `NetworkOnly`. Expiry is checked server-side (`403` when past `exp`),
    the signature compare is constant-time (`403` on mismatch), and a signed request still **404**s on
    a soft-deleted row. Responses additionally set `Cache-Control: private, no-store` as
    defence-in-depth for HTTP caches — never as the primary control.
61. Photo keys appear in logs, analytics, `ai_prompt_logs` and Telegram only as the opaque key string
    (spec 01 forbids logging photo bytes). Progress photos are never sent to any AI provider — only
    food photos are (spec 11).
62. `DELETE /api/photos/{id}` sets `deleted_at` and returns 204; it does **not** touch R2, because spec
    02 rule 26 forbids deleting R2 objects in a request. In the same client action it calls
    `purgeCachedPhoto(id)` and removes the tile; the confirm dialog (thumbnail + pose + date) is the
    only safety net — there is no undo. Copy: "Deleted. Removed from storage within the day."
63. `sweepDeletedPhotoObjects()` is the single sweeper. Purge pass: select rows with
    `deleted_at IS NOT NULL AND r2_purged_at IS NULL` (partial index `photos_deleted_at_idx`, 02 L233),
    `delete()` their non-null `r2_key`/`thumb_key`/`orig_key` in ≤1000-key chunks, stamp
    `r2_purged_at`, `limit` rows per run (default 500). Rows are never hard-deleted (spec 02 rule 25).
    It never touches a `…/ai.jpg` object — see rule 64.
64. **The `ai` variant is spec 11's, and is deliberately outside this sweeper's purge pass.** 11 rule 9
    writes `photos/food/{yyyy}/{mm}/{ULID}/ai.jpg` and uses that key as the `ai_prompt_logs.input_ref`
    reproducibility record, which must outlive a `photos` row the user deleted. So: `parsePhotoKey`
    accepts `variant: 'ai'` (it is a real key in the bucket and must not parse as `null`); it is absent
    from `VARIANT_SPEC` and never client-prepared; it has no `photos` column; rule 63 never deletes it;
    rule 65 deletes an `ai` object only when **no `ai_prompt_logs` row carries it as `input_ref`**; and
    it leaves through `ai_prompt_logs`' own 365-day retention purge (02 rule 25) or 15's full purge,
    not through this module. Rule 66's manifest invariant is scoped to the three `photos` key columns
    for the same reason.
65. **Orphan reconciliation — both kinds, paginated, batched, capped.** Given `reconcileMonths`, for
    each `yyyy/mm` and for **both** prefixes `photos/progress/<yyyy>/<mm>/` and
    `photos/food/<yyyy>/<mm>/`, loop `list({ prefix, cursor })` until `!truncated` (R2 `list()` returns
    at most 1000 keys per call plus a `cursor`), `parsePhotoKey` each key, then cross-check existence in
    **batched** queries — `SELECT id FROM photos WHERE id IN (…)` chunked to **≤ 90 bound parameters**
    (r02 L1051: 100 is the hard ceiling), and for `ai` keys `SELECT input_ref FROM ai_prompt_logs WHERE
    input_ref IN (…)` the same way — never one query per object, which would hit the 1000-queries-per-
    invocation ceiling (r02 L1261, restated in 05 rule 25) on one busy month. Delete only keys with no
    owning row — the rule-45 orphan case — and log `orphanObjects` so a persistent non-zero is visible.
    The run stops at `maxObjects` (default 4000) and returns `truncated: true` so the next run resumes;
    the caller passes the current and previous month, not the whole bucket.
66. **Cron ownership, named and real.** `sweepDeletedPhotoObjects()` has no caller until
    `14-ai-coach-and-notifications.md` adds one (amendment 14.1): a new `photo-gc` step in its
    `StepName` union, run inside the **existing** `backup-to-r2` trigger (`0 18 * * *` = 23:00 Almaty
    daily, 14 L362) **before** `backup`, with `reconcileMonths` = the current and previous Almaty
    month on the 1st of each month and omitted otherwise. Daily satisfies the ≥1 h cron-CPU rule
    (stack-facts; 14 rule 12 forbids any sub-hourly cron) and adds no fifth trigger. Until that
    amendment lands, rules 63–65 are unreachable code and deleted photo bytes stay in R2 — this spec
    previously claimed spec 15 rule 58 invoked them, which is false: 15 rule 58 deletes stale
    `import_staging`/`import_batches` rows (15 L568) and 15's only R2 photo deletion is the full-purge
    path in `src/server/data/purge.ts` (15 rule 60).

**Export**

67. `15-data-portability.md` owns the CSV set and the manifest; this module supplies the two things 15
    cites it for (15 L29–30, rule 8) and guarantees the invariants 15 depends on:
    `listPhotoObjectsForManifest()` returning `PhotoManifestObject { key, bytes, sha256, contentType }`;
    keys opaque and never re-derived; **one manifest entry per non-null `r2_key`/`thumb_key`/`orig_key`**
    (the `ai` key is not among them — rule 64); `sha256` present on `display` only; and a `head()` miss
    is a dangling-key warning (15 rules 8–9), never a silently re-minted key.
68. `photos.csv`'s header is owned here and consumed verbatim by 15 rule 7. It is the D1 column names
    in DDL order, plus 15's two added columns and `syncCols()`:
    `id,kind,pose,r2_key,thumb_key,orig_key,content_type,bytes,width,height,sha256,r2_etag,taken_at,local_day,uploaded_at,notes,r2_purged_at,import_key,import_batch_id,created_at,updated_at,rev,deleted_at`.
    Note for 15: the column is `local_day` (02 rule 5); 15's own three example headers spell the
    analogous column `local_date`, which 15 must reconcile in `src/lib/export/headers.ts` — it is
    generated from the schema, never hand-written, so one of the two spellings will fail CI.
69. Photo **bytes** leave only through spec 15's quarterly sharded archive
    (`backups/archive/<yyyy>-Q<n>/photos-<yyyy>-<mm>.zip`). Restore reuses every key verbatim
    (r10 RT-3) — a dangling key would show the wrong body in the compare slider.

## Data

`02-data-model.md` is canonical; nothing here redefines it, **including the column name**: it is
`local_day` everywhere (02 rule 5), with `localDate` as the TS view field per the Interfaces note.
This module reads/writes:

- **`body_measurements`** — `local_day`, `measured_at`, `weight_kg?`, `trend_kg?` (derived, persisted,
  one row per day carries it — rule 11), `trend_excluded`, `neck_cm?`, `shoulder_cm?`, `chest_cm?`,
  `waist_cm?`, `hips_cm?`, the eight L/R limb columns (see amendment 02.1), `body_fat_pct?` (derived),
  `body_fat_method?`, `notes?`, `deleted_at?`, `rev`. Indexes `I(local_day)`, `I(measured_at)`;
  **no** uniqueness on `local_day` (spec 02 rule 15). Query pattern P11 serves the trend chart.
- **`photos`** — `id` (ULID), `kind`, `pose?`, `r2_key` (UNIQUE, the `display` object), `thumb_key?`,
  `orig_key?`, `content_type`, `bytes`, `width`, `height`, `sha256?`, `r2_etag?` (unquoted form,
  r03 G17), `taken_at`, `local_day`, `uploaded_at`, `notes?`, `deleted_at?`, `r2_purged_at?` (see
  amendment 02.2). Indexes `I(kind, taken_at)` (P14), `I(sha256)`, partial `I(deleted_at)` (P15).
- **Reads only** — **`users.sex`** (`∈ male|female`, nullable) and **`users.height_cm`**
  (`INTEGER`, nullable) — both are columns on `users` (02 L164), *not* on `settings`; and
  `ai_prompt_logs.input_ref` for rule 65's `ai`-key cross-check. `settings.unit_system` is
  deliberately **not** read (Scope). `settings.start_weight_kg` does not exist and is not requested —
  rule 2 prefills from the mirror or shows an empty field.
- Timestamps are `integer({ mode: 'timestamp_ms' })` (r02 §2.8); every multi-row write is one
  `db.batch()` (chunked per rule 9); no blobs in D1 (2 MB row cap).

### Amendments required in other specs

Six, none optional. Each names the spec that owns the surface.

**02.1 — `body_measurements` L/R limb columns.** Replace `arm_cm` / `thigh_cm` / `calf_cm` with
`biceps_l_cm`, `biceps_r_cm`, `forearm_l_cm`, `forearm_r_cm`, `thigh_l_cm`, `thigh_r_cm`,
`calf_l_cm`, `calf_r_cm` (all `real`, nullable). Unilateral asymmetry is the whole point of tracking
limbs, and a single averaged column cannot express rule 15's asymmetry warning. **Blast radius —
three specs, not one:** (a) 15's `body_measurements` CSV header *and* its import mapper, which keys
rows on `${source}:${local_day}` (15 L471) and maps columns by name; (b) **12-analytics-dashboard.md
L414**, which reads `… waist_cm, chest_cm, arm_cm, thigh_cm` for the body-composition panel and must
move to the L/R pair (display the larger side, or the mean, as 12 decides); (c) 02's own DDL. On
SQLite this is a **column replacement, so it is 02 rule 11's hand-written table recreate, not an
`ALTER`** — and because `body_measurements` has no inbound FKs the recreate is safe. Preferred path:
land it in `body.ts` **before migration 0000 applies anywhere**, which is possible today (Phase 0).
If 0000 has already applied, the recreate copies every other column and leaves the eight new columns
**NULL**: an averaged `arm_cm` cannot be attributed to a side, and writing it to both would fabricate
perfect symmetry — exactly the signal rule 15 exists to detect.

**02.2 — `photos.r2_purged_at INTEGER`** (nullable). Without it the sweeper cannot tell purged rows
from unpurged ones — rows are never hard-deleted (02 rule 25) — so it would re-issue deletes for every
photo ever deleted, on every run, forever. This is an `ALTER TABLE ADD COLUMN` with no default.

**01.1 — `PHOTO_URL_SIGNING_KEY` as a secret** in 01's env-var contract table (01 L275–296, which
currently lists `SESSION_SECRET`, `CRON_SECRET`, `TELEGRAM_*`, `VAPID_*`, the AI keys, `FDC_API_KEY`,
`NUTRITIONIX_*` and no photo key). ≥ 32 bytes, in `.dev.vars` for local and `wrangler secret put` for
preview and production; without it `POST /api/photos/{id}/sign` 500s in dev. This spec's
`mintSignedPhotoUrl`/`verifySignedPhotoUrl` take the key material as an argument precisely so the
route does the single `env` read and the unit test injects a fixed key.

**05.1 — register the photo transport.** 05 rule 23's result handling and rule 25's batch endpoint
describe the JSON path only; add that `photo.upload` and `photo.delete` ops are dispatched by
`dispatchPhotoOp` (rule 48 above) rather than serialised into the `/api/sync/batch` envelope, and that
its `skipped` outcome (HTTP 202) returns the op to `pending` without incrementing `attempts`. Without
this the flusher either schema-validates an 8 MiB Blob into a JSON array or drops photo ops on the
floor.

**07.1 — `navyBodyFatPctDetailed`.** Add, beside the existing `navyBodyFatPct`:
`navyBodyFatPctDetailed(sex, m): { ok: true; pct: number } | { ok: false; reason: 'input' | 'geometry' | 'implausible' }`
— `input` for non-finite/`<= 0`/missing female hip (07 rule 17), `geometry` for
`waist − neck <= 0` / `waist + hip − neck <= 0` (07 rule 17), `implausible` for the 2–60 pp gate
(07 rule 18). `navyBodyFatPct` keeps its `number | null` contract and becomes a thin wrapper, so no
caller changes and the r09 §3 vectors still pin one implementation. Without this, rule 30's
`implausible` state is unreachable without re-implementing the formula, which rule 29 forbids.

**04.1 — purge the photo cache on logout.** `src/lib/auth/client.ts`'s `logout()` must call
`purgeR2PhotoCache()` (this module). 04 rule 25 accepts that cached photos are readable on an unlocked
device; leaving them after an explicit logout is a different and avoidable thing.

**14.1 — the `photo-gc` step.** See rule 66: add `'photo-gc'` to 14's `StepName` union and run it in
the existing `backup-to-r2` trigger before `backup`, monthly-reconciling. No new cron, no sub-hourly
schedule.

**KV** — none. The weigh-in prefill reads the Dexie mirror (rule 2) and dashboard caching is spec 12's
`dash:v1:<local_day>`; adding a `body:latest` key would be a second source of truth for the one number
the user watches most.

**R2** — binding `PHOTOS`, bucket `fitness-photos` (spec 01 `wrangler.jsonc` L93 is the single source
of truth for bucket names). Keys
`photos/{progress|food}/{yyyy}/{mm}/{ULID}/{display|thumb|orig|ai}.{jpg|webp}`, with `yyyy`/`mm` split
from the server-derived `local_day` (rule 45), lowercase `[a-z0-9/._-]`, no PII, never reused. `ai` is
spec 11's (rule 64). Note for spec 15: it refers to this bucket as `MEDIA`; spec 01 owns the binding
name and it is `PHOTOS`.

**IndexedDB** (Dexie, spec 05) — **one generic `mirror` store, not one store per entity** (05 rule 17,
L287–292): this module's rows are `mirror` rows with `table: 'body_measurements'` and
`table: 'photos'`, the D1 table names (05 L118–119), same column names as D1 including `local_day`,
read through the `[table+id]` primary key and the `[table+localDay]` index. Plus `blobs` rows (one per
uploadable variant, `BlobRow.blob` is a real `Blob`) and `outbox` ops
`bodyMeasurement.create|patch|delete`, `photo.upload`, `photo.delete` — all five already in 05's
`OP_TYPES`. `localStorage` holds only the per-pose ghost-guide position.

## UX notes

- The weigh-in sheet is a bottom sheet, never a page: confirm in the bottom 25% of the viewport,
  ≥56 px tall, right-thumb reachable, `−`/`+` steppers flanking it.
- Haptics: light impact per stepper tick, success on confirm, warning when a soft warning appears.
  Nothing haptic on chart interaction.
- The trend line animates its path draw once on mount (~350 ms spring) and never re-animates on range
  change — only the axis crossfades; `prefers-reduced-motion` disables both.
- Chart skeleton: axis lines plus a flat shimmer band at the last known trend value, so the card does
  not change height when data lands.
- Capture is full-bleed and chrome-free: shutter centred in the bottom third, pose chips above,
  ghost-opacity slider vertical on the right edge in thumb reach; wake lock on while the preview lives.
- The compare divider needs a ≥44 px invisible hit area around its 2 px line; double-tap on the image
  snaps it back to 50%. Photo tiles use a long-press menu (Compare from here / Delete), not a swipe —
  swipe belongs to photo-to-photo navigation in the viewer.
- a11y: the compare slider is a real range input (rule 53); each photo's `alt` is "Progress photo,
  {pose}, {date}"; nothing auto-advances; the band is announced "16.4 percent, plus or minus 3 to 4
  percentage points" (rule 31 — the same words as the inline string, never the 3.5/3.7 ribbon
  geometry); missing BF inputs are a `<ul>` of buttons, not a sentence with inline links. Excluded
  trend dots and low-confidence rates carry their meaning in a stroke and a chip, never in opacity
  (rules 20, 25).
- The delete dialog shows the thumbnail, pose and date, destructive action on the right, and says
  "permanently" plus "within the day" — because there is no undo and the bytes go in the 23:00 sweep.
- `Freshness.stale` renders as a quiet "as of {date}" line under the trend headline, never as a
  spinner or a blocking state (rule 27).

## Risks

| Risk | Mitigation |
|---|---|
| iOS returns PNG for a WebP request, tripling upload size on gym Wi-Fi (r03 G10) | Feature-detect per session; store `blob.type`; **unconditionally re-encode as JPEG whenever `blob.type !== requested`** (rule 38), so PNG never reaches the wire and `sniffImageType === 'image/png'` is always a 415; unit test asserts stored `content_type === blob.type`. |
| Portrait photos land rotated 90°, making compare worthless (r03 G4) | `imageOrientation: 'from-image'` on every `createImageBitmap`; a Playwright fixture with a real EXIF-orientation-6 JPEG asserts portrait output. |
| An EMA recomputed from a paginated window makes one day differ by zoom level (r09 §4, 12 rule 20) | `buildDayTrends` is **server-only** (ESLint import boundary + a Verification grep); `trend_kg` is computed over full history, persisted, and read from the column by both the API and the offline model (rules 9, 27). |
| Out-of-order backfill leaves stale trend values | Rule 9's forward recompute on every weight write, batched ≤400 statements per `db.batch()` and idempotent on re-run; the response flags `trendTailTruncated`; an e2e test inserts yesterday after today and asserts the tail changed. |
| Soft-delete without a working sweep leaves body photos in R2 indefinitely | Amendment 02.2 plus **amendment 14.1**, which gives the sweeper a real caller (`photo-gc` in `backup-to-r2`); Verification triggers that job id with `x-cron-secret` and requires `r2 object get` to then fail; a non-zero orphan count is logged, not swallowed. |
| A `Cache-Control: public` "fix" leaks every photo to unauthenticated requests (r03 G6) | `private` asserted by a header test and a grep gate; a comment explains why `BYPASS` is correct. |
| A signed share URL survives its 120 s TTL and a delete, served from `r2-photos` | The Cache Storage API ignores `Cache-Control`, so signed reads live at `/api/photo-share/…` — **outside** 05's `/^\/api\/photos\//` matcher (rule 60). A Verification case fetches a signed URL twice and asserts the second is a network request, and the e2e asserts an offline signed fetch fails. |
| A deleted photo stays visible from `r2-photos` | Exactly three cacheable byte URLs exist per photo (the bare-id byte alias is gone — `GET /api/photos/{id}` is JSON); `purgeCachedPhoto` deletes all three in the same client action as the `photo.delete` op; the e2e reloads offline and asserts a miss. |
| WebP/PNG metadata slips past a JPEG-only EXIF check on the default output path | `hasEmbeddedMetadata(bytes, declaredType)` covers RIFF `EXIF`/`XMP ` and PNG `eXIf`/`tEXt`/`zTXt`/`iTXt` as well as JPEG APP1/APP13 (rule 42), with a fixture and a Verification grep per format. |
| Blob round-trips through IndexedDB have been unreliable on Safari (`UNVERIFIED` today) | Bytes live in spec 05's `BlobRow`, the single place to switch to `ArrayBuffer` + `type` if it bites; this module never holds its own blob store. |
| The ±3–4 pp Navy band is wider than real monthly change, so noise reads as progress | The band is the headline, the chart carries the `seePp` ribbon, and the copy directs comparison across 3-month spans. |
| `getUserMedia` unavailable in the installed iOS PWA (`UNVERIFIED`) kills the ghost overlay | Path B (rule 35) keeps alignment help post-capture; nothing depends on the live preview. |
| `/body` blows its 135 KB gz budget once Recharts and the viewer land | Both are dynamic imports (Files to create); 16 rule 21 measures it on every run and rule 22 makes the failure hard. |

## Verification

```bash
npx vitest run tests/unit/body-trend-contract.test.ts tests/unit/body-rate.test.ts \
  tests/unit/body-validation.test.ts tests/unit/photos-keys.test.ts tests/unit/photos-sniff.test.ts \
  tests/unit/photos-signed-url.test.ts tests/unit/photos-prepare.test.ts
```

PASS = green, with these cases present (vectors from
[r09 §3–§4](../docs/research/r09-formulas-and-test-vectors.md)):

- `body-trend-contract` **"r09 §4 ten-day series"**: `buildDayTrends` over
  `82.0, 82.6, 81.8, 82.4, 83.1, 82.2, 81.9, 82.5, 82.0, 81.6` kg ⇒ `82.000000, 82.060000, 82.034000,
  82.070600, 82.173540, 82.176186, 82.148567, 82.183711, 82.165340, 82.108806` to 6 dp; **"seed equals
  first reading"**; **"gap-aware α (policy b)"** — day 11 missing, day 12 = 81.4 ⇒ `81.974133`, not
  `82.037925`; **"same-day rows are averaged before the EMA"** — 82.0 and 83.0 on one date behave as
  one 82.5 with `readingCount: 2`, and **`carrierRowId` is the `MAX(measuredAt)` row** (rule 11);
  **"outlier charted, trend unchanged"** — a 4 kg jump ⇒ `excluded: true`; **"an excluded day flags
  every row sharing that local_day"**; **"rows with null weightKg are dropped, not zeroed"**;
  **"a calc rejection returns null, never 0"**.
- `body-trend-contract` (Navy, r09 §3): **M1** `(male, h 178, neck 38, waist 85) ⇒ 16.4360`; **M2**
  `(male, 178, 40, 100) ⇒ 25.5011`; **F1** `(female, 165, 32, 72, hips 96) ⇒ 26.4059`; **F2**
  `(female, 165, 34, 88, hips 105) ⇒ 37.5517`, all to 4 dp; **"band is pct ∓ SEE clamped to 2..60"**;
  **"female without hips ⇒ ok:false, missing ['hipsCm']"**; **"waist ≤ neck ⇒ ok:false with
  reason geometry, never NaN"**; **"a result outside 2–60 pp ⇒ `{ ok:false, implausible:true }`, and
  it is distinguishable from bad input"** (amendment 07.1); **"no imperial constants"** — a source
  grep for `86.010` / `163.205` finds nothing; **"bodyfat-band.ts contains no `1.0324`/`1.29579`"** —
  the formula is not duplicated (rule 29).
- `body-rate`: **"high at 5 readings / 12 d"**, **"medium at 3 readings / 10 d"**, **"5 readings over
  11 d is medium, not none"** (the old tier hole), **"low at 2 readings / 8 d"**, **"none below 2
  readings ⇒ kgPerWeek === null and emptyReason.missing === 1 at one reading"**, **"none below span 7
  ⇒ emptyReason.kind === 'needSpan'"**, **"spanDays === 0 ⇒ none, no division"**, **"sign matches a
  falling trend"**, **"%BW/wk uses the current trend as denominator"**, **"the tiers are monotone"** —
  a property test over `readings ∈ [0,10] × span ∈ [0,20]` asserting confidence never decreases when
  either input increases.
- `body-validation`: **"25 and 300 kg pass; 24.9 and 300.1 fail"**, **"180 against trend 81.6 emits
  unitSlip"**, **"180 with reference null emits firstEntrySuspect"**, **"70 with reference null emits
  nothing"**, **"a 4.1 kg jump emits jump and still validates"**, **"L 41 / R 37 emits asymmetry"**,
  **"neck +4 emits jump but shoulder +4 does not"** (per-field `softDeltaCm`, rule 15),
  **"waist 500 rejected"**, **"values: { waistCm: null } is accepted and clears the column"**,
  **"hard failures are Zod issues, soft warnings are not"**.
- `photos-keys`: **"build → parse round-trip, all four variants incl. `ai`"**, **"`yyyy/mm` are split
  from the passed `localDate`, never re-derived"** (`localDate '2026-01-01'` with
  `takenAt 2025-12-31T21:00Z` ⇒ `2026/01`), **"rejects uppercase, `..`, spaces"**.
  `photos-sniff`: **"JPEG/WebP/PNG magic bytes"**, **"declared-type mismatch"**,
  **"hasEmbeddedMetadata: true on the JPEG APP1 fixture, false on the canvas-encoded JPEG"**,
  **"true on a WebP carrying a RIFF `EXIF` chunk and on one carrying `XMP `, false on the
  canvas-encoded WebP"**, **"true on a PNG with `eXIf` and on one with `tEXt`"**, **"an odd-sized
  RIFF chunk's pad byte does not desynchronise the walk"**.
  `photos-signed-url`: **"mint then verify with an injected key"**, **"expired by 1 s fails"**,
  **"tampered variant fails"**, **"tampered sig fails"**, **"no getCloudflareContext import"**.
  `photos-prepare`: **"1600 long edge keeps the aspect ratio, integer dims"**, **"never upscales a
  900 px source"**, **"contentType comes from blob.type"**, **"a PNG-returning encoder is re-encoded
  to JPEG, not queued as PNG"**.

```bash
npm run preview &                      # opennextjs-cloudflare build && preview → port 8787 (01 §Verification)
O=http://localhost:8787
# Mint a real session the documented way (04 rule 4/6: LoginBody = {password, totp}; over http the
# cookie is `fa_session`, NOT `__Host-fa_session` — `__Host-` mandates Secure and is dropped on http).
SESSION=$(curl -si -X POST $O/api/auth/login -H 'content-type: application/json' -H "origin: $O" \
  -d "{\"password\":\"$DEV_PASSWORD\",\"totp\":\"$(oathtool --totp -b "$DEV_TOTP_SECRET")\"}" \
  | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: fa_session=\([^;]*\).*/\1/p')
C="fa_session=$SESSION"; ID=01K4Z8Q2R7N3M5V9J1T6XY0BCD; F=tests/fixtures/display.jpg
SHA=$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$F")
H=(-H 'Content-Type: image/jpeg' -H "X-Photo-Id: $ID" -H 'X-Photo-Kind: progress'
   -H 'X-Photo-Pose: front' -H 'X-Photo-Taken-At: 1789221376000'
   -H 'X-Photo-Width: 1200' -H 'X-Photo-Height: 1600' -H "X-Photo-Sha256: $SHA")

# --- body measurements -------------------------------------------------------
curl -s -X POST $O/api/body/measurements -b "$C" -H 'content-type: application/json' \
  -d '{"id":"01K4Z8Q2R7N3M5V9J1T6XY0AAA","localDate":"2026-09-10","measuredAtMs":1789000000000,
       "weightKg":82.0,"values":{},"notes":null}' | tee /tmp/m1.json      # PASS 201, trendKg 82.0
curl -s -X POST $O/api/body/measurements -b "$C" -H 'content-type: application/json' \
  -d '{"id":"01K4Z8Q2R7N3M5V9J1T6XY0AAB","localDate":"2026-09-11","measuredAtMs":1789086400000,
       "weightKg":82.6,"values":{},"notes":null}' | tee /tmp/m2.json
node -e 'const t=require("/tmp/m2.json").trendKg;process.exit(Math.abs(t-82.06)<1e-9?0:1)'
echo "trend-r09=$?"                                            # PASS trend-r09=0 (r09 §4 vector)
curl -s "$O/api/body/series?from=2026-09-01&to=2026-09-30" -b "$C" \
  | node -e 'const s=JSON.parse(require("fs").readFileSync(0));
    process.exit(s.points.length===2 && s.points[1].readings.length===1
      && s.points[1].trendKg===82.06 && s.rate.confidence==="none" ? 0 : 1)'
echo "series=$?"                                               # PASS series=0 (stored trend, raw dots)
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -b "$C" \
  $O/api/body/measurements/01K4Z8Q2R7N3M5V9J1T6XY0AAB                            # PASS 204

# --- photo upload gates ------------------------------------------------------
curl -s -o /dev/null -w '%{http_code}\n' -X POST $O/api/photos -b "$C" "${H[@]}" \
  --data-binary @"$F"                                                            # PASS 201
curl -s -o /dev/null -w '%{http_code}\n' -X POST $O/api/photos -b "$C" "${H[@]}" \
  --data-binary @"$F"                                                            # PASS 200 (replay, NOT 409)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $O/api/photos -b "$C" "${H[@]}" \
  --data-binary @tests/fixtures/display-other.jpg                                # PASS 409 (same id, new sha)
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -b "$C" \
  -H 'Content-Type: image/jpeg' -H 'X-Photo-Width: 320' -H 'X-Photo-Height: 427' \
  -H "X-Photo-Sha256: $(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync("tests/fixtures/thumb.jpg")).digest("hex"))')" \
  --data-binary @tests/fixtures/thumb.jpg $O/api/photos/$ID/thumb                # PASS 200
curl -s -o /dev/null -w '%{http_code}\n' -X PUT -b "$C" -H 'Content-Type: image/jpeg' \
  --data-binary @tests/fixtures/thumb.jpg $O/api/photos/01K4Z8Q2R7N3M5V9J1T6XY0ZZZ/thumb
# PASS 202 — no row yet, the op must be re-queued, never killed (rule 45/48)
# 8 MiB gate measured on byteLength, so a chunked body with NO Content-Length must still 413:
curl -s -o /dev/null -w '%{http_code}\n' -X POST $O/api/photos -b "$C" "${H[@]}" \
  -H 'Transfer-Encoding: chunked' --data-binary @tests/fixtures/oversize-9mib.jpg # PASS 413
curl -s -o /dev/null -w '%{http_code}\n' -X POST $O/api/photos -b "$C" \
  -H 'Content-Type: image/webp' -H "X-Photo-Id: ${ID}2" -H 'X-Photo-Kind: progress' \
  -H 'X-Photo-Taken-At: 1789221376000' --data-binary @"$F"                       # PASS 415 (sniff ≠ declared)
for FX in exif-app1.jpg webp-exif-chunk.webp png-exif.png; do
  curl -s -o /dev/null -w "$FX %{http_code}\n" -X POST $O/api/photos -b "$C" \
    -H "Content-Type: $(node -e 'const m={jpg:"image/jpeg",webp:"image/webp",png:"image/png"};process.stdout.write(m[process.argv[1].split(".").pop()])' "$FX")" \
    -H "X-Photo-Id: ${ID}3" -H 'X-Photo-Kind: progress' -H 'X-Photo-Taken-At: 1789221376000' \
    --data-binary @tests/fixtures/$FX; done
# PASS: exif-app1.jpg 422 · webp-exif-chunk.webp 422 · png-exif.png 415 (PNG never reaches the wire)

# --- photo reads, headers, cache boundary -----------------------------------
curl -s -o /dev/null -w '%{http_code}\n' $O/api/photos/$ID/display                         # PASS 401
curl -s -b "$C" $O/api/photos/$ID | grep -o '"localDate":"[0-9-]*"'   # PASS metadata JSON, not bytes
ETAG=$(curl -sD - -o /dev/null -b "$C" $O/api/photos/$ID/display | tr -d '\r' \
  | awk 'tolower($1)=="etag:"{print $2}')
curl -s -o /dev/null -w '%{http_code}\n' -b "$C" -H "If-None-Match: $ETAG" \
  $O/api/photos/$ID/display                                          # PASS 304, not 412
curl -sD - -o /dev/null -b "$C" -H 'Range: bytes=0-99' $O/api/photos/$ID/display \
  | grep -iE 'HTTP/|content-range|cache-control'
# PASS: 206 · Content-Range ends "/<full object size>" · Cache-Control has "private", never "public"
curl -s -o /tmp/dl.jpg -b "$C" $O/api/photos/$ID/display
node -e 'const b=require("fs").readFileSync("/tmp/dl.jpg");process.exit(b.includes(Buffer.from("Exif\0\0","binary"))?1:0)'
echo "exif-free=$?"                                                  # PASS exif-free=0

# --- signed share URL: mint → fetch → expire → soft-delete ------------------
SU=$(curl -s -X POST $O/api/photos/$ID/sign -b "$C" -H 'content-type: application/json' \
  -d '{"variant":"display"}' | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).url)')
case "$SU" in *"/api/photo-share/"*) echo PASS ;; *) echo "FAIL signed URL must not sit under /api/photos/" ;; esac
curl -s -o /dev/null -w '%{http_code}\n' "$SU"                       # PASS 200 without a cookie
curl -s -o /dev/null -w '%{http_code}\n' "$(printf '%s' "$SU" | sed 's/exp=[0-9]*/exp=1000000000/')"
                                                                     # PASS 403 (expired / bad sig)
curl -s -o /dev/null -w '%{http_code}\n' "${SU%sig=*}sig=AAAA"       # PASS 403 (tampered sig)

# --- delete, then the sweep via the REAL cron job id ------------------------
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -b "$C" $O/api/photos/$ID      # PASS 204
curl -s -o /dev/null -w '%{http_code}\n' "$SU"                       # PASS 404 (signed read of a deleted row)
npx wrangler r2 object get fitness-photos/photos/progress/2026/09/$ID/display.jpg --local \
  --file /tmp/still-there.jpg        # PASS: succeeds — DELETE must not touch R2 (spec 02 rule 26)
# The manual cron trigger is POST /api/cron/[job] guarded by x-cron-secret, 404 on any mismatch
# (01 rules 26, L54). A session cookie is NOT a credential here. `photo-gc` runs inside backup-to-r2
# (amendment 14.1), so that is the job id to trigger:
curl -s -o /dev/null -w '%{http_code}\n' -X POST $O/api/cron/backup-to-r2          # PASS 404 (no secret)
curl -s -X POST $O/api/cron/backup-to-r2 -H "x-cron-secret: $CRON_SECRET" | tee /tmp/gc.json  # PASS 200
npx wrangler d1 execute fitness-db --local --command \
  "select deleted_at is not null d, r2_purged_at is not null p from photos where id='$ID'"  # PASS d=1 p=1
npx wrangler r2 object get fitness-photos/photos/progress/2026/09/$ID/display.jpg --local \
  --file /tmp/gone.jpg               # PASS: fails / object does not exist

# --- orphan reconciliation: an object with no row must be counted and removed
npx wrangler r2 object put "fitness-photos/photos/food/2026/09/01K4ORPHAN0000000000000000/display.jpg" \
  --local --file "$F" --content-type image/jpeg
curl -s -X POST $O/api/cron/backup-to-r2 -H "x-cron-secret: $CRON_SECRET" \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0));process.exit(r.orphanObjects>=1?0:1)'
echo "orphans=$?"                                                    # PASS orphans=0 (a non-zero count logged)
npx wrangler r2 object get "fitness-photos/photos/food/2026/09/01K4ORPHAN0000000000000000/display.jpg" \
  --local --file /tmp/orphan.jpg     # PASS: fails — the food prefix is reconciled too, not just progress

npx playwright test tests/e2e/body-photos.spec.ts
grep -rn "86.010\|163.205" src/ && echo FAIL || echo PASS
grep -rn "1.0324\|1.29579" src/lib/body src/server/body && echo FAIL || echo PASS  # no second Navy impl
grep -rn "Cache-Control.*public" src/app/api/photos src/app/api/photo-share && echo FAIL || echo PASS
grep -rn "r2\.dev\|presign" src/ && echo FAIL || echo PASS
grep -rn "local_date" src/lib/body src/server/body src/lib/photos src/server/photos && echo FAIL || echo PASS
grep -rn "trend-series" src/components src/app/\(app\) && echo FAIL || echo PASS   # server-only (rule 9)
```

Playwright PASS = **"weigh-in is two taps from the dashboard and the card shows the trend, not the
reading"**; **"two weigh-ins on one date average into one trend point and only one row carries
`trend_kg`"**; **"backfilling yesterday rewrites today's trend"**; **"the rate hides at one reading
with 'Need 1 more weigh-in', appears at two"**; **"the same day shows the same trend value at the 1 m
and All presets"**; **"the BF card lists the missing measurement and shows no number"**; **"BF renders
16.4 % ±3–4 for the M1 fixture and announces 'plus or minus 3 to 4 percentage points'"**; **"the
excluded dot is hollow, not translucent, and passes a 3:1 contrast probe"**; **"/body renders the
trend, rate and BF card with the network offline, from the mirror, and shows the 'as of' line"**;
**"capture offline queues the photo, the timeline renders it from the local blob with a pending badge,
reconnect uploads it and the badge clears"**; **"a thumb PUT that arrives before its display 202s and
the op returns to pending, not dead"**; **"an EXIF-orientation-6 fixture renders portrait in
compare"**; **"the compare slider responds to ArrowLeft/ArrowRight and exposes aria-valuetext"**;
**"opacity mode keeps the same A/B pair"**; **"a signed share URL fetched twice hits the network both
times — it is never in r2-photos"**; **"delete confirms with pose and date, the tile disappears, and
an offline reload does not serve any of the three variant URLs from r2-photos"**.

## Open questions

1. **Keep the 2560 px `orig` variant?** (a) Keep — future sizes stay re-derivable and spec 15's
   quarterly archive means something. Storage, with the arithmetic shown rather than asserted: at
   `display ≈ 250 KB`, `thumb ≈ 25 KB`, `orig ≈ 700 KB` (≈ 0.98 MB/photo — **UNVERIFIED**, these are
   estimates for 1600/320/2560 px re-encodes at our quality settings and real bytes depend entirely on
   image content), 6 photos/week × 52 ≈ 312 photos/year ⇒ **≈ 0.3 GB/year**, comfortably inside R2's
   10 GB-month free storage tier. (The previous "≈1 GB/year" figure was unsourced and about 3× too
   high.) (b) Drop — `display` + `thumb` only, ~75 % less storage, but a new size later means
   re-shooting. **Recommend (a)**; the measurement to settle it is the mean `photos.bytes` per variant
   after the first month, which we already store.
2. **Any undo window on photo delete?** (a) Soft-delete hides it instantly and the 23:00 `photo-gc`
   step removes the bytes (rules 62–66) — the strongest privacy story for sensitive images, and the
   copy says "within the day". (b) Hold the sweep for 24 h and show an Undo entry in settings —
   survives a fat-finger, but the bytes outlive the user's intent. **Recommend (a).**
3. **Do progress photos belong in the weekly Telegram report?** (a) Never send image bytes to
   Telegram; the report links back into the app. (b) Send the latest `thumb` on explicit per-report
   opt-in. **Recommend (a)** — Telegram is a third party and its chat history sits outside our delete
   path.
4. **Does the weigh-in sheet also expose waist?** (a) Weight only — the fastest daily loop; tape lives
   on its own page. (b) Weight + waist, since waist is the one tape number worth a weekly cadence and
   it unlocks Navy BF. **Recommend (a)**, with an "+ Add measurements" link in the sheet footer.
5. **When does `settings.unit_system` reach this module?** v1 ignores it (Scope): everything here is
   kg/cm, and `LB_PER_KG` is only the typo heuristic. (a) Leave it — the owner's locale is metric, and
   a display conversion doubles every threshold, warning string and axis test. (b) Honour it in the
   weigh-in sheet, the rate badge and the measurement form in a later phase, converting at the render
   boundary only and never at rest (02 L167: "display intent; storage is kg"). **Recommend (a) for
   v1**, and this is the spec that must change when (b) is wanted — not 03 and not 12.
6. **`photos.csv` column spelling.** Rule 68 emits `local_day`, the real column name (02 rule 5);
   15's three example headers spell the analogous column `local_date`. Since 15 generates headers from
   the schema (`src/lib/export/headers.ts`, pinned by `golden-headers.txt`), exactly one spelling can
   survive. (a) Generated names win everywhere ⇒ `local_day`, and 15's examples are corrected.
   (b) Exports keep a stable `local_date` alias for every `_day` column ⇒ one documented rename map in
   15. **Recommend (a)** — it is the cheaper invariant and the importer already round-trips whatever
   the generator emits. 15 owns the decision; this spec follows it.
