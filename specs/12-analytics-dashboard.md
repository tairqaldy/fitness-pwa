# 12 — Dashboard, charts, muscle heatmap and calendar heatmap

## Purpose

The read-only analytics surface: the dashboard route, the GitHub-style calendar heatmap, the flagship
SVG muscle body-map, e1RM/volume/bodyweight/body-composition charts, Apple-style macro rings, the PR
feed and the weekly volume table. Satisfies brief bullet 7 (`DASHBOARD & ANALYTICS`) and the Phase 6
DoD ("both heatmaps render from real data").

It owns **no formula**: every constant and every per-set predicate comes from `@/lib/calc` (spec 07)
and every credit weight from spec 02's `volume_weights` table. What it does own is **aggregation** —
the SQL that folds sets into days, muscles and ISO weeks — and Behaviour 22 fixes the one test that
keeps that SQL honest: the same fixture week must produce identical numbers through the SQL and
through spec 07's `hardSetsByMuscle()` / `volumeByMuscle()`. It writes nothing but one rollup table
and two KV keys.

## Scope

In scope: dashboard composition and order; the query/aggregation/caching strategy; the 5-step lime
colour scale; the calendar heatmap; the body-map SVG (asset, licence, id convention, colour mapping,
tap, keyboard path, table fallback); e1RM curves; volume charts and the under-trained rule;
bodyweight + trend; macro rings; body-composition chart; PR feed; weekly volume table; the
chart-library decision and this module's rows in spec 16's route budget table.

### Out of scope

| Excluded | Owner |
|---|---|
| `epley`, `brzycki`, `pct1RM`, `e1rm`, `trendWeight`, `navyBodyFatPct`, `volumeByMuscle`, `hardSetsByMuscle`, `isCountedSet`, `isHardSet`, `COUNTED_SET_TYPES`, `PRIMARY/SECONDARY_MUSCLE_CREDIT`, `rolling7dWindow`, `isoWeekKey`, `isoWeekday`, `localDateFromInstant`, `diffDays` | `specs/07-calculators.md` (`@/lib/calc`) |
| All DDL: the 40 tables, every column, index, enum and CHECK named in §Data | `specs/02-data-model.md` |
| `sets`/`workouts` writes; `volume_kg`/`hard_sets`/`e1rm_kg` derivation at finish; PR detection | `specs/06-workouts.md` |
| `exercise_muscles` rows, the credits map, `MUSCLES` semantics | `specs/08-exercise-library.md` |
| Macro/calorie targets, `food_entries` writes, the AI correction loop, adaptive TDEE | `specs/11-nutrition-ai.md` |
| Streak/XP/adherence in the today strip, `streak_ledger.status`, monthly + year-in-review reports | `specs/13-gamification.md` |
| The `scheduled()` entrypoint, `worker.ts`, `CronName`, the `nightly-rollup` job body | `specs/01-architecture.md` |
| `notify()` and the Telegram channel the drift alarm goes out through | `specs/14-ai-coach-and-notifications.md` |
| Tokens, fonts, radii, haptics and shimmer primitives, sheet chrome | `specs/03-design-system.md` |
| Serwist runtime caching, the `/~offline` route, the Dexie database `fit` and its version ladder | `specs/05-pwa-offline-sync.md` |
| Playwright config, `perf-budgets.json`, the axe gate, the LHCI/LCP gate | `specs/16-testing-ci-quality.md` |
| Progress-photo serving | `specs/10-body-photos.md` |

### Deviations from the brief (owner-visible, not buried)

The brief is authoritative product intent; neither `stack-facts.md` nor r09 overrides it on these
three points, so they are recorded here rather than argued inside a behaviour rule.

| # | Brief says | This spec ships | Why |
|---|---|---|---|
| D1 | "SVG muscle heatmap (**colour intensity = rolling-7-day volume per muscle**)" | colour intensity = rolling-7-day **credited hard sets** | Calf kg and quad kg are not comparable; fractional set counts are, and the only threshold with a citation (`>10 sets/muscle/week`, r09 §8) is a set count. Tonnage is still shown — as a number, in the table and both sheets. Behaviour 12. |
| D2 | "**visx** for the custom SVG muscle heatmap" | hand-rolled inline SVG, server-rendered, zero visx | The map is ~40 static `<path>`s with a `fill` each. visx buys nothing and costs client JS on the route with the tightest budget. visx is still used for the four interactive charts. Behaviour 24. |
| D3 | "Recharts for standard charts" | **no Recharts anywhere** | `recharts@3.10.1` is 147,530 B gzipped (bundlephobia, 2026-09-12) against spec 16's 200 KB total-script budget for `/analytics`. Open question 1 carries the owner decision. |

## Files to create

| Path | Responsibility |
|---|---|
| `src/app/(app)/page.tsx` | Dashboard route. `force-dynamic`, RSC, tiles in the Behaviour-1 order. |
| `src/app/(app)/analytics/page.tsx` | `force-dynamic`. Volume charts, bodyweight, body composition, weekly volume table. |
| `src/app/(app)/analytics/exercise/[exerciseId]/page.tsx` | `force-dynamic`. e1RM curve + raw-set scatter for one exercise. |
| `src/app/api/analytics/day/[date]/route.ts` | `GET` day detail for a calendar tap (`date` = `YYYY-MM-DD`). |
| `src/app/api/analytics/muscle/[muscle]/route.ts` | `GET` contributing exercises for a body-map tap, rolling 7 d. |
| `src/server/analytics/queries.ts` | Every Drizzle read in this module. Nothing else here touches D1. |
| `src/server/analytics/dashboard.ts` | Assembles `DashboardPayload`; cache-aside over `queries.ts`; never throws. |
| `src/server/analytics/cache.ts` | `CACHE_KV` key builders, get/put/invalidate, version prefix. |
| `src/server/analytics/rollups.ts` | `recomputeMuscleWeek` / `rebuildMuscleWeeks` / `verifyMuscleWeeks`. |
| `src/lib/analytics/buckets.ts` | Pure: percentile cut-points, the shared 4-cut bucketer, muscle levels. |
| `src/lib/analytics/scale.ts` | `LIME_SCALE`, `levelToHex`, `contrastVsBlack`. |
| `src/lib/analytics/muscle-map.ts` | Asset-slug ↔ `Muscle` mapping, `muscleSvgId`, region-combination rules. |
| `src/lib/analytics/months.ts` | `monthLabelsFor(firstDate, cols, names)` — arithmetic, never `Intl` (spec 07 rule 6). |
| `src/components/analytics/calendar-heatmap-view.tsx` | **Shared pure view.** No `'use client'`, no `'use server'`, no imports from `@/server/**`: `(props) => JSX` for the 53×7 grid. Imported by both the server tile and the offline island. |
| `src/components/analytics/body-map-view.tsx` | Shared pure view, front + back, per-muscle `<g>` with data attrs. Same rules. |
| `src/components/analytics/macro-rings-view.tsx` | Shared pure view, 3 concentric rings + labelled legend. Same rules. |
| `src/components/analytics/calendar-heatmap.tsx` | Server tile: caption, legend, rest-day count, `<details>` table; renders the view. |
| `src/components/analytics/body-map.tsx` | Server tile: caption, legend, `role="img"`; renders the view. |
| `src/components/analytics/calendar-client.tsx` | **Island 1.** Scroll-snap, fit toggle, tap→day sheet, the day-picker button, the `‹ ›` steppers. |
| `src/components/analytics/muscle-detail-client.tsx` | **Island 2.** Mounted once; opens the muscle sheet for taps on the map *and* keyboard activation of a weekly-table row button. |
| `src/components/analytics/offline-snapshot.tsx` | **Island 3.** Persists the last good payload to IndexedDB; on `/~offline` reads it back and renders the three shared views. |
| `src/components/analytics/body-map-paths.ts` | Vendored MIT path data, re-keyed to `Muscle`. Behaviour-9. |
| `src/components/analytics/sparkline.tsx` | Hand-rolled `<polyline>`, no library. Used in tile headers. |
| `src/components/analytics/{e1rm,volume,bodyweight,body-comp}-chart.tsx` | The four visx client charts, each `next/dynamic`-imported. |
| `src/components/analytics/pr-feed.tsx` | Server list of `personal_records`, grouped by `local_day`. |
| `src/components/analytics/weekly-volume-table.tsx` | Server table; each muscle row carries a 44 px `<button>` opening the muscle sheet. The body-map a11y equivalent. |
| `src/components/analytics/skeletons.tsx` | One skeleton per tile, identical box metrics to the real tile. |
| `src/components/analytics/empty-state.tsx` | `<AnalyticsEmpty kind=… />`; copy comes from the `analytics` message namespace, never inline literals. |
| `src/components/analytics/tiles-error.tsx` | Server-rendered whole-stack failure frame with a plain `<a href>` retry. Zero JS. |
| `messages/{ru,en}.json` → `analytics.*` | This module's whole copy surface, including `analytics.months` (12 names, per locale). Owned jointly with spec 01's i18n layer. |
| `tests/unit/analytics-{buckets,scale,muscle-map,months}.test.ts` | Bucketing + percentiles; contrast ratios; slug↔`Muscle` exhaustiveness; month labels. |
| `tests/integration/analytics-queries.test.ts` | Aggregates + rollup against local D1, and SQL-vs-`@/lib/calc` parity. |
| `tests/fixtures/make-r09-week.mjs` | Emits `r09-volume-week.sql` with dates **relative to today** (Behaviour 26). |
| `tests/e2e/dashboard.spec.ts` | Both heatmaps render, tap flows, keyboard flows, table/map number parity. |

Not created here, deliberately: no `loading.tsx`, no per-tile `<Suspense>`, no
`scripts/check-bundle-budget.mjs` (spec 16 owns the budget gate — Behaviour 24).

## Interfaces

```ts
// src/lib/analytics/scale.ts
/**
 * 5 filled steps + 2 non-data tones. Contrast vs the #000 OLED canvas, computed:
 *   levels    3.00 / 4.99 / 7.97 / 12.12 / 17.71 : 1   — all >= 3:1 (WCAG SC 1.4.11)
 *   restGlyph 4.12 : 1 vs #000  and  3.23 : 1 vs `empty`
 *   empty     1.27 : 1 — BELOW 3:1 by design; see Behaviour 8.
 */
export const LIME_SCALE = {
  empty: '#1F1F1F',
  restGlyph: '#6E6E6E',
  levels: ['#4A6100', '#678600', '#85AD00', '#A5D500', '#C6FF00'],
} as const;
export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;
export function levelToHex(l: HeatLevel): string;
export function contrastVsBlack(hex: string): number;        // WCAG 2.x ratio; for the unit test
export function contrastRatio(a: string, b: string): number; // for the restGlyph-on-empty assertion
```

