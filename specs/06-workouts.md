# 06 — Workout logging, rest timer, supersets, gym mode

## Purpose

The core loop: start a session, log a set in the fewest taps, rest, repeat, finish. Satisfies brief
module 1 (WORKOUTS) and is the whole of the Phase 2 DoD — *"a full session logs OFFLINE and syncs"*.
Everything is local-first: the session lives in IndexedDB; the network exists only for durability,
cross-device continuity and authoritative PR promotion. Speed-of-logging outranks everything else —
where a rule trades a tap for correctness the server can repair, the tap wins.

Cross-device continuity is **completed sets only**. `sessionDraft` (pending rows, the running rest
timer, group settings) is never synced, so picking a session up on a second device restores the
workout and every completed set from 05's `mirror`, and restores neither the timer nor an
uncommitted row. That is stated here because nothing else in the spec set says it.

## Scope

Session lifecycle (start empty / from a routine, checkpoint, resume, stale recovery, discard, finish);
composition (add / remove / replace / reorder, supersets as first-class groups); set entry (keypad
sheet, steppers, per-equipment increments, ghost prefill, swipe-to-complete, set types, skippable
RPE/RIR, duration/distance modes); rest timer (timestamp deadline, per-exercise defaults,
superset-aware, adjust/skip, backgrounded and screen-locked correctness, zero alert, wake lock); live
e1RM and live PR detection for all four PR kinds with confetti + haptic; rendering 09's progression
prescription; plate and warm-up calculator entry points; finish summary and the exact write set
including the seam 13 writes XP through; view / edit / soft-delete a past workout including PR
demotion; empty and first-run states; the exact offline/online boundary.

### Out of scope

| Excluded | Owned by |
|---|---|
| DDL for `workouts`, `workout_exercises`, `sets`, `personal_records`, the op ledger; ids; `local_day`; LWW policy | `02-data-model.md` |
| Design tokens, springs, skeleton recipe, and **every presentational shell 06 composes**: `set-row.tsx`, `number-pad.tsx`, `rest-timer.tsx`, `confetti-burst.tsx`, `bottom-sheet.tsx`, `gym/gym-layout.tsx`, `src/lib/haptics.ts`, `src/lib/wake-lock.ts` — their prop types, measured thresholds, a11y contract and haptic vocabulary | `03-design-system.md` |
| Auth gate on these routes; `POST /api/auth/login` (used to mint the Verification cookie jar) | `04-auth.md` |
| Dexie schema, `outbox`/`mirror`/`blobs`/`meta` stores, `POST /api/sync/{batch,pull}`, flush scheduling, backoff, SW, `/~offline` | `05-pwa-offline-sync.md` |
| All pure maths: `e1rm`, `pct1RM`, `rirFromRpe`, `plateMath`, `warmupSets`, `minIncrementKg`, `isCountedSet`, `isHardSet`, `setVolumeKg`, `totalVolumeKg`, `toGrams`, `COUNTED_SET_TYPES`, `SetType`, constants | `07-calculators.md` |
| Exercise search, picker internals, custom exercises, `equipment` taxonomy (`EquipmentKey`), media | `08-exercise-library.md` |
| Routines, **the double-progression engine itself**, every `ProgressionStrategy`, `ProgressionConfig`, `Prescription`, `exercise_progression_state`, `consecutive_failures`, deloads, `prescribeRoutine()` | `09-programs.md` |
| Charts, rolling volume, per-muscle credit, PR feed, e1RM curves | `12-analytics-dashboard.md` |
| XP values, streaks, achievements, geo check-in, `collectWorkoutXpEvents`, `buildXpStatements` — 06 owns only the **call site** inside the finish batch (rule 56) | `13-gamification.md` |
| Push / Telegram delivery. **06 owns no push:** rest-timer alerts are local-only (rule 43), so 14 must not implement a rest notification | `14-ai-coach-and-notifications.md` |
| Export, Hevy/Strong import, the Settings/Data screen that renders every `settings` toggle 06 reads | `15-data-portability.md` |
| Vitest/Playwright config, CI, `tests/fixtures/seed.sql` | `16-testing-ci-quality.md` |

Numeric expectations and formula provenance: `docs/research/r09-formulas-and-test-vectors.md`.

## Files to create

| Path | Responsibility |
|---|---|
| `src/app/(app)/workout/new/page.tsx` + `loading.tsx` | GYM MODE active-session screen + skeleton, at **`/workout/new`** — the path 16 precaches and axe-tests. **Static shell** (`○`): no `cookies()`/`headers()`/`searchParams` in its tree, or precaching silently dies (r05 §6c). There is no dynamic segment: the active session is read from `sessionDraft`. |
| `src/app/(app)/workouts/page.tsx` | History list; Dexie mirror first, reconciled by 05's pull. Static shell. |
| `src/app/(app)/workouts/detail/page.tsx` | Past-workout detail + editor. **Static route, id in the query string** (`/workouts/detail?id=<ULID>`), read client-side with `useSearchParams()` inside a `<Suspense>` boundary. **Decision:** a `[id]` segment builds as `ƒ`, emits no HTML, never enters the Serwist precache manifest and is therefore unreachable offline — `generateStaticParams() { return [] }` does not fix that, because an empty list generates no HTML either. A query string keeps one prerendered shell that serves every id offline. |
| `src/app/api/workouts/context/route.ts` | `GET` — ghost / PR / defaults bundle for ≤ 40 exercise ids. **The only endpoint 06 owns**, and a **cold-start optimisation only** (rule 66): all writes go through 05's `POST /api/sync/batch`, all row reads through `POST /api/sync/pull`, and every ghost after the first sync is derived from Dexie. Contract in Data. |
| `src/types/notifications.d.ts` | **The one ambient declaration 06 owns.** TypeScript 5.9.3's `lib.dom.d.ts` types `NotificationOptions` with exactly `badge, body, data, dir, icon, lang, requireInteraction, silent, tag` (verified in `node_modules/typescript/lib/lib.dom.d.ts:1252`) — no `renotify`. Under `strict` + `exactOptionalPropertyTypes` an object literal carrying `renotify` fails `tsc --noEmit`, which is this spec's own gate. This file declares `interface NotificationOptions { renotify?: boolean }` and nothing else, so rule 42(c) compiles and the first engineer to see a red build does not delete re-notification to go green. |
| `src/lib/workout/model.ts` | `SessionDraft`, `PendingSet`, `GroupSettings`, `WORKOUT_OP_TYPES`, the op payload schemas 06 registers with 05. |
| `src/lib/workout/reducer.ts` | Pure reducer: every session mutation as `(state, action) => state`. No I/O. |
| `src/lib/workout/pr.ts` | `PrKind`, `beatsBest`, `detectPrs`. Pure. |
| `src/lib/workout/load.ts` | `effectiveLoadKg`, `e1rmForSet` (02 rule 10). Pure; 12 and 15 import it. |
| `src/lib/workout/ghosting.ts` | `GhostContext`, `ghostFor`, `prefillFor`, `ghostFromMirror` (the Dexie query). |
| `src/lib/workout/increments.ts` | Per-equipment weight/rep increments, field-mode resolution, long-press multiplier. |
| `src/lib/workout/rest-timer.ts` | Deadline arithmetic, target resolution, superset transition rule. Pure. |
| `src/lib/workout/totals.ts` | Session totals composed from 07's `totalVolumeKg`/`isHardSet`. Pure. |
| `src/lib/workout/use-session.ts` | Dexie-backed live session, dispatch, debounced persist, outbox enqueue, `meta.workoutActive`. |
| `src/lib/workout/use-rest-timer.ts` | 4 Hz render tick, re-arm on resume, zero-alert dispatch. |
| `src/components/workout/ActiveSessionScreen.tsx` | Gym-mode container inside 03's `gym-layout.tsx` (which already holds the wake lock): header, entry list, sticky timer, actions. |
| `src/components/workout/ExerciseEntryCard.tsx`, `SupersetGroupCard.tsx` | One exercise instance; superset bracket, round counter, collapsed/expanded members. State only — each set renders through 03's `set-row.tsx`. |
| `src/components/workout/SetEditorSheet.tsx`, `StepperField.tsx` | The logging sheet inside 03's `bottom-sheet.tsx`: ghost chip, RPE strip, ± steppers with long-press, and 03's `number-pad.tsx` (amended per Interfaces) as the only keypad. |
| `src/components/workout/RestSettingsSheet.tsx` | Target / default / sound / haptic / wake-lock controls. The countdown itself is 03's `rest-timer.tsx` in both variants. |
| `src/components/workout/E1rmBadge.tsx`, `PrCelebration.tsx`, `ProgressionHint.tsx` | Live e1RM or `—`; the orchestration of 03's `confetti-burst.tsx` + `haptic('pr')` + toast; the chip rendering 09's `Prescription`. |
| `src/components/workout/CalculatorEntryPoints.tsx` | Plate glyph + "Add warm-up"; delegates to 07's sheets. |
| `src/components/workout/SessionSummarySheet.tsx`, `StaleSessionPrompt.tsx` | Finish flow; stale-session and two-open-sessions recovery dialog. |
| `src/components/workout/WorkoutHistoryList.tsx`, `PastWorkoutEditor.tsx`, `FirstRunPanel.tsx` | History rows; past-workout editing; empty / offline first-run state. |
| `src/server/workouts/op-appliers.ts` | The workout `OP_SCHEMAS`/`OP_APPLIERS` entries 06 registers into 05's `src/server/sync/apply-op.ts`: canonical `e1rm_kg`, `e1rm_source`, `rir`, `is_pr`, `pr_kinds_json`, PR promotion, KV purge, **and the `buildXpStatements` seam of rule 56**. |
| `src/server/workouts/repo.ts` | D1 reads for the context endpoint and the appliers: current PR rows, per-exercise history. `getDb()` per request. |
| `src/server/workouts/ghost-context.ts` | Previous-session + current-PR queries; `CACHE_KV` read-through. |
| `src/server/workouts/recompute-prs.ts` | Full PR recompute for given exercise ids after edit/delete — a **statement builder**, not a writer. |
| `src/server/workouts/reposition.ts` | Bounded dense renumber that survives the `position` unique indexes — a **statement builder**. |
| `tests/unit/workout/{pr,load,rest-timer,reducer,increments,totals,ghosting}.test.ts` | One file per pure module; cases in Verification. |
| `tests/e2e/log-workout-offline.spec.ts`, `tests/e2e/rest-timer-background.spec.ts` | Offline session → reconnect → sync; backgrounded timer via `page.clock`. |
| `tests/fixtures/workout-ops.json` | The committed replay fixture for Verification: 1 `workout.create`, 1 `workoutExercise.create`, 3 `set.create`, ULIDs distinct from every e2e fixture, wrapped in 05's `SyncBatchRequest` envelope. |
| `tests/fixtures/session.cookie` | curl cookie jar, **generated, git-ignored**: `curl -sS -c tests/fixtures/session.cookie -X POST http://127.0.0.1:8787/api/auth/login --data @tests/fixtures/dev-credentials.json` (04 owns the route; 16 owns `dev-credentials.json`). |

