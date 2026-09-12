# 07 — Pure calculation library and its unit tests

## Purpose

`src/lib/calc/` is the only home for the formulas listed below: e1RM, the RPE chart, US Navy body
fat, EMA trend weight, adaptive TDEE, plate math, warm-up ramps, volume/hard-set/muscle-credit
counting, `Asia/Almaty` calendar windows, per-muscle recovery, and the readiness score. It is not the
only place arithmetic happens — spec 11 owns the calorie/macro target math and its kcal-per-gram
constants, spec 13 owns the whole streak/adherence state machine, spec 06 owns effective load and
the increment ladder. Every function here is pure — no I/O, no `Date.now()`, no `Intl` — so the
brief's acceptance line *"All calculators covered by passing unit tests"* is satisfiable by one fast
vitest project at a 100% coverage floor. Every number has a verified provenance or an explicitly
labelled convention, per
[`docs/research/r09-formulas-and-test-vectors.md`](../docs/research/r09-formulas-and-test-vectors.md)
(cited below as r09 §n).

Every guarantee in this spec holds **inside a declared magnitude domain** (rule 3). Outside it every
function returns `null`; that is what makes "never `NaN`, never `±Infinity`" true rather than
aspirational.

## Scope

One file per concern under `src/lib/calc/`, re-exported from `index.ts`; one invalid-input policy,
one magnitude domain and one rounding policy applied everywhere (rules 1–7); every constant carrying
a unit and a provenance tag (`verified` / `convention` / `UNVERIFIED`); every time-dependent function
taking `nowMs: number` as its **first parameter, or as the first field of its single input object**;
and the unit suite with its r09 fixtures.

### Out of scope

| Excluded | Owner |
|---|---|
| D1 tables/columns/indexes, the `local_day` column convention, the enum member lists | `02-data-model.md` |
| Number/date **display** formatting, units in copy, locale digits, contrast and tap-target floors | `03-design-system.md` |
| `messages/{ru,en}.json` copy keys and their strings | `01-architecture.md` |
| Calling `e1rm` at set-write time, PR detection, `effectiveLoadKg`, the `Equipment`-keyed tables (`INCREMENTS`, `REST_DEFAULT_SEC_BY_EQUIPMENT`), calculator UI, ghosting | `06-workouts.md` |
| Muscle taxonomy, `shoulders` → front/side/rear delt mapping, exercise import | `08-exercise-library.md` |
| Progression schemes / deloads that *consume* `plateMath` + `e1rm` | `09-programs.md` |
| Measurement form, trend chart, recompute-on-backfill trigger | `10-body-photos.md` |
| Intake logging, the weekly TDEE Cron job, `tdee_snapshots` persistence, window assembly (`buildTdeeWindow`) | `11-nutrition-ai.md` |
| **Calorie/macro target math and its kcal-per-gram constants** (`4×proteinG`, `9×fatG`, `7700/7`, 1.8 g/kg, 35 ml/kg, the target floor) | `11-nutrition-ai.md` |
| Heatmaps, under-trained flags, chart windows | `12-analytics-dashboard.md` |
| **All streak and adherence arithmetic and state** — grace/freeze/decay/restore, `applyDay`, `adherence()`, XP — and all copy | `13-gamification.md` |
| Pre-2024 timezone conversion of imported CSVs | `15-data-portability.md` |
| Zod schemas at the HTTP edge (calc takes plain objects, zero runtime deps) | `06`, `11` |
| vitest projects/coverage thresholds, `eslint.config.mjs`, `tests/vectors/r09.json`, CI | `16-testing-ci-quality.md` |

## Files to create

| Path | Responsibility |
|---|---|
| `src/lib/calc/constants.ts` | Every magic number, once, with unit + provenance comment (r09 §9). Includes the three constants spec 02's schema depends on: `PR_EPSILON_KG`, `MAX_REPS_FOR_E1RM`, `BRZYCKI_MAX_REPS`. |
| `src/lib/calc/types.ts` | `Sex`, `SetType`, `LoadMode`, `Equipment`, `MuscleRole`, `E1rmSource`, `CalcSet`, `MuscleCredit`, `PlateInventory`, `LocalDate`, statuses. |
| `src/lib/calc/num.ts` | `isFiniteNum`, `isPos`, `isPosInt`, `clamp`, `clamp01`, `inDomain` + the domain constants — the rule-1/rule-3 guards. |
| `src/lib/calc/round.ts` | `roundHalfUp(x, dp)`, `toGrams`, `fromGrams`. Half-up is load-bearing (r09 §2, §4). |
| `src/lib/calc/e1rm.ts` | `epley`, `brzycki`, `e1rmFromRpe`, `e1rm` (capped composite) + `E1rmSource`. |
| `src/lib/calc/rpe.ts` | `NRM`, `nRM(k)`, `pct1RM(reps, rpe)`, `rirFromRpe`, `rpeFromRir`, `effectiveRir`. |
| `src/lib/calc/bodyfat.ts` | `navyBodyFatPct` (metric only, both sexes), `leanMassKg`. |
| `src/lib/calc/trend.ts` | `emaStep`, `trendWeight` (gap-aware EMA + outlier flagging). |
| `src/lib/calc/energy.ts` | `mifflinStJeor`, `mifflinStJeorCombined` (`@internal`), `katchMcArdle`, `applyActivityFactor`. |
| `src/lib/calc/tdee.ts` | `tdeeFromEnergyBalance`, `blendTdee`, `capWoW`, `adaptiveTdee` (4 statuses + suspect flag). |
| `src/lib/calc/plates.ts` | `minIncrementKg`, `maxAchievableKg`, `achievableTotals` (bounded lattice), `plateMath`. |
| `src/lib/calc/warmup.ts` | `warmupSets` — ramp × top working weight, rounded down onto the lattice. |
| `src/lib/calc/volume.ts` | `setVolumeKg`, `totalVolumeKg`, `isCountedSet`, `isHardSet`, `creditForRole`, `volumeByMuscle`, `hardSetsByMuscle`. |
| `src/lib/calc/time.ts` | `almatyOffsetMinutes`, `almatyOffsetMinutesForDate`, `localDateFromInstant`, `startOfLocalDayMs`, `endOfLocalDayMs`, `nextLocalDate`, `dayIndex`, `diffDays`, `localDateRange`, `rolling7dWindow`, `isoWeekKey`. |
| `src/lib/calc/recovery.ts` | `muscleRecovery` — per-muscle 0..1 recovery from recent credited hard sets (brief module 6). |
| `src/lib/calc/readiness.ts` | `readinessScore`, `readinessParts`. |
| `src/lib/calc/index.ts` | Barrel. The only import path callers use: `@/lib/calc`. |
| `scripts/check-calc-purity.mjs` | Shell-agnostic purity gate (rule 1). Node, zero deps; strips comments and string literals, then asserts the banned constructs are absent. Invoked in CI by spec 16. |
| `tests/calc/fixtures/vectors.ts` | Typed loader over spec 16's `tests/vectors/r09.json`; the only place a test names a file path. |
| `tests/calc/{e1rm,rpe,bodyfat,trend,energy,tdee,plates,warmup,volume,time,recovery,readiness}.test.ts` | One spec per source module, vectors per the Verification tables. Flat under `tests/calc/` because spec 16 §1 puts them there. |
| `tests/calc/invariants.test.ts` | Cross-cutting property/fuzz checks: nothing throws, nothing returns `NaN`/`Infinity`, the domain guard holds. |

Spec 16 §2 forbids a calc test from hardcoding an expected number absent from `tests/vectors/r09.json`.
The vector groups this spec invents rather than transcribes — `readiness`, `recovery`, `domain`,
`time.tzTransition`, `plates.aboveMax` — are contributed to that file each carrying
`source: "specs/07-calculators.md rule N"`, so the oracle stays one file and the invented numbers stay
visibly invented.

## Interfaces

Signatures only. Units are in the names or the comments; nullability is exact. No Zod here — calc has zero runtime
dependencies and validates nothing at the edge (specs 06/11 own the request schemas).

```ts
// types.ts — member lists are copied from specs/02-data-model.md `src/db/enums.ts` and must not drift
export type Sex = 'male' | 'female';
export type SetType = 'warmup' | 'working' | 'drop' | 'failure' | 'amrap';
export type LoadMode = 'external' | 'bodyweight' | 'bodyweight_plus' | 'assisted' | 'duration' | 'distance';
export type Equipment = 'barbell' | 'dumbbell' | 'ez_bar' | 'cable' | 'machine' | 'kettlebell'
  | 'resistance_band' | 'medicine_ball' | 'exercise_ball' | 'foam_roller' | 'bodyweight'
  | 'other' | 'unknown';
export type MuscleRole = 'primary' | 'secondary';
export type E1rmSource = 'actual_single' | 'epley' | 'brzycki' | 'rpe';
export type LocalDate = string;                 // 'YYYY-MM-DD' in Asia/Almaty. Never a Date.
export type CalcSet = {                         // already unit-normalised: kg + integer reps
  exerciseId: string; type: SetType;
  weightKg: number;                             // the already-resolved EFFECTIVE load in kg
                                                // (spec 06 `effectiveLoadKg`); 0 only when the
                                                // exercise genuinely has no load. NOT raw weight_kg.
  reps: number;                                 // integer in [0, MAX_REPS]
  rpe: number | null;                           // 1..10 in 0.5 steps (spec 02 `sets_rpe_range`), or null
  rir: number | null;                           // 0..9; authoritative for hard-set classification (rule 17)
};
export type MuscleCredit = { muscle: string; credit: number };            // credit in (0, 1], from spec 08
export type PlateInventory = ReadonlyArray<readonly [number, number]>;    // [plateKg, pairsAvailable][]
export type PlateStatus = 'EXACT' | 'ROUNDED' | 'BELOW_BAR' | 'ABOVE_MAX' | 'NO_INVENTORY';

// num.ts — the guards, and the magnitude domain every other guarantee is conditional on (rule 3)
export const MAX_WEIGHT_KG = 1000;              // spec 02 `sets_weight_sane` CHECK (BETWEEN 0 AND 1000)
export const MAX_REPS = 500;                    // spec 02 `sets_reps_sane` CHECK (0..500)
export const MAX_LENGTH_CM = 300;               // heights and tape girths
export const MAX_KCAL_PER_DAY = 20_000;         // intake, RMR, TDEE, priors
export const MAX_EPOCH_MS = 4_102_444_800_000;  // 2100-01-01T00:00:00Z (verified: Date.UTC)
export const MIN_LOCAL_DATE: LocalDate = '1900-01-01';
export const MAX_LOCAL_DATE: LocalDate = '2099-12-31';
export const MAX_RANGE_DAYS = 3660;             // ~10 y; the `localDateRange` allocation ceiling
export function isFiniteNum(x: unknown): x is number;           // typeof number && Number.isFinite
export function isPos(x: unknown): x is number;                 // isFiniteNum && x > 0
export function isPosInt(x: unknown): x is number;              // isPos && Number.isInteger
export function inDomain(x: unknown, max: number): x is number; // isFiniteNum && Math.abs(x) <= max
export function clamp(x: number, lo: number, hi: number): number;    // (value, lo, hi) — this order
export function clamp01(x: number): number;                     // clamp(x, 0, 1)

// round.ts — pinned implementations; no other rounding exists in calc
/** Half-up to `dp` decimals. EXACTLY `Math.round(x * f + Number.EPSILON * f) / f`, `f = 10 ** dp`
 *  (r09 §2's `roundHalfUp1` generalised). Domain: `x >= 0`, `dp` an integer in [0, 6]; anything
 *  else ⇒ `null`. Negatives are REFUSED, not guessed: `Math.round(-2.5) === -2` while
 *  `Decimal(-2.5).quantize(ROUND_HALF_UP) === -3` (verified), and nothing in calc rounds a negative. */
export function roundHalfUp(x: number, dp: number): number | null;
export function toGrams(kg: number): number | null;             // Math.round(kg * 1000); null off-domain
export function fromGrams(g: number): number | null;            // g / 1000
```

```ts
// e1rm.ts + rpe.ts
export function epley(weightKg: number, reps: number): number | null;
export function brzycki(weightKg: number, reps: number): number | null;      // null for reps >= 37
export function rirFromRpe(rpe: number): number | null;                      // 10 - rpe
export function rpeFromRir(rir: number): number | null;
/** RIR wins; RPE is the documented fallback so a half-populated row cannot silently degrade. */
export function effectiveRir(s: Pick<CalcSet, 'rpe' | 'rir'>): number | null;
export const NRM: ReadonlyArray<number | null>;   // length 15, NRM[0] === null (1-indexed by design,
                                                  // so `noUncheckedIndexedAccess` forces the narrow)
export function nRM(k: number): number | null;                               // %1RM of a k-rep max; k in [1,14], 0.5 grid
export function pct1RM(reps: number, rpe: number): number | null;            // %1RM, e.g. 81.1
export function e1rmFromRpe(weightKg: number, reps: number, rpe: number): number | null;
export function e1rm(weightKg: number, reps: number, rpe?: number | null):
  { kg: number; source: E1rmSource } | null;                                 // null => suppress the readout

// bodyfat.ts — percentage POINTS out (16.4360), never a fraction
export function navyBodyFatPct(sex: Sex, m: {
  heightCm: number; neckCm: number; waistCm: number; hipCm?: number | null;  // hip required for female
}): number | null;
export function leanMassKg(weightKg: number, bodyFatPct: number): number | null;

// trend.ts
export type WeightReading = { localDate: LocalDate; kg: number };
export type TrendPoint = { localDate: LocalDate; kg: number; trendKg: number; excluded: boolean };
export function emaStep(prevTrendKg: number, readingKg: number, alphaEff: number): number | null;
/** Readings MUST be ascending by localDate, one per local day (the caller averages duplicates). */
export function trendWeight(readings: readonly WeightReading[]): TrendPoint[] | null;

// energy.ts — all kcal/day
export function mifflinStJeor(sex: Sex, kg: number, heightCm: number, ageYears: number): number | null;
/** @internal Test-only: exists so one test pins the 1.58 kcal/day gap and nobody merges the two.
 *  No production module may import it; `scripts/check-calc-purity.mjs` asserts that. */
export function mifflinStJeorCombined(sex: Sex, kg: number, heightCm: number, ageYears: number): number | null;
export function katchMcArdle(kg: number, bodyFatPct: number): number | null;
export function applyActivityFactor(rmrKcal: number, factor: number): number | null;   // factor in [1.0, 2.5]
```

