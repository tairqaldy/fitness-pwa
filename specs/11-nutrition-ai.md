# 11 — Nutrition logging, food-photo AI pipeline and adaptive TDEE

## Purpose

Implements brief §"Feature modules → 5 NUTRITION & FOOD PHOTO AI" and the acceptance line "Food photo
to multi-item macros with confidence, user edits, saved; barcode works". Owns the single AI provider
abstraction the whole app calls through (`getVisionModel()`/`getTextModel()`, with **no provider SDK
imported anywhere else**), the photo → estimate → correction → save loop, barcode and
natural-language logging, daily kcal/macro targets, water, fasting, templates, the micronutrient
allow-list and the day view. Every AI call is priced and logged to `ai_prompt_logs`.

It deliberately owns **none** of the adaptive-TDEE arithmetic and **none** of its scheduling. Its
whole TDEE contribution is one contract: turn logged intake plus the persisted weight trend into the
`TdeeInput` that `specs/07-calculators.md`'s `adaptiveTdee()` consumes, and render the `TdeeStatus`
that function returns. The job that calls it is the Monday-gated `tdee-recompute` step inside spec
14's `weekly-review` cron.

## Scope

In scope: `src/lib/ai/*` (provider abstraction, pinned model ids, cost accounting, monthly spend cap,
`ai_prompt_logs` writer, all versioned prompt text — the only place allowed to import `ai` or
`@ai-sdk/*`); the food-photo pipeline; barcode scan plus the r08 lookup precedence chain with its
KV/D1 cache and per-100 g ↔ per-serving normalisation, online and offline; natural-language logging;
daily kcal/macro targets; `buildTdeeWindow()`/`buildTdeeInput()` and the TDEE card's RU copy per
status; water, fasting timer, meal templates/favourites/recents, the micronutrient allow-list, and
the day view.

### Out of scope

| Excluded | Owner |
|---|---|
| Canonical DDL, migrations, Drizzle conventions, `local_day` helpers | `specs/02-data-model.md` |
| `mifflinStJeor`, `katchMcArdle`, `trendWeight`, `ENERGY_DENSITY_KCAL_PER_KG`, `TDEE_*`, `tdeeFromEnergyBalance`, `adaptiveTdee`, `TdeeStatus` and every guard threshold | `specs/07-calculators.md` |
| `photos` table, `photoKey()`/`parsePhotoKey()`, `PhotoVariant`, `prepareVariants()`, `POST /api/photos`, `PUT /api/photos/[id]/[variant]`, the R2 GC sweep | `specs/10-body-photos.md` |
| Cron registration, the Monday `tdee-recompute` step, `weekly-review` delivery, coach prose | `specs/14-ai-coach-and-notifications.md` |
| Dexie schema (`mirror`/`outbox`/`blobs`/`meta`), `OP_TYPES`, `writeLocal()`, flush mechanics, the Serwist precache manifest | `specs/05-pwa-offline-sync.md` |
| Macro rings, calorie charts, dashboard composition | `specs/12-analytics-dashboard.md` |
| The rate-limit primitive (`checkRateLimit()`, the `ratelimits` bindings), the env/secret inventory, CSP | `specs/01-architecture.md` |
| Route auth (`requireSessionOr401()`), the HMAC/session secret helpers | `specs/04-auth.md` |
| MFP/CSV import, nutrition export | `specs/15-data-portability.md` |
| Sheet/ring/haptic primitives, colour tokens | `specs/03-design-system.md` |
| Vitest/Playwright config, CI wiring | `specs/16-testing-ci-quality.md` |

## Files to create

**Dependencies to add** (exact pins from `docs/research/stack-facts.md`; none is in `package.json`
today). ULID needs no package: `src/lib/ids.ts` already ships a dependency-free 26-char Crockford
implementation over `crypto.getRandomValues` (verified present) and is the only id source.

| Package | Version | Side |
|---|---|---|
| `ai` | `7.0.99` | server only, `src/lib/ai/**` only |
| `@ai-sdk/google` | `4.0.69` | server only, `src/lib/ai/**` only |
| `zxing-wasm` | `3.1.4` | **client only**, dynamically imported (`/reader` entry, never `full`) |
| `@ai-sdk/anthropic` / `@ai-sdk/openai` | `4.0.53` / `4.0.66` | server only, optional — install only if `AI_PROVIDER` changes |

`dexie@4.4.6` is installed by spec 05, not here. `zod@4.6.2` is already installed.