## Interfaces

```ts
// src/lib/workout/model.ts
import type { SetType, E1rmSource, LocalDate, CalcSet } from '@/lib/calc';
import type { LoadMode } from '@/db/enums';                  // 02's LOAD_MODE tuple
import type { EquipmentKey } from '@/lib/exercise/taxonomy';  // 08's 13 keys
import type { InferSelectModel } from 'drizzle-orm';
import type { sets } from '@/db/schema';
import type { DB } from '@/server/db';                        // 01 owns the accessor
import { OpEnvelope } from '@/lib/sync/ops';   // 05 — a Zod schema, so a VALUE import; used below
                                               // as `z.infer<typeof OpEnvelope>`
import { z } from 'zod';                                      // zod 4.6.2 (stack-facts)
import { ulid } from '@/lib/ids';                             // `ulid(Date.now())` — 26-char ULID (02)

export type SetRow = InferSelectModel<typeof sets>;
export type SqliteBatchItem = Parameters<DB['batch']>[0][number];   // same name 13 uses

/** A set NOT yet completed. Exists only in IndexedDB: `sets.completed_at` is NOT NULL in D1,
 *  so a pending set is unrepresentable there — by design. */
export interface PendingSet {
  id: string;                    // ULID minted at creation; carried verbatim into sets.id
  workoutExerciseId: string;
  exerciseId: string;
  position: number;              // 0-based, DENSE within the workout_exercise (02)
  setType: SetType;              // 07's union: warmup | working | drop | failure (see rule 25)
  weightKg: number | null;       // external load, kg. null = not entered or not applicable
  assistKg: number | null;       // assistance, kg (assisted machines only)
  reps: number | null;
  durationSec: number | null;    // load_mode 'duration' | 'distance'
  distanceM: number | null;      // load_mode 'distance'
  rpe: number | null;            // 6..10 in 0.5 steps. SOURCE OF TRUTH; the SERVER derives rir
  restTargetSec: number | null;  // explicit per-set override; null = resolve per rule 45
  generated: boolean;            // calculator-inserted warm-up; draft-only, never persisted
}

export interface GroupSettings {  // keyed by workout_exercises.superset_group (int)
  restSec: number; transitionSec: number; targetRounds: number | null;
}

/** Dexie store `sessionDraft`, one record: volatile UI state only. Everything already completed
 *  lives in 05's `mirror` store as real workouts / workout_exercises / sets rows. */
export interface SessionDraft {
  key: 'current'; workoutId: string; localDay: LocalDate;
  pending: PendingSet[]; timer: RestTimerState; groups: Record<number, GroupSettings>;
  bodyweightKg: number | null; dismissedHints: string[]; updatedAtMs: number;
}

/** Op payloads. 06 registers these into 05's `OP_SCHEMAS` / `OP_APPLIERS` / `MirrorTable`
 *  (`src/lib/sync/ops.ts`, `src/server/sync/apply-op.ts`). Field names, units and nullability
 *  mirror 02's columns. `workoutExercise.*`, the two `*.reorder` kinds and the `workout_exercises`
 *  mirror table are amendments 06 requires of 05 (Open questions A). Server-authoritative fields
 *  (`e1rm_kg`, `e1rm_source`, `rir`, `is_pr`, `pr_kinds_json`, `rev`, `updated_at`, `created_at`)
 *  are NEVER sent and the schemas reject them (05 rule 26). */
export const WORKOUT_OP_TYPES = ['workout.create','workout.patch','workout.delete','workout.restore',
  'workoutExercise.create','workoutExercise.patch','workoutExercise.delete','workoutExercise.reorder',
  'set.create','set.patch','set.delete','set.reorder'] as const;
export type WorkoutOpType = (typeof WORKOUT_OP_TYPES)[number];
export const WORKOUT_OP_SCHEMAS: Record<WorkoutOpType, z.ZodType>;
```

`set.create`'s payload in full — the four NOT NULL FK/day columns are the ones an abbreviated list
loses, and the row will not insert without them:

```ts
export const zSetCreate = z.object({
  id: z.string().length(26),
  workoutId: z.string().length(26),          // NOT NULL in 02
  workoutExerciseId: z.string().length(26),  // NOT NULL in 02
  exerciseId: z.string().min(1).max(64),     // NOT NULL in 02; 'fedb:…' | 'usr:…' (08)
  localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),   // NOT NULL in 02; frozen at session start
  position: z.number().int().min(0),
  setType: z.enum(['warmup', 'working', 'drop', 'failure']),   // 07's SetType, see rule 25
  weightKg: z.number().min(0).max(1000).nullable(),
  assistKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(0).max(500).nullable(),
  durationSec: z.number().int().min(0).nullable(),
  distanceM: z.number().min(0).nullable(),
  rpe: z.number().min(6).max(10).multipleOf(0.5).nullable(),
  restAfterSec: z.number().int().min(0).max(1800).nullable(),
  supersetRound: z.number().int().min(1).nullable(),
  completedAt: z.number().int(),             // NON-NULL; device clock at completion
}).strict();   // .strict() IS the rejection of rir / e1rm_kg / e1rm_source / is_pr / pr_kinds_json
```

```ts
// src/lib/workout/rest-timer.ts — all arithmetic is timestamp-based. setInterval is banned.
export interface RestTimerState {
  status: 'idle' | 'running' | 'finished';
  deadlineAtMs: number | null;   // epoch-ms (Date.now() basis) — the ONLY source of truth
  startedAtMs: number | null;
  targetMs: number;              // full duration; also clamps a backwards clock jump
  sourceSetId: string | null;
  firedAtMs: number | null;      // when the zero alert was delivered; null = not yet
  isTransition: boolean;
}
export const REST_ADJUST_STEP_MS = 15_000, SUPERSET_TRANSITION_SEC = 15, REST_DEFAULT_SEC = 120,
  REST_MAX_SEC = 1800, STALE_SESSION_MS = 21_600_000 /* 6 h */;
/** Total over all 13 of 08's EQUIPMENT_KEYS — a Record must be total or it does not compile. */
export const REST_DEFAULT_SEC_BY_EQUIPMENT: Record<EquipmentKey, number>;

export type RestSource = 'set' | 'superset' | 'exercise' | 'equipment' | 'global' | 'constant';
export function remainingMs(t: RestTimerState, nowMs: number): number;   // clamped [0, targetMs]
export function overrunMs(t: RestTimerState, nowMs: number): number;     // >= 0
export function startRest(i: { targetMs: number; nowMs: number; sourceSetId: string; isTransition: boolean }): RestTimerState;
export function adjustRest(t: RestTimerState, deltaMs: number, nowMs: number): RestTimerState;
export function skipRest(t: RestTimerState, nowMs: number): RestTimerState;
export function resolveRestTargetSec(i: {
  setOverrideSec: number | null;
  group: GroupSettings | null; isLastInRound: boolean;
  exerciseDefaultSec: number | null;   // 09's RoutineExerciseTarget.restSeconds ?? exercises.default_rest_sec
  equipment: EquipmentKey;
  settingsDefaultSec: number | null;   // settings.default_rest_seconds (02, default 120)
}): { targetSec: number; isTransition: boolean; source: RestSource };
```

```ts
// src/lib/workout/pr.ts
export type PrKind = 'e1rm' | 'max_weight' | 'max_reps' | 'session_volume';   // 02 PR_KINDS, frozen
export interface PrBest {
  exerciseId: string; kind: PrKind;
  value: number;                        // kg for e1rm/max_weight/session_volume; reps for max_reps
  repsAtValue: number | null;           // reps done, for max_weight
  effectiveLoadKgAtValue: number | null;// COMPUTED, not a column: effectiveLoadKg of the record set,
                                        // for max_reps. See rules 31 & 33 and Data.
  achievedAtMs: number; setId: string | null;
}
export const PR_EPSILON_KG = 0.01;             // 02 rule 9 (float comparison / epsilon)
export const PR_MAX_REPS_FOR_RPE_SOURCE = 8;   // r09 §2 open decision (a)

/** Integer grams via 07's `toGrams`, which returns `number | null` (verified:
 *  `src/lib/calc/round.ts:57`). A null on either side ⇒ `false`: an unrepresentable candidate is
 *  never a PR. kg is never compared as a double and never rounded to 1 dp first (r09 §1 gotchas).
 *  `best === null` ⇒ true. */
export function beatsBest(kind: PrKind, candidate: number, best: number | null): boolean;
export function detectPrs(i: {
  set: Pick<SetRow, 'setType' | 'reps'> & {
    effectiveLoadKg: number | null;     // rule 29 — the basis for EVERY kg-valued kind
    e1rmKg: number | null; e1rmSource: E1rmSource | null;
  };
  bests: readonly PrBest[];             // current (is_current = 1) rows for this exercise
  sessionVolumeKgForExercise: number;
}): PrKind[];
```