```ts
// tdee.ts — the status model is specs/11-nutrition-ai.md §34's: four states plus an independent flag
export function tdeeFromEnergyBalance(
  meanIntakeKcal: number, trendStartKg: number, trendEndKg: number, windowDays: number): number | null;
/** The blend and the clamp, exported so both can be tested without assembling a full TdeeInput. */
export function blendTdee(w: number, tdeeDataKcal: number, priorKcal: number): number | null;
export function capWoW(blendedKcal: number, lastEstimateKcal: number | null):
  { kcal: number; capped: boolean } | null;
export type TdeeStatus = 'NO_ESTIMATE' | 'PRIOR_ONLY' | 'CALIBRATING' | 'READY';
export type TdeeInput = {
  windowDays: number;               // span of the trend window in days (28). The Δtrend divisor (rule 29).
  intakeDaysLogged: number;         // days with ANY non-draft logged intake — the <3 gate (spec 11 §34)
  completeDays: number;             // days whose intake >= 0.5 x the window median (caller's contract, rule 33)
  weighInsInWindow: number;
  priorKcal: number | null;         // MSJ or Katch-McArdle x activity factor
  meanIntakeKcal: number | null;    // mean over COMPLETE days only (rule 33)
  trendStartKg: number | null; trendEndKg: number | null;   // real trend points, never interpolated
  lastEstimateKcal: number | null;  // last week's final, for the WoW cap
  bodyWeightKg: number | null;      // for the |delta| > 1% suspect check
};
export type TdeeEstimate = {
  status: TdeeStatus;
  tdeeKcal: number | null;          // what the UI shows and targets use; null ONLY for NO_ESTIMATE
  tdeeDataKcal: number | null;      // computed and returned even under PRIOR_ONLY (spec 11 §34)
  priorKcal: number | null;
  blendWeight: number;              // 0 under NO_ESTIMATE and PRIOR_ONLY
  blendedKcal: number | null;       // pre-cap blend, so the clamp is inspectable; null when not blended
  capped: boolean;                  // false unless the WoW clamp moved blendedKcal
  suspectWeightChange: boolean;     // INDEPENDENT of status; never blocks an estimate (spec 11 §34)
  completeDays: number; weighInsInWindow: number; windowDays: number;
};
export function adaptiveTdee(input: TdeeInput): TdeeEstimate;     // never null — the UI needs the reason

// plates.ts + warmup.ts
export type PlateResult = {
  status: PlateStatus; platesPerSide: number[];    // kg, descending
  achievedKg: number; errorKg: number;             // achievedKg - targetKg, signed
};
/** 2 x the smallest denomination with `pairsAvailable >= 1`. NOT the lattice resolution (rule 40). */
export function minIncrementKg(inv: PlateInventory): number | null;
export function maxAchievableKg(barKg: number, inv: PlateInventory): number | null;
/** grams of TOTAL weight -> the winning per-side plate list in kg, descending. `null` when the
 *  inventory violates the bounds in rule 36. */
export function achievableTotals(barKg: number, inv: PlateInventory): Map<number, number[]> | null;
export function plateMath(targetKg: number, barKg: number, inv: PlateInventory,
  mode?: 'nearest' | 'roundDown'): PlateResult | null;                           // default 'nearest'
export type WarmupStep = { pct: number; reps: number; rawKg: number; weightKg: number; platesPerSide: number[] };
export function warmupSets(topWorkingKg: number, barKg: number, inv: PlateInventory,
  ramp?: ReadonlyArray<{ pct: number; reps: number }>): WarmupStep[] | null;     // [] when the ramp collapses

// volume.ts — credits arrive as data (spec 08 / `volume_weights`), never hard-coded at a call site
export function isCountedSet(s: CalcSet): boolean;
export function isHardSet(s: CalcSet): boolean;
/** The named consumer of PRIMARY_/SECONDARY_MUSCLE_CREDIT: maps `exercise_muscles.role` to a weight.
 *  These are also the seeded values of spec 02's `volume_weights` table, which overrides them. */
export function creditForRole(role: MuscleRole): number;
export function setVolumeKg(s: CalcSet): number | null;                       // reps x weightKg
export function totalVolumeKg(sets: readonly CalcSet[]): number | null;       // counted sets only; [] => 0
export function volumeByMuscle(sets: readonly CalcSet[],
  credits: ReadonlyMap<string, readonly MuscleCredit[]>): Map<string, number> | null;   // muscle -> kg
export function hardSetsByMuscle(sets: readonly CalcSet[],
  credits: ReadonlyMap<string, readonly MuscleCredit[]>): Map<string, number> | null;   // muscle -> fractional sets
```

```ts
// time.ts — epoch ms are UTC; LocalDate strings are Asia/Almaty
export const ALMATY_TZ_CHANGE_MS = 1_709_229_600_000;              // 2024-02-29T18:00:00Z (verified, rule 50)
export const ALMATY_TZ_CHANGE_LOCAL_DATE: LocalDate = '2024-03-01';
export const ALMATY_OFFSET_MIN_AFTER = 300;                        // UTC+5, no DST
export const ALMATY_OFFSET_MIN_BEFORE = 360;                       // UTC+6
/** Instant-keyed: 300 at/after ALMATY_TZ_CHANGE_MS, else 360. Off-domain `epochMs` ⇒ `null`. */
export function almatyOffsetMinutes(epochMs: number): number | null;
/** LocalDate-keyed: 300 when `d >= '2024-03-01'` (lexicographic compare on 'YYYY-MM-DD' is
 *  chronological), else 360. THIS is the offset every LocalDate-taking function resolves with. */
export function almatyOffsetMinutesForDate(d: LocalDate): number | null;
export function localDateFromInstant(epochMs: number): LocalDate | null;
export function startOfLocalDayMs(d: LocalDate): number | null;      // 00:00:00.000 local as epoch ms
export function endOfLocalDayMs(d: LocalDate): number | null;        // startOfLocalDayMs(next(d)) - 1
export function nextLocalDate(d: LocalDate): LocalDate | null;
export function dayIndex(d: LocalDate): number | null;               // days since 1970-01-01, local calendar
export function diffDays(a: LocalDate, b: LocalDate): number | null; // dayIndex(b) - dayIndex(a)
export function localDateRange(from: LocalDate, to: LocalDate): LocalDate[] | null;   // inclusive both ends
export function rolling7dWindow(nowMs: number):
  { startDate: LocalDate; endDate: LocalDate; startMs: number; endMs: number } | null;
/** '2026-W37', Monday-start ISO-8601, computed arithmetically from `dayIndex` — no Intl.
 *  The ONE implementation: spec 13's `iso-week.ts` imports this and keeps only its own
 *  `isoWeekDays`/`isWeekEnd` (cross-spec correction 3). */
export function isoWeekKey(d: LocalDate): string | null;

// recovery.ts — brief module 6's "per-muscle recovery estimate from recent volume".
// CONVENTION, UNVERIFIED end to end: no published model maps credited hard sets to a recovery
// fraction. Both constants are tunable and disclosed in the UI as our formula (rule 57, open question 2).
export function muscleRecovery(nowMs: number,
  hardSetsByDay: ReadonlyMap<string, ReadonlyMap<LocalDate, number>>,   // muscle -> localDate -> credited hard sets
  halfLifeDays?: number,                                               // default MUSCLE_RECOVERY_HALF_LIFE_DAYS
): Map<string, number> | null;                                         // muscle -> recovery in [0, 1], 1 = fresh

// readiness.ts
export type CheckinInput = {
  sleepHours: number | null;   // 0..24, from daily_checkins.sleep_hours
  energy: number | null;       // 1..5 Likert, 5 = best
  soreness: number | null;     // 0..3 severity, spec 02's soreness_json domain, 0 = none — INVERTED
  mood: number | null;         // 1..5 Likert, 5 = best
  steps: number | null;        // recorded, NOT scored (rule 62)
};
export function readinessScore(c: CheckinInput): number | null;                  // integer 0..100
export function readinessParts(c: CheckinInput): Record<string, number> | null;  // sub-scores 0..1
```

## Behaviour

### Global policies (rules 1–7 bind every function; each is its own test)

1. **One invalid-input policy: nothing in `src/lib/calc` ever throws.** Every scalar-returning function returns
   `number | null`; `null` means exactly "cannot compute from these inputs" and is the only failure channel. Inputs come
   from user-editable fields and nullable D1 rows, and a throw inside a render or the weekly Cron batch takes down the
   screen or the batch. **Enforcement, stated honestly:** the gate that exists is
   `scripts/check-calc-purity.mjs` — it strips comments and string literals, then fails on a `throw` token, `Date.now`,
   `new Date()`, `Intl.`, `toLocaleString`, `fetch(` or a forbidden import under `src/lib/calc/**`. Spec 16 §15's eslint
   block today restricts only `new Date()`/`Date.now`/`Temporal.Now`/`performance`; the two extra selectors it must add
   are cross-spec correction 4. Until those land the script — not eslint — is the enforcement, and this spec claims
   nothing else.
2. Array-returning functions return `null` on invalid input (never a partial array) and `[]` only when an empty list is
   the right answer. `adaptiveTdee` and `plateMath` always return a non-null object carrying a `status` code, because
   the UI must be able to say *why*.
3. **The magnitude domain.** Every function guards first: each numeric argument must satisfy `Number.isFinite` **and**
   lie inside the domain declared in `num.ts` — `MAX_WEIGHT_KG 1000` and `MAX_REPS 500` (both lifted from spec 02's
   `sets_weight_sane` / `sets_reps_sane` CHECKs, so calc and the database refuse the same values), `MAX_LENGTH_CM 300`,
   `MAX_KCAL_PER_DAY 20 000`, `MAX_EPOCH_MS` (2100-01-01Z), `LocalDate` within `[MIN_LOCAL_DATE, MAX_LOCAL_DATE]`.
   `NaN`, `±Infinity` and out-of-domain values ⇒ `null`. **Inside that domain no function may ever return `NaN` or
   `±Infinity`** — and the domain is why the promise is keepable: `brzycki(1e308, 36)` is `Infinity` (verified — `w × 36`
   overflows before the division) and `epley(1e308, 12)` is `1.4e308`, both passing every finiteness-only guard, so an
   unbounded contract is false the day it is written. `1e308` stays in the fuzz corpus precisely to assert `null`.
4. **Rounding: never round internally** — unrounded IEEE-754 throughout, display rounding is spec 03's. Four
   definitional exceptions: `nRM` half-rep cells **half-up** to 1 dp; plate math exact in **integer grams**; warm-up
   weights **rounded down** onto the lattice; `readinessScore` **half-up to integer**. `roundHalfUp` is pinned to
   `Math.round(x · f + Number.EPSILON · f) / f` with domain `x >= 0` (Interfaces); a Python fixture generator must use
   `Decimal(...).quantize(ROUND_HALF_UP)` or three chart cells break (r09 §2).
5. Units never mix: kg, cm, kcal, kcal/day, epoch **ms** UTC for instants, `'YYYY-MM-DD'` Almaty for dates, percentage
   **points** for body fat and `%1RM`, fractions `0..1` for muscle credits and recovery.
6. **No ambient time or locale:** `nowMs` is always the first parameter (or the first field of the single input object,
   as in `TdeeInput`), and `Date.now`, `new Date()` with no argument, `Intl.*` and `toLocaleString` are banned here by
   rule 1's gate. The Workers tzdata version is not ours to control (r09 §8), and the same file runs client-side for
   Dexie replay, so results must be bit-identical.
7. **`undefined` is treated exactly as `null`** at every optional parameter and nullable field — `rpe`, `hipCm`,
   `lastEstimateKcal`, every `CheckinInput` member. D1 hands back `null`, a partially-built client object hands back
   `undefined`, and one of them silently taking a different branch is the class of bug this rule exists to kill.

### e1RM (r09 §1, §2)

8. `epley(w, r) = w · (1 + r/30)`; guards `w > 0`, `r` a positive integer `<= MAX_REPS`. Deliberately **not**
   short-circuited at `r = 1` (it returns `1.0333·w`, which is what the published formula says); the correction belongs
   to `e1rm`, rule 10(d).
9. `brzycki(w, r) = w · 36 / (37 − r)` — denominator `37 − r`, **not** `36 − r`. `null` for `r >= 37` (37 is a pole ⇒
   `Infinity`, 38+ is negative). `BRZYCKI_MAX_REPS = 36` is the exported name spec 02's schema comment depends on.
