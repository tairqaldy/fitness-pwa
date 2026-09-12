# 14 — AI coach, Cron jobs, Telegram and web push

## Purpose

Satisfies brief bullets 9 (AI COACH) and 10 (NOTIFICATIONS / TELEGRAM) and phase 8's DoD ("weekly
Telegram report fires from Cron"). Two coupled systems: a **coach** that turns already-computed
statistics into locale-correct narrative, and the **job bodies + delivery layer** running inside the
five Cron Triggers `specs/01-architecture.md` already defines. The coach is a narrator, never a
calculator: it receives a precomputed payload and may only phrase it. It is also not an AI client —
every model call goes through `specs/11-nutrition-ai.md`'s wrapper, because `src/lib/ai/**` is the
only place allowed to import `ai`/`@ai-sdk/*` (brief §9, specs/11 rule 3).

## Scope

- Eight logical steps composed into four of 01's five cron modules, each with an Asia/Almaty day gate.
- Deterministic plateau detection, deload trigger and food-log anomaly detection (pure functions).
- The coach pipeline: stats payload → versioned prompt → specs/11's `callStructuredWithEnv()` + Zod →
  guards → token interpolation → `coach_insights` (+ the guard verdict on specs/11's `ai_prompt_logs`
  row).
- Telegram send client, webhook with secret-token + chat-id lock, inbound commands.
- Web Push: subscription storage, VAPID send, 404/410 cleanup, iOS constraints.
- Notification policy (quiet hours, daily cap, kill switch) and the cron-observability answer.
- Surfaces: `/coach`, notification settings, the diagnostics page.

Every `r01 §x` citation below is [`docs/research/r01-cron-triggers-on-opennext.md`](../docs/research/r01-cron-triggers-on-opennext.md);
every `r06 §x` / `r06 Gn` is [`docs/research/r06-web-push-and-telegram.md`](../docs/research/r06-web-push-and-telegram.md);
`r09 §x` is [`docs/research/r09-formulas-and-test-vectors.md`](../docs/research/r09-formulas-and-test-vectors.md);
`r11 §x` is [`docs/research/r11-i18n-on-next16-workers.md`](../docs/research/r11-i18n-on-next16-workers.md).

### Out of scope

| Excluded | Owner |
|---|---|
| `worker.ts`, `wrangler.jsonc` `triggers`, `src/jobs/{types,registry}.ts`, the five job modules, `/api/cron/[job]`, `/api/system/diagnostics`, `src/lib/time.ts`, rate limiting, the KV key registry | `specs/01-architecture.md` |
| All DDL, including the one new table and the `settings` columns required here | `specs/02-data-model.md` |
| `src/lib/ai/**` — provider, model ids, prices, `callStructured*`, the `ai_prompt_logs` writer, the $5 monthly cap, food vision, NL food parsing, Atwater factors | `specs/11-nutrition-ai.md` |
| e1RM, EMA trend, TDEE arithmetic, volume and hard-set definitions | `specs/07-calculators.md` |
| Streak/freeze/grace rules, XP, achievement catalogue **and the nightly achievement sweep**, `WeeklyReviewPayload` / `MonthlyReportCard` generation, report-card *presentation*, all `Gamification.nudge.*` copy | `specs/13-gamification.md` |
| "Is today a training day", deload prescription and application (`requestDeload`), progression schemes | `specs/09-programs.md` |
| The whole body of `src/jobs/backup-to-r2.ts` — export serialisation, R2 bucket, key, gzip, verification, retention | `specs/15-data-portability.md` |
| Charts and stat tiles the coach deep-links to | `specs/12-analytics-dashboard.md` |
| Service-worker registration and file ownership, Dexie stores, outbox | `specs/05-pwa-offline-sync.md` |
| Rest-timer UX, its foreground countdown **and its zero alert** (rule 43 there: no server push for rest) | `specs/06-workouts.md` |
| Webhook route path shape, the secret-token comparison helper | `specs/04-auth.md` |

## Files to create

| Path | Responsibility |
|---|---|
| `src/jobs/steps/types.ts` | `StepName`, `StepResult`, `CronStep`. Framework-free. |
| `src/jobs/steps/{training-reminder,streak-nudge}.ts` | Evening logging nudge; streak-at-risk with the anti-nag gate. |
| `src/jobs/steps/{weekly-review,monthly-report}.ts` | Monday: TDEE recompute → read specs/13's payload → coach → one message. Day-1: report card. |
| `src/jobs/steps/{achievement-announce,tdee-recompute}.ts` | Announces unlocks the 00:20 rollup already wrote; appends a `tdee_snapshots` row via spec 07. |
| `src/jobs/steps/{watchdog,sync-nudge}.ts` | Nightly per-step staleness check → one health alert; "outbox stuck > 24 h" nudge (specs/05 risk row). |
| `src/server/coach/stats.ts` | Assembles the frozen `CoachStatsPayload` **from specs/13's stored payloads** plus this module's own windows. |
| `src/server/coach/{plateau,deload,food-sanity}.ts` | `olsSlope()`/`detectPlateau()`; `evaluateDeload()`; `detectFoodLogAnomalies()`. All pure. |
| `src/server/coach/generate.ts` | Budget → specs/11's `callStructuredWithEnv()` → guards → render → persist. |
| `src/server/coach/{guards,render,schemas,fallback,budget}.ts` | The five guards; `renderTokens()`; Zod schemas + `COACH_FACT_CODES`; deterministic template; coach-scoped monthly ceiling. |
| `src/server/coach/prompts/<generation>.<locale>.ts` | Versioned prompt text, one per generation × locale. |
| `src/server/coach/prompts/{index.ts,prompts.lock.json}` | `getPrompt()` registry + sha256 lock. |
| `src/server/notify/send.ts` | `notify()` — the only send entrypoint: policy, `notification_log`, fan-out. |
| `src/server/notify/policy.ts` | Quiet hours, daily cap, kill switch, pause, collapse, dormancy. |
| `src/server/notify/copy.ts` | Copy lookup through specs/13's `cronTranslator(locale)`. **No local RU/EN string table.** |
| `src/server/telegram/{client,html,commands}.ts` | Bot API client; `h()`/`mdv2()`; inbound commands. |
| `src/server/push/{send,subscriptions}.ts` | VAPID send with 404/410 cleanup; endpoint upsert/delete. |
| `src/app/api/telegram/webhook/<slug>/route.ts` | **Literal** slug segment (specs/04 rule 19): secret verify → chat-id lock → `waitUntil` → 204. |
| `src/app/api/push/{subscribe,unsubscribe}/route.ts`, `src/app/api/coach/insights/[id]/route.ts` | Subscription lifecycle; mark read / accept / dismiss / flag. |
| `src/app/(app)/coach/page.tsx`, `src/components/coach/{insight-card,proposal-sheet}.tsx` | Insight feed; card; proposal preview sheet. |
| `src/components/settings/notification-settings.tsx` | Channel toggles, quiet hours, push enable flow. |
| `src/app/(app)/settings/diagnostics/page.tsx` | Renders `/api/system/diagnostics`, per-step staleness, subscriptions, AI budget. |
| `scripts/{telegram-set-webhook.sh,vapid-generate.mjs}` | One-off `setWebhook`; one-off VAPID keypair. |
| `tests/unit/coach-plateau.test.ts` | Vectors P1–P10 and the index-vs-day bug. |
| `tests/unit/{coach-guards,coach-prompt-lock}.test.ts` | Guard rejections; every prompt hash matches the lock. |
| `tests/unit/{notify-policy,telegram-escape}.test.ts` | Quiet hours/cap/kill switch/anti-nag/collapse/dormancy; r06 §8.5–8.6 vectors. |
| `tests/unit/{job-gates,push-send,notify-copy,ios-push-gate}.test.ts` | Almaty weekday/day-of-month gates; 404/410 delete, 429 keep, >3993-byte throw; RU plurals; the `typeof Notification` gate. |
| `tests/e2e/coach-and-notifications.spec.ts` | Assertions in §Verification step 6. |

Two files this spec **edits** rather than creates, both owned elsewhere — the owning spec must be
amended (see Open questions):

| Path | Edit | Owner |
|---|---|---|
| `src/app/sw.ts` | Adds the `push` and `notificationclick` listeners, **before** `serwist.addEventListeners()` (specs/05 rule 16). | `specs/05-pwa-offline-sync.md` |
| `messages/{ru,en}.json` | Adds the `Coach.*` and `Notify.*` namespaces. Nothing under `Gamification.*` is duplicated. | `specs/03-design-system.md` |

## Interfaces

```ts
// src/jobs/steps/types.ts — framework-free: worker.ts is bundled by wrangler's esbuild, so nothing
// reachable from here may import next/*, "server-only" or @opennextjs/cloudflare (r01 §4.11), and
// nothing reachable from here may read process.env (Behaviour 8).
// CronJobContext / CronJobResult / CronName come from specs/01-architecture.md unchanged.
export type StepName = 'training-reminder' | 'streak-nudge' | 'sync-nudge' | 'achievement-announce'
  | 'monthly-report' | 'tdee-recompute' | 'weekly-review' | 'watchdog';
export const STEP_NAMES: readonly StepName[];                  // all eight, for the watchdog loop
export type StepResult = { ran: boolean; skippedReason?: string; counts?: Record<string, number> };
/** An object, not a bare function: `fn.name` is the minified/renamed identifier, and both the
 *  staleness key and the `skippedReason` string must be the stable StepName. */
export type CronStep = { name: StepName; run: (c: CronJobContext) => Promise<StepResult> };
/** Hours after which a step's last success is "overdue". Per STEP, not per cron: every cron here
 *  fires daily, so a per-cron 26 h threshold can never see a missed Monday (Behaviour 20). */
export const STEP_MAX_STALE_HOURS: Readonly<Record<StepName, number>>;
```

```ts
// src/server/coach/plateau.ts — weights kg; days are local date keys "YYYY-MM-DD".
export type SessionBest = { day: string; dayOffset: number; e1rmKg: number };
export type PlateauStatus = 'insufficient-data' | 'progressing' | 'plateau' | 'regressing';
export type PlateauResult = {
  exerciseId: string; status: PlateauStatus; sessions: number; spanDays: number;
  slopeKgPerWeek: number | null;       // 7 × OLS slope of e1rmKg on dayOffset
  relSlopePctPerWeek: number | null;   // 100 × slopeKgPerWeek / meanE1rmKg
  meanE1rmKg: number | null; bestE1rmKg: number | null;  // best WITHIN the window
  /** lastOffset − offset of the EARLIEST session achieving bestE1rmKg. Never windowEndDay-based. */
  daysSinceBestE1rm: number | null;
  isAllTimeBest: boolean;              // bestE1rmKg >= allTimeBestKg; drives the `new-pr` fact only
};
/** OLS. xs MUST be day offsets from the first session, never array indices. null for < 2 points or
 *  zero x-variance — never NaN. */
export function olsSlope(xs: readonly number[], ys: readonly number[]): number | null;
export function detectPlateau(bests: readonly SessionBest[], allTimeBestKg: number | null): PlateauResult;

// src/server/coach/deload.ts
export type DeloadVerdict = {
  due: boolean; plateauedLifts: number; daysSinceLastDeload: number | null;  // null = never
  strainSignals: readonly ('volume-spike' | 'low-readiness' | 'high-soreness')[];
  /** 'too-recent' mirrors specs/09's 21-day lock exactly, so the coach never proposes what
   *  requestDeload() would refuse with DELOAD_TOO_SOON. */
  blockedBy: 'no-active-program' | 'too-few-plateaus' | 'too-recent' | 'no-strain-signal'
    | 'insufficient-checkins' | null;
};
export function evaluateDeload(input: {
  programId: string | null;                            // null ⇒ 'no-active-program'
  lifts: readonly PlateauResult[];
  hardSets7d: number; hardSetsWeeklyMean28d: number;   // hard set = spec 07's isHardSet (rir <= 4)
  meanReadiness7d: number | null;                      // daily_checkins.readiness, 0–100
  maxSorenessDays7d: number;                           // days with any muscle at soreness_json 3 (max)
  checkinDays28d: number; daysSinceLastDeload: number | null;
}): DeloadVerdict;
```