```ts
// src/lib/workout/load.ts — 02 rule 10 is the contract (e1rm NULL cases + effective load)
export function effectiveLoadKg(i: { loadMode: LoadMode; weightKg: number | null;
  assistKg: number | null; bodyweightKg: number | null }): number | null;   // null ⇒ suppress
export function e1rmForSet(i: { loadMode: LoadMode; weightKg: number | null; assistKg: number | null;
  bodyweightKg: number | null; reps: number | null; rpe: number | null;
}): { kg: number; source: E1rmSource } | null;      // wraps 07's `e1rm`; null ⇒ store NULL

// src/lib/workout/totals.ts
export interface SessionTotals { volumeKg: number; hardSets: number; setCount: number;
  exerciseCount: number; prCount: number; durationSec: number }
/** `sets` are only the sets representable as 07's `CalcSet` (non-null weight AND reps).
 *  Duration/distance sets arrive in `otherSetCount` and add to `setCount` only — see rule 54. */
export function sessionTotals(i: { sets: readonly CalcSet[]; otherSetCount: number;
  exerciseCount: number; prCount: number; startedAtMs: number; endedAtMs: number }): SessionTotals;

// src/lib/workout/increments.ts
export interface IncrementSpec { weightStepKg: number /* 0 ⇒ steppers disabled, field still shown */;
  microStepKg: number; repStep: number; longPressMultiplier: number; signInverted: boolean /* assisted */ }
export const INCREMENTS: Record<EquipmentKey, IncrementSpec>;     // total over all 13 keys
export const DURATION_STEP_SEC = 15, DISTANCE_STEP_M = 100;
export function incrementFor(eq: EquipmentKey, override?: Partial<IncrementSpec>): IncrementSpec;
/** Which fields the editor renders. Derived from `load_mode` ALONE (rule 23). */
export function fieldsFor(m: LoadMode):
  { weight: boolean; assist: boolean; reps: boolean; duration: boolean; distance: boolean };

// src/lib/workout/ghosting.ts
export interface GhostSet { position: number; setType: SetType; weightKg: number | null;
  reps: number | null; rpe: number | null }
export interface GhostContext {
  exerciseId: string; lastWorkoutId: string | null; lastLocalDay: LocalDate | null;
  lastSets: GhostSet[];          // counted types only, ordered by position
  bests: PrBest[]; defaultRestSec: number | null; equipment: EquipmentKey; loadMode: LoadMode;
  barKg: number | null; fetchedAtMs: number;
}
/** The offline path (rule 66): reads 05's `mirror` store, never the network. */
export function ghostFromMirror(exerciseId: string): Promise<GhostContext | null>;
export function ghostFor(ctx: GhostContext | null, position: number): GhostSet | null;
/** 06 renders progression, it does not compute it: `prescribed` is one element of 09's
 *  `Prescription.sets` (`PrescribedSet`), produced by 09's strategy registry. */
export function prefillFor(i: { ctx: GhostContext | null; position: number;
  prescribed: import('@/lib/programs/types').PrescribedSet | null;
}): Pick<PendingSet, 'weightKg' | 'reps' | 'setType'>;    // rpe is NEVER prefilled

// src/server/workouts/* — appliers RETURN statements; they never write. 05's batch handler puts
// them plus the `mutations` row in ONE db.batch() (05 rule 25), which is the atomicity everything
// downstream depends on. Nothing here may issue its own INSERT/UPDATE.
export interface ApplierResult {
  statements: SqliteBatchItem[];
  row: unknown;                              // → OpResult.row
  xpEvents?: readonly import('@/lib/gamification/xp').XpEvent[];   // rule 56
}
export type WorkoutOpApplier =
  (ctx: { db: DB; kv: KVNamespace; op: z.infer<typeof OpEnvelope> }) => Promise<ApplierResult>;
export const WORKOUT_OP_APPLIERS: Record<WorkoutOpType, WorkoutOpApplier>;

export async function getGhostContexts(db: DB, kv: KVNamespace, exerciseIds: string[]): Promise<GhostContext[]>;
/** Reads first, then RETURNS statements: the demotion/promotion writes must land in the caller's
 *  batch (rule 58). */
export async function buildPrRecomputeStatements(db: DB, exerciseIds: readonly string[]):
  Promise<{ statements: SqliteBatchItem[]; bests: PrBest[] }>;
/** EXACTLY TWO statements regardless of row count — see rule 9. */
export const MAX_REPOSITION_ROWS = 30;
export function buildRepositionStatements(db: DB, table: 'workout_exercises' | 'sets',
  parentId: string, orderedIds: readonly string[]): SqliteBatchItem[];
```

**Haptics and wake lock are 03's, imported verbatim.** 06 declares no `src/lib/haptics.ts` and no
`use-wake-lock.ts`. 03 exports `HapticName = "tap" | "setComplete" | "restDone" | "pr" | "error"`,
`hapticsSupported()`, `HAPTIC_PATTERNS` and `haptic(name)`; 06 uses `tap` (keypad digit),
`setComplete` (set logged), `error` (rejected swipe), `pr`, `restDone` (timer zero) — and no other
name. Screen wake is 03's `useWakeLock(enabled)`, already called by `gym/gym-layout.tsx`.

**One required amendment to 03's `NumberPadProps`**, because 06's keypad buffer is a partially-typed
string (`"12,"`) that `value: number | null` cannot represent, and shipping a second pad is worse:

```ts
interface NumberPadProps {                     // amended in specs/03, not duplicated here
  buffer: string;                              // the partially-typed text; "" = empty
  onBufferChange(next: string): void;
  parse(buffer: string): number | null;        // locale-tolerant parser supplied by 06 (rule 21)
  mode: "weight" | "reps" | "rpe" | "rir" | "duration" | "distance";
  step: number; min?: number; max?: number; ariaLabel: string;
  onCommit?(value: number): void;              // the full-width 56px commit key
}
```

## Behaviour

**Lifecycle**

1. "Start empty workout" mints `workoutId = ulid(Date.now())` and writes a `workouts` mirror row with
   `startedAt = Date.now()`, `endedAt = null`, `localDay = toLocalDay(startedAt)`, plus a
   `sessionDraft`, sets **`meta.workoutActive = true`** (05 rule 13(d) suppresses the service-worker
   update prompt on that flag, and nothing else in the spec set ever sets it), and enqueues
   `workout.create` so an in-progress session survives a lost phone (02 documents `ended_at IS NULL`
   as "in progress"). No `fetch` here; the write is not awaited.
2. `localDay` is computed **once at start and frozen** by 02's `toLocalDay()` — a 23:50 → 00:40
   session belongs to the start day (r09 §8: an Almaty/UTC off-by-one is the top analytics risk and
   would break streaks). 07's `LocalDate` is the type; `local_day` is the column, the CHECK and the
   helper name. 06 never spells it `local_date`.
3. `bodyweightKg` is snapshotted at start from the newest `body_measurements.weight_kg` into
   `workouts.bodyweight_kg`; it is what makes bodyweight-exercise e1RM meaningful (02).
4. At most one session has `endedAt IS NULL`. The invariant is **client-enforced best-effort**, not a
   database guarantee: 02 declares no partial unique index on `workouts WHERE ended_at IS NULL`, and
   asking for one would make a legitimate cross-device pull fail to insert — worse than the ambiguity
   it prevents. Starting a second session opens `StaleSessionPrompt`. When 05's pull delivers a second
   open workout from another device, `StaleSessionPrompt` lists both newest-`startedAt` first and
   offers **Resume**, **Finish at last set** or **Discard** per row; it never picks for the user.
5. Starting from a routine calls 09's `prescribeRoutine()` and writes the `workout_exercises` rows
   from the returned `Prescription[]` (`exerciseId`, `orderIndex → position`, `supersetGroup`,
   `plannedSets` → `target_sets`/`target_reps_low`/`target_reps_high`), plus `routineId` and `title`.
   **06 never reads `routine_exercises`** — its shape is 09's (`order_index`, `planned_sets_json`,
   `rest_seconds`, `progression_strategy`, `progression_config_json`) and 09 owns the mapping behind
   that one function.
6. Writes leave the module as 05 outbox ops only — `workout.create` at start, `workoutExercise.create`
   per exercise, `set.create` per completed set, `*.patch`/`*.delete`/`*.reorder` for edits —
   enqueued through 05's `writeLocal()` (mirror upsert + outbox insert in one Dexie `rw`
   transaction). 06 never calls `fetch` for a write and never blocks on one; batches are ≤ 50 ops
   (05's `MAX_OPS_PER_BATCH`), so a 50-set session finish flushes as several batches.
7. A session whose newest `completedAt` is older than `STALE_SESSION_MS`, or with no completed set and
   started > 6 h ago, is stale: `StaleSessionPrompt` offers **Finish at `<last completedAt +
   restAfterSec>`** (default), **Keep going**, **Discard**. Never auto-finish, never auto-discard.
   Resolving a stale session either way clears `meta.workoutActive`.
8. Discard soft-deletes (`deletedAt`) if the workout ever reached the server, else deletes the mirror
   rows outright; the draft is dropped, `meta.workoutActive` is cleared, and no event is emitted. A
   routine-started session discarded with zero logged sets also reverts 09's `stateDelta` (09 rule 20).

**Composition**

9. `workout_exercises.position` and `sets.position` are 0-based, dense, and covered by
   `workout_exercises_workout_id_position_uq` / `sets_workout_exercise_id_position_uq`, so reorder
   cannot swap in place. `buildRepositionStatements` emits **exactly two** statements, whatever the
   row count: (i) `UPDATE <t> SET position = position + 1000 WHERE <parent> = ?`, then (ii) one
   `UPDATE <t> SET position = CASE id WHEN ? THEN ? … END WHERE <parent> = ? AND id IN (…)`. Two, not
   `2 × rows`, because 05 rule 25 budgets **≤ 10 statements per op** and a per-row pair blows that at
   six exercises. Bound parameters are `3n + 2`, so `MAX_REPOSITION_ROWS = 30` keeps it under D1's 100
   (r02 §4.7); a longer list is `rejected` with `code:"too_many_rows"`. One reorder carries the whole
   ordered id list in a single `*.reorder` op, mirrored in one Dexie transaction.
10. Removing an exercise soft-deletes its sets and its `workout_exercises` row (never hard-deletes —
    every FK is `onDelete: "restrict"`, 02 rule 11) and renumbers the rest.
11. Replacing an exercise keeps the `workout_exercises.id`, its sets and positions, and swaps
    `exerciseId`; ghost and bests are re-resolved, completed sets keep `e1rmKg` but lose
    `isPr`/`prKindsJson`, and the server recomputes PRs for both exercises (rule 58).
12. Adding an exercise appends at `position = count` with one `PendingSet` ready, so logging needs no
    second tap. The same exercise may appear twice — that is what `workout_exercises` is for.

**Supersets**

13. A superset is `workout_exercises.superset_group`, a nullable int scoped to the workout. Grouping
    (long-press → Superset, or drag card onto card) assigns the next unused int; the label is
    `String.fromCharCode(65 + group)` → `A`, `B`, …
14. Group rest settings live in `sessionDraft.groups`, not in D1; what persists is each set's
    `rest_after_sec` and `superset_round`. Defaults: `restSec = max(member resolved defaults)`,
    `transitionSec = SUPERSET_TRANSITION_SEC`.
15. Members render in one card with 03's **2px lime bracket** down the left of the grouped rows
    (03 rule 12 — one number, in the spec that owns the component) and a round counter; the member
    whose next pending set has the lowest group position is expanded, the others collapse to their
    last set.
16. `superset_round` is 1-based. Uneven member set counts are legal; the round advances when the
    member with the highest group position logs.
17. Completing a **non-last** member's set starts a transition rest of `transitionSec` and expands the
    next member; the **last** member starts the group's full `restSec`. `transitionSec = 0` starts none.

**Set entry**

18. A pending row shows ghost values through 03's `set-row.tsx` `empty` state — **45%-opacity
    placeholder text, never as real values** (03 rule 12) — plus an AA-contrast chip
    `Last: 80 × 8 @8`. The placeholder measures **≈2.4:1** (`#a1a1aa` at 45% over `--surface-1`
    `#121214`, WCAG 2.x formula), which is legitimate only because it is a placeholder; the chip
    renders `--muted` on `--surface-2` at **6.63:1** (03 rule 4) and is the surface the user actually
    reads the numbers from. Weight and reps are independent targets, each ≥ 56 px tall (≥ 72 px in
    GYM MODE, 03 rules 8 and 20).
19. The 1-tap path: swipe the row right past **40%** of its width completes it with the prefilled
    values — 03 rule 12's threshold, raised to **50%** in GYM MODE (03 rule 20), because 03 owns the
    gesture. If a required field for the row's `load_mode` is null the swipe is rejected with
    `haptic('error')` and the editor opens on the missing field. A commit immediately replaces the
    placeholder with the committed numbers at `--foreground` (15.58:1) and offers a 5 s **Undo**, so
    nothing the user agreed to is ever left illegible.
20. Tapping a number opens `SetEditorSheet`: 03's `number-pad.tsx` (a **custom 10-key pad**, not the
    OS keyboard, which eats half the viewport and re-lays-out the sheet mid-set — 03 rule 11),
    ± steppers, ghost chip, RPE strip, full-width **Log set** — all inside the lower 45% of the
    viewport. No latency figure is claimed for the OS keyboard; none is sourced.