```ts
// src/lib/analytics/buckets.ts
/** Exactly four ascending cut points. Half-open upward: L1 = [>0, c0), L2 = [c0, c1),
 *  L3 = [c1, c2), L4 = [c2, c3), L5 = [c3, ∞). A value <= 0 is level 0. */
export type Cuts4 = readonly [number, number, number, number];
export function bucket4(value: number, cuts: Cuts4): HeatLevel;   // the ONE bucketer both ladders use

export interface CalendarCuts { p25: number; p50: number; p75: number; p90: number; n: number }
/**
 * Percentile definition: **linear interpolation, type R-7** (R's default, Excel PERCENTILE.INC,
 * numpy's default) — sort ascending, `h = p · (n − 1)`, result
 * `x[floor(h)] + (h − floor(h)) · (x[floor(h)+1] − x[floor(h)])`. Chosen because it is the
 * definition every reader's spreadsheet agrees with; nearest-rank and the exclusive method give a
 * materially different p25 on a 12-value sample.
 * Input: NON-ZERO daily tonnages (kg) over the SAME 371-day window the grid paints. `n` = sample size.
 */
export function calendarCuts(nonZeroTonnagesKg: readonly number[]): CalendarCuts;
/** `cuts === null || cuts.n < CALENDAR_MIN_SAMPLE` ⇒ the absolute ladder. */
export function calendarLevel(tonnageKg: number, cuts: CalendarCuts | null): HeatLevel;
export const CALENDAR_MIN_SAMPLE = 10;
export const CALENDAR_ABSOLUTE_CUTS_KG: Cuts4 = [2000, 4000, 6000, 8000];
export const MUSCLE_LEVEL_CUTS: Cuts4 = [2.5, 5, 10, 16];
/** Absolute, anchored on the verified >10 credited sets/muscle/week. Input is FRACTIONAL. */
export function muscleLevel(creditedHardSets: number): HeatLevel;   // = bucket4(x, MUSCLE_LEVEL_CUTS)
/** r09 §8 / Schoenfeld 2017. A **raw** sets-per-muscle-per-CALENDAR-week figure (Behaviour 17). */
export const WEEKLY_SET_TARGET = 10;
/** Tolerance for the rollup drift diff. Mirrors spec 02's PR_EPSILON_KG precedent. */
export const ROLLUP_EPSILON = 0.01;
```

```ts
// src/lib/analytics/muscle-map.ts
import type { Muscle } from '@/db/enums';        // spec 02's 17-value MUSCLES enum
export type BodyView = 'front' | 'back';
export type Bilateral = 'l' | 'r' | 'c';
/** Path id `m-{muscle}-{view}-{side}`; group id `mg-{muscle}-{view}`. */
export function muscleSvgId(m: Muscle, v: BodyView, s: Bilateral): string;
export function muscleGroupId(m: Muscle, v: BodyView): string;
/** Asset region → the Muscles it stands for; the region takes max(level) of its members. */
export const REGION_MEMBERS: Readonly<Record<string, readonly Muscle[]>>;
export const MUSCLES_WITHOUT_POLYGON: readonly Muscle[];   // ['abductors'] — table fallback only

// src/lib/analytics/months.ts
/** Column index → month label, derived arithmetically from firstDate. `names` is the locale's
 *  12-element array from `analytics.months`; no `Intl`, no `toLocaleString` (spec 07 rule 6). */
export function monthLabelsFor(firstDate: LocalDate, cols: number, names: readonly string[])
  : { col: number; label: string }[];
```

```ts
// src/server/analytics/dashboard.ts
import type { LocalDate } from '@/lib/calc';     // 'YYYY-MM-DD' in Asia/Almaty; spec 07 owns it
import type { Muscle, PrKind } from '@/db/enums';

/** Branded so a credited (deliberately double-counted) figure cannot be used as real tonnage,
 *  and so an ISO week key cannot be passed where a LocalDate is expected. */
export type TonnageKg  = number & { readonly __brand: 'TonnageKg' };
export type CreditedKg = number & { readonly __brand: 'CreditedKg' };
export type IsoWeek    = string & { readonly __brand: 'IsoWeek' };   // '2026-W37', from isoWeekKey()

/** Why a day's tonnage is what it is. `none` days are NEVER drawn as level 0 (Behaviour 5). */
export type TonnageSource = 'stored' | 'recomputed' | 'in_progress' | 'none';

export interface CalendarPayload {
  levels: string;                    // 371 chars, column-major: '0'..'5', 'r' rest, '?' unknown,
                                     // 'p' in-progress, '.' after today
  firstDate: LocalDate;              // Monday, 52 weeks before the Monday of the current week
  today: LocalDate;
  cuts: CalendarCuts | null;         // null ⇒ absolute ladder used; the legend must say so
  restDates: readonly LocalDate[];   // streak_ledger.status ∈ {rest, grace, freeze}
  unknownDates: readonly LocalDate[];// finished workouts whose tonnage could not be established
  monthLabels: readonly { col: number; label: string }[];
}
export interface MuscleHeat {
  muscle: Muscle;
  rawHardSets: number;               // rolling 7 d, INTEGER count of qualifying sets
  creditedHardSets: number;          // rolling 7 d, fractional: primary ×1.0 + secondary ×0.5
  creditedTonnageKg: CreditedKg;     // rolling 7 d; NEVER summed across muscles
  level: HeatLevel;                  // = muscleLevel(creditedHardSets)
  lastTrainedDate: LocalDate | null;
}
export interface MacroRing {
  key: 'kcal' | 'protein' | 'carbs' | 'fat';
  consumed: number;                  // kcal for 'kcal', grams otherwise
  target: number | null;             // null ⇒ no goal row configured
  ratio: number;                     // consumed / target, UNCLAMPED; 0 when target is null
}
/** Honesty state of the day's nutrition rows (Behaviour 16). */
export interface MacroProvenance {
  entries: number;                   // food_entries rows for the day
  unconfirmed: number;               // confirmed_at IS NULL
  lowConfidence: number;             // confidence IS NOT NULL AND confidence < 0.6
  unconfirmedKcalShare: number;      // 0..1 of the day's kcal from unconfirmed rows
}
export interface PrFeedItem {
  date: LocalDate; achievedAtMs: number;         // epoch ms
  exerciseId: string; exerciseName: string;      // exercises.name_ru ?? exercises.name
  kind: PrKind;                                  // 'e1rm'|'max_weight'|'max_reps'|'session_volume'
  value: number;                                 // kg, except integer reps for 'max_reps'
  repsAtValue: number | null;
  previousValue: number | null;                  // the row this one superseded (Behaviour 21)
}
export interface WeeklyVolumeRow {
  muscle: Muscle;
  thisWeekRawSets: number; lastWeekRawSets: number;      // integer — the FLAG reads these
  thisWeekSets: number; lastWeekSets: number;            // credited, fractional — display only
  thisWeekTonnageKg: CreditedKg;
  flag: 'untrained' | 'under' | 'met' | 'pending';        // from rawSets (Behaviour 17)
  lastWeekFlag: 'untrained' | 'under' | 'met';
}
export interface DashboardPayload {
  generatedAtMs: number;                         // epoch ms, server clock
  today: LocalDate;
  calendar: CalendarPayload;
  muscles: readonly MuscleHeat[];                // always 17 rows, zero-filled, MUSCLES order
  rings: readonly MacroRing[];                   // always 4 rows: kcal, protein, carbs, fat
  ringProvenance: MacroProvenance;
  prs: readonly PrFeedItem[];                    // newest first, max 20
  weekly: readonly WeeklyVolumeRow[];            // always 17 rows
  bodyweight: readonly { date: LocalDate; kg: number; trendKg: number | null;
                         bodyFatPct: number | null; excluded: boolean }[];          // <= 90
  weeklyTonnageKg: readonly { week: IsoWeek; tonnageKg: TonnageKg; ma4Kg: number | null }[]; // 12
}
export type DashboardResult =
  | { ok: true;  payload: DashboardPayload }
  | { ok: false; reason: 'db' | 'unknown' };
/**
 * NEVER throws and NEVER returns a partial payload: one read failure fails the whole stack, which is
 * the honest failure mode when one cached payload feeds every tile (Behaviour 2). A KV failure is not
 * a failure — it falls through to D1, which is why `reason` has no 'cache' member.
 * `monthNames` is the caller's locale array from `analytics.months`: the payload carries already
 * localised month labels (UX notes), so the locale is an input and never resolved inside. It also
 * makes the cache entry per-locale — the KV value stores `locale` and a mismatch is a miss.
 */
export function getDashboardPayload(db: DB, kv: KVNamespace, nowMs: number,
  locale: 'ru' | 'en', monthNames: readonly string[]): Promise<DashboardResult>;
```

```ts
// src/server/analytics/queries.ts — shapes only; every one is row-bounded (Behaviour 22)
/**
 * (a) `SELECT local_day, SUM(volume_kg), SUM(hard_sets), COUNT(*),
 *      SUM(ended_at IS NULL), SUM(ended_at IS NOT NULL AND volume_kg IS NULL)
 *      FROM workouts WHERE local_day BETWEEN ? AND ? GROUP BY local_day` — <= 371 groups.
 * (b) For up to 12 days where (a) reported a finished-but-NULL workout, one extra
 *      `sets GROUP BY local_day` fallback sum. Days beyond the 12 come back `source: 'none'`.
 * **No `COALESCE(volume_kg, 0)` anywhere** — that is the data-honesty bug (Behaviour 5).
 */
export function selectDailyTonnage(db: DB, from: LocalDate, to: LocalDate): Promise<{
  date: LocalDate; tonnageKg: TonnageKg | null; hardSets: number | null;
  workouts: number; source: TonnageSource }[]>;
/**
 * `sets ⋈ exercise_muscles`, aggregated in SQL. One row per (muscle, role). Returns RAW facts only —
 * `countedSets`/`hardSets`/`tonnageKg` per role — and applies **no credit**. Crediting happens once,
 * in `dashboard.ts`, from `volume_weights` (Behaviour 12). The counted/hard predicates are the SQL
 * transcription of spec 07 rules 38–39 and are parity-tested against them (Behaviour 22).
 */
export function selectRawByMuscleRole(db: DB, from: LocalDate, to: LocalDate): Promise<{
  muscle: Muscle; role: 'primary' | 'secondary';
  countedSets: number; hardSets: number; tonnageKg: number; lastDate: LocalDate }[]>;
export function selectVolumeWeights(db: DB): Promise<{ primary: number; secondary: number }>;
export function selectMuscleWeekRollups(db: DB, weeks: readonly IsoWeek[]): Promise<{
  isoWeek: IsoWeek; muscle: Muscle;
  primarySets: number; secondarySets: number; rawHardSets: number;
  primaryTonnageKg: number; secondaryTonnageKg: number; rawTonnageKg: number }[]>;
/** Best e1rm_kg per (exercise_id, local_day), newest first. `limit` defaults to
 *  `SESSION_BESTS_LIMIT = 120` sessions. Index-ASSISTED (not index-only — Behaviour 22 iii). */
export function selectSessionBests(db: DB, exerciseId: string, limit?: number)
  : Promise<{ date: LocalDate; bestE1rmKg: number; topWeightKg: number; topReps: number }[]>;
/** Hard-bounded: trailing `RAW_DOTS_WINDOW_DAYS = 365` days AND `LIMIT RAW_DOTS_MAX = 2000`
 *  ordered `completed_at DESC`. `truncated` is surfaced in the chart caption (Behaviour 18). */
export function selectRawSetDots(db: DB, exerciseId: string, nowMs: number)
  : Promise<{ dots: RawSetDot[]; truncated: boolean; windowFrom: LocalDate }>;
export function selectDayDetail(db: DB, date: LocalDate): Promise<DayDetail>;   // never null
export function selectMuscleContributors(db: DB, m: Muscle, from: LocalDate, to: LocalDate)
  : Promise<Contributor[]>;

export const RAW_DOTS_WINDOW_DAYS = 365;
export const RAW_DOTS_MAX = 2000;
export const SESSION_BESTS_LIMIT = 120;

export interface RawSetDot {
  setId: string; date: LocalDate; weightKg: number | null; reps: number | null;
  e1rmKg: number | null; rir: number | null; setType: string;
}
export interface DayDetail {
  date: LocalDate;                              // always echoed, even for an empty day
  isEmpty: boolean;                             // true ⇒ every number below is 0/null, status 200
  tonnageKg: number | null;                     // null ⇒ unknown, NOT zero (Behaviour 5)
  tonnageSource: TonnageSource;
  hardSets: number | null;
  workouts: readonly { id: string; title: string | null;
                       startedAtMs: number; durationSec: number | null; inProgress: boolean }[];
  macros: { kcal: number; proteinG: number; carbG: number; fatG: number } | null;
  macroProvenance: MacroProvenance;
  bodyweightKg: number | null; trendKg: number | null;
  streakStatus: 'active' | 'rest' | 'grace' | 'freeze' | 'missed' | null;
}
export interface Contributor {
  exerciseId: string; exerciseName: string; role: 'primary' | 'secondary';
  rawHardSets: number; creditedHardSets: number; creditedTonnageKg: CreditedKg; lastDate: LocalDate;
}
```