```ts
// src/server/coach/stats.ts — the frozen input the model may speak. It PRODUCES no weekly or monthly
// aggregate: those are read from specs/13's stored payloads (Behaviour 5).
export type StatUnit = 'kg' | 'kcal' | 'kcal_per_day' | 'g' | 'ml' | 'reps' | 'sets' | 'count'
  | 'percent' | 'days' | 'kg_per_week' | 'minutes' | 'none';
export type CoachStat = {
  readonly raw: number | null;   // canonical unit, unrounded; null = unavailable
  readonly display: string;      // locale-formatted WITH unit: "121,3 кг" / "121.3 kg"
  readonly unit: StatUnit;
};
export const COACH_FACT_CODES = ['volume-up', 'volume-down', 'volume-flat', 'sessions-missed',
  'sessions-all-done', 'new-pr', 'plateau-detected', 'regression-detected', 'deload-due',
  'protein-below-target', 'intake-partial-days', 'kcal-macro-mismatch', 'impossible-kcal-day',
  'weight-trend-down', 'weight-trend-up', 'weight-trend-flat', 'readiness-low', 'sleep-low',
  'streak-intact', 'streak-freeze-used', 'tdee-calibrating'] as const;
export type CoachFactCode = (typeof COACH_FACT_CODES)[number];
export type CoachFact = {
  readonly code: CoachFactCode; readonly severity: 'info' | 'notice' | 'warn';
  readonly statKeys: readonly string[];   // keys into stats; the model must cite these as tokens
  readonly entityId?: string;             // exercises.id for lift-scoped facts
};
export type CoachGeneration = 'weekly-review' | 'monthly-report' | 'plateau' | 'deload'
  | 'program-adjust' | 'food-sanity';
export type CoachStatsPayload = {
  readonly schemaVersion: 1; readonly generation: CoachGeneration;
  readonly locale: 'ru' | 'en'; readonly timeZone: 'Asia/Almaty';
  readonly windowStartDay: string; readonly windowEndDay: string;   // inclusive local_day values
  readonly sourceRow: { table: 'weekly_reviews' | 'monthly_report_cards'; key: string } | null;
  readonly stats: Readonly<Record<string, CoachStat>>;              // token space {{stat.<key>}}
  /** token space {{exercise.<id>}} — the ONLY way prose may name a lift. Real names carry digits
   *  ("5/3/1 Squat", "45° Leg Press"), which assertNoLiteralNumbers would otherwise reject. */
  readonly exercises: Readonly<Record<string, { readonly display: string }>>;
  readonly facts: readonly CoachFact[]; readonly lifts: readonly PlateauResult[];
  readonly flags: Readonly<Record<'deloadDue' | 'tdeeCalibrating' | 'partialLogging', boolean>>;
};
export function buildStatsPayload(db: D1Database, generation: CoachGeneration,
  locale: 'ru' | 'en', scheduledTime: Date): Promise<CoachStatsPayload | null>;  // null = no source row
```

```ts
// src/server/coach/schemas.ts — string-only by design (Behaviour 3). Union-free and record-free:
// Gemini's OpenAPI-3.0 subset rejects unions and records (docs/research/stack-facts.md).
export const WeeklyReviewOutput = z.object({
  headline: z.string().min(8).max(90),
  paragraphs: z.array(z.string().min(20).max(420)).min(2).max(4),
  wins: z.array(z.string().min(5).max(140)).min(1).max(3),
  watch: z.array(z.string().min(5).max(140)).max(2),
  nextStep: z.string().min(10).max(180),
  factCodes: z.array(z.enum(COACH_FACT_CODES)).min(1).max(6),
});
/** monthly-report = WeeklyReviewOutput with paragraphs .min(3).max(6).
 *  plateau | deload | food-sanity = { headline, body(40..420), suggestion(10..200), factCodes(1..3) }. */
export const ProgramAdjustOutput = z.object({
  rationale: z.string().min(40).max(420),
  actions: z.array(z.object({          // bounded vocabulary; ADVISORY in phase 8 (Behaviour 11)
    kind: z.enum(['reduce-load-pct', 'reduce-sets', 'add-set', 'swap-exercise',
                  'insert-deload-week', 'hold-load', 'increase-load-step']),
    exerciseId: z.string().max(40),
    magnitudeToken: z.string().max(40),  // "{{stat.suggestedLoadDropPct}}" — never a digit
    note: z.string().min(5).max(160),
  })).min(1).max(4),
  factCodes: z.array(z.enum(COACH_FACT_CODES)).min(1).max(4),
});

// src/server/coach/guards.ts — pure, over the parsed output; each returns [] when clean.
export type GuardFailure =
  | { code: 'literal-number'; field: string; sample: string }
  | { code: 'unknown-token'; field: string; token: string }
  | { code: 'wrong-locale'; field: string; scriptRatio: number }
  | { code: 'banned-phrase'; field: string; phrase: string }
  | { code: 'fact-not-in-payload'; factCode: string };
/** Rejects any digit (ASCII or Arabic-Indic) outside a `{{stat.*}}` or `{{exercise.*}}` token. */
export function assertNoLiteralNumbers(out: unknown): GuardFailure[];
/** Resolves BOTH token spaces; an id absent from stats/exercises is `unknown-token`. */
export function assertTokensResolve(out: unknown, p: CoachStatsPayload): GuardFailure[];
/** ru ⇒ Cyrillic/all letters ≥ 0.85; en ⇒ Latin ≥ 0.85. Tokens stripped first. */
export function assertLocale(out: unknown, locale: 'ru' | 'en'): GuardFailure[];
/** Same BANNED_COPY_PATTERNS list specs/13 rule 31 lints its own copy against. */
export function assertNoBannedPhrases(out: unknown, locale: 'ru' | 'en'): GuardFailure[];
export function assertFactsGrounded(out: { factCodes: string[] }, p: CoachStatsPayload): GuardFailure[];

// src/server/coach/generate.ts — imports NOTHING from `ai`/`@ai-sdk/*` (specs/11 rule 3 + CI grep).
export type CoachTier = 'narrative' | 'note';
export const COACH_TIER_TO_AI_TIER: Readonly<Record<CoachTier, 'primary' | 'cheap'>>;
export const COACH_TIMEOUT_MS: Readonly<Record<CoachTier, number>>;   // narrative 12_000, note 8_000
export const COACH_AI_KIND: Readonly<Record<CoachGeneration, string>>; // → specs/11's AiKind members
export type CoachGenerationResult =
  | { ok: true; insightId: string; text: string; promptVersion: string; model: string;
      inputTokens: number | null; outputTokens: number | null; costUsd: number; repaired: boolean }
  | { ok: false; insightId: string; text: string; source: 'template';
      reason: 'budget' | 'guard' | 'schema' | 'provider' | 'timeout'; failures: GuardFailure[] };
/** The ONLY model entrypoint: specs/11's explicit-env wrapper (Behaviour 7). Never generateObject. */
export function runCoachGeneration(env: CloudflareEnv, payload: CoachStatsPayload,
  tier: CoachTier): Promise<CoachGenerationResult>;
```

This spec depends on one addition to `specs/11-nutrition-ai.md`'s `src/lib/ai/call.ts`, because
`callStructured()` takes no `env` and would have to reach bindings through `getCloudflareContext()`,
which **throws inside `scheduled`** (r01 §2.4, §4.2). The shape spec 14 codes against:

```ts
// src/lib/ai/call.ts — ADDED BY specs/11 for cron callers. Same body, explicit bindings.
export function callStructuredWithEnv<T>(
  env: CloudflareEnv, a: CallStructuredArgs<T>): Promise<CallStructuredResult<T>>;
// and AiKind gains: "coach_weekly" | "coach_monthly" | "coach_plateau" | "coach_deload"
//                 | "coach_program" | "coach_food"
```

```ts
// src/server/notify/send.ts — the only way anything leaves the app.
export type NotifyChannel = 'telegram' | 'push';
export type NotifyKind = 'training-reminder' | 'streak-at-risk' | 'weekly-report' | 'monthly-report'
  | 'achievement' | 'coach-insight' | 'health-alert' | 'sync-wake' | 'sync-stuck' | 'command-reply';
/** Kinds that take a `notification_log` row and are therefore once per channel per local day.
 *  Everything except 'command-reply' (Behaviour 17). */
export const LOGGED_KINDS: ReadonlySet<NotifyKind>;
/** Kinds exempt from the daily cap — no queue, no deferral, no re-ranking (Behaviour 18). */
export const UNCAPPED_KINDS: ReadonlySet<NotifyKind>;
export type NotifyRequest = {
  kind: NotifyKind; channels: readonly NotifyChannel[];
  telegram?: { html: string; silent?: boolean; noPreview?: boolean };  // ≤ 4096 chars post-parse
  /** `url` is REQUIRED whenever the declarative keys are emitted — WebKit's format demands
   *  `notification.navigate` (r06 §6.1). Behaviour 24 emits them for every push, so url is given. */
  push?: { title: string; body?: string; url: string; topic?: string; ttlSeconds: number };
  scheduledTime: Date;                                                 // decides the local day
};                                     // push.topic ≤ 32 chars; ttlSeconds ALWAYS explicit (r06 G7)
export type PolicySkipReason = 'kill-switch' | 'paused' | 'channel-disabled' | 'quiet-hours'
  | 'daily-cap' | 'already-sent-today' | 'collapsed' | 'dormant' | 'no-chat-id' | 'no-subscription';
export type NotifyResult = {
  telegram?: { sent: boolean; messageId?: number; skipped?: PolicySkipReason; error?: string };
  push?: { sent: number; removed: string[]; failed: number; skipped?: PolicySkipReason };
};
export function notify(env: CloudflareEnv, req: NotifyRequest): Promise<NotifyResult>;