21. The keypad fills a string buffer parsed by 06's `parse()` prop with a locale-tolerant parser
    accepting `.` **and** `,`: MDN says `inputmode="decimal"` shows *"the digits and decimal separator
    for the user's locale (typically . or ,)"* and the default locale is RU, so `12,5` → `12.5`.
22. 03's pad keeps a `readOnly` `<input inputMode="decimal">` in the DOM mirroring the buffer for
    screen readers and hardware keyboards (03 rule 11). `type="number"` is banned (wheel mutation,
    locale separator rejection).
23. **Field visibility derives from `load_mode` alone**, through `fieldsFor()`: `external` → weight +
    reps; `bodyweight` → reps; `bodyweight_plus` → weight (added load) + reps; `assisted` → assist +
    reps; `duration` → duration; `distance` → distance + duration. `INCREMENTS` only supplies step
    sizes, so a `bodyweight` pull-up can never render a weight field and a banded external-load
    exercise can never lose one. Steppers use `INCREMENTS[equipment]` over 08's 13 `EQUIPMENT_KEYS`:
    barbell 2.5 / micro 1.25; ez_bar 2.5 / 1.25; dumbbell 2.5 / 1.0; cable 2.5 / 1.25; machine 5 /
    2.5; kettlebell 4 / 2; medicine_ball 1 / 0.5; bodyweight 1.25 / 0.5 (added load);
    resistance_band, exercise_ball and foam_roller 0 / 0; other and unknown 2.5 / 1.25. Reps always
    ±1; duration `DURATION_STEP_SEC` (15); distance `DISTANCE_STEP_M` (100). Long-press ≥ 400 ms
    repeats at 8 Hz with `longPressMultiplier = 5`. `weightStepKg === 0` **disables the ± steppers**
    and leaves keypad entry available. The barbell step is overridable by 02's shipped
    `settings.barbell_increment_g` (2500 → 2.5 kg); every other per-equipment override needs the new
    column in Open questions A.
24. `load_mode = 'assisted'` shows an **Assist** field writing `assistKg`, never `weightKg` — storing
    assistance as load inverts the whole progression (r09 §1 gotcha, 02 rule 10).
25. Set type comes from the row's long-press menu (it is rare, so it gets no permanent control), and
    the menu offers exactly 07's four: `warmup`, `working`, `drop`, `failure`. `failure` sets
    `rpe = 10` unless one is entered; `drop` copies the previous weight at −20% rounded **down** onto
    07's lattice. **`amrap` is not written by 06 today.** 02's `SET_TYPES` and 13's
    `COUNTED_SET_TYPES` both list it, but 07's shipped `SetType`
    (`src/lib/calc/types.ts:19`) and `COUNTED_SET_TYPES` (`src/lib/calc/constants.ts:227`) do not — so
    `setType: 'amrap'` is a compile error today, and if it were forced through, `isCountedSet`
    and `isHardSet` would return `false` and every AMRAP set's tonnage would silently vanish from
    session volume while never being able to set a PR. The AMRAP affordance is therefore a `working`
    set opened with empty reps and the ghost reps shown as a floor to beat. Adding the type is a
    **required amendment to 07** (Open questions A) with a 07-side vector for AMRAP tonnage and
    hard-set credit; when it lands, 06 adds the fifth menu entry and nothing else changes, because
    every counted-type list in 06 is derived from 07's exported constant and never restated.
26. `rpe` is the single source of truth. **The client sends `rpe` only; the applier derives
    `rir = rirFromRpe(rpe)` (07) at write time and `zSetCreate.strict()` rejects a client-sent
    `rir`.** That resolves the gap 05 rule 26 leaves — its server-authoritative list names `is_pr`,
    e1RM and `personal_records`, not `rir`. The strip offers 6 … 10 in 0.5 steps with an RIR toggle
    relabelling the same chips 4 … 0. Nothing is preselected or focused, and **Log set** is reachable
    without touching it.
27. Completing a set writes `completedAt = Date.now()` and `localDay` from the session (never
    recomputed), resolves `restAfterSec` (rule 45), computes e1RM and PRs locally for display, fires
    `haptic('setComplete')`, starts the rest timer, moves the row from `pending` into the mirror,
    enqueues `set.create`, and creates the next pending set copying weight and reps unless
    `targetSets` is met. **`prProvisional: 1` is set only when `detectPrs` returned a non-empty
    array** — 05 line 82 and rule 26 define the flag as "the client is showing a provisional PR
    badge", so setting it on every row would make 05's reconciliation assert nothing. The payload
    carries no `rir`, `e1rm_kg`, `e1rm_source`, `is_pr` or `pr_kinds_json`.
28. Because `writeLocal()`'s Dexie transaction scope is fixed by 05 rule 18 at
    `["mirror","outbox","blobs"]`, removing the set from `sessionDraft.pending` is a **second**
    write, and a crash between the two leaves the set in both places. **Resume-time reconciliation,
    required:** on draft load, drop every `pending` entry whose `id` already exists in `mirror`
    (client-minted ULIDs make the id the join key). Without this rule the user sees a duplicate row
    and can log it twice under a fresh id, which the server would happily accept.

**e1RM and PRs**

29. `e1rmForSet` and `detectPrs` are pure and run **twice**: on the client for the live badge and the
    provisional celebration, and again inside `WORKOUT_OP_APPLIERS['set.create']` to produce the
    canonical `e1rm_kg`, `e1rm_source`, `is_pr` and `pr_kinds_json`. One module, imported by both, is
    what keeps the two answers identical (05 rule 26 makes these fields server-authoritative).
30. `e1rmForSet` wraps 07's `e1rm(weightKg, reps, rpe)` and returns `null` — so `sets.e1rm_kg` is
    NULL, never 0 — when `reps > 12`, `reps < 1`, `reps >= 37`, `load_mode ∈ ('duration','distance')`,
    or effective load ≤ 0 (02 rule 10). Effective load is
    `(load_mode needs bodyweight ? bodyweightKg : 0) + weightKg - assistKg` (02 rule 10).
31. `E1rmBadge` renders `—` whenever e1RM is null (r09 §1 decision (a): a number the user cannot trust
    is worse than no number). e1RM is stored unrounded; only the display rounds, to 1 dp.
32. **Every kg-valued PR kind is defined on `effectiveLoadKg`, never on the raw `weight_kg` column.**
    Per exercise: `e1rm` = highest `e1rm_kg`; `max_weight` = heaviest **effective load** with
    `reps >= 1`; `max_reps` = most reps at an effective load ≥ the current record's effective load;
    `session_volume` = highest per-exercise tonnage in one session. One basis, stated once, because
    the raw column makes two of the four kinds dead: `weight_kg` is NULL on `assisted`
    (rule 24 writes `assistKg`), so reducing assistance — the actual progression — would never
    register a `max_weight` PR, and on `bodyweight_plus` a user who gains bodyweight and matches
    their added load would be silently stuck. No new `PR_KINDS` entry is needed and 02's tuple stays
    frozen. `personal_records.value` therefore stores effective load in kg for `max_weight`, and
    `PrBest.effectiveLoadKgAtValue` is computed in app code from `sets JOIN workouts` (for
    `bodyweight_kg`), not read from a column.
33. Only 07's counted types are PR-eligible (`isCountedSet` over `COUNTED_SET_TYPES` — today
    working, drop, failure; amrap when Open questions A lands). Warm-ups never are. A drop set that
    genuinely beats a record counts. Duration and distance sets are PR-ineligible: 02's `PR_KINDS` is
    frozen and holds no duration or distance kind.