10. `e1rm` order: (a) guards; (b) `reps === 1` and (`rpe` null/undefined or `>= 10`) ⇒ `{kg: w, source: 'actual_single'}`
    — a single to failure *is* the 1RM; (c) `reps > MAX_REPS_FOR_E1RM (12)` ⇒ `null`; (d) **`base` excludes Epley at one
    rep**: `base = reps === 1 ? brzycki(w, 1) : max(epley, brzycki ?? −Infinity)`, with `baseSource` per rule 12;
    (e) `fromRpe = w / (pct1RM/100)` when `rpe` is usable; (f) `raw = max(base, fromRpe)`; (g)
    `kg = min(raw, base · RPE_INFLATION_CAP)`; (h) `source = kg > base ? 'rpe' : baseSource`.
11. **Decision (fixes the fake-PR bug r09 §1 calls the highest-probability real bug in the module):** step 10(d) drops
    Epley at `reps === 1`. Wikipedia scopes Epley to `r > 1` and at `r = 1` it is *"wrong by definition"* (r09 §1).
    Without this, a single logged at RPE 6–9.5 skips the 10(b) short-circuit, takes `base = 1.0333·w`, and
    `e1rm(100, 1, 9.5)` returns **103.33 kg `'epley'`** — a manufactured 3.3 kg PR over a lift the user actually did at
    100 kg. With it the answer is `102.249489 'rpe'`, and Brzycki at `r = 1` returns exactly `w`, so the floor is honest.
12. **`baseSource`, and the `r = 10` tie.** `E1RM_TIE_EPSILON_KG = 1e-9` (convention): when
    `|epley − brzycki| <= E1RM_TIE_EPSILON_KG` the two formulas have **crossed**, and `base`/`baseSource` take
    **Epley** — the formula published for this rep range. Otherwise the larger value wins and names itself. The epsilon
    is not decoration: at `r = 10` the identity `epley = brzycki = 4/3·w` is exact in real arithmetic but **not** in
    binary64 — verified, `100·(1 + 10/30) = 133.33333333333331` while `100·36/27 = 133.33333333333334` — so a bare `max`
    would report `'brzycki'` at every crossover, and that value is persisted to `sets.e1rm_source` and gates PR confetti
    in spec 06. `1e-9` sits ~3 orders above the worst float gap in the domain (~2.3e-13 at 1333 kg) and ~7 orders below
    spec 02's `PR_EPSILON_KG` of 0.01 kg, so it can neither flap nor mask a real difference. At `reps === 1`
    `baseSource` is `'brzycki'` by rule 11.