```ts
// src/server/analytics/cache.ts — ONE key for the payload, not one per date (Behaviour 22)
export const CACHE_VERSION = 'v1';
export const DASH_KEY  = 'dash:v1:payload';    // { forLocalDay: LocalDate; payload: DashboardPayload }
export const CUTS_KEY  = 'dash:v1:calcuts';    // { forLocalDay: LocalDate; cuts: CalendarCuts }
/** Deletes BOTH keys. The only invalidation entry point; every write path calls exactly this. */
export function invalidateDashboard(kv: KVNamespace): Promise<void>;

// src/server/analytics/rollups.ts — idempotent upserts; takes db explicitly (r02 §2.3: no ALS in cron)
export function recomputeMuscleWeek(db: DB, week: IsoWeek): Promise<void>;
export function rebuildMuscleWeeks(db: DB, weeks: readonly IsoWeek[]): Promise<{ weeks: number; rows: number }>;
/** Recomputes from raw `sets` and diffs against the stored rollup at |Δ| > ROLLUP_EPSILON.
 *  NEVER writes. Run BEFORE any rebuild in the same job (Behaviour 23). */
export function verifyMuscleWeeks(db: DB, weeks: readonly IsoWeek[])
  : Promise<{ checked: number; drifted: { week: IsoWeek; muscle: Muscle; field: string;
                                          stored: number; recomputed: number }[] }>;
/** The trailing 12 ISO weeks — exactly what chart 19(b) reads. Bounded by construction. */
export function verifyWindowWeeks(nowMs: number): IsoWeek[];
```

## Behaviour

1. **Dashboard order (decided).** (1) today strip — streak, readiness, today's macro rings; (2) muscle
   body-map, rolling 7 d; (3) calendar heatmap, 53 weeks; (4) this-week volume table with under-trained
   flags; (5) PR feed; (6) bodyweight + trend sparkline; (7) body composition; (8) link-out to e1RM
   curves. Justification: the only behaviour a dashboard can change is *today's*, so above the fold is
   either "is today still open" (rings, streak) or "what should today be" (the body map); retrospective
   surfaces inform planning, not action. The calendar is third because the streak number already carries
   the consistency signal at a glance — the 53-week grid is the reward artefact you scroll to.
2. **One payload, one failure mode (decided).** Every tile is a server component fed already-computed
   data from a single `getDashboardPayload` call; no tile fetches for itself. Consequences, stated
   because they are the price of the cache-aside design and were previously contradicted: there is
   **no per-tile `<Suspense>`, no per-tile error isolation and no per-tile retry**. The route body
   renders the page chrome and tile headings synchronously and wraps the whole tile stack in **one**
   `<Suspense>` whose fallback is the complete skeleton set, so first paint does not wait on D1. On
   `{ ok: false }` the stack is replaced by `tiles-error.tsx` — one frame, one message, one
   `<a href="/">` retry, zero client JS. All three routes set
   `export const dynamic = 'force-dynamic'` (spec 01 rule 12, r02 §3 rule 2): all three read D1, and a
   build-time prerender would bake the developer's local rows into production HTML. This needs an
   amendment to spec 04 rule 10 — see §Data, request R14.
3. **Offline.** On each successful render, island 3 writes the `DashboardPayload` to the Dexie
   database `fit`, store `analytics_cache`, key `dashboard`. On `/~offline` the same island reads it
   back and renders `calendar-heatmap-view`, `macro-rings-view` and `body-map-view` — which is why
   those three are **directive-free shared views** importable from a client component; a server
   component cannot render in a browser. An `As of {generatedAt}` banner is mandatory. Charts and both
   sheets are excluded: the sheet APIs are network-only, so on `/~offline` the day-picker and the
   muscle-row buttons render `disabled` with the title "Нет сети". This exists because `/` is dynamic,
   so its HTML is not precached and a cold offline open would otherwise dead-end at spec 05's static
   fallback with no data at all (r05 §6d). The store and the Dexie version bump are spec 05's to make
   (request R12).
4. **Calendar bucket definition.** A cell's metric is that local day's summed `workouts.volume_kg` —
   derived at finish by spec 06 to r09 §8's definition (`Σ reps × weight_kg` over
   `COUNTED_SET_TYPES`; warm-ups excluded). `calendarLevel` uses `bucket4` over
   `[p25, p50, p75, p90]` of the trailing **371 days** of non-zero daily tonnage — the same window the
   grid paints, so no displayed cell is ever coloured by cut-points computed from a sample that
   excludes it. Percentiles, not absolutes, because a fixed ladder saturates permanently as the user
   gets stronger. With `cuts === null || cuts.n < 10` the absolute ladder
   `CALENDAR_ABSOLUTE_CUTS_KG = [2000, 4000, 6000, 8000]` applies and the legend switches from
   "relative to your last year" to "fixed scale". Never switch silently.
5. **Calendar cell states are five, not one.** In `levels`, per local day:
   - `'1'..'5'` — tonnage `> 0`, bucketed. `'0'` — tonnage exactly `0` from a finished workout.
   - `'r'` — no tonnage **and** `streak_ledger.status ∈ {rest, grace, freeze}`: `LIME_SCALE.empty`
     fill, a 1 px inset `restGlyph` ring **and** a centred 4 × 2 px `restGlyph` dash. The dash is the
     non-colour carrier; the ring alone would make a 1.85:1 colour difference the sole signal.
   - `'p'` — a workout with `ended_at IS NULL` (in progress): `empty` fill plus a 1 px **dashed**
     `restGlyph` outline, and it is never bucketed — `volume_kg` is NULL until finish.
   - `'?'` — a finished workout whose `volume_kg` is NULL and whose set-level fallback sum was
     unavailable (an import from spec 15, or an edit without recomputation): a 2 px diagonal-hatch
     `<pattern>` in `restGlyph`, listed in `unknownDates`, and captioned "tonnage not recorded".
   - `'.'` — a date after `today`: no `<rect>` emitted at all.

   The three distinct non-zero-but-unknown states exist because `SUM()` over NULL yields NULL and
   painting that as an empty cell makes an in-progress session indistinguishable from a rest day on
   the app's flagship surface.
6. **Calendar layout.** 53 columns × 7 rows = 371 cells, column-major; column 0 is the Monday 52 weeks
   before the Monday of the current week; rows Mon..Sun. **Scroll mode** (default): cell 12 px, gap
   2 px, pitch 14 px ⇒ **740 × 96 px** in `overflow-x:auto; scroll-snap-type: x proximity`, snap points
   on month boundaries, initial `scrollLeft = scrollWidth` so today is visible. **Fit mode** (header
   toggle, persisted in `localStorage`): cell 5 px, gap 1 px, pitch 6 px ⇒ **317 × 41 px**, fitting a
   375 px viewport minus 2×16 px padding (343 px) with no scroll. Fit mode exposes no pointer targets
   on the grid; the keyboard path of rule 7 is present in **both** modes because it lives in the tile
   header.
7. **Calendar interaction, and how day detail is actually reachable.** The tile header carries a
   visible **44 × 44 px "Open day detail" button** (`<button>`, focusable, keyboard-activated) that
   opens the bottom sheet on `today`. The sheet carries 44 × 44 px `‹`/`›` steppers that move one day
   and reach every date in the window, and it renders every field of `DayDetail`. That button plus
   those steppers are the whole keyboard and assistive-tech path — WCAG 2.1.1 (Keyboard, Level A) is
   satisfied by a real control, not by a pointer gesture. The 12 px grid cell is a **pointer
   shortcut**, below WCAG 2.2 SC 2.5.8 ("at least 24 by 24 CSS pixels"); we invoke its **Equivalent**
   exception, verbatim: *"The function can be achieved through a different control on the same page
   that meets this criterion"* — satisfied by the 44 px day-picker button and the 44 px steppers, both
   present in fit mode too. The weekly volume table is **not** cited here: it carries per-muscle data,
   not day detail.
   Tap detection: `pointerdown` records `{x, y, t, pointerId}`; the matching `pointerup` counts as a
   tap only when `event.isPrimary`, the same `pointerId`, movement `< 8 px` on both axes and elapsed
   `< 500 ms`. Without that gate every horizontal swipe of the calendar ends on some cell, opens a
   random day sheet and fires the haptic the UX notes forbid on scroll. The same gate is used on the
   body map.
8. **One colour system, with an honest contrast claim.** `LIME_SCALE` serves the calendar, the body
   map and the weekly table. Computed contrast against the `#000` OLED canvas: `#4A6100` 3.00:1,
   `#678600` 4.99:1, `#85AD00` 7.97:1, `#A5D500` 12.12:1, `#C6FF00` 17.71:1 — **the `levels` array is
   what satisfies WCAG SC 1.4.11** ("a contrast ratio of at least 3:1 against adjacent color(s)") for
   graphical objects. The two non-data tones are stated separately and honestly: `restGlyph #6E6E6E`
   is 4.12:1 against the canvas and **3.23:1 against the `empty` cell it sits inside**, which is what
   licenses it as an information carrier; `empty #1F1F1F` is **1.27:1**, below 3:1, and is exempt
   because it is the absence of a graphical object — it encodes "nothing here", never a value. The ramp
   is `#C6FF00` scaled in linear light to equal CIE L\* spacing (ΔL\* = 13.9). **Adjacent steps are
   only 1.46–1.66:1 apart**, unavoidable for 5 steps inside a 17.7:1 range, so level is never the sole
   carrier of information: every heat surface has a numeric readout on tap, a table with the same
   numbers, and — for rest and unknown days — a shape. No text is ever placed on an L1 cell: black on
   `#4A6100` is 3.00:1, under the 4.5:1 AA text threshold.
9. **Body-map asset and licence.** Path data is vendored from **`react-native-body-highlighter`**
   (`github.com/HichamELBSI/react-native-body-highlighter`), **MIT** — verified via the GitHub licence
   API (`spdx_id: "MIT"`, `path: "LICENSE"`). `assets/bodyFront.ts` / `assets/bodyBack.ts` export
   `BodyPart[]` of `{ slug, color, path: { left?: string[]; right?: string[]; common?: string[] } }`,
   each string an SVG `d`. The `common` key is real and load-bearing — the back view puts head and
   hair there — which is why `Bilateral` has `'c'`. One 1448×1448 coordinate space: front
   `viewBox="0 0 724 1448"`, back `viewBox="724 0 724 1448"` (verified in
   `components/SvgMaleWrapper.tsx`). We copy the `d` strings into `body-map-paths.ts` and do **not**
   depend on the package (it imports `react-native-svg`); the MIT notice stays in that file's header
   and the copyright line goes in `NOTICE`. Both views render at aspect 1:2, `max-width: 200px`, side
   by side above 360 px.