34. Comparison uses 07's `toGrams`: a kg PR needs `toGrams(candidate) - toGrams(best) >=
    toGrams(PR_EPSILON_KG)` (= 10). Because `toGrams` returns `number | null`, `beatsBest` returns
    `false` if either conversion is null rather than doing arithmetic on a nullable. `max_reps`
    compares integers and additionally requires `toGrams(effectiveLoadKg) >=
    toGrams(best.effectiveLoadKgAtValue)`. `best === null` ⇒ PR. No `===` on a float.
35. An `e1rm` PR is suppressed when `e1rmSource === 'rpe'` **and** `reps > PR_MAX_REPS_FOR_RPE_SOURCE`
    (8): r09 §2 R6 shows `100 × 12 @ RPE 8` → 159.49 kg, a permanent unbeatable fake record. The other
    three kinds are unaffected. This is why `sets.e1rm_source` must be a stored column (Data): rule 58
    re-runs detection over the full history, and without the stored branch the recompute cannot tell
    which historical rows came from the RPE path — one edit would resurrect exactly the record the
    Risks table exists to prevent.
36. Detection runs against the cached current bests plus PRs already set earlier in the same session,
    so set 3 does not re-announce set 2's record; an exact tie is not a PR.
37. On detection `PrCelebration` runs 03 rule 16's recipe — `confettiRef.current.fire()`
    (`canvas-confetti@1.9.4`, two bursts, `disableForReducedMotion: true`), then `haptic('pr')`, then
    the lime PR badge with the `pop` spring — plus a toast naming kind and delta. Under
    `prefers-reduced-motion: reduce` the confetti does not fire at all and the row gets one accent
    ring pulse; the haptic still fires.
38. Client PRs are optimistic; promotion is the server's — one `db.batch()` clears the old
    `is_current` row and inserts the new one, guarded by `personal_records_exercise_id_kind_uq`
    (partial, `WHERE is_current = 1`) and `personal_records_set_id_kind_uq`, so a double flush cannot
    double-promote (02 rule 15). Disagreement patches `is_pr`/`prKindsJson` silently: a celebration
    already shown is never retracted, and only promoted PRs reach 12's feed.

**Rest timer**

39. The only meaningful state is `deadlineAtMs`, an epoch-ms wall-clock instant, persisted to
    `sessionDraft` synchronously on every transition. `setInterval` accumulation and storing "seconds
    remaining" are both banned.
40. Rendering is one `requestAnimationFrame` loop throttled to 4 Hz computing
    `remainingMs(timer, Date.now())` — always derived, never advanced.
41. `remainingMs` clamps to `[0, targetMs]`; the upper clamp defends against a backwards wall-clock
    jump (NTP or manual), which would otherwise inflate remaining time past the target.
42. One `setTimeout` is armed for `remainingMs`. On every `visibilitychange` → `visible`, `pageshow`
    and `focus` it is cleared and re-armed from the deadline; if `Date.now() >= deadlineAtMs &&
    firedAtMs === null` the zero handler runs immediately and the bar shows `+M:SS over`. **This
    overrun display is the primary, honest mitigation for a frozen timer**, not the beep.
43. Zero alert, in order, each behind a setting: (a) `haptic('restDone')` (03's
    `HAPTIC_PATTERNS.restDone = [30, 60, 30]`), a silent no-op on iOS; (b) a 400 ms WebAudio beep from
    an `AudioContext` created/resumed during the set-completion tap — without that gesture autoplay
    policy mutes it. **UNVERIFIED:** that a suspended-then-resumed `AudioContext` still fires on iOS
    with the screen locked is unsourced and is the exact case (b) is meant to cover; Open questions B1
    names the device probe, and until it passes the beep is a best-effort extra, not a mitigation;
    (c) when `document.visibilityState === 'hidden'` and `Notification.permission === 'granted'`,
    `registration.showNotification('Rest done', { tag: 'rest-timer', renotify: true,
    requireInteraction: false, body })` — `renotify` compiles only because of
    `src/types/notifications.d.ts` (Files to create), and it always ships with a non-empty `tag`. No
    `vibrate` and no `actions` are ever passed: the DOM lib types neither, and the haptic is the
    separate `navigator.vibrate` call in (a).
44. The notification is **not** pre-scheduled: Chrome's Notification Triggers API
    (`showTrigger`/`TimestampTrigger`) never shipped — *"The development of Notification Triggers API
    … has ended"* (developer.chrome.com/docs/web-platform/notification-triggers) — so no web API can
    fire a local notification while the page is frozen. Server push is deliberately **not** used for
    rest: it needs network, adds seconds, and cron is minute-grained. Recorded as
    **`DECISIONS.md` → D-06-01 "rest-timer alerts are local-only"**, which is also what the 14
    hand-off row above means: 14 owns no rest notification and must not add one.
45. Target resolution, six named levels in this order, returned as `source`: **`set`** (an explicit
    per-set override) → **`superset`** (rule 17's transition or group rest) → **`exercise`** (09's
    `RoutineExerciseTarget.restSeconds` when the session came from a routine, else the new
    `exercises.default_rest_sec` of Open questions A) → **`equipment`**
    (`REST_DEFAULT_SEC_BY_EQUIPMENT`: barbell 180, ez_bar 150, dumbbell 120, cable 90, machine 90,
    kettlebell 90, resistance_band 60, medicine_ball 60, exercise_ball 60, foam_roller 45,
    bodyweight 90, other 120, unknown 120 — all 13 of 08's keys, because a total `Record` must be
    total) → **`global`** (02's shipped `settings.default_rest_seconds`, default 120) →
    **`constant`** (`REST_DEFAULT_SEC`, when settings has not loaded). Clamped to `REST_MAX_SEC`.
    Starting a rest replaces any running one; there is never more than one.
46. `±15 s` moves the deadline **and** `targetMs`, keeping rule 41's clamp valid; below zero it
    finishes immediately. **Skip** sets `finished` and `firedAtMs = Date.now()` and fires no alert.

**Gym mode**

47. The screen wake lock is **03's**: `gym/gym-layout.tsx` calls `useWakeLock(enabled)` on mount,
    re-acquires on `visibilitychange` → visible and releases on unmount. 06 supplies `enabled` from
    the new `settings.keep_screen_awake` (Open questions A; **fallback while the column does not
    exist: `true`**) and releases by navigating away on finish or discard. 06 adds no second wake-lock
    implementation.
48. **The iOS limit is real and 03 already measured it.** MDN BCD `api/WakeLock.json`: Chrome/Edge
    84+, Safari 16.4+, **iOS Safari 18.4+ — and 16.4 to 18.4 explicitly does not work in standalone
    Home Screen web apps**, which is exactly this app's install target (05 requires
    `display: "standalone"`). So on an iPhone below 18.4 there is no wake lock at all. Per 03 rule 20
    the response is a one-time dismissible note asking the user to raise Auto-Lock, and the
    looping-muted-video hack is **not** shipped. A rejected or unsupported request surfaces once as a
    non-blocking note and is never retried in a loop.

**Calculators and progression**

49. The weight field carries a plate glyph opening 07's `plateMath(targetKg, barKg, inv)`.
    `barKg` means **bar + collars** (07 rule 36, r09 §6) and resolves: the new
    `exercises.bar_mass_g` (Open questions A) → 02's shipped `settings.ez_bar_mass_g` (7500 g) for
    `equipment = 'ez_bar'` → 02's shipped `settings.bar_mass_g` (20000 g) → **20 kg**. That chain is
    implementable from existing columns today, which is what 07 rule 36 means by "spec 06 supplies
    it", and it is also the `barKgByExercise` map 09's `prescribeRoutine()` requires. `inv` is
    `settings.plate_inventory_json`. Accepting writes `achievedKg` into the buffer and renders
    `errorKg` as `102.0 (+0.1)`.
50. An exercise with no completed set shows **Add warm-up** → 07's `warmupSets(topWorkingKg, barKg,
    inv)` with `topWorkingKg` = the prescription's weight, else the ghost's heaviest set. Rows insert
    before the working sets as `setType: 'warmup', generated: true`; re-running replaces only
    `generated` rows. An empty return disables the button with the reason — never three identical
    bar-weight rows (r09 §7).
51. **There is exactly one progression engine and it is 09's.** 06 declares no
    `src/lib/workout/progression.ts`, no `suggestNextSession`, no stall rule, no deload percentage and
    no second `ProgressionConfig`. It calls 09's `ProgressionStrategy.next(history, config)` (or
    `prescribeRoutine()` for a whole routine) and renders the resulting `Prescription`. 09 also owns
    the persisted `consecutive_failures` in `exercise_progression_state`, which a 06-side engine could
    only guess at, and the two would then disagree about the same lift.
52. `ProgressionConfig` has exactly one source per exercise: `routine_exercises.progression_config_json`
    for a routine-started session, read through 09. **For a session started empty there is no routine
    row**, so 06 calls
    `getStrategy('double_progression').next(history, cfg)` (09's `PROGRESSION_REGISTRY`) with the
    stated default `cfg` =
    `{ kind: 'double_progression', sets: 3, repMin: 8, repMax: 12,
    incrementKg: settings.barbell_increment_g / 1000 (2.5), targetRpe: null,
    failuresBeforeReduce: 3, reducePct: 0.10 }` and `consecutiveFailures: 0` (no
    `exercise_progression_state` row exists outside a program). An ad-hoc suggestion is **advisory
    only**: 06 never persists a `stateDelta` for a session with no routine.
53. `ProgressionHint` prefills only an untouched first pending set with no ghost, and is dismissible
    for the session (`sessionDraft.dismissedHints`).

**Finish, edit, delete**

54. **Finish** opens `SessionSummarySheet` with `sessionTotals()`: `durationSec =
    round((endedAt - startedAt)/1000)` (wall clock — there is no pause feature), tonnage, hard sets,
    set and exercise counts, PRs, notes. Pending sets are listed with **Discard N empty sets** as the
    default action. A finish with zero completed sets is refused and offers **Discard workout**.
55. Tonnage is 07's `totalVolumeKg` (counted types only, warm-ups excluded, r09 §8) and hard sets are
    07's `isHardSet`, which counts a counted set with `rir === null` as hard (**07 rule 39**) and
    gives a drop set full credit (`DROP_SET_HARD_SET_CREDIT = 1.0`, **07 rule 40** — *not* rule 44,
    which is `localDateFromInstant`). That constant is fractional **muscle** credit and never enters
    the boolean per-set count. 06 re-decides neither. Duration and distance sets are not
    representable as 07's `CalcSet` (no weight, no reps), so they contribute to `setCount` via
    `otherSetCount` and to neither `volumeKg` nor `hardSets`.
56. Confirming writes locally first (`endedAt`, `durationSec`, `volumeKg`, `hardSets`, `notes`), then
    enqueues one `workout.patch` plus any not-yet-enqueued `set.create` ops. The sheet closes
    immediately and never waits for the network. **The XP seam is server-side and lives here.** A
    `workout.patch` that sets `endedAt` makes `WORKOUT_OP_APPLIERS['workout.patch']` call 13's
    `collectWorkoutXpEvents({ workoutId, day, hardSets, volumeKg, prs })`, return the result as
    `ApplierResult.xpEvents`, and 05's batch handler concatenate
    `buildXpStatements(db, filterCappedEvents(events))` (both `src/server/gamification/xp-writer.ts`) into
    the **same** `db.batch()` as the workouts UPDATE and the `mutations` row. That is what 13 rule 17
    requires ("inside the workout-finish `db.batch()`") and what makes 13's idempotency real: the
    `xp_ledger U(source_kind, source_id)` guard only helps if the XP rows land atomically with the
    workout patch. A purely local browser event cannot reach D1, so the local
    `workout.finished` event (`{ workoutId, localDay, totals, prKinds }`) exists **for UI
    invalidation only** — 12 refreshes aggregates from it; nothing is awarded by it.
57. `PastWorkoutEditor` edits `weightKg`, `assistKg`, `reps`, `rpe`, `setType`, set order, title, notes
    and `localDay`; each change enqueues a `*.patch` op carrying **05's own field names — `clientRev`
    and `updatedAt`** (05's `OutboxOp`/`OpEnvelope`; there is no `baseRev` and no `clientUpdatedAt`
    anywhere in the sync contract). Deleting a set or workout sets `deletedAt`; hard deletion is 15's.
58. Any edit or delete touching a PR-eligible set makes the server run
    `buildPrRecomputeStatements` over the **full history** of the affected exercises — deleting the
    record-setting set must demote the record, which an incremental update cannot do. It reads first
    and returns statements, so the demotion and the promotion land in the caller's batch.
    `personal_records` is never LWW.
59. Changing `localDay` cascades to every `sets.local_day` in that workout (it is denormalised) and
    re-emits `workout.finished` so 13 can recompute the streak.
60. Conflicts follow 05 rule 27 **in 05's vocabulary**: creates cannot conflict (a create for an
    existing ULID is a `duplicate` no-op — which is why every id is minted client-side); a `*.patch`
    is row-level LWW over the patched columns on the clamped `updatedAt`, tiebroken by `clientRev`,
    and a losing patch returns **`conflict`** with the canonical row, which the client adopts.
    `OpResultStatus` is exactly `applied | duplicate | conflict | skipped | rejected` — there is no
    `stale`, so a client `switch` must never look for one. The user-visible wording for a lost edit
    ("Сохранена более новая версия") is a UI label mapped from `conflict` and lives nowhere in the
    protocol. Deletes are terminal. `conflict` and `rejected` surface through 05's sync status, never
    as an error on the logging screen.

**Empty, loading, error**

61. First run: `FirstRunPanel` with a primary "Start empty workout", a secondary "Pick a routine"
    (disabled until 09 has routines), one line of copy. No tutorial carousel.
62. First run **offline**, before 08 has mirrored the exercise index: "Exercise library not downloaded
    yet — connect once to start" with Retry. Logging is blocked because a set needs an `exerciseId`.
    This is the only unavoidable online dependency and only affects a never-booted install.
63. An exercise with no history: no ghost chip, empty fields, reps prefilled from the prescription's
    `reps` (09) or `8` when there is none, e1RM `—`.
64. The skeleton renders only on a cold Dexie read; a warm read skips it. History shows 6 skeleton rows.
65. The session header always shows the resolved `local_day` (02's UX note), so a wrong device clock is
    visible before anything syncs.
66. Sync state is a header pill, **`Saved locally · N pending`, where N is the number of pending
    outbox ops** (05's `useSyncStatus().pending`), not the number of sets. Failures never interrupt
    logging. **Everything the screen needs offline comes from Dexie**, and the mechanism is named:
    the draft from `sessionDraft`; completed rows, `personal_records` and the exercise index from
    05's `mirror`; and **ghost contexts are derived from `mirror` by `ghostFromMirror()`, not
    fetched** — `GET /api/workouts/context` is routed `NetworkOnly` by 05 rule 9 and returns nothing
    offline, so it is a cold-start optimisation for a never-synced install and nothing else. No new
    Dexie store is introduced for ghosts; the one addition requested of 05 is the index
    `[table+exerciseId]` on the existing `mirror` store as **Dexie v2** (Open questions A), which is
    what makes `ghostFromMirror` a keyed lookup rather than a scan of every set ever logged. The only
    degradation offline is a never-logged exercise having no ghost — rule 63's state.

## Data

`specs/02-data-model.md` owns every definition; this is the read/write matrix.

| Table | 06 reads | 06 writes |
|---|---|---|
| `workouts` | history, detail, ghost subquery, `bodyweight_kg` | insert at start; update on checkpoint/finish/edit; `deleted_at` |
| `workout_exercises` | session restore, ghost join | insert / update / reposition; `deleted_at` |
| `sets` | ghost prefill, PR recompute, detail | insert per **completed** set; update on edit; `deleted_at` |
| `personal_records` | current bests (`is_current = 1`) | promote / demote — **server only** |
| `exercises` | name, `equipment`, `load_mode`, media, and (once Open questions A lands) `default_rest_sec`, `bar_mass_g` | never (08 owns) |
| `routines`, `routine_exercises` | **never directly** — 09's `prescribeRoutine()` is the only reader | never |
| `settings` | `default_rest_seconds`, `unit_system`, `bar_mass_g`, `ez_bar_mass_g`, `barbell_increment_g`, `plate_inventory_json`, and (Open questions A) `keep_screen_awake`, `sound`, `haptics` | never — 02 owns the columns, **15's Settings/Data screen** owns the toggles, 05 owns the `settings.patch` op |
| the op ledger (`sync_ops` in 05, `mutations` in 02 — **the naming mismatch is flagged to 01**) | idempotency probe on the op ULID | one row per applied op, written inside the same `db.batch()` |
| `body_measurements` | newest `weight_kg` for the bodyweight snapshot | never (10 owns) |
| `xp_ledger`, `streak_ledger`, `achievement_unlocks` | never | never **by 06's own code** — rule 56 concatenates 13's statements into 06's batch; 13 owns every value |

Columns used, all already in 02: `sets.{position, set_type, weight_kg, assist_kg, reps, rpe, rir,
distance_m, duration_sec, rest_after_sec, superset_round, e1rm_kg, is_pr, pr_kinds_json, completed_at,
local_day}`, `workout_exercises.{position, superset_group, target_sets, target_reps_low,
target_reps_high}`, `workouts.{local_day, started_at, ended_at, duration_sec, title, notes,
bodyweight_kg, volume_kg, hard_sets}`, `personal_records.{kind, value, reps_at_value, set_id,
local_day, achieved_at, is_current, superseded_at}`. Units: kg `real`, reps integer,
`rest_after_sec`/`duration_sec` **seconds**, instants epoch-ms via `ts()`, `local_day` TEXT
`YYYY-MM-DD` written by the client with 02's `toLocalDay()` (r02 §2.8) — the column, the GLOB CHECK
and the helper are all spelled `local_day`/`toLocalDay`; 07's `LocalDate` is only the TypeScript
alias for the string.

Two gaps in `personal_records`, both decided rather than left open. (1) **`sets.e1rm_source TEXT NULL`
is a requirement on 02, not a preference** (rule 35): rule 58 re-runs detection server-side over the
full history, so the RPE-fake-PR gate must be answerable from the stored row. Deriving the branch on
read is not viable — it would re-run the whole composite and disagree with the stored `e1rm_kg`
after any formula change. Values are 07's `E1rmSource`. Listed in Open questions A. (2) There is no
`personal_records.weight_at_value` and 06 does not ask for one: `max_reps` reads its comparison basis
by joining `sets` (and `workouts` for `bodyweight_kg`) through `set_id` and computing
`effectiveLoadKg` in app code. The FK already exists, `is_current` keeps it to one row per kind, and a
denormalised weight drifts after an edit.

Indexes relied on, with 02's actual names (convention `<table>_<columns>_<idx|uq>`):
`sets_exercise_id_completed_at_idx (exercise_id, completed_at, weight_kg, reps, e1rm_kg)` — covering,
02's P3/P4, serving the ghost read and the e1RM / max-weight / max-reps recompute;
`sets_workout_exercise_id_position_uq` and `workout_exercises_workout_id_position_uq` — the reason
rule 9 renumbers in two phases; `personal_records_exercise_id_kind_uq` (partial,
`WHERE is_current = 1`) — "one current best per (exercise, kind)" as a database guarantee;
`personal_records_set_id_kind_uq` — replay-safe promotion; `sets_workout_id_idx` — session detail
(P9); `workouts_local_day_idx` and `workouts_started_at_idx` — the history list (P1).
**One new index is requested of 02** (Open questions A): `session_volume` is "highest per-exercise
tonnage in one session", a `GROUP BY workout_id` over a lift's full history, and the covering index
above has no `workout_id` — so rule 58's recompute would table-look-up every row of that history
inside a sync batch, and because the pattern is absent from 02's P1–P15 contract
`index-coverage.test.ts` would never see it. Requested as **P16**,
`sets_exercise_id_workout_id_idx (exercise_id, workout_id, set_type, weight_kg, reps)`.

Ghost query for one exercise (`getGhostContexts` batches; `IN` lists chunked at **40** — D1 allows 100
bound parameters, r02 §2.8/§4.7). The counted-type list is **generated from 07's
`COUNTED_SET_TYPES`** by `countedSetTypePlaceholders()` and never hand-written, so the two cannot
drift when Open questions A adds `amrap`:

```sql
SELECT s.position, s.set_type, s.weight_kg, s.reps, s.rpe
FROM sets s
WHERE s.exercise_id = ?1 AND s.deleted_at IS NULL
  AND s.set_type IN (/* COUNTED_SET_TYPES */)
  AND s.workout_id = (
    SELECT w.id FROM workouts w JOIN sets s2 ON s2.workout_id = w.id
    WHERE s2.exercise_id = ?1 AND s2.deleted_at IS NULL
      AND s2.set_type IN (/* COUNTED_SET_TYPES */)
      AND w.ended_at IS NOT NULL AND w.deleted_at IS NULL
    ORDER BY w.started_at DESC LIMIT 1)
