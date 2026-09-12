# 09 — Programs, routines, auto-progression and deloads

## Purpose

The training-plan layer: a program is an ordered cycle of days, each day maps to a routine, and each
routine row carries explicit targets (sets, reps, RPE, rest, progression scheme). Progression engines
turn logged history into the next prescription; deloads reduce that prescription on a schedule or on
an accepted request. Satisfies brief module 3 (*"prebuilt templates (PPL, Upper/Lower, Full-body,
5/3/1, GZCLP, nSuns); routine builder; auto-progression schemes; scheduled deload weeks"*) and
Phase 3's DoD.

**This spec blocks on two migrations and three cross-spec amendments**, all listed in §Data →
*Schema amendments* and §Open questions. Nothing in Phase 3 can be built before `specs/02-data-model.md`
ships the new tables and columns named there — four of the tables this module reads exist in no
migration today.

## Scope

- `programs → program_days (cycle week × day) → routines → routine_exercises` and its Zod schemas.
- Routine builder: create/duplicate/reorder/delete routines, add exercises, edit targets, group supersets.
- Six prebuilt templates as **data modules** (typed consts, zero logic), each with a `provenance`
  record and a `verification: 'verified' | 'unverified'` flag.
- Five pluggable progression strategies behind one `next(history, config) → RawPrescription`
  signature, each with its own failure/reset rule. `next()` never rounds and never reads a clock.
- Deload application: scheduled every N weeks, or proposed-then-accepted (plateau, manual, illness),
  modelled as `deload_blocks` rows (02's table, 14's `source` values).
- Scheduling: materialising the plan into local days, resolving today's workout, shifting on a missed
  day, expiring stale plans, exposing planned-day status for adherence.
- `prescribeRoutine()` — the function spec 06's prefill layer calls to turn a routine into targets.
  It is the **only** caller of `plateMath()` in this module.

### Out of scope

| Excluded | Owner |
|---|---|
| Table DDL, column types, units, migrations, `addLocalDays`/`diffLocalDays` | `specs/02-data-model.md` |
| Set logging, rest timer, superset runtime, ghosting, PR detection, `workout_exercises` writes | `specs/06-workouts.md` |
| `plateMath()`, `warmupSets()`, `e1rmComposite()`, `pct1RM()`, `toGrams()`, `COUNTED_SET_TYPES` | `specs/07-calculators.md` |
| Exercise rows, exercise picker sheet, custom exercises, `load_mode` seeding | `specs/08-exercise-library.md` |
| Plateau **detection** (e1RM flatline), `evaluateDeload()`, AI deload-suggestion copy | `specs/14-ai-coach-and-notifications.md` |
| Streak / adherence / XP **arithmetic** and copy — 09 exposes per-day status only | `specs/13-gamification.md` |
| Dexie stores, `MirrorTable`/`OP_TYPES`/`PULL_ONLY` registries, outbox flush, `POST /api/sync/batch` | `specs/05-pwa-offline-sync.md` |
| `requireSessionOr401()`, `jsonError()`, the error envelope | `specs/04-auth.md`, `specs/01-architecture.md` |
| Volume charts, per-muscle weekly volume | `specs/12-analytics-dashboard.md` |
| Program export/import payload shape | `specs/15-data-portability.md` |
| Bundle-budget harness and `perf-budgets.json` wiring | `specs/16-testing-ci-quality.md` |

## Files to create