10. **Body-map id convention.** One group per muscle per view:
    `<g id="mg-{muscle}-{view}" data-muscle="{muscle}" data-level="{0..5}" data-sets="{creditedHardSets}" data-raw-sets="{rawHardSets}">`
    wrapping `<path id="m-{muscle}-{view}-{l|r|c}" fill="{levelToHex(level)}" />`, `{muscle}` being a
    value of spec 02's `MUSCLES`. Inert anatomy (head, hair, hands, feet, ankles, knees, tibialis,
    obliques) is one `<path id="chrome-{view}" fill="#141414" aria-hidden="true">`.
11. **The taxonomy is spec 02's `MUSCLES` (17 values), not a new one** — `exercise_muscles.muscle`
    stores exactly those, so they are the only muscles the data can express. Verified asset slugs —
    front: `chest, obliques, abs, deltoids, biceps, triceps, forearm, trapezius, quadriceps,
    adductors, calves, tibialis, knees, head, hair, neck, hands, feet, ankles`; back: `trapezius,
    deltoids, upper-back, lower-back, gluteal, hamstring, triceps, forearm, adductors, calves, head,
    hair, neck, hands, feet, ankles`. Mapping: `abs→abdominals`, `gluteal→glutes`,
    `hamstring→hamstrings`, `lower-back→lower_back`, `trapezius→traps`, `forearm→forearms`, identity
    for `chest/biceps/triceps/calves/adductors/quadriceps/neck`. Two regions carry more than one
    muscle and take `max(level)` of their members (`REGION_MEMBERS`): back `upper-back` →
    `{lats, middle_back}`; `deltoids` → `{shoulders}` on **both** views, painted the same level,
    because the dataset has one undifferentiated `shoulders` value (r09 §8) and delt heads do not
    exist in our data. A combined region's tap sheet always lists its members with **separate**
    numbers. `obliques` has a polygon but no enum value ⇒ inert chrome; `abductors` has an enum value
    but no polygon ⇒ table only.
12. **Colour normalisation: ABSOLUTE, in credited hard sets — and the credit comes from the
    database.** `muscleLevel()` buckets the rolling-7-day **credited hard-set count** on
    `MUSCLE_LEVEL_CUTS = [2.5, 5, 10, 16]`, anchored on the verified `>10 sets/muscle/week`
    dose-response (r09 §8, Schoenfeld 2017). Tonnage is deliberately not the colour metric (see
    deviation D1). Relative-to-self normalisation (percentile of a muscle's own trailing volume) is
    **rejected** — a deload week would light the whole body up, which violates the brief's "honest
    data" principle.
    The credit weights are read from spec 02's `volume_weights` table (`role` PK, `credit` 0..1,
    seeded 1.0 / 0.5), **not** from `@/lib/calc` constants, because spec 02 already made re-weighting
    a one-row `UPDATE` — exactly r09 §8's recommendation ("persist the muscle-credit weights in a
    table, not in code, so re-weighting doesn't need a migration"). `@/lib/calc`'s
    `PRIMARY/SECONDARY_MUSCLE_CREDIT` remain the defaults used when the table is unreadable, and the
    integration test asserts the seeded rows equal them. Consequence, and the point of the change:
    every stored rollup keeps **raw and per-role** figures only; credited numbers are derived at read
    time, so answering open question 2 is a config change, not a rollup rebuild. The legend must read
    **"secondary muscles counted at 50%"** — r09 §8 records that the only paper on the question
    (Schoenfeld 2019) recommends `"a 1:1 basis"` and declines to give a weighting, so 0.5 is a
    labelled convention, not a fact.
13. **Windows come from `@/lib/calc/time`.** `rolling7dWindow(nowMs)` yields inclusive
    `{startDate, endDate}`; every query filters `local_day BETWEEN ? AND ?` on the indexed stored
    column. UTC instants are never used for calendar-shaped filtering — r09 §8 / spec 07 rule 44: a set
    at `2026-09-06T19:30:00Z` is local `2026-09-07`, and grouping by UTC date loses 640 kg of chest
    volume from the worked week and can drop a streak day.
14. **The body-map's a11y equivalent is the weekly volume table, and the table is operable.** It
    carries the same numbers as the map — raw hard sets, credited hard sets and credited tonnage per
    muscle, rolling 7 d and per ISO week — for all 17 enum values including `abductors`, and is always
    in the DOM (`<details>` collapsed on mobile, never `display:none`). **Each row's muscle name is a
    44 px `<button>`** that opens the muscle sheet; that is the keyboard path, and it is why the table
    can honestly be called the equivalent. The `<svg>` is `role="img"` with `aria-labelledby` on a
    caption naming the top three muscles; each `<g>` is `aria-hidden="true"` because the table is the
    accessible representation. Tapping a region (gated `pointerup` on `data-muscle`, rule 7) opens the
    same sheet from `GET /api/analytics/muscle/{muscle}`, listing contributing exercises over the
    rolling 7 d with `role`, raw hard sets, credited hard sets and credited tonnage, most recent
    first. The selected state is a 2 px `#FFFFFF` stroke at 60% opacity — never a fill change, so the
    colour being read does not move.
15. **Macro rings — exact geometry, and the label identifies the ring, not the colour.**
    `viewBox="0 0 120 120"`, centre `(60,60)`, three rings at `stroke-width="12"` with a 4 px gap:
    radii **52 / 36 / 20**, circumferences **326.7256 / 226.1947 / 125.6637**. Each ring is two
    `<circle>`s: a track at `stroke="#1F1F1F"`, and an arc with `stroke-dasharray="{C}"`,
    `stroke-dashoffset="{C × (1 − min(ratio, 1))}"`, `stroke-linecap="round"`, `fill="none"`,
    `transform="rotate(-90 60 60)"`. Outer kcal `#C6FF00`, middle protein `#85AD00`, inner carbs
    `#678600`; **fat is a numeric readout beneath the rings**, because a fourth 12 px ring does not fit
    inside 120 px.
    Those three hexes are only 1.46–1.66:1 apart (rule 8), so colour may **not** identify a ring. Each
    ring carries a `<title>`, and the SVG is followed by a mandatory legend `<ul>` — one `<li>` per
    metric, `{name} {consumed} / {target} {unit} ({pct}%)`, in ring order, fat last. The swatch is
    decorative; the text is the identification. The legend is not optional and not collapsible.
    `target === null` ⇒ track only at 40% opacity plus a "Set your targets" link (copy from
    `analytics.rings.noTarget`).
16. **Over-target rings, and AI-derived macros.** `ratio > 1` draws a **second lap**: the same arc
    redrawn on top with `stroke-dashoffset = C × (1 − min(ratio − 1, 1))` at `opacity="0.55"`,
    separated by a 2 px `#000` casing circle so the overlap reads. Visual cap is two laps
    (`ratio ≥ 2`); the readout always shows the true percentage. Exceeding a target is never coloured
    as failure.
    Honesty (brief: "show AI confidence, let the user correct"): the rings read
    `food_entries.confidence` and `confirmed_at` as well as the macros, and fill
    `MacroProvenance`. When `unconfirmedKcalShare > 0.5` **or** `lowConfidence > 0`, the three arcs
    render with `stroke-dasharray` switched to a 6/3 dashed pattern of the same `C`-scaled length, the
    legend gains a `≈` prefix on every affected number, and a caption reads
    `analytics.rings.unconfirmed` — with the whole caption a link to spec 11's day view
    (`/nutrition/{date}`), which owns the correction loop. A day of unconfirmed Gemini estimates must
    never render identically to a barcode-scanned day.
17. **Under-trained rule — on RAW sets.** Computed on **ISO calendar weeks** (`isoWeekKey`,
    Monday-start, Almaty), not the rolling window, because the verified `>10 sets/week` figure is a
    calendar-week number and r09 §8 explicitly warns the two are not interchangeable. The flag reads
    `thisWeekRawSets`, **never** the credited figure: `WEEKLY_SET_TARGET = 10` is Schoenfeld 2017's
    raw sets-per-muscle-per-week count, and r09 §8 is explicit that the ×0.5 credit "is a display
    convention, explicitly NOT a fact" whose threshold must not be carried across definitions.
    Comparing 3.5 credited sets against a raw-10 target flags `under` for a lifter who did 6 real
    triceps sets. Colour stays credited (rule 12); the flag stays raw; the spec states both.
    Current week: `rawSets === 0` and `isoWeekday(today) >= 5` → `untrained`;
    `0 < rawSets < 10` and `isoWeekday(today) >= 5` → `under`; `rawSets >= 10` → `met`; otherwise
    `pending`. `isoWeekday(d: LocalDate): 1..7` (Mon = 1 … Sun = 7) is **requested of spec 07**
    (request R4) precisely so nobody reaches for `Date.getDay()`, whose Sunday is `0` and would
    silently switch the whole flag off every Sunday. `lastWeekFlag` is ungated. The flag is never
    derived from the map's level, nor the level from the flag.