ORDER BY s.position ASC;
```

Multi-row `sets` inserts chunk at `floor(100 / columnCount)` = **4 rows** for 02's 24-column `sets`;
the finish write is one `db.batch()` with no empty final chunk (r02 §4.8); `db.transaction()` is
banned — it compiles and fails at runtime on D1 (r02 §4.6).

**KV** binding **`CACHE_KV`** — the name in the shipped `wrangler.jsonc` and the one 01 uses;
02's `APP_CACHE` label for the same namespace is a naming mismatch flagged to 01/02. Key
`ghost:v1:<exerciseId>` → serialised `GhostContext`, TTL 86400 s, purged for every exercise touched by
an applied batch. Cache only; a miss falls through to D1.

**IndexedDB**: 05 owns `outbox`, `mirror` (`[table+id]`) and `meta`; 06 adds `sessionDraft` (`&key`)
holding only volatile UI state, writes **`meta.workoutActive`** (rules 1, 7, 8 — the flag 05 rule
13(d) reads to suppress the SW update prompt mid-set), and requests the `mirror` index
`[table+exerciseId]` as Dexie **v2**. Completed data lives in `mirror` in D1 column shape, so history
and the outbox read one source. **R2: unused.**

**Network touchpoints, complete list:** `GET /api/workouts/context` (06's only endpoint) plus 05's
`POST /api/sync/batch` and `POST /api/sync/pull`. Starting, composing, logging, timing, e1RM, PR
*detection*, confetti, calculators, progression rendering and finishing are all local.

**`GET /api/workouts/context` — the contract**, because the brief's security NFR requires every input
validated with Zod and this is 06's one HTTP surface:

```ts
export const ContextQuery = z.object({
  ids: z.string().min(1).max(2048)
    .transform((s) => s.split(','))
    .pipe(z.array(z.string().min(1).max(64)).min(1).max(40)),
}).strict();
export const ContextResponse = z.object({ serverTimeMs: z.number().int(),
  contexts: z.array(zGhostContext) });   // zGhostContext mirrors the GhostContext interface