// src/server/notify/copy.ts — specs/13's verified standalone path (r11 §9 Option A), NOT next-intl.
import { cronTranslator } from '@/server/gamification/i18n-standalone';
/** Namespaces this module adds to messages/{ru,en}.json. Streak-nudge copy is NOT here: it is
 *  specs/13's `Gamification.nudge.*` C1–C7, used verbatim (Behaviour 6). */
export function notifyCopy(locale: 'ru' | 'en'): ReturnType<typeof cronTranslator>;

// src/server/telegram/html.ts
/** Escape a VALUE for parse_mode HTML: only & < > (r06 §8.6). Never run over your own markup. */
export const h: (v: unknown) => string;
/** Kept for a future Markdown need; escapes all 18 reserved chars plus backslash (r06 §8.5). */
export const mdv2: (v: unknown) => string;

// src/server/push/send.ts
export type SendResult = { sent: number; removed: string[];
  failed: { endpoint: string; status: number; body: string }[] };
export function sendWebPush(
  env: { DB: D1Database; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string },
  payload: { title: string; body?: string; url: string; tag?: string; lang?: 'ru' | 'en' },
  opts: { ttl: number; urgency?: 'low' | 'normal' | 'high'; topic?: string }): Promise<SendResult>;

// src/server/telegram/commands.ts
export type InboundCommand =
  | { cmd: '/start' } | { cmd: '/help' } | { cmd: '/today' } | { cmd: '/streak' }
  | { cmd: '/report' } | { cmd: '/resume' }
  | { cmd: '/weight'; kg: number }     // 20–400, ≤ 2 dp
  | { cmd: '/water'; ml: number }      // 1–5000, integer
  | { cmd: '/ate'; text: string }      // ≤ 300 chars, untrusted → specs/11 only
  | { cmd: '/pause'; days: number };   // 1–30
