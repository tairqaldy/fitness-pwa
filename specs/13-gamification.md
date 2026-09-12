# 13 — Streaks, XP, achievements and the consistency system

## Purpose

Turns logged data into consistency pressure that never becomes shame. Owns the day classification
that feeds `streak_ledger`, the daily + weekly streak rules with freeze/grace days and a **decay
instead of a reset**, adherence %, XP/levels, the achievement catalogue, the weekly/monthly/yearly
review rituals and the optional gym check-in. Satisfies brief bullet 8 and the acceptance line
*"Streak survives a grace day (no hard reset to zero); achievements unlock"*.
`specs/02-data-model.md` §"Out of scope" assigns the streak/XP/achievement **rules** here and keeps
only the ledgers itself; this spec never redefines a table.

The no-reset rule is mechanistic, not sentimental. Marlatt & Gordon's **abstinence-violation effect**
is the documented path from one lapse to relapse — the person attributes the lapse to internal,
stable, global causes and the resulting shame overwhelms coping (Collins & Witkiewitz, "Abstinence
Violation Effect", *Encyclopedia of Behavioral Medicine*, doi:10.1007/978-1-4419-1005-9_623) — and a
counter falling to zero **is** that attribution rendered as a number. It is also empirically
unwarranted: Lally et al. found *"missing one opportunity did not materially affect the habit
formation process"* (*Eur. J. Soc. Psychol.* 2010, doi:10.1002/ejsp.674; vol/pages `UNVERIFIED`).

## Scope

Day classification into `streak_ledger.status`; daily/weekly streak state machines; grace and freeze
accrual, spend order, cap, decay and restore; adherence % over trailing windows; XP sources, the
append-only `xp_ledger` write path and the level curve; the achievement catalogue (in code),
predicate evaluation on the write path and in the nightly sweep, retroactive unlocks; weekly review /
monthly report card / year-in-review payload generation; weekly quest evaluation against `quests`;
the gym check-in and its privacy contract; the single `nightly-rollup` cron; every RU/EN string this
module emits plus the ban-list lint.

### Out of scope

| Excluded | Owner |
|---|---|
| All DDL, column types, enums, indexes, migrations | `specs/02-data-model.md` |
| Sending push/Telegram, `notification_log` writes, AI prose for the review | `specs/14-ai-coach-and-notifications.md` |
| Charts, calendar/muscle heatmaps, e1RM curves the reviews embed | `specs/12-analytics-dashboard.md` |
| `isHardSet`, volume, e1RM, EMA trend, Navy BF, adaptive TDEE arithmetic | `specs/07-calculators.md` |
| Workout write path that calls `buildXpStatements` | `specs/06-workouts.md` |
| Program calendar supplying `plannedSessions`; `deload_blocks` | `specs/09-programs.md` |
| Outbox flush order, Dexie wiring, conflict UX | `specs/05-pwa-offline-sync.md` |
| Export/import of ledgers and unlocks | `specs/15-data-portability.md` |
| `messages/{ru,en}.json` ownership, `next-intl` wiring | `specs/01-architecture.md` (per `docs/research/r11-i18n-on-next16-workers.md`) |
| CI wiring of these tests | `specs/16-testing-ci-quality.md` |

## Files to create

| Path | Responsibility |
|---|---|
| `src/lib/gamification/constants.ts` | Every tunable as a named export. No magic numbers elsewhere. |
| `src/lib/gamification/iso-week.ts` | `isoWeekKey`, `isoWeekDays`, `isWeekEnd` — pure, over local-day strings. |
| `src/lib/gamification/day-status.ts` | Pure classifier: day facts + goal → `streak_ledger.status`. |
| `src/lib/gamification/streak.ts` | Pure reducer `applyDay`/`applyWeekClose`: the whole grace/freeze/decay/restore machine. |
| `src/lib/gamification/adherence.ts` | Pure `adherence()` + warm-up gating. |
| `src/lib/gamification/xp.ts` | XP source table, `xpToReach`, `levelOf`, `levelProgress`, `collectWorkoutXpEvents`. |
| `src/lib/gamification/achievements/{catalogue,metrics,evaluate}.ts` | The 39 definitions + `CATALOGUE_VERSION`; `MetricSnapshot`; the pure evaluator. |
| `src/lib/gamification/quests.ts` | `QUEST_POOL` (§18), the deterministic `selectQuests`, `questComplete` — pure. |
| `src/lib/gamification/geofence.ts` | Haversine + distance/accuracy bucketing. **Client-side only.** |
| `src/lib/gamification/copy.ts` | Message-key constants and `BANNED_COPY_PATTERNS`. |
| `src/server/gamification/rollup.ts` | `buildDayLedgerStatement` (write path), `classifyToday` (read-only), `classifyAndUpsertDay`, `rollDays` (self-healing backfill), week close, `shouldNudgeAtRisk`. |
| `src/server/gamification/xp-writer.ts` | `filterCappedEvents`, `buildXpStatements` — batch items for another spec's `db.batch()`; `readXpTotal`. |
| `src/server/gamification/achievements.ts` | `buildMetricSnapshot` (§16a), `sweepAchievements`. |
| `src/server/gamification/snapshot.ts` | `readGamificationSnapshot` (D1 + KV cache) for the dashboard. |
| `src/server/gamification/review.ts` | `buildWeeklyReview`, `buildMonthlyReportCard`, `buildYearInReview` + the three `persist*` writers. |
| `src/server/gamification/quest-writer.ts` | `openWeekQuests`, `updateQuestProgress` — the only writers of `quests`. |
| `src/server/gamification/gym-checkin.ts` | Zod input (`.strict()`) + write. Rejects any coordinate field. |
| `src/jobs/nightly-rollup.ts` | The single cron job (Behaviour §20). Registered in `src/jobs/registry.ts`. |
| `src/app/api/gamification/{snapshot,achievements,gym-checkin}/route.ts` | `GET` snapshot; `GET`/`PATCH` unlocks; `POST` boolean check-in. |
| `src/app/api/gamification/review/[week]/route.ts` | `GET` review; `PATCH` the reflection answer. |
| `src/app/(app)/progress/{streak,achievements}/page.tsx` | Streak ledger calendar; achievement grid. |
| `src/app/(app)/progress/{review/[week],report/[month],year/[year]}/page.tsx` | The three rituals. |
| `src/components/gamification/{StreakChip,StreakSheet,AdherenceRing,XpBar}.tsx` | Header chip + sheet; the headline ring; monotonic XP bar. |
| `src/components/gamification/{AchievementCard,AchievementUnlockSheet,GymCheckInButton}.tsx` | Grid cell; celebration + batched digest; geolocation flow with fallback. |
| `src/components/gamification/{WeeklyReview,YearInReviewDeck}.tsx` | Review sections + reflection input; vertical card deck + client-side share image. |
| `tests/unit/gamification/{streak,xp-curve,adherence,day-status,iso-week,achievements,quests,geofence,copy-ban-list}.test.ts` | Case names are listed in Verification. |
| `tests/unit/gamification/rollup.test.ts` | The server cases (cold start, truncation repair, cap filtering, empty batch) against `specs/16`'s in-memory D1 harness. |
| `tests/fixtures/gamification-canonical.sql` | The §10 ledger vector as source rows (workouts/sets/check-ins) + `settings`, seeded by name from the Verification block. |
| `tests/e2e/gamification-grace-day.spec.ts` | The DoD: streak survives a grace day; an achievement unlocks. |

Extend, do not create: `messages/{ru,en}.json` (`Gamification` namespace); `src/jobs/registry.ts`
(`CRON_ROUTES["20 19 * * *"] = "nightly-rollup"`, byte-identical to the config key).
**Do not touch `wrangler.jsonc`.** `specs/01-architecture.md` §"wrangler.jsonc" already ships the
complete five-entry `triggers.crons` block including `"20 19 * * *"`, and `specs/01`'s
`cron-routes.test.ts` asserts `triggers.crons.length <= 5` and byte-identical keys — adding a sixth,
duplicate entry from here fails that test. The repo's current `wrangler.jsonc` has no `triggers` block
at all (it is added whole by the architecture phase); this module adds nothing to it either way.
*Flagged to `specs/01`:* its comment on that line cross-references "specs/13 §22" but the cron
behaviour is **§20** (§22 is cron-side copy) — fix the reference, not the expression.

## Interfaces

**Convention for this section:** every interface field is `readonly` and every array property is
`readonly T[]`; the modifiers are elided for density and are part of the contract. Units are stated
per field; there are no implicit units. `LocalDay` is the `'YYYY-MM-DD'` Almaty string produced by
`toLocalDay()` in `src/db/local-day.ts` (owned by `specs/02`), never a `Date`.

```ts
// src/lib/gamification/constants.ts
export const STREAK_DECAY = 0.5, STREAK_FLOOR = 1;     // halve, floor at 1 — never 0
export const COVER_MAX_CONSECUTIVE = 2;                // grace+freeze cannot cover a 3rd straight day
export const RESTORE_COOLDOWN_DAYS = 7, DORMANT_AFTER_INACTIVE_DAYS = 14, AT_RISK_MIN_STREAK = 3;
export const ADHERENCE_WINDOW_DAYS = 28, ADHERENCE_WARMUP_DAYS = 14, BACKFILL_MAX_DAYS = 30;
export const XP_CURVE_C = 90, XP_CURVE_P = 1.8, MAX_LEVEL = 100;
export const GEOFENCE_RADIUS_M_DEFAULT = 150;
export const EARTH_RADIUS_M = 6_371_008.8;             // IUGG mean; a 150 m fence is insensitive to ~0.1 %
export const NEAR_RADIUS_MULTIPLIER = 3;               // 'near' = ≤ 3 × radius (§25)
export const ACCURACY_FINE_M = 25, ACCURACY_COARSE_M = 100;
export const REST_DAY_STEPS = 6000;                    // §3, primary_goal='health'
export const REST_DAY_KCAL_FRACTION = 0.5;             // §3, kcalLogged ≥ 0.5 × kcalTarget
export const NUDGE_HOUR_LOCAL = 20.5;                  // 20:30 Almaty — §23 evaluation moment
export const NUDGE_CUTOFF_HOUR_LOCAL = 21;             // never nudge after 21:00 local
export const RETRO_LOG_OFFER_HOUR_LOCAL = 22;          // §25 retroactive-log offer
export const GRADE_CUTOFFS = { A: 90, B: 75, C: 60, D: 45 } as const;   // §27, else F
export const AXIS_VOLUME_FULL_SCALE = 0.10;            // §27 volume axis divisor (fraction)
export const AXIS_STRENGTH_FULL_SCALE = 0.05;          // §27 strength axis divisor (fraction)
export const QUEST_COUNT_PER_WEEK = 3;                 // §18
export const XP_SESSION_CAP = 160;                     // re-exported by xp.ts
// streak_freeze_budget (2), streak_grace_per_week (1) and weekly_target_sessions (4) are
// `settings` columns owned by specs/02 — read them, never hardcode them.
// TIER_XP lives in achievements/catalogue.ts beside the tiers it keys; that is the one
// deliberate exception to "every tunable is here", and it is named in §16.
```

```ts
// src/lib/gamification/day-status.ts
export type LocalDay = string;    // 'YYYY-MM-DD', Asia/Almaty
export type IsoWeekKey = string;  // 'YYYY-Www', ISO-8601, Monday-start, Almaty
export type DayStatus = 'active' | 'rest' | 'grace' | 'freeze' | 'missed';  // = streak_ledger.status
export type PrimaryGoal = 'strength' | 'muscle' | 'fat_loss' | 'recomp' | 'health';

/** Facts for one local day, read from the source tables. Units: kg, kcal, grams, ml. */
export interface DayFacts {
  day: LocalDay;
  workoutId: string | null;       // a FINISHED workout (workouts.ended_at IS NOT NULL)
  countedSets: number;            // sets with type ∈ COUNTED_SET_TYPES (Behaviour §2)
  volumeKg: number;               // workouts.volume_kg, already DERIVED at finish by specs/06
  checkinComplete: boolean;       // daily_checkins row with sleep_quality+mood+energy all non-null
  kcalLogged: number | null; kcalTarget: number | null;
  proteinLoggedG: number | null; proteinTargetG: number | null;
  steps: number | null;
  bodyMeasured: boolean; progressPhoto: boolean;
}
/** `earned` is the streak predicate: true for 'active' and 'rest' only. */
export interface DayClass {
  day: LocalDay; earned: boolean; trained: boolean; nutritionComplete: boolean;
  workoutId: string | null;        // carried through so streak_ledger.workout_id is writable
  reason: 'trained' | 'checkin' | 'nutrition' | 'steps' | 'none';   // → streak_ledger.reason
}
export const COUNTED_SET_TYPES = ['working', 'drop', 'failure', 'amrap'] as const;
export function classifyDay(facts: DayFacts, goal: PrimaryGoal): DayClass;
```

```ts
// src/lib/gamification/streak.ts
export interface StreakState {
  currentDays: number; longestDays: number; currentWeeks: number; longestWeeks: number;
  lastActiveDay: LocalDay | null; lastProcessedDay: LocalDay | null;
  freezesRemaining: number; graceUsedThisWeek: number; coveredRun: number;
  lastDecayDay: LocalDay | null; preDecayPeak: number | null; lastRestoreDay: LocalDay | null;
  lastClosedWeek: IsoWeekKey | null; dormant: boolean; weeksTargetMetTotal: number;
}
// All 15 fields are persisted columns: the 9 that specs/02 already has plus the 6 of Data req. 10
// (covered_run, last_decay_day, pre_decay_peak, last_restore_day, last_closed_week, dormant),
// plus last_processed_day and weeks_target_met_total. A field with no column is a data loss, not a
// cache, so this list and that requirement must move together.
export interface StreakStep {
  state: StreakState;
  status: DayStatus;                       // what to write to streak_ledger.status
  note: string | null;                     // machine-readable, e.g. 'cover_cap' — never user copy
  decayedFrom: number | null; restoredTo: number | null;   // drive copy C3 / C5
}
export interface WeekCloseStep {
  state: StreakState; met: boolean; trainedDays: number; weeklyBefore: number; weeklyAfter: number;
}
export interface StreakLimits { freezeBudget: number; gracePerWeek: number; weeklyTarget: number }

/** Idempotent per day: a second call with the same cls.day returns the state unchanged. */
export function applyDay(state: StreakState, cls: DayClass, limits: StreakLimits): StreakStep;
/** Called once the ISO week's Sunday has been applied. */
export function applyWeekClose(state: StreakState, week: IsoWeekKey, trainedDays: number,
  limits: StreakLimits): WeekCloseStep;
/** Rebuilds state from the whole ledger — streak_state is a cache, not the truth (Behaviour §9).
 *  Each row carries the limits that were in force on that day (streak_ledger columns, Data req. 11),
 *  so a later settings change cannot rewrite history. `longest*` are floored at `persisted`. */
export function foldLedger(rows: { day: LocalDay; status: DayStatus; limits: StreakLimits }[],
  persisted: { longestDays: number; longestWeeks: number }): StreakState;
/** `freezesRemaining` starts at the budget, so the initial state depends on settings (§10). */
export function initialStreakState(limits: StreakLimits): StreakState;
/** The provisional number the chip shows for a day the rollup has not closed yet (§9a). Pure. */
export function projectToday(state: StreakState, today: LocalDay,
  todayEarned: boolean): { currentDays: number; provisional: boolean };
/** The exact `streak_ledger.reason` string (§9a). Segments joined by `|`, empties dropped. */
export function formatLedgerReason(cls: DayClass, step: StreakStep): string;
```

```ts
// src/lib/gamification/adherence.ts
export interface AdherenceResult {
  windowDays: number;              // = min(requested, historyDays) — the window actually assessed
  knownDays: number;               // ledger rows present in that window; ≤ windowDays
  completedSessions: number; plannedSessions: number;
  ratio: number | null;            // null while warming up; may exceed 1 — deliberately not clamped
  warmingUp: boolean;
}
export function adherence(args: {
  requestedWindowDays: number;     // 7 | 28 | 84
  statuses: { day: LocalDay; status: DayStatus }[];  // ascending, deduped by day, MAY BE SPARSE
  plannedSessions: number | null;  // specs/09 program calendar for the window; null → weeklyTarget
  weeklyTarget: number;
  historyDays: number;             // days since the first ever logged day, inclusive
}): AdherenceResult;
```

```ts
// src/lib/gamification/xp.ts — source_kind values are the XP_SOURCES tuple in src/db/enums.ts
export type XpSourceKind = 'workout' | 'set' | 'checkin' | 'pr' | 'quest' | 'streak_day'
  | 'achievement' | 'nutrition_day' | 'food_photo' | 'body' | 'photo' | 'gym_checkin'
  | 'week_target' | 'week_review';        // the last 7 are REQUESTED additions — see Data
export interface XpEvent {
  sourceKind: XpSourceKind;
  sourceId: string;                // (sourceKind, sourceId) is UNIQUE in xp_ledger — the replay guard
  xp: number;                      // integer > 0. NEVER negative — CHECK-enforced.
  day: LocalDay; reason: string | null;
}
/** ONLY the flat kinds. The other five are computed — see the named functions below and §14.
 *  `set` is deliberately absent: it is a legacy member of specs/02's XP_SOURCES tuple and this
 *  module NEVER writes it (§14). A `Record<XpSourceKind, number>` would force values §14 does
 *  not define, so the flat table is keyed by the flat kinds only. */
export type XpFlatKind = 'checkin' | 'nutrition_day' | 'food_photo' | 'gym_checkin' | 'body'
  | 'photo' | 'week_target' | 'week_review';
export const XP_FLAT: Readonly<Record<XpFlatKind, number>>;        // 10/15/5/5/10/15/120/20
export const XP_SESSION_CAP = 160;                 // max XP one workout row can award
/** Window caps enforced by filterCappedEvents (§14a) — NOT by the UNIQUE index, which cannot
 *  express them. `per: '7d'` means the trailing 7 local days inclusive of `event.day`. */
export const XP_WINDOW_CAPS: Readonly<Record<'food_photo' | 'body' | 'photo',
  { per: 'day' | '7d'; max: number }>;             // food_photo {day,3}; body {7d,1}; photo {7d,1}
export const STREAK_MILESTONES: readonly number[]; // [7,14,30,60,100,200,365]

export function workoutXp(a: { hardSets: number; volumeKg: number }): number;   // capped at 160
export function prXp(kind: 'e1rm' | 'max_weight' | 'max_reps' | 'session_volume'): number;
export function milestoneXp(milestoneIndex: number): number;       // 25 × (index + 1)
export function questXp(key: QuestKey): number;   // QUEST_POOL[key].xp, 40..100 (imports quests.ts)
/** Cumulative XP to REACH level L. xpToReach(1) === 0. The authoritative definition.
 *  Defined above the cap too: xpToReach(L > MAX_LEVEL) === xpToReach(MAX_LEVEL). */
export function xpToReach(level: number): number;
/** Exact inverse: closed-form seed + ±1 integer correction. See Behaviour §14. */
export function levelOf(totalXp: number): number;
/** At MAX_LEVEL there is no next threshold: returns { into: 0, span: 0, pct: 1 } — never NaN. */
export function levelProgress(totalXp: number):
  { level: number; into: number; span: number; pct: number };      // pct in 0..1
export function collectWorkoutXpEvents(a: { workoutId: string; day: LocalDay; hardSets: number;
  volumeKg: number; prs: { id: string; kind: 'e1rm' | 'max_weight' | 'max_reps' |
  'session_volume' }[] }): XpEvent[];                              // kinds are specs/02 PR_KINDS
```

```ts
// src/lib/gamification/achievements/metrics.ts — every field is a legal predicate target (not every
// field is targeted today). Units: kg, pp, days, counts. `null` = not computable yet (never unlocks).
// EVERY field's source table, aggregate and window is pinned in Behaviour §16a. A field with no row
// in that table may not be added here.
export interface MetricSnapshot {
  workoutsTotal: number; setsTotal: number; hardSetsTotal: number; distinctExercisesTotal: number;
  volumeTotalKg: number; volumeBestSessionKg: number;
  prCountTotal: number; prCountSingleSession: number;
  checkinsTotal: number; gymCheckinsTotal: number; deloadWeeksCompleted: number;
  dailyStreakLongest: number; weeklyStreakLongest: number; weeksTargetMetTotal: number;
  longestGapReturnedFromDays: number; questsCompletedTotal: number;
  adherence28d: number | null;                     // ratio 0..n, NOT a percentage (§12)
  relativeStrengthBench: number | null;            // best e1RM kg ÷ EMA trend bodyweight kg
  relativeStrengthSquat: number | null; relativeStrengthDeadlift: number | null;
  bigThreeTotalKg: number | null;                  // null unless all three main lifts are mapped
  nutritionLoggedStreakLongest: number; nutritionDaysLoggedTotal: number;
  proteinTargetHitDays: number; waterDaysLoggedTotal: number; foodPhotosConfirmedTotal: number;
  bodyMeasurementsTotal: number; progressPhotoCount: number; photoMonthsSpanned: number;
  bodyFatDeltaPp: number | null;                   // percentage points, negative = leaner
  bodyweightGoalDeltaKg: number | null;            // kg remaining, ≤ 0 = reached
}
export type MetricKey = keyof MetricSnapshot;
/** Which of the four named-lift metrics are unresolvable because settings has no exercise mapped
 *  (§16a, Data req. 9). The grid renders these as "needs setup", never as locked. */
export interface MetricGaps { unmappedLifts: readonly ('bench' | 'squat' | 'deadlift')[] }
```

```ts
// src/lib/gamification/achievements/{catalogue,evaluate}.ts
export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type Category = 'first' | 'volume' | 'consistency' | 'strength' | 'nutrition' | 'body';
export interface AchievementDef {
  key: string;                     // stable forever — achievement_unlocks.achievement_key
  category: Category; tier: Tier;
  metric: MetricKey; op: 'gte' | 'lte'; threshold: number;
  icon: string;                    // lucide-react icon name; convention in §16
  sort: number; active: boolean;   // false = retired; existing unlocks are still shown
}
export const CATALOGUE: readonly AchievementDef[];    // 39 definitions, Behaviour §16
export const CATALOGUE_VERSION: number;               // bump ⇒ ONE retroactive sweep run (§17)
export const TIER_XP: Readonly<Record<Tier, number>>; // bronze 50, silver 150, gold 400, platinum 1000
/** The generated hint half of the card copy. Renders `Gamification.achievements.hint.{metric}`
 *  with `{threshold, number}`; the `{name}` half is authored per key (§16). */
export function achievementHint(def: AchievementDef,
  t: (key: string, values?: Record<string, unknown>) => string): string;

export interface UnlockCandidate {
  key: string; progress: number;                      // → achievement_unlocks.progress
  evidence: { metric: MetricKey; value: number; threshold: number };
}
/** Pure. A null/undefined metric NEVER throws and NEVER unlocks. */
export function evaluateCatalogue(snapshot: Partial<MetricSnapshot>,
  alreadyUnlocked: ReadonlySet<string>): UnlockCandidate[];
```

```ts
// src/lib/gamification/quests.ts — the pool, the deterministic pick and the predicates (§18)
export type QuestKey = 'sessions_on_plan' | 'three_sessions' | 'checkin_5_days' | 'pr_attempt'
  | 'hard_sets_60' | 'volume_up_5pct' | 'protein_5_days' | 'nutrition_6_days' | 'steps_5_days'
  | 'photo_this_week' | 'two_leg_days' | 'measure_this_week';
export type QuestMetric = 'trainedDays' | 'checkinDays' | 'prCount' | 'hardSets' | 'volumeKg'
  | 'proteinDays' | 'nutritionDays' | 'stepDays' | 'photoCount' | 'legDays' | 'measurementCount';
export interface QuestDef {
  key: QuestKey; goals: readonly PrimaryGoal[]; metric: QuestMetric; xp: number;   // 40..100
  /** Pure; `target_value` is frozen into the `quests` row at week open and never recomputed. */
  target(ctx: QuestContext): number | null;          // null ⇒ ineligible this week
}
export interface QuestContext { weeklyTarget: number; prevWeekVolumeKg: number }
export const QUEST_POOL: Readonly<Record<QuestKey, QuestDef>>;   // the 12 rows of §18
/** Deterministic: eligible keys sorted by fnv1a32(`${weekStartDay}|${key}`) asc, key asc as the
 *  tie-break, first QUEST_COUNT_PER_WEEK taken. Same week ⇒ same three, forever. */
export function selectQuests(weekStartDay: LocalDay, goal: PrimaryGoal,
  ctx: QuestContext): readonly { key: QuestKey; targetValue: number; xp: number }[];
export function questComplete(progressValue: number, targetValue: number): boolean;  // ≥
```

```ts
// src/lib/gamification/geofence.ts — client only; the raw position must not cross the network
export type DistanceBucket = 'at' | 'near' | 'far' | 'unknown';
export type AccuracyBucket = 'fine' | 'coarse' | 'poor' | 'unknown';
export function haversineMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number;
export function bucketDistance(metres: number, radiusM: number): DistanceBucket;  // ≤r 'at', ≤3r 'near'
export function bucketAccuracy(accuracyM: number): AccuracyBucket;                // ≤25 fine, ≤100 coarse
```

```ts
// src/server/gamification/{rollup,xp-writer,gym-checkin}.ts
import type { DB } from '@/server/db';                  // specs/01 owns this accessor (r02 §2.2)
type SqliteBatchItem = Parameters<DB['batch']>[0][number];

/** THE WRITE PATH (§9a). Pure builder, no reads, so it fits inside another spec's batch — this is
 *  the `streak_ledger` upsert named in `specs/02` rule 20's finish-workout batch. It writes the
 *  ledger row for `cls.day` ONLY; it never touches `streak_state`, which is the nightly job's. */
export function buildDayLedgerStatement(db: DB, cls: DayClass, limits: StreakLimits): SqliteBatchItem;
/** Read-only classification of any day, today included. Never writes. Used by the chip, the
 *  snapshot route and shouldNudgeAtRisk, which must not mutate state at 20:30. */
export function classifyToday(db: DB, day: LocalDay): Promise<DayClass>;
/** Nightly only: classify + upsert the ledger row + advance streak_state. Correcting: it overwrites
 *  whatever the write path put there provisionally (upsert-by-day, latest wins). */
export function classifyAndUpsertDay(db: DB, day: LocalDay): Promise<DayClass>;
/** Self-healing: every unprocessed day from `firstActivityDay` up to throughDay, oldest first,
 *  ≤ BACKFILL_MAX_DAYS. Returns `daysProcessed: []` when there is no activity at all (§21). */
export function rollDays(db: DB, throughDay: LocalDay): Promise<{ daysProcessed: LocalDay[];
  weeksClosed: IsoWeekKey[]; steps: StreakStep[]; truncated: boolean;
  oldestUnprocessedDay: LocalDay | null }>;         // non-null ⇒ the next run resumes there
/** Numbers only. Frequency, channel and dedupe are `specs/14` §19 — this never reads
 *  notification_log and states no send policy of its own. */
export function shouldNudgeAtRisk(db: DB, today: LocalDay):
  Promise<{ nudge: false } | { nudge: true; currentDays: number; graceLeft: number; freezesLeft: number }>;

/** Applies XP_WINDOW_CAPS by counting existing xp_ledger rows. MUST run before
 *  buildXpStatements — the UNIQUE index cannot express a per-day or per-7-day cap (§14a). */
export function filterCappedEvents(db: DB, events: readonly XpEvent[]): Promise<XpEvent[]>;
/** Batch items for the CALLER's db.batch(). D1 has no interactive transactions — r02 §2.8/§4.6.
 *  MAY RETURN `[]`; the caller must then skip db.batch() entirely — an empty batch throws
 *  (r02 §4.8, `specs/02` rule 20). */
export function buildXpStatements(db: DB, events: readonly XpEvent[]): SqliteBatchItem[];
export function readXpTotal(db: DB): Promise<number>;   // SUM(xp); level is always derived

/** One snapshot for the whole catalogue. ≤ 14 read statements per call (§16a). */
export function buildMetricSnapshot(db: DB, today: LocalDay):
  Promise<{ snapshot: MetricSnapshot; gaps: MetricGaps }>;
export function sweepAchievements(db: DB, today: LocalDay):
  Promise<{ unlocked: UnlockCandidate[]; retroactive: boolean }>;   // §17

export const GymCheckInInput = z.object({
  withinGeofence: z.boolean().nullable(),
  distanceBucket: z.enum(['at', 'near', 'far', 'unknown']),
  accuracyBucket: z.enum(['fine', 'coarse', 'poor', 'unknown']),
  method: z.enum(['geo', 'manual']),
}).strict();                                            // .strict() IS the privacy guard
export function recordGymCheckIn(db: DB, day: LocalDay,
  input: z.infer<typeof GymCheckInInput>): Promise<void>;
```

```ts
// src/server/gamification/review.ts — payloads are stored as JSON; specs/02 CHECKs len ≤ 65 536
export interface WeeklyReviewPayload {
  week: IsoWeekKey; sessions: number; targetSessions: number;
  adherence7d: number | null; adherence28d: number | null;
  volumeKg: number; volumeDeltaFracVsPrev: number | null;        // FRACTION: 0.1 = +10 %
  hardSetsByMuscle: { role: string; sets: number; underTrained: boolean }[];
  e1rmMovers: { exerciseId: string; deltaKg: number }[];         // top 3 by |deltaKg|
  kcalMean: number | null; kcalTarget: number | null;            // kcal
  proteinMeanG: number | null; proteinTargetG: number | null;    // grams
  trendKgDelta: number | null; readinessMean: number | null;     // kg (EMA, r09 §4); 0..10
  xpEarned: number; levelBefore: number; levelAfter: number;
  achievementKeys: string[]; questKeys: string[];
  coveredDays: { day: LocalDay; status: 'grace' | 'freeze' }[]; missedDays: LocalDay[];
}
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Axis = 'consistency' | 'volume' | 'strength' | 'nutrition' | 'recovery';
/** Fixed key set — an implementer may not add, drop or rename one. Deltas are (this − prev);
 *  every `*Frac` is a FRACTION of the previous month (0.1 = +10 %), never a percentage. */
export interface MonthlyDeltas {
  sessions: number | null; volumeFrac: number | null; meanE1rmFrac: number | null;
  adherenceRatio: number | null;                                 // ratio points, e.g. +0.08
  trendWeightKg: number | null; bodyFatPp: number | null;
  meanKcal: number | null; meanProteinG: number | null; meanReadiness: number | null;
}
export interface MonthlyReportCard {
  month: string;                                                 // 'YYYY-MM'
  axes: { axis: Axis; score0to100: number | null; grade: Grade | null; basis: string }[];
  overall: Grade | null;
  deltasVsPrevMonth: MonthlyDeltas;
  prIds: string[];
  photoPair: { firstKey: string; lastKey: string } | null;        // photos.r2_key, never blobs
}
export interface YearInReviewPayload {
  year: number;
  cards: { id: YearCardId; value: number | string; unit: string | null;
    caption: string | null }[];                                  // caption = §28's comparison line
}
export type YearCardId = 'sessions' | 'tonnage' | 'top_movement' | 'best_e1rm_jump'
  | 'longest_streak' | 'weeks_on_plan' | 'food_photos' | 'trend_weight' | 'best_session';
export function buildWeeklyReview(db: DB, week: IsoWeekKey): Promise<WeeklyReviewPayload>;
export function buildMonthlyReportCard(db: DB, month: string): Promise<MonthlyReportCard>;
export function buildYearInReview(db: DB, year: number): Promise<YearInReviewPayload>;
/** The builders are pure-ish readers; these three are the ONLY writers of the three report tables
 *  (Data req. 3–5). The cron calls build* then persist*; a regenerate overwrites by PK. */
export function persistWeeklyReview(db: DB, p: WeeklyReviewPayload): Promise<void>;
export function persistMonthlyReportCard(db: DB, p: MonthlyReportCard): Promise<void>;
export function persistYearInReview(db: DB, p: YearInReviewPayload): Promise<void>;
```

## Behaviour

1. **Day boundary.** Every day is an Almaty local calendar day keyed `'YYYY-MM-DD'` by
   `toLocalDay()` (`src/db/local-day.ts`, owned by `specs/02`), computed **at write time** and stored
   in the source row's `local_day` — never derived from a UTC timestamp in SQL, and never from runtime
   `Intl` for a stored value. `r09 §8` calls the UTC/Almaty off-by-one *"the highest-risk bug in the
   analytics module"* and names the failure: a set at `2026-09-07 00:30` local is `2026-09-06T19:30Z`,
   so UTC grouping drops a whole session out of the day. Almaty is UTC+5 year-round, no DST since
   2024-03-01.
2. **"Trained"** = a finished workout (`workouts.ended_at IS NOT NULL`) with ≥ 1 counted set.
   `COUNTED_SET_TYPES = working | drop | failure | amrap`. This **extends** `r09 §8`, which predates
   `specs/02`'s `SET_TYPES` and omits `amrap`: an AMRAP set is taken to or near failure and is working
   stimulus by the same argument `r09` uses to include drop sets. **Decision: the streak does not use
   hard sets.** `isHardSet` depends on `rir ≤ 4`, `rir` is optional input, and `r09 §8` leaves the
   null-RIR case undecided — gating a streak on optional metadata silently costs days to a user who
   skips RPE. Volume and the muscle heatmap still use hard sets.
3. **Status `active` vs `rest`.** `active` = trained. `rest` = not trained but *earned*: a complete
   check-in (`daily_checkins` with `sleep_quality`, `mood` and `energy` all non-null — a deliberate
   entry, not a partial autosave) or a goal touch. Both extend the daily streak. A `rest` day counts on
   any day, scheduled or not: requiring a program to earn a rest day would punish a user without one.

   | `primary_goal` | Extra touch that earns a `rest` day |
   |---|---|
   | `strength`, `muscle` | none — training and check-ins are the whole surface |
   | `fat_loss`, `recomp` | `nutritionComplete` = ≥ 1 **confirmed** `food_entries` row (`confirmed_at IS NOT NULL`) **and** `kcalLogged ≥ REST_DAY_KCAL_FRACTION × kcalTarget` (blocks "logged an apple at 09:00") |
   | `health` | `steps ≥ REST_DAY_STEPS`, or `nutritionComplete` |

   `kcalTarget` and `proteinTargetG` come from the active `goals` row with `kind='kcal'` / `'protein'`
   (`starts_on ≤ day` and `ends_on IS NULL OR ends_on ≥ day`); with no such row the target is `null`
   and the nutrition branch cannot earn the day (it is not treated as met).
   **Confirmation is load-bearing.** `kcalLogged`, `proteinLoggedG` and every nutrition metric and
   nutrition XP row in this module count only `food_entries` with `confirmed_at IS NOT NULL`. An AI
   estimate the user has not accepted is a guess; since §14 has no revoke path, letting a guess unlock
   `protein_20` or award `nutrition_day` XP would make an unretractable claim out of an unreviewed
   number. This also re-aims `food_photo` XP at the act that has value — closing the correction loop,
   not taking the picture.

   A body measurement or progress photo alone earns XP but **not** a `rest` day — a two-minute act is
   not a day of effort. The honesty objection (a check-in-only week carrying a long daily streak) is
   answered structurally: the **weekly** streak counts sessions and adherence % is the headline. The
   daily streak's job is showing up.
4. **Two cover mechanisms, per `specs/02` and the brief's `freeze_count, grace_used`.**
   *Grace* — `settings.streak_grace_per_week` (default 1) per ISO week, use-it-or-lose-it, reset to 0
   used at week close. *Freeze* — `settings.streak_freeze_budget` (default 2) standing budget in
   `streak_state.freezes_remaining`, replenished `+1` at each met week, capped at the budget.
5. **Spend order and cap.** On an unearned day, in order: **grace first** (it expires anyway) → then
   **freeze** → else `missed`. A covered day **holds** the streak (does not increment — nothing was
   done, so nothing is earned). `COVER_MAX_CONSECUTIVE = 2`: no third consecutive covered day even
   with budget left, so a five-day absence stays visible in the ledger and in adherence % instead of
   being papered over. **Decision: spent silently by the nightly job, disclosed afterwards** (toast C2
   on next open + a line in the weekly review). A 23:00 "spend a pass?" prompt is a decision the user
   can fail, and failing it at midnight is exactly the lapse-to-relapse path this module exists to
   block.
6. **Softening rule — decay, never reset.** On a `missed` day **when `currentDays ≥ 1`**:
   `currentDays := max(STREAK_FLOOR, floor(currentDays × STREAK_DECAY))`. When `currentDays === 0` the
   decay is a **no-op** — the status is still `missed`, the state is returned unchanged, and
   `decayedFrom` is `null`. Without that guard `max(1, floor(0 × 0.5)) = 1` would hand a streak of 1 to
   a user who has never logged anything (§21's cold-start floor is the other half of the fix).
   Each further `missed` day halves again; from 47
   the ladder is `47 → 23 → 11 → 5 → 2 → 1 → 1 → …` and **1 is absorbing**. `longestDays` is never
   touched; `preDecayPeak` records the pre-decay value. No code path anywhere assigns
   `currentDays = 0` once it has been ≥ 1. The user-facing sentence is copy C7:
   **RU** «Пропуск не обнуляет серию — она уменьшается вдвое и никогда не падает ниже 1.»
   **EN** "A missed day never wipes your streak — it halves, and it never drops below 1."
7. **Comeback restore.** If the last `missed` day was `D`, the user earns day `D+1`, and the last
   restore was ≥ 7 days ago: set `currentDays := preDecayPeak`, **then** extend by 1 — an immediate
   return costs nothing. This is the direct counter to the abstinence-violation effect: the lapse is
   repairable by action, today. Only the most recent decay, only on the very next day.
8. **Dormancy.** After 14 consecutive unearned days `dormant := true`: the streak displays as "paused
   at N" and the at-risk nudge stops (spec 14 switches to an at-most-weekly copy C6). Any earned day
   clears it.
9. **`streak_ledger` is the truth; `streak_state` is a cache.** `applyDay` is pure and deterministic,
   so `foldLedger` rebuilds `streak_state` from the full ledger at any time. The ledger is
   **upsert-by-day** — `local_day` is UNIQUE (`specs/02`), so a replay *overwrites* the day rather than
   appending a second row. It is therefore a day ledger, **not an audit log**, and this spec makes no
   append-only claim about it. What makes a wrong decay diagnosable is instead: `applied_at` (when this
   row was last written), `reason` (the full `DayClass.reason | decay:before->after | note` string,
   format in §9a), and the three limits columns (Data req. 11) recording the settings in force that
   day — enough to re-derive the decision without trusting the cache. Only `xp_ledger` is append-only.
   A settings change or a corrected backdated workout triggers a replay rather than an in-place patch;
   `recomputed_at` records the last fold.

   **History is preserved, not re-interpreted.** `foldLedger` replays each day under *that day's*
   limits, read from the row, never under today's settings — otherwise raising
   `weekly_target_sessions` would retroactively un-meet closed weeks, change freeze accrual and lower
   `longestDays`. As a second belt: the fold's `longestDays`/`longestWeeks` are floored at the
   persisted values (`longest := max(persisted, folded)`), which is what makes
   "`longestDays` is monotonic" true by construction rather than by hope.

9a. **Who writes what, and when today's day is classified.** This is the boundary `specs/02` rule 20
   depends on, so it is stated as a table and nothing else may deviate from it.

   | Writer | Writes | Never writes |
   |---|---|---|
   | Finish-workout batch (`specs/06`), via `buildDayLedgerStatement` | today's `streak_ledger` row, `status='active'`, `reason='trained'`, `workout_id`, the three limits columns | `streak_state`, `current_days`, any other day |
   | Any other earning write (check-in, confirmed nutrition day, steps sync), same builder | today's `streak_ledger` row as `'rest'` **only if no row for today already says `'active'`** | as above |
   | `nightly-rollup` → `classifyAndUpsertDay` + `applyDay` | every day's ledger row (re-deriving and correcting the provisional one) **and** `streak_state` | — |

   `buildDayLedgerStatement` is the `streak_ledger` upsert item named in `specs/02` rule 20's
   finish-workout batch. It is **synchronous and pure** because it must live inside a batch: it reads
   nothing, decides nothing about grace/freeze/decay (a day with a finished workout is `active` by
   definition — no cover mechanism can apply to it) and touches no aggregate state. `ON CONFLICT
   (local_day) DO UPDATE` with a guard that never demotes `'active'` to `'rest'`.

   **Today's number** is therefore a projection, not a stored value: `projectToday(state, today,
   todayEarned)` returns `state.currentDays + 1` with `provisional: true` when `state.lastProcessedDay
   < today` and today's ledger row is `active`/`rest`, and `state.currentDays` otherwise. Everything
   user-visible goes through it — the chip after a finished workout, §17's in-session milestone
   confetti, §23's "the day is not yet earned" test (which uses `classifyToday`, a read-only path), and
   the e2e DoD. Grace, freeze and decay are **never** projected: they are yesterday-and-earlier
   decisions the rollup owns, which is also why the client cannot compute them (§29). The
   `streak_day` milestone **XP row** is still written by the rollup, not the write path;
   `U(source_kind, source_id)` makes the celebration-now/award-tonight split safe.

   `reason` format, pinned so the Verification `LIKE` patterns are checkable:
   `formatLedgerReason` joins the non-empty segments of
   `[cls.reason, decayedFrom === null ? '' : \`decay:${decayedFrom}->${after}\`, step.note ?? '']`
   with `'|'` and no spaces. The canonical 2026-09-07 row is exactly `none|decay:5->2|cover_cap`.
10. **Canonical ledger vector** — `weekly_target_sessions = 4`, `streak_grace_per_week = 1`,
    `streak_freeze_budget = 2`, starting `freezes_remaining = 2`. Fixture for `streak.test.ts`.

    | day | facts | status | current | longest | grace used | freezes | weekly | note |
    |---|---|---|---|---|---|---|---|---|
    | 2026-08-31 Mon | trained | active | 1 | 1 | 0 | 2 | 0 | extend |
    | 2026-09-01 Tue | trained | active | 2 | 2 | 0 | 2 | 0 | extend |
    | 2026-09-02 Wed | trained | active | 3 | 3 | 0 | 2 | 0 | extend |
    | 2026-09-03 Thu | check-in | **rest** | 4 | 4 | 0 | 2 | 0 | extend |
    | 2026-09-04 Fri | trained | active | 5 | 5 | 0 | 2 | 0 | extend |
    | 2026-09-05 Sat | none | **grace** | 5 | 5 | 1 | 2 | 0 | hold |
    | 2026-09-06 Sun | none | **freeze** | 5 | 5 | 0 | 2 | 1 | hold; grace exhausted → freeze (2→1); week `2026-W36` 4/4 **met** → weekly 1, freezes 1→2, grace reset |
    | 2026-09-07 Mon | none | **missed** | **2** | 5 | 0 | 2 | 1 | decay 5→2, `note='cover_cap'` (budget remained, but 2 consecutive covered days already used) |
    | 2026-09-08 Tue | trained | active | **6** | 6 | 0 | 2 | 1 | restore 2→5, then extend |
    | 2026-09-09…11 | trained ×3 | active | 7, 8, 9 | 9 | 0 | 2 | 1 | extend ×3 |
    | 2026-09-12 Sat | none | grace | 9 | 9 | 1 | 2 | 1 | hold |
    | 2026-09-13 Sun | none | freeze | 9 | 9 | 0 | 2 | 2 | hold (2→1); week `2026-W37` 4/4 met → weekly 2, freezes 1→2, grace reset |
    | 2026-09-14 Mon | none | missed | **4** | 9 | 0 | 2 | 2 | decay 9→4, `note='cover_cap'` |
    | 2026-09-15 Tue | trained | active | **10** | 10 | 0 | 2 | 2 | restore 4→9, then extend (cooldown boundary: last restore 09-08, exactly 7 days) |

    Rows 6–7 and 13–14 matter: the daily streak decays in the same week the **weekly** streak
    advances. That is the system working — the honest metric says the week was fine.
11. **Weekly streak.** ISO-8601 week (Mon–Sun) in Almaty, key `'YYYY-Www'` (`2026-08-31` → `2026-W36`;
    `2026-09-07` → `2026-W37`). **Met** iff `trainedDays ≥ weeklyTarget`, where `weeklyTarget` is
    `settings.weekly_target_sessions` (default 4, clamped 2..7) unless an active `goals` row with
    `kind='sessions_per_week'` covers the week, which then wins. Sessions-per-week is the metric that
    actually predicts lifting outcomes, so it is what the weekly streak tracks — not minutes, not
    tonnage. Met → `currentWeeks += 1`, `+1` freeze. Missed → `currentWeeks := max(0,
    floor(currentWeeks × 0.5))`; the weekly counter **may** reach 0, because a week of zero training is
    not a lapse repairable by tonight and a weekly counter stuck at 1 would be a lie. Grace/freeze are
    never spent on weeks — weeks are where freezes come from. The in-progress week is never evaluated;
    closure happens in the rollup that processes its Sunday.
12. **Adherence %.** The window is **pro-rated, never assumed full**: `windowDays = min(
    requestedWindowDays, historyDays)` and `knownDays` = ledger rows actually present in it.
    `plannedSessions` = spec 09's scheduled count in the window scaled by `knownDays / windowDays` when
    a program is active, else `round(weeklyTarget × knownDays / 7)`. `completedSessions` = days with
    status `active` among those rows, **one per day maximum** (the denominator is days-shaped, and
    `body_measurements` is explicitly non-unique per day while sessions are counted per day). `ratio =
    completed / planned`, not clamped, so five sessions in a four-session week reads 125 %; `planned
    === 0` ⇒ `ratio = null`, never a division. Windows: 7 d, **28 d (primary, cached in
    `streak_state.adherence_pct`)**, 84 d.

    Two consequences the array contract must allow, and the reason `statuses` is documented as *sparse*
    rather than *contiguous*: a user with 14–27 days of history has no 28 days to read, and §21's
    `truncated` path leaves an older hole until a later run walks back into it. Missing days are simply
    **not in the window's numerator or denominator** — they are unknown, not missed. An unknown day is
    never charged to the user, which is the same principle as the warm-up rule.

    While `historyDays < ADHERENCE_WARMUP_DAYS (14)`, `ratio` is `null` and the UI renders `—` labelled
    «собираем базу» / "building baseline" — **never 0 %**, which is a false accusation on day 2. Worked
    vector: 28 days of history, all 28 rows present, target 4/wk → `planned = 16`; 11 `active` days →
    `0.6875` → `69 %`. Partial vector: 20 days of history, 20 rows, target 4 → `planned = round(4 ×
    20/7) = 11`; 8 `active` → `0.7273`.

    **Unit, once, because the column name lies.** `streak_state.adherence_pct` stores the **ratio**
    (`0.6875`), not a percentage (`69`), matching `AdherenceResult.ratio` and
    `MetricSnapshot.adherence28d`; only the render layer multiplies by 100. Reading it as a percentage
    would unlock `adherence_90` (`≥ 0.9`) on day one and draw a 6900 % ring. A rename to
    `adherence_ratio` is requested of `specs/02` (Data req. 12); until it lands, the name is wrong and
    the contract is this sentence, asserted by a round-trip unit case.
13. **Adherence is primary; the streak is ornament.** Its denominator is one the user chose, one
    mis-bucketed day moves it by 1/16 rather than to zero, it cannot be satisfied by a check-in, and it
    is what the reviews grade. The dashboard renders the adherence ring large and the streak chip
    small, and every surface showing a streak must show adherence in the same viewport.
14. **XP and the level curve.** `xp_ledger` has `U(source_kind, source_id)` — award-once. XP is
    integer and always positive; there is no delete path, no negative path and no
    recompute-from-scratch path, so deleting the workout that earned XP, correcting an AI food estimate
    downward, or retiring an achievement all leave the XP and the unlock intact. Total is `SUM(xp)` and
    level is always derived, never stored.

    | `source_kind` | `source_id` | XP | where the number lives |
    |---|---|---|---|
    | `workout` | `{workoutId}` | `50 + 2 × hardSets + 5 × floor(volumeKg/1000)`, capped at `XP_SESSION_CAP = 160` — one row per session | `workoutXp()` |
    | `pr` | `{personal_records.id}` | 100 for `e1rm`, 60 for `max_weight`/`max_reps`, 40 for `session_volume` | `prXp(kind)` |
    | `checkin` | `{local_day}` | 10 | `XP_FLAT` |
    | `nutrition_day` | `{local_day}` | 15 — requires ≥ 1 **confirmed** entry that day (§3) | `XP_FLAT` |
    | `food_photo` | `{food_entries.id}` | 5, max 3/day, **only once `confirmed_at` is set** | `XP_FLAT` + `XP_WINDOW_CAPS` |
    | `body` | `{local_day}` | 10, max 1/7 d | `XP_FLAT` + `XP_WINDOW_CAPS` |
    | `photo` | `{local_day}` | 15, max 1/7 d | `XP_FLAT` + `XP_WINDOW_CAPS` |
    | `gym_checkin` | `{local_day}` | 5 | `XP_FLAT` |
    | `week_target` | `{isoWeek}` | 120 | `XP_FLAT` |
    | `week_review` | `{isoWeek}` | 20, on answering the reflection | `XP_FLAT` |
    | `quest` | `{week_start_day}:{key}` | `QUEST_POOL[key].xp`, 40–100 (§18) | `questXp(key)` |
    | `streak_day` | `{milestone}` | `25 × (index+1)` at 7/14/30/60/100/200/365 | `milestoneXp(i)` |
    | `achievement` | `{achievement_key}` | `TIER_XP[tier]` = 50/150/400/1000 | `TIER_XP` |
    | `set` | — | **none. Retired.** | — |

    `set` survives only as a member of `specs/02`'s already-shipped `XP_SOURCES` tuple; **no code path
    in this module or any other ever writes a `set` row**, because per-set XP makes a 30-set session
    worth more than a well-executed 12-set one and double-counts what `workout` already pays for. That
    is why there is no `Record<XpSourceKind, number>`: five kinds are functions of their input and one
    has no value at all, so a total record would force an invented number. `XP_FLAT` covers exactly the
    eight flat kinds; the rest are the named functions above.

14a. **Cap enforcement is a separate, async step.** `U(source_kind, source_id)` cannot express any of
    the three caps — `food_photo` is keyed on `food_entries.id`, so ten photos in a day are ten distinct
    keys, and `body`/`photo` are keyed on `{local_day}`, which is once-per-day, never once-per-week.
    `buildXpStatements` stays synchronous (it must fit inside someone else's batch), so the counting
    lives in `filterCappedEvents(db, events)`, which **every caller runs first**:

    - `food_photo`: `select count(*) from xp_ledger where source_kind='food_photo' and local_day = ?`;
      admit events while `count + admitted < XP_WINDOW_CAPS.food_photo.max (3)`.
    - `body` / `photo`: `select count(*) from xp_ledger where source_kind = ? and local_day > date(?, '-7 day')`
      — evaluated in JS against stored `local_day` strings, not SQL date math (§1), i.e. `local_day >=
      minusDays(event.day, 6)`; admit while the count is `< 1`.

    Both are one statement per capped kind present in the batch (≤ 3), and the counts are read before
    the writes are built — a race is impossible for a single user with a serialised outbox, and the
    worst case if one occurred is one extra 5-XP row, never a negative or a duplicate.

    `xpToReach(L) = ceil(90 × (L−1)^1.8)` for `L ≥ 2`, `xpToReach(1) = 0`, capped at `MAX_LEVEL = 100`.
    **Both cap edges are defined, because level 100 has no next threshold and `into/span` would be
    `0/0 = NaN` straight into the XP-bar width:** `xpToReach(L > MAX_LEVEL) === xpToReach(MAX_LEVEL)`,
    and `levelProgress(totalXp)` at `level === MAX_LEVEL` returns `{ into: 0, span: 0, pct: 1 }` — the
    bar renders full and is labelled «максимум» / "max" instead of a percentage.
    `levelOf` seeds from `floor((xp/90)^(1/1.8)) + 1` then applies a ±1 integer correction against
    `xpToReach`. The correction is **required, not defensive**: at L = 33 the exact threshold is
    `90 × 32^1.8 = 46080`, but `Math.pow(32, 1.8)` returns `512.0000000000001`, so
    `xpToReach(33) = 46081` while the naive inverse reports level 33 for 46080 XP. With it,
    `levelOf(xpToReach(L)) === L` and `levelOf(xpToReach(L) − 1) === L − 1` for every L in 1..100.

    | L | 2 | 3 | 5 | 10 | 20 | 30 | 50 | 75 | 100 |
    |---|---|---|---|---|---|---|---|---|---|
    | `xpToReach` | 90 | 314 | 1 092 | 4 698 | 18 031 | 38 598 | 99 220 | 208 382 | 351 873 |
    | span from L−1 | 90 | 224 | 441 | 897 | 1 672 | 2 363 | 3 615 | 5 041 | 6 371 |

    Spot values: `levelOf(0)=1`, `(89)=1`, `(90)=2`, `(313)=2`, `(314)=3`, `(46080)=32`, `(46081)=33`,
    `(1e9)=100`. Calibration: a 4-session week with check-ins and food logging earns ≈ 670 XP →
    ≈ 34 900 XP/year → **level 28 after one year, 51 after three**. The curve is a formula precisely so
    it can be retuned by changing two constants with no data migration.
15. **Predicates are data, not code.** Each definition is `{metric, op, threshold}` over one
    `MetricSnapshot` field. `evaluateCatalogue` reads `snapshot[def.metric]`; `undefined`/`null`
    returns false and **never throws**, so a definition whose metric is not implemented yet is inert
    rather than fatal. Unlocks are insert-if-not-exists on `achievement_key`, so evaluation is
    idempotent and order-free. The catalogue lives in code, not a table — `specs/02` already decided
    this on `achievement_unlocks`.
16. **The catalogue — 39 definitions**: 5 first-time, 7 volume, 12 consistency, 6 strength,
    5 nutrition, 4 body. The table gives `key`, `tier`, `category`, both names and the predicate; the
    remaining `AchievementDef` fields are **derived by rule**, so there is exactly one place to look
    and no 39-row duplication to keep in sync:

    - `metric` and `threshold` are the predicate's two halves. `op` is `'lte'` for the two `≤` rows
      (`bf_minus_3`, `bw_goal`) and `'gte'` for the other 37 — the operator in the predicate column **is**
      the field, and `achievements.test.ts` asserts the two agree for every row.
    - `sort` = `10 × (1-based row index in this table)`. Ten-step gaps so a later definition can be
      inserted between two without renumbering; the grid orders by `sort`, then `key`.
    - `active` = `true` for all 39. It is only ever set to `false` to retire a definition (§17), never
      authored as `false`.
    - `icon` = one `lucide-react` name **per category**, not per key: `first` → `sparkles`, `volume` →
      `weight`, `consistency` → `flame`, `strength` → `dumbbell`, `nutrition` → `apple`, `body` →
      `ruler`. Tier is carried by the card's frame colour and its label, never by a different glyph —
      39 bespoke icons is 39 chances for an inconsistent set, and a shared glyph makes the category
      legible at grid scale. `AchievementCard` renders `icon` + frame(`tier`) + `name` + `hint`.
    - **Copy.** `name` is authored per key at `Gamification.achievements.{key}.name` (the RU/EN columns
      below are those strings). `hint` is **generated**, not authored: `achievementHint(def)` renders
      `Gamification.achievements.hint.{metric}` with `{threshold, number}` — one message per
      `MetricKey` (28 of them), e.g. `hint.volumeTotalKg` = «Подними {threshold, number} кг за всё
      время» / "Lift {threshold, number} kg in total". 39 hand-written hints would be 39 strings
      restating a number that is already in the definition, in two locales.

    | key | tier | cat | RU name | EN name | predicate |
    |---|---|---|---|---|---|
    | `first_workout` | bronze | first | Первая тренировка | First Session | `workoutsTotal ≥ 1` |
    | `first_pr` | bronze | first | Первый рекорд | First PR | `prCountTotal ≥ 1` |
    | `first_food_photo` | bronze | first | Еда в кадре | Plate on Camera | `foodPhotosConfirmedTotal ≥ 1` |
    | `first_progress_photo` | bronze | first | Точка отсчёта | Baseline | `progressPhotoCount ≥ 1` |
    | `first_full_week` | bronze | first | Первая полная неделя | First Full Week | `weeksTargetMetTotal ≥ 1` |
    | `volume_10t` | bronze | volume | 10 тонн | Ten Tonnes | `volumeTotalKg ≥ 10000` |
    | `volume_100t` | silver | volume | 100 тонн | Hundred Tonnes | `volumeTotalKg ≥ 100000` |
    | `volume_500t` | gold | volume | 500 тонн | Half a Kilotonne | `volumeTotalKg ≥ 500000` |
    | `volume_1000t` | platinum | volume | 1000 тонн | Kilotonne Club | `volumeTotalKg ≥ 1000000` |
    | `session_10t` | silver | volume | 10 тонн за сессию | Ten-Tonne Session | `volumeBestSessionKg ≥ 10000` |
    | `sets_1000` | silver | volume | 1000 подходов | A Thousand Sets | `setsTotal ≥ 1000` |
    | `exercises_50` | bronze | volume | 50 упражнений | Fifty Movements | `distinctExercisesTotal ≥ 50` |
    | `streak_7` | bronze | consistency | Семь дней подряд | Seven in a Row | `dailyStreakLongest ≥ 7` |
    | `streak_30` | silver | consistency | Тридцать дней подряд | Thirty in a Row | `dailyStreakLongest ≥ 30` |
    | `streak_100` | gold | consistency | Сто дней | Century of Days | `dailyStreakLongest ≥ 100` |
    | `streak_365` | platinum | consistency | Год подряд | A Full Year | `dailyStreakLongest ≥ 365` |
    | `weekly_4` | bronze | consistency | Месяц по плану | Four Weeks on Plan | `weeklyStreakLongest ≥ 4` |
    | `weekly_12` | silver | consistency | Квартал по плану | A Quarter on Plan | `weeklyStreakLongest ≥ 12` |
    | `weekly_52` | platinum | consistency | Год по плану | A Year on Plan | `weeklyStreakLongest ≥ 52` |
    | `adherence_90` | gold | consistency | 90 % плана | Ninety Percent | `adherence28d ≥ 0.9` |
    | `comeback_7` | silver | consistency | Возвращение | The Comeback | `longestGapReturnedFromDays ≥ 7` |
    | `deload_done` | bronze | consistency | Разгрузка по плану | Planned Deload | `deloadWeeksCompleted ≥ 1` |
    | `checkins_50` | bronze | consistency | 50 чек-инов | Fifty Check-ins | `checkinsTotal ≥ 50` |
    | `quests_25` | silver | consistency | 25 заданий | Twenty-Five Quests | `questsCompletedTotal ≥ 25` |
    | `bench_bw` | silver | strength | Жим своего веса | Bodyweight Bench | `relativeStrengthBench ≥ 1.0` |
    | `squat_1_5bw` | gold | strength | Присед 1,5 веса | 1.5× Squat | `relativeStrengthSquat ≥ 1.5` |
    | `deadlift_2bw` | gold | strength | Тяга 2 веса | 2× Deadlift | `relativeStrengthDeadlift ≥ 2.0` |
    | `big_three_400` | silver | strength | Сумма 400 кг | 400 kg Total | `bigThreeTotalKg ≥ 400` |
    | `pr_triple` | silver | strength | Три рекорда за сессию | Three PRs, One Session | `prCountSingleSession ≥ 3` |
    | `hard_sets_2000` | gold | strength | 2000 рабочих подходов | Two Thousand Hard Sets | `hardSetsTotal ≥ 2000` |
    | `nutrition_7` | bronze | nutrition | Неделя учёта | A Week of Logging | `nutritionLoggedStreakLongest ≥ 7` |
    | `nutrition_30` | silver | nutrition | Месяц учёта | A Month of Logging | `nutritionLoggedStreakLongest ≥ 30` |
    | `nutrition_200` | gold | nutrition | 200 дней учёта | Two Hundred Logged Days | `nutritionDaysLoggedTotal ≥ 200` |
    | `protein_20` | silver | nutrition | Белок 20 дней | Protein on Point | `proteinTargetHitDays ≥ 20` |
    | `water_14` | bronze | nutrition | Вода: 14 дней | Fourteen Days of Water | `waterDaysLoggedTotal ≥ 14` |
    | `measure_12` | bronze | body | Двенадцать замеров | Twelve Measurements | `bodyMeasurementsTotal ≥ 12` |
    | `photo_6mo` | silver | body | Полгода в кадре | Six Months on Camera | `photoMonthsSpanned ≥ 6` |
    | `bf_minus_3` | gold | body | −3 п. п. жира | Three Points Leaner | `bodyFatDeltaPp ≤ −3` |
    | `bw_goal` | gold | body | Целевой вес | Target Weight | `bodyweightGoalDeltaKg ≤ 0` |

16a. **`buildMetricSnapshot` — every field pinned.** It is the highest-fanout function in the module, so
    it gets the same treatment as adherence: a source, an aggregate and a window per field, and a query
    budget. **Budget: ≤ 14 read statements per call**, one per source-table group below, each an
    aggregate evaluated in SQL (never a row loop); against D1's 1000-statements-per-invocation limit
    (`r02 §2.8`) the nightly sweep therefore costs ~1.4 % of the budget. `today` is the snapshot's
    as-of day: every "total" is lifetime through `today`, every window ends on `today`.

    | field | source | definition |
    |---|---|---|
    | `workoutsTotal` | `workouts` | `count(*) where ended_at is not null` |
    | `setsTotal` | `sets` | `count(*)` over finished workouts, `type ∈ COUNTED_SET_TYPES` |
    | `hardSetsTotal` | `workouts` | `sum(hard_sets)` — the DERIVED column, never recomputed here |
    | `distinctExercisesTotal` | `sets` | `count(distinct exercise_id)` over finished workouts |
    | `volumeTotalKg` | `workouts` | `sum(volume_kg)` |
    | `volumeBestSessionKg` | `workouts` | `max(volume_kg)` |
    | `prCountTotal` | `personal_records` | `count(*)` (all rows, not just `is_current`) |
    | `prCountSingleSession` | `personal_records` | `max(n)` over `count(*) group by local_day` |
    | `checkinsTotal` | `daily_checkins` | `count(*) where sleep_quality, mood, energy all not null` (§3's completeness test, not any row) |
    | `gymCheckinsTotal` | `gym_checkins` | `count(*)` |
    | `deloadWeeksCompleted` | `deload_blocks` | `count(*) where accepted_at is not null and ends_on < today and deleted_at is null` — **accepted *and* ended**; acceptance alone is a plan, not a completed deload |
    | `dailyStreakLongest` | `streak_state` | `longest_days` |
    | `weeklyStreakLongest` | `streak_state` | `longest_weeks` |
    | `weeksTargetMetTotal` | derived in the fold | count of met week closes, maintained by `applyWeekClose` and persisted as a `streak_state` column (Data req. 10) |
    | `longestGapReturnedFromDays` | `streak_ledger` | the longest run of consecutive **non-earned** days (`missed`/`grace`/`freeze`) that is **followed by** an `active`/`rest` day. A gap still open today does not count — `comeback_7` rewards returning, not being away |
    | `questsCompletedTotal` | `quests` | `count(*) where completed_at is not null` |
    | `adherence28d` | `streak_ledger` + `settings`/`goals` | `adherence({requestedWindowDays: 28, …}).ratio` as of `today` (§12); `null` while warming up |
    | `relativeStrength{Bench,Squat,Deadlift}` | `personal_records` + `body_measurements` | `max(e1rm value) for the mapped exercise_id ÷ latest trend_kg`; `null` if the lift is unmapped, has no `e1rm` PR, or there is no `trend_kg` |
    | `bigThreeTotalKg` | `personal_records` | `sum` of the best `max_weight` PR for the three mapped lifts; `null` unless **all three** are mapped and each has a PR — a two-lift sum is not a total |
    | `nutritionDaysLoggedTotal` | `food_entries` | `count(distinct local_day) where confirmed_at is not null` (§3) |
    | `nutritionLoggedStreakLongest` | same | the longest run of consecutive local days in that set |
    | `proteinTargetHitDays` | `food_entries` + `goals(kind='protein')` | `count(distinct local_day)` where the day's confirmed `sum(protein_g) ≥` that day's active target |
    | `waterDaysLoggedTotal` | `water_logs` | `count(distinct local_day) where ml > 0` |
    | `foodPhotosConfirmedTotal` | `food_entries` | `count(*) where photo_id is not null and confirmed_at is not null` |
    | `bodyMeasurementsTotal` | `body_measurements` | `count(*)` (non-unique per day by design) |
    | `progressPhotoCount` | `photos` | `count(*) where kind='progress'` |
    | `photoMonthsSpanned` | `photos` | `count(distinct substr(local_day,1,7))` — **distinct calendar months with at least one photo**, not the first-to-last span, so `photo_6mo` means six months of showing up rather than one photo in January and one in June |
    | `bodyFatDeltaPp` | `body_measurements` | `latest body_fat_pct − first body_fat_pct` over all history (lifetime baseline, both non-null); `null` if fewer than two readings. Negative = leaner, so `bf_minus_3` (`≤ −3`) is "3 points below where you started" |
    | `bodyweightGoalDeltaKg` | `body_measurements` + `goals(kind='bodyweight')` | `signum × (latest trend_kg − target_value)` where `signum` is `+1` when the target is below the starting weight and `−1` when above, so `≤ 0` means "reached" in both directions; `null` with no active goal or no `trend_kg` |

    **Named lifts (`bench` / `squat` / `deadlift`) need an identity no other spec supplies.**
    `exercises.id` is `'fedb:<dataset id>' | 'usr:<ULID>'` (`specs/02`) and nothing in the schema says
    which row is the bench press, so the four strength badges would otherwise be permanently inert
    while `every metric key exists on MetricSnapshot` still passed — a hole that ships silently.
    **Decision:** three nullable `settings` columns (Data req. 9) hold the chosen `exercises.id` per
    lift. `specs/08`'s seeder resolves sensible defaults by exercise **name** at seed time; the exact
    `fedb:` dataset ids are `UNVERIFIED` here (r07 §3 shows ids are name-derived, e.g. `3_4_Sit-Up`,
    but does not list the barbell lifts) and **must never be hardcoded in this module**. When a lift is
    unmapped its metric is `null`, `MetricGaps.unmappedLifts` names it, and the badge renders in a
    third state — **"needs setup" / «нужна настройка»**, tappable to settings — never as locked, which
    would be a lie about why it is dark.

    **Water: the metric is days logged, not days on target.** An earlier draft's `waterTargetHitDays` had
    nothing to compare against — `specs/02` has `water_logs(local_day, logged_at, ml)` and `goals.kind ∈
    bodyweight|kcal|protein|sessions_per_week|e1rm|bodyfat`, i.e. **no water target column and no water
    goal kind** — so the predicate was unimplementable. **Decision: `waterDaysLoggedTotal`**, computable
    from what exists today, rather than a twelfth schema requirement for a bronze badge. A daily water
    target is also the weakest of the intake heuristics (the 2 L figure has no evidentiary base), so a
    badge for hitting one would dress a folk number as a standard; "you logged water on 14 days" claims
    only what happened. `water_14` keeps its key (keys are stable forever) and gets honest copy.

17. **When predicates run, and how retroactive unlocks work.** *Write path* — inside the
    workout-finish `db.batch()` (spec 06), for the subset whose metrics that batch already computed
    (`first`, `volume`, `strength`, streak milestones); those unlocks set
    `achievement_unlocks.source_id = {workoutId}` and fire confetti in-session (milestones off
    `projectToday`, §9a). *Nightly sweep* — the full catalogue against a fresh `MetricSnapshot`,
    covering every window/aggregate metric and catching anything missed.

    **Two kinds of sweep unlock, and only one of them is retroactive.** The full catalogue runs every
    night, so the ordinary case — a window metric crossing its threshold *last night*, e.g.
    `adherence_90` — is a normal unlock and must be celebrated like one. Labelling it "unlocked
    retroactively" and withholding its confetti would be a false statement about the user's own week.

    | case | `source_id` | celebration | label |
    |---|---|---|---|
    | write path | `{workoutId}` | confetti in-session | — |
    | ordinary nightly run (`shipped CATALOGUE_VERSION === the KV value`) | `'nightly'` | one sheet listing that night's unlocks, confetti, level-up animation | dated the sweep day |
    | the single run that first sees `shipped CATALOGUE_VERSION > gami:catalogue_version` | `'sweep:{version}'` | **no** confetti, no level-up animation, one batched digest ("3 новых достижения" / "3 new achievements") with a single `L12 → L15` summary | «открыто задним числом» / "unlocked retroactively" |

    That is also what makes `CATALOGUE_VERSION` load-bearing rather than decorative: because every
    pre-existing definition was already evaluated last night, an unlock found on the version-bump run is
    by construction for a **newly added** definition against **old** history — genuinely retroactive, no
    extra column and no per-definition bookkeeping needed. Once the run finishes it writes the new
    version to KV, so the next night is ordinary again. If the version did not change, nothing is ever
    labelled retroactive. Retroactive unlocks still award **full XP** (withholding would contradict
    §14); the displayed date is the sweep day, because we do not fabricate a historical date we cannot
    derive. **Achievements are never revoked:** no delete path; retiring a definition sets
    `active = false`, which removes it from the locked grid while existing unlocks still render.
18. **Weekly quests — the whole pool, and a deterministic pick.** `QUEST_COUNT_PER_WEEK = 3` rows are
    inserted into `quests` (`U(week_start_day, key)`) by `openWeekQuests` in the Monday rollup. A quest
    is **eligible** for a week iff the user's `primary_goal` is in its `goals` **and** `target(ctx)`
    returns non-null. `target_value` is computed once at week open and frozen in the row — a mid-week
    settings change never moves the goalposts. Progress is recomputed in the nightly rollup over the
    week-to-date; `questComplete` is `progress_value ≥ target_value`; completion writes `completed_at`
    and one `quest` XP row (`source_id = '{week_start_day}:{key}'`).

    | key | goals | `target_value` | XP | progress metric (Mon–Sun of the week, local days) |
    |---|---|---|---|---|
    | `sessions_on_plan` | all | `weeklyTarget` | 100 | `trainedDays` — days with status `active` |
    | `three_sessions` | all | 3 | 60 | `trainedDays` |
    | `checkin_5_days` | all | 5 | 50 | `checkinDays` — days with a complete check-in (§3) |
    | `pr_attempt` | strength, muscle, recomp | 1 | 80 | `prCount` — `personal_records` rows in the week |
    | `hard_sets_60` | muscle, recomp | 60 | 80 | `hardSets` — `sum(workouts.hard_sets)` |
    | `volume_up_5pct` | strength, muscle | `round(prevWeekVolumeKg × 1.05)`, **null when `prevWeekVolumeKg === 0`** | 100 | `volumeKg` — `sum(workouts.volume_kg)` |
    | `protein_5_days` | muscle, fat_loss, recomp | 5 | 70 | `proteinDays` — days whose confirmed `protein_g` ≥ that day's target |
    | `nutrition_6_days` | fat_loss, recomp | 6 | 70 | `nutritionDays` — days meeting §3's `nutritionComplete` |
    | `steps_5_days` | health, fat_loss | 5 | 50 | `stepDays` — days with `steps ≥ REST_DAY_STEPS` |
    | `photo_this_week` | all | 1 | 40 | `photoCount` — `photos` with `kind='progress'` |
    | `two_leg_days` | strength, muscle | 2 | 60 | `legDays` — distinct days with ≥ 1 counted set whose exercise's primary role ∈ {quadriceps, hamstrings, glutes} |
    | `measure_this_week` | all | 1 | 40 | `measurementCount` — `body_measurements` rows |

    Every XP value is inside the 40–100 band §14 states, and every goal has ≥ 6 eligible quests
    (`health` has the fewest: `sessions_on_plan`, `three_sessions`, `checkin_5_days`, `steps_5_days`,
    `photo_this_week`, `measure_this_week`).

    **Selection is deterministic, not random.** `selectQuests` sorts the eligible keys by
    `fnv1a32(\`${weekStartDay}|${key}\`)` ascending, tie-breaking on `key`, and takes the first three.
    The same week always yields the same three quests, so a unit test can assert an exact triple, a
    re-run of the Monday job is idempotent with no "did I already pick?" state, and a repaired backfill
    reproduces the week that was actually offered. There is deliberately **no anti-repeat rule**: it
    would need last week's row as an input, making the pick non-reproducible from the week key alone,
    and the hash already varies the triple week to week. An incomplete quest at week close is left as-is
    and never mentioned again — there is no failure state and no copy for one.
19. **Loading / empty / error.** Loading → skeletons with no numbers, never `0`. **No data at all** —
    defined as zero rows in `streak_ledger`, which §21's cold-start floor guarantees for a user who has
    logged nothing — → the chip is hidden entirely and the dashboard shows one "log your first session"
    card. Snapshot fetch
    error → last cached value with a dimmed «не обновлено» / "not refreshed" badge and no error toast:
    a gamification fetch failing must never interrupt logging. A rollup failure is invisible to the
    user by design, surfacing only in `cron_runs` and the settings "last rolled day" row.
20. **One cron.** `"20 19 * * *"` = **00:20 Asia/Almaty** (`r01 §4.6`, `r09 §8`). The expression is
    already in `wrangler.jsonc` via `specs/01`; this module only registers the job. Sequence:
    `rollDays(→ yesterday)` → close any Sunday crossed → day-scoped XP (`filterCappedEvents` then
    `buildXpStatements`, §14a) → `updateQuestProgress` → `sweepAchievements` → on day-of-month 1 also
    `buildMonthlyReportCard(prevMonth)` + `persistMonthlyReportCard` → on Jan 1 also
    `buildYearInReview(prevYear)` + `persistYearInReview` → on Monday also
    `buildWeeklyReview(prevWeek)` + `persistWeeklyReview` and `openWeekQuests(thisWeek)`. The `build*`
    functions only *return* payloads; the `persist*` functions are the only writers of the three report
    tables, so a regenerate is an overwrite by PK and nothing writes a report row inline.
    **Generation is decoupled from delivery**: spec 14's 08:05 cron reads the
    pre-generated row, so this module needs no second trigger and no weekday cron expression. A daily
    cron has a ≥ 1 h interval and so keeps the 15-minute CPU budget (`r01 §4.1`: a sub-hourly cron
    silently gets 30 s). Each run writes `cron_runs` keyed `U(job, scheduled_at)` — `scheduled_at`, not
    `started_at`, is the idempotency key (`specs/02`).
21. **The rollup is self-healing and idempotent — and it never invents history.** `rollDays` starts at
    `max(lastProcessedDay + 1, throughDay − (BACKFILL_MAX_DAYS − 1), firstActivityDay)` and walks
    forward, so a cron that silently did not run for nine days (`r01 §4.7` — a failed cron is invisible)
    repairs itself next run, and a late or early firing cannot double-count.

    **`firstActivityDay` is the cold-start floor and is not optional.** It is
    `min(local_day)` across `workouts`, `daily_checkins`, `food_entries`, `water_logs`,
    `body_measurements`, `photos` and `gym_checkins`. **When there is no activity at all, `rollDays`
    writes nothing and returns `daysProcessed: []`.** Without this floor the very first run (where
    `lastProcessedDay` is null) would start 29 days back and write up to 29 `missed` rows for days the
    user did not own the app — which §6's decay would then turn into a streak of 1 for someone with zero
    data, contradict §19's "no data at all → the chip is hidden", and poison both the 28-day adherence
    window and `foldLedger`. The floor and §6's `currentDays === 0` no-op are the two halves of the same
    fix, and each has its own unit case.

    **Truncation is repaired, not abandoned.** `truncated = true` when the 30-day cap bit, and the run
    returns `oldestUnprocessedDay` — the day it would have started at without the cap. That day is
    persisted (`streak_state.last_processed_day` still advances forward as normal; the unprocessed tail
    is recorded in the `cron_runs.detail` JSON and re-read next run) and the next run walks **backwards**
    into the hole before rolling forward, repeating until nothing is left. Until it is filled, the hole's
    days are simply absent from the ledger, which §12 defines as *unknown* — excluded from both sides of
    the adherence fraction rather than counted against the user. Settings surfaces "last rolled day".

    Writes go through `db.batch()`, chunked under D1's **100 bound parameters per statement** and 1000
    queries per invocation (`r02 §2.8`); the chunker **skips an empty chunk and the caller skips
    `db.batch()` entirely when the statement array is empty** — `db.batch([])` throws (`r02 §4.8`,
    `specs/02` rule 20), and the common case produces exactly that: a finished workout with no PRs whose
    XP row was already written by a replayed outbox item yields zero statements. `db.transaction()` is
    never used — it compiles and fails at runtime on D1 (`r02 §4.6`). `controller.scheduledTime`, never
    `new Date()`, is the clock (`r01 §4.6`).
22. **Cron-side copy: this module renders none.** §20's sequence emits numbers and rows, never
    user-facing prose — `StreakStep.note` is machine-readable, the review payloads are numeric, and
    sending is `specs/14`'s. So there is **no `src/server/gamification/i18n-standalone.ts`**: a
    `cronTranslator` here would have had exactly one caller (`copy-ban-list.test.ts`) while pulling
    `use-intl/core` and both message bundles into the worker bundle for nothing — with a Risks row about
    that bundling failing. **`cronTranslator(locale)` belongs to `specs/14`,** which does render copy on
    the cron path; this module owns the C1–C7 message *keys* and their ICU shape, and
    `copy-ban-list.test.ts` imports `createTranslator` from `use-intl/core` directly (a dev-only import
    in a test file, never in the worker bundle).

    The constraints below are the contract `specs/14`'s renderer must satisfy for these keys, and the
    reason they are recorded here is that the keys are authored here. `getTranslations()` is unusable on
    the cron path: `getCloudflareContext()` throws inside `scheduled` (`r01 §2.4`) and the request config
    reads `cookies()`. Use
    `createTranslator({locale, timeZone: 'Asia/Almaty', messages})` from `use-intl/core` — verified
    executed in `r11 §9` Option A including RU plurals and Almaty formatting — with `locale` from
    `settings.locale`, not a cookie. Numbers go through ICU `{n, number}` (RU groups with a space:
    `1 234,5`), never concatenation. Every RU plural must declare **all four** categories
    `one/few/many/other`: `r11 §9` verifies Russian routes both 0 and 5 to `many` (`5 подходов`), so a
    message omitting `many` renders the wrong form for 5–20. The form is `{n, plural, …}`, not
    `{n, number, plural, …}`, which is not valid ICU.
23. **At-risk nudge predicate — and nothing else.** `shouldNudgeAtRisk` is true iff, at
    `NUDGE_HOUR_LOCAL` (20:30 Almaty): the day is **not yet earned** — `classifyToday(db, today).earned
    === false`, the read-only path of §9a, so the 20:30 evaluation never writes — and `currentDays ≥
    AT_RISK_MIN_STREAK (3)` and `dormant === false`. It returns numbers only.

    **Delivery frequency, channel and dedupe are `specs/14` §19 and are not restated here.** An earlier
    draft claimed "at most once per day" and dedupe on `notification_log` `U('telegram',
    'streak_at_risk', today)`. Both were wrong: `specs/14`'s `NotifyKind` literal is
    `'streak-at-risk'` with a **hyphen**, so the underscored lookup could never match and the dedupe was
    a silent no-op; and `specs/14` §19's real rule is strictly tighter than once-per-day (no nudge two
    nights running, ≤ 2 in the trailing 7 local days, plus quiet hours and the collapse against the
    21:00 `training-reminder`). A predicate module must not state a policy it does not own. This spec
    adds only: never as an in-app modal, and `NUDGE_CUTOFF_HOUR_LOCAL = 21` is the latest local hour at
    which a streak nudge is meaningful at all.
24. **Gym check-in — the privacy contract.** Distance is computed **in the browser**: the page fetches
    the geofence centre (`gym_geofence`, one row, the *gym's* coordinate rounded to 4 dp ≈ 11 m, set
    deliberately by the user once), runs `haversineMetres` locally, and POSTs only
    `{withinGeofence, distanceBucket, accuracyBucket, method}`. The raw `GeolocationCoordinates` never
    leaves the device and is never logged; the Zod schema is `.strict()` so a payload carrying
    `lat`/`lon` is rejected 400. No coordinate history is stored, ever — the only coordinate in D1 is
    the gym's own, one overwritable row. **This module never writes `workouts.gym_lat`/`gym_lon`;** see
    Data for the requested removal of those columns.
25. **Check-in semantics and fallback.** Buckets: `at` ≤ radius (`GEOFENCE_RADIUS_M_DEFAULT` 150 m),
    `near` ≤ `NEAR_RADIUS_MULTIPLIER × radius`, `far` beyond; `accuracyBucket` from `coords.accuracy`
    (metres, **always non-null** per MDN `GeolocationCoordinates`) — `fine` ≤ `ACCURACY_FINE_M` (25),
    `coarse` ≤ `ACCURACY_COARSE_M` (100), `poor` above. A check-in is worth 5 XP and
    a calendar dot; it **never** earns a day — we do not infer training from location. If
    `withinGeofence === true` and the day has no finished workout by `RETRO_LOG_OFFER_HOUR_LOCAL`
    (22:00), the app offers a retroactive log. By verified `GeolocationPositionError.code`: `1 PERMISSION_DENIED` → hide
    geolocation permanently, keep the manual button; `2 POSITION_UNAVAILABLE` / `3 TIMEOUT` (options
    `{enableHighAccuracy: true, timeout: 8000, maximumAge: 60000}`) → manual check-in with
    `method: 'manual'`, `withinGeofence: null`, `distanceBucket: 'unknown'`. Requires a secure context;
    never requested at launch, only on an explicit tap. With no geofence configured the first check-in
    offers "save this as my gym".
26. **Weekly review ritual.** Generated in the Monday 00:20 rollup for the week just closed, delivered
    08:05 (spec 14), readable any time at `/progress/review/[week]`; contents are exactly
    `WeeklyReviewPayload`. It is a ritual, not a report: the page ends with one question — «Что
    изменишь на следующей неделе?» / "What will you change next week?" — persisted to
    `weekly_reviews.reflection`; answering awards `week_review` XP once. A zero-activity week renders
    sections as `—` plus the 28-day adherence and copy C6; never an unframed all-zeros scorecard.
27. **Monthly report card.** Generated on the 1st for the previous month. Five axes, each a 0–100 score
    whose formula is stated in `basis`. **Every axis is scoped to the month itself**, so regenerating a
    2026-03 card in 2026-11 gives byte-identical output:

    - *consistency* `100 × min(1, monthCompleted / monthPlanned)` — `monthCompleted` = `active` days in
      that calendar month, `monthPlanned` = spec 09's scheduled sessions in the month, else
      `round(weeklyTarget × daysInMonth / 7)`. **Not `adherence28d`:** a trailing-window metric has no
      as-of parameter and would grade March by whatever the last 28 days looked like when the card was
      built.
    - *volume* `50 + 50 × clamp(volumeDeltaFrac / AXIS_VOLUME_FULL_SCALE, −1, 1)`
    - *strength* `50 + 50 × clamp(meanE1rmDeltaFrac / AXIS_STRENGTH_FULL_SCALE, −1, 1)`
    - *nutrition* `100 × daysLogged / daysInMonth` (`daysLogged` per §16a, i.e. confirmed entries only)
    - *recovery* `100 × meanReadiness / 10`

    `volumeDeltaFrac` and `meanE1rmDeltaFrac` are **fractions** vs the previous calendar month —
    `(this − prev) / prev`, so `0.10` is +10 % and the divisors above are full-scale at ±10 % / ±5 %.
    Both are `null` when the previous month has no data, which makes the axis `null`. Grades use
    `GRADE_CUTOFFS` (A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 45, else F). `overall` is the unweighted mean of
    available axes, graded the same. An axis lacking data is `null`, shows `—`, and is excluded from the
    mean — never an F. `deltasVsPrevMonth` is the fixed `MonthlyDeltas` key set in §Interfaces — nine
    named keys, no free-form record, so two implementers cannot produce two payload shapes.
28. **Year-in-review.** Generated Jan 1 for the previous year, on demand for any complete year. Nine
    cards, ids fixed as `YearCardId`: `sessions`, `tonnage`, `top_movement`, `best_e1rm_jump`,
    `longest_streak`, `weeks_on_plan`, `food_photos`, `trend_weight`, `best_session`.

    The tonnage card's "physical comparison" is the `caption` field, rendered from a **local lookup
    table in `review.ts`** — no external data source, no network call, no invented figure. Six entries,
    each an object mass in kg, and the caption names the largest entry that the year's tonnage exceeds
    plus how many of it: `African elephant 6000`, `car 1500`, `grand piano 400`, `washing machine 70`,
    `bag of cement 50`, `barbell plate 20`. Copy key `Gamification.year.tonnage.caption` with
    `{count, number}` and `{object}`; below 20 kg the caption is `null` and the card shows the number
    alone. Every other card's `caption` is `null` unless a later revision defines one — the field exists
    so a card can carry a sentence without a payload migration.

    The share image is composited **client-side** on a `<canvas>` and offered via `navigator.share`
    when `navigator.canShare({files})` is true, else a save hint — downloads are unreliable in embedded
    webviews, so nothing may depend on one. No R2 object is created.
29. **Offline.** The gym screen shows optimistic XP from a Dexie `pendingXp` store; the server is
    authoritative on sync.

    **The gym check-in is queued, not fired.** A basement gym is exactly where this button is pressed
    and exactly where there is no signal; geolocation itself works offline, the network write does not.
    `POST /api/gamification/gym-checkin` therefore goes through `specs/05`'s outbox like any other
    write — `writeLocal()` with `entityTable: 'gym_checkins'`, `entityId: {local_day}`, payload
    `{day, withinGeofence, distanceBucket, accuracyBucket, method}` — and never a bare `fetch`. Replay is
    idempotent because `gym_checkins.local_day` is UNIQUE (Data req. 6) and the server upserts by day, so
    a retried op cannot mint a second check-in or a second 5 XP row (whose `source_id` is `{local_day}`
    anyway). The optimistic 5 XP in `pendingXp` is cleared on the ack like every other pending row.

    Reconciliation rule: **within a session the UI never displays a decrease** —
    it shows `max(localTotal, serverTotal)`, adopts the server total on the next cold start, and logs
    the divergence. Streak and level are read-only offline from the cached snapshot with an "as of
    <time>" label; grace, freeze and decay are **never** computed on the client, because the client
    cannot know whether a later day was earned.
30. **Copy table.** Keys under `Gamification.nudge.*`; RU is source of truth (`r11`).

    | # | Situation | RU | EN |
    |---|---|---|---|
    | C1 | Streak at risk (20:30, streak ≥ 3) | «Серия {n, number} — в силе. Десять минут растяжки или короткий чек-ин, и день зачтён.» | "Your {n, number}-day run is live. Ten minutes of stretching or a quick check-in counts the day." |
    | C2 | Grace/freeze spent (disclosure) | «Вчерашний день закрыт пропуском. Серия на месте: {n, number}. Пропусков осталось: {left, number}.» | "A rest pass covered yesterday. Your run stands at {n, number}. Passes left: {left, number}." |
    | C3 | Streak decayed ("broken") | «День прошёл без записи — серия стала {after, number} вместо {before, number} и никогда не обнулится. Тренировка сегодня вернёт {before, number}.» | "A day went unlogged — the run is {after, number} instead of {before, number}, and it never resets to zero. Train today and {before, number} comes back." |
    | C4 | Missed week | «{done, number} из {target, number} тренировок на этой неделе. Недельная серия: {wBefore, number} → {wAfter, number}. За 28 дней — {adh, number, percent} плана. Это и есть главная цифра.» | "{done, number} of {target, number} sessions this week. Weekly run: {wBefore, number} → {wAfter, number}. Over 28 days: {adh, number, percent} of plan. That's the number that matters." |
    | C5 | Comeback (first earned day after ≥ 3 unearned) | «Снова в деле. Перерыв {gap, plural, one {# день} few {# дня} many {# дней} other {# дня}} ничего не отменил: лучшая серия {best, number} и {xp, number} XP на месте.» | "Back in. A {gap, number}-day gap cancelled nothing — your best run of {best, number} and {xp, number} XP are all still here." |
    | C6 | Dormant / long absence (≥ 14 d) | «Рад тебя видеть. Поставим цель {suggest, number} тренировки в неделю на этот месяц? Вернём {current, number}, когда захочешь.» | "Good to see you. Shall we set the target to {suggest, number} sessions a week for now? We'll put it back to {current, number} whenever you like." |
    | C7 | The decay rule, stated once | «Пропуск не обнуляет серию — она уменьшается вдвое и никогда не падает ниже 1.» | "A missed day never wipes your streak — it halves, and it never drops below 1." |

31. **Copy law and ban-list.** *Never attribute a lapse to a stable property of the person; attribute it
    to the day, and always name the smallest next action.* That is the AVE mechanism written as a style
    rule. `BANNED_COPY_PATTERNS` is enforced by a unit test over every `Gamification.*` string in both
    locales: loss framing (`потерял`, `сгорела`, `обнулена`, `lost`, `broken`, `reset to zero`,
    `wiped`); trait attribution (`лень`, `ленишься`, `слабак`, `lazy`, `no discipline`); guilt (`не
    подведи`, `ты обещал`, `стыдно`, `don't let yourself down`, `you promised`, `ashamed`); verdicts
    (`провал`, `фейл`, `failed`, `missed goal`); scarcity (`последний шанс`, `осталось \d+ час`, `last
    chance`, `only \d+ hours? left`, `hurry`); social comparison (`все уже`, `everyone else`); XP loss
    (`[-−]\d+\s*XP`); the literal streak zero (`\b0 дней\b`, `\b0-day\b`); shame emoji (`💀`, `😞`,
    `😢`); and `!{2,}`. A new string that trips a pattern fails CI.

## Data

`specs/02-data-model.md` owns every table, column, enum, CHECK and index below; this section states
only what this module reads and writes, and what it **requires `specs/02` to add**. JSON columns are
CHECKed at `MAX_JSON_BYTES = 65 536`, which the review payloads must respect.

**Written (existing in `specs/02` §gamification / §system):**

| Table | Use |
|---|---|
| `streak_ledger` | **Upsert-by-day** (`local_day U`): `status ∈ {active,rest,grace,freeze,missed}`, `workout_id?`, `reason?`, `applied_at` + the three limits columns of req. 11. The day-level source of truth that `streak_state` folds over (§9) — a day ledger, **not** an append-only audit log: a replay overwrites the row. Written by two paths only (§9a). `reason` is the pipe-joined string pinned in §9a, e.g. `none\|decay:5->2\|cover_cap`. |
| `streak_state` | Cache, `id='singleton'`: the nine existing columns (`current_days`, `current_weeks`, `longest_days`, `longest_weeks`, `freezes_remaining`, `grace_used_this_week`, `last_active_day?`, `adherence_pct?` — **a ratio, §12** —, `recomputed_at`) **plus the seven of req. 10**. Written only by the nightly rollup and by a fold. |
| `xp_ledger` | `awarded_at`, `local_day`, `source_kind ∈ XP_SOURCES`, `source_id`, `xp INT`, `reason?`, `U(source_kind,source_id)` award-once, `I(local_day)`. |
| `achievement_unlocks` | `achievement_key PK`, `unlocked_at`, `local_day`, `progress?`, `source_id?` (workout id, or `sweep:{version}` for retroactive — §17), `seen_at?`. |
| `quests` | `week_start_day`, `key`, `target_value`, `progress_value`, `completed_at?`, `U(week_start_day,key)`. |
| `cron_runs` | One row per nightly run; `U(job, scheduled_at)`. |

**Read only:** `settings` (`locale`, `primary_goal`, `streak_freeze_budget`, `streak_grace_per_week`,
`weekly_target_sessions`, the three `main_lift_*_exercise_id` of req. 9); `goals` (`kind='sessions_per_week'`
override, **`kind='kcal'`** and **`kind='protein'`** daily targets for §3/§16a, `bodyweight`/`bodyfat`
targets); `workouts` (`local_day`, `ended_at`, `volume_kg`, `hard_sets`); `sets` (`type` for the
counted-set test, `exercise_id`); `exercises` (primary role, for `two_leg_days`);
`personal_records` (`id`, `kind`, `local_day`, `value`, `is_current`); `daily_checkins`
(`sleep_quality`, `mood`, `energy`, `readiness`, `steps`); `food_entries` (`local_day`, `kcal`,
`protein_g`, `confirmed_at`, `photo_id`); `water_logs` (`local_day`, `ml`); `body_measurements`
(`local_day`, `weight_kg`, `trend_kg`, `body_fat_pct`); `photos` (`kind='progress'`, `r2_key`,
`local_day`); `deload_blocks` (`accepted_at`, `ends_on`, `deleted_at`); `program_schedule` (spec 09's
planned sessions for §12/§27). **`notification_log` is NOT read by this module** — nudge dedupe moved to
`specs/14` §19 (§23).

**Required additions — `specs/02` owns the DDL; this spec cannot proceed without them:**

1. `settings.primary_goal` — `TEXT NOT NULL DEFAULT 'muscle'`, one of `PrimaryGoal`. Behaviour §3
   branches on it and no existing column expresses it (`goals.kind` is a dated target, not a stance).
2. `XP_SOURCES` (`src/db/enums.ts`) — add `nutrition_day`, `food_photo`, `body`, `photo`,
   `gym_checkin`, `week_target`, `week_review`. The current 7-value tuple cannot express the brief's
   XP surface; §14 is the full mapping.
3. `weekly_reviews` — `iso_week TEXT PK`, `generated_at`, `payload_json` (CHECK ≤ 65 536),
   `ai_summary?` (written by spec 14), `reflection?`, `delivered_at?`.
4. `monthly_report_cards` — `month TEXT PK`, `generated_at`, `payload_json`.
5. `year_in_review` — `year INTEGER PK`, `generated_at`, `payload_json`.
6. `gym_checkins` — `id`, `local_day` **UNIQUE** (one check-in per day: XP is keyed `{local_day}`, the
   calendar shows one dot, and `U(local_day)` is what makes the offline outbox replay idempotent, §29),
   `at`, `within_geofence?` (bool, null when manual), `distance_bucket TEXT`, `accuracy_bucket TEXT`,
   `method TEXT`. **No coordinate column.**
7. `gym_geofence` — `id='singleton'` CHECKed, `lat REAL`, `lon REAL` (4 dp), `radius_m`, `label?`.
8. **Remove `workouts.gym_lat` / `workouts.gym_lon`. DECIDED, with a deadline: before migration 0001 is
   applied.** Those two columns (`specs/02` §workouts) are a raw per-workout coordinate history, which
   the brief forbids for this feature and which this spec's privacy contract (§24) rules out. If the
   workout row needs the signal at all, replace with `gym_within_geofence?` (bool) and
   `gym_distance_bucket?` (text); otherwise join `gym_checkins` on `local_day`. This is a cross-spec
   conflict, not a preference, and it is **time-critical**: `specs/02` declares applied migrations
   immutable and rule 21 makes a later `DROP COLUMN` an `-- APPROVED-BREAKING` event, so the cost of
   deciding late is a breaking migration rather than an edit. Two other files move in the same commit:
   `specs/15-data-portability.md`'s `workouts` export column list (which names `gym_lat,gym_lon`) and the
   `pragma table_info(workouts)` assertion in Verification. Owner sign-off is tracked as Open question 1;
   the decision recorded there is **remove**, and if the owner overrides it the Verification line must be
   changed in the same commit or CI goes permanently red.
9. `settings.main_lift_bench_exercise_id`, `settings.main_lift_squat_exercise_id`,
   `settings.main_lift_deadlift_exercise_id` — `TEXT NULL` (ALTER TABLE ADD COLUMN with a constant
   default, per `specs/02`'s `settings` convention), each holding an `exercises.id`
   (`'fedb:<dataset id>' | 'usr:<ULID>'`). Without them `relativeStrengthBench/Squat/Deadlift` and
   `bigThreeTotalKg` have no subject and the four strength badges are permanently inert (§16a). Nullable
   because there is no defensible default for a user who benches on a Smith machine; `specs/08`'s seeder
   may prefill by exercise name, and §16a defines the unset behaviour (`null` metric + "needs setup").
10. **`streak_state` — add the eight columns `StreakState` needs and specs/02 does not yet have:**
   `covered_run INTEGER NOT NULL DEFAULT 0` (§5's `COVER_MAX_CONSECUTIVE` cap),
   `last_decay_day TEXT NULL`, `pre_decay_peak INTEGER NULL`, `last_restore_day TEXT NULL` (§7's
   comeback restore needs the last two), `last_closed_week TEXT NULL` (§11),
   `dormant INTEGER NOT NULL DEFAULT 0` (§8), `last_processed_day TEXT NULL` (§21),
   `weeks_target_met_total INTEGER NOT NULL DEFAULT 0` (§16a). The earlier draft listed fourteen
   `StreakState` fields against nine columns — that is not a cache, it is a data loss: §7's comeback
   restore cannot work without `pre_decay_peak` + `last_restore_day`, §5's cap without `covered_run`,
   §8 without `dormant`, §21 without `last_processed_day`. All are `ALTER TABLE ADD COLUMN` with a
   constant default, so the singleton row needs no backfill.
11. **`streak_ledger` — add the limits in force on that day:** `weekly_target INTEGER NOT NULL DEFAULT 4`,
   `grace_per_week INTEGER NOT NULL DEFAULT 1`, `freeze_budget INTEGER NOT NULL DEFAULT 2`. Three small
   integers per row are what make `foldLedger` history-preserving (§9): without them a replay re-runs all
   of history under *today's* settings, so raising `weekly_target_sessions` retroactively un-meets closed
   weeks, changes freeze accrual, and can lower `longestDays` — contradicting the spec's own monotonicity
   test. Defaults match the `settings` defaults, so no backfill is needed.
12. **Rename request (non-blocking): `streak_state.adherence_pct` → `adherence_ratio`.** The column
   stores a ratio (`0.6875`), not a percentage; the name invites the bug where `adherence_90` unlocks on
   day one (§12). Until it lands the contract is §12's sentence plus a round-trip unit case.

KV (`CACHE_KV`): `gami:snapshot:v1` (streak + level + adherence JSON, TTL 300 s);
`gami:catalogue_version` (integer, no TTL — the **last swept** version; a shipped
`CATALOGUE_VERSION` greater than it triggers exactly one retroactive-labelled run, §17, after which the
run writes the new value); `gami:rolled_through` (last `local_day` rolled). KV is eventually consistent:
a cache and a hint only, never the source of a streak number. A lost or never-written
`gami:catalogue_version` degrades safely — the run is treated as ordinary, so unlocks are celebrated
rather than mislabelled.

R2: none created here. `photos.r2_key` values in the monthly card and year-in-review are read-only
references owned by `specs/10-body-photos.md`.

IndexedDB (stores registered by `specs/05-pwa-offline-sync.md`): `gamiSnapshot` (last server snapshot
+ `fetchedAt`), `pendingXp` (optimistic `XpEvent[]` keyed by `sourceKind:sourceId`, cleared on sync
ack), `achievementToasts` (unlock keys awaiting display, so a celebration survives a reload). The gym
check-in needs **no new store**: it is an ordinary `specs/05` outbox op on
`outbox[entityTable+entityId] = ('gym_checkins', {local_day})` (§29), which is why req. 6 makes
`gym_checkins.local_day` unique.

## UX notes

- **Streak chip** in the header's right slot, ≥ 44 × 44 px; tapping opens `StreakSheet` as a bottom
  sheet, never a route push — it must be dismissible with a downward swipe while standing at a rack.
  The sheet's first line is C7, verbatim, always visible.
- **Calendar glyphs** are five shapes distinguishable **by shape alone**, each named in a legend and
  carrying the same word in its `aria-label` (colour and hue are redundant cues, per `specs/03` §23's
  rule that a level is never the sole signal). `active` — filled disc, `#c6ff00` (17.71:1 on `#000`).
  `rest` — ring with a filled centre dot ("donut with a core"), same accent; the earlier "filled
  outline" was a self-contradictory shape instruction. `grace` — hollow ring, accent, empty centre.
  `freeze` — hollow ring with a horizontal bar across it (the pause bar). `missed` — hollow square
  outline plus a small downward chevron in **`#71717a` (`--border-strong`), 4.35:1 on `#000`**, which
  clears WCAG 1.4.11's 3:1 for non-text graphics; `#27272a` (`--border`) is 1.41:1 and may **not** be
  used here. `missed` is drawn *quiet*, never red.
- **Adherence ring** is the dashboard's largest element, top-left in the one-handed reach zone; the
  streak chip is deliberately smaller. `role="img"` with an `aria-label` carrying the whole sentence
  ("69 % of plan over 28 days: 11 of 16 sessions"), not "69 %".
- **XP bar** animates forward only, 300 ms spring; a level-up plays one accent sweep. Under
  `prefers-reduced-motion` the bar jumps and confetti becomes a static badge with a 200 ms fade.
- **Unlock celebration**: bottom sheet, confetti, and `navigator.vibrate([10, 30, 10])` fired
  **fire-and-forget, never awaited** — per `r06 §6.3` vibration is a no-op on Android 8+ and absent on
  iOS, so haptics are decoration and no state transition may depend on one. Retroactive digests get no
  confetti.
- **XP announcements** use `aria-live="polite"`, never `assertive`: they must not interrupt a screen
  reader mid-set.
- **Skeletons**: chip = 64 × 28 pill; ring = gray arc at 0 with no number; XP bar = flat track. Never
  render `0` as a placeholder for an unknown value. The §19 "not refreshed" badge is **not dimmed with
  opacity**: it is `#a1a1aa` text at full opacity (8.19:1 on `#000`) with a small clock glyph, because
  `specs/03` §… records that opacity-composited text fails the 4.5:1 this project requires and axe
  cannot even measure it. "Dimmed" is a visual intent, not a token.
- **Gym check-in button** appears only on the workout-start screen and in the streak sheet. It carries
  `data-tap="primary"` with a **≥ 56 px** hit area — **≥ 72 px on the GYM MODE route** (`specs/03`
  §"tap targets"), because it is touched with gloves on and mid-session; the ≥ 44 × 44 px on the streak
  chip is the ordinary-chrome minimum and does not apply to it. Its label states what is sent:
  «Отправим только «я в зале», без координат» / "We send only 'I'm at the gym' — no coordinates", shown
  *before* the permission prompt.
- **Achievement grid** has three states, not two: unlocked (icon + tier frame + date), locked (icon at
  `#71717a`, name + generated hint), and **"needs setup"** for the four named-lift badges while
  `MetricGaps.unmappedLifts` names their lift (§16a) — same weight as locked, plus a one-line
  «нужна настройка» / "needs setup" affordance to settings, so a badge is never dark for a reason we
  refuse to state.
- **Year-in-review** is a vertical scroll of full-bleed cards (thumb scroll), not a tap carousel; each
  card is a landmark with a heading so it is screen-reader navigable.

## Risks

| Risk | Mitigation |
|---|---|
| **UTC/Almaty off-by-one drops a day and decays the streak** — `r09 §8` names it the highest-risk bug in the app, and it is the worst possible trigger for the rage-quit this module exists to prevent. | `local_day` stored not derived, via `specs/02`'s `toLocalDay`; no SQL date math; no runtime `Intl` for stored values; the `2026-09-07T00:30+05:00` vector pinned in tests; the rollup clocks off `controller.scheduledTime`. |
| A failed cron is invisible (`r01 §4.7`) and the streak silently freezes. | `rollDays` is a reconciling backfill (§21); `cron_runs` row keyed `U(job, scheduled_at)`; settings shows "last rolled day"; `observability.enabled`. |
| Outbox replay or a cron retry double-awards XP (retry policy undocumented — `r01 §4.8`). | `xp_ledger U(source_kind, source_id)` with `ON CONFLICT DO NOTHING`; `applyDay` idempotent per day; unlocks keyed on `achievement_key`. |
| `streak_state` drifts from the ledger after a settings change or a backdated workout. | `foldLedger` replays the whole ledger (§9); `recomputed_at` records it; a nightly assertion compares the fold to the cached row. |
| Backfill exceeds D1's 100 bound params/statement or 1000 queries/invocation (`r02 §2.8`). | `BACKFILL_MAX_DAYS = 30`, chunked `db.batch()`, aggregates in SQL not loops; `db.transaction()` never used (`r02 §4.6`). |
| Catalogue growth fires a dozen unlock sheets at once and cheapens every badge. | Retroactive unlocks batch into one digest, no confetti, one level summary (§17). |
| Float `Math.pow` makes `levelOf` disagree with `xpToReach` at exact thresholds — real, at L = 33. | ±1 integer correction, asserted for all L in 1..100 (§14). |
| `workouts.gym_lat/gym_lon` ships and becomes a coordinate history the brief forbids — and `specs/02` declares applied migrations immutable, so it is expensive to undo. | Data requirement 8: remove before the first migration is applied. This module never writes them; `geofence.ts` runs client-side and the API schema is `.strict()`. |
| A weekday cron is mis-numbered: Cloudflare documents the field as `1-7`, and `r01 §3.2` ships `"5 3 * * 1"` commented "Mon" while `r01 §2.8`/`§4.6` read `1` as **Sunday**. | This module needs no weekday cron (§20). Flagged for `specs/14`: use the documented 3-letter form (`MON`), which is unambiguous. |
| `use-intl/core` fails to bundle under wrangler's esbuild for the cron path (`r01 §4.11`: worker imports are bundled by wrangler, not Next). | **Not this module's exposure any more:** §22 renders no cron-side copy and ships no `i18n-standalone.ts`, so `use-intl/core` reaches the worker bundle only via `specs/14` (whose risk it now is) and via `copy-ban-list.test.ts`, which is dev-only. Fallback, for `specs/14`, is `r11 §9` Option B's hand-rolled `plural()`, also verified executed. |
| A cold start manufactures a month of `missed` days and hands a zero-data user a streak of 1. | §21's `firstActivityDay` floor (no ledger row before the first real `local_day`, none at all when there is no activity) plus §6's `currentDays === 0` no-op; both have named unit cases. |
| Cap enforcement is silently absent because a synchronous builder cannot count rows. | Caps live in `filterCappedEvents` (§14a), an explicit async step every caller runs first, with `XP_WINDOW_CAPS` typed to cover the per-day *and* per-7-day cases; a unit case asserts the 4th photo of a day and the 2nd `body` row in 7 days are dropped. |
| A geolocation prompt at the wrong moment burns trust permanently — `PERMISSION_DENIED` is sticky. | Never at launch; only on explicit tap after the in-app explanation; on code `1` the geolocation path is hidden for good and the manual button remains. |
| A future contributor "fixes" a streak by adding a reset. | `STREAK_FLOOR` is a named constant; `applyDay` is the only place `current_days` is computed and the nightly rollup the only writer of `streak_state` (§9a); a 400-day fuzz test asserts `currentDays >= 1` once it has been ≥ 1, and a second case asserts a zero-data user gets no row at all. |
| A wrong decay cannot be diagnosed after the fact, because the ledger upserts by day and overwrites the evidence. | Not solved by pretending the ledger is append-only (it is not — `local_day` is UNIQUE). Solved by what each row carries: `applied_at`, the full `reason` string (§9a) and the three limits columns (req. 11), which together let `foldLedger` re-derive the decision offline. `xp_ledger` is the append-only one. |
| Shaming copy creeps in via a quick edit. | `copy-ban-list.test.ts` lints both locales in CI (§31). |

## Verification

```bash
npx tsc --noEmit                        # PASS: exit 0
npx eslint src/lib/gamification src/server/gamification src/jobs/nightly-rollup.ts
npx vitest run tests/unit/gamification  # PASS: 0 failed
```

Required unit cases (the names are the contract):

- `streak.test.ts` — `applies the canonical ledger exactly` (every cell of §10, including the
  `grace → freeze → cover_cap` order on 09-05…09-07, `decay 5→2` with `note='cover_cap'`, and the
  restore-then-extend to 6 on 09-08 and to 10 on 09-15 at the 7-day cooldown boundary);
  `never returns currentDays 0 once it has been >= 1` (fuzz 400 days, random facts);
  `halving ladder from 47 is 47,23,11,5,2,1,1`; `no third consecutive covered day`;
  `restore only on D+1 and at most once per 7 days`; `longestDays is monotonic`;
  `applyDay is idempotent for the same day`; `weekly streak may reach 0 but daily may not`;
  `foldLedger reproduces the state after every prefix of the canonical vector`;
  `a missed day with currentDays 0 is a no-op and does not create a streak of 1` (§6);
  `foldLedger under a raised weekly_target does not un-meet a closed week or lower longestDays`
  (replays the canonical vector with `weekly_target: 6` in the rows and 6 in current settings, §9);
  `formatLedgerReason returns none|decay:5->2|cover_cap for 2026-09-07` (§9a);
  `projectToday adds 1 only when today is earned and unprocessed, and never projects grace or freeze`;
  `initialStreakState(limits).freezesRemaining === limits.freezeBudget`.
- `rollup.test.ts` — `a brand-new user with no data gets no ledger rows and no streak`
  (`rollDays` returns `daysProcessed: []`, `streak_ledger` stays empty, the chip is hidden per §19);
  `the first run for a user whose first workout was 3 days ago writes exactly 3 rows, not 30`;
  `buildDayLedgerStatement never demotes an existing active row to rest`;
  `a truncated run reports oldestUnprocessedDay and the next run fills the hole`;
  `buildXpStatements([]) returns [] and the caller skips db.batch()` (§21, r02 §4.8);
  `filterCappedEvents drops the 4th food_photo of a day and the 2nd body row inside 7 days` (§14a);
  `an unconfirmed AI food estimate awards no XP and no achievement` (§3, §16a).
- `xp-curve.test.ts` — `xpToReach matches the published table` (90, 314, 1092, 4698, 18031, 38598,
  99220, 208382, 351873); `levelOf(xpToReach(L)) === L for L in 1..100`;
  `levelOf(xpToReach(L)-1) === L-1 for L in 2..100`; `levelOf(46080)===32 && levelOf(46081)===33`;
  `levelOf is monotonic over 0..360000 step 7`; `levelOf caps at 100`;
  `every XP_FLAT entry is >= 1 and every computed value is >= 1` (over `workoutXp` on the fixture,
  `prXp` for all four `PR_KINDS`, `milestoneXp` for all seven indices, `questXp` for all 12 keys);
  `XP_FLAT has no 'set' key and no writer emits a set event` (§14);
  `levelProgress(1e9) is {into:0, span:0, pct:1} and pct is not NaN`;
  `xpToReach(101) === xpToReach(100)`;
  `a session with 40 hard sets and 30 t is capped at XP_SESSION_CAP`.
- `adherence.test.ts` — `returns null and warmingUp before 14 days of history`;
  `full 28-day window with target 4 gives planned 16`; `11 of 16 is 0.6875`; `allows ratio above 1`;
  `a 20-day history pro-rates planned to 11` (§12's partial vector);
  `a 5-day hole is excluded from both numerator and denominator, not counted as missed`;
  `planned 0 yields ratio null, never a division`;
  `the 28-day ratio round-trips through streak_state.adherence_pct unchanged` (§12's unit rule);
  `rest, grace and freeze days do not count as completed sessions`;
  `two workouts on one day count as one session`.
- `day-status.test.ts` — one case per cell of the §3 matrix, including
  `fat_loss rejects a 400 kcal log against a 2400 kcal target`,
  `fat_loss rejects an unconfirmed 2000 kcal log` (confirmation gate, §3),
  `health earns a rest day at exactly REST_DAY_STEPS`,
  `a missing kcal goal means the nutrition branch cannot earn the day`,
  `a body measurement alone does not earn a rest day`, and
  `an amrap-only workout is trained` (guards the `r09 §8` extension in §2).
- `quests.test.ts` — `QUEST_POOL has 12 keys, every xp in 40..100, every goal with >= 6 eligible`;
  `selectQuests is deterministic: 2026-09-07 + muscle returns the same three keys on 100 calls`;
  `selectQuests returns exactly QUEST_COUNT_PER_WEEK keys for every PrimaryGoal`;
  `volume_up_5pct is ineligible when prevWeekVolumeKg is 0`;
  `target_value is frozen: a mid-week weeklyTarget change does not move an open quest`;
  `questComplete is inclusive at the target`;
  `every QuestDef.metric is a QuestMetric with a definition in §18`.
- `iso-week.test.ts` — `2026-08-31 -> 2026-W36`, `2026-09-06 -> 2026-W36`, `2026-09-07 -> 2026-W37`;
  plus the `r09 §8` boundary vector — a set at `2026-09-07T00:30+05:00` (= `2026-09-06T19:30Z`) has
  `local_day === '2026-09-07'` and falls inside the window `[2026-09-07, 2026-09-13]` while its UTC
  date does not. Constants cross-checked against `docs/research/r09-formulas-and-test-vectors.md` §9
  (`APP_TZ = 'Asia/Almaty'`, UTC+5, no DST) and against `specs/02`'s `rolling7dDays`.
- `achievements.test.ts` — `catalogue has 39 active definitions with unique keys`;
  `every metric key exists on MetricSnapshot`; `every metric key has a row in §16a and a hint message`
  (the pair that closes the "passes while inert" hole); `def.op matches the operator in §16's predicate`;
  `sort values are unique, ascending and multiples of 10`; `every def.icon is one of the six category
  icons`; `a null metric never unlocks and never throws`;
  `lte predicates fire on bf_minus_3 at -3.0`; `already-unlocked keys are not re-emitted`;
  `an ordinary nightly unlock sets source_id 'nightly' and is celebrated`;
  `only the run that observes a bumped CATALOGUE_VERSION sets sweep:<version>, suppresses confetti and
  still awards full XP` (§17);
  `the four named-lift metrics are null and reported in MetricGaps when settings has no mapping` (§16a);
  `buildMetricSnapshot issues at most 14 read statements` (counted on the harness's statement spy).
- `geofence.test.ts` — `bucketDistance(150,150)==='at'`, `(151,150)==='near'`, `(451,150)==='far'`;
  `bucketAccuracy(25)==='fine'`, `(101)==='poor'`; `GymCheckInInput rejects a payload containing lat`.
- `copy-ban-list.test.ts` — `no Gamification string in ru.json or en.json matches a banned pattern`;
  `every Gamification key in ru.json exists in en.json and vice versa`;
  `every ru.json plural declares one, few, many and other` (guards §22);
  `C1..C7 and every achievements.hint.* render for n in {0,1,2,3,5,11,21,101}` through
  `createTranslator({locale:'ru', timeZone:'Asia/Almaty', messages})` — imported directly from
  `use-intl/core` **in the test file**, since §22 ships no runtime translator here — without throwing
  and with no literal `{` left in the output.

```bash
# Cron path locally with an overridden clock (r01 §2.9 verified both endpoints).
# Seed the §10 fixture FIRST — the assertions below are about what the rollup does to it.
npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --file tests/fixtures/gamification-canonical.sql
npx opennextjs-cloudflare build && npx wrangler dev --port 8787 &
# scheduledTime forced to 2026-09-16T00:20+05:00 == 2026-09-15T19:20:00Z == 1789500000000
# (verified with Intl/Asia/Almaty), so the run rolls THROUGH 2026-09-15 — the fixture's last day —
# and the assertions below hold. Using 1789413600000 (a day earlier) rolls only through 09-14 and
# leaves current_days at 4, mid-decay: the test is clock-sensitive, so pass `time` explicitly.
curl -s "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=20+19+*+*+*&time=1789500000000&format=json"
# PASS: {"outcome":"ok","noRetry":false}

# The DoD against local D1. `DB` is the BINDING name, which is what every other spec's verification
# block uses (specs/01) and the only identifier that is stable: wrangler.jsonc in this repo says
# database_name "fitness-pwa-db" while specs/01 still says "fitness-db" — a real drift, FLAGGED to the
# owner; passing either literal here would break as soon as the other is fixed.
npx wrangler d1 execute DB --local \
  --command "select local_day, status, reason from streak_ledger order by local_day"
# PASS: 2026-09-05 grace | 2026-09-06 freeze | 2026-09-07 missed with reason EXACTLY
#       'none|decay:5->2|cover_cap' (the §9a format), and NO status outside
#       {active,rest,grace,freeze,missed}
npx wrangler d1 execute DB --local \
  --command "select count(*) from streak_ledger where reason like 'none|decay:5->2|cover\_cap' escape '\'"
# PASS: 1
npx wrangler d1 execute DB --local \
  --command "select current_days, longest_days, current_weeks, freezes_remaining from streak_state"
# PASS: 10 | 10 | 2 | 2
#       ("current_days is never 0 at any prefix" is NOT observable from a final-state select —
#        it is asserted by streak.test.ts's per-prefix fuzz case, where it belongs.)
npx wrangler d1 execute DB --local --command "select count(*) from achievement_unlocks"
# PASS: >= 1  (first_workout at minimum)
npx wrangler d1 execute DB --local --command "select min(xp) from xp_ledger"
# PASS: >= 1  — no non-positive XP row can exist
npx wrangler d1 execute DB --local \
  --command "select count(*) from xp_ledger where source_kind = 'set'"
# PASS: 0  — `set` is retired (§14)
npx wrangler d1 execute DB --local --command "pragma table_info(gym_checkins)"
# PASS: no column named lat, lon, latitude or longitude
npx wrangler d1 execute DB --local --command "pragma table_info(workouts)"
# PASS: no gym_lat / gym_lon column — valid ONLY under Data requirement 8's recorded decision
#       (remove). If the owner overrides to (b) keep-and-coarsen, this line changes in the same
#       commit; see Open question 1.
npx playwright test tests/e2e/gamification-grace-day.spec.ts
# PASS: finishing a workout advances the chip IN-SESSION via projectToday (§9a) — not at 00:20;
#       the chip reads the same number after a skipped day (grace), where "same" is measured after
#       the rollup has closed that day; a missed day renders a number >= 1 plus copy C3; an
#       achievement sheet appears on the first workout.
```

`r09` contains **no** gamification vectors — its §8 supplies the day-boundary and rolling-window
vectors and §9 the `APP_TZ` constant, both referenced above; §2 extends its counted-set list with
`amrap`. The streak ledger, level curve and adherence vectors are defined here (§10, §12, §14) and are
the oracle for these tests.

## Open questions

1. **`workouts.gym_lat` / `gym_lon` — DECIDED (a) remove; this line tracks owner sign-off only, and it
   has a deadline: before migration 0001 is applied.** Escalated out of "open" because Phase 0 is
   scaffolding the repo now, `specs/02` declares applied migrations immutable, and the Verification block
   asserts the column's absence — so leaving it genuinely open means either a permanently red assertion
   or an `-- APPROVED-BREAKING` `DROP COLUMN` later. (a) Remove; gym presence lives only in
   `gym_checkins` as a boolean plus a bucket, which is what the brief asks for. (b) Keep but round to
   3 dp (~110 m) and document it as a coarse location. **Decision: (a)** — a per-workout coordinate is a
   movement history of a single identified person; rounding reduces precision but not the fact of the
   trail, and nothing in the feature set needs it. To be recorded in `DECISIONS.md`. If the owner
   overrides to (b), Data requirement 8, the `pragma table_info(workouts)` line and `specs/15`'s export
   column list all change in that same commit.
2. **Does a `rest` day extend the daily streak, or only hold it?** (a) Extend (+1), as specified —
   showing up with data is the behaviour to reinforce, and the weekly streak keeps the training count
   honest. (b) Hold only — stricter, but makes a deliberate rest day feel like a penalty.
   **Recommendation: (a)**; it is the whole point of separating the two ledgers.
3. **Weekly target: fixed, or auto-adapted after a long absence?** (a) Fixed at the user's 2–7, with C6
   merely *offering* a lower target on return. (b) Auto-lower to `max(2, floor(target/2))` after 14
   unearned days, auto-restore after two met weeks. **Recommendation: (a)** — silently changing the
   denominator inflates adherence % and breaks the one metric we promised is honest; C6 gets the
   behavioural benefit with consent.