| Path | Responsibility |
|---|---|
| `src/lib/programs/types.ts` | All domain types below, plus the frozen `SET_TYPE_FOR_KIND` map. No logic. |
| `src/lib/programs/schema.ts` | Zod schemas for everything crossing a trust boundary (form, op payload, import). |
| `src/lib/programs/constants.ts` | `INCREMENT_UPPER_G`, `INCREMENT_LOWER_G`, `GZCLP_T2_RESTART_BUMP_G`, `DELOAD_MIN_DAYS_BETWEEN`, `DELOAD_DEFAULT_POLICY`, `STALE_PLAN_DAYS`, `MAX_ROUTINE_ROWS`, `SET_EXECUTION_SEC`, `ROW_SETUP_SEC`, `ROUTINE_ROW_HEIGHT_PX`, `PROG_BANNED_TOKENS`. (`WORKING_STIMULUS_TYPES` lives in `history.ts`, next to the filter that uses it.) |
| `src/lib/programs/history.ts` | `effectiveRpe()`, `workingSetsOf()`, `RowHistory` assembly from mirror/D1 rows. Pure. |
| `src/lib/programs/progression/index.ts` | `PROGRESSION_REGISTRY`, `getStrategy(id)`, `isUsable(config)`; the only place strategies are named. |
| `src/lib/programs/progression/{double-progression,linear,percent-of-tm,amrap-driven,amrap-reps-threshold}.ts` | One file per engine: reps-then-weight + 3-strike reduction; per-session increment + set/rep **stages**; weekly percentage tables off a Training Max; TM delta from AMRAP rep count; AMRAP-rep threshold (GZCLP T3, bodyweight, assisted). |
| `src/lib/programs/rounding.ts` | `roundPrescription()` — the **only** `plateMath()` call site in this module. |
| `src/lib/programs/deload.ts` | `deloadTransform()`, `deloadRoutine()`, `isDeloadWeek()`, `resolveDeloadPolicy()`, `activeBlockFor()`. |
| `src/lib/programs/schedule.ts` | Pure plan maths: `materialise`, `resolveToday`, `shiftOverdue`, `expireStale`, `plannedDays`. |
| `src/lib/programs/prescribe.ts` | `prescribeRoutine()`, `estimatedMinutes()` — routine + state + history → targets. |
| `src/lib/programs/templates/index.ts` | `PROGRAM_TEMPLATES`, `getTemplate(id)`, `templateHash()`, verification filter. |
| `src/lib/programs/templates/{ppl-6day,upper-lower-4day,full-body-3x}.ts` | r/Fitness PPL 6-day — main lifts `double_progression` with `repMin === repMax === 5` + 3-strike reduction (rule 6); Upper/Lower 4-day (app-authored, no external provenance claimed); r/Fitness Basic Beginner Routine A/B 3×/week. |
| `src/lib/programs/templates/{wendler-531-beginners,gzclp,nsuns-531-lp}.ts` | 5/3/1 for Beginners (3-week cycle + TM Test Week); GZCLP T1/T2/T3 4-day, 3 stages per tier; nSuns 531 LP — structure ships, percentages gated (rule 10). |
| `src/server/programs/repo.ts` | Every D1 read/write for this module. One statement per row, never the multi-row `values(array)` form (rule 24). |
| `src/server/programs/activate.ts` | Template or custom program → rows: `programs`, `routines`, `routine_exercises`, `program_days`, `exercise_progression_state`, `program_schedule`. Children first, `is_active = 1` last. |
| `src/server/programs/op-appliers.ts` | The `OP_SCHEMAS` / `OP_APPLIERS` entries 09 registers into 05's `src/server/sync/apply-op.ts` (rule 26). ≤ 10 statements per op. |
| `src/app/api/programs/today/route.ts` | `GET` today's prescription bundle as JSON (also SW-precached). `force-dynamic`. |
| `src/app/api/programs/[programId]/schedule/route.ts` | `GET` a plan window (`from`, `to`). |
| `src/app/api/programs/[programId]/shift/route.ts` | `POST` applies the daily shift + stale expiry; idempotent per local day. |
| `src/app/api/programs/activate/route.ts` | `POST` activates a template or a custom program. **Online-only** (rule 26c). |
| `src/app/(app)/programs/page.tsx`, `…/[programId]/page.tsx` | Program list + template gallery; program detail (cycle grid, deload marker, Training Max table). Static shells, client-fetched (04 rule 8). |
| `src/app/(app)/routines/[routineId]/edit/page.tsx` | Routine builder page. Static shell. |
| `src/components/programs/{TemplateGallery,RoutineBuilder,RoutineExerciseRow}.tsx` | Template cards with provenance + unverified badge; reorderable list with superset grouping; one row (exercise, target summary, drag handle, swipe actions) at `ROUTINE_ROW_HEIGHT_PX`. |
| `src/components/programs/{TargetSheet,ProgressionPicker}.tsx` | Bottom sheet editing sets/reps/RPE/rest for one row; strategy select + config form driven by that strategy's Zod schema. |
| `src/components/programs/{TodayCard,DeloadBanner,DeloadProposalCard}.tsx` | Dashboard card (today's routine, shifted/deload state, Start CTA); calm accepted-deload banner; proposal card with Accept / Not now. |
| `tests/unit/programs/{double-progression,linear-gzclp,percent-of-tm-531,amrap-driven,amrap-reps-threshold,deload,schedule,rounding,prescribe}.test.ts` | Vectors G1–G21, D1–D4, S1–S3, M1–M4, R1–R3, P1–P2 (see Verification). |
| `tests/unit/programs/activate.test.ts` | Vector A1: activation replayed on an in-memory `node:sqlite` copy of the migrations (02's `migration-replay.test.ts` pattern), killed between chunks and re-run. |
| `tests/unit/programs/templates.test.ts` | Every template parses; `isUsable()` verdict per template; numbers match a checked-in snapshot; both increment constants and the T2 bump asserted. |
| `tests/e2e/programs-ppl-cycle.spec.ts` | Activate PPL → log a session → next session's targets increased → three misses → load eased. |
| `tests/e2e/programs-offline-start.spec.ts` | Offline: open today's routine, start a workout, targets come from the Dexie mirror, banner rendered. |

`src/db/schema/programs.ts` is created and owned by `specs/02-data-model.md`; this spec only states
which tables and columns it needs (§Data → *Schema amendments*).

## Interfaces

**Units, stated once.** Every **prescribed or carried** mass in this module is an **integer number of
grams** (`…G`), matching `specs/02-data-model.md` rule 8(b): progression state is multiplied by
percentages session after session, and integer grams is what stops the drift that float kilos
accumulate. Every **logged** mass arrives as 02's `real` kilograms and is converted once, at the read
boundary in `repo.ts`, with 07's `toGrams()`. Rest is seconds; instants epoch-ms UTC; local days are
`'YYYY-MM-DD'` in `Asia/Almaty` in their own text column (r02 §2.8, 02 rule 5). Plate math is already
integer grams (r09 §6), so nothing converts twice.

```ts
// src/lib/programs/types.ts
import type { LoadMode, SetType, PlateInventory, PlateStatus } from '@/lib/calc';   // 07
export type LocalDay = string;                     // 'YYYY-MM-DD', Asia/Almaty

export type ProgressionStrategyId =
  | 'none' | 'double_progression' | 'linear' | 'percent_of_tm'
  | 'amrap_driven' | 'amrap_reps_threshold';

export type PlannedSetKind = 'warmup' | 'working' | 'amrap' | 'backoff';
/** `kind → sets.set_type` when spec 06 writes a completed set. `backoff` is working stimulus that
 *  is not the top set; 02's SET_TYPES has no `backoff` value, so it maps to `working`. */
export const SET_TYPE_FOR_KIND: Record<PlannedSetKind, SetType> = {
  warmup: 'warmup', working: 'working', amrap: 'amrap', backoff: 'working',
};

export interface PlannedSet {
  kind: PlannedSetKind;         // `amrap` renders "5+" and is the only rep-minimum kind
  reps: number;                 // int >= 1 — the CURRENT target the engine produced
  pctOfTm: number | null;       // 0.30..1.10 of TM; null => weight comes from progression state
  targetRpe: number | null;     // 6..10 step 0.5 (r09 §2 grid); null => not prescribed
}

export interface RoutineExerciseTarget {
  routineExerciseId: string; exerciseId: string;
  position: number;                    // 0-based, dense (02's column name)
  supersetGroup: number | null;        // shared group = one superset (spec 06 runs the timer)
  tier: 1 | 2 | 3 | null;              // GZCL tiers; null for non-tiered templates
  loadMode: LoadMode;                  // from exercises.load_mode — branches every rule below
  plannedSets: PlannedSet[];           // 1..12 — the authoritative shape of the day
  restSeconds: number;                 // 30..600 (02's routine_exercises.rest_sec)
  strategy: ProgressionStrategyId;
  config: ProgressionConfig;           // discriminated on `kind`; always mirrors `strategy`
  notes: string | null;
}

export interface PerformedSet {
  position: number;
  setType: SetType;             // ALL FIVE of 02's SET_TYPES, `amrap` included
  weightG: number | null;       // external or added load; NULL for a pure bodyweight set (02)
  assistG: number | null;       // assistance, not load (02 rule 10) — assisted machines only
  reps: number | null;          // 0 = attempted and missed; null = not applicable
  rpe: number | null;           // CANONICAL (rule 5b)
  rir: number | null;           // derived fallback only
  completedAtMs: number;
}

export interface SessionHistoryEntry {
  workoutId: string; localDay: LocalDay; routineExerciseId: string | null;
  prescribedSetCount: number;   // how many working-stimulus sets the plan asked for
  sets: PerformedSet[];         // ALL sets as logged; engines filter (rule 5a)
  stageAtTime: number | null; trainingMaxGAtTime: number | null; wasDeload: boolean;
}

/** Keyed by `routine_exercise_id`, NOT by exercise: GZCLP runs Squat as T1 on D1 and T2 on D3 with
 *  independent stage, weight and failure counts, and nSuns repeats a lift across days (rule 8). */
export interface RowHistory {
  routineExerciseId: string; exerciseId: string; loadMode: LoadMode;
  sessions: SessionHistoryEntry[]; // DESC by localDay then completedAtMs; [0] = most recent.
                                   // HARD LIMIT 3 (rule 25) — no engine reads further back.
  consecutiveFailures: number;     // read from exercise_progression_state, NOT recomputed
  currentStage: number;            // 0-based index into config.stages; 0 when there are none
  nextWeightG: number | null;      // engine-owned carry; null until a session exists
  nextAssistG: number | null;      // assisted rows only
  nextRepsTarget: number | null;   // reps-only progression (bodyweight)
  trainingMaxG: number | null;
  tmCycleIndex: number | null;     // last cycle whose TM bump was applied (rule 9)
  needsRetest: boolean;            // GZCLP final-stage failure, `retest_5rm`
  lastStage0WeightG: number | null;// GZCLP T2 `bump_from_stage0` restart basis
}

export type WeightSource =
  | 'pct_of_tm' | 'carried' | 'ghost' | 'bodyweight' | 'unset';

export interface RawPrescribedSet {
  setIndex: number; kind: PlannedSetKind; reps: number; targetRpe: number | null;
  targetWeightG: number | null;    // UNROUNDED external/added load; null => user enters it,
                                   // or `bodyweight` (never 0 as a placeholder)
  targetAssistG: number | null;    // UNROUNDED assistance, assisted rows only
  weightSource: WeightSource;
}

export interface ProgressionStateDelta {   // persisted on workout START, not finish (rule 21)
  nextWeightG: number | null; nextAssistG: number | null; nextRepsTarget: number | null;
  consecutiveFailures: number; currentStage: number;
  trainingMaxG: number | null; tmCycleIndex: number | null;
  needsRetest: boolean; lastStage0WeightG: number | null;
}

/** What an engine returns. No rounding, no plate inventory, no bar — see rule 12. */
export interface RawPrescription {
  routineExerciseId: string; exerciseId: string; loadMode: LoadMode;
  strategy: ProgressionStrategyId; tier: 1 | 2 | 3 | null;
  sets: RawPrescribedSet[];
  stage: number; trainingMaxG: number | null; isDeload: boolean;
  reasons: string[];                 // i18n keys only, e.g. 'prog.reason.loadEasedTenPct'
  stateDelta: ProgressionStateDelta;
}

export interface Rounding {
  requestedG: number; achievedG: number; errorG: number;   // achieved - requested, signed
  status: PlateStatus;               // 'EXACT' | 'ROUNDED' | 'BELOW_BAR' | 'NO_INVENTORY' (07)
  mode: 'plates' | 'increment';      // plate lattice, or a fixed equipment increment
}
export interface PrescribedSet extends RawPrescribedSet { rounding: Rounding | null; }
export interface Prescription extends Omit<RawPrescription, 'sets'> {
  sets: PrescribedSet[]; restSeconds: number; supersetGroup: number | null; position: number;
}

export interface ProgressionStrategy<C extends ProgressionConfig> {
  readonly id: ProgressionStrategyId;
  readonly configSchema: z.ZodType<C>;
  /** PURE: same inputs => same output. No clock, no random, no I/O, NEVER THROWS, never rounds. */
  next(history: RowHistory, config: C): RawPrescription;
}

// ── Templates ────────────────────────────────────────────────────────────────────────────────
export interface TemplateProvenance {
  url: string | null;                // null only for app-authored templates
  note: string;                      // metrication, chosen midpoints, caveats — always populated
  candidates?: ReadonlyArray<{ label: string; url: string; table: unknown }>;  // rule 10
}
export interface TemplateRow {
  exerciseSlug: string;              // resolved to exercises.slug at activation
  tier: 1 | 2 | 3 | null; supersetGroup: number | null; restSeconds: number;
  strategy: ProgressionStrategyId; config: ProgressionConfig;
  plannedSets: PlannedSet[];
  /** Percentages the sources corroborate but we could not verify against a primary. Ignored by the
   *  loader unless `settings.allow_unverified_templates = 1` (rule 10). */
  unverifiedPctOfTm?: readonly (number | null)[];
}
export interface TemplateDay { cycleWeekIndex: number; dayIndex: number; label: string;
  rows: readonly TemplateRow[] }
export interface ProgramTemplate {
  id: string; kind: 'ppl' | 'upper_lower' | 'full_body' | '531' | 'gzclp' | 'nsuns';
  nameKey: string;                   // i18n key, never literal copy
  weeksPerCycle: number; daysPerWeek: number; repeatWeek: boolean;
  minRestDays: number; preferredWeekdayMask: number;   // 0 = any day (rule 17)
  days: readonly TemplateDay[];      // length === weeksPerCycle * daysPerWeek
  deload: DeloadPolicy | null;       // null => the generic default
  verification: 'verified' | 'unverified';
  provenance: TemplateProvenance;
}
export interface ProgramRow {
  id: string; name: string; kind: ProgramTemplate['kind'] | 'custom'; templateId: string | null;
  weeksPerCycle: number; daysPerWeek: number; repeatWeek: boolean;
  minRestDays: number; preferredWeekdayMask: number;
  deloadEveryNWeeks: number | null; lastDeloadWeekIndex: number | null;
  startedOn: LocalDay | null; lastShiftOn: LocalDay | null; isActive: boolean;
}
export interface ProgramDayRow { id: string; programId: string; cycleWeekIndex: number;
  dayIndex: number; routineId: string; label: string }
```

```ts
// src/lib/programs/schema.ts — Zod 4 (stack-facts.md pins zod 4.6.2)
const gramsIncrement = z.number().int().min(0).max(25_000);   // 0 legal for reps-only progression

export const zDoubleProgressionConfig = z.object({
  kind: z.literal('double_progression'),
  sets: z.number().int().min(1).max(12),
  repMin: z.number().int().min(1).max(30), repMax: z.number().int().min(1).max(30),
  incrementG: gramsIncrement,
  targetRpe: z.number().min(6).max(10).multipleOf(0.5).nullable(),
  failuresBeforeReduce: z.number().int().min(1).max(5).default(3),
  reducePct: z.number().min(0.02).max(0.30).default(0.10),
}).refine((c) => c.repMax >= c.repMin, 'repMax must be >= repMin');

export const zStage = z.object({                          // set/rep stages, applied in order on failure
  sets: z.number().int().min(1).max(12), reps: z.number().int().min(1).max(30),
  lastSetAmrap: z.boolean(),
});
export const zLinearConfig = z.object({
  kind: z.literal('linear'),
  incrementG: gramsIncrement,
  stages: z.array(zStage).min(1).max(6),                   // length 1 = no staging
  onFinalStageFailure: z.enum(['reduce_pct', 'retest_5rm', 'bump_from_stage0']),
  reducePct: z.number().min(0.02).max(0.30).default(0.10),
  retestPctOf5rm: z.number().min(0.70).max(0.95).default(0.85),
  bumpG: z.number().int().min(0).max(15_000).default(0),    // `bump_from_stage0` only (rule 7)
  minTotalReps: z.number().int().min(1).nullable(),         // success threshold across working sets
});

/** `pct` is nullable so a STRUCTURE-ONLY row (nSuns, rule 10) is representable: reps and AMRAP
 *  positions are known, the percentage is not, and the user enters the weight. */
export const zSetRow = z.object({
  kind: z.enum(['warmup', 'working', 'amrap', 'backoff']).default('working'),
  reps: z.number().int().min(1).max(30),
  pct: z.number().min(0.30).max(1.10).nullable(),
});
export const zPercentOfTmConfig = z.object({
  kind: z.literal('percent_of_tm'),
  tmPctOf1rm: z.number().min(0.80).max(0.95),              // 0.90 for 5/3/1
  weeks: z.array(z.array(zSetRow).min(1)).min(1).max(12),  // weeks[cycleWeekIndex]
  tmIncrementGPerCycle: z.number().int().min(0).max(10_000),
  tmResetCycles: z.number().int().min(1).max(6).default(3),
});
export const zAmrapDrivenConfig = z.object({
  kind: z.literal('amrap_driven'),
  tmPctOf1rm: z.number().min(0.80).max(0.95),
  sets: z.array(zSetRow).min(1).max(12),
  /** `.min(0)`, NOT `.min(2)`: the shipped nSuns template must parse with an empty table so the
   *  gallery can list it. A table of fewer than 2 entries is not *usable* — `isUsable()` gates
   *  activation instead (rule 10). Entries ascending and non-overlapping on `minAmrapReps`. */
  increments: z.array(z.object({
    minAmrapReps: z.number().int().min(0),
    tmDeltaG: z.number().int().min(-15_000).max(15_000),
  })).min(0),
});
export const zAmrapRepsThresholdConfig = z.object({
  kind: z.literal('amrap_reps_threshold'),
  sets: z.number().int().min(1).max(12),
  reps: z.number().int().min(1).max(30),
  thresholdReps: z.number().int().min(1).max(60),          // GZCLP T3: 25 on the AMRAP set
  onThreshold: z.enum(['add_weight', 'add_rep']),
  incrementG: gramsIncrement,                              // `add_weight` only
});
export const zProgressionConfig = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  zDoubleProgressionConfig, zLinearConfig, zPercentOfTmConfig,
  zAmrapDrivenConfig, zAmrapRepsThresholdConfig,
]);
export type ProgressionConfig = z.infer<typeof zProgressionConfig>;

/** Parse-time validity is not usability. `isUsable` is the activation gate: false => the row cannot
 *  be started and the UI asks for the missing input. */
export function isUsable(c: ProgressionConfig): { ok: true } | { ok: false; code: string };
```

```ts
// src/lib/programs/history.ts
export const WORKING_STIMULUS_TYPES = ['working', 'drop', 'failure', 'amrap'] as const;
export function workingSetsOf(e: SessionHistoryEntry): PerformedSet[];   // filters by the above
/** `rpe` is canonical (02's CHECK `sets_rpe_range`; 06 writes `rir = 10 - rpe`). This is the ONE
 *  place the fallback lives, so an RIR-only import cannot make every RPE gate pass vacuously. */
export function effectiveRpe(s: PerformedSet): number | null;   // s.rpe ?? (s.rir == null ? null : 10 - s.rir)
```

```ts
// src/lib/programs/deload.ts
export interface DeloadPolicy {
  mode: 'generic' | 'template_week' | 'tm_test';
  everyNWeeks: number | null;   // null = never scheduled
  durationDays: number;         // 7 (rule 13)
  setMultiplier: number;        // 0.60 => -40% working sets
  loadMultiplier: number;       // 0.90 => -10% load
  targetRpe: number;            // 6    => RIR >= 4
  cutTier3First: boolean;
}
export type DeloadReason = 'scheduled' | 'plateau' | 'manual' | 'illness';
export interface DeloadBlock {
  id: string; programId: string; startsOn: LocalDay; endsOn: LocalDay;
  volumeMultiplier: number; intensityMultiplier: number;
  source: 'scheduled' | 'ai_suggested' | 'manual';   // 02's enum
  policy: DeloadPolicy; reason: DeloadReason;        // both inside policy_json
  acceptedAt: number | null;                         // null = PROPOSED, changes nothing (rule 15)
  deletedAt: number | null;                          // dismissed
}
export function deloadTransform(p: RawPrescription, policy: DeloadPolicy): RawPrescription;
/** Whole-routine pass: `cutTier3First` needs every row in scope before any set is cut (rule 13). */
export function deloadRoutine(ps: readonly RawPrescription[], policy: DeloadPolicy): RawPrescription[];
export function isDeloadWeek(weekIndex: number, policy: DeloadPolicy,
  lastDeloadWeekIndex: number | null): boolean;
export function activeBlockFor(blocks: readonly DeloadBlock[], day: LocalDay): DeloadBlock | null;
export function resolveDeloadPolicy(t: ProgramTemplate | null, user: Partial<DeloadPolicy>): DeloadPolicy;

// src/lib/programs/schedule.ts — all pure; the caller supplies `today`.
export interface ScheduleRow {
  id: string; programId: string; routineId: string;
  sequenceIndex: number;        // monotonic position in the program; never rewritten, never reused
  weekIndex: number;            // PROGRAM-ABSOLUTE = floor(sequenceIndex / daysPerWeek) — rule 2
  cycleWeekIndex: number;       // = weekIndex % weeksPerCycle — the program_days / weeks[] key
  dayIndex: number; plannedOn: LocalDay;            // column `planned_on` (02's `_on` convention)
  status: 'planned' | 'completed' | 'skipped' | 'expired';
  shiftCount: number; workoutId: string | null;
}
export function materialise(i: {
  programDays: readonly Pick<ProgramDayRow, 'cycleWeekIndex' | 'dayIndex' | 'routineId'>[];
  programId: string; fromLocalDay: LocalDay; days: number;
  startSequenceIndex: number;   // = max(existing sequence_index) + 1, or 0 on activation
  daysPerWeek: number; weeksPerCycle: number;
  minRestDays: number; weekdayMask: number;   // bit 0 = Monday … bit 6 = Sunday; 0 = any day
}): Omit<ScheduleRow, 'id'>[];                // PURE: `repo.ts` mints the ULIDs (02 rule 1)
export function resolveToday(rows: readonly ScheduleRow[], today: LocalDay):
  { due: ScheduleRow | null; upcoming: ScheduleRow[]; isRestDay: boolean };
export function shiftOverdue(rows: readonly ScheduleRow[], today: LocalDay, minRestDays: number):
  { updated: ScheduleRow[] };
export function expireStale(rows: readonly ScheduleRow[], today: LocalDay):
  { expired: ScheduleRow[]; nextSequenceIndex: number };
/** At most ONE entry per local day (rule 20), so spec 13's days-shaped denominator holds. */
export function plannedDays(rows: readonly ScheduleRow[], from: LocalDay, to: LocalDay):
  { day: LocalDay; status: ScheduleRow['status']; shifted: boolean; isDeload: boolean }[];

// src/lib/programs/rounding.ts — the ONLY plateMath() call site in this module
export function roundPrescription(p: RawPrescription, ctx: {
  barG: number; plateInventory: PlateInventory; incrementG: number | null;
}): Prescription;

// src/lib/programs/prescribe.ts
export function prescribeRoutine(input: {
  routine: readonly RoutineExerciseTarget[];
  histories: Readonly<Record<string, RowHistory>>;             // keyed by routineExerciseId
  weekIndex: number;                                           // program-absolute
  weeksPerCycle: number;
  deload: { active: boolean; policy: DeloadPolicy };
  barGByExercise: Readonly<Record<string, number>>;             // bar + collars (r09 §6)
  incrementGByExercise: Readonly<Record<string, number | null>>;// dumbbell/machine snap, else null
  plateInventory: PlateInventory;
}): { prescriptions: Prescription[]; estimatedMinutes: number };
export function estimatedMinutes(ps: readonly Prescription[]): number;   // rule 22
```

## Behaviour

### Plan shape and scheduling

1. **A program is a cycle, not a calendar.** `weeks_per_cycle × days_per_week` defines an ordered
   sequence; `program_days(cycle_week_index, day_index) → routine_id` is the only mapping.
   `weeks_per_cycle = 1` + `repeat_week = 1` means every week is identical (PPL, Upper/Lower,
   Full-body, GZCLP). 5/3/1 for Beginners uses `weeks_per_cycle = 3`.
2. **`weekIndex` is program-absolute; `cycleWeekIndex` is the cycle key.** Exactly one convention,
   derived from the schedule row and nothing else:
   ```
   weekIndex      = floor(sequenceIndex / days_per_week)     // 0, 1, 2, … forever
   cycleWeekIndex = weekIndex % weeks_per_cycle              // 0 .. weeks_per_cycle-1
   cycleIndex     = floor(weekIndex / weeks_per_cycle)
   ```
   `program_days` and `percent_of_tm`'s `weeks[]` are indexed by **`cycleWeekIndex`**;
   `isDeloadWeek()` and `deload_every_n_weeks` use **`weekIndex`**. Deriving from `sequenceIndex`
   rather than from the calendar means a shift or an expiry never renumbers a week. `cycleIndex` is
   derived, never stored; the only persisted cycle marker is
   `exercise_progression_state.tm_cycle_index` (rule 9).
3. **One active program at a time, enforced by the database.** `programs` carries
   `UNIQUE(is_active) WHERE is_active = 1`. Activation deactivates the incumbent and activates the new
   program **in one `db.batch()`** (rule 24). A deactivated program keeps its rows and its
   `exercise_progression_state`, so reactivating resumes where it stopped.
4. **Builder rules.** A routine needs ≥ 1 row to be startable, capped at `MAX_ROUTINE_ROWS = 20`
   (see Data → query budget). Reordering rewrites `position` densely from 0 using 06's two-phase
   renumber, because `routine_exercises` carries `U(routine_id, position)` (02 rule 14). Dropping row A
   onto B gives both `superset_group = max(existing) + 1`; removing one row of a 2-row superset clears
   the survivor's group. The same exercise may appear twice in one routine — that is what
   `routine_exercise_id`-keyed state is for (rule 8). Deleting a routine referenced by `program_days`
   is refused with `PROGRAM_DAY_REFERENCES_ROUTINE` (the UI offers "replace with…"). Deleting a
   `routine_exercise` is a **soft delete via `deleted_at`** (02 rule 25 — there is no `is_deleted`
   column anywhere in this app), so completed workouts keep their link and their state row survives.

### Reading history

5. **What an engine may read.**
   (a) **Set filter.** `WORKING_STIMULUS_TYPES = {working, drop, failure, amrap}`. `amrap` is in the
   set because it is the sole input of `amrap_driven` and of every GZCLP `+` set — excluding it, as an
   earlier draft did, silently discarded the one set that drives progression. This matches
   `specs/13-gamification.md` rule (`COUNTED_SET_TYPES = working | drop | failure | amrap`) and
   **requires `specs/07-calculators.md` to add `'amrap'` to `COUNTED_SET_TYPES`** — flagged, not
   assumed (Open question 4). Warm-ups are always excluded.
   (b) **RPE is canonical, RIR is a fallback.** `effectiveRpe(s) = s.rpe ?? (s.rir == null ? null : 10 - s.rir)`,
   computed in exactly one helper at the read boundary. r09 §2 records the failure mode this closes:
   with both columns writable and only `rir` populated, every RPE gate passes vacuously and double
   progression advances off sets taken to failure.
   (c) **Scope.** `sessions[0]` is the latest session of that **routine exercise row** under this
   program; sessions logged outside it are ignored, so an ad-hoc session can never advance the plan.
   `sessions` is capped at **3** entries (rule 25).
   (d) **Session completeness.** A session counts as a success candidate only when
   `workingSetsOf(e).length >= e.prescribedSetCount`. A session with **zero** working-stimulus sets is
   **ignored entirely**: no state change, `reasons: ['prog.reason.noWorkingSets']`.
6. **Targets are explicit, never implied.** `plannedSets` is an array, so "3×8–12", "5×3 with the last
   set AMRAP" and 5/3/1's "5 @65%, 5 @75%, 5+ @85%, then 5×5 @65%" are one data shape. Rep *ranges*
   live in the progression config (`repMin`/`repMax`); `plannedSets[i].reps` always holds the
   **current** target the engine produced. `kind` distinguishes a warm-up ramp, the top set, an AMRAP
   and a back-off block — rules 13 and 14 both depend on it, and `zSetRow.kind` carries it through
   template data.

### The five engines

7. **double_progression.** Success = the session is complete (rule 5d), **every** working set hit
   `repMax`, **and**, where `targetRpe` is set, no working set's `effectiveRpe` exceeded `targetRpe`
   → `nextWeightG += incrementG`, targets reset to `repMin`, failures 0, reason
   `prog.reason.repTargetMet`. Partial (all sets ≥ `repMin`, not all at `repMax`) → hold weight,
   targets become `min(repMax, worstSetReps + 1)`, failures unchanged, reason
   `prog.reason.holdWeight`. Failure (any working set < `repMin`) → hold weight,
   `consecutiveFailures += 1`. At `consecutiveFailures === failuresBeforeReduce` (default 3) →
   `nextWeightG = round(nextWeightG × (1 − reducePct))` (default 0.10), targets reset to `repMin`,
   failures 0, reason `prog.reason.loadEasedTenPct`. Verified PPL rule: *"After failing a session 3
   consecutive times, Take 10% off your working weights"*
   ([thefitness.wiki PPL](https://thefitness.wiki/reddit-archive/a-linear-progression-based-ppl-program-for-beginners/)).
   **This is the strategy the PPL template's main lifts ship**, with `repMin === repMax === 5` for the
   source's fixed-rep work, because it is the only engine that counts misses.
8. **linear.** Every session of that row adds `incrementG` when the stage's prescribed total reps (or
   `minTotalReps`) were completed. Verified increments: *"2.5kg/5lbs"* for bench/row/OHP/squat and
   *"5kg/10lbs"* for deadlift (PPL, same source); GZCLP prints *"Add 5 lbs to the Bench Press and
   Overhead Press and 10 lbs to the Squat and Deadlift"*
   ([thefitness.wiki GZCLP](https://thefitness.wiki/routines/gzclp/), re-verified 2026-09-12).
   **Decision — metrication:** ship `INCREMENT_UPPER_G = 2500` / `INCREMENT_LOWER_G = 5000` for every
   lb-only source, using the PPL page's own dual printing ("2.5kg/5lbs") as precedent; never convert
   5 lb → 2.268 kg at runtime. Failure → `currentStage += 1` **at the same weight** (*"If you fail to
   complete the total number of reps, move to the next Stage"* — the source does not change the
   weight, and we do not invent one), reason `prog.reason.nextStage`.
   Last-stage failure follows `onFinalStageFailure`, three explicit values:
   - `'reduce_pct'` → `× (1 − reducePct)`, back to stage 0.
   - `'retest_5rm'` → `needsRetest = true`, `sets: []`, reason `prog.gzclp.retest5rm`. GZCLP T1:
     *"Test for a new 5 rep max. Use 85% of this weight to restart the cycle."* The retest is submitted
     through `retest.submit` (rule 26) — a pure engine cannot invent one.
   - `'bump_from_stage0'` → `nextWeightG = lastStage0WeightG + bumpG`, back to stage 0. GZCLP T2:
     *"Find the last weight you lifted using Stage 1"*, *"add 15-20 lbs to this to restart the cycle"*.
     `bumpG = GZCLP_T2_RESTART_BUMP_G = 7500`. **15–20 lb is 6.80–9.07 kg; 7.5 kg (16.5 lb) is a
     chosen point inside that range, not a conversion** — the constant is named in `constants.ts`, the
     range is quoted in `provenance.note`, and `templates.test.ts` asserts the constant alongside the
     two increments.
   `zLinearConfig` intentionally has **no** `failuresBeforeReduce`: linear escalates through stages,
   not through a miss counter. Any row that needs a 3-strike rule uses `double_progression` (rule 7).
9. **percent_of_tm.** `targetWeightG = Math.round(TM_G × pct)` per set, from
   `weeks[cycleWeekIndex]` — a set row with `pct: null` yields `targetWeightG: null` and
   `weightSource: 'unset'`. Verified tables
   ([5/3/1 for Beginners](https://thefitness.wiki/routines/5-3-1-for-beginners/)):
   wk1 *"5 reps @ 65%, 5 reps @ 75%, 5+ reps @ 85%, 5 sets of 5 reps @ 65%"*; wk2 *"3 reps @ 70%,
   3 reps @ 80%, 3+ reps @ 90%, 5×5 @ 70%"*; wk3 *"5 reps @ 75%, 3 reps @ 85%, 1+ reps @ 95%,
   5×5 @ 75%"*; optional warm-up *"5 reps @ 40%, 5 reps @ 50%, 3 reps @ 60%"* — of **TM**, not of the
   working weight; do not conflate with r09 §7's `WARMUP_RAMP`. The three top sets ship as
   `kind: 'working'`, `'working'`, `'amrap'`; the 5×5 block ships as `kind: 'backoff'`; the ramp ships
   as `kind: 'warmup'`. TM = `tmPctOf1rm × e1RM` — *"90% of the estimated 1RM"*, and *"Most variants
   will set the Training Max at either 85% or 90% of the 1RM"*
   ([5/3/1 Primer](https://thefitness.wiki/5-3-1-primer/)). **TM seeding is gated:** only e1RM from
   sets with `reps ≤ 8` is eligible, because r09 §2 vector R6 shows a 12-rep RPE-8 set inflating e1RM
   to 159.49 kg off a 100 kg working set; the seeded TM is always shown for explicit confirmation and
   never written silently. Per completed cycle `TM += tmIncrementGPerCycle` (*"Add 5lbs to the TM of
   upper body lifts… Add 10lbs to the TM lower body lifts"* → 2500 / 5000 g), applied **once** per
   cycle, guarded by `tmCycleIndex < cycleIndex`. If the top AMRAP set missed its reps in **every**
   week of a cycle, reduce TM by `tmResetCycles × tmIncrementGPerCycle` (*"reduce it by three cycle
   increments (15lbs / 30lbs)"* → −7500 upper / −15000 lower).
10. **amrap_driven, and the nSuns gate.** Reads the top `kind: 'amrap'` set's reps from
    `sessions[0]`, picks the highest `increments[]` entry with `minAmrapReps ≤ reps`, applies
    `TM += tmDeltaG`. No AMRAP set logged → TM unchanged, reason `prog.amrap.noTopSet`.
    **The nSuns increment table is UNVERIFIED:** three independent secondary sources give three
    contradictory lb tables — `0-1→0 / 2-3→+5 / 4-5→+5-10 / 5+→+10-15`
    ([fitnessvolt](https://fitnessvolt.com/nsuns-program/)), the same with `6+→+10-15`
    ([liftvault](https://liftvault.com/programs/powerlifting/n-suns-lifting-spreadsheets/)), and
    `0-1→−10 / 2-3→0 / 4-5→+5 / 6+→+10` ([iridium](https://iridium.fit/blog/nsuns-program-guide)) —
    and the primary source (the author's own spreadsheet, published on Reddit) is not machine-readable
    from here. **Decision, replacing the earlier open question:**
    - The template **always ships and is always listable**, with `verification: 'unverified'`, an
      `increments: []` table, and all three candidates in `provenance.candidates` for the UI to offer.
      It parses (`zAmrapDrivenConfig.increments` is `.min(0)`).
    - `isUsable()` returns `{ ok: false, code: 'AMRAP_TABLE_REQUIRED' }` while `increments.length < 2`,
      so activation asks the user to pick or type a table. That is the only gate on the structure.
    - Its 9-set T1 percentages (`75×5, 85×3, 95×1+, 90×3, 85×3, 80×3, 75×5, 70×5, 65×5+`, corroborated
      by the same three sources) live in `TemplateRow.unverifiedPctOfTm` and are copied into
      `plannedSets[i].pctOfTm` **only** when `settings.allow_unverified_templates = 1`; otherwise every
      `pct` is `null`, the structure (9 sets, rep counts, AMRAP positions) is used, and every weight is
      user-entered. Activating **with** the percentages while the flag is off returns
      `UNVERIFIED_TEMPLATE_BLOCKED`.
    - The T2 8-set percentages are not shipped at all — sources contradict outright.
11. **amrap_reps_threshold** — the fifth engine, added because GZCLP T3's verified rule (*"Add weight
    when you can do 25 reps on your AMRAP set"*, re-verified 2026-09-12) is expressible by none of the
    other four: `double_progression` keys off per-set rep ranges, `linear` off prescribed totals
    (3×15 is already 45 reps and the rule concerns the last set only), and both TM engines require a
    Training Max that a T3 accessory does not have. Rule: read the top `amrap` set's reps from
    `sessions[0]`; if `reps >= thresholdReps` then
    - `onThreshold: 'add_weight'` → `nextWeightG += incrementG` for `load_mode ∈ {external, bodyweight_plus}`,
      or `nextAssistG = max(0, nextAssistG − incrementG)` for `assisted` (rule 19);
    - `onThreshold: 'add_rep'` → `nextRepsTarget = (nextRepsTarget ?? config.reps) + 1`, weight
      untouched — the only progression a pure `bodyweight` row can make.
    Otherwise hold, reason `prog.reason.holdWeight`. Reps below `thresholdReps` never count as a
    failure and never touch `consecutiveFailures`.

### Rounding, deloads

12. **One owner of rounding: `prescribeRoutine()`.** Engines return `RawPrescription` with unrounded
    `targetWeightG` / `targetAssistG` and **no** `rounding` field at all — they receive neither a bar
    weight nor a plate inventory, so they could not honestly produce one. The pipeline is
    `next()` → `deloadRoutine()` → `roundPrescription()`, in that order, so a deload's `× 0.90` is
    rounded once, onto the lattice, instead of producing an unloadable 56.25 kg.
    `roundPrescription()` behaviour, per set:
    - `load_mode ∈ {duration, distance}` or `targetWeightG == null` → `rounding: null`.
    - a fixed equipment increment (`incrementG != null`: dumbbells, machines, assisted stacks) →
      snap to the nearest multiple, `mode: 'increment'`, `status: 'EXACT' | 'ROUNDED'`. Never plate math.
    - otherwise call 07's `plateMath(kg, barKg, inv, mode)` with `mode: 'nearest'` (upward tie-break)
      for working/amrap/backoff sets and `mode: 'roundDown'` for `kind: 'warmup'` (r09 §7).
    `rounding` carries 07's **`status`**, which the UI must surface, because 07 returns four of them
    and `null`:
    | status | `achievedG` | UI |
    |---|---|---|
    | `EXACT` | = requested | the number alone |
    | `ROUNDED` | nearest lattice entry | `"102.0 kg (+0.1)"` — the brief's honest-data principle |
    | `BELOW_BAR` | `barG` | "lighter than the bar — use a lighter implement" |
    | `NO_INVENTORY` (or `plateMath()` returned `null`) | **= requested, never `barG`** | "no plate inventory yet — showing the raw target" + a link to settings |
    02's default `plate_inventory_json` is `'[]'`, so `NO_INVENTORY` is the **first-run** state: a 40 kg
    target must render as 40 kg with a chip, never silently as the 20 kg bar.
13. **Deload, scheduled.** `deload_every_n_weeks` defaults to **6** and `durationDays` to **7**. Verified
    from [Bell et al. 2022, *Front Sports Act Living* 4:1073223](https://doi.org/10.3389/fspor.2022.1073223)
    (re-fetched 2026-09-12): frequency *"between four to six weeks, on average"*; duration *"The typical
    duration of a deload is one week"*, with the caveats *"It can be a few days"* and *"I generally
    don't like to do more than six days… a deload in excess of that likely means we're going to be
    reversing some of the adaptation"* — the earlier draft's *"5 to 7 days"* quote does **not** appear
    in the paper and is removed. We keep a 7-day **block** so that every training day of the week is
    covered, and note the six-day caveat: with `min_rest_days ≥ 1` a 7-day block contains at most 4–6
    training days, which satisfies it. A deload block keeps the same routines on the same days —
    *"training frequency will typically remain unchanged (relative to normal training frequency)"* —
    and `deloadTransform` changes each prescription:
    - working/amrap/backoff sets → `max(1, Math.round(count × setMultiplier))`, default 0.60 (−40%,
      inside the verified band: *"reduce their volume, roughly [by] 25%"*, *"pull volume back by
      two-thirds, half"*, Table 3 *"A reduction in training volume by approximately 30%–50%"*);
    - `targetWeightG → Math.round(× loadMultiplier)`, default 0.90 (*"reduce intensity…by about 10%"*);
      `targetAssistG → Math.round(÷ loadMultiplier)` (less load means **more** assistance, rule 19);
    - `targetRpe = 6` (= RIR 4: *"all training sets should be terminated with at least four repetitions
      in reserve"*);
    - `kind: 'amrap'` becomes `kind: 'working'` at the rep count it was prescribed at, so an AMRAP
      cannot smuggle a maximal effort into a recovery week;
    - `cutTier3First` drops whole `tier: 3` prescriptions **before** any tier-1/2 set is cut
      (*"reduce accessory volume"*); back-off (`kind: 'backoff'`) blocks are cut before top sets;
    - no progression state advances (`stateDelta` equals the current state), and `workouts.was_deload = 1`
      suppresses PR detection (spec 06) and every TM change.
14. **Deload, template-specific.** `percent_of_tm` programs may use `mode: 'template_week'` — the
    documented 5/3/1 deload is `40%×5, 50%×5, 60%×5` of TM, the historical week-4 prescription; current
    5/3/1 has dropped it (*"Past iterations of 5/3/1 involved a deload week every 4th week… it is
    outdated and no longer used"*, Primer), so this mode exists only for users who ask. 5/3/1 for
    Beginners instead ships `mode: 'tm_test'`, `everyNWeeks: 9` (*"every 10th week, or after three
    3 week cycles"* — with `weekIndex` program-absolute this fires at weeks 9, 18, 27, exactly as
    written), running **TM Test Week**: *"5 reps at 70%, 5 reps at 80%, 3 reps at 90%, 3-5 reps at
    100%"* — ≥ 3 reps at 100% TM confirms the TM, fewer than 3 re-seeds it from that set's e1RM (Primer).
15. **Deload, requested: propose, then accept.** `deload.request` inserts a **`deload_blocks`** row
    (02's table, not a `deload_events` table this app does not have) with `accepted_at = null`,
    `source ∈ {ai_suggested, manual}` and the resolved policy + reason in `policy_json`. **Nothing is
    transformed while `accepted_at` is null** — `activeBlockFor()` ignores proposed blocks. `deload.accept`
    sets `accepted_at` and writes `programs.last_deload_week_index = weekIndex`; `deload.dismiss` sets
    `deleted_at`, and the proposal does not return for the rest of that week. This is the flow spec 14
    already implies with its `accepted_at` column, and it means an AI-derived change to the user's
    training is never applied without consent and is always undoable — the brief's honest-data
    principle. Spec 14 detects the plateau (`evaluateDeload()`); this spec applies the result.
    **Idempotency and lock:** a new block's `starts_on` must be ≥ **42 days** after the last accepted
    block's `starts_on` (`DELOAD_MIN_DAYS_BETWEEN = 42`, aligned with 14's `weeksSinceLastDeload ≥ 6`,
    replacing the earlier inconsistent 21 days); a request inside the window returns
    `{ applied: false, code: 'DELOAD_TOO_SOON', nextEligibleLocalDay }`. `U(program_id, starts_on)`
    (02) is the double-apply guard. A **scheduled** block (`isDeloadWeek()` true, no block covering the
    week) is inserted with `source: 'scheduled'` and `accepted_at` set immediately: the user consented
    to the cadence when they activated the program, and a banner they must approve every six weeks is
    nagging, not consent.
16. **`isDeloadWeek()`, stated as arithmetic** (no prose, so a test cannot encode a guess):
    ```
    anchor = lastDeloadWeekIndex ?? 0
    isDeloadWeek(weekIndex) = everyNWeeks !== null
                           && weekIndex > anchor
                           && (weekIndex - anchor) % everyNWeeks === 0
    ```
    With `everyNWeeks = 6` and no history this fires at weeks 6, 12, 18. A plateau deload accepted in
    week 4 sets `anchor = 4` and pushes the next scheduled one to week 10, then 16. Because `weekIndex`
    is program-absolute it keeps working in cycle 2 and beyond.
    `resolveDeloadPolicy(template, user)`: field-wise, `user` (non-`undefined`) beats
    `template.deload` beats `DELOAD_DEFAULT_POLICY`.

### Calendar

17. **`materialise()` places days explicitly.** Fully specified so it is implementable, and taking
    `programDays` rather than a `ProgramTemplate` so a program built in the routine builder
    materialises through the same function:
    ```
    isoWeekday(d)  = 1..7, Monday = 1, from the 'YYYY-MM-DD' string at UTC noon
    eligible(d)    = weekdayMask === 0 || ((weekdayMask >> (isoWeekday(d) - 1)) & 1) === 1
    pd(i)          = programDays[(startSequenceIndex + i) % programDays.length]
                     // programDays ORDERED BY (cycle_week_index, day_index)
    cursor = fromLocalDay
    for i = 0, 1, 2, … while diffLocalDays(fromLocalDay, cursor) < days:
        while not eligible(cursor): cursor = addLocalDays(cursor, 1)
        emit { programId, sequenceIndex: startSequenceIndex + i, plannedOn: cursor,
               weekIndex: floor((startSequenceIndex + i) / daysPerWeek),
               cycleWeekIndex: weekIndex % weeksPerCycle,
               dayIndex: pd(i).dayIndex, routineId: pd(i).routineId,
               status: 'planned', shiftCount: 0, workoutId: null }   // `id` minted by repo.ts
        cursor = addLocalDays(cursor, minRestDays + 1)
    ```
    `startSequenceIndex` is `0` on activation and `expireStale().nextSequenceIndex` on
    re-materialisation, which is how `sequenceIndex` continuity is preserved without the function
    needing to see the existing rows. `sequenceIndex` is never rewritten and never reused:
    activation **upserts** on `U(program_id, sequence_index)` (a retry cannot duplicate the plan);
    re-materialisation only ever **appends** indices above the highest existing one.
18. **`min_rest_days` is a count of rest days.** `min_rest_days = n` means the gap between two sessions
    is `n + 1` calendar days. GZCLP's *"Leave at least one rest day between each workout"* is therefore
    `min_rest_days = 1` → sessions land on today and today+2. `min_rest_days = 0` permits back-to-back
    days (PPL's 6-day week).
19. **Bodyweight, added load and assistance.** Every rule above branches on `exercises.load_mode`
    (02's `LOAD_MODE`; there is no `exercises.is_bodyweight` column, and `sets.weight_kg` is **NULL**,
    never 0, for a pure bodyweight set):
    | `load_mode` | prescription | progression | permitted strategies |
    |---|---|---|---|
    | `external` | `targetWeightG` | weight up | all |
    | `bodyweight` | `targetWeightG: null`, `weightSource: 'bodyweight'`, reps only | `nextRepsTarget += 1` | `amrap_reps_threshold` (`add_rep`), `none` |
    | `bodyweight_plus` | `targetWeightG` = **added** load; `0` is legal and means "bodyweight only" | added load up | all |
    | `assisted` | `targetAssistG`; `targetWeightG: null` | assistance **down**; every comparison inverts, floor 0 | `double_progression`, `amrap_reps_threshold`, `none` |
    | `duration`, `distance` | no weight, no reps target | none | `none` only |
    A row whose `strategy` is not permitted for its `load_mode` fails validation with
    `LOAD_MODE_STRATEGY_MISMATCH`. PPL's pull-ups and dips are `bodyweight` rows and progress on reps;
    they never sit at `targetWeightG: null` / `weightSource: 'unset'` forever.
20. **Today, shifting, expiry, skipping, adherence.**
    (a) `resolveToday()` returns the `planned` row with the **lowest `sequenceIndex`** whose
    `plannedOn ≤ today`. If none and the next planned row is in the future, `isRestDay = true` and
    `upcoming[0]` renders as "next up". Never two due rows.
    (b) **A missed day shifts the plan; it never scolds.** Once per local day (guarded by
    `programs.last_shift_on`), overdue `planned` rows are compacted forward from `today` in
    `sequenceIndex` order, honouring `min_rest_days` (rule 18). `shiftCount += 1`; **status stays
    `planned`**, no `skipped` row is created, and no copy anywhere uses a banned token (rule 28). The UI
    reads `shiftCount > 0` and renders `prog.today.moved`.
    (c) **Stale plans expire rather than pile up.** If the oldest overdue row is more than
    `STALE_PLAN_DAYS = 14` behind, overdue rows become `status = 'expired'` (a neutral state, never
    surfaced as failure), and the plan re-materialises from today at
    `expireStale().nextSequenceIndex`, so the cycle position is preserved. The returning user sees one
    calm line, `prog.today.resume`.
    (d) **Explicit skip.** `scheduleDay.skip` sets `status = 'skipped'`, consumes the row, and lets the
    next `sequenceIndex` become due. Skipping is the only way a routine is recorded as not performed,
    and `scheduleDay.unskip` restores `planned` within the same local day.
    (e) **Adherence: 13 owns every number.** This module exposes `plannedDays(from, to)` only. Contract:
    at most **one entry per local day** (if `min_rest_days = 0` puts two rows on one day the entry takes
    the most-completed status, ranked `completed > planned > skipped > expired`), so spec 13's
    days-shaped denominator holds; a **shifted** day is never a miss on the day it moved off; **expired**
    and **skipped** are planned-and-not-completed; a **deload** day counts exactly like a training day
    (`isDeload: true` is informational); a **rest** day produces no entry at all. **No adherence formula
    lives in this spec** — `specs/13-gamification.md` rule 10 (`ratio = completed / planned`,
    `ADHERENCE_WINDOW_DAYS = 28`) is the single owner, and 13's `adherence()` input must accept this
    per-day mapping (Open question 5). Nothing here ever writes a streak.

### Starting a workout, states, validation

21. **Starting a workout from a routine — one path, agreed with spec 06.** The earlier draft had 09
    writing prefilled `sets` rows with `target_reps` / `target_weight_kg` / `is_prefilled` columns.
    **None of those columns exist**, `sets.completed_at` and `sets.workout_exercise_id` are
    `NOT NULL` (02), and spec 06's own matrix says `sets` is written "insert per **completed** set".
    The single path is:
    - spec 06 rule 5 copies `routine_exercises` into `workout_exercises`, carrying 02's existing
      `target_sets`, `target_reps_low`, `target_reps_high`, `position` and `superset_group`;
    - `prescribeRoutine()` output is handed to 06's **prefill layer** (`prefillFor()`), which fills
      `PendingSet.weightKg` / `reps` in the Dexie draft. Per-set targets live in the draft and in the
      `prescriptionCache` mirror row, never in D1;
    - `sets` rows are created **on completion**, as 06's `set.create` ops, with
      `set_type = SET_TYPE_FOR_KIND[plannedSet.kind]` — so a `backoff` set is stored as `working`
      (02's `SET_TYPES` has no `backoff` value) and an AMRAP set is stored as `amrap`, which is what
      keeps rule 5a's filter and `amrap_driven` fed on the next session;
    - `workouts.was_deload` (a new column with a constant default, §Data) records the deload flag 06 needs.
    Weight resolution order: `pct_of_tm` → `carried` (`nextWeightG`) → `ghost` (last session's working
    weight, 06) → `bodyweight` → `unset` (`null`, empty field — **never `0`**, which would yield a 0 kg
    e1RM per r09 §1's bodyweight gotcha). `stateDelta` persists on **start**, not finish, so an
    abandoned session cannot silently re-advance targets; 06 reverts it if a workout is discarded with
    zero logged sets.
    **Ownership of double progression:** 09 owns it for every row that belongs to a routine.
    `src/lib/workout/progression.ts` keeps its ad-hoc, ghost-based suggestion for exercises logged
    **outside** a routine, and its `ProgressionConfig` type must be renamed `SuggestionConfig` so two
    unrelated types do not share a name across the codebase (Open question 3).
22. **`estimatedMinutes`, stated as arithmetic** (a return field and a `routines.est_minutes` column
    cannot be defined by prose). `SET_EXECUTION_SEC = 45`, `ROW_SETUP_SEC = 60`:
    ```
    plain row r with n sets:      ROW_SETUP_SEC + n*SET_EXECUTION_SEC + (n-1)*r.restSeconds
    superset group g, rounds = max member set count:
        ROW_SETUP_SEC*|g| + rounds*(|g|*SET_EXECUTION_SEC) + (rounds-1)*max(member restSeconds)
    estimatedMinutes = ceil( sum(all of the above) / 60 )
    ```
    It is computed on the **final** (post-deload, post-rounding) prescription set, so a deload week
    honestly reads shorter. `routines.est_minutes` caches the same formula over the routine's saved
    targets and is rewritten on every `routine.upsert`.
23. **Empty / loading / error states.** No program → the Today card shows the template-gallery CTA
    (`prog.today.noProgram`), not an empty box. Rest day → `prog.today.rest`. Zero-row routine →
    `prog.builder.empty` + disabled Start. No history → `targetWeightG = null`,
    `weightSource: 'unset'`, reason `prog.reason.firstSession`. `needsRetest` → that row renders a
    `prog.retest.cta` action instead of targets and the rest of the routine still starts. Empty plate
    inventory → rule 12's `NO_INVENTORY` chip. Loading → three shimmer rows at exactly
    `ROUTINE_ROW_HEIGHT_PX`, Start rendered but disabled (no layout shift). D1 unreachable on start →
    the workout starts from the Dexie mirror + `prescriptionCache` with the banner
    `prog.offline.stale`; logging is never blocked.
24. **D1 budgets (r02 §2.7/§4.7 — the cap is per *statement*, not per batch).** The binding limit is
    **100 bound parameters per statement**, so a parameterised multi-row insert caps at
    `floor(100 / columnCount)` rows — for `routine_exercises` (13 app columns + 02's 4 `syncCols()`)
    that is **5 rows**, not 20. Therefore: **one `INSERT` statement per row, never the multi-row
    `values(array)` form.** `MAX_ROUTINE_ROWS = 20` keeps a routine save at ≤ 21 statements, far under
    the **1000 statements per invocation** ceiling; history reads use one
    `WHERE routine_exercise_id IN (…)` list of ≤ 20 ids (20 parameters). **Activation recovery:** the
    `programs` row is inserted with `is_active = 0` **first**, every child table next, and a final
    statement flips `is_active = 1` — so a run that dies part-way leaves an inert, invisible program
    rather than an active one with no routines. Every child insert is
    `ON CONFLICT … DO UPDATE` on its natural key (`routines U(program_id, day_index)`,
    `routine_exercises U(routine_id, position)`, `program_days U(program_id, cycle_week_index, day_index)`,
    `exercise_progression_state U(routine_exercise_id)`, `program_schedule U(program_id, sequence_index)`),
    so a re-run is a no-op; on top of that, 05's `mutations` ledger makes the whole request idempotent
    on its op id (02 rule 3).
25. **History reads are bounded.** `RowHistory.sessions` is capped at **`LIMIT 3` per routine exercise
    row** — no engine reads past `sessions[0]`, stage/failures/TM all come from
    `exercise_progression_state`, and an unbounded "all sets ever" read for 20 rows would burn D1
    rows-read, CPU and a slice of the 128 MB isolate for nothing. The limit is asserted in the
    Verification `d1 execute` step.
26. **Every mutation is an offline-replayable op, except activation.**
    (a) **No Server Actions in this module.** `specs/01-architecture.md` rule 16 requires anything the
    offline queue replays to be a Route Handler (Background Sync re-POSTs a plain `Request`), and rule
    17 would require each action to call `requireSession()` itself. Both are satisfied by routing
    every mutation through 05's `POST /api/sync/batch`, which is already `requireSession()`-gated.
    (b) **Op types 09 registers** into 05's `OP_TYPES` / `OP_SCHEMAS` / `OP_APPLIERS` — each ≤ 10
    statements, 05's per-op ceiling: `routine.upsert`, `routine.delete`, `routineExercise.upsert`,
    `routineExercise.delete`, `scheduleDay.skip`, `scheduleDay.unskip`, `deload.request`,
    `deload.accept`, `deload.dismiss`, `trainingMax.set`, `retest.submit`. The builder enqueues **one op
    per changed row** (exactly as 06 does with `workoutExercise.create`), so a 20-row routine save is
    21 ops — under 05's `MAX_OPS_PER_BATCH = 50`.
    (c) **Activation is the one online-only mutation**, `POST /api/programs/activate`: it writes a
    program, up to 6 routines, up to 120 `routine_exercises`, `program_days`, state rows and a 28-day
    schedule — far past 05's 10-statements-per-op ceiling, and it is a rare, deliberate setup action.
    The template gallery's CTA is disabled offline with `prog.template.needsConnection`.
    (d) `retest.submit(routineExerciseId, weightG, reps)` is what closes rule 8's `retest_5rm` loop:
    it writes `next_weight_g = round(weightG × retestPctOf5rm)`, `current_stage = 0`,
    `needs_retest = 0`. Without it the retest state was a dead end no declared API could leave.
27. **Auth and validation.** All four Route Handlers call `requireSessionOr401(request)` as their
    **first** statement and are wrapped so failures become `jsonError(request, error)` — `401 JSON`,
    never a `302` (01 rules 18–19, 04 rule 8). No page in `src/app/(app)/programs` or
    `…/routines/[routineId]/edit` calls `requireSession()` or touches a binding: they are static shells
    that client-fetch, because a dynamic app-group page drops out of Serwist's precache (04 rule 8).
    Every op payload and query parses with its Zod schema; failures return
    `{ ok: false, code, fieldErrors }`. Codes: `UNAUTHENTICATED`, `ROUTINE_EMPTY`,
    `ROUTINE_TOO_MANY_ROWS`, `REP_RANGE_INVERTED`, `INCREMENT_OUT_OF_RANGE`,
    `LOAD_MODE_STRATEGY_MISMATCH`, `AMRAP_TABLE_REQUIRED`, `TM_REQUIRED`, `TM_IMPLAUSIBLE`
    (> 500 kg or > 2.5 × latest bodyweight), `PROGRAM_DAY_REFERENCES_ROUTINE`, `DELOAD_TOO_SOON`,
    `UNVERIFIED_TEMPLATE_BLOCKED`.
28. **i18n: RU default, both locales, locale-aware ban list.** The brief requires RU/EN with RU
    default, so **no user-visible string in this module is a literal** — every one is a key under
    `prog.*` in `messages/{ru,en}.json`, `reasons[]` included.

    | key | RU | EN |
    |---|---|---|
    | `prog.today.noProgram` | Выберите программу | Pick a program |
    | `prog.today.rest` | Отдых — дальше «{routine}», {when} | Rest day — next up {routine}, {when} |
    | `prog.today.moved` | перенесено на сегодня | moved to today |
    | `prog.today.resume` | Продолжаем: неделя {week}, день {day} | Picking up at Week {week}, Day {day} |
    | `prog.deload.banner` | Восстановительная неделя — так и задумано | Recovery week — lighter on purpose |
    | `prog.deload.detail` | подходы −40%, вес −10% | sets −40%, load −10% |
    | `prog.deload.proposed` | Предложена разгрузка | Deload suggested |
    | `prog.builder.empty` | Добавьте первое упражнение | Add your first exercise |
    | `prog.offline.stale` | Цели из последней синхронизации | Targets from your last sync |
    | `prog.retest.cta` | Проверить 5ПМ | Retest 5RM |
    | `prog.template.unverified` | Проценты не подтверждены | Percentages unverified |
    | `prog.template.needsConnection` | Нужно подключение — один раз | Needs a connection, once |
    | `prog.reason.firstSession` | Первая сессия — вес за вами | First session — you set the weight |
    | `prog.reason.repTargetMet` | Цель по повторам выполнена | Rep target met |
    | `prog.reason.holdWeight` | Держим вес | Holding the weight |
    | `prog.reason.nextStage` | Следующая ступень | Next stage |
    | `prog.reason.loadEasedTenPct` | Вес снижен на 10% | Load eased 10% |
    | `prog.reason.noWorkingSets` | Нет рабочих подходов | No working sets |
    | `prog.gzclp.retest5rm` | Проверьте новый 5ПМ | Test a new 5RM |
    | `prog.amrap.noTopSet` | Подход AMRAP не записан | No AMRAP set logged |

    The ban list is **token sets per locale**, not an English substring check:
    ```
    PROG_BANNED_TOKENS = {
      ru: ['пропустил', 'пропущен', 'провал', 'отстал', 'отстаёшь', 'сорвал', 'серия потеряна'],
      en: ['missed', 'failed', 'behind', 'streak lost', 'lazy'],
    }
    ```
    A unit test asserts no `prog.*` value in either message file contains a token from its own locale's
    set; the e2e asserts the same over the rendered DOM in the active locale. The load-reduction chip is
    `prog.reason.loadEasedTenPct` precisely so the copy the e2e demands is not the copy the ban list
    forbids — the earlier draft's "reduced after 3 misses" failed its own assertion.

## Data

Canonical DDL is owned by `specs/02-data-model.md`; this section states the **exact** surface this
module needs, in 02's naming and units, and the migration it blocks on. Per r02 §2.8 / 02 rules 4–8:
`integer({ mode: 'boolean' })` for flags, `integer({ mode: 'timestamp_ms' })` for instants,
`text` + GLOB CHECK for local days, **integer grams for prescribed and configured masses**, `real` kg
only for logged masses, `` .default(sql`(unixepoch() * 1000)`) `` never `defaultNow()`.

### Schema amendments spec 02 must ship for Phase 3 (this spec blocks on them)

`specs/02-data-model.md`'s `programs.ts` block today defines `programs`, `routines`,
`routine_exercises` and `deload_blocks` only. Four tables this module reads exist in no migration.
Every item below is **additive** (new table, or new nullable column / new column with a constant
default), so it needs no `-- APPROVED-BREAKING:` gate under 02 rule 21.

| Table | Change |
|---|---|
| `programs` | **ADD** `template_id?`, `provenance_json?` C(len≤65536), `days_per_week` INT default 1, `repeat_week` bool default 1, `min_rest_days` INT default 0, `preferred_weekday_mask` INT default 0, `deload_every_n_weeks?` INT, `deload_policy_json?`, `last_deload_week_index?` INT, `last_shift_on?` localDay. **ADD** `U(is_active) WHERE is_active = 1`. Existing `name`, `description?`, `kind`, `is_active`, `started_on?`, `weeks_per_cycle?` are used as-is (`started_on`, not `started_local_day`). |
| `program_days` | **NEW**: `program_id →programs`, `cycle_week_index` INT, `day_index` INT, `routine_id →routines`, `label`, `U(program_id, cycle_week_index, day_index)`, `I(program_id)`. |
| `routines` | **ADD** `est_minutes?` INT. Soft delete is `syncCols().deleted_at` — there is no `is_deleted` column. `U(program_id, day_index)` for activation idempotency. |
| `routine_exercises` | **ADD** `tier?` INT C(1..3), `planned_sets_json` C(len≤65536), `progression_config_json` C(len≤65536), `notes?`. Existing `position` (not `order_index`), `rest_sec`, `superset_group?`, `progression_scheme`, `increment_g?`, `target_*` and `U(routine_id, position)` are used as-is; `deleted_at` is the soft delete. |
| `exercise_progression_state` | **NEW**, keyed by the routine **row**: `routine_exercise_id →routine_exercises`, `program_id →programs`, `exercise_id →exercises`, `training_max_g?` INT, `next_weight_g?` INT, `next_assist_g?` INT, `next_reps_target?` INT, `current_stage` INT default 0, `consecutive_failures` INT default 0, `tm_cycle_index?` INT, `needs_retest` bool default 0, `last_stage0_weight_g?` INT, `last_applied_workout_id?` →workouts, **`U(routine_exercise_id)`**, `I(program_id, exercise_id)`. |
| `program_schedule` | **NEW**: `program_id →programs`, `routine_id →routines`, `sequence_index` INT, `week_index` INT, `cycle_week_index` INT, `day_index` INT, `planned_on` localDay, `status` /*planned\|completed\|skipped\|expired*/, `shift_count` INT default 0, `workout_id?` →workouts, `U(program_id, sequence_index)`, `I(program_id, planned_on, status)` (the today-resolution query). |
| `deload_blocks` | **ADD** `policy_json?` C(len≤65536) carrying `DeloadPolicy` + `reason`. Existing `starts_on`, `ends_on`, `volume_multiplier`, `intensity_multiplier`, `source`, `accepted_at?`, `U(program_id, starts_on)` are used as-is. **There is no `deload_events` table and 09 does not ask for one.** |
| `workouts` | **ADD** `was_deload` bool default 0. The schedule link is `program_schedule.workout_id`, so no `workouts.program_schedule_id` is needed. |
| `settings` | **ADD** `allow_unverified_templates` bool default 0. Bar mass comes from the existing `bar_mass_g` / `ez_bar_mass_g`, plate inventory from `plate_inventory_json`; there is no `settings.default_bar_kg`. |
| `src/db/local-day.ts` | **ADD** `addLocalDays(day: string, n: number): string` and `diffLocalDays(a: string, b: string): number` — pure `'YYYY-MM-DD'` ↔ UTC-noon arithmetic, **no runtime `Intl`** for a stored value (02 rule 5, r09 §4 flags UTC-derived day gaps as an off-by-one source). Rules 17, 18 and 20 are built on them. |

### Read/write matrix

| Table | Columns this module uses | R/W |
|---|---|---|
| `programs` | all of the above | RW |
| `program_days` | `program_id, cycle_week_index, day_index, routine_id, label` | RW |
| `routines` | `program_id, name, day_index, notes, est_minutes, deleted_at` | RW |
| `routine_exercises` | `routine_id, exercise_id, position, superset_group, tier, planned_sets_json, rest_sec, progression_scheme, progression_config_json, increment_g, target_sets, target_reps_low, target_reps_high, target_rpe, notes, deleted_at` | RW |
| `exercise_progression_state` | all of the above | RW |
| `program_schedule` | all of the above | RW |
| `deload_blocks` | `program_id, starts_on, ends_on, volume_multiplier, intensity_multiplier, source, accepted_at, policy_json, deleted_at` | RW |
| `workouts` | `id, routine_id, local_day, was_deload` | R; W only via spec 06's ops |
| `workout_exercises` | `position, superset_group, target_sets, target_reps_low, target_reps_high` | never — spec 06 writes them (rule 21) |
| `sets` | `exercise_id, workout_id, set_type, weight_kg, assist_kg, reps, rpe, rir, e1rm_kg, completed_at, local_day` | R (history) only |
| `exercises` | `id, slug, name, name_ru, equipment, load_mode` | R |
| `settings` | `allow_unverified_templates, plate_inventory_json, bar_mass_g, ez_bar_mass_g, barbell_increment_g, default_rest_seconds` | R |

**KV** (binding `CACHE_KV`, 01's key grammar `<domain>:<subject>:<version>`; 01 requires
`expirationTtl` on **every** write):
- `prog:today:v1:{programId}:{localDay}` → the serialised Today-card payload,
  `expirationTtl: Math.max(60, secondsToLocalMidnight)` — Cloudflare KV rejects a TTL below **60 s**,
  so a write at 23:59:30 would otherwise throw (02 §Data notes the same minimum).
- `prog:tmpl:v1:{templateId}` → `templateHash()`, so the loader and the snapshot test cannot diverge.
  `expirationTtl: 2_592_000` (30 d) — no key is written without one.
KV is eventually consistent, so a write path **returns the freshly computed payload** rather than
re-reading KV after invalidation; `repo.ts` deletes the key on every write and never trusts a read-back.
**R2:** none.

**IndexedDB.** Spec 05 ships **one generic `mirror` store** keyed `[table+id]`, not a store per
entity, so this module needs no new Dexie store — it needs 05's registries widened. Amendments 09
requires of `specs/05-pwa-offline-sync.md` (Open question 2):
- `MirrorTable` **+** `programs`, `program_days`, `routines`, `routine_exercises`,
  `exercise_progression_state`, `program_schedule`, `deload_blocks`.
- `PULL_ONLY` **+** `program_days`, `exercise_progression_state`, `program_schedule`, `deload_blocks`
  (all server-computed; the client proposes changes as ops and reads the result back).
- `OP_TYPES` **+** the eleven op types in rule 26b, with `OP_SCHEMAS` entries rejecting
  server-owned fields (05 rule 26).
- one extra store, `prescriptionCache`, keyed by `programScheduleId`, holding the last
  `{ prescriptions, estimatedMinutes, computedAtMs }` so a workout starts with correct targets offline
  (rule 23). Added as an additive `db.version(n).stores({...})` per 05 rule 17.

**Query budget:** rule 24 (one statement per row; ≤ 100 bound parameters per statement; ≤ 1000
statements per invocation; never `db.batch([])`) and rule 25 (`LIMIT 3` per history read).

## UX notes

- **The builder is a full page, not a sheet** — long-form editing with a keyboard, and a sheet fights
  the exercise-picker sheet that opens on top of it. Target editing *is* a bottom sheet (`TargetSheet`),
  opened by tapping the target summary, numeric keypad focused on the sets field.
- **Reorder:** 200 ms long-press on the handle → `selection` haptic → row lifts on a Motion spring
  (`{ type: 'spring', stiffness: 400, damping: 30 }`) at 1.02 scale; drop fires `impactLight`. Handles
  sit on the **right** edge — right-thumb, one-handed app. **Implementation: Motion + native pointer
  events, no drag-and-drop library.** A dnd library is the single easiest way to blow this route's JS
  budget, and the interaction is one draggable list.
- **Client-JS budget.** `/routines/[routineId]/edit` is the heaviest route this module owns
  (reorderable list + superset gestures + bottom sheet + Zod-driven per-strategy form + Motion
  springs). Budget **100 KB gzipped**, the same as `/programs`; `specs/16-testing-ci-quality.md`'s
  `perf-budgets.json` must add the route (Open question 6). Recharts, visx and any dnd library are
  banned from this route; the cycle grid on `/programs/[programId]` is plain SVG.
- **Touch targets, measured.** `specs/03-design-system.md` rule 8 sets the floor at **≥ 56 px**
  (`min-h-tap`), stricter than WCAG's 44 px, so that is the number: the drag handle (a real
  `<button>`), the swipe-revealed Remove button, every `TargetSheet` stepper and the target-summary tap
  area are all `min-h-tap min-w-tap`, with hit slop from an `::after` pseudo-element rather than
  padding that shifts layout, and ≥ 8 px of dead space between adjacent targets. The Today card's Start
  button is 56 px lime and sits in the bottom third of the dashboard above the tab bar.
- **Fixed row height.** `ROUTINE_ROW_HEIGHT_PX = 88` is exported from `constants.ts` and used by
  **both** `RoutineExerciseRow` and its skeleton, so "three shimmer rows, no layout shift" is an
  assertable claim rather than a hope.
- **Supersets:** drag a row onto another; grouped rows share a 2 px lime bracket down the left gutter
  and one rest-timer chip. Ungrouping is in the sheet, not a gesture — accidental ungrouping mid-edit
  is worse than an extra tap. **Swipe-left** reveals Remove; destructive, so the revealed button must
  be tapped, never delete-on-release (`notificationWarning` haptic on reveal).
- **Deload** uses spec 03's success token `#3ddc97` — **never** red or amber, which read as errors.
  Measured contrast from 03 rule 4: **11.88:1 on `#000000`, 9.61:1 on `#1c1c20`**, both well past AA
  body text. Copy is `prog.deload.banner` + `prog.deload.detail`, fading in once (250 ms) then static.
  A **proposed** (unaccepted) deload renders `DeloadProposalCard` with Accept / Not now — never a
  silently applied change (rule 15). A shifted day gets a plain `prog.today.moved` chip: no icon, no
  colour change, no alert.
- **Unverified badge** is text, never colour alone: `prog.template.unverified` in secondary text
  `#a1a1aa`, measured **8.19:1 on `#000000` / 7.30:1 on `#121214`** (03 rule 4).
- **a11y:** the drag handle is a real `<button>` with `aria-roledescription="sortable"`; ↑/↓ move the
  row and an `aria-live="polite"` region announces "Bench Press, position 2 of 6". Targets are read as
  one string — "3 sets of 8 to 12 reps at RPE 8, rest 2 minutes" — not four unlabelled numbers. Under
  `prefers-reduced-motion` the lift becomes an instant opacity change.

## Risks

| Risk | Mitigation |
|---|---|
| A future edit "corrects" a template's numbers from memory and silently changes the user's training. | `templates.test.ts` snapshots every percentage and increment; each template carries `provenance.url` + `verification`; `prog:tmpl:v1:*` stores `templateHash()`; the snapshot fails on any drift. |
| lb→kg conversion applied twice (2.5 → 1.13 kg) or not at all. | Increments exist only as `INCREMENT_UPPER_G` / `INCREMENT_LOWER_G` / `GZCLP_T2_RESTART_BUMP_G`; no template may hold a literal increment, and `templates.test.ts` asserts all three constants. Integer grams end-to-end (§Interfaces → Units) removes the float path entirely. |
| Warm-up sets counted as working sets → progression advances off a 40% ramp set. | `WORKING_STIMULUS_TYPES` excludes `warmup`; vector **G3** includes a warm-up set that must not change the outcome. |
| An `amrap` set is silently dropped and every `+` set stops driving progression. | `amrap` is inside `WORKING_STIMULUS_TYPES` (rule 5a); vectors **G5** and **G19** store the top set as `set_type: 'amrap'`. |
| GZCLP's Squat-as-T1-and-T2 collapses into one state row and the two tiers corrupt each other. | State, history and `Prescription` are all keyed by `routine_exercise_id`, with `U(routine_exercise_id)`; vector **G18** asserts the two Squat rows diverge inside one cycle. |
| TM seeded from an RPE-inflated e1RM (r09 §2 R6: 159.49 kg off a 100 kg set) → unliftable percentages. | Seeding accepts only e1RM from sets with `reps ≤ 8`, caps at `tmPctOf1rm × best`, and always requires explicit confirmation (rule 9). |
| RIR-only logging makes every RPE gate pass vacuously. | `rpe` is canonical and `effectiveRpe()` is the single fallback boundary (rule 5b); vector **G2b** populates only `rir`. |
| An empty `plate_inventory_json` (02's default `'[]'`) prescribes the bare bar for every set. | `NO_INVENTORY` falls back to the **raw target**, never `barG`, with a chip (rule 12); vectors **R1**/**R2**. |
| The shift runs on every read, burning D1 writes — or runs during prerender and bakes dev data into production (r02 §4.2). | The shift is a write guarded by `last_shift_on`, callable only from `POST /api/programs/[programId]/shift`; the `today` route is `dynamic = 'force-dynamic'`. Never `export const runtime = "edge"` (stack-facts.md). |
| A deload applied twice (scheduled + accepted proposal) halves volume twice. | `DELOAD_MIN_DAYS_BETWEEN = 42` (rule 15) plus 02's `U(program_id, starts_on)`; `activeBlockFor()` returns at most one block per day, and proposed blocks transform nothing. |
| An AI-suggested deload changes training without consent or recourse. | Propose → `accepted_at` → apply; `deload.dismiss` soft-deletes; vector **D3** asserts a proposed block leaves prescriptions byte-identical. |
| An offline prescription from a stale Dexie mirror disagrees with the server on sync. | The client prescription is advisory; the server recomputes on flush and emits a non-blocking "targets updated" toast. Logged sets are never rewritten. |
| Multi-row activation exceeds the 100-**bound-parameter-per-statement** cap, or dies half-way leaving an active program with no routines. | One statement per row (rule 24); `is_active = 1` is the last statement; per-table `ON CONFLICT … DO UPDATE`; 05's `mutations` ledger on top; vector **A1** kills the run mid-way and re-runs. |
| GZCLP's `needsRetest` blocks the whole session; or a holiday leaves a 20-workout backlog. | `needsRetest` suppresses only that row's targets, with an inline `retest.submit` action; `STALE_PLAN_DAYS = 14` expiry handles the backlog with neutral copy. |
| `weekIndex` reads cycle-relative in one place and absolute in another, so deloads never fire (or collide in cycle 2). | One stated convention (rule 2) derived from `sequenceIndex`; `cycleWeekIndex` is the only cycle key; vector **D1b** runs `isDeloadWeek` in cycle 2. |

## Verification

Windows-only dev box: the blocks below are **PowerShell**; `&&` is not a PowerShell operator, so
sequences use `;` + `if ($?)`, and background jobs use `Start-Job`. Run from the repo root.

```powershell
npm run typecheck; if ($?) { npx eslint src/lib/programs src/server/programs src/components/programs }
npx vitest run tests/unit/programs
# PASS: exit 0, 0 lint errors, all suites green, 0 skipped
```

Named cases, one `it()` each. **Weights are written in kg for readability; the asserted values are
integer grams** (`32.5 kg` = `32_500`). Bar **20.0 kg** (`20_000`); plate inventory exactly as
`docs/research/r09-formulas-and-test-vectors.md` §6 — `{25:2, 20:2, 15:1, 10:2, 5:2, 2.5:2, 1.25:2,
0.5:2}`, `minIncrement = 1.0 kg`. Every engine vector asserts the **raw** value from `next()` and then
the **rounded** value from `roundPrescription()`, because those are two different functions with two
different signatures (rule 12).

**Engines**

| ID | Case | Expected (raw → rounded) |
|---|---|---|
| **G1** | `double_progression {sets:3, repMin:8, repMax:12, incrementG:2500}`, last session 12/12/12 @ 30.0, `prescribedSetCount 3` | raw **32.5**, 3×8, failures **0**, reason `prog.reason.repTargetMet` → rounded **32.5**, `EXACT`, `errorG 0` |
| **G1b** | same, last session **2 sets** of 12 (of 3 prescribed) | **hold** 30.0, targets 3×12, failures unchanged — a short session is not a success |
| **G1c** | same, session with **zero** working-stimulus sets | no state change at all, `reasons: ['prog.reason.noWorkingSets']` |
| **G2** | same, last session 12/12/11 | **30.0** held; targets 3×**12**; failures **0** |
| **G2b** | same, `targetRpe: 8`, last session 12/12/12 with `rpe: null` and `rir: 0` on set 3 | `effectiveRpe = 10 > 8` → **not** a success: 30.0 held |
| **G3** | same, last session 12/10/7 **plus a 12.5 kg warm-up set** | 30.0 held; failures **1**; the warm-up changes nothing |
| **G4** | same, `consecutiveFailures: 2`, last session 12/10/7 @ 30.0 | raw **27.0**, targets 3×8, failures **0**, reason `prog.reason.loadEasedTenPct` → rounded **27.0**, `EXACT` |
| **G5** | `linear` GZCLP T1 stage 0 (`5×3+`, `incrementG: 5000`), logged 3/3/3/3/**5 as `set_type: 'amrap'`** @ 60.0 | stage **0**; raw **65.0** → rounded **65.0**, `EXACT` |
| **G5b** | same, all five sets stored as `working` | identical result — the filter accepts both |
| **G6** | same, logged 3/3/3/2 @ 60.0 | stage **1** (`6×2+`); weight **60.0** unchanged; reason `prog.reason.nextStage` |
| **G7a** | `linear` stage 2 (`10×1+`) failed, `onFinalStageFailure: 'retest_5rm'` | `sets: []`, `needsRetest: true`, reason `prog.gzclp.retest5rm`; **no** weight invented |
| **G7b** | then `retest.submit(rowId, 100_000, 5)` with `retestPctOf5rm 0.85` | state → `current_stage 0`, `next_weight_g 85_000`, `needs_retest 0`; next prescription 5×3 @ **85.0** |
| **G7c** | `linear` T2 stage 2 failed, `onFinalStageFailure: 'bump_from_stage0'`, `lastStage0WeightG 60_000`, `bumpG 7_500` | stage **0**, raw **67.5** → rounded **67.5**, `EXACT` |
| **G8** | `percent_of_tm` 5/3/1 cycle week 0, TM 100.0, with the optional warm-up ramp | `40.0×5, 50.0×5, 60.0×3` as `kind:'warmup'` (`roundDown`), then `65.0×5, 75.0×5, 85.0×5+` (`working, working, amrap`), then `5×5 @ 65.0` (`backoff`); every `errorG` **0** (`EXACT`) |
| **G9** | same, cycle week 2 | `75.0×5, 85.0×3, 95.0×1+` then `5×5 @ 75.0`; all `EXACT` |
| **G10** | cycle complete, upper / lower lift, `tmCycleIndex` behind `cycleIndex` | TM 100.0 → **102.5** / **105.0**; applied **once** — a second call with `tmCycleIndex` now current changes nothing |
| **G11** | AMRAP missed in all three weeks, upper / lower | TM 100.0 → **92.5** / **85.0** (3 × increment) |
| **G12a** | `zAmrapDrivenConfig.parse({ …, increments: [{minAmrapReps:0, tmDeltaG:0}] })` | **parses** (the schema is `.min(0)`); `isUsable()` → `{ ok: false, code: 'AMRAP_TABLE_REQUIRED' }` |
| **G12b** | `getTemplate('nsuns-531-lp')` with no flag | returns a template: `verification === 'unverified'`, `increments.length === 0`, `isUsable()` false, every `plannedSets[i].pctOfTm === null`, 9 T1 sets with the AMRAP at index 2, `provenance.candidates.length === 3`, **no** T2 percentages |
| **G12c** | activate nSuns with `unverifiedPctOfTm` requested, `allow_unverified_templates = 0` | `UNVERIFIED_TEMPLATE_BLOCKED`; with the flag `1` → percentages copied into `pctOfTm` |
| **G14** | 5/3/1 `mode: 'tm_test'`, TM 100.0 | `70.0×5, 80.0×5, 90.0×3, 100.0×3+`; 3 reps → TM unchanged; 2 reps → TM re-seeded from that set's e1RM |
| **G18** | one GZCLP program, `re_d1_squat` (T1, stage 0, next 100.0) and `re_d3_squat` (T2, stage 0, next 80.0); D1 logged successful, D3 logged short | `re_d1_squat` → next **105.0**, stage 0; `re_d3_squat` → stage **1**, weight **80.0**; **two distinct state rows**, neither read by the other |
| **G19** | `amrap_reps_threshold {sets:3, reps:15, thresholdReps:25, onThreshold:'add_weight', incrementG:2500}` (GZCLP T3), logged 15/15/**24** then 15/15/**25** | 24 → hold, `prog.reason.holdWeight`; 25 → raw **+2.5 kg**, `prog.reason.repTargetMet` |
| **G20** | pull-up, `load_mode: 'bodyweight'`, `amrap_reps_threshold {sets:3, reps:5, thresholdReps:8, onThreshold:'add_rep'}`; session 1 = 8/8/8 (top `amrap`), session 2 = 6/6/7 | S1 → `nextRepsTarget 6`, prescription 3×6, `targetWeightG null`, `weightSource 'bodyweight'`, `rounding null`; S2 → holds 3×6. Never `weightSource: 'unset'` |
| **G21** | assisted pull-up, `load_mode: 'assisted'`, same config `add_weight` `incrementG 5000`, `nextAssistG 25_000`, top set 10 reps | `targetAssistG` **20 000** (less assistance), `targetWeightG null`; a failing session → **30 000**; floor at 0 |

**Deloads**

| ID | Case | Expected |
|---|---|---|
| **D1a** | `isDeloadWeek`, `everyNWeeks 6`, `lastDeloadWeekIndex null` | true at 6 and 12; false at 0, 5, 7 |
| **D1b** | same, `weeksPerCycle 3`, `weekIndex 12` (cycle 4, `cycleWeekIndex 0`) | **true** — the absolute index keeps firing in later cycles |
| **D1c** | same, `lastDeloadWeekIndex 4` | false at 6; **true** at 10 and 16 |
| **D2** | `resolveDeloadPolicy(template, { loadMultiplier: 0.85 })` where the template sets `setMultiplier 0.50` | `loadMultiplier 0.85` (user), `setMultiplier 0.50` (template), `targetRpe 6` (default) — precedence user > template > default |
| **D3** | a `deload_blocks` row covering today with `accepted_at: null` | `activeBlockFor()` → `null`; `prescribeRoutine()` output **deep-equals** the no-deload run |
| **G13** | `deloadTransform` on 4 working sets @ 100.0, `targetRpe 8`, generic policy | **2** sets, raw **90.0** → rounded **90.0** `EXACT`; `targetRpe` **6**; `kind:'amrap'` → `'working'` at its prescribed reps |
| **G13b** | `setMultiplier 0.60` on **1** set, then `setMultiplier 0.40` on **1** set | 0.60 → `round(0.6) = 1` set (**rounding**, the clamp never fires); 0.40 → `round(0.4) = 0` → **1** set (**`max(1, …)` clamp**). Both cases are needed: deleting the clamp must turn a test red |
| **G13c** | `deloadRoutine` with `cutTier3First` over rows at tiers 1, 2, 3 | tier-3 prescriptions **removed** first, then tier-1/2 set counts reduced |
| **G13d** | `deloadRoutine` over a 5/3/1 week 0 prescription (3 top sets + a 5×5 `backoff` block) | all **3** top sets survive at `× 0.90`; the `backoff` block is cut to **3** sets before any top set is touched |
| **D4** | assisted row under a deload | `targetAssistG` **increases** by `÷ 0.90` — less load is more assistance |

**Schedule, rounding, prescribe, activation**

| ID | Case | Expected |
|---|---|---|
| **M1** | `materialise` 6-day PPL (`daysPerWeek 6`, `weeksPerCycle 1`, `minRestDays 0`, `weekdayMask 0`), `from 2026-09-12` (Sat), `days 14`, `startSequenceIndex 0` | 14 rows on 2026-09-12 … 2026-09-25; `weekIndex` 0 for seq 0–5, **1** for seq 6–11, **2** for seq 12–13; `cycleWeekIndex` always 0. The week boundary comes from `sequenceIndex`, never the calendar |
| **M2** | `weekdayMask 21` (Mon/Wed/Fri), 3 program days, `minRestDays 0`, `from 2026-09-12`, `days 14` | 2026-09-14, -16, -18, -21, -23, -25 |
| **M3** | after `expireStale` returns `nextSequenceIndex 12` on a 3-week cycle, re-materialise from today | first new row `sequenceIndex 12`, `weekIndex 2`, `cycleWeekIndex 2`; no index is reused |
| **M4** | `addLocalDays('2026-08-31', 1)` and `diffLocalDays('2026-08-28', '2026-09-02')` | `'2026-09-01'`; `5` — month-end boundary, no `Intl`, no off-by-one |
| **S1** | rows Mon 2026-09-14 `planned`, `today = 2026-09-13` | `due: null`, `isRestDay: true`, `upcoming[0]` = the 09-14 row |
| **S2** | rows 09-10 (seq 3) and 09-12 (seq 4) both `planned`, `today = 09-12` | `due` = **seq 3**; `upcoming = [seq 4]`; never two due rows |
| **S3** | `plannedDays` over a window containing a shifted, an expired, a skipped, a deload and a rest day, plus **two rows on one day** | one entry per day; the shared day takes the most-completed status; the rest day produces **no** entry; `isDeload` set on the deload day |
| **G15** | rows Mon/Tue/Wed `planned`, Mon completed, `today = Thu`, `minRestDays 0` | Tue→**Thu**, Wed→**Fri**; `shiftCount 1` each; status stays `planned`; **0** `skipped` rows |
| **G16** | oldest overdue row 15 days behind | overdue → `expired`; `nextSequenceIndex` = max + 1; plan re-materialised from today with no index reused |
| **G17** | `minRestDays: 1`, two overdue rows, `today = T` | they land on **T** and **T+2** — one rest day between them (rule 18), never T and T+1 |
| **G17b** | `minRestDays: 0`, same two rows | **T** and **T+1** |
| **R1** | `roundPrescription` with `plateInventory: []` on a 40.0 kg target | `status 'NO_INVENTORY'`, `achievedG` **40 000** (**not** 20 000), `errorG 0` |
| **R2** | a `kind:'warmup'` set at 15.0 kg on a 20 kg bar | `status 'BELOW_BAR'`, `achievedG 20 000`, `errorG +5 000`, `platesPerSide []` |
| **R3** | a dumbbell row with `incrementG 2_500` at a raw 31.0 kg | `mode 'increment'`, `achievedG 30 000`, `status 'ROUNDED'`; `plateMath` **not** called |
| **P1** | `estimatedMinutes` on: row A 3 sets rest 120; row B 4 sets rest 90; superset C+D 3 sets each, rests 60/90 | A 435 s + B 510 s + CD 570 s = 1515 s → **26** min |
| **P2** | `prescribeRoutine` over a full 20-row routine | 20 prescriptions, `position` dense 0–19, one `RowHistory` lookup per `routineExerciseId`, `estimatedMinutes` finite |
| **A1** | activation killed between child chunks, then re-run | no duplicate rows on any natural key; the program is **not** `is_active` after the killed run; `is_active = 1` only after the complete re-run; a second activation sets the incumbent's `is_active = 0` (partial unique index holds) |

Rounding is verified by calling spec 07's `plateMath()`, never by hand-written constants: reuse r09 §6
vectors **P1** (100.0 `EXACT`), **P2** (62.5, microplate), **P3** (101.9 → nearest **102.0**, `+0.1`,
*not* greedy's 101.0), **P4** (`BELOW_BAR`), and r09 §7 **W1/W2** for the round-down path. Do **not**
assert a rounding winner at reps = 7 — r09 §2 shows that margin is floating-point noise.

```powershell
# 1 Schema. The D1 database is `fitness-pwa-db` (binding `DB`) per wrangler.jsonc + package.json.
npm run db:generate; if ($?) { npm run db:migrate:local }
# PASS: a new drizzle/migrations/*.sql containing program_days, exercise_progression_state,
#       program_schedule; "Migrations applied successfully"

# 2 Build the worker, then serve it. `wrangler dev` alone cannot serve the Next app:
#   wrangler.jsonc's main is `.open-next/worker.js`, produced by the OpenNext build.
npx opennextjs-cloudflare build
$job = Start-Job { npx wrangler dev --port 8787 }
# readiness poll — never curl a server that has not booted
$ok = $false; foreach ($i in 1..60) {
  try { if ((Invoke-WebRequest -Uri http://127.0.0.1:8787/api/health -UseBasicParsing).StatusCode -eq 200) { $ok = $true; break } } catch {}
  Start-Sleep -Milliseconds 500 }
if (-not $ok) { throw "worker did not become ready" }

# 3 Auth + shape.
(Invoke-WebRequest -Uri http://127.0.0.1:8787/api/programs/today -SkipHttpErrorCheck).StatusCode
# PASS: 401 unauthenticated, and the body is JSON (never a 302 to /login)
# with the session cookie: PASS 200, prescriptions[0].sets[0] has targetWeightG (number|null),
# targetAssistG, weightSource, rounding.status
```

```powershell
# 4 E2E, then — and only then — the row-count assertions the e2e produces.
npx playwright test tests/e2e/programs-ppl-cycle.spec.ts tests/e2e/programs-offline-start.spec.ts
npx wrangler d1 execute fitness-pwa-db --local --command `
  "SELECT status, COUNT(*) AS n FROM program_schedule GROUP BY status;"
# PASS: completed >= 1, planned >= 1, skipped = 0
npx wrangler d1 execute fitness-pwa-db --local --command `
  "SELECT COUNT(*) AS n FROM exercise_progression_state WHERE program_id = (SELECT id FROM programs WHERE is_active = 1);"
# PASS: n = the active program's routine_exercises count (one state row per ROW, not per exercise)
npx wrangler d1 execute fitness-pwa-db --local --command `
  "SELECT COUNT(*) AS n FROM programs WHERE is_active = 1;"
# PASS: n = 1 (the partial unique index is live)
Stop-Job $job; Remove-Job $job
```

**E2E `programs-ppl-cycle` PASS:** activate PPL → the Today card shows "Pull" → advance to the next
Push day → start → log bench `4×5, 1×5+` at 60.0 kg hitting every rep → finish → advance to the next
Push day on which bench is the main lift (the routine alternates bench/OHP) → bench is prefilled at
**62.5 kg** with `errorG 0` (`EXACT`, r09 §6 P2's microplate lattice). Then log **three consecutive
bench sessions with a set below `repMin`** and assert the prefill drops to **56.0 kg** (62.5 × 0.90 =
56.25 raw → nearest achievable 56.0, `errorG −250`, because `minIncrement` is 1.0 kg) with the reason
chip rendering `prog.reason.loadEasedTenPct` — *"Вес снижен на 10%"* in RU, *"Load eased 10%"* in EN.
Assert separately that no rendered text in the flow contains any `PROG_BANNED_TOKENS` entry **for the
active locale**, run once with `locale = ru` (the default) and once with `locale = en`.

**E2E `programs-offline-start` PASS:** with a program active and one sync completed, go offline
(`context.setOffline(true)`), open today's routine, start a workout, assert the targets rendered match
the `prescriptionCache` mirror row, assert the `prog.offline.stale` banner is present, log two sets,
go online, and assert the ops flush and the server's recomputed targets arrive as a non-blocking toast
with no logged set rewritten.

```powershell
# 5 Route budget (specs/16 owns the harness; this asserts the number this spec claims).
npx playwright test tests/perf/bundle-budget.spec.ts --grep "routines/\[routineId\]/edit"
# PASS: measured gzipped script bytes <= 100 KB
```

## Open questions

1. **Default deload cadence: 6 weeks or 4?** (a) **6 weeks** — the upper end of the verified *"between
   four to six weeks, on average"* band; fewer interruptions for a single motivated user whose real
   risk is losing momentum. (b) **4 weeks** — matches the historical 5/3/1 cycle and a more
   conservative reading of the same evidence. **Recommend (a)**, user-editable, with spec 14's plateau
   trigger as the safety net that pulls a deload earlier when it is actually needed. (Deload *duration*
   is decided, not open: 7-day block, with Bell et al.'s *"not more than six days"* caveat recorded in
   rule 13 and satisfied because `min_rest_days ≥ 1` leaves at most 4–6 training days inside it.)
2. **Amendments `specs/05-pwa-offline-sync.md` must accept** (§Data → IndexedDB): seven new
   `MirrorTable` entries, four `PULL_ONLY` members, eleven new `OP_TYPES` with schemas, and the
   `prescriptionCache` store. **Recommend accepting as listed** — 05's generic `mirror` store already
   makes the first three additive, and without them the entire programs module is online-only, which
   contradicts the brief's offline-first principle. Blocks `tests/e2e/programs-offline-start.spec.ts`.
3. **Two types named `ProgressionConfig`.** 09's discriminated union and `specs/06-workouts.md`'s
   `src/lib/workout/progression.ts` export the same name for unrelated shapes. **Recommend:** 06
   renames its type `SuggestionConfig` and its module is scoped to exercises logged **outside** a
   routine; 09 owns double progression for every routine row (rule 21). Needs a one-line edit in 06.
4. **`specs/07-calculators.md` must add `'amrap'` to `COUNTED_SET_TYPES`.** 02's `SET_TYPES` has five
   values, `specs/13-gamification.md` already counts `amrap`, and 09 requires it (rule 5a); 07's
   three-value list is the outlier and predates the enum. **Recommend adding it**, with r09 §8's own
   drop-set argument (*near-failure work is working stimulus*) as the rationale, and a note that r09 §8
   is thereby extended rather than contradicted.
5. **`specs/13-gamification.md`'s `adherence()` input must take 09's per-day mapping** (rule 20e):
   shifted / expired / skipped / deload / rest, one entry per day. **Recommend** 13 consumes
   `plannedDays()` directly and 09 states no formula — which is what this revision does, deleting the
   `completed / (completed + skipped + expired)` line that disagreed with 13's
   `completed / planned`.
6. **`specs/16-testing-ci-quality.md` must add `/routines/[routineId]/edit` to `perf-budgets.json`** at
   **100 KB**, matching `/programs`. **Recommend adding it**: it is the heaviest route this module
   ships and today it is measured by nothing.