| Path | Responsibility |
|---|---|
| `src/lib/ai/provider.ts` | `getVisionModel(env, tier)`/`getTextModel(env, tier)`; `AI_PROVIDER` switch; pinned ids + prices. **Only file importing `ai`/`@ai-sdk/*`.** |
| `src/lib/ai/call.ts` | `callStructured(ctx, args)` — the one `generateObject` wrapper: timeout, our own retry, cost, logging, budget gate, error mapping. |
| `src/lib/ai/cost.ts` · `log.ts` | Pricing + spend tier; `writeAiPromptLog(ctx, row)` → D1 (+ R2 spill). |
| `src/lib/ai/schema-wire.ts` | `toWireSchema(schema)` — the JSON Schema the SDK actually hands the provider; exists so §Verification can assert on the transmitted artefact. |
| `src/lib/ai/prompts/food-photo.ts` · `food-text.ts` | Versioned prompt text + `*_PROMPT_VERSION`. Text only, zero imports. |
| `src/lib/nutrition/schemas.ts` | Zod for both AI calls + the save payload. Union-, record- and nullable-free. |
| `src/lib/nutrition/normalize.ts` · `delta.ts` | `normalizeEstimate()` (clamp, repair, Atwater check, `itemUid`, confidence caps); `correctionDelta()`/`aggregateBias()`. Pure. |
| `src/lib/nutrition/basis.ts` · `gtin.ts` | per-100 ↔ per-serving conversion; `normalizeGtin()`/`upcEtoUpcA()`/`gtinCheckDigitOk()`/`fdcGtinCandidates()`. Pure. |
| `src/lib/nutrition/off.ts` · `fdc.ts` | `mapOff()`/`OFF_FIELDS`/`offStatus()`; `fdcMacros()`/`flattenFdcNutrients()`. Pure. |
| `src/lib/nutrition/targets.ts` · `tdee-window.ts` · `micros.ts` | `dailyTargets()`; `buildTdeeWindow()`/`buildTdeeInput()`/`tdeeCardCopy()`; `MICRO_ALLOWLIST`. Pure. |
| `src/lib/nutrition/correction-token.ts` | `mintCorrectionToken()`/`verifyCorrectionToken()` — HMAC-SHA256 over `aiLogId\|photoId\|exp`; key injected, never read from `env` here (spec 10's `signed-url.ts` pattern). |
| `src/lib/barcode/detector.ts` · `camera.ts` | `createScanner()` with lazy `zxing-wasm/reader` fallback; `openRearCamera()`/`setTorch()`/`setZoom()`. |
| `src/lib/image/ai-input.ts` · `src/types/media.d.ts` | `prepareAiInput()` (1024 px JPEG); `torch`/`zoom` augmentations for `MediaTrack*`. |
| `src/server/nutrition/photo-pipeline.ts` | Budget → R2 put of the AI input → one AI call → normalize → log. Takes `ctx` first. |
| `src/server/nutrition/resolve.ts` · `entries.ts` · `tdee.ts` · `spend.ts` | Precedence chain; save with raw+corrected snapshots; intake+trend reader that builds `TdeeInput` for spec 14's step; spend rollup. All take `ctx` first. |
| `src/app/api/nutrition/{estimate-photo,parse-text,resolve,entries,water,fast,tdee}/route.ts` | Route handlers (§Interfaces, §Behaviour). |
| `src/app/(app)/nutrition/{page,[date]/page,scan/page}.tsx` | Redirect to today; day view; full-bleed scanner. |
| `src/components/nutrition/CorrectionSheet.tsx` | The editable multi-item loop; blocks save until touched-or-confirmed. |
| `src/components/nutrition/{CaptureSheet,ConfidenceBadge,QuantityField,FoodSourceChip}.tsx` | Capture+downscale+reference hint; `≈`/confidence; grams⇄servings; source chip. |
| `src/components/nutrition/{WaterCard,FastingCard,MacroTotals,MealSlot,TemplatePicker,TdeeCard}.tsx` | Day-view pieces. |
| `src/db/schema/nutrition.ts` | Drizzle definitions for the §Data tables (shapes owned by spec 02; edited **by** spec 02's migration, not by us). |
| `scripts/copy-zxing-wasm.mjs` | Copies `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` → `public/wasm/`; wired as `prebuild`/`predev` in `package.json` so the file is never a committed binary. |
| `tests/unit/nutrition/{gtin,basis,off,fdc,normalize,delta,targets,tdee-window,schemas,resolve}.test.ts` | Vectors (§Verification). |
| `tests/unit/ai/{cost,provider,call,schema-wire}.test.ts` · `tests/e2e/nutrition-photo.spec.ts` | Pricing + pinned ids + error mapping + wire schema; photo→correction→save with the AI route stubbed. |
| `tests/fixtures/nutrition-seed.sql` | Deterministic rows for §Verification queries 9 and 10. |
| `public/wasm/zxing_reader.wasm` | Generated by the script above (gitignored); Serwist-precached (r08 §5.5, G17) — see Open question 5. |

## Interfaces

```ts
// src/lib/ai/provider.ts — the ONLY file importing `ai` / `@ai-sdk/*`
import type { LanguageModel } from "ai";
export type AiProviderName = "google" | "anthropic" | "openai";
export type AiRole = "vision" | "text";
export type AiTier = "primary" | "cheap";
/** USD per 1,000,000 tokens. Source: docs/research/stack-facts.md §"Gemini model IDs + price". */
export interface ModelPricing { readonly inPerMTok: number; readonly outPerMTok: number }
export interface PinnedModel { readonly id: string; readonly pricing: ModelPricing }
/** Pinned ids only — never `gemini-flash-latest` / `gemini-flash-lite-latest`. */
export const AI_MODELS: { readonly google: Record<AiRole, Record<AiTier, PinnedModel>> } = {
  google: {
    vision: { primary: { id: "gemini-3.5-flash-lite", pricing: { inPerMTok: 0.30, outPerMTok: 2.50 } },
              cheap:   { id: "gemini-2.5-flash-lite", pricing: { inPerMTok: 0.10, outPerMTok: 0.40 } } },
    text:   { primary: { id: "gemini-2.5-flash-lite", pricing: { inPerMTok: 0.10, outPerMTok: 0.40 } },
              cheap:   { id: "gemini-2.5-flash-lite", pricing: { inPerMTok: 0.10, outPerMTok: 0.40 } } },
  },
} as const;

/** The bindings + secrets this module reads. Threaded explicitly — NOTHING under `src/lib/ai/**`
 *  or `src/server/nutrition/**` may call `getCloudflareContext()`: r01 §4.2 names "the AI provider
 *  module" as the exact hazard, and `AiFeature` includes `coach_weekly`, which runs from
 *  `scheduled()` where that call throws in both sync and async modes (r01 §2.4, r02 §2.3). */
export interface NutritionEnv {
  readonly AI_PROVIDER: string;
  readonly GOOGLE_GENERATIVE_AI_API_KEY: string;
  readonly AI_MODEL_VISION?: string; readonly AI_MODEL_TEXT?: string;
  readonly AI_PRICE_IN_PER_MTOK?: string; readonly AI_PRICE_OUT_PER_MTOK?: string;
  readonly ANTHROPIC_API_KEY?: string; readonly OPENAI_API_KEY?: string;
  readonly FDC_API_KEY?: string;
  readonly AI_MONTHLY_BUDGET_USD?: string;
  readonly AI_CORRECTION_SIGNING_KEY: string;   // new secret — Open question 4
  readonly NUTRITION_CACHE: KVNamespace; readonly MEDIA: R2Bucket;
  readonly AI_LIMITER: { limit(o: { key: string }): Promise<{ success: boolean }> };  // spec 01
}
export interface NutritionCtx { readonly env: NutritionEnv; readonly db: DB; readonly nowMs: number }

export function getVisionModel(env: NutritionEnv, t?: AiTier):
  { model: LanguageModel; pinned: PinnedModel; provider: AiProviderName };
export function getTextModel(env: NutritionEnv, t?: AiTier):
  { model: LanguageModel; pinned: PinnedModel; provider: AiProviderName };
/** Gemini's OpenAPI-3.0 subset rejects unions/records (stack-facts §"AI SDK v7"). */
export const GOOGLE_PROVIDER_OPTIONS: { google: { structuredOutputs: true } };

// src/lib/ai/call.ts + cost.ts + schema-wire.ts
export type AiFeature = "food_photo" | "food_text" | "food_resolve" | "coach_weekly"; // → logs.feature
export type AiOutcome = "ok" | "not_food" | "refused" | "invalid_output" | "timeout"
  | "rate_limited" | "upstream" | "blocked" | "rejected";                             // → logs.outcome
export type AiFailure =
  | { kind: "budget_exhausted"; spentUsd: number; capUsd: number; resetsAt: number /* epoch-ms */ }
  | { kind: "timeout"; ms: number } | { kind: "refused"; finishReason: "content-filter" }
  | { kind: "invalid_output"; rawText: string | null } | { kind: "rate_limited"; retryAfterS: number }
  | { kind: "upstream"; status: number | null; message: string };
export interface CallStructuredArgs<T> {
  feature: AiFeature; role: AiRole; schema: import("zod").ZodType<T>; schemaName: string;
  promptVersion: string;                                  // "food_photo@1"
  /** `generateObject`'s system-prompt option in ai@7 is `instructions`: v7 renamed `system` →
   *  `instructions` for generateText/streamText/generateObject/streamObject/streamUI, keeping
   *  `system` as a deprecated fallback with `instructions` winning when both are passed
   *  (verified 2026-09-12, ai-sdk.dev/docs/migration-guides/migration-guide-7-0). */
  instructions: string; userText: string; locale: "ru" | "en";
  image?: { bytes: Uint8Array; mediaType: "image/jpeg" };  // exactly the bytes sent to the model
  inputRef: string;                                       // R2 key, or "sha256:<hex>" for text
  /** ms; default 20_000 vision / 12_000 text. `generateObject` has NO `timeout` option in ai@7 — its
   *  options are `Omit<RequestOptions,'timeout'>` (verified ai@7.0.99 d.ts:7730) — so this becomes
   *  `abortSignal: AbortSignal.timeout(ms)`, the only timeout mechanism available. */
  timeoutMs?: number;
  attempts?: number;                                      // OUR retries, default 2 (Behaviour 7)
}
/** Shared fields exist on BOTH branches: a failure that reached the model still spent tokens, and
 *  rule 48 requires a cost on every row (Behaviour 6). */
export interface CallStructuredBase {
  logId: string; modelId: string; provider: AiProviderName; promptVersion: string;
  attempt: number; inputTokens: number; outputTokens: number; tokensMissing: boolean;
  costUsd: number;                     // ALWAYS a number; 0 when no model call happened
  latencyMs: number; degraded: boolean; outcome: AiOutcome;
}
export type CallStructuredResult<T> =
  | ({ ok: true; object: T } & CallStructuredBase)
  | ({ ok: false; error: AiFailure } & CallStructuredBase);
export function callStructured<T>(ctx: NutritionCtx, a: CallStructuredArgs<T>): Promise<CallStructuredResult<T>>;
/** usage fields are `number | undefined` in ai@7 (d.ts:320). Sums the two products, THEN divides
 *  once by 1e6 (Behaviour 6). Returns unrounded USD. */
export function estimateCostUsd(u: { inputTokens: number|undefined; outputTokens: number|undefined }, p: ModelPricing): number;
export function monthToDateSpendUsd(ctx: NutritionCtx, monthLocal: string /* "2026-09", Asia/Almaty */): Promise<number>;
export function budgetTier(spentUsd: number, capUsd: number): "ok"|"warn"|"degrade"|"blocked";
/** The JSON Schema the SDK hands the provider — `zodSchema(s).jsonSchema`. Behaviour 14 + Verification. */
export function toWireSchema(s: import("zod").ZodType<unknown>): unknown;
```

```ts
// src/lib/nutrition/schemas.ts — union-free, record-free, NULLABLE-free (Behaviour 14)
import { z } from "zod";
export const CookingMethod = z.enum(["unknown","raw","boiled","steamed","grilled","baked","fried","deep_fried"]);
export const SizeReference = z.enum(["none","utensil","hand","plate_known","coin_or_card","packaging","other"]);
export const RejectReason  = z.enum(["none","not_food","unreadable","no_food_visible","other"]);
export const FoodItemEstimateSchema = z.object({
  name: z.string(),                                 // in the request locale
  name_en: z.string(),                              // canonical English for DB lookup; "" when unsure
  portion_text: z.string(),                         // human-readable, e.g. "2 ломтика"
  grams: z.number(),                                // edible mass of THIS portion, grams
  grams_low: z.number(), grams_high: z.number(),
  cooking_method: CookingMethod,
  kcal: z.number(),                                 // FOR THE PORTION, not per 100 g
  protein_g: z.number(), carb_g: z.number(), fat_g: z.number(),
  confidence: z.number(),                           // 0..1; deliberately unconstrained — Behaviour 14
  assumptions: z.string(),
});
/** ONE schema serves both producers (Behaviour 34). The text prompt is told to set
 *  `size_reference:"none"` and `size_reference_missing:true`; `normalizeEstimate` takes the mode so
 *  the no-reference confidence cap applies to photos only. */
export const FoodEstimateSchema = z.object({
  is_food: z.boolean(), reject_reason: RejectReason, meal_label: z.string(),
  items: z.array(FoodItemEstimateSchema),
  size_reference: SizeReference, size_reference_missing: z.boolean(),
  overall_confidence: z.number(), total_kcal: z.number(), notes: z.string(),
});
export const FoodPhotoEstimateSchema = FoodEstimateSchema;   // schemaName "FoodPhotoEstimate"
export const FoodTextEstimateSchema  = FoodEstimateSchema;   // schemaName "FoodTextEstimate"
export type FoodItemEstimate = z.infer<typeof FoodItemEstimateSchema>;
export type FoodEstimate = z.infer<typeof FoodEstimateSchema>;
```

```ts
// normalize.ts + delta.ts
export type EstimateMode = "photo" | "text";
export interface NormalizedItem extends FoodItemEstimate { itemUid: string /* ULID */ }
export interface NormalizedEstimate { items: NormalizedItem[];
  totalKcal: number /* recomputed; the model's own total is never displayed */;
  overallConfidence: number /* 0..1 after clamp + caps */; sizeReferenceMissing: boolean; repairs: string[] }
export function normalizeEstimate(raw: FoodEstimate, mode: EstimateMode): NormalizedEstimate;
/** Unrounded in-memory totals. The persisted snapshot columns are INTEGER (02 rule 8c): rounding
 *  happens exactly once, round-half-up, at save (Behaviour 20a). */
export interface MealTotals { kcal: number; proteinG: number; carbG: number; fatG: number; grams: number }
export interface CorrectionDelta {
  aiKcal: number; correctedKcal: number;   // both the ROUNDED integers actually persisted
  deltaKcal: number;              // corrected − ai; positive ⇒ the model under-estimated
  deltaPct: number | null;        // deltaKcal / aiKcal; null when aiKcal === 0
  deltaGramsPct: number | null;   // null when aiGrams === 0
  itemsAdded: number; itemsRemoved: number; itemsEdited: number; itemsUntouched: number;
  kind: "unchanged"|"edited"|"items_added"|"items_removed"|"mixed"|"rejected";
}
export function correctionDelta(ai: NormalizedEstimate, corrected: MealTotals & { itemUids: string[] }): CorrectionDelta;
/** `slopeVsGrams`/`interceptPct` are the ordinary-least-squares fit of y = `deltaPct` on
 *  x = `correctedGrams` (slope units: 1/g), over rows with a non-null `deltaPct`. `null` when
 *  `n < 3` or x has zero variance. NOT the literature's bias slope — see Behaviour 22. */
export interface BiasReport { n: number; meanSignedPct: number; mapePct: number;
  slopeVsGrams: number | null; interceptPct: number | null;
  byPromptVersion: { promptVersion: string; modelId: string; n: number; meanSignedPct: number }[] }
export function aggregateBias(rows: { promptVersion: string; modelId: string; delta: CorrectionDelta; correctedGrams: number }[]): BiasReport;

// basis.ts + gtin.ts + server/nutrition/resolve.ts — units are load-bearing
export type Basis = "100g" | "100ml";
export interface Per100 { basis: Basis;
  kcal: number|null; proteinG: number|null; carbG: number|null; fatG: number|null;
  fiberG: number|null; sugarG: number|null; satFatG: number|null; sodiumMg: number|null;
  calciumMg: number|null; ironMg: number|null; potassiumMg: number|null;   // Behaviour 46
  servingGrams: number|null;      // null when the product declares no serving size
  servingLabel: string|null }
/** `quantity` is in the food's OWN basis unit: grams for "100g", millilitres for "100ml".
 *  Evaluation order is fixed: `value * quantity / 100` — multiply THEN divide (Behaviour 31). */
export function scaleFromPer100(p: Per100, quantity: number): MealTotals;
export function servingsToQuantity(p: Per100, servings: number): number;   // throws if servingGrams === null
export function quantityToServings(p: Per100, quantity: number): number | null;
/** The ONLY legal upward conversion: label per-serving → per-100. `servingGrams` must be > 0. */
export function per100FromServing(ps: { kcal: number|null; proteinG: number|null; carbG: number|null; fatG: number|null }, servingGrams: number, basis: Basis): Per100;
export function normalizeGtin(raw: string): string | null;    // 8→as-is, 12→"0"+d, 13/14→as-is, 7→UPC-E expand
export function gtinCheckDigitOk(gtin: string): boolean;      // GS1 mod-10
export function fdcGtinCandidates(gtin13: string): string[];  // padded AND unpadded — r08 G8
export type FoodSource = "user"|"off"|"fdc"|"ai";             // = FOOD_SOURCES (spec 02)
export type EnergySource = "208"|"958"|"957"|"268"|"computed"|"off-kcal"|"off-kj"|"ai";
export interface ResolvedFood { foodId: string|null; barcode: string|null;
  /** persists to `foods.source_id` (spec 02: "gtin13 | fdcId"); there is no `fdc_id` column. */
  sourceId: string|null; fdcId: number|null;
  name: string; brand: string|null; per100: Per100; source: FoodSource;
  verifiedByUser: boolean;        // spec 02's column; precedence step 0 (Behaviour 27)
  fetchedAt: number /* epoch-ms */; confidence: number; energySource: EnergySource; stale: boolean }
export function resolveByBarcode(ctx: NutritionCtx, rawScan: string):
  Promise<{ hit: ResolvedFood|null; reason: "found"|"invalid_gtin"|"not_found"|"upstream_down" }>;
export function resolveByQuery(ctx: NutritionCtx, q: string, limit?: number): Promise<ResolvedFood[]>;

// targets.ts + tdee-window.ts — ASSEMBLY ONLY; every formula constant is spec 07's
export interface TargetInput { tdeeKcal: number;
  goalRateKgPerWeek: number;      // clamped [−1.0, +0.5]
  trendWeightKg: number;          // trend, never a raw scale reading
  proteinGPerKg: number;          // settings.protein_g_per_kg, clamped 1.6…2.2
  minFatGPerKg: number;           // settings.min_fat_g_per_kg; READ, never a literal (Behaviour 37)
  priorRmrKcal: number }          // for the floor
export interface DailyTargets { kcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number;
  waterMl: number; derivedFrom: "prior"|"blended"; floored: boolean }
export function dailyTargets(i: TargetInput, derivedFrom: "prior"|"blended"): DailyTargets;

export interface IntakeDay { localDay: string /* 'YYYY-MM-DD' Asia/Almaty */;
  kcal: number | null /* null = nothing confirmed was logged that day */ }
export interface TdeeWindow {
  windowDays: 28;                 // TDEE_WINDOW_DAYS (spec 07)
  loggedDays: number;             // days with >= 1 confirmed entry
  completeDays: number;           // Behaviour 39(a) — never counts an unlogged day
  medianIntakeKcal: number | null;// over LOGGED days only; null when loggedDays === 0
  meanIntakeKcal: number | null;  // over COMPLETE days only
  weighIns: number;
  trendStartKg: number|null; trendEndKg: number|null;  // real trend points at the complete-day anchors
  spanDays: number;               // inclusive calendar days between those two anchors; 0 when either is null
}
export function buildTdeeWindow(intake: IntakeDay[],
  trend: { localDay: string; trendKg: number; excluded: boolean }[], endDayLocal: string): TdeeWindow;
/** The whole TDEE surface this module owns: spec 07 does the arithmetic and owns `TdeeStatus`.
 *  `spanDays` is passed through because Δtrend and the divisor must cover the same period — see
 *  Behaviour 39(b) and Open question 2. */
export function buildTdeeInput(w: TdeeWindow, p: {
  nowMs: number; priorKcal: number|null; lastEstimateKcal: number|null; bodyWeightKg: number|null;
}): import("@/lib/calc/tdee").TdeeInput & { spanDays: number };
/** RU copy per spec-07 status. The ONLY status ladder in this module — there is no second one. */
export function tdeeCardCopy(s: import("@/lib/calc/tdee").TdeeStatus, w: TdeeWindow):
  { headline: string; detail: string; showsNumber: boolean; numberIsMeasurement: boolean };
```

## Behaviour

**AI provider abstraction**

1. `AI_PROVIDER` (a `wrangler.jsonc` **var**, already `"google"`) is the single authority for which
   provider is active. `settings.ai_provider` (spec 02) is **display-only** — it shows the active
   provider in Settings and is never read by `getVisionModel()`/`getTextModel()`; "swappable by env
   change alone" (brief) wins over "editable in Settings". Ids are compile-time constants from
   `AI_MODELS`, and all four are members of `@ai-sdk/google@4.0.69`'s own `GoogleModelId` union
   (verified, `dist/index.d.ts:17`).
2. **The API key is constructed, never inherited.** `provider.ts` calls
   `createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })` (factory name and the
   `apiKey` option verified on ai-sdk.dev's Google provider page, 2026-09-12) rather than using the
   package-default instance, which reads `process.env.GOOGLE_GENERATIVE_AI_API_KEY` — a value
   OpenNext populates per-isolate from whichever request arrived first (r01 §4.3) and which does not
   exist at all inside `scheduled()`. `GOOGLE_GENERATIVE_AI_API_KEY` and `FDC_API_KEY` are Worker
   **secrets**, both already in spec 01's env-var contract.
3. Missing configuration throws **on first use inside a request or job**, never "at boot": a
   module-scope `env` read throws on workerd (r02 §1, "Module top level ⇒ throws") and would take
   down every route, including the ones that need no AI. `getVisionModel()` throws
   `AppError("internal", …, { details: { reason: "ai_config_missing", missing: [...] } })`. For
   `"anthropic"`/`"openai"` the id **and both prices** are owner-supplied env (`AI_MODEL_VISION`,
   `AI_MODEL_TEXT`, `AI_PRICE_IN_PER_MTOK`, `AI_PRICE_OUT_PER_MTOK`); `stack-facts.md` pins no
   Anthropic/OpenAI id and this spec invents none. Spec 01's table still says "throws at boot" — see
   Open question 4.
4. Isolation is enforced by an ESLint `no-restricted-imports` rule banning `ai` and `@ai-sdk/*`
   outside `src/lib/ai/**`, by a second rule banning `@opennextjs/cloudflare` anywhere under
   `src/lib/ai/**` or `src/server/nutrition/**`, and by the two grep gates in §Verification. A
   violation fails CI. **Every server function in those trees takes `ctx: NutritionCtx` as its first
   parameter** (r02 §3 rule 3: "Cron code takes `db`/`env` as parameters"); `src/db/request-client.ts`
   stays the only file allowed to call `getCloudflareContext()` (r01 §4.2). The ESLint rules scope to
   `src/**`, so tests may import `ai` directly.
5. Every call goes through `callStructured(ctx, args)`: budget gate → rate-limit gate → latency timer
   → `generateObject({ model, schema, schemaName, instructions, messages, providerOptions,
   maxRetries: 0, temperature, maxOutputTokens, abortSignal: AbortSignal.timeout(timeoutMs) })` →
   validate → price → write exactly one `ai_prompt_logs` row **per attempt, success or failure** →
   return a discriminated result carrying the shared cost/model/token fields on both branches.
6. `costUsd = (inputTokens × inPerMTok + outputTokens × outPerMTok) / 1e6`, **summed first and divided
   once** — the per-term form `870×0.30/1e6 + 450×2.50/1e6` evaluates to `0.0013859999999999999` and
   fails a strict-equality assertion. Worked: 870 in / 450 out on `gemini-3.5-flash-lite` =
   `(870×0.30 + 450×2.50)/1e6` = **$0.001386**. `usage.inputTokens`/`.outputTokens` are
   `number | undefined`: treat `undefined` as `0` **and** set `tokens_missing = 1`, so a suspiciously
   free month is detectable. `cost_usd` is **always written as a number** — `0` when no model call
   happened (budget block, rate limit) — never NULL, which is what makes §Verification query 10 a
   real gate.
7. **One retry mechanism, ours.** `maxRetries: 0` on the SDK call, because the SDK's internal attempts
   are invisible to caller code and it reports usage only for the final one, making "one row per
   attempt" unwritable. `callStructured()` owns the loop: `attempts` defaults to **2**, each attempt
   is a separate `generateObject` with its own usage, cost, latency and `ai_prompt_logs` row
   (`attempt = 1 | 2`), reusing the identical prompt and version and never re-uploading the image. The
   per-photo ceiling is therefore exactly **2 paid calls**, which is what makes §Risks' budget
   guarantee true. Retry happens only for `invalid_output`, `timeout` and `upstream` 5xx; never for
   `refused`, `rate_limited` or `budget_exhausted`.

**Food-photo pipeline**

8. Capture is `<input type="file" accept="image/*" capture="environment">` — the OS camera focuses and
   stabilises better than our own preview, and iPhone HEIC decodes in `createImageBitmap`.
9. `prepareAiInput()` emits **long edge 1024 px, `image/jpeg`, quality 0.80** via
   `createImageBitmap(file, { imageOrientation:"from-image", resizeWidth, resizeHeight,
   resizeQuality:"high" })` → `OffscreenCanvas.convertToBlob`, falling back to `<canvas>.toBlob`
   below iOS Safari 16.4 (`docs/research/r03-r2-uploads-and-image-delivery.md` §4(d)). Why, in
   priority order: **(a) token cost** — Gemini charges "258 tokens" for an image ≤ 384 px on both
   dimensions and tiles anything larger into "768x768 pixel tiles, each counting as 258 tokens"
   (ai.google.dev/gemini-api/docs/tokens + docs/image-understanding, fetched 2026-09-12), so 1024×768
   is 2–3 tiles ≈ **516–774 image tokens** against up to 24 tiles ≈ **6192 tokens** for an untouched
   4032×3024 original — ~12× the input cost for detail a plate of food does not carry. The two Google
   pages disagree on the tiling rule (fixed 768 grid vs a `floor(min(w,h)/1.5)` crop unit), so the
   real figure is asserted from `usage.inputTokens` on the first live call, never from a formula.
   **(b)** inline image bytes count against a **20 MB total request** limit. **(c)** upload latency on
   gym Wi-Fi (~4 MB → ~180 KB). **JPEG, never WebP**: iOS Safari cannot encode WebP and silently
   returns PNG, which is *larger* than the original.
10. **Request contract, and every header validated before anything is built.** The JPEG is `POST`ed as
    the **raw body** to `/api/nutrition/estimate-photo` with `Content-Type: image/jpeg`, `X-Photo-Id`
    and `X-Locale` — never a Server Action (1 MB default body cap), never `multipart/form-data`
    (r03 §Recommendation). Zod validates `X-Photo-Id` against `/^[0-9A-HJKMNP-TV-Z]{26}$/` (Crockford
    ULID, matching `src/lib/ids.ts`), `X-Locale` against `z.enum(["ru","en"])`, and `X-Local-Day`
    (retry only, rule 16) against `/^\d{4}-\d{2}-\d{2}$/`; anything else is `400 validation_failed`.
    On the write path the server derives `localDay = toLocalDay(nowMs)` itself and **returns** it in
    the response — `{yyyy}/{mm}` are never taken from the client there — so a crafted header cannot
    write outside the food prefix, collide with a progress photo, or forge the `input_ref` that
    rule 11's reproducibility guarantee rests on.
11. The exact bytes are written to `photoKey({ kind:"food", id: photoId, localDate: localDay,
    variant:"ai", ext:"jpg" })` = `photos/food/{yyyy}/{mm}/{ULID}/ai.jpg` **before** the model call,
    and that key is the `ai_prompt_logs.input_ref`, so every estimate is reproducible against its
    literal input. `'ai'` is a first-class member of spec 10's `PhotoVariant`, excluded from its
    `UploadableVariant`, `VARIANT_SPEC` and `photos` columns (spec 10 rule 64) — we call its
    `photoKey()`, we never build or parse a key ourselves. The `display` and `thumb` variants take
    spec 10's **normal** path: `prepareVariants(file, ["display","thumb"])` →
    `src/lib/photos/enqueue.ts` → spec 05 `blobs` rows + `photo.upload` outbox ops, which spec 10's
    `dispatch.ts` turns into `POST /api/photos` (display) then `PUT /api/photos/{id}/thumb`. There is
    no parallel direct POST here. The `photos` row that path creates is what `food_entries.photo_id`
    references, and its ULID **is** `X-Photo-Id`.
12. **Exactly one** `generateObject` per attempt: `FOOD_PHOTO_PROMPT_V1` as `instructions`; one user
    message with `{ type:"file", mediaType:"image/jpeg", data: bytes }` plus a one-line text part
    carrying locale and local time; `schemaName:"FoodPhotoEstimate"`;
    `providerOptions:{ google:{ structuredOutputs:true } }`; `temperature: 0.2`;
    `maxOutputTokens: 2048`. No refine call, no tool loop, no streaming.
13. Prompts are versioned by string and never edited in place: one changed word means a new file and a
    new `FOOD_PHOTO_PROMPT_VERSION`, with old versions kept so historical rows stay interpretable.

```text
# FOOD_PHOTO_PROMPT_V1  ·  promptVersion = "food_photo@1"

You are a nutrition estimation engine. You receive ONE photograph and return ONE structured object.
You never converse and you never ask questions.

PROCEDURE
1. Decide whether the image shows food or drink intended to be consumed. If it does not, set
   is_food=false, set reject_reason to the closest match, return items=[] and stop. Never guess a meal
   from a non-food image.
2. Identify every distinct edible component, including drinks, sauces, dressings and oil that was
   visibly used for frying. Merge duplicates of the same component. Do not split a homogeneous dish
   into its ingredients unless they are separately visible and separately portionable.
3. Find a size reference in the frame, preferring in this order: standard cutlery, a human hand, a
   26-27 cm dinner plate, a coin or bank card, packaging with a printed net weight. Report which one
   you used in size_reference. If none is present, set size_reference="none" AND
   size_reference_missing=true.
4. Estimate the edible mass of each component in grams (for drinks, grams equal millilitres). Also
   give grams_low and grams_high as a range you would defend, with grams_low <= grams <= grams_high.
5. State the cooking method you are assuming in cooking_method, because it changes energy density. Use
   "unknown" only when the image genuinely cannot tell you.
6. Give kcal, protein_g, carb_g and fat_g FOR THE ESTIMATED PORTION, not per 100 g, using standard
   composition values for the cooked form you assumed. kcal must be consistent with the macros:
   4*protein_g + 4*carb_g + 9*fat_g, within 20 percent.
7. portion_text is how a person would say that amount in one short phrase in {{LOCALE}} - for example
   "2 lomtika", "1 srednyaya kartoshka". It is not a number of grams.
8. name is the component name in {{LOCALE}}. name_en is a plain canonical English name suitable for a
   food-database lookup, such as "chicken breast, grilled", or "" if you cannot give one.
9. confidence (per item) and overall_confidence are your own calibrated probability, from 0 to 1, that
   the true mass is within +/-25% of your grams estimate. Be strict. 0.9 requires packaging with a
   printed weight. A plated home meal with cutlery in frame is about 0.6. No size reference at all is
   at most 0.4.
10. total_kcal is the sum of the items' kcal.
11. assumptions is one short sentence naming what you could not see - hidden oil, sauce beneath the
    food, the far side of the plate. notes says what the user could re-shoot to improve the estimate.

RULES
- Never return an empty items array when is_food=true.
- Never return 0 for the grams or kcal of a visible component.
- Do not round grams to the nearest 50. Give your actual estimate.
- Do not add a component you cannot see because the dish "usually" contains it. Put it in assumptions.
- Return the object only.
```

14. **No `.nullable()`, `z.union`, `z.record`, `.min()` or `.max()` in the AI schema.** Verified: Zod 4
    `.nullable()` emits `"type": ["number","null"]`, and `@ai-sdk/google@4.0.69` turns a type array
    into `{ anyOf:[{type:"number"}], nullable:true }` — a one-member `anyOf` with no top-level `type`,
    exactly what Gemini's OpenAPI-3.0 subset chokes on (`dist/index.js:391-403`); separately the
    converter's destructure (`dist/index.js:373-386`) **drops `minimum`/`maximum`**, so a range never
    reaches the model yet can still fail our own validation and discard a paid call. Ranges live in
    the prompt text and are enforced by rule 15.
15. `normalizeEstimate(raw, mode)` applies in order: clamp all confidences into `[0,1]` (tag
    `clamp_confidence`); **drop any item with `grams <= 0`** regardless of its kcal
    (`drop_empty_item`) — a `grams:0, kcal:250` item otherwise survives and hands `QuantityField` a
    0…0 slider and a null `deltaGramsPct`; order `grams_low ≤ grams ≤ grams_high` (`fix_range`);
    **Atwater sanity** — when `|kcal − (4·protein_g + 4·carb_g + 9·fat_g)| / max(kcal, 1) > 0.20`, tag
    `atwater_mismatch` and cap that item's confidence at **0.40**, because this is the cheapest
    available check on an AI macro estimate and spec 14 assigns Atwater factors to this module; when
    `mode === "photo"` **and** `size_reference_missing`, cap `overallConfidence` at **0.50** and each
    item at **0.60** (`cap_no_reference` — our rule, not the model's; never applied for
    `mode === "text"`, where the user stated the quantity); recompute `totalKcal = Σ items.kcal`,
    tagging `total_mismatch` when the model's own total differed by >2% — we always display our sum;
    assign a ULID `itemUid` per item, carried by the correction UI so per-item deltas survive
    reordering. `repairs` is persisted: it is the cheapest signal that a prompt version regressed.
16. Failure behaviour, each a distinct UI state **and** a log row. **Refusal**
    (`finishReason === "content-filter"`) → «Не удалось оценить это фото» + manual entry, **no retry**
    (retrying a filtered prompt only spends money). **Non-food** (`is_food === false`) → show
    `reject_reason` plainly, offer re-shoot or manual entry, create no entry, log
    `outcome = "not_food"` with `ok = 1` — it is a correct answer. **Validation failure**
    (`NoObjectGeneratedError`, which carries `text`/`usage`/`finishReason` in `ai@7`) → rule 7's
    single retry, then persist `output_json = { rawText }` (spilling to R2 per rule 48 if it exceeds
    the CHECK) and show «Ответ модели не распознан» — never partially parse. **Timeout** (20 s vision
    / 12 s text) → «Оценка не успела» + Retry, and the retry **re-uses the uploaded object**:
    `POST /api/nutrition/estimate-photo` with `X-Photo-Id`, `X-Local-Day` (the value the first
    response returned) and an **empty body** re-reads `…/ai.jpg` from R2 and skips the put, so a gym
    connection never re-uploads 180 KB at the worst moment. A body-less request whose object is
    missing is `404 not_found`. **Budget blocked** → rule 50. **Offline** → rule 17.
17. **Offline photo path, in spec 05's vocabulary — there are no per-feature Dexie stores.** Spec 05
    Behaviour 17 fixes exactly four stores (`mirror`, `outbox`, `blobs`, `meta`) and states the rule
    as "one generic `mirror` store, **not one store per entity: a new feature adds rows, not a
    schema**". So: the entry is a `mirror` row on `food_entries` with `dirty:1`, written by
    `writeLocal({ entity:"food_entries", row, type:"foodEntry.create", payload, blob })`;
    **`confirmed_at IS NULL` is what "draft" means** — spec 02 already ships that column, so no
    `status` column is needed anywhere; the AI JPEG is the `blobs` row that `writeLocal`'s `blob`
    argument creates, reachable through the op's `blobKey`. Draft rows carry
    `kcal`/`protein_g`/`carb_g`/`fat_g` NULL, are excluded from day totals, macro rings and the TDEE
    intake series, and are flagged «Подтвердите оценку». On reconnect the queued estimate runs, the
    user confirms in `CorrectionSheet`, and `confirmed_at` is set in the same write that fills the
    macros. An offline photo can never save with unconfirmed AI numbers — rule 19 forbids it.

**Honesty requirements (non-negotiable)**

18. Every AI-derived number renders with a leading `≈` and a `ConfidenceBadge` band (`<0.4` низкая ·
    `0.4–0.7` средняя · `>0.7` высокая); no code path renders an AI kcal without one. Grams
    additionally show `grams_low–grams_high` as helper text.
19. **The user always edits before save, and the gate is `source='ai'` only.** `CorrectionSheet` opens
    with the primary action **disabled** until a field changes or the explicit «Всё верно» checkbox is
    ticked. `POST /api/nutrition/entries` requires a `correctionToken` **when and only when
    `source === 'ai'`**: barcode saves, manual entries and template application (rule 45) have no
    estimate call and therefore no token, and requiring one unconditionally would reject every non-AI
    save path. The token is
    `base64url(HMAC-SHA256(key, "<aiLogId>|<photoId>|<expMs>")) + "." + aiLogId + "." + photoId + "." + expMs`,
    minted by the estimate response, TTL **30 minutes**, verified in constant time against
    `AI_CORRECTION_SIGNING_KEY` — stateless, so it works on Workers with no session storage. In place
    of the undecidable "byte-identical to the raw estimate" test (JSON key order, float formatting and
    whitespace all vary, and the client has already normalised the estimate) the server performs a
    **structural** comparison against the `ai_estimate_json` it persisted for that `aiLogId`: if
    `totalKcal` and every item's `grams`, `kcal`, `protein_g`, `carb_g`, `fat_g` matched by `itemUid`
    are all unchanged, the save is rejected `409 conflict` unless `confirmedUnchanged: true` is
    present. Silent auto-save is therefore impossible even from a script. A reconnected draft (rule
    17) takes the same path: the estimate that lands on reconnect mints a fresh token, and the confirm
    write carries it.
20. **Both** representations persist per entry: `ai_estimate_json` (raw validated object + `repairs`,
    `promptVersion`, `modelId`) and `corrected_json` (the user's final items), beside the flat
    snapshot columns `kcal/protein_g/carb_g/fat_g/fiber_g/grams/basis` that the day view and TDEE
    read. (a) Those snapshot columns are `INTEGER` (spec 02 rule 8c) while `MealTotals` carries the
    unrounded doubles: rounding happens exactly **once, round-half-up, at write**, so a day's ring
    total is the sum of the numbers on screen, and `delta_kcal` is the difference of the two persisted
    integers — the AI estimate and the correction are always compared at the same precision.
    (b) Snapshots are **never** recomputed from `foods` later: an upstream label correction must not
    rewrite dietary history the TDEE already consumed
    (`docs/research/r08-nutrition-data-apis.md` §5.4).
21. **UI copy rule.** The one measured study of exactly this task — *Current Developments in
    Nutrition* (2025), doi `10.1016/j.cdnut.2025.107556`, reported as 52 standardized photographs × 3
    portion sizes with weight MAPE **36.3%** (ChatGPT-4o) / **37.3%** (Claude 3.5 Sonnet) / **65.0%**
    (Gemini 1.5 Pro), energy **35.8% / 35.8% / 64.2%**, protein **60.7% / 61.7% / 109.9%**, and "bias
    slopes ranging from –0.23 to –0.50" — is **UNVERIFIED-secondary**: the DOI resolves to an Elsevier
    landing page we could not read (checked 2026-09-12), and no research note in `docs/research/`
    reproduces the figures. They must therefore never be quoted to the user as fact. Only the
    **direction** is load-bearing and only the direction is asserted in the UI: **systematic
    under-estimation that grows with portion size.** So the correction sheet carries a standing,
    **non-dismissible** hint «ИИ обычно **занижает** порции — и тем сильнее, чем больше порция. Если
    сомневаетесь, увеличьте граммы.»; any item with `grams > 300` gets an inline nudge «Крупная
    порция — здесь ИИ ошибается сильнее всего.»; protein is labelled the least reliable macro. **No
    percentage from that paper appears in any string.** We do **not** silently inflate the model's
    numbers in v1 — applying a factor before measuring our own bias on our own food would be
    guessing, and rule 22 exists to earn it. Any future calibration ships as a new `promptVersion`
    plus a versioned `calibration@N` multiplier recorded on the entry.
22. **Correction-delta metric**, computed at save and stored on the estimate's **`ai_prompt_logs`**
    row — not on `food_entries`, because only an AI entry has a delta and one indexed query over the
    log is the whole point: `deltaKcal = correctedKcal − aiKcal` (signed; positive ⇒ under-estimate);
    `deltaPct = deltaKcal / aiKcal`, `null` when `aiKcal === 0`;
    `deltaGramsPct = (correctedGrams − aiGrams) / aiGrams`, `null` when `aiGrams === 0`. **Meal level
    is authoritative** because it survives the user adding or deleting items; item-level deltas are
    recorded only for items matched by `itemUid`, with `itemsAdded/Removed/Edited/Untouched` and
    `kind` describing the edit shape. `aggregateBias()` reports `meanSignedPct` (our bias), `mapePct`
    and the OLS `slopeVsGrams` (`deltaPct` regressed on `correctedGrams`, units 1/g, with `n` and
    `interceptPct`), grouped by `promptVersion × modelId` over
    `ai_prompt_logs_prompt_version_model_idx`. **These are only directionally comparable with the
    literature**: the paper measures against weighed ground truth, ours measures against the user's
    own free-hand correction, which is itself an estimate — so a `mapePct` below 35.8% is not evidence
    of a better model, and no UI string claims it is. A prompt change may only ship once the outgoing
    version has `n ≥ 30`. An estimate the user discards still logs `outcome = "rejected"` — the
    strongest negative signal we have, and dropping it would bias the metric.

**Barcode**

23. `/nutrition/scan` is a full-bleed **page**, not a sheet: it needs the whole viewport and a stable
    `<video>`. `openRearCamera()` uses `facingMode:{ ideal:"environment" }` — never `exact`, which
    throws `OverconstrainedError` on a front-camera-only device (r08 G20) — with
    `width/height {ideal:1280/720}`, then verifies `track.getSettings().facingMode`. Torch is offered
    only when `caps.torch` is an array **containing `true`** (it is a `sequence<boolean>`, so
    `[false]` is truthy — G21); zoom only when `caps.zoom.max > caps.zoom.min`, applied at 30% of the
    range. Every `applyConstraints` is try/caught and a rejection never kills the scan.
24. `createScanner()` uses native `BarcodeDetector` only when
    `await BarcodeDetector.getSupportedFormats()` actually contains `ean_13` — the constructor's
    presence is not support (Chrome exposes it on ChromeOS/macOS only and *silently* failed before
    Chrome 113; r08 §4.1, G19). Otherwise it lazily imports **`zxing-wasm/reader`**
    (`zxing-wasm@3.1.4`; 402 KiB gzip wasm + 11.5 KiB glue — never the `full` entry) with a
    **mandatory** `overrides.locateFile` pointing at same-origin `/wasm/zxing_reader.wasm`; the
    package default fetches from jsDelivr, breaking offline scanning and a strict CSP (G17). Two
    prerequisites are owned elsewhere and must land with this rule: the response CSP must include
    `'wasm-unsafe-eval'` in `script-src` (G18), and the file must be in the Serwist precache manifest
    (r08 §5.5, which calls the 402 KiB "deliberate, and worth it" precisely because the fallback is
    the shop-with-no-signal case a runtime cache cannot serve). See Open question 5.
25. Decoding runs on `requestVideoFrameCallback` (not `setInterval`), throttled to ~8–10 decodes/s,
    and a value is accepted only after it repeats on two consecutive frames — one misread digit
    otherwise becomes a confident lookup of the wrong product.
26. `normalizeGtin()` runs before any lookup; anything unparseable → `invalid_gtin` with «Штрих-код не
    распознан». FDC is queried with **both** padded and unpadded forms (`fdcGtinCandidates`) because
    it stores `gtinUpc:'013764027053'` (r08 §4.5, G8).
27. Precedence in `POST /api/nutrition/resolve`, **sequential with early exit** (r08 §5.1; it also
    keeps us under the Worker's six-simultaneous-connections limit, G24): (0) D1 `foods`
    `barcode = ? AND verified_by_user = 1` → return, confidence 1.0, **stop** (a value the user ever
    corrected wins forever). Spec 02 already provides `verified_by_user`, so that — not
    `source = 'user'` — is the single mechanism for "the user corrected this"; `source = 'user'`
    continues to mean only "the user created this food from scratch". (1) D1 `foods` any source →
    return immediately, flag `stale` when `fetched_at` > 30 d and revalidate after responding;
    (2) KV `off:p:v2:<gtin13>`; (3) OFF
    `GET /api/v2/product/<gtin13>?product_type=food&fields=<OFF_FIELDS>`, confidence 0.90; (4) FDC
    `GET /foods/search?query=<gtin>&dataType=Branded&pageSize=5` then **`GET /food/{fdcId}`** for the
    complete nutrient set, confidence 0.85; (5) AI estimate, user-confirmed, `source='ai'`.
28. **Offline scan has its own rule, because the brief's headline NFR is offline-first.** The scan
    screen never blocks on the network. Order on the client: Dexie `mirror` rows on `foods` (the
    user's own rows plus every food ever resolved) → hit ⇒ a normal entry carrying the mirrored
    `source` and `verified_by_user`; miss ⇒ a **draft** entry (`confirmed_at IS NULL`) labelled by the
    raw GTIN, plus an outbox op carrying that GTIN, plus an «ожидает поиска» chip on the row
    (r08 §5.5). When the op flushes, the server resolves and returns the food; the client fills the
    draft's food and macros and sets `confirmed_at` **only if the user has not edited the row
    meanwhile** — if they have, the resolved values are offered as a one-tap «Подставить данные
    продукта» diff and the user's numbers stand until they accept, because a lookup must never
    overwrite a human correction (the same principle as precedence step 0). This needs `foods` in
    spec 05's `MirrorTable` union (pull-only) and one new `OP_TYPES` member — Open question 3.
29. OFF: **use `/api/v2/` for both product reads and text search, and record that in
    `DECISIONS.md`.** OFF's own docs mark v2 "⚠️ Deprecated" and v3 "✅ Current" (r08 §1.1), but v3 has
    **no structured and no full-text search** (G10), so moving product reads to v3 would leave barcode
    lookup working while brand/text lookup silently disappeared — a partial, confusing failure. One
    version for both paths is the decision; **never `/api/v3.6/`**, a pinned minor that returns
    `"nutriments":{}` alongside a success status (G9). `User-Agent: TairFitness/1.0
    (tairkaldybayev@gmail.com)` on every request. A miss is **HTTP 200** with `status: 0` while a
    wrong-product-type hit is **HTTP 404** — branch on the JSON `status` and handle 404 separately
    (G7). Treat **429 and 503 alike** as "serve stale from D1" and self-cap at ~1 req/2 s: our egress
    IP is shared Cloudflare space and OFF punishes with IP bans, not `Retry-After` (G16). Accept an
    OFF result only when `kcal != null` **and** at least one of protein/carb/fat is non-null.
30. kcal mapping. **OFF:** `energy-kcal_100g` → else `energy_100g` **only when
    `energy_unit === "kcal"`** → else `energy-kj_100g / 4.184`; `energy_100g` is kilojoules (G4).
    Carbs fall back to `carbohydrates-total_100g` (G12). Sodium is **grams** on OFF (×1000 → mg) and
    **mg** on FDC (G14). `nutrition_data_per === "100ml"` sets `basis="100ml"` and we **refuse** to
    convert ml↔g (G5); `*_prepared_*` is a parallel nutrition set, ignored in v1 (G13). **FDC:** chain
    `208 → 958 → 957 → 268/4.184 → 4P+4C+9F`, persisting which rung fired in `foods.energy_source` —
    newer Foundation foods have no `208` at all (G1). `flattenFdcNutrients` handles both response
    shapes and lowercases `unitName` (search `"KCAL"`, detail `"kcal"` — G2); search results are
    "identity + a hint", so macros are always confirmed from `/food/{fdcId}` (G3); `servingSizeUnit`
    is UN/CEFACT — `'GRM'` grams, `'MLT'` ml (G27); for generic foods prefer `SR Legacy`, then
    `Survey (FNDDS)`, then `Foundation`, with `Branded` only for barcode/brand hits (§2.3).
31. **Per-100 g vs per-serving — the exact rule.** `foods` stores **per-100 (basis) values only**; all
    arithmetic goes through `basis.ts`: `value(quantity) = value_per100 × quantity / 100` (multiply
    then divide, in that order); `quantity = servings × servingGrams` (throws when null);
    `servings = quantity / servingGrams` (`null` when null); and the **only legal upward conversion**,
    used when a source has per-serving but no per-100 values,
    `value_per100 = value_serving × 100 / servingGrams` requiring `servingGrams > 0` — otherwise the
    food stores `kcal = null` rather than a guess. `*_serving` keys exist on OFF **only when
    `serving_size` is set** (Nutella has none at all — r08 §1.6, G6), so `QuantityField` hides the
    servings toggle entirely when `serving_grams === null` instead of rendering `NaN`. Never mix bases
    in one expression; never write a per-serving value into a per-100 column. `basis` is carried on
    both the food (`foods.basis`) and the entry (`food_entries.basis`), because an entry's `grams`
    column means millilitres for a `100ml` food and the day view must be able to say so. Tests pin
    both directions and the known drift (OFF's own `energy-kcal_serving = 110` against
    `244 × 45/100 = 109.8`, §1.8 — we derive and accept the ~1% disagreement).
32. Attribution (r08 §1.7, §5.6): Settings → About shows `Данные о продуктах: Open Food Facts —
    ODbL 1.0 · USDA FoodData Central — CC0 1.0`, linking to `https://openfoodfacts.org` and
    `https://fdc.nal.usda.gov/`. Every food-detail sheet shows a `FoodSourceChip`
    (`OFF`/`USDA`/`AI`/`Вручную`), doubling as the honesty signal. We never display or cache OFF
    **product images** (CC-BY-SA 3.0 with per-image caveats) — text and barcode only; photos are the
    user's own in R2.

**Natural-language logging**

33. `POST /api/nutrition/parse-text { text, locale }` → one `getTextModel()` `generateObject` against
    `FoodTextEstimateSchema`. **Nutritionix is not used**: its public free tier no longer exists
    (r08 §3.2) and our abstraction parses multiple items, quantities and RU text in one already
    instrumented call. This module reads no `NUTRITIONIX_*` secret — Open question 4.
34. **One schema, one normalizer, two producers.** The text prompt instructs the model to set
    `size_reference:"none"` and `size_reference_missing:true`, and `is_food=false` with
    `reject_reason:"not_food"` for input that is not food ("2 камня") — which is how the text path
    rejects non-food at all. `normalizeEstimate(raw, "text")` then runs the identical clamp, Atwater,
    range, `itemUid` and total-recompute pipeline, skipping only the no-reference confidence cap,
    which would be wrong here because the user stated the quantity. There is no second normalizer and
    no second schema.
35. Hybrid resolution keeps numbers auditable: the model owns **quantity → grams** and `name_en`, then
    `resolveByQuery(ctx, name_en)` goes (a) D1 `foods`, (b) FDC `SR Legacy`/`Survey (FNDDS)`
    (preferred for generic foods; `Foundation` is frequently missing macros entirely, r08 §2.3),
    (c) OFF text search via `/api/v2/search` for branded and RU-market strings, wrapped in try/catch
    (r08 §5.1 step 2; Search-a-licious at `search.openfoodfacts.org/search` is the same corpus at
    `version: 0.1.0` and remains the documented fallback if `/api/v2/search` is withdrawn). (c)
    matters because r08 §1.8 warns Kazakhstan coverage is thin and **UNVERIFIED**: without it a
    branded local product with no barcode would have no lookup path at all except the AI estimate. On
    a hit macros are recomputed as `per100 × grams / 100` with `macroSource = "fdc"`/`"off"`; on a miss
    the model's macros stand with `macroSource = "ai"`. Both paths enter **the same
    `CorrectionSheet`** with the same `≈`/confidence rendering, edit-before-save gate and delta metric
    — one correction loop, three producers.
36. Empty input is rejected client-side with no call; >500 chars is rejected with «Слишком длинно —
    разбейте на приёмы пищи». `inputRef` for a text call is `"sha256:<hex of the normalised query>"`,
    so user prose never lands in the log's ref column.

**Targets and adaptive TDEE**

37. `targetKcal = max(round(tdeeKcal + goalRateKgPerWeek × 7700 / 7), floorKcal)` using
    `ENERGY_DENSITY_KCAL_PER_KG = 7700` from spec 07 (verified Wishnofsky value; MacroFactor uses the
    same — `docs/research/r09-formulas-and-test-vectors.md` §5). `goalRateKgPerWeek` clamps to
    `[−1.0, +0.5]`. `floorKcal = round(max(1200, 1.1 × priorRmrKcal))`, and the floor is shown
    (`floored: true`), never hidden. **Rounding order is fixed and load-bearing**: `proteinG` and
    `fatG` round first, and `carbG` subtracts the **rounded** integers, so the macro grams on screen
    always reconstruct `targetKcal` to within a kcal. Macros:
    `proteinG = round(trendKg × proteinGPerKg)`;
    `fatG = round(max(trendKg × minFatGPerKg, 0.25 × targetKcal / 9))` — `minFatGPerKg` is **read from
    `TargetInput`**, never a literal; `carbG = round(max(0, (targetKcal − 4×proteinG − 9×fatG) / 4))`;
    `fiberG = round(14 × targetKcal / 1000)`; `waterMl = round(35 × trendKg)`. All rounding is
    round-half-up. All inputs use **trend** weight. Provenance of every constant, because these set
    the user's actual daily intake:

    | Constant | Status |
    |---|---|
    | `7700` kcal/kg | **verified** — r09 §5 (Wishnofsky; MacroFactor's published algorithm page) |
    | fibre `14 g / 1000 kcal` | **verified** — IOM/NASEM 2002 DRI Adequate Intake for total fibre: 14 g per 1000 kcal (25 g adult women / 38 g adult men), checked 2026-09-12 |
    | fat floor fraction `0.25 × targetKcal / 9` | **verified as inside the range** — the IOM AMDR for total fat is 20–35% of energy; 25% is our pick inside it |
    | `minFatGPerKg` default `0.8` | **UNVERIFIED** — a strength-training convention; no primary source found. Settable, and the AMDR fraction usually dominates anyway |
    | `proteinGPerKg` default `1.8` (clamped 1.6–2.2) | **UNVERIFIED** — mid of the commonly cited band, no single primary source (Open question 6) |
    | `waterMl = 35 × trendKg` | **UNVERIFIED** — a clinical rule of thumb; EFSA and IOM state total-water AIs per person, not per kg |
    | `1200` kcal absolute floor | **UNVERIFIED** — a widespread commercial floor; no primary citation found |
    | `1.1 × priorRmrKcal` floor multiplier | **UNVERIFIED — ours**, a deliberate refusal to target below RMR |

38. **This module computes no TDEE and registers no cron.** `buildTdeeWindow()` turns the intake
    series and the persisted trend series into a `TdeeWindow`; `buildTdeeInput()` turns that into spec
    07's `TdeeInput` (`nowMs`, `priorKcal`, `meanIntakeKcal`, `completeDays`, `weighInsInWindow`,
    `trendStartKg`, `trendEndKg`, `lastEstimateKcal`, `bodyWeightKg`, plus `spanDays`). Spec 07's
    `adaptiveTdee()` does the back-calculation, the `w = min(1, completeDays/28)` blend, the ±250
    week-over-week clamp and every guard status. The fire time is **whatever spec 14's Monday step
    is** — today the `tdee-recompute` step inside the `weekly-review` cron at `5 3 * * *` UTC = 08:05
    Almaty, gated on `weekdayInAppZone() === 1`, which appends the `tdee_snapshots` row (spec 14
    Behaviour 12–13, 15). This spec states **no cron expression at all**: spec 01 rule 21 forbids the
    weekday field outright (Cloudflare numbers weekdays `1 = Sunday`), spec 14 forbids any new or
    sub-hourly trigger, and the `59 18 * * 0` that used to be here violated all three.
39. **The window contract — the two things a caller can get catastrophically wrong.**
    (a) **`completeDays` is not circular and never counts a day nobody logged.** `medianIntakeKcal` is
    the median over **days with at least one confirmed (`confirmed_at IS NOT NULL`) entry, and those
    days only**; a day with no entries has `kcal === null`, is never "logged", never "complete", and
    never enters the median or the mean. `completeDays` counts logged days whose intake is
    `≥ TDEE_PARTIAL_DAY_FRAC (0.5) × medianIntakeKcal`. Taking the median over all 28 calendar days
    instead would give a user who logged 10 days a median of `0`, make all 28 days satisfy `x ≥ 0`,
    average in 18 phantom fasting days and inflate TDEE by hundreds of kcal — the failure spec 07 rule
    30 hands to the caller and MacroFactor calls "the single cardinal sin".
    (b) **Δtrend and the divisor must cover the same period.** `trendStartKg`/`trendEndKg` are the
    real persisted trend points (never interpolated across a gap) at the **first and last complete
    day** in the window, and `spanDays` is the inclusive calendar-day count between exactly those two
    anchors. Dividing a 28-day Δtrend by a smaller `completeDays` — the shape r09 §5 step 2 literally
    describes, and the shape its worked example cannot catch because there `completeDays === span` in
    every row — turns a real `−0.900 kg / 28 d` into `−346.5` instead of `−247.5`: a ~99 kcal/day
    error in the direction that *raises* the target, which is exactly what rule 21 exists to prevent.
    `spanDays` is therefore carried on the input and persisted on the snapshot; Open question 2 is the
    one-field change spec 07 needs to consume it.
40. **The card shows spec 07's status, and there is exactly one ladder.** `tdeeCardCopy()` maps each
    `TdeeStatus` to RU copy: `NO_PRIOR` → **no number at all**, «Заполните пол, рост и дату рождения —
    без них оценки нет»; `INSUFFICIENT_INTAKE_DAYS` / `INSUFFICIENT_WEIGH_INS` → the number spec 07
    returns (which **is** the prior) with `numberIsMeasurement: false` and the exact shortfall («Это
    формула, не измерение. Нужно 14 дней полного логирования: есть 11»); `CALIBRATING` → the blended
    number plus «Калибруется — точность растёт до 3–4 недель»; `SUSPECT_WEIGHT_CHANGE` → the number
    plus «Резкое изменение веса — оценка может быть завышена»; `OK` → the number. This module defines
    **no** enum, no threshold and no refusal of its own: two owners of one guard ladder is how they
    diverge, and the divergence would be the "a wrong TDEE is worse than no TDEE" case itself. The
    stricter "show nothing before day 3" behaviour we want is a change request to spec 07 rule 27, not
    a local reimplementation — Open question 1.
41. Prior: **Mifflin-St Jeor (sex-split) × `settings.activity_factor`** by default; **Katch-McArdle ×
    the same factor** only once a US-Navy body-fat measurement younger than 60 days exists.
    `prior_method` is persisted and the active prior named in the UI. The activity multipliers
    (1.2…1.9) are **UNVERIFIED** against a primary source (r09 §5, spec 07 rule 25) and are fully
    discarded once `w = 1`.
42. A target change is never silent: when `targetKcal` moves ≥ 50 kcal the day view shows a one-tap
    «Что изменилось?» disclosure reading the newest `tdee_snapshots` row — `tdee_data`, `prior`,
    `blend_w`, `complete_days`, `span_days`, `weigh_ins`, `status`, and whether `capped` fired.

**Water, fasting, templates, micros, day view**

43. Water: chips 200/250/500 ml plus a **visible** «Другое» control for a custom amount (long-press is
    an accelerator, never the only path — see the a11y note); each tap **appends** one `water_logs`
    row, so undo deletes a known id instead of decrementing a counter. Progress is `Σ ml / waterMl`
    for the local day.
44. Fasting: at most one open `fasting_sessions` row (a **new table** — Open question 3),
    `started_at`/`ended_at` epoch-ms. Elapsed time is **derived on render from the client clock** —
    never ticked server-side, never persisted per second. Presets 16:8 / 18:6 / 20:4 / OMAD set
    `target_seconds`. Saving food while a fast is open **prompts** «Завершить пост?» and never
    auto-closes it; the goal notification is scheduled by spec 14.
45. Templates/favourites/recents use spec 02's existing tables: **`meals` + `meal_items`** hold a
    named multi-item meal (there is no `meal_templates`/`meal_template_items`), creatable from any
    saved entry in one tap. Favourites are `foods.is_favourite` (Open question 3). Recents is derived
    — the 30 most recent `food_id`s by `MAX(food_entries.eaten_at) DESC`, deduplicated, served by
    `food_entries_local_day_eaten_at_idx`. Applying a template creates normal entries carrying each
    food's own `source`, and does **not** bypass the correction sheet for items whose
    `source = 'ai'`.
46. Micronutrients use an **explicit allow-list**, persisted into `foods.micronutrients_json`, because
    OFF's `nutriments` also contains non-nutrients (`nova-group_100g`,
    `fruits-vegetables-*-estimate-from-ingredients_100g` — G11) and an "iterate and render" panel
    shows garbage. v1 list, with provenance per field:

    | Field | OFF key (r08 §1.6, measured) | FDC `nutrientNumber` |
    |---|---|---|
    | fibre | `fiber_100g` | `291` — **UNVERIFIED** |
    | sugars | `sugars_100g` | `269` — **UNVERIFIED** |
    | saturated fat | `saturated-fat_100g` | **UNVERIFIED** — r08 pins none |
    | sodium | `sodium_100g` × 1000 | `307` — **verified** (USDA SR nutrient list, checked 2026-09-12) |
    | calcium | `calcium_100g` | `301` — **verified** |
    | iron | `iron_100g` | `303` — **verified** |
    | potassium | `potassium_100g` | `306` — **verified** |

    The first three are not micronutrients; calcium, iron and potassium are, and all three appear in
    r08 §1.6's measured key list for the bread fixture — which is what makes the brief's
    "micronutrients where available" actually shipped rather than quietly dropped while claiming
    research backing. An UNVERIFIED FDC number means the panel renders «нет данных» for FDC-sourced
    foods, never `0` and never a guessed number. Adding a field requires pinning its verified OFF key
    **and** its FDC `nutrientNumber` first.
47. Day view (`/nutrition/[date]`): rings + kcal-remaining (components from spec 12), then meal slots
    (`food_entries.slot` ∈ `breakfast|lunch|dinner|snack`, defaulted from the local hour of `eaten_at`
    at boundaries 04–11 / 11–16 / 16–22 / else `snack`, always user-overridable), then water, fasting
    and `TdeeCard`. Totals count only rows with `confirmed_at IS NOT NULL` and surface a separate «N
    черновиков» chip. **Every date is the stored `local_day TEXT 'YYYY-MM-DD'` column, Asia/Almaty,
    UTC+5 with no DST since 2024-03-01** (spec 02 rule 5, r09 §8): every query filters `local_day`, no
    query derives a day from an epoch in SQL, and the day boundary is never UTC midnight. Instants
    (`eaten_at`, `logged_at`, `started_at`, `fetched_at`, `resetsAt`) are epoch-ms;
    `tdee_snapshots.week_ending_day` has the same `'YYYY-MM-DD'` format as `local_day`.

**Logging and spend cap**

48. One `ai_prompt_logs` row for **every** attempt — success, non-food, refusal, timeout, validation
    failure, rate limit, budget block. Columns this module writes, using spec 02's names wherever they
    exist: `id` (ULID), `created_at` (epoch-ms), `local_day`, `provider`, **`model`** (not
    `model_id`), `prompt_version`, **`feature`** (not `kind`), `input_ref` (R2 key or `sha256:…`),
    `input_tokens`, `output_tokens`, `cost_usd` (always a number), `latency_ms`, **`ok`** (1 for
    `outcome ∈ {ok, not_food}`, else 0), **`error`** (the message; there is no `error_code`),
    `output_json`, `output_r2_key`. Eleven columns this module needs that spec 02 does not yet define
    — `outcome`, `schema_name`, `attempt`, `locale`, `tokens_missing`, `finish_reason`, `repairs_json`,
    `degraded`, `entry_id`, `delta_kcal`, `delta_pct` — plus the index
    `ai_prompt_logs_prompt_version_model_idx`, are requested in Open question 3; the last three are
    nullable and backfilled at save, which is what makes `aggregateBias()` one indexed query instead
    of a JSON scan. `cached_input_tokens` is **not** logged: nothing in this spec enables prompt
    caching, and a column nothing writes is a column that lies. **Size policy:** `output_json` carries
    spec 02's `CHECK (length ≤ 65536)`; a validated estimate is ~2 KB, but the `{ rawText }` of a
    runaway generation is unbounded, so any payload whose JSON exceeds **60 000 bytes** is `put` to
    `ai-logs/{yyyy}/{mm}/{id}.json` in `MEDIA`, with `output_r2_key` holding that key and
    `output_json` NULL (spec 02 rule 6).
49. Monthly cap: `AI_MONTHLY_BUDGET_USD`, default **5.00**. The authoritative figure is
    `SELECT SUM(cost_usd) FROM ai_prompt_logs WHERE local_day >= <first day of the Almaty month>` — a
    `local_day` string range, not an epoch comparison; KV `ai:spend:<YYYY-MM>` is a fast-path cache
    refreshed after each call and **never** the source of truth (KV allows 1 write/s per key and is
    eventually consistent — r08 §5.3, G22, G23).
50. Tiers: `<50%` → `ok`; `≥50%` → `warn`, dismissible Settings banner; `≥80%` → `degrade`, all calls
    switch to the `cheap` tier and every affected estimate is stamped `degraded = 1` and badged
    «экономный режим» so a quality drop is attributable rather than mysterious; `≥100%` → `blocked`,
    the estimate routes return **402** with
    `{ error:"budget_exhausted", spentUsd, capUsd, resetsAt }` and the UI says plainly «Лимит на ИИ в
    этом месяце исчерпан ($5.00). Обновится 1 октября. Пока можно вводить вручную или по
    штрих-коду.» — an explicit refusal, never a silent failure and never a fabricated estimate.
51. **Rate limiting is spec 01's primitive, not a KV counter.** The AI routes call
    `checkRateLimit(ctx.env.AI_LIMITER, "ai:" + route, request)`; spec 01 already declares `AI_LIMITER`
    as `{ limit: 12, period: 60 }` and owns `src/server/rate-limit.ts` and the 429 body. A KV counter
    would be the wrong primitive for the reasons this spec cites elsewhere (KV is read-modify-write,
    1 write/s per key, eventually consistent — G22/G23), and `ratelimits[].simple.period` accepts
    **only** `10` or `60` seconds (spec 01, verified against `wrangler/config-schema.json`), so a
    "5-minute window" is not expressible at all. 12 calls per 60 s is the policy. Scale reference: at
    ~$0.0014/photo, 3 photos/day for 30 days is **$0.125/month**, ~2.2× that without rule 9's
    downscale. The limiter catches a retry loop, not normal use.

## Data

Canonical definitions live in `specs/02-data-model.md`; **this module defines no table and renames
none.** Every name below is spec 02's. Where this module needs something spec 02 does not yet have, it
is marked as *requested* here and listed in Open question 3 — it is never silently assumed, and no
migration is written from this file.

**D1 written.** `food_entries` (`local_day`, `eaten_at`, `slot`, `food_id` FK, `photo_id` FK, `label`,
`grams` REAL, `kcal`/`protein_g`/`carb_g`/`fat_g`/`fiber_g` INT, `ai_estimate_json`, `corrected_json`,
`confidence`, `ai_log_id` FK, `confirmed_at` — **NULL means draft**, so there is no `status` column;
plus *requested* `basis` and `source`). `foods` (the per-100 columns, `serving_grams`, `serving_label`,
`source`, `source_id`, `fetched_at`, `verified_by_user`, `confidence`, `micronutrients_json`; plus
*requested* `basis`, `energy_source`, `is_favourite`, `sat_fat_100g`). `ai_prompt_logs` (rule 48).
`water_logs` (`local_day`, `logged_at`, `ml` INT). `meals` + `meal_items` (**not** `meal_templates`).
`fasting_sessions` (*requested, new table*). `tdee_snapshots` (**not** `tdee_estimates`:
`week_ending_day` U, `tdee_est`, `tdee_data`, `prior`, `prior_method`, `blend_w`, `complete_days`,
`weigh_ins`, `capped`, `trend_start_kg`, `trend_end_kg`, `mean_intake_kcal`, `computed_at`; plus
*requested* `span_days` and `status`) — appended by spec 14's Monday step, never by us, and never
UPDATEd. There is **no `nutrition_targets` table**: `dailyTargets()` is pure and re-derivable at read
time from the newest `tdee_snapshots` row plus `settings` plus the trend, all already persisted, so a
history table would only add a second source of truth for a derived number.

**D1 read.** `body_measurements` (`weight_kg`, persisted `trend_kg`, `trend_excluded`); `settings`
(`locale`, `unit_system`, `ai_provider` display-only, plus *requested* `activity_factor`,
`goal_rate_kg_per_week`, `protein_g_per_kg`, `min_fat_g_per_kg`); `photos` (spec 10); `users` (`sex`,
`birth_day`, `height_cm`, for the prior).

**Indexes depended on**, by spec 02's real names: `food_entries_local_day_eaten_at_idx` (P10 — the day
view, the recents query and the TDEE intake series all filter `local_day`, which is why there is no
`food_entries(eaten_at)` index and none is needed), `food_entries_photo_id_idx`, `foods_barcode_idx`
(P13), `foods_source_source_id_uq` (the OFF/FDC upsert key — there is no `fdc_id` column and no
`foods(fdc_id)` index; an `fdcId` persists as `source_id`), `water_logs_local_day_idx`,
`ai_prompt_logs_created_at_idx`, `tdee_snapshots_week_ending_day_uq`, plus the *requested*
`ai_prompt_logs_prompt_version_model_idx`.

**KV (`NUTRITION_CACHE`).** `off:p:v2:<gtin13>` (30 d), `off:m:v2:<gtin13>` (1 d — minimum
`expirationTtl` is 60 s, G22), `off:q:v2:<sha256hex>` (7 d, text search), `fdc:f:v1:<fdcId>` (90 d),
`fdc:q:v1:<sha256hex>` (90 d), `ai:spend:<YYYY-MM>` (35 d). **Raw upstream JSON** is cached, not our
mapped shape, so a mapping bug is fixable by redeploy with no re-fetch. No rate-limit keys — rule 51
uses `AI_LIMITER`.

**R2 (`MEDIA`).** `photos/food/{yyyy}/{mm}/{ULID}/ai.jpg` (the exact vision input and the `input_ref`
value; key built by spec 10's `photoKey()` with `variant:"ai"`), `ai-logs/{yyyy}/{mm}/{id}.json`
(oversized log payloads, rule 48), plus `display.*`/`thumb.*` written by spec 10. Static asset
`/wasm/zxing_reader.wasm` from `public/`, served as `Content-Type: application/wasm`.

**Secrets and vars.** Vars `AI_PROVIDER`, `APP_TZ`, and optional `AI_MONTHLY_BUDGET_USD` (default
`"5.00"`). Secrets `GOOGLE_GENERATIVE_AI_API_KEY` and `FDC_API_KEY`, both already in spec 01's env-var
contract, plus the *requested* `AI_CORRECTION_SIGNING_KEY` (≥ 32 bytes, rule 19).

**IndexedDB (schema owned by spec 05; this module adds rows, not stores).** Drafts and saved entries
are `mirror` rows on `food_entries`; resolved foods are `mirror` rows on `foods` (pull-only —
*requested*); the queued AI JPEG is a `blobs` row created by `writeLocal`'s `blob` argument; the queued
GTIN lookup and every write are `outbox` ops. There are no `pendingEstimates`, `pendingEntries`,
`waterQueue`, `fastState` or `recentFoods` stores: spec 05 Behaviour 17 fixes the four stores and the
rule "one generic `mirror` store, **not one store per entity: a new feature adds rows, not a
schema**".

## UX notes

- **Capture → correction is a bottom sheet, never a route change** — pushing the day view behind a
  navigation makes "cancel" feel destructive. `85vh`, drag-to-dismiss, confirm once edits exist.
- `CaptureSheet` coaches **before** the shutter, because rule 15's cap is otherwise guaranteed on the
  first attempt and the OS camera gives us no surface once it is open: a one-line hint «Положите рядом
  ложку или банковскую карту — так оценка точнее» above the capture button, and after any estimate
  with `size_reference_missing` a one-tap «Переснять с ложкой» that repeats it. That is the brief's
  "ask for a reference object when possible", which a post-hoc confidence penalty is not.
- Correction rows collapse to one line (name · `≈`kcal · grams) and expand on tap; the save button is
  pinned to the bottom **inside** the safe-area inset so it stays in one-handed thumb reach with the
  keyboard open.
- Grams is a stepper **and** a slider bounded by `grams_low × 0.5 … grams_high × 2`: the commonest
  correction is "more than that", so it must be one gesture. Rule 15 already drops any item with
  `grams <= 0`, so a degenerate `0 … 0` range cannot arrive from the model; if the user zeroes a field
  by hand the slider falls back to `0 … 500` and the stepper stays authoritative.
- Haptics: light on a successful decode and on each water chip; **success** notification haptic on
  save; **warning** on a budget-blocked or refused estimate. None when the estimate merely arrives —
  that is not an achievement.
- Animation: the confidence badge cross-fades out of a shimmer during the call; item rows stagger at
  40 ms; the macro ring animates from its previous value, not zero. All skipped under
  `prefers-reduced-motion`.
- Skeletons, not spinners: three ghost rows at the real row height during the call so nothing shifts
  when items arrive. The scanner shows a dimmed viewfinder cut-out with a pulsing scan line, keeps the
  screen awake, and remembers torch state for the session only.
- a11y, against the brief's WCAG 2.1 AA NFR. The `≈`/confidence badge carries an `aria-label` spelling
  it out («приблизительно, низкая уверенность»), because the glyph alone means nothing to a screen
  reader; every grams field has a visible `<label>`; the arriving estimate is announced via
  `aria-live="polite"`; colour is never the only carrier of confidence (band word + icon). **Contrast
  is stated, not assumed:** each of the three band colours from spec 03 must reach **≥ 4.5:1 against
  the OLED-black canvas** for its text and ≥ 3:1 for its icon and border — a lime/amber/red scheme on
  `#000` is exactly where that fails, and it is asserted in spec 03's token tests rather than
  eyeballed. **Every pointer-only interaction has a non-pointer equivalent:** the custom water amount
  is a visible «Другое» button (long-press is only an accelerator), the scanner offers a «Ввести код
  вручную» text field reachable by keyboard and screen reader, and the fasting timer is
  `aria-live="off"` with an adjacent «Сколько прошло?» button that announces elapsed time on demand —
  a per-second live region would either flood a screen reader or be silently unusable. Targets
  ≥ 44 px, ≥ 56 px under gym-mode styling.

## Risks

| Risk | Mitigation |
|---|---|
| Gemini rejects our schema (`anyOf` from a nullable) and *every* estimate fails in production | Rule 14 + a CI test asserting the **transmitted** artefact (`toWireSchema`, i.e. the SDK's own `zodSchema().jsonSchema`) has no `anyOf`/`oneOf`/`allOf`/`$ref`/`"type":[`/`minimum`/`maximum`, plus the opt-in live smoke call |
| A helper reaches for `getCloudflareContext()` and the weekly coach job dies at 08:05 with nobody watching | `ctx` threaded as the first parameter everywhere (rule 4); a grep gate forbids `@opennextjs/cloudflare` under `src/lib/ai/` and `src/server/` |
| Under-estimation deflates intake → inflates TDEE → raises the target: a self-reinforcing wrong answer | Rules 21–22 (copy + measured delta) plus rule 39's complete-days filter and matched Δtrend span; `aggregateBias()` reviewed before any prompt change |
| An upstream label correction rewrites history and moves the target for no visible reason | Snapshot columns on `food_entries`; displayed history never joins back to `foods` (r08 §5.4) |
| `energy_100g` read as kcal → everything 4.18× high but plausible | One pure mapper, with a test pinning Nutella `energy-kcal_100g = 539` against `energy_100g = 2227.9` |
| One barcode resolves differently on different days (OFF 244 vs FDC 267 kcal/100 g) | Fixed precedence, never a race; `source` + `source_id` per entry (G15) |
| `zxing-wasm` fetches its wasm from jsDelivr → no offline scan, CSP block, console-only failure | Mandatory `locateFile`, `public/wasm/` from a build script, Serwist precache, a smoke test on the served `Content-Type` |
| TDEE sign error (`+` for `−`), or a 28-day Δtrend divided by 20 complete days | Spec 07 owns the arithmetic and asserts `≠ 2202.5`; this spec's `tdee-window` vector asserts the mixed-divisor value `2796.5` is **not** produced |
| A retry loop burns the month's budget in an afternoon | Pre-flight gate, **one** retry mechanism with a hard ceiling of 2 paid calls per photo (rule 7), `AI_LIMITER` 12/60 s, hard 402 at 100% |
| OFF IP-bans shared Cloudflare egress, with no 429 and no `Retry-After` | D1/KV first, ~1 req/2 s self-cap, 429 **and** 503 → serve stale, a real contact e-mail in the UA (G16) |
| Offline drafts leak into TDEE intake and read as fasting days | `confirmed_at IS NULL` excluded at query level in `buildTdeeWindow` and in day totals; unit-tested |
| `usage.inputTokens` is `undefined` and the month looks free | `tokens_missing` flag (rule 6) + `cost_usd` always written as a number, so verification query 10 is a real gate |
| A forged `X-Photo-Id` writes outside the food prefix or forges `input_ref` | Zod ULID check before any key construction; `{yyyy}/{mm}` derived server-side on the write path (rule 10) |

## Verification

```bash
npm run typecheck && npm run lint                         # 1. next typegen + tsc + eslint, as CI runs them
# 2. THE provider-isolation rule. PASS = no output.
grep -rnE "from ['\"](ai|@ai-sdk/)" src --include='*.ts' --include='*.tsx' | grep -v '^src/lib/ai/'
# 3. NO helper may reach for the request context. PASS = no output.
grep -rn "@opennextjs/cloudflare" src/lib/ai src/server | grep -v 'request-client'
grep -rnE "gemini-(flash|flash-lite|pro)-latest" src      # 4. no floating alias. PASS = no output.
npx vitest run tests/unit/nutrition tests/unit/ai         # 5. the vectors below
```

Named unit cases that must pass:

- **`gtin`** — `"013764027053"→"0013764027053"`, `"722252601704"→"0722252601704"`, 8-digit unchanged,
  `"0000000000000"→null`, non-digits stripped; `gtinCheckDigitOk("3017624010701")===true`.
- **`off`** — Nutella `3017624010701`: `kcal_100g===539`; the same fixture minus `energy-kcal_100g`
  resolves from `energy-kj_100g` to `toBeCloseTo(532.480879541109, 9)`, asserted `< 600` and **never**
  `2227.9`; `serving_grams===null` ⇒ no `*_serving` read. Bread `0013764027053`: `kcal_100g===244`,
  `serving_grams===45`, `sodium_mg_100g` is `toBeCloseTo(377.78, 6)` (OFF stores `0.37778` grams).
- **`fdc`** — a `208` fixture picks 208; a `fdcId 2647443`-shaped fixture with no 208 picks `958→352`
  and sets `energySource==="958"`; a macros-only fixture computes `4P+4C+9F`; search shape
  (`unitName:"KCAL"`,`value`) and detail shape (`nutrient.unitName:"kcal"`,`amount`) give identical
  output; `'GRM'`→grams, `'MLT'`→not grams.
- **`basis`** — `scaleFromPer100({kcal:244,servingGrams:45},45).kcal===109.8` (multiply-then-divide;
  the order is pinned in rule 31 because it is not generally interchangeable);
  `per100FromServing({kcal:110},45,"100g").kcal===244.44444444444446`; `servingsToQuantity` throws on
  a null `servingGrams`; a `basis:"100ml"` food never converts to grams.
- **`normalize`** — confidence `1.4→1.0` tagged `clamp_confidence`; `size_reference_missing:true` with
  `mode:"photo"` caps overall at `0.50` and items at `0.60`, and with `mode:"text"` caps **neither**;
  an item with `kcal:250, protein_g:5, carb_g:5, fat_g:2` (Atwater 58) is tagged `atwater_mismatch`
  with its confidence capped at `0.40`; an item with `grams:0, kcal:250` is **dropped**;
  `grams_low > grams_high` repaired; a `total_kcal` 10% off the item sum is replaced and tagged
  `total_mismatch`; every item has a unique `itemUid`.
- **`delta`** — `ai 520 → corrected 700` gives `deltaKcal 180`,
  `deltaPct === 0.34615384615384615`, `kind:"edited"`; `aiKcal 0` gives `deltaPct===null`; a removed
  item gives `kind:"items_removed"`; `aggregateBias` over the five (`correctedGrams`, `deltaPct`)
  points `(100,0.10) (200,0.20) (300,0.30) (400,0.40) (500,0.50)` returns `slopeVsGrams`
  `toBeCloseTo(0.001, 12)` and `interceptPct` `toBeCloseTo(0, 12)`; `n = 2` returns
  `slopeVsGrams === null`.
- **`targets`** — `tdee 2697.5`, rate `−0.5 kg/wk`, trend `81.5 kg`, protein `1.8 g/kg`, minFat
  `0.8 g/kg`, priorRmr `1787.5`: `kcal===2148`, `proteinG===147`, `fatG===65`, `carbG===244`,
  `fiberG===30`, `waterMl===2853`, `floored===false`. These are **hand-computed literals, never
  re-derived in-test from rule 37's formulas** — a test that re-runs the implementation asserts
  nothing. `4×147 + 9×65 + 4×244 === 2149` is asserted within 1 kcal of `kcal`, which is what the
  round-then-subtract order buys. Floor case: `tdee 1600`, rate `−1.0 kg/wk`, priorRmr `1400` ⇒ raw
  `500`, `kcal===1540`, `floored===true`.
- **`tdee-window`** — `buildTdeeWindow` reproduces the 4-week worked example in
  `docs/research/r09-formulas-and-test-vectors.md` §5 **as inputs to spec 07**: `meanIntakeKcal
  2500/2480/2460/2450`, `trendStartKg 82.400`, `trendEndKg 82.300/82.050/81.800/81.500`,
  `spanDays 7/14/21/28`, `completeDays 7/14/21/28`. **The two-divisor guard:** 28 logged days of which
  20 are complete, anchors at day 1 and day 28, `Δtrend = −0.900`, `meanIntakeKcal 2450` ⇒
  `spanDays === 28` while `completeDays === 20`, and
  `tdeeFromEnergyBalance(2450, 82.4, 81.5, spanDays) === 2697.5`, asserted **not** `2796.5` (the
  `completeDays` divisor) and **not** `2202.5` (the sign bug). **The zero-median guard:** 10 logged
  days of 28 at 2400 kcal each and 18 with no entries ⇒ `loggedDays === 10`,
  `medianIntakeKcal === 2400`, `completeDays === 10` — **never 28** — and `meanIntakeKcal === 2400`,
  not `857.1`. A day whose only entry has `confirmed_at IS NULL` counts as unlogged.
  `loggedDays === 0` ⇒ `medianIntakeKcal === null`, `completeDays === 0`, `spanDays === 0`,
  `meanIntakeKcal === null`, and no division is performed. `tdeeCardCopy` returns
  `showsNumber:false` only for `NO_PRIOR`, and `numberIsMeasurement:false` for both `INSUFFICIENT_*`.
- **`cost`** — `estimateCostUsd({inputTokens:870,outputTokens:450},{inPerMTok:0.30,outPerMTok:2.50})`
  is `toBeCloseTo(0.001386, 12)` (robust to either evaluation order, while rule 6 pins the order);
  `undefined` tokens give `0` and set `tokensMissing`; `budgetTier(4.05,5)==="degrade"`;
  `budgetTier(5.00,5)==="blocked"`.
- **`provider`** — `AI_MODELS.google.vision.primary.id==="gemini-3.5-flash-lite"`; every id matches
  `/^gemini-\d/` and none ends in `-latest`; `getVisionModel({ AI_PROVIDER:"anthropic" } as never)`
  without `AI_MODEL_VISION` **throws at call time** with `details.reason === "ai_config_missing"`,
  while merely importing `provider.ts` with an empty env throws nothing.
- **`call`** — one `ai_prompt_logs` row per attempt, `attempt` 1 then 2, each with its own `cost_usd`;
  a `content-filter` finish maps to `{kind:"refused"}` with **no** second attempt; a
  `NoObjectGeneratedError` retries exactly once then returns `{kind:"invalid_output"}`; a 429 maps to
  `{kind:"rate_limited"}` with no retry; `cost_usd === 0` (never null) on a budget block; and the
  `instructions` string **reaches the model call**, asserted against a spy provider so that a wrong
  option name cannot silently drop the whole prompt.
- **`schema-wire`** — `JSON.stringify(toWireSchema(FoodEstimateSchema))` contains none of `"anyOf"`,
  `"oneOf"`, `"allOf"`, `"$ref"`, `"type":[`, `"minimum"`, `"maximum"`; the same assertion on
  `z.toJSONSchema(FoodEstimateSchema,{io:"output"})` is kept as a cheap secondary. The provider's own
  converter (`@ai-sdk/google` `dist/index.js:373-403`) is not publicly exported, so this test asserts
  on its **input**; the only end-to-end proof is
  `AI_LIVE=1 npx vitest run tests/unit/ai/live.test.ts` — one real `generateObject` against a 1×1
  JPEG, **skipped by default**, run by hand before any schema change.
- **`resolve`** (fetch mocked, no network) — precedence hits each rung in order and stops: a
  `verified_by_user` row wins with confidence 1.0 and issues **zero** fetches; a D1 row older than
  30 d returns `stale:true` and still answers first; the three OFF branches (200 with `status:0` ⇒
  `not_found`, 404 ⇒ wrong product type, 200 with nutriments ⇒ hit); **429 and 503 both** return the
  stale D1 row rather than an error; `fdcGtinCandidates` issues the padded **and** unpadded query and
  a hit on either resolves; a candidate with `kcal:null` is rejected before it reaches `foods`.

```bash
# 6. Live upstream contract (no key needed). PASS = 539
curl -s -H 'User-Agent: TairFitness/1.0 (tairkaldybayev@gmail.com)' \
 'https://world.openfoodfacts.org/api/v2/product/3017624010701?product_type=food&fields=code,product_name,nutriments' \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).product.nutriments["energy-kcal_100g"]))'
# 7. FDC — skip when FDC_API_KEY is unset (DEMO_KEY measures 10/h, not the documented 30/h; G26). PASS = "208 134 kcal"
curl -s "https://api.nal.usda.gov/fdc/v1/food/174608?api_key=$FDC_API_KEY" \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s).foodNutrients.find(n=>n.nutrient.number==="208");console.log(f.nutrient.number,f.amount,f.nutrient.unitName)})'
# 8. Preview: the wasm is served correctly. `npm run preview` BUILDS first, so build, serve, THEN poll
#    — a backgrounded `npm run preview & curl` races the OpenNext build and always fails. Port 8787 is
#    what `opennextjs-cloudflare preview` (wrangler dev) uses, as specs 01/04/05/09 and r01 §3 do.
node scripts/copy-zxing-wasm.mjs && npx opennextjs-cloudflare build
npx wrangler dev --port 8787 &
until curl -sf -o /dev/null http://localhost:8787/ ; do sleep 1 ; done
curl -sI http://localhost:8787/wasm/zxing_reader.wasm | grep -i '^content-type'   # PASS application/wasm
# 9 + 10 are deterministic: the fixture inserts one AI entry plus one row per outcome, so neither
#   query depends on a human having exercised the app by hand first.
npx wrangler d1 execute fitness-pwa-db --local --file tests/fixtures/nutrition-seed.sql
# 9. A saved entry keeps BOTH representations. PASS = 1 row, ai_kcal and delta_kcal non-null.
npx wrangler d1 execute fitness-pwa-db --local --command \
 "SELECT e.id, e.kcal, json_extract(e.ai_estimate_json,'\$.items[0].kcal') ai_kcal, l.delta_kcal, l.outcome
  FROM food_entries e JOIN ai_prompt_logs l ON l.id = e.ai_log_id
  WHERE e.ai_estimate_json IS NOT NULL ORDER BY e.local_day DESC, e.eaten_at DESC LIMIT 1;"
# 10. Every call priced and logged, failures included. PASS = >1 outcome, null_cost = 0 everywhere.
npx wrangler d1 execute fitness-pwa-db --local --command \
 "SELECT outcome, COUNT(*) n, SUM(cost_usd IS NULL) null_cost FROM ai_prompt_logs GROUP BY outcome;"
npx playwright test tests/e2e/nutrition-photo.spec.ts    # 11. E2E, estimate-photo stubbed
```

E2E assertions that define PASS: save is **disabled** until a field changes or «Всё верно» is ticked
(rule 19); the rendered kcal string starts with `≈`; the under-estimation hint is in the DOM with no
dismiss control and contains **no percentage**; the pre-capture reference hint is in the DOM before
the shutter; after save `food_entries` holds one row whose `kcal` is the edited value while
`ai_estimate_json` still holds the original and `confirmed_at` is non-null; a stubbed `is_food:false`
creates **no** entry; a save whose body is structurally unchanged and carries no `confirmedUnchanged`
gets `409`; a barcode save with **no** `correctionToken` succeeds; a timeout retry sends an empty body
with `X-Photo-Id` + `X-Local-Day` and the R2 `put` count stays at 1; a stubbed 402 renders the
budget-exhausted copy with a working manual-entry link.

## Open questions

1. **Should spec 07 refuse a number below 3 logged days?** (a) Leave spec 07 rule 27 as it is: at
   `completeDays = 1` it returns `INSUFFICIENT_INTAKE_DAYS` with `tdeeKcal = prior`, and rule 40's
   copy labels that «формула, не измерение». (b) Add a `NO_DATA` status to spec 07 returning
   `tdeeKcal: null` until `completeDays >= 3` (r09 §5: "Algorithms begin updating on the third day").
   **Recommendation (b)**, as a change request to spec 07 — a prior shown on day 1 is the most
   confidently wrong number in the app — but **(a) is what ships until spec 07 changes**, because a
   second ladder in this module is worse than a slightly early number. Decide with spec 07's owner.
2. **Spec 07 needs `spanDays` on `TdeeInput`.** `tdeeFromEnergyBalance(mean, tStart, tEnd, days)`
   currently receives `completeDays` (spec 07 rules 26–28, and its `TdeeInput` has no span field),
   while `trendStartKg`/`trendEndKg` span the calendar window — the ~99 kcal/day inflation in rule
   39(b). Requested: one field `spanDays` on `TdeeInput`, used as the divisor, with `completeDays`
   kept for the blend weight and the guards. Until it lands, `buildTdeeInput()` returns `spanDays`
   alongside the spec-07 shape and spec 14's Monday step must pass it through. A naming drift to
   settle in the same pass: the week key is `tdee_snapshots.week_ending_day` in spec 02,
   `week_ending` in spec 07 §Data, `weekEndingDate` in spec 14 rule 15 and `week_ending_date` in spec
   14's verification — **spec 02's `week_ending_day` is the name this spec uses.**
3. **Schema additions requested from spec 02 (and two from spec 05).** All are additive — a new table,
   or new nullable / constant-default columns and indexes — so spec 02 rule 21 needs no
   breaking-change approval. Nothing here may be written until they ship.
   - `food_entries` + `basis` TEXT ∈ `{100g,100ml}` default `'100g'`, `source` TEXT ∈ `FOOD_SOURCES`.
   - `foods` + `basis` TEXT default `'100g'`, `energy_source` TEXT, `is_favourite` INTEGER default
     `false`, `sat_fat_100g` REAL.
   - `settings` + `activity_factor` REAL default `1.55`, `goal_rate_kg_per_week` REAL default `0`,
     `protein_g_per_kg` REAL default `1.8`, `min_fat_g_per_kg` REAL default `0.8`.
   - `tdee_snapshots` + `span_days` INTEGER, `status` TEXT (spec 07's `TdeeStatus`).
   - `ai_prompt_logs` + `outcome` TEXT, `schema_name` TEXT, `attempt` INTEGER default `1`, `locale`
     TEXT, `tokens_missing` INTEGER default `false`, `finish_reason` TEXT, `repairs_json` TEXT
     `C(len≤65536)`, `degraded` INTEGER default `false`, `entry_id` TEXT, `delta_kcal` INTEGER,
     `delta_pct` REAL, and index `ai_prompt_logs_prompt_version_model_idx` on
     `(prompt_version, model)`.
   - **new table** `fasting_sessions`: `id` pk, `started_at`, `ended_at?`, `target_seconds?`,
     `preset?` ∈ `{16_8,18_6,20_4,omad,custom}`, `local_day`, `...syncCols()`, `I(started_at)`. The
     "at most one open fast" invariant wants a partial unique index on
     `(1) WHERE ended_at IS NULL`; if SQLite/drizzle-kit will not emit that, it is enforced at the
     write boundary only and spec 02 should say so explicitly.
   - From **spec 05**: `foods` added to the `MirrorTable` union as **pull-only**, and one new
     `OP_TYPES` member for the queued offline barcode lookup (proposed `"food.resolve"`) with its
     `OP_SCHEMAS` entry. Rule 28 cannot ship without both.
4. **Three small contract corrections to spec 01, as one amendment.** (a) Its env table says
   "specs/11 throws at boot if one is missing"; on workerd there is no boot with access to bindings,
   so the wording must become "throws on first use inside a request or job" (rule 3). (b)
   `NUTRITIONIX_*` is listed as "owned by specs/11", but rule 33 uses no Nutritionix API — remove the
   row. (c) Add `AI_CORRECTION_SIGNING_KEY` (≥ 32 bytes, `wrangler secret put`, `.dev.vars` locally)
   as a secret, exactly as spec 10 added `PHOTO_URL_SIGNING_KEY` in its amendment 01.1.
   **Recommendation: all three.**
5. **Who owns the two things rule 24 needs?** `'wasm-unsafe-eval'` in `script-src` is asserted by no
   spec — spec 04 attributes CSP to spec 01, spec 01 has no CSP section, and this file is the only one
   in `specs/` that mentions `script-src` — and the `/wasm/zxing_reader.wasm` precache entry is a
   change to spec 05's Serwist manifest that spec 05 does not mention. **Recommendation:** CSP ⇒ spec
   01 (one directive in the response-header helper); precache ⇒ spec 05, **as a precache and not a
   runtime `CacheFirst` route**, because r08 §5.5 calls the 402 KiB "deliberate, and worth it"
   precisely so the fallback works in a shop with no signal — a runtime cache is empty exactly then,
   and the primary Android target never populates it because it has native `BarcodeDetector`. Without
   both, the iOS scanner fails silently in the console, which is the worst available outcome.
6. **Protein target default.** (a) 1.8 g/kg of trend weight (mid of the commonly cited 1.6–2.2 band;
   we verified no primary source, so it stays UNVERIFIED in rule 37's table). (b) A percent of kcal,
   e.g. 30%, which self-adjusts to the deficit. **Recommendation (a)**, exposed in Settings with the
   band shown: protein needs scale with body mass rather than with the calorie target, and in a
   deficit (b) would *lower* protein exactly when it should not.
7. **Vision tier for the default path.** (a) `gemini-3.5-flash-lite` ($0.30/$2.50), ~$0.0014/photo,
   ~$0.13/month at 3 photos/day. (b) `gemini-2.5-flash-lite` ($0.10/$0.40), 5× cheaper but older.
   **Recommendation (a):** the absolute cost is negligible and accuracy is the whole product, and (b)
   already exists as the automatic `degrade` tier. The previous version of this question leaned on the
   doi `10.1016/j.cdnut.2025.107556` Gemini-1.5 figure; rule 21 now marks that UNVERIFIED-secondary,
   so it is **not** evidence here and the recommendation rests on cost alone.
8. **Monthly AI cap.** (a) $5.00 — matches the Workers Paid line item, ~35× projected usage.
   (b) $1.00 — still ~8× projected, catches a runaway loop sooner. **Recommendation (a)**, with the
   50% warn banner doing the early-warning job: a $1 cap risks a real refusal during a heavy logging
   week, and refusing the flagship feature is worse than a dollar.