export function parseCommand(text: string): InboundCommand | { cmd: 'unknown' };
export function handleCommand(env: CloudflareEnv, updateId: number, cmd: InboundCommand): Promise<void>;
```

## Behaviour

### Coach

1. **Plateau detection is deterministic; the model only narrates it.** For each *tracked lift* — the
   ≤ 8 (`PLATEAU_MAX_TRACKED_LIFTS`) exercises with the most sessions inside
   `PLATEAU_LOOKBACK_DAYS = 42` local days — take one point per workout: the max stored `e1rmKg` over
   sets counted by spec 07 (`working | drop | failure`). `x` is **days since the first session in the
   window**, `y` is kg; `slopeKgPerWeek = 7 × olsSlope(x, y)`,
   `relSlopePctPerWeek = 100 × slopeKgPerWeek / meanE1rmKg`. Status: `insufficient-data` when
   `sessions < 6` or `spanDays < 21`; else `regressing` when `rel < −0.50`; `plateau` when
   `−0.50 ≤ rel < 0.25` **and** `daysSinceBestE1rm ≥ 21`; else `progressing`.
   **`daysSinceBestE1rm` is pinned:** it is `lastOffset − offset of the EARLIEST session achieving
   `bestE1rmKg`` — measured from the last session in the window, never from `windowEndDay` (which
   would make a lift "plateau" simply because the user stopped training), and earliest-wins on a tie
   so a flat series counts its whole span. A lift whose **window** best is less than 21 days old is
   never a plateau whatever its slope. `allTimeBestKg` sets `isAllTimeBest` and feeds the `new-pr`
   fact; it takes no part in the status decision. The AI is invoked **only** after the status is
   already `plateau` or `regressing`; no prompt asks "is this a plateau?".
2. **The deload trigger is deterministic too, and it uses spec 09's lock, not its own.** `due`
   requires an active program, `plateauedLifts ≥ 2`, `daysSinceLastDeload ≥ 21` (or null) **and** one
   strain signal: `hardSets7d ≥ 1.30 × hardSetsWeeklyMean28d`, `meanReadiness7d < 60`, or
   `maxSorenessDays7d ≥ 3`. With `checkinDays28d < 14` strain signals count as absent
   (`blockedBy: 'insufficient-checkins'`), so thin data cannot manufacture a deload. **21 days, not
   6 weeks**, because specs/09 rule 14 enforces "one deload per program per 21 days" and returns
   `DELOAD_TOO_SOON` otherwise — a stricter gate here would silently refuse deloads specs/09 would
   accept. With no active program the verdict is `blockedBy: 'no-active-program'` and no suggestion is
   generated at all. **This module never writes a deload row.** Accepting a deload suggestion calls
   specs/09's `requestDeload(programId, 'plateau', weekIndex)`; its `{applied, code}` result is what
   the UI reports, and `DELOAD_TOO_SOON` is shown as "next eligible <nextEligibleLocalDay>".
3. **The coach never invents a number or a name.** The prompt carries only the payload's stat keys,
   units and `display` strings, the `exercises` display map, and the `facts` array — never raw rows,
   never a set list, never free text from any channel. The Zod schemas have **no numeric fields**;
   every number must appear as a `{{stat.<key>}}` token and every lift as an `{{exercise.<id>}}`
   token, both replaced by `renderTokens()` with the payload's `display` string. So
   `assertNoLiteralNumbers()` rejects "you added 3 kg" even when the model is confidently wrong, and
   the exercise token space is what lets the coach name "5/3/1 Squat" or "45° Leg Press" without a
   digit ever leaving the model's own text. `assertTokensResolve()` rejects unknown keys in either
   space and `assertFactsGrounded()` rejects fact codes absent from the payload.
4. **Input windows.** `weekly-review`: specs/13's `weekly_reviews` row for the ISO week that closed
   yesterday (`isoWeekKey`, specs/13), plus this module's own 42-day plateau window.
   `monthly-report`: specs/13's `monthly_report_cards` row for the previous Almaty calendar month.
   `plateau`/`deload`: the 42-day window plus the 28-day check-in window. `food-sanity`: the trailing
   7 local days. `program-adjust`: whatever the triggering verdict already computed — it never widens
   the window itself.
5. **Weekly and monthly numbers are read, never re-derived.** `buildStatsPayload('weekly-review')`
   loads `weekly_reviews.payload_json` (specs/13 §26, generated in the Monday 00:20 rollup) and maps
   its fields into `stats`/`facts`; `'monthly-report'` loads `monthly_report_cards.payload_json`
   (specs/13 §27). It adds only what specs/13 does not compute: the 42-day plateau results, the
   food-sanity anomalies, the `tdee_snapshots` row this job just wrote, and the locale-formatted
   `display` strings. If the row is missing — the 00:20 rollup did not run — `buildStatsPayload`
   returns `null`, the step returns `{ ran: false, skippedReason: 'no-review-row' }`, and the
   watchdog surfaces it. **Two implementations of the same window is exactly the bug this module's
   token guards exist to prevent**, so re-querying `sets`/`workouts`/`food_entries` for a weekly or
   monthly aggregate is a review rejection. `payload.sourceRow` records which row was read, so the
   Telegram message, the `/coach` card and `/progress/review/[week]` are provably the same numbers.
   The rendered narrative is written back to `weekly_reviews.ai_summary` (the column specs/13 §Data
   reserves for this spec) together with `delivered_at`. `monthly_report_cards` has no `ai_summary`
   column, so the monthly narrative lives only in `coach_insights`; `/progress` reads it from there.
6. **Locale, RU default, enforced in four layers — and one copy source.** (a) `payload.locale` is
   `settings.locale`, default `ru` (r11). (b) The prompt is *selected* per locale from its own file;
   never machine-translated at runtime. (c) `assertLocale()` strips tokens then requires ≥ 0.85 of
   letters in the expected script. (d) Units and number formatting happen in `render.ts`, never in
   the model. Steps cannot import `next-intl` (r01 §4.11, specs/13 rule 22), but they **can** use
   `createTranslator` from `use-intl/core`, executed standalone with real RU plural output in
   r11 §9 Option A — which is exactly what specs/13 ships as
   `src/server/gamification/i18n-standalone.ts` → `cronTranslator(locale)`. All notification copy and
   every coach fallback string therefore comes from `messages/{ru,en}.json` through that translator,
   under the new `Notify.*` and `Coach.*` namespaces. **Streak-nudge copy is specs/13's
   `Gamification.nudge.*` C1–C7 used verbatim** — it carries the brief's never-guilt-based wording and
   is already lint-checked there, so re-authoring it here would let two reviewed texts drift. Every RU
   plural declares all four categories `one/few/many/other` (r11 §9: Russian routes both 0 and 5 to
   `many`), and `notify-copy.test.ts` renders `n ∈ {1,2,5,11,21}` in RU for every plural key.
7. **Every model call goes through specs/11, with explicit bindings.** `runCoachGeneration` calls
   `callStructuredWithEnv(env, { kind: COACH_AI_KIND[generation], role: 'text',
   tier: COACH_TIER_TO_AI_TIER[tier], schema, schemaName, promptVersion, instructions, userText,
   locale, inputRef: coach_insights.id, timeoutMs: COACH_TIMEOUT_MS[tier], maxRetries: 1 })`. It
   imports **nothing** from `ai`/`@ai-sdk/*`: specs/11 rule 3 bans that outside `src/lib/ai/**` with
   an ESLint `no-restricted-imports` rule plus a CI grep gate, and the brief says "No provider SDK is
   imported anywhere else". `generateObject` is never called from this module, so none of its option
   names appear here; the timeout is specs/11's `timeoutMs`, which becomes
   `abortSignal: AbortSignal.timeout(ms)` — verified as the only available mechanism, since
   `generateObject`'s options are `Omit<RequestOptions,'timeout'>` (`ai@7.0.99` d.ts:7730, specs/11
   rule 4). Without an explicit timeout a hung provider call plus one repair retry can eat the cron's
   hard 15-minute wall clock, network waits included (r01 §4.1), and take the Telegram send down with
   it.
8. **Nothing reachable from `src/jobs/**` or `src/server/coach/**` reads `process.env`.** The model
   instance is built per call from `env` inside specs/11 —
   `createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })` — never from the
   provider's ambient `process.env` default (`GOOGLE_GENERATIVE_AI_API_KEY`, stack-facts). Reason,
   verified: OpenNext populates `process.env` in `init(request, env)` → `populateProcessEnv(url, env)`,
   which runs **only on a fetch**; r01 §4.3's cold-isolate cron probe recorded
   `"processEnvOriginAtStart": null`, and all bindings are available directly on `env` inside
   `scheduled` (r01 §2.5). A warm isolate that served an HTTP request first would work, so this fails
   *intermittently* — 08:05 on a Monday, with nobody watching. `scripts/check-runtime-rules.mjs`
   (specs/01 §31) gains one assertion: no file reachable from `src/jobs/**` or `src/server/coach/**`
   contains `process.env`.
9. **Exactly one repair retry, and one log row per attempt.** On schema or guard failure, retry once
   with the failures appended as a repair instruction; on the second failure emit the deterministic
   template and set `coach_insights.source = 'template'`. The user always gets a message. specs/11's
   writer already inserts exactly one `ai_prompt_logs` row per attempt including `output_json` (the
   validated object, or `{ rawText }` on a parse failure) under the 64 KiB CHECK with `output_r2_key`
   as the escape hatch (specs/11 rule 42, brief §5). **This module inserts no `ai_prompt_logs` row.**
   Guard failures happen after specs/11 has already validated the schema, so the coach *updates* the
   row specs/11 returned by `logId`, setting `ok = 0` and the `GuardFailure[]` JSON in `error` — one
   row per attempt, and the rejected attempt's raw text is still on disk, which is the row you need to
   debug a guard failure.
10. **Tiers, frequency, ceiling — no model id appears in this spec.** `narrative → AiTier 'primary'`,
    `note → AiTier 'cheap'`; `specs/11`'s `AI_MODELS` owns both ids and prices, and pinned-not-floating
    is enforced there (`stack-facts.md`). Hard-coding a Gemini id per generation would break the
    brief's "swappable to `anthropic()`/`openai()` by env change alone": when `AI_PROVIDER` is not
    `google`, specs/11 resolves the id from `AI_MODEL_TEXT` and the coach needs no change.

    | Generation | Tier | `AiKind` | Max frequency | Trigger |
    |---|---|---|---|---|
    | weekly-review | narrative | `coach_weekly` | 1 / week | Monday step |
    | monthly-report | narrative | `coach_monthly` | 1 / month | day-of-month-1 step |
    | deload | narrative | `coach_deload` | 1 / 21 days | `evaluateDeload().due` |
    | program-adjust | narrative | `coach_program` | 2 / month | user request or a deload verdict |
    | plateau | note | `coach_plateau` | 1 / week / lift; 2 / week total | status `plateau`/`regressing` |
    | food-sanity | note | `coach_food` | 1 / week | ≥ 1 anomaly, ≥ 5 logged days of 7 |

    The table generates ≈ 22.6 *generations* per Almaty month (weekly 4.35 + monthly 1 + deload 1.45 +
    program-adjust 2 + plateau 8.7 + food-sanity 4.35), and rule 9 allows one repair retry on each, so
    the worst case is ≈ 45 **calls**. `COACH_MONTHLY_CALL_CEILING = 60` and
    `COACH_MONTHLY_COST_CEILING_USD = 0.50` are therefore set above that worst case: a ceiling below
    normal operation would fire the "something is looping" alert every month and teach the owner to
    ignore it. Authority is D1, exactly as specs/11 rule 43 requires — before every generation,
    `SELECT count(*) c, coalesce(sum(cost_usd),0) usd FROM ai_prompt_logs WHERE feature LIKE 'coach:%'
    AND created_at >= <month start, Asia/Almaty>` — and KV `sys:coach:budget:<YYYY-MM>` is a fast-path
    mirror for the settings/diagnostics display only, never the gate (KV allows 1 write/s per key and
    is eventually consistent). Over either ceiling: no call, template fallback, one `health-alert`.
    The coach's spend **also** counts against specs/11's `AI_MONTHLY_BUDGET_USD` ($5.00) because it
    goes through the same wrapper; when `callStructuredWithEnv` returns
    `{ ok: false, error: { kind: 'budget_exhausted' } }` the coach emits the template with
    `reason: 'budget'` and sends one `health-alert` naming the specs/11 cap, never a fabricated
    narrative.
11. **Program-adjustment proposals are advisory in phase 8.** They persist as `status = 'proposed'`
    with an `actionsJson` array and render as a read-only diff preview. specs/09's entire server
    surface is `activateTemplate, saveRoutine, skipDay, requestDeload, setTrainingMax` — nothing there
    accepts this module's action vocabulary — so an "Accept" that claimed to apply
    `reduce-load-pct`/`swap-exercise` would have nothing to call, and "validated elsewhere" would be
    vacuous. Therefore: the only action with an apply path is `insert-deload-week`, whose single
    Accept button calls specs/09's `requestDeload(programId, 'plateau', weekIndex)` (Behaviour 2);
    every other action kind is display-only and the sheet's primary control is **"Открыть редактор" /
    "Open editor"**, a deep link to specs/09's routine builder with the proposal pinned beside it.
    Dismissing sets `status = 'dismissed'` and suppresses regeneration for the same
    `(generation, entityId)` for 28 days. Making the rest of the vocabulary applicable needs one new
    specs/09 action (`applyCoachActions`) — see Open questions.
12. **Food-log sanity: deterministic detection, AI phrasing.** Over the trailing 7 local days,
    `detectFoodLogAnomalies()` emits `intake-partial-days` (a day under 0.5 × the window median kcal —
    r09 §5's partial-logging rule), `kcal-macro-mismatch` (|logged kcal − kcal from macros| > 15% of
    logged kcal, spec 11's Atwater factors), `impossible-kcal-day` (< 800 or > 6000 kcal) and
    `protein-below-target` (< 80% of target on ≥ 4 of 7 days). Under 5 logged days there is no note —
    there is nothing honest to say.
13. **Empty, loading, error, and the AI label.** Zero workouts in the window ⇒ no AI call; the weekly
    step sends one templated line with a start-a-workout deep link. `/coach` shows three shimmer cards
    while loading, an empty state before the first insight, and on fetch failure the Dexie mirror
    behind an "offline — showing last saved" banner. **Both sources are labelled, not just the
    fallback**: a `model`-sourced insight carries an «ИИ / AI» chip that reveals the pinned model id
    and `promptVersion` on tap (the same disclosure discipline as specs/11's `degraded` badge), and a
    `template`-sourced one is labelled «шаблон / template». Labelling only the fallback would invert
    the disclosure the brief's "honest data" principle asks for. Every insight also carries a one-tap
    «это неверно / this is wrong» that sets `status = 'flagged'` and suppresses that
    `(generation, entityId)` for 28 days — the cheapest way to make a prompt regression visible, and
    the coach's analogue of the food-estimate correction loop.

### Scheduling

14. **Eight steps, five crons, zero new triggers.** Spec 01 owns `worker.ts` and defines exactly
    **five** daily crons and five `CronName`s — `nightly-rollup`, `daily-reminder`, `streak-at-risk`,
    `weekly-review`, `backup-to-r2`; this spec adds none and supplies the *bodies* of eight day-gated
    steps across four of them. The fifth, 00:20 `nightly-rollup`, belongs entirely to specs/13 §20;
    this module runs nothing inside it and only *watches* it. That follows 01 rules 21–22 — **no cron
    expression uses the weekday field** — because Cloudflare numbers weekdays `1 = Sunday … 7 = Saturday`
    (verified against the Cron Triggers syntax table, which calls this *"different on some other cron
    systems"* and recommends `SUN` over `1`), contradicting r01 §3.2's own Monday/Sunday comments.
    Gating in the job turns an unverifiable config ambiguity into a unit-tested pure function, and it
    gates on the **Almaty** weekday, which is what the user means.

    ```ts
    // src/jobs/weekly-review.ts — the module 01 owns; this spec owns its body.
    export async function weeklyReview(c: CronJobContext): Promise<CronJobResult> {
      const day = todayInAppZone(c.scheduledTime);            // never new Date() (01 rule 23)
      const steps: CronStep[] = [achievementAnnounce];        // daily
      if (day.endsWith("-01")) steps.push(monthlyReport);     // 1st of the Almaty month
      if (weekdayInAppZone(c.scheduledTime) === 1) steps.push(tdeeRecompute, weeklyReviewStep);
      let ran = false; const skipped: string[] = [];
      for (const step of steps) {                  // ordered cheapest-side-effect-first
        const r = await step.run(c);               // a throw marks the invocation failed (01 records it)
        ran ||= r.ran;
        if (r.ran) await markStepOk(c.env, step.name, c.scheduledTime);   // rule 20; StepName, stable
        if (!r.ran && r.skippedReason) skipped.push(`${step.name}:${r.skippedReason}`);
      }
      return { ran, skippedReason: skipped.join(",") || undefined };
    }
    ```

    | `CronName` | Cron (UTC) | Almaty | Steps, in order (gate) | Reads | Writes |
    |---|---|---|---|---|---|
    | `nightly-rollup` | `20 19 * * *` | 00:20 daily | **none of this spec's** — specs/13 §20 closes the day, awards XP, runs the achievement sweep and generates `weekly_reviews` / `monthly_report_cards`. Watched by rule 20. | — | — |
    | `streak-at-risk` | `30 15 * * *` | 20:30 daily | `streak-nudge` (daily) | `streak_state`, `streak_ledger`, today's `workouts`/`sets`, active `routines`, `notification_log` (7 d) | `notification_log` |
    | `daily-reminder` | `0 16 * * *` | 21:00 daily | `training-reminder` (daily) → `sync-nudge` (daily) | active `routines`, today's `workouts`/`food_entries`, `settings`, `mutations`, `notification_log` | `notification_log` |
    | `weekly-review` | `5 3 * * *` | 08:05 daily | `achievement-announce` (daily) → `monthly-report` (day 1) → `tdee-recompute` + `weekly-review` (Almaty Monday) | `achievement_unlocks`, `weekly_reviews`, `monthly_report_cards`, `sets`, `workouts`, `personal_records`, `food_entries`, `body_measurements`, `daily_checkins`, `tdee_snapshots`, `deload_events`, `programs` | `tdee_snapshots`, `coach_insights`, `weekly_reviews.ai_summary`/`delivered_at`, `notification_log` |
    | `backup-to-r2` | `0 18 * * *` | 23:00 daily | `watchdog` (daily) → `backup` (Almaty Sunday, **body owned by specs/15** rules 52–56) | `cron_runs`, KV `sys:step:last-ok:*`, `sys:cron:last-ok:*` | `notification_log` |

    Each schedule repeats **daily** — a 24-hour interval — which is what puts it in the 15-minute CPU
    bucket instead of the 30-second sub-hourly one; the limit is measured per schedule's own repeat
    interval (r01 §4.1). **No sub-hourly cron may ever be added.** Five triggers is inside the Paid
    per-account limit of 250 (Free is 5). 01's 20:30 and 21:00 schedules sit 30 minutes apart, which is
    fine for the CPU bucket but not for the user, so rule 19 collapses them to one message per evening.
15. **`tdee-recompute` runs inside the Monday step, before `buildStatsPayload()`**, so the review can
    never quote a stale expenditure figure. It is a step rather than its own cron precisely to make
    that ordering unbreakable.
16. **Every step derives "today" from `scheduledTime`** via `todayInAppZone()` /
    `weekdayInAppZone()` / `dayStartMsInAppZone()` and filters on the stored **`local_day`** column (02
    rule 8). `new Date()` and SQL `date('now')` inside a step are lint errors: at 18:00 UTC the Almaty
    date is already tomorrow, which silently shifts a whole window.
17. **Idempotency uses the unique constraints spec 02 already defines — no new ledger — and the dedupe
    key is kept separate from the audit trail.** `notification_log U(channel, kind, local_day)` allows
    exactly one row per kind per channel per local day, so it can be the once-per-day *guard* or a
    log of every attempt, but not both. It is the guard.

    | Step | Guard | Effect of a replay |
    |---|---|---|
    | any job | `cron_runs UNIQUE(job, scheduled_at)` | a retried firing cannot add a second run row |
    | every `LOGGED_KINDS` send | `notification_log U(channel, kind, local_day)`, inserted **before** the outbound call | the second send that day is refused as `already-sent-today` |
    | `tdee-recompute` | `tdee_snapshots.week_ending_day UNIQUE`, append-only | no duplicate estimate; the replay is a no-op |
    | `achievement-announce` | one `notification_log` row for `kind='achievement'` per local day; `achievement_unlocks.seen_at` marks what was named | a replay announces nothing new |
    | webhook command | `telegram_state.last_update_id` monotonic check | a retried Telegram update is dropped |

    Three consequences, all deliberate. (a) **A skip never burns the slot.** A policy skip writes a
    row with `kind = '<kind>:skip'`, `ok = 0` and its `PolicySkipReason` in `detail` — a *different*
    `kind` value, so the unique constraint still admits the real send later the same day, and "why
    didn't I get it" stays answerable with one query. (b) **`command-reply` takes no
    `notification_log` row at all** — a chat session produces several replies in a day and the
    constraint permits one, so command replies record success in `telegram_state.last_ok_at` /
    `last_error_at` plus one structured log line. `command-reply` is the only member of `NotifyKind`
    outside `LOGGED_KINDS`. (c) **`rest-timer` is not a `NotifyKind`.** specs/06 rule 43 deliberately
    rejects server push for rest ("it needs network, adds seconds, and cron is minute-grained") and
    owns a foreground `registration.showNotification`; a per-second kind could not live under this
    constraint anyway. Retry policy for scheduled invocations is UNVERIFIED (r01 §4.8), so nothing
    assumes retries happen — or that they do not.
18. **Failure behaviour per step.** `training-reminder`, `streak-nudge`, `sync-nudge` and
    `achievement-announce` record the error in the `:skip` row's `detail`, return
    `{ ran: false, skippedReason }` and are never retried: a reminder hours late is worse than none.
    `weekly-review` and `monthly-report` fall back to the template if the AI leg fails and still send —
    the report is the product — and on a failed *send* they return
    `{ ran: false, skippedReason: 'send-failed:<status>' }` rather than throwing, because a throw would
    mark the whole 08:05 invocation failed even though the daily achievement announcement in the same
    job already delivered. The missed send is caught by rule 20's per-step staleness, which is the
    layer designed for it. `tdee-recompute` writes nothing and returns `skippedReason` when an r09 §5
    guard fails (`completeDays < 14`, fewer than 10 weigh-ins, `completeDays === 0`), keeping last
    week's snapshot and surfacing the "calibrating" badge. `backup` (specs/15) throws on a failed R2
    put: a silently missing backup is the worst failure in this area, and specs/15 owns that decision.
19. **Anti-nag rule for `streak-at-risk`, including dormancy.** Send only if **all** hold: the streak
    is at risk per specs/13 rule 23; `streak_state.current_days ≥ 3`; no qualifying activity logged
    today; today is not a planned rest day; **no streak nudge was sent yesterday** (never two nights
    running); ≤ 2 nudges in the trailing 7 local days; not paused; and **not dormant**. `dormant` is
    derived, not stored: `todayInAppZone(scheduledTime) − streak_state.last_active_day ≥ 14` days
    (specs/13 §8). While dormant the daily nudge stops entirely and is replaced by copy
    **C6** (`Gamification.nudge.c6`, the re-entry message) **at most once per 7 local days** — the
    skip reason for the other six days is `dormant`. Copy is reassuring, never guilt-based (brief §8):
    it names the smallest qualifying action and, when `freezes_remaining > 0`, says the freeze will
    cover the day (copy C1/C2). `assertNoBannedPhrases()` enforces specs/13 rule 31's
    `BANNED_COPY_PATTERNS` for coach text too. `training-reminder` (21:00) is then suppressed as
    `collapsed` whenever a streak message was already delivered today — two notifications 30 minutes
    apart saying much the same thing is exactly the nagging the brief forbids. It is also suppressed on
    rest days and when the day's logging is complete, and it never congratulates, which would burn a
    cap slot.
20. **The observability answer to "a failed cron is completely invisible" (r01 §4.7). Staleness is
    tracked per *step*, not per cron.** Every cron here fires daily and every daily step in it
    succeeds, so `max(started_at) WHERE ok = 1` per `CronName` returns to "fresh" the next morning and
    a failed Monday report would be invisible within 24 hours. Instead: on each successful step,
    `markStepOk()` writes KV `sys:step:last-ok:<step>` (epoch ms, TTL 40 d). Three layers.
    (a) `watchdog` runs nightly at 23:00 Almaty and compares, for each of the eight `STEP_NAMES`,
    that key against `STEP_MAX_STALE_HOURS` — `weekly-review` **192** (8 d), `monthly-report` **768**
    (32 d), `watchdog` **26**, and 26 for every other daily step — plus, for each of the five
    `CronName`s, `cron_runs.max(started_at) WHERE ok = 1` against 26 h, which is what catches
    `nightly-rollup` dying (the job this module most needs alive, since Behaviour 5 depends on its
    output). It sends **one** aggregated `health-alert` naming every overdue step and job — one per
    local day by `notification_log`'s unique constraint — exempt from quiet hours and the daily cap.
    (b) The diagnostics page renders 01's `/api/system/diagnostics` plus the per-step table, and the
    app shell shows a persistent banner when *no* job has succeeded in 26 h, read from KV
    **`sys:cron:last-ok:*`** — the exact key specs/01 rule 25 writes, not a private copy — which is
    the one case the watchdog cannot report on itself. (c) `observability.enabled` is already true, so
    invocation logs are retained and every step logs one structured JSON line. The Monday report is the
    human heartbeat: a silent Monday means something is broken.

### Delivery and policy

21. **Notification policy.** `notify()` checks, in order: KV `sys:notify:kill = '1'` (drops everything
    but `health-alert`, instantly and without a deploy; a KV miss means *not killed*, so the switch
    fails open to sending), KV `sys:notify:paused-until` (epoch ms, set by `/pause`), then
    `settings.notify_telegram` / `settings.notify_push`. **Quiet hours** are
    `settings.quiet_from`–`settings.quiet_to` (default 23:00–07:30) Almaty from `scheduledTime`:
    `training-reminder`, `streak-at-risk`, `achievement`, `coach-insight`, `sync-wake` and
    `sync-stuck` are dropped; `weekly-report`/`monthly-report` are deferred to the next 08:05 step
    (a deferral writes no row, so the next local day simply sends); `health-alert` and `command-reply`
    always pass. This is why the **00:20** rollup only *awards* achievements and the 08:05 step
    *announces* them, and why `achievement` always sets `disable_notification: true`. **Daily cap** is
    4 delivered messages per Almaty day across both channels, counted from `notification_log` rows
    with `ok = 1` and a `kind` carrying no `:skip` suffix. There is no queue, no deferral table and no
    re-ranking pass, so a priority order would be unimplementable: `notify()` is synchronous and
    cannot know that a more important message will be requested later the same day. Instead the cap is
    **reserved by kind**: `UNCAPPED_KINDS` = `weekly-report`, `monthly-report`, `health-alert`,
    `command-reply` — the four that must never be dropped — and the cap applies only to
    `coach-insight`, `streak-at-risk`, `training-reminder`, `achievement`, `sync-wake`, `sync-stuck`.
    Since each of those is once-per-day by rule 17, the cap binds only if five or more distinct capped
    kinds fire on one day, which rule 19's collapse rules already make unlikely; when it binds the
    fifth request is refused as `daily-cap` and written as a `:skip` row.
22. **Telegram is primary, Web Push secondary** (r06 §10.2): for one user who already has Telegram
    there is no install requirement, no permission prompt, no VAPID lifecycle and no 410 churn. Push
    earns its place for the two nudges specs/05 depends on (`sync-wake`, `sync-stuck`) and for a
    locked-phone streak nudge — **not** for the rest timer (rule 17c). Every send uses
    `parse_mode: "HTML"` and escapes values with `h()` — only `& < >`. MarkdownV2 is **not** used: it
    reserves ``_ * [ ] ( ) ~ ` > # + - = | { } . !`` plus `\` *everywhere*, so one unescaped `.` in
    `100.5` or `-` in `-350 kcal` returns `400 Bad Request: can't parse entities` and kills the whole
    message (r06 G17) — and a numeric fitness report is the worst possible MarkdownV2 input. `mdv2()`
    stays in the repo, tested; never run either escaper over your own markup (r06 G18). The weekly
    report is **one** message (≤ 4096 chars *after* entity parsing, r06 G19); over the cap the
    narrative is truncated at a paragraph boundary with a deep link — the stats block never is. The
    Bot API base is `env.TELEGRAM_API_BASE` (default `https://api.telegram.org`), so the local cron
    proof can point at a stub instead of messaging the owner.
23. **Webhook.** `POST /api/telegram/webhook/<slug>` where `<slug>` is a random 16-hex **literal,
    committed path segment** — the route file is `src/app/api/telegram/webhook/<slug>/route.ts`, not a
    `[slug]` dynamic segment (specs/04 rule 19). That is what makes the slug do real work with no
    extra check and no new env var: any other path under `/api/telegram/webhook/` is a plain Next
    **404** with no handler to reason about, while the real path answers 401 on a bad secret. A dynamic
    `[slug]` route would have accepted every path segment, which is the state this spec previously
    described as a security control. Checks in order: (a) `x-telegram-bot-api-secret-token` compared
    to `env.TELEGRAM_WEBHOOK_SECRET` with specs/04's `constantTimeEqualUtf8` (imported, never
    re-implemented; empty or undefined expected returns `false`, specs/04 rule 21), returning **401**
    so a stale secret surfaces in `getWebhookInfo.last_error_message` instead of being swallowed;
    (b) `String(chat.id) === env.TELEGRAM_CHAT_ID` for **every** update shape handled (`message`,
    `edited_message`), else 204 and do nothing, because the secret proves the sender is Telegram, not
    that it is the owner — anyone who finds the bot can `/start` it (r06 G15); (c)
    `update_id <= telegram_state.last_update_id` ⇒ 204, since Telegram retries every non-2XX (r06 G14);
    (d) `checkRateLimit(env.TELEGRAM_LIMITER, "/api/telegram/webhook", request)` — **20 per 60 s**,
    because `ratelimits[].simple.period` accepts only `10` or `60` seconds (specs/01, verified in
    `wrangler/config-schema.json`), so a "rolling hour" is not expressible with that binding and the
    window is stated as what the platform can actually enforce; the webhook is exempt from
    `AUTH_LIMITER` (specs/04 rule 19). On rejection the handler returns 204 and writes one structured
    log line and **no reply at all** — a reply would need its own per-hour counter, and 20 commands a
    minute from one human means a loop, which silence is the right answer to. (e) Work inside
    `ctx.waitUntil`, return 204 immediately. `scripts/telegram-set-webhook.sh` sets `secret_token`,
    `allowed_updates: ["message"]`, `max_connections: 1`, `drop_pending_updates: true`, and warns that
    `getUpdates` and `setWebhook` are mutually exclusive, so the chat id must be captured **before**
    registering (r06 G20).
24. **Inbound commands.** `/start`, `/help`, `/today` (kcal, protein, volume, trained y/n), `/streak`
    (current, longest, freezes remaining), `/weight <kg>` (**inserts** a `body_measurements` row for
    today — specs/02 rule 15 deliberately allows several readings per day and the EMA in specs/07
    averages them, so there is no conflict target to upsert on), `/water <ml>`, `/ate <text>`
    (→ spec 11's NL extractor; the reply is a parsed summary plus a deep link and is **never**
    auto-saved, preserving the correction loop), `/report` (re-sends the cached weekly render from KV —
    a read, so it bypasses the cap), `/pause <1–30>`, `/resume`. Unknown text gets one short help
    reply; the bot never echoes arbitrary input. Inbound free text is untrusted and never enters a
    coach prompt — the coach's only input is the numeric payload, which is what makes prompt injection
    through Telegram a non-event.
25. **Web Push library and send path.** `@block65/webcrypto-web-push@2.0.0`: 3.34 KiB gzip against
    `web-push`'s 49.27 KiB, correct RFC 8291 `aes128gcm`, and it hands you the `fetch` so status
    handling is a plain `res.status` check (r06 §3.2). **Never `@pushforge/builder`** — it emits legacy
    `aesgcm`, which Chrome accepts and Apple's push service does not, so it works in dev and fails
    invisibly on the one device that matters (r06 §3.3). Subscriptions are one row per device keyed on
    the unique `endpoint`, upserted on conflict since the browser returns the same endpoint for an
    unchanged grant (r06 §5.1); the client re-POSTs its subscription on every launch, the real repair
    mechanism given `pushsubscriptionchange` is unreliable everywhere. `ttl` is **always** explicit per
    class — `sync-wake` 900 s, `streak-at-risk` 3600 s, else 86400 s — because this library defaults to
    60 s while `web-push` defaults to 28 days (r06 G7). The plaintext ceiling is exactly 3993 bytes and
    every body is padded to 4096, so a push carries a title, a short body and an id, never a report
    (r06 G8). `404`/`410` delete the row; `429` keeps it with `retry-after`; other non-2xx increments
    `fail_count`. `tag` has no effect on Safari (r06 G11), so coalescing uses the RFC 8030 `Topic`
    **request header** (≤ 32 chars).
26. **The service-worker half, and one honest UNVERIFIED.** This spec adds the `push` and
    `notificationclick` listeners to `src/app/sw.ts` — a file specs/05 owns — and they must be
    registered **before** `serwist.addEventListeners()` per specs/05 rule 16 and Serwist's own JSDoc.
    `push` reads `data.notification?.title ?? data.title`, calls `showNotification()` **inside**
    `event.waitUntil()` or the browser substitutes its own generic banner (r06 G9), and for
    `kind === 'sync-wake'` additionally `postMessage({ type: 'sync' })` to every client, which is the
    trigger specs/05 rule 20 lists as one of its six outbox drains. `notificationclick` focuses an
    existing client or opens `data.url`. The payload also carries the Declarative Web Push keys
    (`"web_push": 8030`, `notification.{title,navigate}`) so iOS 18.4+ can render without the service
    worker — **UNVERIFIED**: r06 §6.1 states it did "not verify an actual declarative delivery to a
    device", and whether `@block65/webcrypto-web-push` can set
    `content-type: application/notification+json` (it hardcodes `application/octet-stream`, correct for
    an encrypted body) is likewise unverified. So the SW handler is **authoritative** on every
    platform and the declarative keys are best-effort; WebKit requires `notification.navigate`, which
    is why `NotifyRequest.push.url` is required rather than optional. Nothing regresses if the
    declarative path never works.
27. **`userVisibleOnly` and the sync nudges.** A truly silent data-only push is not available: the
    subscription must be created with `userVisibleOnly: true`, and Chrome substitutes a generic banner
    if the handler shows nothing. `sync-wake` is therefore a **visible** push — one short line, at most
    once per local day, subject to quiet hours — that both wakes the SW to flush and tells the user
    why. `sync-nudge` (the 21:00 step) sends `sync-wake` when the outbox has pending rows, and
    escalates to `sync-stuck` on Telegram when `mutations` shows the oldest pending op older than 24 h
    — the two obligations specs/05 rule 20 and its risk table assign to this spec.
28. **The honest iOS caveat.** Web Push exists on iOS/iPadOS only when the PWA is installed to the Home
    Screen, the manifest `display` is `standalone` or `fullscreen`, the app is launched from that icon,
    and `Notification.requestPermission()` runs inside a real tap (16.4+, r06 §6.1). Before install
    `Notification` is **undefined**, not `"denied"`, so every feature check starts with
    `typeof Notification !== "undefined"` or it throws a `ReferenceError` (r06 G3). After a "Don't
    Allow" there is no in-app second chance; recovery is iOS Settings. So settings shows an
    install-first explainer rather than a dead button, and states plainly that notification `vibrate` is
    a no-op on iOS and on Android 8+ regardless of Chrome version (r06 §6.3, G12) and that
    `setAppBadge` does not work on Android Chrome (G13). The VAPID keypair is permanent: rotating it
    invalidates every subscription (G21), so generate once and back it up outside Cloudflare.

## Data

`specs/02-data-model.md` owns every definition; this module only reads and writes.

- **Writes**: `cron_runs` (via 01's `record()`), `notification_log`, `push_subscriptions`,
  `tdee_snapshots`, `coach_insights`, `weekly_reviews.ai_summary` / `delivered_at` (rows generated by
  specs/13), `telegram_state`, and — only via Telegram commands — `body_measurements` (insert, never
  upsert) and `water_logs`. `ai_prompt_logs` rows are inserted by **specs/11's** writer; this module
  only updates `ok`/`error` on a guard rejection, by `logId` (Behaviour 9).
- **Never written here**: `achievement_unlocks` and `xp_ledger` (specs/13's 00:20 sweep is the only
  writer — two implementations awarding the same achievement is a data bug, not a redundancy);
  `deload_events`/`deload_blocks` (specs/09's `requestDeload`); any R2 object (specs/15).
- **Reads**: `settings`, `app_user`, `telegram_state`, `sets`, `workouts`, `exercises`,
  `personal_records`, `body_measurements`, `food_entries`, `water_logs`, `daily_checkins`,
  `streak_state`, `streak_ledger`, `quests`, `programs`, `routines`, `routine_exercises`,
  `deload_events` (specs/09 — `select max(applied_at_ms)` per `program_id` is what yields
  `daysSinceLastDeload`), `achievement_unlocks`, `weekly_reviews`, `monthly_report_cards`,
  `tdee_snapshots`, `mutations`, `cron_runs`.
- **One new table is required** — nothing in 02 covers it: `coach_insights` in `system.ts` with
  `generation`, `locale`, `window_start_day`/`window_end_day` (`local_day` shape), `severity`,
  `source ('model' | 'template')`, `headline`, `body_json` (the validated output), `stats_json` (the
  payload actually used — required to reproduce a past insight), `source_row_json | null` (which
  `weekly_reviews`/`monthly_report_cards` row it narrated), `actions_json | null`,
  `status ('new' | 'read' | 'proposed' | 'accepted' | 'dismissed' | 'flagged')`, `entity_id | null`,
  `ai_log_id → ai_prompt_logs | null`, plus `INDEX(generation, created_at)` and `INDEX(status)`,
  following 02's conventions (ULID PK, **`syncCols()`** — required so it can be mirrored, epoch-ms
  instants, plain-`text` JSON read through `parseJson()` under the 64 KiB CHECK).
- **`settings` needs five added columns** (02's pattern: `ALTER TABLE ADD COLUMN` with a constant
  default): `notify_telegram=1`, `notify_push=0`, `quiet_from='23:00'`, `quiet_to='07:30'`,
  `notify_daily_cap=4`.
- Every date-shaped read uses the stored **`local_day`** column, never a UTC→local conversion in SQL
  (02 rule 8; r09 §8). DB column names are snake_case throughout — `local_day`,
  `tdee_snapshots.week_ending_day`, `daily_checkins.soreness_json`, `streak_state.current_days`,
  `push_subscriptions.fail_count` — and camelCase is reserved for the Drizzle/TS property.

KV (`CACHE_KV`) — keys are `<domain>:<subject>[:<version>]` and **every** write passes
`expirationTtl` (01 §Data). This module's own keys all sit under 01's declared `sys:*` prefix:
`sys:notify:kill` (TTL 90 d; a miss means not killed) · `sys:notify:paused-until` (TTL = pause
length) · `sys:coach:budget:<YYYY-MM>` (`{calls,usd}`, TTL 70 d — a **display mirror only**; D1 is
authoritative, Behaviour 10) · `sys:coach:render:weekly:<local_day>` (last rendered Telegram HTML,
TTL 60 d, serves `/report`) · `sys:step:last-ok:<step>` (epoch ms, TTL 40 d, rule 20). It **reads**
`sys:cron:last-ok:<job>`, which specs/01 rule 25 writes and specs/15 rule 60 purges; this spec
defines no duplicate of it.

R2: **none.** The `backup-to-r2` cron's Sunday-gated step is entirely specs/15's (rules 52–56): that
spec owns the bucket, the `backups/<yyyy>/<mm>/fitness-<run_key>.ndjson.gz` key, the manifest, gzip
(`CompressionStream('gzip')` with `fflate`'s `Gzip` as the *verified* fallback — not "write
uncompressed"), self-verification and `planRetention` (8 weekly + 12 monthly + 5 manual + 4 archives).
This spec contributes only the Almaty-Sunday gate's place in the step order. The `PHOTOS`-vs-`BACKUPS`
bucket question is open across 01/02/15 and is **not** settled here (specs/15 open question 1).

IndexedDB: `coach_insights` is added to specs/05's `MirrorTable` and `PULL_ONLY` sets and to the
sync-pull response. There is no `coachInsights` store — specs/05 rule 17 ships **one generic `mirror`
store** keyed `[table+id]` precisely so a new feature adds rows, not a schema version. `/coach` reads
`mirror.where('[table+updatedAt]')` bounded to `table = 'coach_insights'`, newest 20, and never
writes.

## UX notes

- `/coach` is a page, but every insight opens a **bottom sheet** — one-handed reach beats context, and
  the sheet's primary action sits in the bottom 25% of the viewport.
- A `program-adjust` proposal renders as a diff list (old → new per exercise) with two 56 px buttons.
  For an `insert-deload-week` action the primary is Accept, which fires a success haptic — a
  foreground tap is the only place vibration works at all (r06 §6.3) — plus a lime confirmation pulse;
  for every other action kind the primary is "Открыть редактор" and no write happens here. Dismiss is
  silent.
- Marking an insight read has **two** affordances, never one: swipe-left, and an explicit button in
  the card header (`aria-label="Отметить прочитанным"`) reachable by keyboard and screen reader
  (WCAG 2.1 SC 2.1.1). The undo control is a persistent inline "Вернуть" in the card that stays until
  dismissed or until the next navigation — never a 5-second toast, which is a SC 2.2.1 timing failure.
- Cards animate in on a staggered spring; `prefers-reduced-motion` collapses that to opacity only.
  Skeleton: three 96 px cards with a shimmering headline bar and two body bars — never a spinner.
- Numbers from `{{stat.*}}` tokens use the mono display face with
  `font-variant-numeric: tabular-nums`, so a re-render cannot reflow a line mid-read.
- The AI chip is a 24 px pill reading «ИИ»/«AI» on `model`-sourced cards and «шаблон»/«template» on
  fallbacks; tapping it reveals the pinned model id and `promptVersion`. «Это неверно» sits in the
  sheet's overflow, one tap, with an inline confirmation and no dialog.
- The diagnostics page is a plain table — job or step, last ok (relative), threshold, last error.
  Rows past their `STEP_MAX_STALE_HOURS` take the amber state; this is the one screen where red is
  allowed.
- Push enable is a two-step sheet on iOS: step 1 explains Add to Home Screen with a screenshot; step 2
  appears only when `display-mode: standalone` matches, and its control is a real `<button>` whose
  handler calls `Notification.requestPermission()` synchronously inside the gesture.
- a11y: each insight is an `<article aria-labelledby>` headed by its headline; the feed is
  `aria-live="polite"` so a new insight is announced once (the diagnostics table is not live). Toggle
  rows are `<label>` + `<input type="checkbox">`, never a styled div, and every settings row is at
  least **48 px** tall with the whole row as the label's hit area. Focus returns to the invoking card
  when a sheet closes.

## Risks

| Risk | Mitigation |
|---|---|
| The coach states a number that contradicts the dashboard. | Structurally impossible on two axes: string-only schemas with digits outside `{{stat.*}}`/`{{exercise.*}}` rejected, and the numbers themselves are *read* from specs/13's stored `payload_json` rather than re-derived, with `sourceRow` recording which row (Behaviour 5). |
| A cron body imports `ai`/`@ai-sdk/*` and trips specs/11's CI gate on the day the coach ships. | The only model entrypoint is specs/11's `callStructuredWithEnv(env, …)`; this module names no model id and imports no SDK. |
| `getCloudflareContext()` or `process.env` used inside `scheduled` — both verified to fail there (r01 §2.4, §4.3), intermittently, at 08:05 with nobody watching. | `dbFromEnv(env)` only; a `check-runtime-rules.mjs` assertion that no file reachable from `src/jobs/**` or `src/server/coach/**` mentions `process.env`; the provider is constructed from `env` inside specs/11. |
| Weekday numbering (`Sunday = 1`) shifts the weekly report by a day, forever. | No cron uses the weekday field (01 rule 21); steps gate on `weekdayInAppZone(scheduledTime)`, unit-tested. |
| A retried firing double-sends the weekly report. | `notification_log U(channel, kind, local_day)` inserted *before* the outbound call, plus `cron_runs UNIQUE(job, scheduled_at)`; skips use a `:skip` kind so they cannot burn the slot. |
| A quiet-hours skip silently blocks the real send later the same day. | Rule 17(a): the skip row's `kind` differs, so the constraint still admits the delivery. |
| A step imports a Next-only module and the wrangler bundle breaks (r01 §4.11). | `src/jobs/**` stays framework-free by rule, enforced with an ESLint `no-restricted-imports` boundary; cron-side copy uses specs/13's `use-intl/core` translator, which r11 §9 executed standalone. |
| A failed weekly report hides behind the same cron's successful daily step. | Staleness is per **step** (`sys:step:last-ok:<step>` + `STEP_MAX_STALE_HOURS`), with an 8-day threshold for `weekly-review` and 32 for `monthly-report` (Behaviour 20). |
| A failed cron is invisible. | Three layers: nightly per-step watchdog alert, diagnostics page, and a 26 h shell banner off `sys:cron:last-ok:*` for when the watchdog itself is dead. |
| MarkdownV2 parse error kills the first real weekly report — it passes every test written with round numbers. | HTML mode only; `h()` escapes `& < >`; r06's vectors pinned as tests. |
| Plateau slope computed over session indices instead of day offsets. | Vector P4: correct `0.136078 %/wk` versus the bug's `1.037549 %/wk` — a plateau misread as progress. |
| An exercise whose name contains digits ("5/3/1 Squat", "45° Leg Press") fails the literal-number guard, so every insight about it silently degrades to a template. | `{{exercise.<id>}}` token space with the same substitution mechanism as stats; a guard test names a lift "5/3/1 Squat". |
| Telegram inbound text reaching an AI prompt (injection). | The coach's only input is the numeric payload; `/ate` text goes solely to spec 11's extractor and is never auto-saved. |
| A looping bug burns the AI budget. | Coach-scoped monthly call and cost ceilings computed **above** the table's ≈ 45-call worst case so the alert means something, D1-authoritative, plus specs/11's own $5 cap underneath. |
| Cron wall-clock duration is a hard 15 min and network waits count against it (r01 §4.1). | Explicit `timeoutMs` (12 s narrative / 8 s note) → `AbortSignal.timeout`; at most two AI calls per job; sends bounded to one Telegram message and a handful of push endpoints. |
| A pre-2024-03-01 imported row read at UTC+5 when Almaty was UTC+6 (r09 §8). | Steps never recompute `local_day`; they read what the importer stored at write time. |

## Verification

```sh
# 1. Types, build, deploy shape (the DO re-export is load-bearing, r01 §4.5).
npm run cf-typegen && npm run build && npx wrangler deploy --dry-run --outdir .dryrun
# PASS: build green; no "Durable Objects, which are not exported in your entrypoint file".

# 2. Pure functions.
npx vitest run tests/unit/coach-plateau.test.ts tests/unit/coach-guards.test.ts \
  tests/unit/coach-prompt-lock.test.ts tests/unit/notify-policy.test.ts \
  tests/unit/notify-copy.test.ts tests/unit/telegram-escape.test.ts tests/unit/job-gates.test.ts \
  tests/unit/push-send.test.ts tests/unit/ios-push-gate.test.ts
# PASS: all green.

# 3. Boundary gates (the two rules that fail silently in production).
grep -rnE "from ['\"](ai|@ai-sdk/)" src/jobs src/server/coach          # PASS: no matches
grep -rn "process\.env" src/jobs src/server/coach                      # PASS: no matches
grep -rn "getCloudflareContext" src/jobs src/server/coach              # PASS: no matches

# 4. Cron fires locally. No scheduler exists in dev, so curl IS the local proof (r01 §4.12), and
# /cdn-cgi/local/scheduled needs no flag (r01 §2.9 method 2) — `npm run preview` is enough.
# 1789355100000 = 2026-09-14T03:05:00Z = Monday 08:05 Almaty. Re-derive any epoch literal with
# `node -e "console.log(new Date(1789355100000).toISOString())"` before committing it.
# .dev.vars sets TELEGRAM_API_BASE=http://127.0.0.1:8799 (a stub returning {"ok":true,...}), so the
# local proof never messages the owner.
npm run preview
curl -sS --get --data-urlencode "cron=5 3 * * *" --data-urlencode "time=1789355100000" \
  --data-urlencode "format=json" http://localhost:8787/cdn-cgi/local/scheduled
# PASS: {"outcome":"ok","noRetry":false}; the stub received exactly one sendMessage.

# 5. Idempotency: replay the identical firing, expect ONE delivered send.
curl -sS --get --data-urlencode "cron=5 3 * * *" --data-urlencode "time=1789355100000" \
  --data-urlencode "format=json" http://localhost:8787/cdn-cgi/local/scheduled
# `DB` is the binding; the database NAME differs between specs/01 and package.json, the binding does
# not (specs/04 rule 28).
npx wrangler d1 execute DB --local --command \
  "select count(*) c from notification_log where kind='weekly-report' and ok=1"   # PASS: c=1
npx wrangler d1 execute DB --local --command \
  "select count(*) c from tdee_snapshots where week_ending_day='2026-09-13'"      # PASS: c=1
npx wrangler d1 execute DB --local --command \
  "select detail from notification_log where kind='weekly-report:skip'"
# PASS: exactly one row, ok=0, detail='already-sent-today' — a DIFFERENT kind value, which is why it
# does not collide with the delivered row on U(channel, kind, local_day).
npx wrangler d1 execute DB --local --command \
  "select ai_summary is not null s from weekly_reviews where iso_week='2026-W37'" # PASS: s=1

# 6. Webhook gates. WH=localhost:8787/api/telegram/webhook/$SLUG; H=x-telegram-bot-api-secret-token
curl -si -XPOST localhost:8787/api/telegram/webhook/deadbeefdeadbeef -d '{}'            # PASS: 404
curl -si -XPOST $WH -H "$H: wrong" -d '{"update_id":1}'                                 # PASS: 401
curl -si -XPOST $WH -H "$H: $TELEGRAM_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d '{"update_id":2,"message":{"message_id":1,"text":"/streak","chat":{"id":-999}}}'
# PASS: 204; telegram_state.last_update_id unchanged (foreign chat id).
curl -si -XPOST $WH -H "$H: $TELEGRAM_WEBHOOK_SECRET" -H 'content-type: application/json' \
  -d "{\"update_id\":3,\"message\":{\"message_id\":2,\"text\":\"/streak\",\"chat\":{\"id\":$TELEGRAM_CHAT_ID}}}"
# PASS: 204; the stub received one sendMessage; telegram_state.last_update_id=3 and last_ok_at set;
# NO notification_log row (command-reply is outside LOGGED_KINDS, rule 17b); re-POSTing update_id 3
# sends nothing further.

# 7. Production proof of the phase-8 DoD, after `npm run deploy`.
npx wrangler triggers deploy --dry-run     # PASS: lists all 5 schedules (≤ 15 min to propagate)
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq '.result.last_error_message'
# PASS: null. Then a Telegram report arrives Monday 08:05 Almaty and cron_runs has ok=1 for it.

# 8. E2E, against a seeded coach_insights fixture and a stubbed /api/coach route.
npx playwright test tests/e2e/coach-and-notifications.spec.ts
```

E2E PASS conditions, stated so the suite is pass/fail rather than "it renders":

1. The feed renders exactly the 4 seeded cards, newest first, each with a visible AI/template chip.
2. A `program-adjust` card opens the sheet; its diff rows equal the fixture's `actions_json` entries
   one-for-one; the only enabled primary is "Открыть редактор", and no network write fires on open.
3. The `insert-deload-week` fixture's Accept posts once to
   `/api/coach/insights/<id>` with `{action:'accept'}` and the card moves to `accepted`.
4. The header "mark read" button (not a swipe) moves a card to `read`, and the inline "Вернуть"
   restores it with no timer involved.
5. With the route stubbed 500, the offline banner appears and the mirror-backed list still renders.

The iOS push gate is **not** an E2E case — a Home-Screen-installed iOS Safari with `Notification`
undefined is not a Playwright target. It is `tests/unit/ios-push-gate.test.ts`: with `Notification`
deleted from the global, the feature check returns `false` and throws no `ReferenceError` (r06 G3);
with a stubbed `matchMedia('(display-mode: standalone)')` returning `matches: false`, step 2 of the
enable sheet does not render.

Named unit cases:

- `olsSlope` / `detectPlateau` — day offsets `[0,7,14,21,28,35]` unless stated, e1RM kg,
  `allTimeBestKg` equal to the series max unless stated. Every number below was recomputed before
  publication.
  **P1** `[120.0,121.0,120.5,121.5,120.8,121.2]` ⇒ slope `0.02612245` kg/day = `0.18285714` kg/wk,
  mean `120.833333`, **`relSlopePctPerWeek = 0.151330`** — inside the plateau band — but the best
  (`121.5`) sits at offset 21, so `daysSinceBestE1rm = 14 < 21` and the status is
  **`progressing`**, not `plateau`: the recency override is the whole point of the rule and P1 is the
  vector that pins it.
  **P2** `[120.0,122.0,123.5,125.0,127.0,128.5]` ⇒ **`1.355802`**, `progressing`.
  **P3** `[128.0,127.0,126.5,125.0,124.0,123.0]` ⇒ **`-0.807659`**, `regressing`.
  **P4 uneven spacing** offsets `[0,4,11,18,26,33,40]`, y `[100.0,101.5,100.8,102.0,101.2,101.9,101.0]`
  ⇒ **`0.136078`**, `daysSinceBestE1rm = 22`, `plateau`; the same series keyed by session *index*
  gives `1.037549` → `progressing`, and the test asserts that value is **not** returned.
  **P5** 5 sessions ⇒ `insufficient-data`. **P6** 14-day span ⇒ `insufficient-data`.
  **P7 recency override, isolated** `[120.0,121.0,120.5,120.8,121.5,121.2]` ⇒ `0.184433`,
  best at offset 28, `daysSinceBestE1rm = 7` ⇒ `progressing`.
  **P8** identical y ⇒ slope `0`, `bestE1rmKg` ties on all six points, earliest-wins gives
  `daysSinceBestE1rm = 35` ⇒ `plateau`.
  **P9** identical x ⇒ `olsSlope` returns `null`, status `insufficient-data`, never `NaN`.
  **P10 a real plateau** `[121.5,120.8,121.2,120.5,121.0,120.6]` ⇒ slope `-0.01877551` kg/day =
  `-0.13142857` kg/wk, mean `120.933333`, **`-0.108679`**, best at offset 0,
  `daysSinceBestE1rm = 35` ⇒ `plateau`.
- e1RM inputs use `docs/research/r09-formulas-and-test-vectors.md` §1 vectors V1–V6: the session-best
  picker must return `100.0000` for V1 (`r === 1 ⇒ w`, never Epley's `103.3333`, which would
  manufacture a fake PR) and must reject the V6 `r = 37` row rather than ingest `Infinity`.
- `evaluateDeload` — `daysSinceLastDeload = 20` with two plateaued lifts and a strain signal ⇒
  `blockedBy: 'too-recent'`, matching specs/09's `DELOAD_TOO_SOON` boundary exactly; `= 21` ⇒ `due`;
  `programId: null` ⇒ `blockedBy: 'no-active-program'` and no generation.
- `tdee-recompute` reuses spec 07's tests over r09 §5's four-week example — blended `2730.4688`,
  `2721.5625`, `2702.6563`, **`2697.5000`** with `prior = 2770.6250` — and adds `completeDays === 0`
  ⇒ `{ ran: false }`, never `Infinity`.
- `telegram-escape` — r06 §8.5 verbatim: `"Bench Press 100.5 kg x 5 (RPE 8.5)"` →
  `"Bench Press 100\.5 kg x 5 \(RPE 8\.5\)"`; `"e1RM = 121.3 kg"` → `"e1RM \= 121\.3 kg"`;
  `"Deficit -350 kcal | Protein 180g"` → `"Deficit \-350 kcal \| Protein 180g"`; and
  `h("A & B <tag>")` → `"A &amp; B &lt;tag&gt;"`.
- `coach-guards` — `"добавил 2,5 кг"` ⇒ `literal-number`; `"{{stat.nope}}"` ⇒ `unknown-token`;
  `"{{exercise.nope}}"` ⇒ `unknown-token`; a payload whose `exercises` map holds
  `{ ex_01: { display: "5/3/1 Squat" } }` accepts `"{{exercise.ex_01}} встал"` with **no** failures and
  renders it as `"5/3/1 Squat встал"`, while the literal `"5/3/1 Squat встал"` ⇒ `literal-number`; an
  English paragraph at `locale: 'ru'` ⇒ `wrong-locale`; `"ты провалил неделю"` ⇒ `banned-phrase`;
  `factCodes: ['new-pr']` with no such fact ⇒ `fact-not-in-payload`; a token-only RU output ⇒ no
  failures.
- `notify-policy` — 23:30 local `training-reminder` ⇒ `quiet-hours`; the 5th **capped** message of a
  day ⇒ `daily-cap` while a `weekly-report` on the same day still sends (`UNCAPPED_KINDS`);
  `health-alert` at 03:00 ⇒ sent; a nudge sent yesterday ⇒ anti-nag skip; `current_days = 2` ⇒ no
  nudge; a streak message already sent today ⇒ reminder `collapsed`; `sys:notify:kill = '1'` ⇒
  everything but `health-alert` dropped; **14 consecutive inactive days ⇒ at most one nudge per 7
  local days, copy key `Gamification.nudge.c6`, the other six days skipped as `dormant`**; two sends
  of the same kind on one day ⇒ the second returns `already-sent-today` and writes a `:skip` row that
  does **not** violate the unique constraint.
- `notify-copy` — every RU plural key under `Notify.*` and `Coach.*` renders correctly for
  `n ∈ {1,2,5,11,21}` (`день / дня / дней / дней / день`), and every such message declares all four
  categories `one/few/many/other` (r11 §9).
- `job-gates` — `2026-09-14T03:05:00Z` ⇒ Almaty Monday ⇒ the weekly step runs; `2026-09-15T03:05:00Z`
  ⇒ `{ ran: false, skippedReason: 'weekly-review:not-monday' }`; `2026-09-13T18:00:00Z` ⇒ Almaty
  Sunday 23:00 ⇒ the backup step runs; `2026-10-01T03:05:00Z` ⇒ day-of-month 1 in Almaty ⇒ monthly
  step runs; `weekly-review` with no `weekly_reviews` row ⇒
  `{ ran: false, skippedReason: 'weekly-review:no-review-row' }` and **no** AI call.
- `watchdog` — with `sys:step:last-ok:weekly-review` set 9 days ago and every other key fresh, the
  alert names exactly `weekly-review` (threshold 192 h) and not `monthly-report` (768 h); with
  `cron_runs` showing no `ok = 1` row for `nightly-rollup` in 30 h, the alert names it too; two runs
  on the same local day produce one `health-alert` row.
- `push-send` — a stubbed 410 deletes the row and appears in `removed`; a 429 keeps the row and records
  `retry-after`; a 4000-byte payload throws before any network call; a payload built without `url`
  fails to type-check (the declarative `navigate` key is mandatory, r06 §6.1).

## Open questions

1. **Web Push ships for the sync and streak nudges — does it ship in phase 8 or as a fast follow?**
   The rest timer is settled and is *not* a consumer: specs/06 rule 43 rejects server push for rest
   outright, r06 G23 confirms `TimestampTrigger` never shipped and G24 that a Worker cron cannot fire
   more often than once a minute, and r06's own recommendation 3 would require a **new Durable Object
   with an alarm** — a class that exists in no spec (01's only DO binding is OpenNext's
   `DOQueueHandler`, and its `migrations` tag lists only that class), so shipping it would need
   amendments to specs/01 *and* specs/06. The real consumers are `sync-wake` (specs/05 rule 20's sixth
   outbox trigger), `sync-stuck` (specs/05's risk row) and a locked-phone `streak-at-risk`.
   (a) Ship both channels in phase 8. (b) Make the phase-8 DoD green on Telegram alone, then add push
   as a sub-task whose consumers are the two sync nudges. **Recommendation: (b)** — the DoD is a
   Telegram report, and the sync nudges are a repair path for a queue that also has five other
   drains, so they can land a week later without blocking anything (r06 D1).
2. **May the coach ever auto-apply a program adjustment?** (a) Always an explicit accept. (b)
   Auto-apply load changes within ±2.5 kg, require an accept above that. **Recommendation: (a)** — an
   AI silently editing the program breaks the brief's "honest data" principle and makes a bad
   suggestion indistinguishable from the user's own decision in the program history.
3. **What happens when the coach's monthly ceiling is hit?** (a) Hard stop: deterministic templates
   for the rest of the month plus one health alert. (b) Downgrade every generation to the cheap `note`
   tier and continue. **Recommendation: (a)** — the ceiling sits above the ≈ 45-call worst case, so
   reaching it means a loop, and a loop that keeps running at a lower price is still a loop.
4. **Cross-spec amendments this spec depends on.** Each is small, each has an owner, and none can be
   made from here. They are listed so nobody discovers them at implementation time.
   - `specs/11-nutrition-ai.md`: add `callStructuredWithEnv(env, args)` to `src/lib/ai/call.ts` and
     six coach members to `AiKind`. **Required** — `callStructured()` takes no `env` and would reach
     bindings through `getCloudflareContext()`, verified to throw inside `scheduled` (r01 §2.4, §4.2).
     The alternative, a `no-restricted-imports` carve-out for `src/server/coach/**`, is worse: it
     duplicates the budget gate, the timeout and the `ai_prompt_logs` writer.
   - `specs/02-data-model.md`: the `coach_insights` table and the five `settings` columns in §Data.
   - `specs/05-pwa-offline-sync.md`: `coach_insights` into `MirrorTable` + `PULL_ONLY` and the pull
     response; and the `push`/`notificationclick` listeners in `src/app/sw.ts`, which specs/05 §34
     already assigns to this spec but whose file this spec does not own.
   - `specs/01-architecture.md`: register `sys:step:last-ok:<step>` in §Data; add a
     `TELEGRAM_LIMITER` (`{limit: 20, period: 60}` — `period` accepts only 10 or 60) to `ratelimits`;
     add `TELEGRAM_API_BASE` (var, optional, default `https://api.telegram.org`) to the env contract.
   - `specs/09-programs.md`: an `applyCoachActions(programId, actions): {applied, rejected[]}` server
     action if `program-adjust` is ever to be more than advisory (Behaviour 11). Until it exists the
     advisory path is the whole feature.
5. **`deload_blocks` (specs/02) vs `deload_events` (specs/09) are two different tables for one
   concept**, with different columns and different unique keys, and only the first exists in 02's DDL.
   This spec writes neither and reads whichever specs/09 ships, so it is not blocked — but
   `daysSinceLastDeload` cannot be queried until 02 and 09 agree. Owner: specs/02 with specs/09.
   (a) Keep `deload_events` and drop `deload_blocks`. (b) Keep `deload_blocks` and give specs/09 a
   `deloadStatus(programId)` helper. **Recommendation: (a)** — `deload_events` carries the
   `week_index` that `requestDeload`'s idempotency key needs.