```

`ids` is one comma-separated repeated-free param, capped at 2048 characters and **40 ids** (the same
chunk size the SQL uses). Status codes: `200`; `400` on a malformed id, an empty list or **41+ ids**
(never a silent truncation); `401` unauthenticated (`requireSession()`, 04); `503` on D1 failure.
Session-gated, `no-store`, `GET` only.

## UX notes

- **Reach.** On 390 × 844 every control needed to log a set sits below y = 480: timer above the safe
  area, the sheet's Log button on its bottom edge inside 03's 192 px thumb band, active card at
  y ≈ 200.
- **Sheet, not page.** Set editing, timer detail, plate calculator, exercise picker and the finish
  summary are 03 `bottom-sheet.tsx` instances over the session. Nothing in the logging loop navigates.
- **Gestures** (thresholds are 03's, rules 12 and 20). Swipe right past **40%** (**50%** in GYM MODE,
  spring back) = complete; swipe left past 40% reveals delete and **a second tap confirms** — one
  swipe never destroys data; long-press row (400 ms) = set-type menu; long-press handle (150 ms) =
  lift to reorder; drag card onto card = superset. Every gesture is duplicated in the row's overflow
  menu — gesture is never the only path.
- **Haptics** are 03's names: `tap` per keypad digit, `setComplete` on completion, `error` on a
  rejected swipe, `pr`, `restDone` at zero. All no-ops on iOS (03 rule 17), so a haptic is never the
  sole feedback for anything.
- **Motion.** Confetti per 03 rule 16; PR row glows 600 ms; the timer ring animates `stroke-dashoffset`
  only and **the digits never animate** (03 rule 15); rest digits use `.readout` tabular figures so
  they cannot jitter. Reduced motion: no confetti at all, ring pulse instead, cross-fade instead of
  slide, shimmer off.
- **a11y** (03 rules 8, 13 and 22 own these). The keypad is `role="group"` with per-key labels plus
  03's mirrored `readOnly inputMode="decimal"` input; the visible `mm:ss` is
  `role="timer" aria-live="off"` and a **separate `aria-live="polite" aria-atomic="true"` node is
  written only at 60 s, 30 s, 10 s and 0** — never a per-second live region, and never an `assertive`
  announcement; the set list is a real `<table>` with `<th scope="col">`; focus returns to the
  originating row when a sheet closes; targets ≥ 56 px with ≥ 8 px dead space, **≥ 72 px
  (`min-h-gym`) with ≥ 12 px in GYM MODE**; PR state carries a glyph and text, never colour alone.

## Risks

| Risk | Mitigation |
|---|---|
| The RPE branch mints a permanent unbeatable e1RM PR (r09 §2 R6: 100 × 12 @8 → 159.49) | 07's `RPE_INFLATION_CAP = 1.10` plus rule 35's reps ≤ 8 gate; unit-tested with R6; the gate survives rule 58's recompute only because `sets.e1rm_source` is stored |
| Epley at `reps = 1` returns 103.33 and fakes a PR on the first true single | 07's `reps === 1 ⇒ w` guard; V1 asserts 100.0000 — r09 calls this the module's likeliest real bug |
| Float equality makes PR detection flap between sessions | Integer grams with `PR_EPSILON_KG`; `beatsBest` returns `false` on a null `toGrams`; e1RM stored and compared unrounded |
| A ticking timer drifts or freezes when backgrounded and the user rests 9 minutes | Deadline-only state (39–42), re-armed on every resume event, overrun shown; E2E via `page.clock` |
| **iOS has no vibration, and below 18.4 no wake lock in a standalone PWA** | 03 rule 17 (`navigator.vibrate` unsupported `ios_saf` 3.2–26.6) and 03 rule 20 (Wake Lock `iOS Safari 18.4+`, **16.4–18.4 broken in Home Screen apps** per MDN BCD) are the measured facts. Mitigation is rule 42's overrun display plus 03's one-time "raise Auto-Lock" note; the beep is UNVERIFIED (B1) and no looping-video hack ships. A documented platform limit, not a bug |
| Reorder hits `sets_workout_exercise_id_position_uq` mid-batch, or blows 05's 10-statement budget | Two statements total (rule 9): a single `+1000` offset then one `CASE` update; `MAX_REPOSITION_ROWS = 30` keeps bound params at `3n + 2 ≤ 92` |
| A dynamic segment drops a workout route from the precache manifest — no offline gym mode | No dynamic segment exists: `/workout/new` and `/workouts/detail?id=` are both static (`○`). r05 §6c: no request APIs in the root layout; 16's CI asserts `~offline.html` exists and that `/workout/new` is precached |
| `SerwistProvider`'s `reloadOnOnline` default `true` reloads mid-set on flaky LTE | `reloadOnOnline={false}` (r05 §2d); reconnection is the outbox's job |
| An SW update prompt interrupts a set | `meta.workoutActive` set at start and cleared on finish/discard/stale-resolve (rules 1, 7, 8) — the flag 05 rule 13(d) already checks and that nothing else was setting |
| Almaty/UTC off-by-one moves a 00:30 session to the previous day and breaks the streak | `local_day` frozen at start, computed by 02's `toLocalDay()` in app code, echoed in the header (rule 65) |
| A 30-set flush exceeds D1's 100 bound parameters | Chunk at `floor(100/columnCount)` = 4 rows for `sets`; one `db.batch()`; guard the empty final chunk |
| A double outbox flush double-promotes a PR or duplicates rows | Client-minted ULIDs, the op-ledger PK probe, `personal_records_set_id_kind_uq`, `personal_records_exercise_id_kind_uq` |
| A browser crash mid-session duplicates a set (`mirror` and `pending` both hold it) | Rule 28's resume-time reconciliation drops any `pending` row whose id is already in `mirror`; the reducer output persists to Dexie within 250 ms and the timer deadline persists synchronously |
| XP, streaks and achievements are never written because 06 only emitted a local event | Rule 56's `ApplierResult.xpEvents` seam puts 13's `buildXpStatements` output in the same `db.batch()` as the finish patch; the local event is UI invalidation only |

## Verification

```bash
npx vitest run tests/unit/workout          # PASS: exit 0, 0 failures
npx tsc --noEmit                           # PASS: no output
npx playwright test tests/e2e/log-workout-offline.spec.ts tests/e2e/rest-timer-background.spec.ts
grep -rn "setInterval" src/lib/workout src/components/workout   # PASS: no output
grep -rn "db\.transaction(" src/server                          # PASS: no output
# No second haptics/wake-lock/keypad/progression implementation (the 03 and 09 boundaries):
ls src/lib/haptics.ts src/lib/wake-lock.ts                      # PASS: both exist (03 owns them)
test ! -e src/lib/workout/progression.ts && test ! -e src/lib/workout/use-wake-lock.ts \
  && test ! -e src/components/workout/NumericKeypad.tsx && echo BOUNDARIES-OK
# rir is never client-sent:
grep -rn "\brir\b" src/lib/workout/model.ts                     # PASS: no output

# Ordering dependency: this runs AFTER tests/e2e/log-workout-offline.spec.ts against the SAME
# `--local` D1, which is what put the rows there. Database name is `fitness-pwa-db` (shipped
# wrangler.jsonc line 15, and what specs/02 Verification uses).
npx wrangler d1 execute fitness-pwa-db --local --command \
 "SELECT (SELECT COUNT(*) FROM workouts WHERE ended_at IS NOT NULL) w,
         (SELECT COUNT(*) FROM sets WHERE completed_at IS NOT NULL) s,
         (SELECT COUNT(*) FROM sets WHERE e1rm_kg IS NOT NULL AND (reps > 12 OR reps < 1)) bad_e1rm,
         (SELECT COUNT(*) FROM sets WHERE rir IS NOT NULL AND rpe IS NULL) orphan_rir,
         (SELECT COUNT(*) FROM personal_records WHERE is_current = 1) prs;"
# PASS: w >= 1, s = 12, bad_e1rm = 0, orphan_rir = 0, prs >= 1

# Replay one batch of workout ops twice through 05's endpoint. Port 8787 — wrangler's default and
# the port 01, 05 and 16 all use. Fixture: 1 workout.create, 1 workoutExercise.create,
# 3 set.create, ULIDs disjoint from the e2e run; cookie jar per 04 (see Files to create).
for i in 1 2; do curl -sS -X POST http://127.0.0.1:8787/api/sync/batch \
  -b tests/fixtures/session.cookie -H 'content-type: application/json' \
  --data @tests/fixtures/workout-ops.json > /tmp/batch$i.json; done