18. **e1RM curve.** The line is the best `e1rm_kg` per `(exercise_id, local_day)` over the trailing
    `SESSION_BESTS_LIMIT = 120` sessions; behind it every counted set in the trailing
    `RAW_DOTS_WINDOW_DAYS = 365` days is a dot at `(local_day, e1rm_kg)`, `r=2.5`, `opacity=0.35`,
    hard-capped at `RAW_DOTS_MAX = 2000` rows — two years of bench pressing is thousands of sets and
    they all cross D1 → RSC → a dynamically imported chart. When `truncated`, the caption says so
    ("showing the most recent 2000 sets"). Rows with `reps > 12` are excluded entirely (r09 §1 open
    decision (a): suppress, don't badge), as are `e1rm_kg IS NULL` rows.
    All dots are solid. The `rir > 0` **hollow dot is dropped**: spec 02 constrains
    `rpe BETWEEN 1 AND 10` and `rir = 10 − rpe`, so RIR 1–3 — ordinary working sets — all satisfy
    `rir > 0` and only a true RIR-0 grinder would be solid; a signal that is on for ~every logged-RPE
    set conveys nothing, and r09 §2's +10.8% divergence is one specific vector, not every `rir > 0`
    row. The legend instead carries a one-line honesty note (`analytics.e1rm.sourceUnknown`): the
    estimator that produced each point is not stored yet. The hollow dot ships the day
    `sets.e1rm_source` exists (request R2) and is keyed on `= 'rpe'`.
    **y-domain — a robust bound, not `p99`.** The series is one best per session, so for any realistic
    `n` (< 120) `p99` *is* the maximum and cannot protect anything. Instead: `m = median(best)`,
    `mad = 1.4826 × median(|best − m|)`, `robust = m + 3 × mad`; the top is
    `min(max(best), robust) × 1.05` and the bottom `min(best) × 0.95`. Fallback when `n < 5` **or**
    `mad === 0` (every session identical): `max(best) × 1.05` — with fewer than 5 points there is no
    distribution to be robust about, and the spec says so rather than pretending. Points above the top
    render clamped at the top edge with a caret, and the caret's threshold **is** that top value.
19. **Volume charts** (`/analytics`): (a) total weekly tonnage, last 12 ISO weeks, bars plus a 4-week
    moving-average line — `ma4Kg` is `null` for the first three weeks and a partial average is not
    drawn; (b) per-muscle weekly credited hard sets as 17 small-multiple bar sparklines, 12 weeks each,
    with the `WEEKLY_SET_TARGET = 10` reference line in `#4A6100` and a note that the line is a raw-set
    target compared against a credited bar (rule 17's asymmetry, stated where it is visible). One
    17-series stacked chart is rejected as unreadable at 375 px. **Never sum per-muscle rows:**
    secondary credit double-counts by design (r09 §8 sums to 5640 kg across muscles against 3270 kg of
    real tonnage, +72%), so `CreditedKg` is branded distinctly from `TonnageKg`, no tile may present a
    sum of `creditedTonnageKg`, and `workouts.volume_kg` is the only session-volume source (spec 07
    rule 41).
20. **Bodyweight, trend, body composition — with the units written out.** Raw readings as 3 px dots,
    `trend_kg` as a 2 px `#C6FF00` line, last 90 readings. `trend_kg` is **read from the stored column,
    never recomputed client-side**: an EMA is prefix-dependent, so re-seeding from a paginated window
    makes one day show different trend values at different zoom levels (r09 §4). `trend_excluded = 1`
    rows render grey and hollow and are still shown. `body_measurements` has no uniqueness on
    `local_day`, so same-date readings are averaged before plotting (r09 §4).
    Body composition, explicitly:
    - `body_fat_pct` is stored in **percentage points, 0..100** — spec 07's `navyBodyFatPct` returns
      "percentage POINTS out (16.4360), never a fraction" and gates the result to `[2, 60]`.
      `fatKg = trendKg × body_fat_pct / 100`. Reading it as a fraction is a 100× error that renders a
      1500 kg fat mass.
    - `leanKg = trendKg − fatKg`. The stack therefore sums to **trend** weight, not raw weight, and
      the raw-reading dots deliberately sit off the stack on some days — stated so nobody "fixes" it
      by swapping in the raw reading, which would make `leanKg + fatKg ≠` the plotted total.
    - A day with a weight but `body_fat_pct IS NULL`, or with `trend_kg IS NULL`, is a **gap** in the
      stacked area: the areas break and resume, never interpolate. The bodyweight line continues
      across it.
    A 40 px shared-x panel below carries the `body_fat_pct` line. Dual y-axes are banned.
21. **PR feed.** The 20 most recent `personal_records` by `achieved_at`
    (`personal_records_achieved_at_idx`, spec 02 P8), grouped by `local_day`, showing `kind`, `value`,
    `reps_at_value`, `exercises.name_ru ?? exercises.name`, and the delta against the row this one
    superseded. The delta is one bounded statement, not N+1:
    ```sql
    WITH ranked AS (
      SELECT exercise_id, kind, value, reps_at_value, local_day, achieved_at, is_current,
             ROW_NUMBER() OVER (PARTITION BY exercise_id, kind ORDER BY achieved_at DESC, id DESC) rn,
             LAG(value) OVER (PARTITION BY exercise_id, kind ORDER BY achieved_at ASC, id ASC) prev
      FROM personal_records
      WHERE (exercise_id, kind) IN (…)          -- the <= 20 pairs from the feed query
    ) SELECT * FROM ranked WHERE rn = 1;
    ```
    "The superseded row" is defined as `LAG` over `achieved_at ASC` within the pair — the immediately
    preceding row in the append-only history, regardless of `is_current`; `is_current` is *not*
    filtered, because the current row is exactly the one we want the predecessor of. `id DESC/ASC`
    breaks `achieved_at` ties (ULIDs are chronological, spec 02 rule 1).
    Window functions in D1: **VERIFIED 2026-09-12** —
    `npx wrangler d1 execute fitness-pwa-db --local --command "SELECT x, ROW_NUMBER() OVER (ORDER BY x DESC) rn, LAG(x) OVER (ORDER BY x) prev FROM (SELECT 1 x UNION ALL SELECT 2 UNION ALL SELECT 3)"`
    returns `rn` 1..3 and `prev` 2/1/null. Verification step 2 repeats it with `--remote`.
    Tapping deep-links to `/analytics/exercise/{exerciseId}`.
22. **Aggregation strategy: SQL aggregates + KV cache-aside + one rollup.** Decided against
    materialising everything, because spec 02 already stores `workouts.volume_kg`/`hard_sets` at finish.
    Index names below are spec 02's actual identifiers (its convention is
    `<table>_<columns>_<idx|uq>`, line 160) and its P-table ids; **no claim of an index-only scan is
    made anywhere**, because none of them is true:
    (i) The calendar is one `GROUP BY local_day` over ≤ 371 `workouts` rows — spec 02 **P1**'s index
    `workouts_local_day_idx` drives the range, and because it is `I(local_day)` only, each matched row
    takes a table lookup for `volume_kg`/`hard_sets`. That is ≤ 371 lookups and needs no new DDL. (P2
    *is* index-only, but P2 is `SELECT local_day, count(*)` — a different query; this spec does not
    claim it.) Widening the index was considered and rejected: spec 02 rule 16 makes every index a
    write-path cost, and 371 lookups is not a cost worth paying for.
    (ii) The rolling-7-day map, the weekly table and both sheets are single `sets ⋈ exercise_muscles`
    SQL aggregates over ≤ 14 days — spec 02 **P5**, `sets_local_day_exercise_id_idx` driving, the
    `exercise_muscles` PK prefix serving the join — ~500 joined rows. The per-muscle sheet is **P6**,
    `exercise_muscles_muscle_role_exercise_id_idx`.
    (iii) The e1RM curve uses **P3/P4**'s `sets_exercise_id_completed_at_idx`
    `(exercise_id, completed_at, weight_kg, reps, e1rm_kg)` to seek, then takes a table lookup per row
    for `local_day` (the x-axis) and `set_type` (the counted-set filter) — which the index does not
    carry. Bounded by `RAW_DOTS_MAX`.
    (iv) Macros and bodyweight are **P10** (`food_entries_local_day_eaten_at_idx`) and **P11**
    (`body_measurements_local_day_idx`). The calendar's rest ring reads `streak_ledger` by its unique
    `local_day`. The PR feed is **P8** (`personal_records_achieved_at_idx`) plus
    `personal_records_exercise_id_kind_achieved_at_idx` for rule 21's window query.
    **The single exception is `muscle_week_rollups`**, materialised because chart 19(b) needs 17
    muscles × 12 weeks = 84 days of set-level fan-out, the only unbounded-growth read here; it stores
    raw and per-role figures only (rule 12) and only chart 19(b) reads it, so drift cannot corrupt the
    map or the flags.
    **Cache.** `getDashboardPayload` is cache-aside on the **single** key `dash:v1:payload`, holding
    `{ forLocalDay, locale, payload }`; a hit whose `forLocalDay !== today` or whose `locale`
    differs is treated as a miss.
    `expirationTtl = min(secondsUntilLocalMidnight + 3600, 21600)`. One key, because the payload
    embeds the rolling-7-day map, the ISO-week table and the 12-week tonnage chart, so *any* write —
    today's or a backdated edit to a three-month-old session — can invalidate it; a per-date key
    scheme deletes the key nobody will read and leaves today's wrong. Every write path therefore calls
    the one function `invalidateDashboard(kv)`, which deletes `dash:v1:payload` and
    `dash:v1:calcuts`. The write paths are requests R6–R9. `recomputeMuscleWeek` upserts the affected
    week in the same batch.
    Row ceilings per load: calendar ≤ 371 `workouts` + ≤ 12 fallback day-sums, map ≤ ~500 joined,
    weekly table 2 × 17 groups, rollup 204 rows, PR feed 20 + 20, session bests ≤ 120, raw dots
    ≤ 2000, `volume_weights` 2. `IN (…)` lists never exceed 20 entries, under D1's
    100-bound-parameter statement limit (r02 §2.8).
23. **`verifyMuscleWeeks` drift is an alarm, not a silent fix — and it runs first.** The nightly step
    order is **verify, then rebuild**, over different windows: `verifyMuscleWeeks(db,
    verifyWindowWeeks(nowMs))` covers the trailing **12 ISO weeks** (exactly what chart 19(b) reads —
    bounded, unlike "all weeks ever"), then `rebuildMuscleWeeks(db, trailing 2 weeks)`. Rebuilding
    first would make the diff structurally incapable of reporting drift, which is what the previous
    version of this rule did. A field counts as drifted only when `|stored − recomputed| >
    ROLLUP_EPSILON (0.01)`; `credited`-derived values are REAL and SQL `SUM` order differs from
    recomputation order in the last bit, so a bare `!==` produces a nightly false alarm. A real
    mismatch is logged with the week/muscle/field list and pushed to the owner through spec 14's
    `notify(env, { kind: 'health-alert', channels: ['telegram'], … })` (request R11). It does not
    overwrite — a silent self-heal hides the bug that caused it.
24. **Client-JS budget and the chart library.** **Recharts is not used anywhere.** Measured:
    `recharts@3.10.1` is **561,681 B minified / 147,530 B min+gzip** (bundlephobia size API,
    2026-09-12) and pulls `@reduxjs/toolkit`, `react-redux`, `immer` and eleven `d3-*` packages —
    147 KB gzipped is 74% of spec 16's 200 KB total-script budget for `/analytics` before a line of our
    code. Instead: calendar, body map, rings, sparklines, tables and PR feed are **server-rendered
    inline SVG/HTML with zero chart JS** (deviation D2), and only three client islands ship on `/`
    (rule 2's list: `calendar-client`, `muscle-detail-client`, `offline-snapshot`). The four
    interactive charts use visx primitives behind `next/dynamic`. Versions and sizes, all verified
    against the npm registry and the bundlephobia size API on **2026-09-12** — `@visx/visx@4.0.0` in
    `stack-facts.md` is the meta-package and is **not** installed:

    | Package | Version | min | min+gz |
    |---|---|---|---|
    | `@visx/scale` | 4.0.0 | — | 17,525 B |
    | `@visx/shape` | 4.0.0 | — | 10,741 B |
    | `@visx/axis` | 4.0.0 | 43,760 B | 15,189 B |
    | `@visx/tooltip` | 4.0.0 | 8,045 B | 3,136 B |

    Naive sum 46,591 B gz; the real figure is lower because `@visx/axis` depends on `@visx/scale` and
    `@visx/shape`. Comfortably inside the route budgets. The four pins are requested of spec 01
    (request R13).
    **The budget gate is spec 16's, not ours.** `tests/perf/bundle-budget.spec.ts` +
    `perf-budgets.json` measure **total gzipped script bytes on a cold load, shared chunks included**
    — which is the brief's actual NFR ("per-route client JS < 200 KB gzipped") and not a
    "route-owned" figure that can pass while the real total blows the budget. Spec 16 rule 20 also
    records *why* a manifest-parsing script must not be written: `.next/app-build-manifest.json` does
    **not exist in Next 16** (confirmed against this repo's own build — `.next/` has
    `build-manifest.json` whose `pages` is `{"/_app": []}`, plus per-route
    `.next/server/app/<route>/build-manifest.json` and `page_client-reference-manifest.js`), so such a
    script measures zero and passes forever. This spec therefore ships **no**
    `scripts/check-bundle-budget.mjs`; it contributes (a) the two budget rows it already owns in spec
    16 rule 21 — `/` **185 KB**, `/analytics` **200 KB** — (b) a requested thirteenth row for
    `/analytics/exercise/[exerciseId]` at **200 KB** (request R13), and (c) an ESLint
    `no-restricted-imports` rule banning `recharts` under `src/`. LCP is likewise spec 16's: its LHCI
    config asserts `largest-contentful-paint <= 2500 ms` on these routes, so this spec adds no
    Lighthouse gate of its own.
25. **Skeleton, empty and error states.** Each tile exports a skeleton with identical box metrics — the
    calendar skeleton is a 740 × 96 shimmer at the real pitch, the body-map skeleton the real
    silhouette filled `#141414`. They are the fallback of rule 2's single `<Suspense>`, and the offline
    island's first frame before IndexedDB resolves. Empties, per viz, with every string a key under
    `analytics.empty.*`: no workouts ever → the calendar renders the full grey grid with
    `analytics.empty.calendar` and the body map the silhouette at level 0 with
    `analytics.empty.bodyMap`; no measurements → the bodyweight and body-composition tiles are
    **omitted from the DOM**, not rendered empty; no macro goal rows → rings per rule 15; no PRs → the
    feed is omitted; fewer than 2 sessions for an exercise → the e1RM chart shows dots with no line
    and the caption `analytics.empty.e1rmNeedsTwo`. A read failure is whole-stack (rule 2), never
    per-tile.
26. **Route validation and auth.** Both handlers, in this order: (1) `requireSessionOr401(request)`
    from `@/server/require-session` (spec 04's named export) — its `response` is returned as-is on
    failure, so the 401 envelope and `cache-control: no-store` are spec 04's, uniform across the app;
    spec 04 rule 9 forbids a redirect here and its own Files table says `proxy.ts` is "**Never the
    boundary**". (2) Zod validation: `[date]` must match `YYYY-MM-DD` **and** be a real calendar date
    (`localDateFromInstant`-round-trip, so `2026-02-30` fails); `[muscle]` must be a member of
    `MUSCLES`. A miss is **400** — never 500. (3) Both responses carry
    `Cache-Control: private, no-store`: they are per-user health data and must never enter the Serwist
    precache or a CDN. (4) Rate limiting is spec 01's limiter, applied at its default for authenticated
    JSON routes; this spec asks for no exception.
    `selectDayDetail` **never returns null**: a valid date with no data is `200` with
    `isEmpty: true`, zeroed macros and `tonnageKg: null` — a 404 would break the sheet's steppers, whose
    whole job is walking into empty days.

## Data

`specs/02-data-model.md` owns every DDL statement. This module defines nothing.

**Reads** — trimmed to what an interface in this file actually queries. Anything a tile does not
consume is not listed, so an engineer never has to guess whether to implement it. (Readiness in the
Behaviour-1 today strip is spec 13's payload, not a read of ours.)

| Table | Columns | Index (spec 02 P-id) |
|---|---|---|
| `workouts` | `local_day, volume_kg, hard_sets, ended_at, title, started_at, duration_sec, id` | `workouts_local_day_idx` (P1) |
| `sets` | `local_day, exercise_id, set_type, weight_kg, reps, rir, e1rm_kg, completed_at, id` | `sets_local_day_exercise_id_idx` (P5); `sets_exercise_id_completed_at_idx` (P3/P4) |
| `exercise_muscles` | `exercise_id, muscle, role` | PK prefix for the join; `exercise_muscles_muscle_role_exercise_id_idx` (P6) |
| `exercises` | `id, name, name_ru` | PK. Display name is always `name_ru ?? name` |
| `volume_weights` | `role, credit` | PK (2 rows) |
| `personal_records` | `exercise_id, kind, value, reps_at_value, local_day, achieved_at, id` | `personal_records_achieved_at_idx` (P8); `personal_records_exercise_id_kind_achieved_at_idx` |
| `body_measurements` | `local_day, weight_kg, trend_kg, trend_excluded, body_fat_pct` | `body_measurements_local_day_idx` (P11) |
| `food_entries` | `local_day, kcal, protein_g, carb_g, fat_g, confidence, confirmed_at` | `food_entries_local_day_eaten_at_idx` (P10) |
| `goals` | `kind, target_value, unit, starts_on, ends_on` | `goals_kind_ends_on_idx` |
| `streak_ledger` | `local_day, status` | `streak_ledger_local_day_uq` |
| `muscle_week_rollups` | all | `muscle_week_rollups_iso_week_idx` (requested, R1) |

Physical column naming follows spec 02 exactly: the date column is **`local_day`**
(`localDay: localDay()` from `src/db/columns.ts`), `'YYYY-MM-DD'` Asia/Almaty, with its
`GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'` CHECK. The TypeScript type is spec 07's
`LocalDate`; the two names are not interchangeable and no SQL in this module may spell the column
`local_date`. Also per spec 02: `real` for weights/RPE/RIR, `integer({mode:'boolean'})`,
`integer({mode:'timestamp_ms'})`. All calendar-shaped filtering is on the stored column; it is never
derived in SQL.

**Writes.** `muscle_week_rollups` only (request R1). It is a derived cache of the rule-22(ii) query,
never a source of truth.

**KV** — binding **`CACHE_KV`**, the only namespace `wrangler.jsonc` declares
(`{ "binding": "CACHE_KV", "id": "9b0bf0d1…" }`). Spec 02 §Data names `APP_CACHE` and
`NUTRITION_CACHE`; neither binding exists, and `env.APP_CACHE` would be `undefined` at runtime —
surfacing as a `TypeError` on `kv.get` inside the dashboard render, because `kv` arrives as a
parameter. Keys (spec 02's `dash:v1:<local_day>` prefix, one key not per-day — rule 22):
`dash:v1:payload` → `{ forLocalDay, locale, payload: DashboardPayload }`; `dash:v1:calcuts` →
`{ forLocalDay, cuts: CalendarCuts }`. A shape change is a version-prefix bump, not a purge.
Reconciling spec 02's namespace names with `wrangler.jsonc` is request R10.

**R2**: read-only, and only the progress-photo thumbnail the body-composition tile links to
(`photos/progress/{yyyy}/{mm}/{id}/thumb.webp`, r03 §5), through spec 10's authenticated handler with
`Cache-Control: private, max-age=31536000, immutable` — never a public `r2.dev` URL.

**IndexedDB**: Dexie database `fit` (spec 05 owns it), new store `analytics_cache`, key `dashboard` →
`{ payload: DashboardPayload; savedAt: number }`. One row, overwritten. Adding the store is a spec 05
version-ladder change, not a local decision — request R12.

### Requested of other specs

Nothing below happens unless the owning spec implements it. Without R6–R9 the rollup is permanently
empty and chart 19(b) renders nothing; without R10 the KV read throws.

| # | Of | What | Signature / shape |
|---|---|---|---|
| R1 | 02 | New table `muscle_week_rollups`. **Raw and per-role only** — no `credited_*` columns, so re-weighting is a `volume_weights` UPDATE (rule 12). | `(iso_week TEXT, muscle TEXT ∈ MUSCLES, primary_sets REAL, secondary_sets REAL, raw_hard_sets REAL, primary_tonnage_kg REAL, secondary_tonnage_kg REAL, raw_tonnage_kg REAL, updated_at INTEGER{timestamp_ms})`, `P(iso_week, muscle)`, `I(iso_week)`, `C(iso_week GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]')` |
| R2 | 02, 06 | `sets.e1rm_source TEXT` — r09 §2: without it *"a 'PR' the user disputes is undiagnosable"*. Rule 18's hollow dot ships only once this exists. | `'epley'\|'brzycki'\|'rpe'\|'actual_single'`, nullable |
| R3 | 11 | `goals.kind` to gain `'carbs'` and `'fat'`. Its enum (`bodyweight\|kcal\|protein\|sessions_per_week\|e1rm\|bodyfat`) cannot express the brief's plural "macro/calorie targets", so ring 3 and the fat readout have no target. | enum widening; spec 02 rule 13 keeps `goals.kind` Zod-only, so no CHECK recreate |
| R4 | 07 | `isoWeekday`, in `time.ts`, arithmetic from `dayIndex` (no `Intl`, rule 6). Needed by rule 17's Friday gate. Test vectors: `'2026-09-07'→1`, `'2026-09-11'→5`, `'2026-09-13'→7`. | `isoWeekday(d: LocalDate): 1\|2\|3\|4\|5\|6\|7 \| null` |
| R5 | 07, 06 | Add `'amrap'` to `SetType` and `COUNTED_SET_TYPES`. Spec 02's `SET_TYPES` has five values; spec 07's has four and r09 §8 predates the enum. AMRAP is the terminal set of 5/3/1, GZCLP and nSuns — the exact programs the brief's module 3 names — so today a top-set day contributes **zero** tonnage, zero hard sets and zero muscle colour, and its calendar cell reads cold. **Decision: an AMRAP set is stimulus and counts.** This module's SQL renders `COUNTED_SET_TYPES` from `@/lib/calc` and never a literal type list, so it follows the day the constant changes. | `SetType \|= 'amrap'`; `COUNTED_SET_TYPES = ['working','drop','failure','amrap']`; test vector `isCountedSet({type:'amrap'}) === true`; spec 06 recomputes `volume_kg`/`hard_sets` accordingly |
| R6 | 06 | In the finish / edit / soft-delete `db.batch()`: `recomputeMuscleWeek(db, isoWeekKey(localDay))` **and** `invalidateDashboard(kv)`. | as exported by `rollups.ts` / `cache.ts` |
| R7 | 10 | `invalidateDashboard(kv)` after any `body_measurements` write (including the trend recompute-on-backfill). | ditto |
| R8 | 11 | `invalidateDashboard(kv)` after any `food_entries` write **and** after a correction save (water is not on this surface, so `water_logs` needs no hook) — otherwise today's rings are wrong for up to 6 h. | ditto |
| R9 | 13 | `invalidateDashboard(kv)` after a `streak_ledger` upsert (it drives the calendar's rest state). | ditto |
| R10 | 01, 02 | Spec 02 §Data names KV namespaces `APP_CACHE` + `NUTRITION_CACHE`; `wrangler.jsonc` declares only `CACHE_KV`. Reconcile: either rename spec 02's lines to `CACHE_KV` with the `dash:` / `off:` / `fdc:` / `tdee:` prefixes namespacing inside it (recommended — one namespace is enough for a single user), or add the two bindings. This spec codes against `CACHE_KV`. | wrangler.jsonc + spec 02 §Data |
| R11 | 01, 14 | Two steps appended to spec 01's existing **`nightly-rollup`** cron (`"20 19 * * *"`, 00:20 Almaty — already ≥ 1 h apart, so the 15-min CPU bucket applies, stack-facts). **No new trigger and no new `CronName`.** Order is fixed: verify, then rebuild (rule 23). The alarm goes out through spec 14's `notify`. | `verifyMuscleWeeks(db, verifyWindowWeeks(nowMs))` → on non-empty `drifted`, `notify(env, { kind: 'health-alert', channels: ['telegram'], telegram: { html }, scheduledTime })`; then `rebuildMuscleWeeks(db, trailing2Weeks)` |
| R12 | 05 | Dexie store `analytics_cache: "&key"` plus a `db.version(n+1)` bump in `src/db/local.ts`; and permission for island 3 to mount on the static `/~offline` page (it reads IndexedDB, not a request-time API, so spec 05 rule 6 is not violated). | store index string + version ladder entry |
| R13 | 01, 16 | (a) Pin `@visx/scale@4.0.0`, `@visx/shape@4.0.0`, `@visx/axis@4.0.0`, `@visx/tooltip@4.0.0` and devDependency `@playwright/test@1.63.0` (stack-facts; absent from `package.json` today, so Verification step 4 cannot run). (b) Add a thirteenth `perf-budgets.json` row: `/analytics/exercise/[exerciseId]` → 200 KB, owner 12. (c) Relabel spec 16 rule 21's `/analytics` surface from "recharts + visx" to "visx only" (deviation D3). | package.json + `perf-budgets.json` + spec 16 rule 21 |
| R14 | 04, 05 | Spec 04 rule 10 forbids **any** app-group page from touching a binding, and its Verification greps `'src/app/(app)' --include=page.tsx` for `force-dynamic` and fails on a hit. These three routes are server-rendered D1 readers by design (rule 2) — a client-fetched dashboard would ship the whole aggregation layer to the browser and blow spec 16's 185 KB budget. Requested: narrow rule 10 and that grep to an explicit allowlist naming `/`, `/analytics` and `/analytics/exercise/[exerciseId]`, and record in spec 05 that these three are not precached (rule 3 already depends on that). This is the one cross-spec conflict this module cannot resolve alone — open question 4. | spec 04 rule 10 + its Verification grep; spec 05 precache note |

## UX notes

- All copy is a key under the `analytics` namespace in `messages/{ru,en}.json`, resolved server-side
  with `getTranslations('analytics')` (`next-intl@4.14.4`, `next-intl/server`) on the three
  `force-dynamic` routes, and with `useTranslations('analytics')` inside the islands and on
  `/~offline`. Zero user-facing string literals in `.tsx` under `src/components/analytics/**` — a lint
  assertion, not a convention. `DEFAULT_LOCALE` is `ru` (`wrangler.jsonc` `vars`).
  Month labels come from `analytics.months` (12 names per locale) through `monthLabelsFor`, computed
  arithmetically: `Intl.DateTimeFormat` is banned here for the same reason spec 07 rule 6 bans it —
  the `workerd` ICU/tzdata version is not ours to control (r09 §8). `CalendarPayload.monthLabels`
  therefore arrives already localised, and the locale is an input to the payload builder.
- The calendar is the only horizontally scrolling element on the dashboard: it needs
  `overscroll-behavior-x: contain` so a fast swipe cannot fire the browser back gesture, and
  `touch-action: pan-x` so a vertical swipe still scrolls the page.
- Calendar and body-map taps fire a 10 ms haptic on selection (spec 03's primitive) — only after the
  rule-7 tap gate passes. No haptic on scroll, sheet dismissal or tile expansion.
- Day detail and muscle detail are **bottom sheets**, not routes — a lookup, not a destination, and a
  sheet keeps the heat surface visible above it. The e1RM curve is a **page**: somewhere you stay and
  want to deep-link.
- One-handed reach: both sheets' primary controls (the `‹ ›` steppers, the close affordance) sit in the
  bottom 40% of the viewport. The calendar's fit/scroll toggle and the day-picker button are in the
  tile header and are deliberately two-handed.
- Motion: rings animate `stroke-dashoffset` from `C` to target over 700 ms `cubic-bezier(.2,.8,.2,1)`,
  staggered 80 ms outer→inner, once per mount — a CSS animation, no JS. Heat cells and muscle regions
  **never** animate fill: a 371-cell colour transition is a repaint storm on a mid-range phone. Under
  `prefers-reduced-motion: reduce`, rings render at their final offset and sheets fade rather than
  slide.
- a11y: `role="img"` + `aria-labelledby` on both heat surfaces; the weekly table carries identical
  numbers (asserted in e2e) and each of its 17 rows has a 44 px `<button>` that opens the muscle sheet;
  the calendar's keyboard path is the tile-header day-picker button plus the sheet steppers (rule 7).
  Focus order is tile heading → tile action(s) → next tile. The calendar `<svg>` itself is not
  focusable — 371 tab stops is a worse outcome than one button — and the legend is a `<ul>` with text
  labels, not bare swatches, including entries for the rest-day dash and the unknown-day hatch. The
  calendar caption states the window's rest-day count and the `<details>` block lists `restDates` and
  `unknownDates`, so those two states are readable without seeing colour at all. The axe gate over `/`
  and `/analytics` is spec 16 rule 25's.

## Risks

| Risk | Mitigation |
|---|---|
| **UTC-vs-Almaty off-by-one** — r09 §8 and spec 07 rule 44 both call this the highest-risk bug in analytics. | Never derive a date in SQL; filter only on the stored `local_day`; all window maths through `@/lib/calc/time`, which is `Intl`-free and 100%-covered by spec 07's tests. |
| Someone writes `local_date` in a query because spec 07 and this file both use `LocalDate` in TS. | The physical name is stated once, in §Data, and the integration suite runs real SQL — a `local_date` reference fails with `no such column` on the first test. |
| Someone sums `creditedTonnageKg` across muscles and ships a 72%-inflated "session volume". | Branded `CreditedKg` vs `TonnageKg`; rule 19; the integration test asserts the r09 pair (3270.0 real vs 5640.0 summed). |
| The SQL aggregate silently disagrees with `@/lib/calc`'s per-set predicates — two implementations of `isCountedSet`/`isHardSet`. | `selectRawByMuscleRole` returns raw facts only, and Verification step 2 runs the same fixture week through **both** the SQL and `hardSetsByMuscle()`/`volumeByMuscle()` and asserts equality — not merely equality with r09's literals. |
| `muscle_week_rollups` drifts after an edit or soft-delete of an old workout. | Idempotent `recomputeMuscleWeek` on every write touching that week (R6); nightly `verifyMuscleWeeks` runs **before** any rebuild, over a bounded 12-week window, with a `0.01` epsilon, and alarms without self-healing; only chart 19(b) reads it; a seeded-drift test proves detection works. |
| Recharts creeps in via a shadcn chart component or a pasted snippet. | Spec 16's `perf-budgets.json` gate plus an ESLint `no-restricted-imports` rule banning `recharts` under `src/`. |
| One poisoned `e1rm_kg` flattens every curve. | Robust y-top `min(max, median + 3·MAD) × 1.05` with a stated `n < 5` fallback (rule 18) — **not** `p99`, which equals the max at our sample sizes and protected nothing; `reps > 12` and `NULL` excluded; spec 02's `sets_e1rm_finite` CHECK (`> 0 AND < 2000`) blocks `Infinity` and negatives at the source. |
| An in-progress or imported session renders as a rest day, because `SUM(NULL)` is `NULL`. | Five distinct cell states (rule 5) with `'p'` and `'?'` glyphs, a set-level fallback sum for up to 12 days, `unknownDates` in the payload and the caption, and **no `COALESCE(…, 0)`** anywhere in `selectDailyTonnage`. |
| The dataset's single `shoulders` value cannot show a rear-delt deficit — r09's named failure mode. | A documented one-region rule (11) rather than a fake split; the legend states the limitation; open question 3 carries the real fix. |
| MIT attribution lost when the path strings are copied. | Licence header in `body-map-paths.ts` plus a `NOTICE` entry; a CI grep asserts both strings. |
| KV serves a stale dashboard after an evening session. | One key, deleted by one function (`invalidateDashboard`) on every write path (R6–R9); TTL capped at 6 h; `generatedAtMs` rendered in the tile footer so staleness is *visible* rather than invisible. KV is eventually consistent, so a delete is not guaranteed instantly visible everywhere — the exact propagation window is `UNVERIFIED` and the mitigation is the visible timestamp, not a freshness guarantee. |
| 371 rects plus ~40 paths inflate the RSC payload. | Levels travel as one 371-char string, not 371 objects; one delegated listener per surface; asserted in the e2e payload check. |
| A swipe of the calendar opens a random day sheet and buzzes. | The rule-7 tap gate: same `pointerId`, `isPrimary`, `< 8 px` movement, `< 500 ms`. Asserted in e2e by dragging the grid and expecting no sheet. |

## Verification

```bash
# 1. Pure presentation functions.
npx vitest run tests/unit/analytics-buckets.test.ts tests/unit/analytics-scale.test.ts \
               tests/unit/analytics-muscle-map.test.ts tests/unit/analytics-months.test.ts
```

PASS = zero failures with these named cases green:

- `analytics-scale`: `contrastVsBlack` of the five levels equals `3.00, 4.99, 7.97, 12.12, 17.71`
  (±0.01) and **every** level `>= 3.0`; `contrastVsBlack('#6E6E6E') === 4.12` and
  `contrastRatio('#6E6E6E', '#1F1F1F') === 3.23` (±0.01), both `>= 3.0`;
  `contrastVsBlack('#1F1F1F') === 1.27` (±0.01) — asserted at its **real** value with the rule-8
  exemption named in the test title, not silently omitted; `LIME_SCALE.levels.length === 5`;
  `levelToHex(0) === '#1F1F1F'`.
- `analytics-buckets`, muscle ladder (`MUSCLE_LEVEL_CUTS = [2.5, 5, 10, 16]`, half-open upward):
  `muscleLevel(0) === 0`, `(0.5) === 1`, `(2.4) === 1`, `(2.5) === 2`, `(4.99) === 2`, `(5) === 3`,
  `(9.99) === 3`, `(10) === 4`, `(15.99) === 4`, `(16) === 5`.
- `analytics-buckets`, calendar absolute ladder (`CALENDAR_ABSOLUTE_CUTS_KG = [2000, 4000, 6000,
  8000]`, used when `cuts === null || cuts.n < 10`): `calendarLevel(0, null) === 0`,
  `(1, null) === 1`, `(1999, null) === 1`, `(2000, null) === 2`, `(3999, null) === 2`,
  `(4000, null) === 3`, `(7999, null) === 4`, `(8000, null) === 5`, `(50000, null) === 5`; and the
  same vectors with `cuts.n = 4` (a small sample must take the ladder, not the percentiles).
- `analytics-buckets`, percentiles — **R-7 linear interpolation**, `h = p·(n−1)`, on this literal
  12-value sample (kg): `[1200, 1850, 2100, 2400, 2650, 2900, 3270, 3500, 3900, 4400, 5100, 6200]`
  ⇒ `p25 === 2325`, `p50 === 3085`, `p75 === 4025`, `p90 === 5030`, `n === 12` (worked: p25
  `h = 2.75` ⇒ `2100 + 0.75·300`; p50 `h = 5.5` ⇒ `2900 + 0.5·370`; p75 `h = 8.25` ⇒
  `3900 + 0.25·500`; p90 `h = 9.9` ⇒ `4400 + 0.9·700`). Unsorted input gives the same result.
  `calendarCuts([])` returns `n === 0`; `calendarCuts([x])` returns all four equal to `x`.
- `analytics-muscle-map`: every one of spec 02's 17 `MUSCLES` values is either a mapped region member
  or listed in `MUSCLES_WITHOUT_POLYGON` — exhaustiveness, so no muscle is silently missing from both
  map and table; `REGION_MEMBERS['upper-back']` is `['lats','middle_back']`;
  `muscleSvgId('chest','front','l') === 'm-chest-front-l'`; every vendored `BodyPart.path` key is one
  of `left`/`right`/`common` and the back view's `common` entries land in `chrome-back`.
- `analytics-months`: `monthLabelsFor('2026-09-14', 53, RU_MONTHS)` puts a label on the first column
  of each month and nowhere else; the function contains no `Intl` reference (source grep).
- The credit and window vectors themselves (r09 §8's `chest 6.0 / front_delts 2.5 / triceps 3.5`, the
  `2026-09-07…2026-09-13` window, the `2026-09-06T19:30:00Z → '2026-09-07'` off-by-one) belong to spec
  07's `volume.test.ts` / `time.test.ts` and are **not** duplicated here; step 2 asserts the SQL
  reproduces them.

```bash
# 2. Aggregates, SQL/calc parity, rollup and drift — against a real local D1.
#    Database name is `fitness-pwa-db` (wrangler.jsonc `d1_databases[0].database_name`,
#    == package.json `db:migrate:local`). There is no database called `fitness-tair`.
npm run db:migrate:local
node tests/fixtures/make-r09-week.mjs > tests/fixtures/r09-volume-week.sql   # dates relative to today
npx wrangler d1 execute fitness-pwa-db --local --file=tests/fixtures/r09-volume-week.sql
npx vitest run tests/integration/analytics-queries.test.ts
npx wrangler d1 execute fitness-pwa-db --local --command \
  "SELECT muscle, primary_sets, secondary_sets, raw_hard_sets, primary_tonnage_kg, secondary_tonnage_kg \
   FROM muscle_week_rollups ORDER BY iso_week, muscle"
# Window functions must exist on REMOTE D1 too (rule 21's PR-delta query). Verified locally 2026-09-12.
npx wrangler d1 execute fitness-pwa-db --remote -y --command \
  "SELECT x, ROW_NUMBER() OVER (ORDER BY x DESC) rn, LAG(x) OVER (ORDER BY x) prev \
   FROM (SELECT 1 x UNION ALL SELECT 2 UNION ALL SELECT 3)"
```

PASS = all of:

- The fixture week (r09 §8, mapped onto `MUSCLES`: chest, shoulders, triceps) credits
  `chest 6.0 / 2850.0`, `shoulders 2.5 / 1185.0`, `triceps 3.5 / 1605.0` exactly, with the credit read
  from `volume_weights` (and a test asserting the seeded rows are `1.0` / `0.5` and equal
  `@/lib/calc`'s `PRIMARY/SECONDARY_MUSCLE_CREDIT`).
- **Raw** hard sets are `chest 6`, `shoulders 5`, `triceps 6` — integers, and the test asserts
  `triceps.rawHardSets (6) !== triceps.creditedHardSets (3.5)`, which is the whole reason rule 17's
  flag reads the raw column.
- **SQL/calc parity:** the same fixture rows fed through `hardSetsByMuscle()` and `volumeByMuscle()`
  produce a map deep-equal to the one `selectRawByMuscleRole` + the `volume_weights` credit produce.
  Not merely equality with r09's literals — equality with the other implementation.
- `selectDailyTonnage(week)` sums to `3270.0`; per-muscle tonnage sums to `5640.0`; the test carries an
  explicit `expect(perMuscleSum).not.toBe(sessionTonnage)`.
- `selectRawByMuscleRole` excludes the two warm-ups (200 + 180 kg) from tonnage and the RIR-5 cable fly
  from hard sets while keeping it in tonnage.
- Nullability: a workout row with `ended_at IS NULL` yields `source: 'in_progress'` and
  `tonnageKg: null` (**not** `0`); a finished row with `volume_kg IS NULL` yields
  `source: 'recomputed'` with the set-level sum; a finished row with `volume_kg IS NULL` **and** no
  sets yields `source: 'none'`, `tonnageKg: null`, and appears in `unknownDates`.
- `verifyMuscleWeeks` on the seeded weeks returns `drifted: []`, **then** a deliberate
  `UPDATE muscle_week_rollups SET raw_hard_sets = raw_hard_sets + 0.02` on one row makes the next
  `verifyMuscleWeeks` return exactly that `{week, muscle, field}` — and a `+ 0.005` nudge does **not**
  (the `ROLLUP_EPSILON` boundary).
- The remote window-function probe returns `rn` 1/2/3 and `prev` 2/1/`null`.

```bash
# 3. Routes. Wait for readiness before curling — `npm run preview` is
#    `opennextjs-cloudflare build && opennextjs-cloudflare preview`, minutes of build first.
npm run preview & PREVIEW_PID=$!
until curl -sf http://localhost:8787/api/health > /dev/null; do sleep 2; done   # spec 01's liveness route
D=$(TZ=Asia/Almaty date +%F)
curl -s "localhost:8787/api/analytics/day/$D"      | npx jq '.date, .tonnageKg, .hardSets, .tonnageSource'
curl -s  localhost:8787/api/analytics/muscle/chest | npx jq '.[0] | {exerciseName, role, rawHardSets, creditedHardSets}'
curl -s "localhost:8787/api/analytics/day/1970-01-01" | npx jq '.isEmpty, .tonnageKg'
for BAD in 07-09-2026 2026-02-30; do
  curl -so /dev/null -w '%{http_code}\n' "localhost:8787/api/analytics/day/$BAD"; done
curl -so /dev/null -w '%{http_code}\n' localhost:8787/api/analytics/muscle/front_delts
curl -si -H 'cookie:' localhost:8787/api/analytics/muscle/chest | head -1      # no session
curl -sI "localhost:8787/api/analytics/day/$D" | grep -i cache-control
kill $PREVIEW_PID
```

PASS = the fixture's heaviest day reports its three counted bench sets (`1800` / `3`, `tonnageSource:
"stored"`); a non-empty contributor array whose first row is Barbell Bench Press / `primary` with
`rawHardSets: 3` and `creditedHardSets: 3`; `1970-01-01` returns **200** with `isEmpty: true` and
`tonnageKg: null` (never 404 — the steppers walk into empty days); **400** for both malformed dates
and for the non-enum muscle, never 500; **401** with no session (spec 04's envelope, not a 302); and
`cache-control: private, no-store` on every response.

```bash
# 4. UI, a11y parity, keyboard paths. Playwright starts its own server (spec 16's
#    playwright.config.ts `webServer`, port 8787); `@playwright/test@1.63.0` is request R13.
npx playwright test tests/e2e/dashboard.spec.ts
grep -rq "recharts" src && echo FAIL || echo PASS       # no import anywhere in source
! grep -rql recharts .open-next .next/static && echo BUNDLE_CLEAN
```

PASS = `PASS`, `BUNDLE_CLEAN`, and the e2e asserting all of:

- one `[data-date]` rect per past date in the window and none for future dates; the total rect count
  matches `371 − daysAfterToday`.
- every heat `fill` is one of the seven `LIME_SCALE` values (5 levels + `empty` + `restGlyph`).
- the day whose fixture tonnage is highest, selected by a date **computed in the test from the same
  clock the fixture generator used** (never a hard-coded `2026-09-07`, which disappears from a
  rolling 53-week window once real time passes it): tapping it opens the sheet showing `1800`.
- the legend reads "fixed scale" (`analytics.calendar.legendAbsolute`) for the fixture, because it has
  3 non-zero days so `cuts.n < 10` forces the absolute ladder — rule 4's "never switch silently",
  asserted rather than assumed.
- **keyboard:** `Tab` reaches the day-picker button, `Enter` opens the sheet on today, `‹` steps back
  a day and the heading changes; `Tab` reaches the weekly table's `chest` row button and `Enter` opens
  the muscle sheet. Neither sheet is reachable only by pointer.
- **tap gate:** a 60 px horizontal drag across the grid scrolls it and opens **no** sheet.
- tapping `[data-muscle="chest"]` lists Barbell Bench Press with role `primary`; the weekly table's
  chest row matches `[data-muscle="chest"] @data-sets` and `@data-raw-sets`;
  `mg-shoulders-front` and `mg-shoulders-back` carry the same `data-level`.
- the macro-rings legend `<ul>` has four `<li>`s naming kcal, protein, carbs, fat in that order, so
  ring identity survives with colour ignored; with an unconfirmed-dominant fixture day the arcs are
  dashed and the `≈` caption links to `/nutrition/{date}`.
- the page contains zero `<canvas>`; `/` mounts exactly three client islands.
- **Not asserted here:** the per-route gzipped-JS budget and LCP. Those are spec 16's
  `npx playwright test --project=perf` and its LHCI run against `perf-budgets.json`
  (`/` 185 KB, `/analytics` 200 KB, `/analytics/exercise/[exerciseId]` 200 KB — request R13) and
  `lighthouserc.json` (`largest-contentful-paint <= 2500`). Duplicating them here would create two
  budgets to keep in sync.

```bash
# 5. Licence.
grep -q "MIT" src/components/analytics/body-map-paths.ts \
  && grep -q "react-native-body-highlighter" NOTICE && echo LICENCE_OK
```

PASS = `LICENCE_OK`.

## Open questions

1. **Recharts at all?** The brief says "Recharts for standard charts", but `recharts@3.10.1` measures
   147,530 B gzipped — 74% of the 200 KB spec 16 allots `/analytics` in total, before our own code.
   (a) Drop it from the project entirely; visx primitives plus hand-rolled SVG everywhere. (b) Keep it
   for `/analytics/exercise/[exerciseId]` only, behind `next/dynamic`, raising that route's budget to
   250 KB and asking spec 16 to break its own 200 KB ceiling. **Recommendation: (a)** — the acceptance
   checklist includes a performance budget, and one chart vendor is also one visual system. Deviations
   D2 and D3 both hang off this answer.
2. **`SECONDARY_MUSCLE_CREDIT` 0.5 or 1.0?** Spec 07 (its own open question 2) **owns the constant**
   and spec 02 owns the seeded `volume_weights` rows; this spec only records which consumer reads
   which value, and rule 12 has now made the answer a one-row `UPDATE` rather than a rollup rebuild.
   As implemented: the map's **colour** reads the credited figure (0.5), because its job is relative
   visual emphasis; the **under-trained flag** reads raw sets and never touches the credit at all
   (rule 17), which removes the pressure that made 1:1 look necessary. If the owner still wants a
   second weight pair keyed by consumer, spec 07 adds it and rule 17 is unaffected.
3. **Split `shoulders` into front/side/rear delts?** The brief's heatmap wants deltoid heads; the
   dataset (and so spec 02's `MUSCLES`) has one lumped `shoulders`, which r09 §8 flags as guaranteeing
   a permanently cold rear-delt region. (a) Ship one `shoulders` region and say so in the legend.
   (b) Spec 08 hand-classifies the ~150 shoulder-involving exercises into
   `front_delts`/`side_delts`/`rear_delts`, extending the enum to 19 values with a migration.
   **Recommendation: (a) for Phase 6, (b) as a Phase 9 data task** — it is manual classification with
   no upstream source, and the map is honest while the limitation is stated. If (b) lands, only
   `REGION_MEMBERS` and the enum change; no query does.
4. **May these three routes be server-rendered D1 readers?** (request R14.) Spec 04 rule 10 makes the
   whole app group public static HTML that fetches its data after hydration, and greps for
   `force-dynamic` under `src/app/(app)/**/page.tsx` in its own Verification; spec 01 rule 12 and r02
   §3 rule 2 say any page touching a binding **must** be `force-dynamic`. This module cannot satisfy
   both. (a) Allowlist `/`, `/analytics`, `/analytics/exercise/[exerciseId]` in spec 04 rule 10 and
   accept that those three are not precached — the offline path is rule 3's IndexedDB snapshot plus
   spec 05's `/~offline`. (b) Rewrite all three as static shells that fetch `DashboardPayload` from a
   new `GET /api/analytics/dashboard`, keeping them precached and offline-navigable. **Recommendation:
   (a).** (b) moves nothing but the boundary — the same payload, one round trip later, after a
   first paint with no content — while costing an extra route, a client data layer on the heaviest
   page in the app, and the server-rendered SVG that keeps `/` inside 185 KB. **Owner decides, and it
   is spec 04's rule to amend, not this one's.** Every other spec's routes are unaffected either way.