13. **Decision (deviates from r09's reference `e1rmBase`):** step 10(c) returns `null` above 12 reps, because that
    reference returns Brzycki at `r = 36` = **3600 kg** and permanently poisons `max(e1rm)`. r09 §1's open decision
    recommends suppression above 12 reps; doing it in the pure layer means the absurd value can never be persisted, and
    it matches spec 02 rule 10 (`sets.e1rm_kg` is `NULL`, not 0, whenever the number would be dishonest).
    `epley`/`brzycki` stay raw and testable.
14. `RPE_INFLATION_CAP = 1.10` (convention, r09 §2 decision (a)): the RPE branch may raise e1RM at most 10% over the
    failure-assuming formulas. Uncapped, `100 kg × 12 @ RPE 8` = 159.49 sets an unbeatable PR — the most dangerous
    formula interaction in the app.
15. `pct1RM`: `eff = reps + (10 − rpe)`; `null` if `rpe < 6` or `> 10`; bracket `eff` on the 0.5 grid and interpolate
    linearly between `nRM(lo)` and `nRM(hi)`; `null` if either is `null`. The `[6, 10]` window is r09 §2's (*"Clamp
    `rpe` to `[6, 10]`; `rpe > 10` is not a thing"*) and is deliberately narrower than spec 02's `sets_rpe_range` CHECK
    of `1..10`: the database stores what the user typed, the chart refuses what it cannot read.
16. `nRM(k)`: `null` outside `[1, 14]` — **no extrapolation** (the published first differences are non-monotone).
    Integer `k` reads `NRM[k]`; half-integer `k` = `roundHalfUp((NRM[lo] + NRM[lo+1]) / 2, 1)`. `NRM` is declared
    `ReadonlyArray<number | null>` of length 15 with `NRM[0] === null`, so the 1-indexing lives in the type and
    `noUncheckedIndexedAccess` forces the narrow — never a `!`-assert. A test pins `NRM[2] === 95.5` so no future
    "chart update" can swap in the linearised 100/97.5/95 chart that r09 §2 names as wrong.
17. `rirFromRpe`/`rpeFromRir` = `10 − x` over `[0, 10]`, else `null`. **Source of truth, decided here rather than
    deferred:** `rir` is authoritative and `rpe` is the documented fallback —
    `effectiveRir(s) = s.rir ?? (s.rpe == null ? null : 10 − s.rpe)` — and `isHardSet` reads only `effectiveRir`, never
    `s.rir` directly. Spec 02 makes both `sets.rpe` and `sets.rir` nullable `real` with a CHECK on `rpe` only and no
    generated column or trigger, so r09's warning is live (*"if both are writable and only one is populated, `pct1RM`
    silently returns `null` and the composite quietly degrades"*); the fallback removes the silent degradation without
    needing a trigger. Because spec 02's CHECK is `rpe BETWEEN 1 AND 10` — not 6..10 — `rir` spans `0..9`, which is why
    the `rir: 5` and `rir: 4.5` fixtures below are in range. Spec 02 must add
    `check("sets_rir_range", rir IS NULL OR rir BETWEEN 0 AND 9)` (cross-spec correction 2).

### Body fat (r09 §3)

18. **Metric form only.** Male: `495 / (1.0324 − 0.19077·log10(waist−neck) + 0.15456·log10(height)) − 450`. Female:
    `495 / (1.29579 − 0.35004·log10(waist+hip−neck) + 0.22100·log10(height)) − 450`. `Math.log10`, never `Math.log`
    (natural log ⇒ ≈ −591%). The imperial constants (`86.010 / −70.041 / +36.76`) appear nowhere in the repo: fed
    centimetres they read +6.52 pp high.
19. `null` when any measurement is non-finite, `<= 0` or `> MAX_LENGTH_CM`; when `waist − neck <= 0` (male) or
    `waist + hip − neck <= 0` (female); or when `hipCm` is missing/`null`/`undefined` for a female — never treat a
    missing hip as 0.
20. Physiological gate: a result `< 2` or `> 60` pp ⇒ `null`. `leanMassKg = kg · (1 − bfPct/100)`, `null` unless
    `bfPct ∈ [0, 100)` and `0 < kg <= MAX_WEIGHT_KG`.

### Trend weight (r09 §4)

21. `TREND_ALPHA = 0.1` (Hacker's Diet, verified); seed `T[0] = W[0]` **exactly**. Walker's 1-dp increment rounding is
    **not** adopted — it freezes the trend on exactly the plateaus the user most wants to read.
22. Gap policy **(b) gap-aware α**: `gap = max(1, dayIndex(d) − dayIndex(prev))`, `αEff = 1 − (1−α)^gap`. The
    `max(1, …)` is mandatory — a 0 gap makes `αEff = 0` and skips the update silently.
23. Outliers: `|W − T| > OUTLIER_ABS_KG (3)` ⇒ emit the point with `excluded: true` and the **unchanged** `trendKg`,
    still advancing `prevDay`. Never drop or clamp the raw reading.
24. Readings with non-finite, `<= 0` or out-of-domain kg, or a malformed `localDate`, are dropped before the fold and
    absent from the output. `trendWeight([])` ⇒ `[]`; one reading ⇒ one point with `trendKg === kg`, `excluded: false`.
    Unsorted input, or two readings on one `localDate`, ⇒ `null` — an EMA is order- and prefix-dependent, so the caller
    sorts and averages per Almaty date.
25. `TREND_HALF_LIFE_DAYS = 6.578813` and `TREND_MEAN_LAG_DAYS = 9` are separate exports: the famous "9 days" is the
    mean lag, not the half-life, and no UI string may conflate them.

### Energy and adaptive TDEE (r09 §5, spec 11 §34)

26. Ship the **split** MSJ: `10·kg + 6.25·cm − 5·age + (male ? 5 : −161)`; guards `0 < kg <= MAX_WEIGHT_KG`,
    `0 < cm <= MAX_LENGTH_CM`, `age ∈ [1, 120]`. `mifflinStJeorCombined` is `@internal` and test-only (Interfaces): it
    exists so one test pins the 1.58 kcal/day difference and nobody merges the two, and no production module imports it
    — which is what keeps it out of the 200 KB per-route JS budget.
27. `katchMcArdle = 370 + 21.6 · leanMassKg(...)` — not Cunningham (`500 + 22·LBM`); `null` when LBM is `null`.
    Activity factors are `UNVERIFIED` (r09 §5, spec 11 §35): `applyActivityFactor` accepts any `factor ∈ [1.0, 2.5]`
    and the ladder lives in settings, not calc.
28. `tdeeFromEnergyBalance = meanIntake − ((trendEnd − trendStart) · ENERGY_DENSITY_KCAL_PER_KG / windowDays)`. The sign
    is the module's highest-value assertion: `+` gives 2202.5 instead of 2697.5 — a plausible 495 kcal/day error that
    starves the user. `windowDays <= 0` ⇒ `null`.
29. **Decision — the Δtrend divisor is `windowDays`, not `completeDays`.** `meanIntakeKcal` is a per-day rate over the
    complete days; Δtrend is a mass change that accrued over the **whole** window, unlogged days included. Dividing a
    28-day weight change by 14 complete days doubles the tissue-energy correction: at Δ = −0.9 kg the term becomes
    −495 instead of −247.5 kcal/day, a 247 kcal/day error in the direction that *raises* the target — precisely the
    failure mode rule 33 exists to prevent. The four worked-example weeks hide it because there
    `completeDays === windowDays` (7/14/21/28), which is why every vector below is unchanged by this decision. r09 §5
    step 2 and spec 11 §33 currently say `completeDays`; that is cross-spec correction 1 and open question 1.
    `completeDays` keeps its two real jobs: the divisor of `meanIntakeKcal` (the caller's, rule 33) and the blend
    weight (rule 31).
30. `adaptiveTdee` computes two things **before** branching on status, because spec 11 §34 requires both even when
    neither is displayed: (a) `tdeeDataKcal = tdeeFromEnergyBalance(meanIntakeKcal, trendStartKg, trendEndKg,
    windowDays)` whenever those three values are non-null, else `null`; (b)
    `suspectWeightChange = |trendEnd − trendStart| > TDEE_SUSPECT_DELTA_FRACTION (0.01) · bodyWeightKg`, `false` when
    any input is null. `suspectWeightChange` is a **flag beside** the status, never a status value: spec 11 §34 is
    explicit that it "never blocks an estimate", it renders as an amber dot, and a single enum could not carry
    `CALIBRATING` and a suspect swing at once — the old ordering let `CALIBRATING` silently swallow the warning for
    every window under 21 days.
31. `adaptiveTdee` status, first match wins:
    - `intakeDaysLogged < TDEE_MIN_LOGGED_DAYS (3)`, **or** `completeDays === 0`, **or** (`priorKcal == null` and the
      window is not yet blendable) ⇒ **`NO_ESTIMATE`**: `tdeeKcal: null`, `blendWeight: 0`, `blendedKcal: null`,
      `capped: false`. The `completeDays === 0` test is evaluated *before* any division (spec 11 §34) so no `Infinity`
      can reach the clamp. "Not yet blendable" means `completeDays < 14 || weighInsInWindow < 10 || tdeeDataKcal == null`.
    - `completeDays < TDEE_MIN_COMPLETE_DAYS (14)`, **or** `weighInsInWindow < TDEE_MIN_WEIGH_INS (10)`, **or** any of
      `meanIntakeKcal`/`trendStartKg`/`trendEndKg` null ⇒ **`PRIOR_ONLY`**: `tdeeKcal = priorKcal`, `blendWeight: 0`,
      `blendedKcal: null`, `capped: false`, and `tdeeDataKcal` **still carried** for later analysis (spec 11 §34:
      *"`TDEE_data` is still computed and stored … but is neither blended into the displayed value nor used for
      targets"*).
    - otherwise compute: `w = priorKcal == null ? 1 : min(1, completeDays / TDEE_BLEND_FULL_DAYS (28))` — with no prior
      there is nothing to blend, so `w` is forced to 1 rather than inventing a prior;
      `blendedKcal = blendTdee(w, tdeeDataKcal, priorKcal ?? tdeeDataKcal)`;
      `{kcal, capped} = capWoW(blendedKcal, lastEstimateKcal)`; `tdeeKcal = kcal`. Status is **`CALIBRATING`** while
      `completeDays < TDEE_WARMUP_DAYS (21)` (7700 over-estimates early tissue energy density — measured ~4858 ± 388
      kcal/kg at week 4, r09 §5), else **`READY`**.
32. `capWoW(blended, last)` = `{kcal: blended, capped: false}` when `last` is null/undefined, else
    `{kcal: clamp(blended, last − TDEE_MAX_WOW_DELTA (250), last + TDEE_MAX_WOW_DELTA), capped: clamped !== blended}`.
    The cap is flat kcal/day, not a percentage: logging noise is absolute (r09 §5).
33. `meanIntakeKcal`/`completeDays`/`intakeDaysLogged` are the **caller's** contract (spec 11's `buildTdeeWindow`), over
    complete days only (intake ≥ 50% of the window median, draft entries excluded). Passing 28 while days went unlogged
    reads each skipped day as a fast and inflates TDEE permanently — MacroFactor's "single cardinal sin".
34. `ENERGY_DENSITY_KCAL_PER_KG = 7700` (verified Wishnofsky; spec 11 §32 imports this constant rather than restating
    it, and the kcal-per-gram macro constants beside it are spec 11's, not calc's).

### Plate math and warm-ups (r09 §6, §7)

35. All plate arithmetic runs in **integer grams** (`toGrams`), converting back only at the boundary. Float kilos drop
    the last microplate for some targets only — the worst kind of gym bug.
36. `achievableTotals` enumerates the subset-sum lattice keyed by grams of **total** weight, under hard bounds:
    `null` when `inv.length > PLATE_MAX_DENOMINATIONS (12)`, when any `pairsAvailable > PLATE_MAX_PAIRS (20)` or is not
    a non-negative integer, when any `plateKg <= 0` or `> PLATE_MAX_KG (100)`, or when
    `Π(pairsAvailable + 1) > PLATE_MAX_COMBINATIONS (200 000)`. The bounds are not paranoia: that product *is* the
    combination count, so a 12-denomination × 8-pair inventory is `9^12 ≈ 2.8e11` (verified) against a Worker's 128 MB
    memory and 30 s CPU budget (stack-facts), and `plateMath` runs per set-row render. **Enumeration dedupes by distinct
    per-side grams at each denomination level, not by combination** — the reference fixture has 4374 combinations but
    only **345 distinct totals** (both verified by enumeration), and the distinct-total count is bounded by
    `maxAchievableKg / smallest step`, a few hundred for any real gym. Level-wise dedupe is sound because denominations
    are consumed in descending order: for two prefixes reaching the same sum, the winner under (fewest plates, then
    lexicographically larger descending list) still wins after any common suffix.
37. Among combinations reaching the same total keep the **fewest plates**, tie-broken by the lexicographically larger
    descending list (so 102.0 kg is `[25, 15, 0.5, 0.5]`, never `[20, 20, 0.5, 0.5]`, and 42.5 kg on a 20 kg bar is
    `[10, 1.25]`, not a three-plate list). Greedy is **not** authoritative: 25/20/15/10/5/2.5 is non-canonical and
    greedy is round-down-only.
38. `mode: 'nearest'` (default) minimises `|achieved − target|` over the lattice, **tie-broken upward** (102.25 ⇒ 102.5;
    progressive overload wants the upward tie). `'roundDown'` takes the greatest lattice entry `<= target`.
39. `status`: `EXACT` iff `errorKg === 0`; else `ROUNDED`; **`BELOW_BAR`** when `target < barKg` (`platesPerSide: []`,
    `achievedKg = barKg`, positive `errorKg` — never negative plates or an empty screen); **`ABOVE_MAX`** when
    `target > maxAchievableKg(barKg, inv)` (`platesPerSide` = every available pair, `achievedKg = maxAchievableKg`,
    negative `errorKg`) — the reference fixture tops out at **307.0 kg** (verified by enumeration), so
    `plateMath(500, 20, inv)` yields `errorKg = −193`, and without this status that number was silently reported as
    `ROUNDED` and broke every stated error bound; `NO_INVENTORY` when the inventory is empty or every pair count is 0.
    `null` only for non-finite or out-of-domain inputs, `barKg <= 0`, or an inventory rejected by rule 36.
40. `minIncrementKg` = 2 × the smallest denomination with `pairsAvailable >= 1`; `null` when no denomination has a
    pair. The pair filter is load-bearing — rule 39 already treats "every pair count is 0" as expected input, so
    `[[0.5, 0], [2.5, 2]]` must report **5.0**, not 1.0 (verified: the real lattice steps 5.0 there), and `[[25, 0]]`
    must report `null`. **`minIncrementKg` is the stepper increment, not the lattice resolution:** with both 1.25 and
    0.5 kg plates the lattice contains 102.0 *and* 102.5 (a 0.5 kg step) while `minIncrementKg` is 1.0. The bound that
    actually holds is on the largest lattice **gap** — rule 41.
41. With the reference inventory the largest gap in the 345-entry lattice is exactly **1.0 kg** (verified by
    enumeration), so `|errorKg| <= 0.5` for every target in `[20, 307]`, and 100.5 / 101.5 genuinely do not exist. That
    bound is **fixture-specific**. The **general** invariant, and the one the fuzz test asserts, is that
    `plateMath('nearest')` returns the lattice entry nearest the target: for every key `x` of
    `achievableTotals(barKg, inv)`, `|achievedG − targetG| <= |x − targetG|`, ties resolved upward; excluded are
    `BELOW_BAR`, `ABOVE_MAX` and `NO_INVENTORY`. (`|errorKg| <= minIncrementKg/2` is **false** in general:
    `[[0.5,1],[25,1]]` has `minIncrementKg 1.0` and a 49 kg gap.)
42. `barKg` means **bar + collars** and is per-exercise overridable (spec 06 supplies it from `settings.bar_mass_g` /
    `ez_bar_mass_g`): omitting 5 kg of collars makes every logged weight, and every e1RM, light.
43. `WARMUP_RAMP = [40%×5, 50%×5, 60%×3]` — Wendler's 5/3/1 ramp **re-scoped to the day's top working set** (a
    convention; Wendler's percentages are of the Training Max ≈ 90% of 1RM). Keep the provenance comment: "fixing" it
    by ÷0.9 makes every warm-up 11% heavier.
44. Steps round **down** so a warm-up never exceeds its prescription, and are dropped when
    `weightKg < barKg + WARMUP_MIN_ABOVE_BAR_KG (5)` or `weightKg >= topWorkingKg`; `topWorkingKg <= barKg` ⇒ `[]`,
    never three identical bar-weight rows. `warmupSets` ⇒ `null` for a non-finite or out-of-domain `topWorkingKg`, for
    `barKg <= 0`, for a rule-36-rejected inventory, or for a ramp entry whose `pct` is not in `(0, 2]` or whose `reps`
    is not a positive integer; an empty inventory ⇒ `[]`. The empty-bar set is spec 06's UI concern, not a ramp step.

### Volume, hard sets, muscle credit (r09 §8)

45. `COUNTED_SET_TYPES = ['working', 'drop', 'failure', 'amrap']` — spec 02's `SET_TYPES` minus `warmup`, the same four
    spec 06 rule 32 and spec 13's `day-status.ts` use. Warm-ups contribute no tonnage and no hard sets; drop sets and
    AMRAPs contribute both.
46. `setVolumeKg = reps × weightKg`, over the **already-resolved effective load** the field contract names
    (Interfaces): spec 06's `effectiveLoadKg` folds bodyweight and assistance in *before* calc sees the set, so an
    assisted pull-up at bw 80 / assist 30 arrives as 50 kg and a bodyweight pull-up as ~80 kg. `weightKg === 0` is
    therefore the genuine **zero-load** edge case (a duration/distance row the caller chose to pass through), not "the
    bodyweight case", and `0 × 10 ⇒ 0`, not `null` — tonnage is a load metric, and `null` would make the totals disagree
    with the set count. `totalVolumeKg([]) === 0`.
47. `isHardSet(s) = isCountedSet(s) && (effectiveRir(s) === null || effectiveRir(s) <= HARD_SET_MAX_RIR (4))`.
    **Decision:** a counted set logged *without* RPE/RIR **counts** as hard — the user did the work, and excluding it
    makes the heatmap and the volume chart disagree about one session (r09 §8 flags this as open and recommends it).
48. `PRIMARY_MUSCLE_CREDIT = 1.0` and `SECONDARY_MUSCLE_CREDIT = 0.5`, consumed by exactly one function —
    `creditForRole(role)`, which maps spec 02's `exercise_muscles.role` to a weight and is also the seed pair for
    spec 02's user-tunable `volume_weights` table. There is no `DROP_SET_HARD_SET_CREDIT`: a drop set counts as one hard
    set, which rule 47 already says, and a constant no formula reads is a constant that drifts. The 0.5 is a **display
    convention contradicting** Schoenfeld 2019's explicit 1:1 recommendation, so spec 12's legend must read "secondary
    muscles counted at 50%" (open question 3).
49. `volumeByMuscle`/`hardSetsByMuscle` **double-count by design** (the r09 week sums to 5640 kg across muscles vs
    3270 kg of real tonnage). No caller may sum these maps and call it session volume; `totalVolumeKg` is the only
    session-volume source. A set whose `exerciseId` is absent from the credits map counts in `totalVolumeKg` but toward
    no muscle — not an error and not `null`; free-exercise-db frequently has `secondaryMuscles: []`. `[]` in ⇒ an empty
    `Map` out, never `null`.

### Almaty calendar (r09 §8)

50. **The transition instant is verified, not assumed.** `almatyOffsetMinutes(epochMs)` ⇒ `300` (UTC+5, no DST) at/after
    `ALMATY_TZ_CHANGE_MS = 1709229600000` (`2024-02-29T18:00:00Z`), `360` (UTC+6) before it. Verified against IANA
    tzdata **2025b** as shipped in Node 24.12.0 / ICU 77.1 by bisecting
    `Intl.DateTimeFormat(…{timeZone:'Asia/Almaty', timeZoneName:'longOffset'})`: the offset flips from `GMT+06:00` to
    `GMT+05:00` at exactly that instant, and local `2024-02-29 23:00:00` therefore occurs twice. (That bisection is a
    one-off verification run in a scratch script; rule 6 still bans `Intl` inside calc.) Only imported pre-2024 history
    (spec 15) reaches the `360` branch.
51. **Which offset a `LocalDate` resolves with — the rule the old spec left circular.**
    `almatyOffsetMinutesForDate(d)` is `360` when `d < '2024-03-01'` and `300` otherwise (lexicographic compare on
    `YYYY-MM-DD` is chronological), and every `LocalDate`-taking function uses it:
    `startOfLocalDayMs(d) = dayIndex(d)·86 400 000 − almatyOffsetMinutesForDate(d)·60 000`, `dayIndex(d)` = whole days
    from `1970-01-01` in the proleptic Gregorian calendar. `endOfLocalDayMs(d) = startOfLocalDayMs(nextLocalDate(d)) − 1`
    — **not** `start + 86 399 999`, and that is what closes the one-hour hole at the transition. Verified:
    `startOfLocalDayMs('2024-03-01') = 1709233200000` (`2024-02-29T19:00:00Z`, the post-change occurrence of local
    midnight) and `endOfLocalDayMs('2024-02-29') = 1709233199999`, making local 2024-02-29 correctly **25 hours** long,
    with `localDateFromInstant(startOfLocalDayMs(d)) === d` and `localDateFromInstant(endOfLocalDayMs(d)) === d` holding
    for every `d` including both sides of the change. For every other day
    `endOfLocalDayMs(d) === startOfLocalDayMs(d) + 86 399 999` (verified against the r09 window:
    `endOfLocalDayMs('2026-09-13') = 1789325999999` either way).
52. `localDateFromInstant` shifts by `almatyOffsetMinutes(epochMs)`, then takes the shifted UTC Y-M-D.
    `2026-09-06T19:30:00Z` is local `2026-09-07`; grouping by UTC date loses 640 kg of chest volume from the r09 worked
    week and can drop a streak day.
53. `rolling7dWindow(nowMs)`, both bounds inclusive, 7 local days including today: `endDate =
    localDateFromInstant(nowMs)`, `startDate = endDate − 6 d`, `startMs = startOfLocalDayMs(startDate)`,
    `endMs = endOfLocalDayMs(endDate)`. Callers prefer `local_day BETWEEN startDate AND endDate`; the ms bounds exist
    only for raw-timestamp `BETWEEN`.
54. `isoWeekKey` is Monday-start ISO-8601 (`'2026-W37'`), computed arithmetically from `dayIndex` — the bucket for
    grace-day resets and weekly streaks, and **one implementation only** (rule 56). The ISO **year** is the year of the
    week's Thursday, not of the date: `2027-01-01 ⇒ '2026-W53'` and `2024-12-30 ⇒ '2025-W01'` (both verified). A wrong
    ISO year hands the user a fresh grace day or drops a week at every New Year, so those are test vectors, not trivia.
55. A malformed `LocalDate` (not exactly `YYYY-MM-DD`, an impossible date like `'2026-02-30'`, or outside
    `[MIN_LOCAL_DATE, MAX_LOCAL_DATE]`) ⇒ `null` from every `time.ts` function. `localDateRange` ⇒ `null` when
    `from > to` **or** when the span exceeds `MAX_RANGE_DAYS (3660)`, one element when `from === to`. The span cap is
    the 128 MB Worker's guard: `('1970-01-01','2999-12-31')` would allocate ~376 000 strings.

### Recovery and readiness

56. **Streaks and adherence live in spec 13, entirely — one owner, one implementation.** `src/lib/calc` ships **no**
    streak state machine and **no** `adherence()`. Spec 13 already owns `streak.ts`
    (`applyDay`/`applyWeekClose`/`foldLedger`/`INITIAL_STREAK_STATE`, with its own `StreakState` carrying
    `graceUsedThisWeek`/`preDecayPeak`/`dormant`/`currentWeeks`), `adherence.ts` (whose `ratio` is deliberately **not**
    clamped to 1), and the grace/freeze/decay policy including the "never a hard binary reset to zero" guarantee the
    brief requires. A second `StreakState`, a second `adherence()` that *does* clamp, and a second `isoWeekKey` could
    only drift while both bucketed grace resets. `isoWeekKey` flows the other way: it is defined here (rule 54) and
    imported there (cross-spec correction 3).
57. **Per-muscle recovery** — brief module 6's *"per-muscle recovery estimate from recent volume"*, the one brief
    requirement no other spec claimed. `muscleRecovery(nowMs, hardSetsByDay, halfLifeDays?)` returns, per muscle,
    `recovery = clamp01(1 − fatigue / MUSCLE_RECOVERY_SATURATION_SETS (10))` where
    `fatigue = Σ_days creditedHardSets(day) · 2^(−elapsedDays / halfLifeDays)` and
    `elapsedDays = dayIndex(localDateFromInstant(nowMs)) − dayIndex(day)`; `halfLifeDays` defaults to
    `MUSCLE_RECOVERY_HALF_LIFE_DAYS = 2`. A muscle absent from the input, or present with an empty day map, is **absent
    from the output** (the caller renders "fresh") rather than reported as 1.0, so "no data" and "recovered" stay
    distinguishable. `null` for the whole call on: a day strictly after today, a malformed `LocalDate`, a negative or
    out-of-domain set count, `halfLifeDays <= 0`, or an off-domain `nowMs`. Both constants are **convention,
    `UNVERIFIED`** — no published model maps credited hard sets to a recovery fraction, and saying so is the point
    (open question 2). The input is `hardSetsByMuscle`'s output bucketed by day, so recovery and the heatmap can never
    disagree about what a hard set was.
58. `readinessScore = roundHalfUp(100 · Σ(wᵢ·subᵢ) / Σwᵢ, 0)` over the **present** components, with
    `READINESS_WEIGHTS = { sleep: 0.35, energy: 0.30, soreness: 0.20, mood: 0.15 }` — **convention, `UNVERIFIED`; no
    published formula exists** (open question 2). Those weights sum to 1 **within 1e-9**, not exactly:
    `0.35 + 0.30 + 0.20 + 0.15 === 0.9999999999999999` in binary64 (verified), so the test asserts
    `toBeCloseTo(1, 9)` and no code may branch on an exact 1.
59. Sub-scores, each `0..1`: `sleep = clamp01((sleepHours − 4) / 4)` (≤4 h ⇒ 0, ≥8 h ⇒ 1); `energy = (energy − 1)/4`;
    `mood = (mood − 1)/4`; `soreness = (3 − soreness)/3` — **inverted**, and on spec 02's `soreness_json` domain of
    `0..3` (0 = none, 3 = severe), *not* a 1..5 Likert: `daily_checkins.soreness_json` is
    `Partial<Record<Muscle, 0..3>>`, so a 1..5 scalar was unfeedable. The caller reduces that JSON to the **max over
    the muscles the user marked** before calling — the worst-sore muscle is what actually limits the session, while a
    mean over 17 muscles would dilute one wrecked hamstring to nothing. An empty or absent `soreness_json` ⇒
    `soreness: null`. A flipped inversion yields a plausible, exactly wrong number, so it gets its own test.
60. Missing components are **renormalised over the present weights**, never treated as zero. `null` when fewer than 2
    components are present or their weights sum `< 0.5` — readiness from one field is noise. A Likert outside `[1,5]`,
    `soreness` outside `[0,3]`, or `sleepHours` outside `[0,24]` makes that **one** component absent, not the whole
    score `null`.
61. `readinessParts` returns exactly the present sub-scores, and returns `null` **exactly when `readinessScore` does** —
    same guard, same threshold — so the breakdown sheet can never show parts for a suppressed ring or vice versa.
62. `steps` and `daily_checkins.sleep_quality` are stored and displayed but **not scored** (weight 0). Steps' sign is
    ambiguous — a 15 000-step day is either active recovery or accumulated fatigue, and nothing signs it; sleep
    *duration* already carries 0.35, so adding a correlated subjective quality field would double-count sleep. Stated
    so nobody "fixes" the weight sum.

## Data

This module performs **no I/O** — no `drizzle`, no D1, no `fetch`, no `next/*` (proved by
`scripts/check-calc-purity.mjs`). Inputs are plain objects, outputs plain values. Every table and
column below is defined canonically in [`specs/02-data-model.md`](./02-data-model.md) and is listed
only to say who feeds calc and who persists its output.

| Fed into calc by callers | Persisted from calc output by callers |
|---|---|
| `sets(exercise_id, local_day, set_type, weight_kg, assist_kg, reps, rpe, rir)` — resolved to effective load by spec 06 first | `sets.e1rm_kg` (full double, never pre-rounded), `sets.e1rm_source` |
| `users(sex, birth_day, height_cm)`; `settings(bar_mass_g, ez_bar_mass_g, plate_inventory_json)` | `body_measurements.trend_kg`, `.trend_excluded`, `.body_fat_pct` |
| `body_measurements(local_day, weight_kg, neck_cm, waist_cm, hips_cm)` | `tdee_snapshots(week_ending_day, tdee_est, tdee_data, prior, prior_method, blend_w, complete_days, weigh_ins, capped, trend_start_kg, trend_end_kg, mean_intake_kcal)` — append-only, never `UPDATE` |
| `food_entries(local_day, kcal, confirmed_at)` aggregated to complete-day means by spec 11's `buildTdeeWindow` | `daily_checkins.readiness` |
| `daily_checkins(local_day, sleep_hours, mood, energy, soreness_json, steps)` | `personal_records(exercise_id, kind, value, local_day)` via spec 06's `detectPrs` |
| `exercise_muscles(exercise_id, muscle, role)` + `volume_weights(role, credit)` (spec 08) | nothing — volume and recovery maps are computed per request, never stored |

- Every calendar-shaped query groups on the stored **`local_day TEXT`** (`YYYY-MM-DD`, Almaty,
  `GLOB`-CHECKed), computed once at write time by spec 02's `toLocalDay()` — never recomputed in SQL,
  never derived from a UTC timestamp at read time (r09 §8). Indexed per spec 02. The column is
  `local_day`, not `local_date`, everywhere.
- The TS name for that value is **`LocalDate`**, and it is the only name. Spec 13's `DayKey`/`LocalDay`
  becomes `type LocalDay = LocalDate` re-exported from `@/lib/calc`, not a parallel definition
  (cross-spec correction 5).
- **KV:** `calc:plate-lattice:v1:<sha256(barKg + sorted inventory)>` → JSON `[grams, plates[]][]`,
  TTL 30 days. A cache only — `achievableTotals` stays the source of truth; the KV read/write is the
  caller's job (spec 06). The cached payload is the **345-entry distinct-totals** map of rule 36, not
  the 4374 raw combinations.
- **R2:** none. **IndexedDB:** none directly — spec 05's Dexie queue holds sets that `e1rm` is re-run
  over after sync, which is why rule 6 exists.

## UX notes

- e1RM above **12** reps renders as `—`, never a number (rule 13), and the tooltip must name the same
  threshold the code uses. The old string "estimates diverge above 10 reps" told a user logging 11 or
  12 reps that the number in front of them was untrustworthy, and a user logging 13 that the reason
  did not match the cutoff. The honest split is "no estimate above 12 reps — the formulas diverge
  sharply past ~10": the ~10 half is r09's verified Wikipedia quote, the 12 is our decision. The string
  itself lives in `messages/{ru,en}.json` under spec 01's key ownership and is presented per spec 03 —
  cited here, not authored here. A result with `source === 'rpe'` carries a small `RPE` glyph, and
  spec 06 gates PR confetti + haptic to `source !== 'rpe' || reps <= 8` so a high-rep back-off set
  cannot fire it.
- Body fat always renders its error bar inline — `16.4 % ±3–4` (US Navy tape SEE) — because the
  method's error exceeds most real month-to-month change.
- TDEE surfaces follow rule 31's four statuses **plus** the independent flag, so two things can show at
  once: `NO_ESTIMATE` shows no number at all and names the shortfall; `PRIOR_ONLY` shows the prior with
  "needs 14 days of complete logging / 10 weigh-ins" and the exact counts; `CALIBRATING` shows the
  blended number greyed with a "calibrating — day N of 21" chip; `READY` shows it plainly. Orthogonal
  to all four, `suspectWeightChange` adds an amber dot with text. Never a blocked screen, never a bare
  number.
- Plate results always show the signed error (`102.0 kg (+0.1)`). The per-side list renders as chips
  that are **IWF-coloured *and* labelled**: every chip carries its kg value as text plus a 1 px
  `--border-strong` border (spec 03 measures `#71717a` at 4.35:1 on `#000`), because the 2.5 kg black
  chip is invisible on the OLED canvas and because colour would otherwise be doing identity work — the
  same thing the a11y bullet forbids for `excluded`/`capped`. `BELOW_BAR` renders a "use a lighter bar"
  affordance; `ABOVE_MAX` renders its mirror image — "not enough plates — max 307.0 kg" with the
  achieved total.
- Trend points with `excluded: true` keep a **contrast floor, not an opacity**: ≥3:1 against the canvas
  (WCAG 2.1 SC 1.4.11 for graphical objects, the ratio spec 03 measures every pair against), drawn as a
  hollow ring rather than dimmed to 40%, which on `#000` would not reach it. The visual mark stays
  small; the hit area is spec 03's ≥56 px tap rule applied to the chart point, never smaller. They are
  never hidden.
- Readiness is a 0–100 ring; with components missing it shows the renormalised score plus a "3 of 4
  logged" caption, and taps open the `readinessParts` breakdown. That sheet also carries the four
  weights **and a provenance line** — "our formula, not a validated instrument" — because body fat gets
  its error bar and TDEE gets its calibrating chip, and the one fully invented number must not be the
  one that ships unlabelled (rule 58, open question 2). The per-muscle recovery readout carries the
  same line for the same reason.
- a11y: every numeric readout carries its unit in the accessible name ("102 kilograms", "readiness 75
  out of 100"); plate chips are a `role="list"`; colour is never the only carrier of `excluded`,
  `capped`, `suspectWeightChange` — or of plate identity.

## Risks

| Risk | Mitigation |
|---|---|
| Brzycki's `37 − r` pole reaching D1 as `Infinity`/`3600` and poisoning `max(e1rm)` forever | `brzycki` ⇒ `null` at `r >= 37`; `e1rm` ⇒ `null` above 12 reps; fuzz `r ∈ [1,60]` asserting null-or-finite; spec 02's `sets_e1rm_finite` as the DB backstop |
| An unbounded finiteness promise being false on day one (`brzycki(1e308,36) = Infinity`) | rule 3's magnitude domain, taken from spec 02's own CHECKs; `1e308` in the fuzz corpus asserts `null` rather than breaking the contract |
| Epley at `r = 1` manufacturing a 3.3 kg fake PR for any single logged at RPE 6–9.5 | rule 11 drops Epley at one rep; `e1rm(100,1,9.5)` pinned to `102.249489 'rpe'` with `103.333333 'epley'` asserted negatively |
| `'brzycki'` reported at every `r = 10` crossover because the identity is exact in algebra, not in binary64 | `E1RM_TIE_EPSILON_KG` (rule 12); the crossover property test uses `toBeCloseTo(…, 10)`, never `toBe` |
| The RPE branch manufacturing an unbeatable PR (`100×12 @ RPE 8` ⇒ 159.49) | `RPE_INFLATION_CAP = 1.10` ⇒ 158.4, `e1rm_source` persisted, PR gating in spec 06 |
| UTC-vs-Almaty off-by-one dropping a streak day — the exact rage-quit trigger gamification exists to avoid | all calendar logic via `time.ts`; `local_day` stored at write time; dedicated tests for `2026-09-06T19:30:00Z ⇒ '2026-09-07'` and the two ISO-year mismatches of rule 54 |
| A one-hour hole between `endOfLocalDayMs('2024-02-29')` and `startOfLocalDayMs('2024-03-01')` silently dropping imported rows | rule 51's `end = start(next) − 1`; the 25-hour day and the round-trip property are test vectors |
| Float drift dropping the last microplate for some targets only | integer grams throughout `plates.ts`; a `toBe` test on `toGrams(2.5)+toGrams(1.25)+toGrams(0.5) === 4250` |
| A lattice enumeration blowing the 128 MB / 30 s Worker budget on a fat inventory | rule 36's hard bounds (`null`, never a hang) plus dedupe by distinct totals; a fuzz row feeds a 12×8 inventory and asserts `null` |
| A target above the maximum achievable silently reporting a −193 kg error as `ROUNDED` | the `ABOVE_MAX` status (rule 39) with its own UX affordance, and the nearest-lattice invariant excluding it |
| `Math.log` for `Math.log10`, or the inch constants copied in as metric (+6.52 pp) | M1 ⇒ `16.4360` pinned; the purity script asserts `86.010` appears nowhere under `src/lib/calc` |
| Someone "fixing" the warm-up ramp to Wendler-literal (÷0.9), making every warm-up 11% heavier | provenance comment on `WARMUP_RAMP`; W1 pinned; a test asserts step 1 of 100 kg is 40.0, not 44.4 |
| A generated RPE fixture using half-to-even, breaking cells 93.9/79.9/69.4 in CI only | `NRM` is hand-written TS, never generated; `roundHalfUp` has its own `.x5` tests and a pinned implementation |
| 100% coverage reached by assertion-free tests (coverage theatre) | every `it` below asserts a numeric value from `tests/vectors/r09.json`; `invariants.test.ts` adds property checks; spec 16 requires a reviewer to break one constant and see a red test |
| Incomplete intake logging silently inflating TDEE and *raising* the target | the complete-days filter is the caller's contract (rule 33); the Δtrend divisor is `windowDays` (rule 29); `completeDays` persisted with every estimate so a weird target is diagnosable |
| Two implementations of the streak machine (or of `isoWeekKey`) drifting while both bucket grace resets | rule 56: one owner (spec 13) for the machine, one owner (this spec) for `isoWeekKey` |
| Client/server e1RM drift on Dexie replay | one source file, no ambient time or locale (rule 6), gated by the purity script |

## Verification

```bash
npx tsc --noEmit                                  # PASS: 0 errors
npx eslint src/lib/calc tests/calc                # PASS: 0 errors (spec 16 §15's Date/performance bans)
node scripts/check-calc-purity.mjs                # PASS: prints "calc purity: OK", exit 0
npx vitest run --project=unit tests/calc          # PASS: all files pass, 0 skipped, 0 todo
npx vitest run --project=unit --coverage          # PASS: the src/lib/calc/** glob threshold reports 100
# Coverage is spec 16 §1's gate, quoted not reinvented: provider 'v8',
# coverage.include = ['src/lib/**','src/server/**'], GLOB-KEYED thresholds — 100 for 'src/lib/calc/**',
# 80/75/80/80 elsewhere. The old `vitest run tests/unit/calc --coverage` cannot pass against that
# config: it leaves every non-calc file near 0% and trips the 80% gates. Path and command both come
# from spec 16, which is also why these tests live at tests/calc/, not tests/unit/calc/.
```

`scripts/check-calc-purity.mjs` replaces the old POSIX-only `! grep -rnE …` block. The primary shell
here is PowerShell, where `!` negation and `grep -r` do not exist, and a `throw ` regex
false-positives on any doc comment containing the word — rule 1's own prose does. The script reads
every `src/lib/calc/**/*.ts`, strips block comments, line comments and string/template literals, then
fails with `file:line` for any hit on: a `throw` keyword token; `Date.now`; `new Date()` with no
argument; `Intl.`; `.toLocaleString`; `fetch(`; an import matching
`^(@/db|@/server|next/|drizzle-orm|dexie)`; the literal `86.010`; or an import of
`mifflinStJeorCombined` from outside `tests/`. For a quick manual check, both shells, because neither
runs the other's syntax:

```bash
grep -rnE "from '(@/db|@/server|next/|drizzle-orm|dexie)" src/lib/calc && exit 1 || true
```
```powershell
if (Select-String -Path src/lib/calc/*.ts -Pattern "Date\.now|new Date\(\)|Intl\.|toLocaleString|86\.010") { exit 1 }
```

Comparison rule for the whole suite: `toBeCloseTo(expected, 4)`, except where a row says *exact* (use `toBe`:
integer-gram plate results, the `T[1] = W[1]` seed, every `null`, every status string, every enum member). The week-4
TDEE vector evaluates to `2697.5000000000014` in doubles — `toBeCloseTo`, never `toBe`. Two rows that used to sit on the
tolerance boundary are restated: the blended TDEE values are quoted to **6 dp** (`|2730.4688 − 2730.46875000000023|` is
`4.99999e-5` against a 4-dp tolerance of `5e-5` — it passes with ~2e-10 of margin, which is not a test), and
`READINESS_WEIGHTS`'s sum uses `toBeCloseTo(1, 9)` because the exact sum is `0.9999999999999999`.

### Test plan — every r09 vector transcribed from [`docs/research/r09-formulas-and-test-vectors.md`](../docs/research/r09-formulas-and-test-vectors.md) via `tests/vectors/r09.json`

**`e1rm.test.ts`** (r09 §1 V-table, §2 R-table)

| describe › it | input ⇒ expected |
|---|---|
| `epley` › w·(1+r/30) | `(100,5)⇒116.666667`; `(100,6)⇒120.0`; `(82.5,8)⇒104.5` |
| `epley` › is NOT w at r=1 (r09 corrects the brief) | `(100,1)⇒103.333333` |
| `brzycki` › denominator is 37−r, not 36−r | `(100,5)⇒112.5` *exact*; `(100,6)⇒116.129032`; `(100,12)⇒144.0`; `(82.5,8)⇒102.413793` |
| `brzycki` › r=1 returns w; r=36 is absurd but finite | `(100,1)⇒100` *exact*; `(100,36)⇒3600.0` |
| `brzycki` › **the pole and beyond** | `(100,37)⇒null`; `(100,38)⇒null` |
| crossover › **the r=10 crossover is algebraic, not bitwise** (property, 20 seeded `w ∈ [1,500]`) | `toBeCloseTo(epley(w,10), brzycki(w,10), 10)` and both `toBeCloseTo(4/3·w, 10)`. **Never `toBe`:** 21 of 40 sampled weights differ in the last bit (verified — `w=88.11` ⇒ `117.47999999999999` vs `117.48`), and `w=100` differs too (`133.33333333333331` vs `…34`), so there is no weight at which bit equality is safe |
| crossover › Epley higher below 10, lower above | `r∈[2,9]` ⇒ `epley>brzycki`; `r∈[11,12]` ⇒ `epley<brzycki` |
| guards › bad weight / bad reps / off-domain | `(0,5)`, `(−5,5)`, `(NaN,5)`, `(Infinity,5)`, `(1e308,5)`, `(1001,5)`, `(100,2.5)`, `(100,0)`, `(100,−3)`, `(100,501)` ⇒ `null` |
| `e1rm` › **V1** r=1 short-circuits | `(100,1)⇒{kg:100, source:'actual_single'}` *exact*; `(100,1,10)` and `(100,1,undefined)` ⇒ the same |
| `e1rm` › V3/V4/V5 pick the right formula; **the r=10 tie resolves to Epley** (rule 12) | `(100,10)⇒133.333333 'epley'`; `(100,12)⇒144.0 'brzycki'`; `(100,6)⇒120.0 'epley'` |
| `e1rm` › **V6 + suppression above 12 reps** (rule 13) | `(100,37)`, `(100,36)`, `(100,13)` ⇒ `null` |
| `e1rm` › **R1** Epley wins at RPE 10 | `(100,5,10)⇒116.666667 'epley'` |
| `e1rm` › **R2** the headline "RPE wins" vector | `(100,5,8)⇒123.304562 'rpe'` (beats Epley by 6.6379 kg) |
| `e1rm` › **R3/R4** RPE wins at failure and at 10 reps | `(100,8,10)⇒127.226463 'rpe'`; `(100,10,9)⇒141.442716 'rpe'` |
| `e1rm` › **R5** interpolated RPE 8.25 | `(100,5,8.25)⇒122.324159 'rpe'` |
| `e1rm` › **R6 the inflation cap fires** | `(100,12,8)⇒158.4 'rpe'` (uncapped would be `159.489633`) |
| `e1rm` › off-table and sub-6 RPE fall back to the formulas | `(100,12,6)⇒144.0 'brzycki'`; `(100,5,5.5)⇒116.666667 'epley'` |
| `e1rm` › **the fake-PR regression** (rule 11) | `(100,1,9.5)⇒{kg:102.249489, source:'rpe'}` (`100/0.978`), asserted **not** `103.333333 'epley'` — which is exactly what `base = max(epley, brzycki)` produces at one rep |
| `e1rm` › a single at RPE 9 still exceeds w | `(100,1,9)⇒104.712042 'rpe'` (`100/0.955`; base is Brzycki's 100, not Epley's 103.33) |
| `e1rm` › **no winner assertion at reps=7** | documented omission: the margin is 0.024 kg, i.e. float noise (r09 §2) |
| constants spec 02's schema depends on | `PR_EPSILON_KG⇒0.01`, `MAX_REPS_FOR_E1RM⇒12`, `BRZYCKI_MAX_REPS⇒36`, `E1RM_TIE_EPSILON_KG⇒1e-9` *exact* |

**`rpe.test.ts`**

| describe › it | input ⇒ expected |
|---|---|
| `NRM` › chart identity guard; the declared shape | `NRM[2]⇒95.5` *exact* — blocks the linearised 100/97.5/95 chart; `NRM.length⇒15` and `NRM[0]⇒null` *exact* |
| `nRM` › the 14 attested cells | `k=1..14 ⇒ 100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.7` *exact* |
| `nRM` › half-rep cells round **half-up** | `k=1.5⇒97.8`; `k=6.5⇒82.4`; `k=13.5⇒64.0` *exact* |
| `roundHalfUp` › the three `.x5` chart means, and the pinned form | `(93.85,1)⇒93.9`; `(79.85,1)⇒79.9`; `(69.35,1)⇒69.4` *exact* (half-to-even gives `.8/.8/.3`); `(1.005,2)⇒1.01`; `(2.5,0)⇒3`; `(31.25,0)⇒31` |
| `roundHalfUp` › the declared domain (rule 4) | `(−2.5,0)`, `(NaN,1)`, `(1,−1)`, `(1,7)` ⇒ `null` — negatives are refused, not guessed (`Math.round(−2.5) === −2` ≠ `ROUND_HALF_UP`'s `−3`, verified) |
| `toGrams`/`fromGrams` › exact and inverse | `toGrams(2.5)+toGrams(1.25)+toGrams(0.5)⇒4250` *exact*; `fromGrams(4250)⇒4.25`; `toGrams(1e308)⇒null` |
| `nRM` › **no extrapolation** | `k = 0, 0.5, 14.5, 15, 16 ⇒ null` |
| `pct1RM` › reproduces the published grid | reps 1–11 × RPE 10→6, the r09 §2 table cell by cell; its `*`-marked cells ⇒ `null` |
| `pct1RM` › interpolates linearly in RPE | `(5,8.25)⇒81.75` *exact* |
| `pct1RM` › clamps and refuses off-table | `(5,5.5)`, `(5,0)`, `(5,10.5)`, `(12,6)` (eff 16) ⇒ `null` |
| `rirFromRpe`/`rpeFromRir` › round-trip + domain | `rpe 6..10 step 0.5` ⇒ identity; `(−1)`, `(11)` ⇒ `null` |
| `effectiveRir` › RIR wins, RPE is the fallback, `undefined` ≡ `null` (rules 7, 17) | `{rir:3, rpe:6}⇒3`; `{rir:null, rpe:8}⇒2`; `{rir:undefined, rpe:undefined}⇒null`; `{rir:null, rpe:0.5}⇒null` |

**`bodyfat.test.ts`**

| describe › it | input ⇒ expected |
|---|---|
| male › **M1**, **M2** | `(85,38,178)⇒16.4360`; `(100,40,178)⇒25.5011` |
| female › **F1**, **F2** | `(72,96,32,165)⇒26.4059`; `(88,105,34,165)⇒37.5517` |
| provenance › metric ≠ imperial; base-10 not natural log | M1 ⇒ `16.4360`, asserted > 6 pp away from the inch form's `22.9555`, and `> 0` (natural log ⇒ ≈ `−591`) |
| guards › all null paths | `waist−neck<=0` `(38,38,178)`; female `hipCm: null`/`undefined`; `height 0`; `height 301`; `neck NaN`; contrived `<2%`/`>60%` ⇒ `null` |
| `leanMassKg` › M1 body + guards | `(82,16.4360)⇒68.522480`; `(82,100)`, `(0,20)`, `(1001,20)` ⇒ `null` |

**`trend.test.ts`**

| describe › it | input ⇒ expected |
|---|---|
| `trendWeight` › **the 10-day series, 6 dp** | `82.0, 82.6, 81.8, 82.4, 83.1, 82.2, 81.9, 82.5, 82.0, 81.6` ⇒ `82.000000, 82.060000, 82.034000, 82.070600, 82.173540, 82.176186, 82.148567, 82.183711, 82.165340, 82.108806` |
| `trendWeight` › seeds `T[1] === W[1]`; lags a falling series | first point ⇒ `82.0` *exact*; `T[10] − mean(82.21) ≈ −0.101194` |
| `trendWeight` › **single point**; empty series | `[{d,82.0}]` ⇒ one point `trendKg 82.0 excluded false`; `[]` ⇒ `[]` (not `null`) |
| `trendWeight` › **gap-aware α after one missed day** | `T=82.108806`, day 11 missing, day 12 `81.4` ⇒ `toBeCloseTo(81.974133, 4)` (αEff `0.19`) **and** `expect(trendKg).not.toBeCloseTo(82.037925, 4)` — the skip-missing value asserted negatively, as an assertion rather than as prose about a wrong implementation |
| `trendWeight` › outlier flagged, trend unchanged | `…82.1, 90.0, 82.0` ⇒ the 90.0 point `excluded: true` with the prior `trendKg`; the next point resumes from the un-moved trend |
| `trendWeight` › rejects unsorted / same-day duplicates | descending dates; two readings one date ⇒ `null` |
| `trendWeight` › malformed readings dropped | `kg: 0`, `kg: NaN`, `kg: 1001`, `localDate: '2026-2-3'` ⇒ absent from output, other points unchanged |
| `emaStep` › correction form; the constants | `(82.0,82.6,0.1)⇒82.06`; `TREND_HALF_LIFE_DAYS⇒6.578813`, `TREND_MEAN_LAG_DAYS⇒9` |

**`energy.test.ts`**

| describe › it | input ⇒ expected |
|---|---|
| `mifflinStJeor` › split form, both sexes | `('male',82,178,30)⇒1787.5`; `('female',65,165,30)⇒1370.25` *exact* |
| `mifflinStJeorCombined` › differs by 1.58 (`@internal`, test-only) | `('male',82,178,30)⇒1789.08`, asserting `combined − split ≈ 1.58` |
| `katchMcArdle` › M1 body, and not Cunningham | `(82,16.4360)⇒1850.085568`, asserted `≠ 500 + 22·LBM` |
| `applyActivityFactor` › both priors | `(1787.5,1.55)⇒2770.625`; `(1850.085568,1.55)⇒2867.632630` |
| guards | age 0/130, height 0/301, kg ≤ 0 / 1001, factor 0.5/3, `rmrKcal 20001` ⇒ `null` |

**`tdee.test.ts`**

| describe › it | input ⇒ expected |
|---|---|
| `tdeeFromEnergyBalance` › **the week-4 vector and its sign** | `(2450, 82.400, 81.500, 28)⇒2697.5`, asserted `≠ 2202.5` (the `+` bug) |
| `tdeeFromEnergyBalance` › gain lowers it; `windowDays = 0` | `(3000, 80.0, 80.7, 28)⇒2807.5`; `(2450,82.4,81.5,0)⇒null` (never `Infinity`) |
| `blendTdee` › **all four blended values of the worked example, 6 dp** (prior `p = 2770.625`) | `(0.25,2610.0,p)⇒2730.468750`; `(0.5,2672.5,p)⇒2721.562500`; `(0.75,2680.0,p)⇒2702.656250`; `(1,2697.5,p)⇒2697.500000` |
| `capWoW` › **the clamp fires both ways, and not at all** | `(3000,2700)⇒{kcal:2950, capped:true}`; `(2300,2700)⇒{2450,true}`; `(2800,2700)⇒{2800,false}`; `(3000,null)⇒{3000,false}` |
| `adaptiveTdee` › **the four worked-example weeks, as the guards actually classify them** (prior `2770.625`; `windowDays` = `completeDays` = 7/14/21/28) | wk1 `meanIntake 2500, trend 82.400→82.300, completeDays 7, weighIns 7` ⇒ `'PRIOR_ONLY'`, `tdeeDataKcal 2610.0`, `tdeeKcal 2770.625`, `blendWeight 0`, `blendedKcal null`; wk2 `2480, →82.050, 14, 14` ⇒ `'CALIBRATING'`, data `2672.5`, `blendWeight 0.5`, `blendedKcal 2721.562500`, `tdeeKcal 2721.562500`; wk3 `2460, →81.800, 21, 21` ⇒ `'READY'`, data `2680.0`, `w 0.75`, `2702.656250`; wk4 `2450, →81.500, 28, 28` ⇒ `'READY'`, data `2697.5`, `w 1`, `2697.500000`; `capped false` and `suspectWeightChange false` throughout. **Week 1 asserts a guard status and `tdeeDataKcal`, never a blended number** — 7 complete days can never satisfy rule 31's `>= 14`, which is why the `2730.468750` blend is asserted on `blendTdee` above instead |
| `adaptiveTdee` › the cap fires end to end, from real fields | `prior 2770.625, windowDays 28, completeDays 28, weighIns 28, intakeDaysLogged 28, meanIntake 3000, trend 82.0→82.0, last 2700` ⇒ `blendedKcal 3000`, `tdeeKcal 2950`, `capped true`, `'READY'`; the same with `meanIntake 2300` ⇒ `blendedKcal 2300`, `tdeeKcal 2450`, `capped true` |
| `adaptiveTdee` › `PRIOR_ONLY` for each shortfall, `tdeeDataKcal` still carried | `completeDays 13` (weighIns 20) ⇒ `'PRIOR_ONLY'`, `tdeeKcal === priorKcal`, `blendWeight 0`, `tdeeDataKcal` non-null; `weighIns 9` (completeDays 20) ⇒ the same; `trendEndKg null` ⇒ the same but `tdeeDataKcal null` |
| `adaptiveTdee` › `NO_ESTIMATE`: **never divides, never shows a number** | `completeDays 0` ⇒ `'NO_ESTIMATE'`, `tdeeKcal null`, `tdeeDataKcal null`, no `Infinity`; `intakeDaysLogged 2` with a prior and 20 complete days ⇒ `'NO_ESTIMATE'`, `tdeeKcal null`; `priorKcal null, completeDays 10` ⇒ `'NO_ESTIMATE'` |
| `adaptiveTdee` › no prior but blendable ⇒ `w` forced to 1 | `priorKcal null, windowDays 28, completeDays 28, weighIns 28, meanIntake 2450, trend 82.4→81.5` ⇒ `'READY'`, `blendWeight 1`, `tdeeKcal 2697.5` |
| `adaptiveTdee` › **the suspect flag is orthogonal to status** | `completeDays 28, weighIns 28, windowDays 28, meanIntake 2450, trend 82.400→81.200, bodyWeightKg 82` ⇒ `suspectWeightChange true` **and** `status 'READY'` **and** `tdeeKcal 2780.0`; the same window at `completeDays 13` ⇒ `suspectWeightChange true` **and** `status 'PRIOR_ONLY'` — the old single enum could report only one of the two |
| `adaptiveTdee` › the divisor is `windowDays` (rule 29) | `completeDays 14, windowDays 28, weighIns 14, meanIntake 2450, trend 82.400→81.500` ⇒ `tdeeDataKcal 2697.5`; the `completeDays`-as-divisor reading gives `2945.0`, asserted `not` |
| constants | `ENERGY_DENSITY_KCAL_PER_KG⇒7700`, `TDEE_MIN_LOGGED_DAYS⇒3`, `TDEE_MIN_COMPLETE_DAYS⇒14`, `TDEE_MIN_WEIGH_INS⇒10`, `TDEE_WARMUP_DAYS⇒21`, `TDEE_BLEND_FULL_DAYS⇒28`, `TDEE_MAX_WOW_DELTA⇒250`, `TDEE_SUSPECT_DELTA_FRACTION⇒0.01` |

**`plates.test.ts`** — bar `20.0`, inventory `{25:2, 20:2, 15:1, 10:2, 5:2, 2.5:2, 1.25:2, 0.5:2}`

| describe › it | input ⇒ expected |
|---|---|
| `minIncrementKg` › 2 × the smallest **available** pair (rule 40) | fixture ⇒ `1.0` *exact*; `[[0.5,0],[2.5,2]]` ⇒ `5.0` *exact*; `[[25,0]]` ⇒ `null`; `[]` ⇒ `null` |
| `maxAchievableKg` › the fixture ceiling | ⇒ `307.0` *exact* |
| `achievableTotals` › dedupes to distinct totals, and equals the full enumeration | `size ⇒ 345` *exact* (from 4374 raw combinations); every key/list pair identical to a brute-force enumeration built inside the test |
| `achievableTotals` › the rule-36 bounds return `null`, never hang | 13 denominations ⇒ `null`; `pairsAvailable 21` ⇒ `null`; a 12×8 inventory (`9^12` combinations) ⇒ `null`; `plateKg 0` / `101` / `pairs 1.5` / `pairs −1` ⇒ `null` |
| `plateMath` › **P1**, **P2** exact (P2 is the microplate vector) | `100.0⇒[25,15] 100.0 EXACT`; `62.5⇒[20,1.25] 62.5 EXACT`; `errorKg 0` *exact* |
| `plateMath` › **P3 nearest beats greedy 9×**; **P3 roundDown** | `101.9 'nearest'⇒[25,15,0.5,0.5] 102.0 +0.1 ROUNDED`; `101.9 'roundDown'⇒[25,15,0.5] 101.0 −0.9 ROUNDED` |
| `plateMath` › **P4 target below bar** | `15.0⇒[] 20.0 +5.0 BELOW_BAR` |
| `plateMath` › **`ABOVE_MAX`** (rule 39) | `500.0 ⇒ status 'ABOVE_MAX'`, `achievedKg 307.0`, `errorKg −193.0` *exact*, `platesPerSide` = all 15 available plates descending |
| `plateMath` › tie-breaks upward, then fewest plates | `102.25⇒102.5 [25,15,1.25] +0.25`; `102.0⇒[25,15,0.5,0.5]`, never `[20,20,0.5,0.5]` |
| `plateMath` › the lattice is **not** a uniform grid (rule 40) | totals in `[99,105]` ⇒ exactly `99.5, 100.0, 101.0, 102.0, 102.5, 103.5, 104.5, 105.0`; `100.5` and `101.5` absent, yet `102.5` present, so the step is not a flat 1.0 |
| `plateMath` › **empty inventory**, all-zero pairs | `[]`, `[[25,0]]` ⇒ `NO_INVENTORY`, `platesPerSide []`, `achievedKg 20.0` |
| `plateMath` › target = the bar; the fewest-plate answer for 42.5 | `20.0⇒[] 20.0 0 EXACT`; `42.5⇒[10,1.25] 42.5 0 EXACT` (`toBe`) — 11.25 kg per side in two plates, verified by full lattice enumeration. The old `[2.5,1.25,0.5]` sums to 4.25/side = **28.5 kg total**, not 42.5, and violated rule 37's fewest-plates rule |
| `plateMath` › pairs not loose plates; a 15 kg bar | `[[10,1]]` at `40`⇒`[10] 40.0`; `barKg 15` at `55`⇒`[20] 55.0 EXACT` |
| guards | `(NaN,20,inv)`, `(100,0,inv)`, `(1e308,20,inv)`, `(100,20,[[25,−1]])` ⇒ `null` |

**`warmup.test.ts`**

| describe › it | input ⇒ expected |
|---|---|
| `warmupSets` › **W1** all three land exactly | `100.0 ⇒ 40.0 [10]×5, 50.0 [15]×5, 60.0 [20]×3` |
| `warmupSets` › **W2** the middle step rounds down | `87.5 ⇒ 35.0 [5,2.5]; 43.75→43.50 (−0.25); 52.5 [15,1.25]` |
| `warmupSets` › never exceeds its raw prescription | random 40–200 kg ⇒ `weightKg <= rawKg` for every step |
| `warmupSets` › collapsed ramps suppressed; steps stay below the working weight | `40.0`, `20.0`, `15.0` ⇒ `[]` (40% of 40 kg is below the bar — never three 20 kg rows); `30.0` ⇒ every `weightKg < 30.0` |
| `warmupSets` › custom ramp honoured | `[{0.5,5},{0.7,3},{0.85,1}]` at `100.0` ⇒ `50.0, 70.0, 85.0` |
| provenance › % of the working weight, not the Training Max | `100.0` ⇒ first step `40.0`, **not** `44.4` |
| guards (rule 44) | non-finite or `>1000` working weight ⇒ `null`; **`barKg 0` and `barKg −1` ⇒ `null`**; ramp `[{pct:0,reps:5}]` and `[{pct:1,reps:0}]` ⇒ `null`; empty inventory ⇒ `[]` |

**`volume.test.ts`** — fixture = the r09 §8 ten-set week with effective loads already resolved (rule 46); `rir: null` on unannotated sets, `rir: 5` on the second Cable Fly (in range: rule 17 bounds `rir` to `0..9`)

| describe › it | input ⇒ expected |
|---|---|
| `totalVolumeKg` › excludes warm-ups; `[]` is 0 | the 10-set week ⇒ `3270.0` *exact* (the 380 kg of warm-ups is out); `[]` ⇒ `0` *exact*, not `null` |
| `setVolumeKg` › reps × effective weight; the **zero-load** edge | `80×8⇒640.0` *exact*; `0×10⇒0` *exact* (not `null`) — the zero-**load** case, not "the bodyweight case": a bodyweight pull-up reaches calc as ~80 kg because spec 06 resolved it first |
| `isCountedSet` › drop, failure and **amrap** count, warmup does not | one of each of spec 02's five `SET_TYPES` ⇒ `true, true, true, true, false` |
| `isHardSet` › RIR 5 out, 4 in, 4.5 out; **null RIR counts** (rule 47); the RPE fallback | the RIR-5 fly ⇒ `false`; `rir 4⇒true`, `4.5⇒false`; `rir null, rpe null` working ⇒ `true`; `rir null, rpe 8` ⇒ `true` (`effectiveRir 2`); `rir null, rpe 5` ⇒ `false` (`effectiveRir 5`) |
| `creditForRole` › the only consumer of the credit constants | `'primary'⇒1.0`, `'secondary'⇒0.5` *exact* |
| `hardSetsByMuscle` › credited counts | ⇒ `chest 6.0`, `front_delts 2.5`, `triceps 3.5` *exact* |
| `volumeByMuscle` › per-muscle tonnage, and the deliberate double-count | ⇒ `chest 2850.0`, `front_delts 1185.0`, `triceps 1605.0`; `Σ = 5640.0 ≠ 3270.0` |
| `volumeByMuscle` › unknown `exerciseId`; empty sets | absent from the map yet counted in tonnage; `[]` ⇒ empty Map (not `null`) |
| constants | `PRIMARY_MUSCLE_CREDIT⇒1.0`, `SECONDARY_MUSCLE_CREDIT⇒0.5`, `HARD_SET_MAX_RIR⇒4`, `COUNTED_SET_TYPES⇒['working','drop','failure','amrap']` |

**`time.test.ts`**

| describe › it | input ⇒ expected |
|---|---|
| `almatyOffsetMinutes` › now, **pre-2024-03-01**, and the verified instant | `2026-09-13T02:30:00Z⇒300`; `2023-06-01T00:00:00Z⇒360`; `1709229600000⇒300`; `1709229599999⇒360` |
| `almatyOffsetMinutesForDate` › the date-keyed twin (rule 51) | `'2024-02-29'⇒360`; `'2024-03-01'⇒300`; `'2026-09-13'⇒300`; `'2026-2-3'⇒null` |
| `localDateFromInstant` › **the off-by-one** and its neighbour | `2026-09-06T19:30:00Z⇒'2026-09-07'`; `…T18:59:59Z⇒'2026-09-06'` |
| **the tz transition has no hole** (rule 51) | `startOfLocalDayMs('2024-03-01')⇒1709233200000` *exact*; `endOfLocalDayMs('2024-02-29')⇒1709233199999` *exact*; `end + 1 === startOfLocalDayMs('2024-03-01')`; that local day is `25 h` long while `'2024-03-01'` is `24 h` |
| round-trip property across the transition | for 400 seeded dates spanning 2023-01-01…2027-12-31: `localDateFromInstant(startOfLocalDayMs(d))===d` and `localDateFromInstant(endOfLocalDayMs(d))===d` |
| `rolling7dWindow` › **the r09 §8 window** | `nowMs 1789266600000` (`2026-09-13T07:30+05:00`) ⇒ `'2026-09-07'`, `'2026-09-13'`, `1788721200000`, `1789325999999` *exact* |
| `rolling7dWindow` › always spans 7 local days | random in-domain `nowMs` ⇒ `diffDays(startDate, endDate) === 6` |
| `diffDays`/`localDateRange` › week span, year boundary, single day, reversed, **the span cap** | `('2026-09-07','2026-09-13')⇒6`; `('2025-12-31','2026-01-01')⇒1`; `(d,d)⇒[d]`; reversed ⇒ `null`; `('1970-01-01','2999-12-31')` and any span `> 3660 d` ⇒ `null`; `('2026-01-01','2035-12-30')` (3650 d) ⇒ length `3651` |
| `isoWeekKey` › Monday-start week; **the ISO-year mismatches** (rule 54) | `2026-09-07…13` ⇒ all `'2026-W37'`; `2026-01-01⇒'2026-W01'`, `01-04⇒'2026-W01'`, `01-05⇒'2026-W02'`; **`2027-01-01⇒'2026-W53'`**, **`2026-12-31⇒'2026-W53'`**, **`2024-12-30⇒'2025-W01'`** (all verified) |
| `isoWeekKey` › constant across each Monday–Sunday run | for every Monday-anchored 7-day `localDateRange` in 2024–2027, all 7 keys are equal and the next Monday's differs |
| guards | `'2026-9-7'`, `'2026-02-30'`, `''`, `'1899-12-31'`, `'2100-01-01'` ⇒ `null` |

**`recovery.test.ts`** — `nowMs = startOfLocalDayMs('2026-09-13')`, `halfLifeDays 2`, saturation `10`

| describe › it | input ⇒ expected |
|---|---|
| `muscleRecovery` › the decay curve | `chest {'2026-09-13': 10}` ⇒ `chest 0` *exact*; `{'2026-09-11': 10}` ⇒ `0.5`; `{'2026-09-09': 10}` ⇒ `0.75`; `{'2026-09-12': 10}` ⇒ `0.292893` |
| `muscleRecovery` › accumulates across days, clamps at 0 | `{'2026-09-13': 6, '2026-09-11': 6}` ⇒ `0.1`; `{'2026-09-13': 20}` ⇒ `0` *exact*, never negative |
| `muscleRecovery` › a muscle with no recent work is **absent**, not 1.0 (rule 57) | `new Map()` ⇒ empty Map; `{chest: new Map()}` ⇒ empty Map |
| `muscleRecovery` › `halfLifeDays` is honoured | `{'2026-09-09': 10}` at `halfLifeDays 4` ⇒ `0.5` |
| guards | a future day `'2026-09-14'`, `'2026-2-3'`, sets `−1`, sets `NaN`, `halfLifeDays 0`, `nowMs 1e308` ⇒ `null` |
| constants + provenance | `MUSCLE_RECOVERY_HALF_LIFE_DAYS⇒2`, `MUSCLE_RECOVERY_SATURATION_SETS⇒10`; a test asserts both are exported from `constants.ts` and that the `UNVERIFIED` tag is in their provenance comment |

**`readiness.test.ts`** — inputs `(sleepHours, energy, soreness 0..3, mood)`

| describe › it | input ⇒ expected |
|---|---|
| `readinessScore` › **K1–K4** anchors | `(8,5,0,5)⇒100`; `(4,1,3,1)⇒0`; `(6,3,2,3)⇒47` (raw `46.666667`); `(7,4,1,4)⇒73` (raw `73.333333`) |
| `readinessScore` › **K5 the soreness inversion is load-bearing** | `(5,2,3,5)⇒31` (raw `31.25`); a non-inverted soreness gives `51` |
| `readinessScore` › **K6 partial check-in renormalises** | `(8,3,null,null)⇒77` (raw `76.923077`, weights `0.65`) — **not** `50` |
| `readinessScore` › **K7** one component only; all `null`; all `undefined` | `(8,null,null,null)`, all `null`, all `undefined` ⇒ `null` (rule 7) |
| `readinessScore` › **K8** sleep clamps at 8 h; floors at 4 h | `(11,5,0,5)⇒100` (= K1); `(2,3,2,3)⇒29` and equals `(4,3,2,3)` |
| `readinessScore` › an out-of-range component drops only itself | `(8,7,0,5)` equals `(8,null,0,5)` (both `100`); `(8,5,4,5)` equals `(8,5,null,5)` |
| `readinessScore` › steps never affect the score | K4 with `steps 0` vs `25000` ⇒ identical |
| `readinessParts` › sub-scores; `null` exactly when the score is (rule 61) | K4 ⇒ `{sleep:0.75, energy:0.75, soreness:0.666667, mood:0.75}`; `(8,null,null,null)` ⇒ `null`; a 200-case sweep asserts `(parts === null) === (score === null)` |
| `READINESS_WEIGHTS` › sums to 1 **within 1e-9** (rule 58) | `toBeCloseTo(1, 9)` — the exact sum is `0.9999999999999999`, so `toBe(1)` fails |

**`invariants.test.ts`** — what makes 100% coverage mean something

| it | expected |
|---|---|
| no exported calc function throws on 500 seeded pseudo-random inputs incl. `NaN`, `±Infinity`, `-0`, `1e308`, `1001` kg, `501` reps, `'2026-2-3'` | no throw; every numeric result is `null` or `Number.isFinite` |
| **the domain guard, not just finiteness** (rule 3): every off-domain seed returns `null` | `brzycki(1e308,36)`, `epley(1e308,12)`, `setVolumeKg({weightKg:1e308,reps:2})`, `startOfLocalDayMs('9999-01-01')` ⇒ `null` — the corpus tests the guard instead of breaking the contract |
| no exported function ever returns `NaN` or `±Infinity` | same corpus |
| `e1rm` is strictly monotone in weight for fixed `(reps, rpe)` | `w1 < w2 ⇒ kg1 < kg2`, `w` drawn from `[1, 500]` |
| `plateMath('nearest')` returns the **nearest lattice entry** (rule 41) | for 200 seeded targets × 20 seeded in-bounds inventories: `abs(achievedG − targetG) <= abs(x − targetG)` for every key `x` of `achievableTotals`, ties upward; excluded `BELOW_BAR`, `ABOVE_MAX`, `NO_INVENTORY`. A separate fixture-only row asserts `abs(errorKg) <= 0.5` for targets in `[20, 307]`, the fixture's largest lattice gap being exactly `1.0` kg |
| `trendWeight` emits exactly one point per well-formed reading | random series |
| every `src/lib/calc/*.ts` module is re-exported by `index.ts` | directory listing matches the barrel |

## Open questions

1. **The Δtrend divisor: `windowDays` (this spec, rule 29) vs `completeDays` (r09 §5 step 2 and
   spec 11 §33).** r09's reasoning is that `meanIntake` is taken over complete days so the energy
   balance should be too. The counter-argument is arithmetic: the mass change accrued over all 28 days
   regardless of which were logged, so dividing it by 14 doubles the correction. At 14 complete days
   out of 28 with Δtrend = −0.9 kg the term is −495 vs −247.5 kcal/day — a 247 kcal/day error in the
   direction that *raises* the target, which is the exact failure r09 calls the cardinal sin. Both
   readings reproduce the 4-week worked example identically because there `completeDays === windowDays`,
   so no existing vector distinguishes them.
   (a) `windowDays`, as specified here, with spec 11 §33 corrected. (b) `completeDays`, matching r09
   verbatim and accepting the bias. **Recommendation: (a)** — record in `DECISIONS.md` and correct
   spec 11 §33 plus r09 §5 step 2 in the same commit, since two documents currently state (b).
2. **`READINESS_WEIGHTS` (0.35 sleep / 0.30 energy / 0.20 soreness / 0.15 mood) and the recovery
   model's `MUSCLE_RECOVERY_HALF_LIFE_DAYS = 2` / `MUSCLE_RECOVERY_SATURATION_SETS = 10`.** No
   published formula exists for either — r09 covers neither and I found no primary source, so both are
   invention, tagged `UNVERIFIED`. (a) Ship them labelled "our formula — not a validated instrument",
   disclosed in the breakdown sheet and the recovery readout (rule 58, UX notes), and revisit after
   ~8 weeks by correlating readiness and recovery against session tonnage and e1RM. (b) Show the four
   sub-scores and the per-muscle set counts with no composite number at all.
   **Recommendation: (a)** — a single 0–100 ring is the point of the check-in screen, and
   `readinessParts` plus the provenance line keep it honest. Record in `DECISIONS.md`.
3. **`SECONDARY_MUSCLE_CREDIT = 0.5` (brief) vs `1.0` (Schoenfeld 2019).** The only paper on the
   question explicitly recommends counting on "a 1:1 basis" until better evidence exists (r09 §8).
   (a) Keep `0.5` with the legend "secondary muscles counted at 50%". (b) Use `1.0` per the paper.
   **Recommendation: (a)** — the heatmap's job is relative visual emphasis, and 1:1 makes every
   pressing week look like maximal arm volume. Cheap to revisit: spec 02's `volume_weights` table is
   the runtime source and `creditForRole` only seeds it. If spec 12's "under-trained muscle" flag ever
   drives real programming decisions, 1:1 is the defensible number there.
4. **Should `e1rm` return `null` above 12 reps (rule 13), deviating from r09's reference
   implementation?** (a) Yes — suppress in the pure layer so 3600 kg can never be persisted or poison
   `max(e1rm)`; the cost is that a 15-rep set shows `—`. (b) Return the number and suppress only in
   the UI, keeping the stored column complete.
   **Recommendation: (a)**, which is r09 §1's own open-decision recommendation applied one layer
   deeper and what spec 02 rule 10 already assumes. If high-rep e1RM is later wanted for analytics,
   add an explicit `e1rmUnclamped()` rather than loosening `e1rm`.
5. **Cross-spec corrections this spec depends on.** Each is a small edit in a spec this one does not
   own; all five must land before implementation, and none of them changes a number here.
   1. `specs/11-nutrition-ai.md` §33: `TDEE_data = meanIntake − (Δtrend × 7700 / **windowDays**)`
      (open question 1). Separately, §33 says to persist `suspectWeightSwing` but
      `specs/02-data-model.md`'s `tdee_snapshots` has no column for it — add `suspect_weight_swing`.
   2. `specs/02-data-model.md` `sets`: add a `sets_rir_range` CHECK — `rir IS NULL OR (rir BETWEEN 0
      AND 9)`, written in the same `check(name, sql-template)` form as `sets_rpe_range` — and state which
      of `rpe`/`rir` the writer populates. Rule 17 assumes both are written with `rir` winning; the
      CHECK is what stops a 10-RIR row from reaching `isHardSet`.
   3. `specs/13-gamification.md`: delete `isoWeekKey` from `src/lib/gamification/iso-week.ts` and
      import it from `@/lib/calc` (rules 54, 56), keeping only `isoWeekDays`/`isWeekEnd` there; drop
      the duplicate vectors in `tests/unit/gamification/iso-week.test.ts` in favour of
      `tests/calc/time.test.ts`.
   4. `specs/16-testing-ci-quality.md` §15: add to the `src/lib/calc/**` override the
      `no-restricted-syntax` selectors `"ThrowStatement"`,
      `"MemberExpression[object.name='Intl']"` and
      `"CallExpression[callee.property.name='toLocaleString']"`, so rule 1's ban is enforced by the
      linter as well as by the script; and register `node scripts/check-calc-purity.mjs` in `ci.yml`.
   5. `specs/13-gamification.md`: `DayKey`/`LocalDay` becomes `type LocalDay = LocalDate` re-exported
      from `@/lib/calc` (Data section). And §27's recovery axis must be `100 × meanReadiness / 100`,
      not `/ 10` — `readinessScore` is an integer **0–100** (rule 58), so `/10` grades that axis at
      750 and an `A` for every user who ever checks in.