# PASS: batch1 results[].status all "applied"; batch2 all "duplicate" with identical `row` values;
#       SELECT COUNT(*) FROM sets WHERE workout_id='<fixture ULID>' = 3
```

Unit cases; expected values are from `docs/research/r09-formulas-and-test-vectors.md` and vector ids are
cited so a failure needs no re-derivation.

| File | Case | Expected |
|---|---|---|
| `pr` | `beatsBest('e1rm', b + 0.005, b)` / `(b + 0.01, b)` / `(NaN, b)` | `false` / `true` / `false` (null grams) |
| `pr` | r09 **V1** `100 × 1` → 100.0000 `actual_single`, best 103.0 | no `e1rm` PR (the fake-single guard) |
| `pr` | r09 **V2** `100 × 5` → 116.6667 vs best 116.6600 / 116.6667 | PR / no PR |
| `pr` | r09 **R2** `100 × 5 @8` → 123.3046, `rpe`, reps ≤ 8 | `e1rm` PR present |
| `pr` | r09 **R6** `100 × 12 @8` → 159.4896, `rpe` | no `e1rm` PR; `session_volume` still possible |
| `pr` | **`assisted`**: bw 80, assist 30 then assist 25, no `max_weight` row yet | `max_weight` PR at 50 then at 55 — the raw-column bug would fire neither (rule 32) |
| `pr` | **`bodyweight_plus`**: bw 80 + 10 kg, then bw 82 + 10 kg, 1 rep each | second is a `max_weight` PR at 92 vs 90 |
| `pr` | `warmup` at 200 kg; `max_reps` below the record's effective load; an identical repeat set; a `duration` set | no PR in all four |
| `load` | `assisted`, bw 80, assist 30, weight null | `effectiveLoadKg === 50` |
| `load` | `duration`; `reps = 37`; `reps = 13`; effective load 0 | `e1rmForSet` null in all four |
| `rest-timer` | `startRest({targetMs: 180000, nowMs: 1e6})` | `deadlineAtMs === 1_180_000` |
| `rest-timer` | `now` = `deadline − 1` / `deadline` / `deadline + 60000` | remaining 1 / 0 / 0; overrun 0 / 0 / 60000 |
| `rest-timer` | `now = startedAtMs − 3_600_000` (backwards clock) | `remainingMs <= targetMs` |
| `rest-timer` | `adjustRest(+15000)` / `adjustRest(−999999)` | deadline and target both +15 s / `finished`, remaining 0 |
| `rest-timer` | one input per level of rule 45's chain, asserted on the returned `source` | `'set'`, `'superset'`, `'exercise'`, `'equipment'`, `'global'`, `'constant'` in that precedence |
| `rest-timer` | non-last superset member; `transitionSec: 0`; 45-min target; `REST_DEFAULT_SEC_BY_EQUIPMENT` | `{15, true}`; `{0,…}`; clamped to 1800; **13 keys, all of `EQUIPMENT_KEYS`** |
| `totals` | r09 §8 worked week (10 sets, 2 warm-ups, one RIR-5 fly) | `volumeKg === 3270.0` (380 kg of warm-ups excluded), **`hardSets === 7`** (8 counted minus the RIR-5 fly; per 07 rule 39 `rir === null` counts as hard, and 07 rule 40's `DROP_SET_HARD_SET_CREDIT` is fractional *muscle* credit that never enters this boolean count), `setCount === 8` |
| `totals` | one `duration` set added to the same week | `setCount === 9`, `volumeKg` and `hardSets` unchanged |
| `reducer` | reorder; group/ungroup; label after `A` is removed; round advance; auto next set; `failure`; `drop`; 31 rows reordered | two statements, dense positions; next unused int; `B`; round + 1; weight/reps copied; `rpe 10`; −20% rounded down; `rejected` `too_many_rows` |
| `reducer` | a `pending` row whose id already exists in `mirror` on draft load (rule 28) | dropped from `pending`, exactly one row survives |
| `increments` | full 13-key table; long-press; `assisted`; `resistance_band` with `load_mode 'external'`; `fieldsFor` over all 6 load modes | step × 5; `signInverted`; `weightStepKg === 0` **and the weight field still rendered, steppers disabled**; the six field sets of rule 23 |
| `ghosting` | position match; position 4 when last session had 3 sets; `rpe`; null ctx; previous warm-ups; prefill from a 09 `PrescribedSet` | set 3 reused; never prefilled; prescription then `8`; excluded; `targetWeightKg` used verbatim, `null` left empty (never `0`) |

`log-workout-offline.spec.ts`: `context.setOffline(true)` before start; log **3 external-load
exercises × 4 sets = 12 sets, every set 1–12 reps** (including one superset and one drop set, whose
−20 % weight still lands at ≤ 12 reps); reload mid-session and assert the session **and** the running
timer restore; finish; assert the pill reads **`Saved locally · 17 pending`** — 1 `workout.create` +
3 `workoutExercise.create` + 12 `set.create` + 1 `workout.patch`, counted as **ops**;
`setOffline(false)`; assert the pill clears within 10 s and that a `wrangler d1 execute --local` count
for that `workout_id` returns `COUNT(*) = 12` and `COUNT(e1rm_kg) = 12` (the fixture is chosen so
rule 30 suppresses none), and that **every mirror row that showed a provisional PR now has
`prProvisional` cleared and `is_pr` from the server** — rows that never showed one never had the flag.

`rest-timer-background.spec.ts`: `await page.clock.install()` (`@playwright/test@1.63.0`), start a
180 s rest, `page.clock.pauseAt(...)`, `await page.clock.fastForward('04:00')`; assert the bar reads
`+1:00 over`, `status === 'finished'`, and exactly one zero alert fired — proving the deadline is
recomputed, not ticked.

## Open questions

### A. Required amendments to other specs — blocking, with owners

Each row is a change 06's rules depend on. The **fallback** column is what 06 does until the change
lands, so nothing here blocks writing code today.

| # | Owner | Change | Why | 06's fallback until then |
|---|---|---|---|---|
| A1 | **07** | Add `'amrap'` to `SetType` (`src/lib/calc/types.ts`) and to `COUNTED_SET_TYPES` (`src/lib/calc/constants.ts`), plus a vector asserting AMRAP tonnage and hard-set credit | 02's `SET_TYPES` and 13's `COUNTED_SET_TYPES` already include it; without it `setType: 'amrap'` will not compile and an AMRAP set's tonnage silently vanishes | Rule 25: four set types, AMRAP rendered as a `working` set with a reps floor |
| A2 | **05** | Add `workoutExercise.{create,patch,delete,reorder}` and `set.reorder` to `OP_TYPES`; add `workout_exercises` to `MirrorTable`; add the `mirror` index `[table+exerciseId]` as **Dexie v2**; raise the per-op statement budget for `workout.patch` (B2) | 06 cannot enqueue a superset or a reorder otherwise, and `ghostFromMirror` would scan every set row | Reorder disabled; ghosts from the network endpoint only |
| A3 | **02** | `sets.e1rm_source TEXT NULL` (values = 07's `E1rmSource`) | Rule 35's fake-PR gate must survive rule 58's full-history recompute; deriving it on read disagrees with the stored `e1rm_kg` after any formula change | Gate applies to live detection only — a known, documented hole |
| A4 | **02** | `settings.keep_screen_awake` (bool, default 1), `settings.sound` (bool, default 1), `settings.haptics` (bool, default 1) — **03 needs `haptics` and `reduce_motion` too** | Rules 43, 47 and 03 rule 17 all read toggles that exist in no table | `keep_screen_awake` = true, `sound` = true, `haptics` = true |
| A5 | **02** | `exercises.default_rest_sec INTEGER NULL` and `exercises.bar_mass_g INTEGER NULL` | Rule 45's `exercise` tier and rule 49's `barKg` — 07 rule 36 says "spec 06 supplies it" and 09's `prescribeRoutine` requires `barKgByExercise` | Rest falls through to `equipment` then `settings.default_rest_seconds`; `barKg` from `settings.{ez_bar_mass_g,bar_mass_g}` then 20 kg |
| A6 | **02** | `settings.increment_overrides_json` (JSON, default `'{}'`, `Partial<Record<EquipmentKey, Partial<IncrementSpec>>>`, length-CHECKed) | `incrementFor(eq, override)` has no persistence | `INCREMENTS` constants, with barbell overridden by the shipped `settings.barbell_increment_g` |
| A7 | **02** | Index-contract pattern **P16** + `sets_exercise_id_workout_id_idx (exercise_id, workout_id, set_type, weight_kg, reps)` | `session_volume` recompute is a `GROUP BY workout_id` with no covering index, and an absent pattern is never checked by `index-coverage.test.ts` | Recompute runs unindexed on that one kind; correctness is unaffected, latency is not |
| A8 | **03** | `NumberPadProps` gains the `buffer`/`onBufferChange`/`parse` contract in Interfaces, and `mode` gains `"duration" \| "distance"` | `value: number \| null` cannot hold `"12,"`; the alternative is a second keypad | Blocked — 06 ships no second pad |

### B. Genuinely open

1. **Does a suspended-then-resumed `AudioContext` fire on iOS with the screen locked?** Rule 43(b) is
   marked UNVERIFIED because the mitigation and the failure case are the same case. Probe: install the
   PWA on an iPhone, start a 60 s rest, lock the screen, record whether the beep sounds; if it does
   not, rule 43(b) is downgraded to a same-app-foreground convenience and rule 42's overrun display
   stands alone. Not implementation-blocking — the code is identical either way.
2. **How high does 05 raise the per-op statement budget for `workout.patch`?** 05 rule 25 budgets
   ≤ 10 statements per op; rule 56 adds 13's `buildXpStatements` output to the finish batch
   (`xp_ledger` inserts + `streak_ledger` upsert + achievement unlocks). **Recommendation:** a
   per-kind map `MAX_STATEMENTS_PER_OP_BY_KIND` with `'workout.patch': 40` (1 workouts UPDATE + ≤ 39
   gamification statements, which `XP_SESSION_CAP` already bounds), keeping the default at 10 for
   every other kind so the budget stays a real guard.
3. **Is `/workout/new` the canonical active-session route?** 16 precaches and axe-tests
   `/workout/new`, its budget table names `/workout/[id]` as GYM MODE (120 KB) while its own sample
   output prints `/workout/new`, and 03 rule 20 calls GYM MODE `/workout/[id]/gym`. 06 owns these
   routes and has chosen `/workout/new` (rule: no dynamic segment can be precached).
   **Recommendation:** 03 and 16 adopt `/workout/new`, and 16's budget row is renamed with the same
   120 KB cap. Recorded here rather than silently diverging.
