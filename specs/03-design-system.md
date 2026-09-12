# 03 — Design system: tokens, components, motion, gym mode, a11y

## Purpose

Turns the brief's "OLED-black + one electric-lime accent" line into a single compiling token source
and a **closed primitive inventory**, so every later spec composes instead of inventing CSS. It owns
`src/app/globals.css`, the font wiring, the i18n request config, the motion vocabulary, the app shell,
the GYM MODE chrome contract, and the accessibility contract (WCAG AA on pure black, focus visibility,
live regions, numeric keyboards). Satisfies the brief's "Design system (concrete, not generic)" and
"Accessibility" bullets plus the 56px+/one-handed/gym-mode requirements of feature module 1.

**This spec does not own any feature component.** SetRow, the keypad, the rest timer, the muscle map,
the calendar heatmap, macro rings, sparklines and the photo comparer are owned by 06/10/12 at their
paths; 03 publishes the tokens, the primitives and the rules they must obey. That boundary is the
single most important thing in this document, so it is restated as a table in **Files to create**.

## Scope

- The token block in `src/app/globals.css`: background layers, lime ramp, heat ramp, semantic colours,
  hairlines, radii, shadows, blur, spacing (incl. tap/gym/thumb sizes), type scale, and the Tailwind v4
  `@theme inline` mapping rules — including which block each new token goes in (§3) and why the
  `:root`-before-`.dark` order is load-bearing (§2).
- Measured WCAG contrast ratios for every pair we ship — including the ghost prefill and every
  adjacent heat step — and the rules that follow (lime is never body text; `--border` is decorative
  only; a heat level is never the sole carrier of meaning).
- `next/font` loading of the two families and the `.readout` tabular-numerals class.
- `src/i18n/**`: the `next-intl` request config, `LOCALE_COOKIE`, and the message-shape gate. Assigned
  here by `specs/01-architecture.md`'s out-of-scope table; accepted (§25).
- The shadcn primitive install list (re-verified against the live registry index), the permitted edits
  to `src/components/ui/**`, and the nine primitives under `src/components/app/**`.
- App shell: bottom tab nav + central FAB, safe-area insets, the tap-target rule and its named
  exception list, thumb-reach zone.
- GYM MODE chrome contract: which chrome is forbidden, font sizes, glove hit-slop — as a contract on
  spec 06's screen, not a second implementation of it.
- Motion: named presets **with the variant objects written out**, the do-not-animate list, the PR
  confetti + haptic recipe, skeletons, and the complete `prefers-reduced-motion` fallback.
- Dark-only decision, focus ring on black, landmarks, rest-timer live-region cadence, icon-only
  labels, numeric keyboard attributes, the estimate/confidence primitive, text-zoom and reflow rules.

### Out of scope

| Excluded | Owner |
|---|---|
| Route groups, layouts, server/client split, `next.config.ts` | `specs/01-architecture.md` |
| Every D1 table/column/index definition, `SET_TYPES`, `MUSCLES` | `specs/02-data-model.md` |
| `SerwistProvider`, `viewport`, `appleWebApp`, `app/manifest.ts`, icon assets, offline fallback, Dexie | `specs/05-pwa-offline-sync.md` |
| **SetRow, NumericKeypad, StepperField, RestTimerBar/Sheet, PrCelebration, E1rmBadge, wake lock**, rest-timer scheduling, PR detection, e1RM, the set state machine | `specs/06-workouts.md` |
| e1RM/plate/warm-up/Navy/EMA/TDEE maths + vectors | `specs/07-calculators.md`, `docs/research/r09-formulas-and-test-vectors.md` |
| Muscle taxonomy and exercise media | `specs/08-exercise-library.md` |
| **CompareSlider, OpacityOverlay, RateBadge** | `specs/10-body-photos.md` |
| `ConfidenceBadge` band words + thresholds, AI copy | `specs/11-nutrition-ai.md` |
| **calendar-heatmap, body-map, macro-rings, sparkline, per-tile skeletons, empty-state**, `LIME_SCALE`, `HeatLevel`, bucketing, visx config, muscle-volume queries | `specs/12-analytics-dashboard.md` |
| Confetti *trigger* conditions, XP/level visuals | `specs/13-gamification.md` |
| RU/EN message **content** (each spec contributes its own namespace) | the owning feature spec |
| Per-route client-JS budget table, `perf-budgets.json`, axe runner pins, the axe route list, the GYM MODE tap-target gate, Playwright/CI wiring | `specs/16-testing-ci-quality.md` |

### Asks on sibling specs (this spec is not implementable until these land)

| # | Spec | Ask |
|---|---|---|
| A1 | `02-data-model.md` | Add `settings.haptics` (bool, `NOT NULL DEFAULT 1`) and `settings.reduce_motion` (bool, `NOT NULL DEFAULT 0`) as `ALTER TABLE ADD COLUMN` with constant defaults, in the same batch as the existing `core.ts — ADDED` list. Neither exists today (§ Data, Open question 1). Spec 06 §46 needs `settings.keep_screen_awake` from the same batch. |
| A2 | `06-workouts.md` | Delete its `src/lib/haptics.ts` Files row — 03 owns that module (it carries the reduced-motion gate) and 06/10/13 import it. Tag the active-session chrome per §20 (`data-chrome`), and confirm the route is `/(app)/workout`. |
| A3 | `01-architecture.md` | Add `withNextIntl(nextConfig)` to `next.config.ts` and `next-intl@4.14.4` to dependencies; 03 owns `src/i18n/**` and `messages/{ru,en}.json`. |
| A4 | `05-pwa-offline-sync.md` | Confirm 05 is the **sole** owner of `viewport` and `appleWebApp` in `layout.tsx`. 03 contributes only the font variables, the `dark` class and `lang`. §9 depends on `viewportFit: "cover"` + `statusBarStyle: "black-translucent"` as an external precondition. |
| A5 | `12-analytics-dashboard.md` | `LIME_SCALE` stays the single source of the heat hexes; 03 mirrors them as `--heat-*` CSS tokens and unit-tests the two for equality. Drop the legend's hardcoded "half" in favour of the live `volume_weights.credit` (§23). |
| A6 | `16-testing-ci-quality.md` | Add `/dev/design` to the §25 axe route list; raise §28's GYM MODE bounding-box threshold from 56 to **72** px (§8/§20); rename the §21 budget row `/workout/[id]` → `/workout` and drop `/workout/new` from §25 unless 06 ships it. |
| A7 | `11-nutrition-ai.md`, `10-body-photos.md` | `ConfidenceBadge` and `RateBadge`'s confidence chip compose 03's `EstimateChip` (§26) rather than inventing a third treatment. 11's settings screen renders **no** theme control (§1). |

## Files to create

| Path | Responsibility | Env |
|---|---|---|
| `src/app/globals.css` | **The only** place raw colour/space/radius/shadow values exist: imports, `@custom-variant dark`, `@theme inline` mapping, `:root` then `.dark` hex, `@layer base`, safe-area utilities, reduced-motion block. | — |
| `src/app/layout.tsx` *(edit; shared)* | `next/font/google` Inter + JetBrains Mono → `--font-app-sans` / `--font-app-mono`; permanent `dark` class; `lang` from the locale cookie. **`viewport` and `appleWebApp` belong to spec 05 (A4).** | server |
| `src/i18n/config.ts` | `LOCALES = ["ru","en"]`, `DEFAULT_LOCALE = "ru"`, `LOCALE_COOKIE = "NEXT_LOCALE"`, `isLocale()`. Pure. | both |
| `src/i18n/request.ts` | `getRequestConfig` — the **only** place locale, `timeZone: "Asia/Almaty"` and shared `formats` resolve (r11 §Recommendation). | server |
| `messages/ru.json`, `messages/en.json` | Namespaced catalogues. 03 owns the file, the `common.*` / `a11y.*` namespaces and the shape gate; every other spec owns its own namespace. | — |
| `src/lib/design/tokens.ts` | TS mirror of the semantic token names for consumers that cannot use Tailwind utilities (visx, canvas). `var(--…)` strings, no hex. | both |
| `src/lib/design/format.ts` | Pure display formatters (`formatKg`, `formatReps`, `formatKcal`, `formatDurationMs`, `formatDelta`, `formatOrDash`, `formatEstimate`). Rendering only; maths is spec 07. | both |
| `src/lib/motion/presets.ts` | Named spring/tween transitions **and the four variant objects**, plus their reduced-motion twins. | client |
| `src/lib/motion/use-reduced-motion.ts` | `usePrefersReducedMotion()` — Motion's hook OR'd with the persisted override. | client |
| `src/lib/haptics.ts` | `haptic(name)` with capability detection and the iOS no-op. **06/10/13 import this one** (A2). | client |
| `src/components/motion-provider.tsx` | `<LazyMotion features={domAnimation} strict>` + `<MotionConfig reducedMotion="user">`; mounted once by the shell. | client |
| `src/components/a11y/live-region.tsx` | `<LiveRegion politeness>` + `useAnnounce()` for the rest-timer countdown and save confirmations. | client |
| `src/components/ui/*.tsx` | Vendored shadcn primitives (list in §7). Permitted edits enumerated in §7; nothing else. | mixed |
| `src/components/app/app-shell.tsx` | Skip link, `<main>`, `<TabBar>`, `<Fab>`, safe-area padding, landmarks. | client |
| `src/components/app/tab-bar.tsx` | 4-slot bottom nav with the centre gap reserved for the FAB. `data-chrome="tabbar"`. | client |
| `src/components/app/fab.tsx` | 72px central quick-add button; opens the quick-add BottomSheet. `data-chrome="app-fab"`. | client |
| `src/components/app/bottom-sheet.tsx` | Sheet wrapper over shadcn `drawer`: snap points, drag-to-dismiss, keyboard-safe, **the history contract of §10**. | client |
| `src/components/app/stat-tile.tsx` | Label + `.readout` value + delta + optional slot for spec 12's `Sparkline`. | server |
| `src/components/app/estimate-chip.tsx` | `EstimateChip` — the one visual treatment for a model-derived or low-confidence number (§26). | server |
| `src/components/app/empty-state.tsx` | `<EmptyState icon copy cta />` — the recipe of §19. Spec 12's `AnalyticsEmpty` wraps it with per-viz copy. | server |
| `src/components/app/skeletons.tsx` | Generic `SkeletonBlock`, `SkeletonRow`, `SkeletonText` + the 150 ms/400 ms timing hook. **Spec 12's `analytics/skeletons.tsx` composes these at per-tile box metrics — that is composition, not a duplicate.** | server |
| `src/components/app/confetti-burst.tsx` | The **single** `canvas-confetti` wrapper in the app: module-level singleton canvas, imperative `fire()`, lazy import, reduced-motion aware. 06's `PrCelebration` and 13's unlock sheet both call it; two canvases would fight (§16). | client |
| `src/app/dev/design/page.tsx` | Dev-only gallery of every token and primitive state; the guaranteed consumer of every custom utility and the target of the Playwright/axe checks. `notFound()` when `process.env.NODE_ENV === "production"` (§27). | server |
| `tests/unit/design-tokens.test.ts` | Parses `globals.css`; asserts the rules in §2–§4 and the heat-ramp/`LIME_SCALE` equality. |
| `tests/unit/format-display.test.ts`, `tests/unit/haptics.test.ts`, `tests/unit/i18n-shape.test.ts` | Formatter vectors; haptic capability branches; RU/EN key-shape equality. |
| `tests/e2e/design-system.spec.ts`, `tests/e2e/gym-mode.spec.ts` | Tap targets, focus ring, landmarks, safe areas, sheet history + scroll lock, 200 % zoom; GYM MODE chrome contract, live-region cadence, reduced-motion run. |

### Components this spec does **not** create (ownership, settled)

The design rules in Behaviour apply to all of them; the code does not live here.

| Thing | Owner + path | Env | Design rules it must obey |
|---|---|---|---|
| Set row | 06 · `src/components/workout/SetRow.tsx` | client | §5b, §12, §8, §22 (real `<table>`) |
| Numeric keypad | 06 · `src/components/workout/NumericKeypad.tsx`, `StepperField.tsx` | client | §11 (contract + key map + step table) |
| Rest timer | 06 · `src/components/workout/RestTimerBar.tsx`, `RestTimerSheet.tsx` | client | §13 (ring, readout, live-region cadence) |
| PR celebration | 06 · `src/components/workout/PrCelebration.tsx` | client | §16 (calls 03's `ConfettiBurst`), §15, §20 |
| Wake lock | 06 · `src/lib/workout/use-wake-lock.ts` | client | §20 (support matrix + the no-video-hack decision) |
| Sparkline | 12 · `src/components/analytics/sparkline.tsx` | **server** | §22 (`role="img"` + numbers in the label) |
| Macro rings | 12 · `src/components/analytics/macro-rings.tsx` | **server** | §22 (visually-hidden `<dl>`), §19 |
| Muscle / body map | 12 · `src/components/analytics/body-map.tsx` (+ `-client` island) | **server** + island | §23, §5e, §22, §19 |
| Calendar heatmap | 12 · `src/components/analytics/calendar-heatmap.tsx` (+ `-client`) | **server** + island | §23, §5e, §8 exception 1 |
| Photo compare | 10 · `src/components/photos/{CompareSlider,OpacityOverlay}.tsx` | client | §8, UX-notes gesture rule |
| Per-tile skeletons, per-viz empty copy | 12 · `analytics/{skeletons,empty-state}.tsx` | server | §19, composes 03's primitives |
| Confidence badge | 11 · `nutrition/ConfidenceBadge.tsx` | server | §26 (composes `EstimateChip`) |

**The server/client split is spec 12's call and it is the right one**: its five SVG surfaces render on
the server with zero client JS, which is what keeps `/` at 185 KB and `/analytics` at the brief's
200 KB ceiling (`specs/16` §21). Nothing in this spec may push them client-side.

## Interfaces

```ts
// src/lib/design/tokens.ts — semantic names for consumers that cannot use Tailwind utilities.
export const token = {
  background: "var(--background)", surface1: "var(--surface-1)", surface2: "var(--surface-2)",
  surface3: "var(--surface-3)", foreground: "var(--foreground)", muted: "var(--muted-foreground)",
  ghost: "var(--ghost)", primary: "var(--primary)", pr: "var(--pr)", border: "var(--border)",
  borderStrong: "var(--border-strong)", success: "var(--success)", warning: "var(--warning)",
  destructive: "var(--destructive)", heatRestRing: "var(--heat-rest-ring)",
  chart: ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"],
  /** Index 0 is the empty state; 1..5 are spec 12's HeatLevel 1..5. */
  heat: ["var(--heat-empty)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)",
         "var(--heat-5)"],
} as const;

/** Literal hex, needed only by APIs that cannot resolve CSS vars (canvas-confetti `colors[]`). */
export const CONFETTI_COLORS = ["#c6ff00", "#e2ff66", "#a5d400", "#f5f5f5"] as const;
```

```ts
// src/lib/design/format.ts — display only; never applied to stored values.
export const EM_DASH = "—";
export function formatKg(kg: number, locale: string): string;      // 82.5 -> "82,5" (ru) / "82.5" (en)
export function formatReps(reps: number): string;                  // integer, no group separator
export function formatKcal(kcal: number, locale: string): string;  // rounded to integer
export function formatDurationMs(ms: number): string;              // <1h -> "m:ss"; >=1h -> "h:mm:ss"; <0 -> "0:00"
export function formatDelta(value: number, unit: "kg" | "kcal" | "pct", locale: string):
  { text: string; tone: "up" | "down" | "flat" };                  // caller renders tone as colour AND a glyph
/** null / undefined / non-finite -> EM_DASH. specs/02 rule 11 NULLs `sets.e1rm_kg` "whenever the
 *  number would be dishonest", and spec 06 renders `—`; this is that one rendering. */
export function formatOrDash(v: number | null | undefined, fmt: (n: number) => string): string;
/** Model- or estimate-derived: `"≈ " + fmt(v)`; null -> EM_DASH. Never used on a user-entered value. */
export function formatEstimate(v: number | null | undefined, fmt: (n: number) => string): string;
```

```ts
// src/lib/motion/presets.ts
import type { Transition, Variants } from "motion/react";   // motion@13.2.0, exports "./react" + "./react-m"

export const spring = {
  snap:  { type: "spring", stiffness: 520, damping: 32, mass: 0.9 },  // set complete, tab switch, chip
  pop:   { type: "spring", stiffness: 700, damping: 24, mass: 0.7 },  // FAB press, PR badge (~8% overshoot)
  soft:  { type: "spring", stiffness: 200, damping: 26, mass: 1 },    // card/list enter, StatTile mount
  sheet: { type: "spring", stiffness: 340, damping: 34, mass: 1.1 },  // sheet in
} as const satisfies Record<string, Transition>;

export const tween = {
  press: { duration: 0.09, ease: [0.22, 1, 0.36, 1] as const },
  fade:  { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
  exit:  { duration: 0.16, ease: "linear" },
} as const satisfies Record<string, Transition>;

export const variants = {
  sheet: {
    initial: { y: "100%" },
    animate: { y: 0,      transition: spring.sheet },
    exit:    { y: "100%", transition: tween.exit },
  },
  listItem: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: spring.soft },
    exit:    { opacity: 0,       transition: tween.exit },
  },
  prBadge: {
    initial: { opacity: 0, scale: 0.72 },
    animate: { opacity: 1, scale: 1,   transition: spring.pop },
    exit:    { opacity: 0, scale: 0.9, transition: tween.exit },
  },
  // Rendered with `initial={false}` and `animate={active ? "active" : "inactive"}`: fixed chrome
  // never animates on mount (§15). Only the glyph moves, never the bar (§15, narrowed).
  tabIcon: {
    inactive: { scale: 1,    y: 0,  opacity: 0.72, transition: spring.snap },
    active:   { scale: 1.08, y: -2, opacity: 1,    transition: spring.snap },
  },
} as const satisfies Record<string, Variants>;

/** The layer-(c) reduced-motion twins (§18): opacity and colour only, no transform, no overshoot. */
export const reducedVariants = {
  sheet:    { initial: { opacity: 0 }, animate: { opacity: 1, transition: tween.fade }, exit: { opacity: 0, transition: tween.exit } },
  listItem: { initial: { opacity: 0 }, animate: { opacity: 1, transition: tween.fade }, exit: { opacity: 0, transition: tween.exit } },
  prBadge:  { initial: { opacity: 0 }, animate: { opacity: 1, transition: tween.fade }, exit: { opacity: 0, transition: tween.exit } },
  tabIcon:  { inactive: { opacity: 0.72 }, active: { opacity: 1 } },
} as const satisfies Record<keyof typeof variants, Variants>;

/** The only sanctioned way to read a variant set — never branch on `reduced` at the call site. */
export function variantsFor(name: keyof typeof variants, reduced: boolean): Variants;
export const MAX_ANIMATED_LIST_ITEMS = 30 as const;
```

```ts
// src/lib/motion/use-reduced-motion.ts
/** OS `prefers-reduced-motion: reduce` OR the persisted override (see ## Data). */
export function usePrefersReducedMotion(): boolean;

// src/lib/haptics.ts
export type HapticName = "tap" | "setComplete" | "restDone" | "pr" | "error";
export function hapticsSupported(): boolean;  // typeof navigator.vibrate === "function"
/** false + no-op when unsupported (all iOS), when the haptics preference is off, or under reduced
 *  motion. Never throws. */
export function haptic(name: HapticName): boolean;
export const HAPTIC_PATTERNS = {
  tap: [10], setComplete: [18], restDone: [30, 60, 30], pr: [12, 40, 12, 40, 24], error: [60, 40, 60],
} as const satisfies Record<HapticName, readonly number[]>;

// src/i18n/config.ts
export const LOCALES = ["ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_COOKIE = "NEXT_LOCALE";
export function isLocale(v: unknown): v is Locale;
```

```ts
// Props of the primitives THIS spec owns. `Env` column of the Files table is authoritative:
// StatTile / EstimateChip / EmptyState / skeletons are SERVER components; the rest are client.
interface BottomSheetProps {
  open: boolean; onOpenChange(open: boolean): void;
  title: string;                       // required — becomes the accessible name
  snapPoints?: readonly number[];      // viewport-height fractions, default [0.55, 0.92]
  dismissible?: boolean;               // default true
  /** Push a history sentinel so the back gesture closes this sheet instead of leaving the route
   *  (§10). Default true; false only for a sheet opened from a sheet-less dev surface. */
  historyGuard?: boolean;
  children: React.ReactNode;
}
interface FabProps { onPress(): void; label: string; icon?: React.ReactNode; hidden?: boolean }
interface TabBarProps {
  items: readonly { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
  activeHref: string;
}
interface StatTileProps {
  label: string; value: string;        // value pre-formatted by src/lib/design/format.ts
  unit?: string; loading?: boolean; href?: string;
  delta?: { text: string; tone: "up" | "down" | "flat" };
  estimate?: boolean;                  // true renders the `≈` prefix + EstimateChip (§26)
  children?: React.ReactNode;          // slot for spec 12's server-rendered <Sparkline/>
}
interface EstimateChipProps {
  /** 0..1, or null for "estimated, confidence unknown". Bands + words are spec 11's (§26). */
  confidence: number | null;
  label: string;                       // band word from the i18n catalogue
  ariaLabel: string;                   // spells the band out — the glyph alone means nothing
}
interface EmptyStateProps {
  icon: React.ReactNode; copy: string;
  cta?: { href: string; label: string };   // exactly one, or none
}
interface ConfettiBurstHandle { fire(): void }   // see §16 for the singleton rule
```

## Behaviour

1. **Dark-only. Decision.** `<html>` carries `class="dark"` permanently plus `color-scheme: dark`;
   there is no theme toggle and no `light:` styling anywhere. The `:root` light block is kept **only**
   so shadcn's many `dark:` variants stay meaningful and a future light theme is a CSS-only change —
   its values are defined for completeness and are **not contrast-measured**; a light theme may not
   ship without a measurement pass (Risks). Spec 02's `settings.theme` is written `'dark'` and ignored
   here, and **spec 11's settings screen must render no theme control** (A7). Record the decision in
   `DECISIONS.md` per the brief's convention, so the two do not drift.
2. **Tailwind v4 token rule (non-negotiable), and the order that is load-bearing.** Raw hex lives in
   `:root` / `.dark`; `@theme inline` only maps `--color-x: var(--x)`. Hex written directly inside a
   plain `@theme` block makes `dark:` stop switching (r12 §B). Block order in `globals.css`:
   `@import "tailwindcss"` → `tw-animate-css` → `shadcn/tailwind.css` → `@custom-variant dark
   (&:is(.dark *))` → `@theme inline` → **`:root`** → **`.dark`** → `@layer base` → the
   `prefers-reduced-motion` media block. A rule above the imports makes Tailwind emit nothing, with no
   error (r12 §G13).
   **`:root` MUST precede `.dark`.** `:root` (pseudo-class) and `.dark` (class) both have specificity
   `0-1-0`, and on `<html class="dark">` both match the same element — so the later declaration wins
   and the whole tree inherits it. **`docs/research/r12` §C writes `.dark` before `:root` and is
   therefore wrong**: pasted verbatim it ships a light-mode app. The already-scaffolded
   `src/app/globals.css` has the correct order (`:root` at line 96, `.dark` at line 138) and must keep
   it; §1 of Verification asserts `indexOf(":root") < indexOf(".dark")`.
3. **Token additions — the literal CSS to append**, split by block so there is no ambiguity about
   which one each token lives in. Everything already in the scaffolded file (`--background`,
   `--surface-*`, `--primary`, `--radius`, `--spacing-tap`, `--spacing-gym`, `--text-readout`,
   `--shadow-card`, `--shadow-glow`, `--ease-spring`, `--radius-card`, `--radius-sheet`, the
   `--color-*` maps and the `--font-*` maps) stays untouched; stock `text-xs … text-3xl` are **not**
   redefined.

   **(a) `:root` additions** — light values, defined so `dark:` keeps switching; not measured (§1):
   ```css
   --lime-100: #f4ffcc; --lime-200: #e2ff66; --lime-400: #c6ff00;
   --lime-500: #a5d400; --lime-600: #84aa00; --lime-700: #4d6600;
   --border-strong: #52525b;
   --ghost: #5a5a63;
   --heat-empty: #e4e4e7; --heat-1: #cfe08a; --heat-2: #a8c24a;
   --heat-3: #7f9a00;     --heat-4: #5d7200; --heat-5: #3d4d00;
   --heat-rest-ring: #c4c4c8;
   ```
   **(b) `.dark` additions** — the shipped, measured values (§4):
   ```css
   --lime-100: #f4ffcc; --lime-200: #e2ff66; --lime-400: #c6ff00;  /* = --primary */
   --lime-500: #a5d400; --lime-600: #84aa00; --lime-700: #4d6600;  /* hover / text-safe / decorative */
   --border-strong: #71717a;   /* the only border allowed to carry meaning (§5b) */
   --ghost: #8a8a92;           /* previous-session prefill (§12); 5.78:1 on --surface-1 */
   /* MUST equal specs/12 LIME_SCALE, element for element (A5, Verification §1). */
   --heat-empty: #1f1f1f; --heat-1: #4a6100; --heat-2: #678600;
   --heat-3: #85ad00;     --heat-4: #a5d500; --heat-5: #c6ff00;
   --heat-rest-ring: #3a3a3a;  /* LIME_SCALE.restRing — the rest-day inset outline */
   ```
   **(c) `@theme inline` additions** — mappings only, so the utilities exist:
   ```css
   --color-border-strong: var(--border-strong);
   --color-ghost: var(--ghost);
   --color-lime-100: var(--lime-100); /* …200, 400, 500, 600, 700 */
   --color-heat-empty: var(--heat-empty);
   --color-heat-1: var(--heat-1); /* …2, 3, 4, 5 */
   --color-heat-rest-ring: var(--heat-rest-ring);
   --spacing-thumb: 12rem;              /* the 192px one-handed band */
   --text-readout-sm: 1.75rem;
   --text-readout-lg: 4rem;
   --text-gym: 2rem;
   --text-gym--line-height: 1.1;
   --text-gym--font-weight: 600;
   --blur-chrome: 16px;                 /* only consumers: TabBar, sheet header — Open question 3 */
   --shadow-sheet: 0 -8px 40px -12px oklch(0 0 0 / 0.8);
   ```
   **(d) plain CSS, after `@layer base`** — safe-area helpers as real utilities, not an invented
   Tailwind namespace:
   ```css
   @layer utilities {
     .pt-safe { padding-top: env(safe-area-inset-top); }
     .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
     .px-safe { padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); }
   }
   ```
   **Every theme shadow colour must carry a literal alpha** (`/ 0.45`, `/ 0.8`): Tailwind v4 silently
   drops `color-mix()` percentages inside `--shadow-*` / `--inset-shadow-*` / `--drop-shadow-*`,
   producing a fully opaque lime glow with no warning (r12 §G4).
4. **Measured contrast** (WCAG 2.x relative-luminance formula, computed from the shipped `.dark` hex;
   AA body text needs 4.5:1, large text and non-text UI 3:1). Light-theme pairs are deliberately
   absent — see §1.

   | Foreground | Background | Ratio | Use |
   |---|---|---|---|
   | `#f5f5f5` | `#000000` / `#0a0a0b` / `#121214` / `#1c1c20` | 19.26 / 18.15 / 17.16 / 15.58 | body, headings |
   | `#a1a1aa` | `#000000` / `#121214` / `#1c1c20` | 8.19 / 7.30 / 6.63 | secondary text, labels |
   | `#8a8a92` (`--ghost`) | `#000000` / `#0a0a0b` / `#121214` / `#1c1c20` | 6.13 / **5.78** / 5.46 / 4.96 | ghost prefill — AA on every surface |
   | `#c6ff00` | `#000000` / `#121214` / `#1c1c20` / `#27272a` | 17.71 / 15.78 / 14.32 / 12.56 | icons, PR flag, focus ring, timer ring, chart 1 |
   | `#0a0a0a` | `#c6ff00` / `#e2ff66` / `#a5d400` / `#84aa00` / `#f4ffcc` | 16.69 / 17.66 / 11.33 / 7.29 / 18.88 | ink on a lime CTA, all states |
   | `#3ddc97` | `#000000` / `#1c1c20` | 11.88 / 9.61 | success |
   | `#ffb020` | `#000000` / `#1c1c20` | 11.48 / 9.29 | warning |
   | `#ff5449` | `#000000` / `#121214` / `#1c1c20` | 6.62 / 5.90 / 5.35 | error — AA, not AAA; never long-form copy |
   | `#84aa00` / `#4d6600` | `#000000` | 7.73 / 3.22 | lime-600 safe as text; **lime-700 large/decorative only** |
   | `#27272a` (`--border`) | `#000000` | **1.41 — FAILS 3:1** | decorative hairline only |
   | `#71717a` (`--border-strong`) | `#000000` / `#1c1c20` | 4.35 / 3.51 | any border that conveys state |
   | **heat vs canvas** — `#4a6100` / `#678600` / `#85ad00` / `#a5d500` / `#c6ff00` | `#000000` | 3.00 / 4.99 / 7.97 / 12.12 / 17.71 | all ≥ 3:1 (WCAG SC 1.4.11) |
   | **heat, adjacent steps** — 1→2 / 2→3 / 3→4 / 4→5 | each other | **1.66 / 1.60 / 1.52 / 1.46 — all FAIL 3:1** | see §23: level is never the sole signal |
   | `#1f1f1f` (`--heat-empty`) | `#000000` / `#4a6100` (L1) | 1.27 / **2.36 — FAILS 3:1** | empty-vs-L1 needs the same mitigation |
   | `#3a3a3a` (`--heat-rest-ring`) | `#1f1f1f` | **1.45 — FAILS 3:1** | rest outline is a redundant cue only |
   | `#0a0a0a` | `#4a6100` (L1) | **2.83 — FAILS 4.5:1** | **no text is ever placed on an L1 cell** |

   r12 §C's eight published pairs and spec 12 §8's five heat-vs-black ratios are reproduced identically
   by this computation; the rest are new, computed the same way. **The adjacent-step failures are
   recorded, not hidden**: five perceptual steps inside a 17.71:1 range cannot each clear 3:1 (that
   would need 3⁴ = 81:1 of headroom), so the ramp is kept and §23 makes a non-colour encoding mandatory.
5. **Colour-meaning rules.** (a) Lime is **never** body text, a paragraph, or a form label — permitted
   only for the focus ring, primary CTA background, active tab indicator, PR flag, timer ring, chart
   series 1, and heat levels 4–5; long lime runs shimmer on OLED and read as an error. (b) `--border`
   at 1.41:1 may never be the sole signal of selected/invalid/active — pair it with `--border-strong`,
   a surface step, an icon, or text. (c) Every tone-coded number from `formatDelta` renders a glyph
   (`↑`/`↓`/`→`) beside the colour. (d) `#000000` is the canvas only; raised surfaces step `surface-1 →
   surface-2 → surface-3`, never a black card on a black page. (e) **A heat level is never the only
   carrier of information** (§23). (f) **Any AI- or model-derived number is visually marked** with the
   `≈` prefix and an `EstimateChip`; a number the user typed never is (§26).
6. **Fonts — exactly two families**, loaded by `next/font/google` in `src/app/layout.tsx`:
   `Inter({ variable: "--font-app-sans", subsets: ["latin","latin-ext","cyrillic"], display: "swap" })`
   and `JetBrains_Mono({ variable: "--font-app-mono", subsets: ["latin","cyrillic"], display: "swap" })`
   — i.e. the pair the Phase-0 scaffold already ships, with `cyrillic` on **both**. The mono family
   must carry Cyrillic or any Cyrillic label inside `.readout` falls back to a system face and the
   tabular-figure guarantee breaks. Verified live against the Google Fonts CSS API on 2026-09-12: Inter
   emits `/* cyrillic */` + `/* cyrillic-ext */` faces and JetBrains Mono emits `/* cyrillic */` +
   `/* cyrillic-ext */`; the mono Cyrillic face is what carries RU digits and labels in `.readout`.
   **Correction to the scaffold and to r12 §D:** the comment in `src/app/layout.tsx` ("Geist … has no
   Cyrillic coverage") is false — `https://fonts.googleapis.com/css2?family=Geist` returns a
   `/* cyrillic */` face at `unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116` and a
   `/* cyrillic-ext */` face. So r12 §D's *conclusion* holds while its stated proof (a `next/font`
   TS union shared by every Google font) proves nothing. Geist is nonetheless **not** adopted: Inter +
   JetBrains Mono is already shipped, already covers Cyrillic on both families, and swapping buys
   nothing. Fix the comment, keep the fonts.
   The variables **must** be named `--font-app-*`: shadcn 4.21 emits a self-referential
   `--font-sans: var(--font-sans)`, an invalid var cycle that silently falls back to the browser default
   with no error anywhere (r12 §G5). Every numeric readout uses `.readout`
   (`font-numeric text-readout tabular-nums` + `font-variant-numeric: tabular-nums slashed-zero`).
   `tabular-nums` equalises digit *widths* only — a readout whose digit **count** can change (a timer
   crossing 9:59 → 10:00) must additionally reserve width: `min-width: 5ch` on the hero readout, or an
   `aria-hidden` `00:00` sizer (§13).
7. **shadcn install list — re-verified against the registry index itself.** `npx shadcn@4.21 init`
   runs `-b radix -p nova` (r12 §E). Names checked on 2026-09-12 against
   `https://ui.shadcn.com/r/index.json` (63 items). Install exactly these **39**:
   `button`, `card`, `dialog`, `drawer`, `sheet`, `popover`, `tooltip`, `tabs`, `input`, `textarea`,
   `label`, `field`, `select`, `native-select`, `checkbox`, `switch`, `radio-group`, `slider`,
   `toggle`, `toggle-group`, `progress`, `badge`, `separator`, `skeleton`, `scroll-area`, `command`,
   `combobox`, `calendar`, `dropdown-menu`, `alert`, `alert-dialog`, `toast`, `spinner`, `empty`,
   `table`, `avatar`, `collapsible`, `kbd`, `chart`.
   **`date-picker` is removed: it is not a registry item.** It is absent from `index.json` and
   `https://ui.shadcn.com/r/styles/new-york-v4/date-picker.json` returns HTTP 404 — the shadcn date
   picker is a docs recipe composed from `popover` + `calendar`, which is how we build ours. Every
   other name above resolves. `shadcn add drawer` pulls **`vaul@1.1.2`** as a transitive dependency
   (that is the sheet engine §10 relies on).
   Anything not on that list is a primitive under `src/components/app/` or a feature component owned by
   a sibling spec. `src/components/ui/**` is vendored and ESLint-ignored (r12 §J). **Permitted edits,
   exhaustive, each inside a `// DESIGN-SYSTEM: do not drop` block:**
   - `button.tsx` — add `tap` (`min-h-tap px-6 text-base`) and `gym` (`min-h-gym px-8 text-gym`) sizes;
     shadcn's default button is 32px and its `lg` is 36px (r12 §G12).
   - `input.tsx`, `textarea.tsx` — `min-h-tap text-base`. shadcn ships `h-9` (36px), unusable
     one-handed, and a sub-16px font makes iOS Safari zoom on focus.
   - `checkbox.tsx`, `switch.tsx`, `slider.tsx` — add the `::after` hit slop of §8. **Visual size is
     unchanged**; only the hit box grows.
8. **Tap targets — one primary rule and a closed exception list.** Every control that commits, deletes,
   navigates the primary flow, or is touched mid-set carries `data-tap="primary"` and has a **≥56px**
   hit area — **≥72px on the GYM MODE route**. Where the visual is smaller than the target (icon
   buttons, row chevrons) the element keeps its size and gains hit slop from an `::after`
   pseudo-element with negative insets — never from padding that shifts layout. Adjacent primary
   targets keep ≥8px of dead space (≥12px in GYM MODE) so a gloved thumb cannot hit two.
   A blanket "every interactive element" rule is **not** achievable and is not asserted: seven of §7's
   installed primitives are smaller than 56px by design and are not patchable beyond §7's list, and a
   7-column day grid at 56px is 392px on a 375px viewport. The named exceptions each carry
   `data-tap="dense"`:

   | Exception | Why it is acceptable |
   |---|---|
   | Date/heat grid cells (`calendar` day grid; spec 12's 12px calendar cells) | WCAG 2.2 SC 2.5.8 **Equivalent** exception — the same function is reachable from 44px `‹`/`›` steppers and the weekly table (spec 12 §7). Fit-mode cells expose no target at all. |
   | `checkbox` / `radio` / `switch` glyphs **inside** a row whose own hit box is ≥56px | the row is the target; the glyph is decoration with a hit-slop `::after`. |
   | `slider` thumb | the track is the target, and every slider ships ± buttons at `data-tap="primary"`. |
   | `command` / `combobox` list items in a scrolling popover | ≥44px; these are search results, never mid-set controls. |
   | `kbd`, `badge`, `separator` | not interactive. |

9. **App shell.** `app-shell.tsx` renders `<a href="#main" class="sr-only focus:not-sr-only">`, then
   `<main id="main">`, then the TabBar. TabBar is `position: fixed; bottom: 0` with four items (Home,
   Workouts, Food, Body) split 2 + gap + 2, the centre gap occupied by the FAB overlapping upward by
   20px; everything else lives behind `/more`. `<main>` gets
   `padding-bottom: calc(var(--spacing-tap) + env(safe-area-inset-bottom))`, the bar gets `.pb-safe`,
   headers get `.pt-safe`. Primary actions sit in the bottom `--spacing-thumb` band; destructive
   actions never do.
   **External precondition (not owned here):** those `env()` values resolve only under
   `viewport.viewportFit: "cover"`, and iOS draws content under the status bar only under
   `appleWebApp.statusBarStyle: "black-translucent"`. Both keys belong to `specs/05` (A4, its Files row
   and §268–271; `docs/research/r05` §2d, §7d). This spec's only guard is the e2e assertion of
   Verification (f) — a non-zero computed `padding-bottom` on the TabBar under an iPhone descriptor —
   which fails loudly if 05 ever drops either key.
10. **BottomSheet is the logging surface, and the back gesture is contractual.** Anything mutating one
    record (log a set, edit a food item, add a measurement) opens a sheet, not a page; anything that
    lists or navigates is a page — so the back gesture always means "close one thing". Snap points
    `[0.55, 0.92]`, drag handle on top, `aria-modal`, focus trapped, `Escape` closes.
    **History contract (`historyGuard`, default on).** Radix Dialog and Vaul push no history entry, so
    without this the Android/PWA back gesture leaves the route and abandons the workout. On open:
    `history.pushState({ sheet: id, depth }, "")`. A `popstate` whose state lacks this sheet's `id`
    calls `onOpenChange(false)` and does **not** navigate. Programmatic close (`Escape`, the close
    button, a successful commit) calls `history.back()` exactly once and lets the `popstate` handler do
    the closing, so there is one code path. Nested sheets stack by `depth`: the top sheet's sentinel is
    popped first, so back closes sheets one at a time before it ever changes route. A sheet unmounting
    for any other reason (route change) removes its listener without calling `back()`.
    **Background scroll lock.** `overscroll-behavior-y: none` on `body` (r12 §C and the shipped
    `globals.css`) prevents scroll *chaining* and pull-to-refresh — **it does not stop the background
    scrolling behind a modal**, and the property name is `overscroll-behavior-y`, not
    `overscroll-behavior`. The lock is Vaul's own body lock (`vaul@1.1.2`, applied by `<Drawer.Root>`
    while open), which pins the body with `position: fixed` and restores `scrollTop` on close; we do not
    hand-roll a second one. Verification (j) asserts `window.scrollY` is unchanged after a drag across
    the backdrop.
    With a NumberPad present the sheet snaps to **0.92** (§11 gives the arithmetic).
11. **Numeric input contract** (the component is spec 06's `NumericKeypad.tsx`; these are the rules it
    must satisfy). A custom pad replaces the OS keyboard for weight/reps, because the iOS numeric
    keyboard eats half the viewport and re-lays-out the sheet mid-set. The underlying `<input>` stays in
    the DOM (`readOnly`, `inputMode="decimal"`, `autoComplete="off"`, `enterKeyHint="done"`) so AT sees
    a real labelled field. Fields that *do* use the OS keyboard set `inputMode="decimal"` (weight kg,
    kcal, grams) or `inputMode="numeric"` (reps, steps, RPE, RIR) with `type="text"` — **never**
    `type="number"`, whose spinners and locale-dependent decimal parsing break on `82,5`.
    **Key map — 4 columns × 5 rows, no ambiguous blanks:**

    | | col 1 | col 2 | col 3 | col 4 |
    |---|---|---|---|---|
    | row 1 | `7` | `8` | `9` | `⌫` |
    | row 2 | `4` | `5` | `6` | `+step` |
    | row 3 | `1` | `2` | `3` | `−step` |
    | row 4 | `.` | `0` (spans cols 2–3) | — | *reserved dead space* |
    | row 5 | **commit** (spans all 4 columns) | | | |

    Col 4 of row 4 is deliberately inert, not a key, so a thumb sliding off `0` cannot commit.
    **Height, computed at 375×667:** at `tap` sizing (56px keys, 8px gaps) the pad is
    `5×56 + 4×8 = 312px`; plus the sheet header (20px handle + 44px title), the value row (56px),
    16px padding top and bottom, and a 34px bottom safe inset = **498px**, inside the 0.92 snap's
    613px. At `gym` sizing (72px keys, 12px gaps) the pad alone is `5×72 + 4×12 = 408px` and the same
    stack is **610px** — 3px of headroom, i.e. no headroom. **Decision: in GYM MODE the pad is not in a
    sheet.** The gym screen is a full page (§20) and the pad renders inline beneath the active set row,
    so the 0.92 snap applies only to `tap` sizing. Both layouts are rem-based and the pad's container
    scrolls rather than clips, with the commit key sticky to the container's bottom edge (§24).
    **Step, min and max per mode** — `weight` derives its step from `settings.barbell_increment_g /
    1000` (spec 02, default 2500 g → 2.5 kg); the rest are fixed:

    | mode | step | min | max | note |
    |---|---|---|---|---|
    | `weight` | `barbell_increment_g/1000` | 0 | 1000 | spec 02 `sets_weight_sane` |
    | `assist` | `barbell_increment_g/1000` | 0 | 1000 | assisted machines store **assistance**, not load |
    | `reps` | 1 | 0 | 500 | spec 02 `sets_reps_sane` |
    | `rpe` | 0.5 | 1 | 10 | spec 02 `sets_rpe_range`; 6.5 is real data |
    | `rir` | 0.5 | 0 | 9 | **derived**, see below |
    | `duration` | 1 s | 0 | 86400 | `sets.duration_sec` |
    | `distance` | 1 m | 0 | 100000 | `sets.distance_m` |

    `duration` and `distance` modes exist because spec 02's `LOAD_MODE` includes `duration` and
    `distance`, and `assist` because it includes `assisted`; without them a plank or an assisted
    pull-up has no input path. **RPE and RIR are one value, not two:** spec 02 records `rir` as
    `RIR = 10 − RPE` (r09 §2), so entering either derives and stores both, and **`rpe` is canonical** —
    the pad round-trips through RPE and writes `rir = 10 − rpe`. The enum is imported, never restated:
    `import { SET_TYPES, type SetType } from "@/db/enums"` — five members
    (`warmup | working | drop | failure | amrap`), and `workout_exercises.superset_group` /
    `sets.superset_round` are **integers**, not strings.
12. **Row states (the rules for spec 06's `SetRow.tsx`).** `empty` → the previous session's values as a
    **ghost prefill in `--ghost` (`#8a8a92`, 5.78:1 on `--surface-1`) with an italic face and a `·`
    prefix**, never as real values and **never as opacity** — `#f5f5f5` at 45% composites to 4.12–4.24:1
    and fails the 4.5:1 this spec requires of body text, while axe reports opacity-composited text as
    "incomplete" so no automated gate would catch it. `editing` → 2px lime left rail; `saved` → solid
    row + tick; `syncing` → tick plus a 3px indeterminate lime bar (queue owned by spec 05); `failed` →
    `--destructive` left rail, inline retry, and the row is never silently dropped. Swipe right past 40%
    of row width completes the set; swipe left past 40% reveals delete and a second tap confirms — one
    swipe never destroys data. Both gestures have visible button equivalents in the row's overflow menu.
    A non-null `superset_round` draws a 2px lime bracket down the left of the grouped rows.
13. **Rest-timer presentation (the rules for spec 06's `RestTimerBar`/`RestTimerSheet`).** Hero variant:
    220px ring, `stroke-dasharray` progress in `--primary`, `m:ss` in `.readout text-readout-lg` centred
    with `min-width: 5ch`, `−15s` / `+15s` / `Skip` as three 72px buttons. Only `stroke-dashoffset`
    animates; **the digits never animate.** The visible readout sits in a
    `role="timer" aria-live="off"` element. A separate `aria-live="polite" aria-atomic="true"` node is
    written **only** when the remaining time crosses **60s, 30s, 10s and 0** — a per-second live region
    makes VoiceOver unusable. Each threshold is **edge-triggered and latched**: it fires on the first
    tick at or below the threshold and never again for that rest, so `onAdjust(+15000)` back across 30s
    does not re-announce. A rest shorter than 60s therefore yields three announcements, not four, and
    the count is a pure function of the starting `totalMs` — Verification (h) pins both cases. At 0 the
    ring flashes `--success` twice and `haptic("restDone")` fires; push delivery is spec 14.
14. **Motion presets**, fixed in `src/lib/motion/presets.ts` and written out in full in Interfaces:
    `snap` (520/32/0.9), `pop` (700/24/0.7 — deliberate ~8% overshoot), `soft` (200/26/1),
    `sheet` (340/34/1.1); tweens `press` 90ms, `fade` 180ms, `exit` 160ms, the first two on
    `cubic-bezier(0.22, 1, 0.36, 1)` (r12's `--ease-spring`). Every spring writes all three parameters
    explicitly — never rely on Motion's defaults. The four variant sets (`sheet`, `listItem`, `prBadge`,
    `tabIcon`) and their reduced-motion twins are defined there too; **no consumer may author its own
    sheet or list-item variant** — it calls `variantsFor(name, reduced)`.
    Import from `motion/react` (`motion@13.2.0`, `docs/research/stack-facts.md`; the packument exports
    `./react` and `./react-m`, peer `react ^19`). The shell wraps the tree in
    `<LazyMotion features={domAnimation} strict>` and components import `motion/react-m`: Motion's own
    LazyMotion docs state the full `motion` component is *"around 34kb"* and that `LazyMotion` + `m`
    *"reduce this to 4.6kb for the initial render"*, and `strict` *"will throw an error if a `motion`
    component renders within a `LazyMotion` component"* — turning an accidental `motion.*` import into a
    build-time failure instead of a silent 30kb regression. That headroom is what keeps
    **`specs/16-testing-ci-quality.md` §21's** per-route budget table reachable (spec 01 owns no budget).
    **Every literal here needs `as const`** or TS strict rejects it: `ease: [0.22, 1, 0.36, 1]` widens to
    `number[]` while Motion's `Transition.ease` wants the 4-tuple, and
    `MAX_ANIMATED_LIST_ITEMS: 30` / `HAPTIC_PATTERNS` / `CONFETTI_COLORS` must be `as const satisfies …`,
    not `declare`d-then-initialised.
15. **What must not animate:** numeric readouts (timer digits, weight, reps, kcal, e1RM — value changes
    are instant); `height`/`width` (transform only); `filter` and `backdrop-filter`; **the TabBar's and
    FAB's own position and size** (fixed chrome must never move under a thumb — the indicator and the
    icon glyphs *inside* them do animate, via `variants.tabIcon`); anything scroll-linked; list items
    past `MAX_ANIMATED_LIST_ITEMS = 30` (the 31st onward render without `layout`); and everything inside
    GYM MODE **except the timer ring, the PR badge and the confetti canvas** (§16, §20).
16. **PR confetti + haptic recipe.** On a PR (detection and the celebration copy are spec 06's
    `PrCelebration.tsx`) the app calls `confettiRef.current.fire()`, then `haptic("pr")`, then pops the
    lime PR badge with `variants.prBadge` (`pop` spring). Confetti is `canvas-confetti@1.9.4` +
    `@types/canvas-confetti@1.9.0` (both the current latest on the npm registry, checked 2026-09-12),
    dynamically imported on first PR so it never lands in the initial bundle. Instance:
    `confetti.create(canvasEl, { resize: true, useWorker: false, disableForReducedMotion: true })`.
    Two bursts:
    `{ particleCount: 60, spread: 55, startVelocity: 45, decay: 0.9, origin: { x: 0.5, y: 0.7 }, colors: CONFETTI_COLORS, zIndex: 60 }`,
    then after 120ms the same with `{ particleCount: 40, spread: 90, scalar: 0.8 }`. Every option name
    above is verified present in canvas-confetti's README. The canvas is
    `position: fixed; inset: 0; pointer-events: none`.
    **`useWorker` is deliberately `false`, and the canvas is a module-level singleton.** The README is
    explicit that with a worker *"I own your canvas now … You must not try to use the canvas in any way
    … as it will throw an error"* — control transfers via `transferControlToOffscreen`, which throws
    `InvalidStateError` on a second `create()` against the same element, so a React 19 StrictMode
    double-mount or a remount on route change crashes the celebration. It also builds its worker from a
    `blob:` URL, which a strict CSP (spec 11's rule) blocks silently. Two short bursts on the main thread
    cost nothing measurable, and the brief's acceptance checklist contains "PR-with-confetti", so a
    silent block would fail an acceptance item. `confetti-burst.tsx` therefore creates **one** canvas
    outside React's lifecycle, memoises the instance on the module, and `fire()` is a no-op when
    `usePrefersReducedMotion()` is true. 06 and 13 share that one instance (A2); neither creates its own.
17. **Haptics are Android-only, and no UI may depend on them.** `HAPTIC_PATTERNS`: `tap [10]`,
    `setComplete [18]`, `restDone [30, 60, 30]`, `pr [12, 40, 12, 40, 24]`, `error [60, 40, 60]`.
    `navigator.vibrate` is **unsupported in every version of Safari and iOS Safari**: caniuse
    `features-json/vibration.json` (fetched 2026-09-12) reports `"n"` for `safari` 3.1–18.7 and for
    `ios_saf` 3.2–**26.6**, while Chrome 154 and Chrome Android 151 report `"y"`. There is no polyfill,
    so on iPhone `haptic()` returns `false` and does nothing, and **every haptic is paired with a visible
    change** — that pairing is the only feedback guarantee this spec makes.
    **Decision: no native-switch haptic path.** An earlier draft rendered the GYM MODE "set complete"
    control and the Settings toggles as `<input type="checkbox" switch>` to obtain WebKit's system tap.
    That is dropped, for three independently fatal reasons. (a) It does not compile: `@types/react@19.3.0`
    — read locally — declares `InputHTMLAttributes` with `checked`, `readOnly`, `type`, `enterKeyHint`,
    `inputMode` and no `switch` member, so under TS strict it is `error TS2322`. (b) It contradicts §7,
    which installs shadcn `switch` — Radix's `button[role="switch"]`, not an `<input>` — and can never
    fire a native control's haptic. (c) The support and behaviour do not justify an escape hatch: MDN BCD
    `html.elements.input.switch` reports `safari: 17.4`, `safari_ios: mirror` (17.4 — **not** iOS 18),
    `chrome: false`, `firefox: false`, with `status.experimental: true` and
    `status.standard_track: false`, so Android — the only platform with `vibrate` — does not render it at
    all. Whether iOS fires a haptic for it is a behaviour claim with no primary source and is marked
    **UNVERIFIED**; nothing in this app depends on it. iOS gets visual and audio feedback only.
18. **`prefers-reduced-motion` — three layers, all required.** (a) The CSS block in `globals.css` zeroes
    `animation-duration`, `transition-duration` and `scroll-behavior` globally. (b)
    `<MotionConfig reducedMotion="user">` makes every Motion component drop transform and layout
    animations while preserving opacity and colour. (c) Component level via `usePrefersReducedMotion()`
    and `variantsFor(name, true)`: confetti does not fire at all (`disableForReducedMotion: true` is the
    second belt), the timer ring steps once per second instead of animating, skeletons render as a static
    `--surface-2` block with no shimmer, sheets appear with a 180ms opacity fade instead of a Y-spring,
    SetRow swipes work without the rubber-band, and the PR badge appears without overshoot. One-off
    overrides use Tailwind's `motion-reduce:` / `motion-safe:` variants only. The persisted preference
    (see ## Data) forces layer (c) on even when the OS does not ask.
19. **Skeleton / empty / error / loading.** Skeleton = `--surface-2` block, `rounded-card`, one 1.4s
    shimmer at 6% white (never lime), shown only after 150ms of pending — below that, nothing, because a
    flash is worse than a wait — then held ≥400ms to avoid a strobe. Lists render 3 `SkeletonRow`s;
    charts render at the final aspect ratio so nothing reflows on arrival (spec 12 owns the per-tile box
    metrics and composes these primitives). Empty state = 24px muted icon + one sentence + **exactly one**
    primary CTA, never a bare "no data". Error state = an inline `--destructive` card with retry; toasts
    are for transient success only, never for an error the user must act on. A value the model produced
    carries the `≈`/`EstimateChip` treatment (§26); a value deliberately suppressed renders
    `formatOrDash(...)` → `—`, never `0`.
20. **GYM MODE chrome contract.** It is a **route, not a toggle**, so it gets its own history entry and
    needs no persisted flag — and that route is spec 06's **`/(app)/workout`** (`src/app/(app)/workout/
    page.tsx`, a static shell so precaching survives, r05 §6c). There is no `[id]` segment and no `/gym`
    segment; the active-session screen *is* GYM MODE, and 03 ships no `gym-layout.tsx`. Spec 16 §21's
    budget row must be renamed to match (A6).
    **Forbidden on that route — asserted:** the app-shell TabBar (`[data-chrome="tabbar"]`) and the
    app-shell FAB (`[data-chrome="app-fab"]`) must not exist in the DOM, because global navigation under
    a thumb mid-set is how a set gets lost. Also removed: breadcrumbs, Sparklines, StatTiles, tooltips,
    secondary navigation, every non-essential icon.
    **Permitted and expected:** a screen-local sticky session header (exercise name + `Finish`) and a
    screen-local `Add exercise` control — both spec 06's, both at `min-h-gym`, both tagged
    `data-chrome="session"`. Spec 06's `ActiveSessionScreen.tsx` calls its own control a "FAB"; that is
    fine, and it is why the assertion is on `data-chrome`, not on a class or a shape.
    **Kept:** exercise name, RestTimer hero, the current set row with its inline pad, the superset
    bracket, **the PR badge and the confetti canvas** (§15, §16), and `Next exercise` / `Finish` as two
    72px buttons. **Sizes:** exercise name `text-2xl`, set numerals `.readout text-readout-lg` (64px),
    all controls `min-h-gym` (72px), labels `text-gym` (32px), 16px gutters, 12px inter-target dead
    space.
    **Wake lock** is spec 06's `use-wake-lock.ts`; the design decision it must implement:
    `navigator.wakeLock.request("screen")` on mount, re-acquired on `visibilitychange` when the document
    becomes visible (a lock is auto-released once the document is inactive), released on unmount. Support
    per MDN BCD `api/WakeLock.json`: Chrome/Edge 84+, Safari 16.4+, **iOS Safari 18.4+ — and 16.4 to
    18.4 explicitly does not work in standalone Home Screen web apps**, which is exactly our install
    target (spec 05 requires `display: "standalone"`). **Decision:** when unsupported or denied, show a
    one-time dismissible note asking the user to raise Auto-Lock, and do **not** ship the
    looping-muted-video hack — it burns battery and CPU to work around something iOS 18.4 already fixed.
    **Glove-friendliness:** 72px targets, `touch-action: manipulation` (removes the 300ms
    double-tap-zoom delay), `-webkit-tap-highlight-color: transparent` (r12 §C), swipe thresholds raised
    from 40% to 50% of row width, and no gesture needing precision finer than a thumb pad.
21. **Focus ring.** `:focus-visible` only — never `:focus` — renders `outline: 2px solid var(--ring)`
    (`#c6ff00`: 17.71:1 on black, 14.32:1 on `--surface-3`, 12.56:1 on `--border`) with
    `outline-offset: 2px`. shadcn's base layer sets `outline-ring/50`; our `@layer base` overrides it to
    **full opacity — for consistency, not for contrast.** The honest numbers: `#c6ff00` at 50% alpha
    composites to 4.62:1 on `#000000`, 4.66:1 on `--surface-1`, 4.65:1 on `--surface-2`, 4.51:1 on
    `--surface-3` and 4.23:1 on `--border` — all comfortably above the 3:1 non-text threshold, so the
    earlier "not reliably ≥3:1" claim was false. The real reasons to override: a composited alpha depends
    on whatever sits behind a translucent sheet or blurred bar, where it is not computable in advance,
    and one ring colour across every surface is one thing to verify instead of five. `outline: none` never
    appears in our CSS, and focus is never conveyed by a background change alone. Focus order follows DOM
    order; opening a sheet moves focus to its heading and closing restores it to the trigger.
22. **Landmarks and semantics.** Exactly one `<main id="main">` per page; TabBar is `<nav aria-label>`
    with `aria-current="page"` on the active item; page headers are `<header>`; the workout set list is a
    real `<table>` with `<th scope="col">` (Set / Weight / Reps / RPE) so AT announces column context, not
    a div grid; heading levels never skip. Every icon-only control (FAB, ±15s, Skip, delete, front/back
    toggle, compare-mode toggle) carries an `aria-label` from the `a11y.*` namespace of
    `messages/{ru,en}.json` (§25), and inline SVG icons carry `<title>`; decorative SVG gets
    `aria-hidden="true"` and `focusable="false"`. Spec 12's Sparkline, MacroRings, body map and calendar
    heatmap each expose `role="img"` with an `aria-label` containing the actual numbers, and MacroRings
    additionally renders a visually-hidden `<dl>` of current/target per macro — a ring conveys nothing to
    a screen reader.
23. **The heat ramp is a design token, not an algorithm.** `heat-scale.ts` and `heatStop(normalized)` are
    **deleted**. Data → level is `specs/12-analytics-dashboard.md`'s job and its model is the one that
    ships: `muscleLevel(creditedHardSets)` on **absolute** edges `0 / 2.5 / 5 / 10 / 16`, and
    `calendarLevel(tonnageKg, cuts)` on trailing-365-day percentiles, both returning
    `HeatLevel = 0 | 1 | 2 | 3 | 4 | 5`. Spec 12 **rejects** relative-to-self normalisation outright,
    because a deload week would light the whole body up — so a `0..1` "normalized" input is not just a
    different shape, it is the model this project decided against. This spec therefore publishes **six
    ramp tokens** (`--heat-empty` plus `--heat-1..5`) plus `--heat-rest-ring`, mirroring `LIME_SCALE`
    element for element (A5), and nothing else about heat.
    **Level is never the sole carrier of information**, because it cannot be: adjacent steps are
    1.46–1.66:1 apart and empty-vs-L1 is 2.36:1 (§4). Mandatory, on every heat surface: (a) the
    level and its underlying count are published as `data-level` / `data-sets` (or `data-date`) on the
    group, which is also what makes the tap handler and the e2e assertions possible; (b) a numeric
    readout appears on tap; (c) the same numbers appear as text in the same view — spec 12's weekly
    volume table is the body map's a11y fallback, and no second widget is invented for it. **No text is
    ever placed on an L1 cell** (2.83:1). The rest-day inset outline is a redundant cue at 1.45:1 and may
    never be the only difference between two cells.
    The half-credit legend is **spec 12's**, not this module's: 12 §12 already fixes the wording, takes
    `SECONDARY_MUSCLE_CREDIT` from `@/lib/calc` and never writes a literal `0.5`. Since spec 02 stores
    the credit as a user-editable row (`volume_weights.role → credit`), the legend must interpolate that
    live value rather than say "half" (A5) — a hardcoded word can lie the moment the user edits it.
24. **Text zoom and reflow (WCAG 1.4.4 / 1.4.10), which axe cannot detect.** Every fixed dimension in
    this system is authored in `rem` (`--spacing-tap` 3.5rem, `--spacing-gym` 4.5rem,
    `--spacing-thumb` 12rem, the type scale) so a 200% text setting scales the chrome with the text
    rather than clipping it. Two layouts must then **scroll, never clip**: the GYM MODE screen (its
    session header stays sticky, the set list scrolls) and the numeric pad (its container scrolls with
    the commit key sticky to the bottom edge, so the commit key is reachable at any zoom). No horizontal
    scrollbar may appear at a 320 CSS px width; wide content (the calendar heatmap, tables) scrolls
    inside its own `overflow-x: auto` container, never the page body. Verification (k) asserts both.
25. **i18n request config (accepted from spec 01).** `specs/01-architecture.md`'s out-of-scope table
    assigns "i18n request config + locale cookie" here, and no sibling spec claims it, so 03 owns it
    rather than leaving §22's `aria-label` catalogue with no source. Adopt **`next-intl@4.14.4`** in
    r11's "without i18n routing" mode: no `[locale]` segment, no `next-intl` middleware, locale in the
    `NEXT_LOCALE` cookie, `timeZone: "Asia/Almaty"` pinned once in `src/i18n/request.ts`. Verified on the
    npm registry 2026-09-12: `next-intl@4.14.4` is the current latest and peer-allows `next ^16.0.0` and
    `react ^19.0.0`; `next@16.3.5` satisfies it. `withNextIntl(nextConfig)` must be added to
    `next.config.ts`, which is spec 01's file (A3). 03 owns `src/i18n/**`, the `common.*` and `a11y.*`
    namespaces, and `tests/unit/i18n-shape.test.ts` (RU and EN must have identical key shape — r11
    gotcha 5); **every other spec owns its own namespace's strings.** `formatKg`/`formatKcal`/
    `formatDelta` take an explicit `locale: string` so they are usable from a server component that has
    no provider above it.
26. **Confidence and estimates are a first-class primitive**, because the brief makes "honest data (show
    AI confidence, let the user correct)" a principle and three siblings were otherwise each inventing
    their own chip. `EstimateChip` is the single treatment: `--surface-2` fill, a `--border-strong`
    hairline, `--muted-foreground` band word, a band icon, and an `aria-label` that spells the band out
    — colour is never the only carrier. Every AI- or model-derived number renders with a leading `≈`
    via `formatEstimate(...)`; a value the user typed never does; a value deliberately suppressed renders
    `formatOrDash(...)` → `—` (spec 02 rule 11 NULLs `sets.e1rm_kg` "whenever the number would be
    dishonest", and spec 06 renders `—` for exactly that). Spec 11 owns the band **thresholds and words**
    (`<0.4` низкая · `0.4–0.7` средняя · `>0.7` высокая) and its `ConfidenceBadge` composes this chip;
    spec 10's `RateBadge` confidence chip and spec 12's "As of {generatedAt}" banner compose it too (A7).
27. **`/dev/design` is the design contract, and it is self-gating.** Every token and every primitive
    state must be reachable there with no app data, because that page is what the tap-target, focus and
    axe checks run against and it is the guaranteed consumer of every custom utility (§ Verification 0).
    It is excluded from production by the page itself — `if (process.env.NODE_ENV === "production")
    notFound()` — because spec 01 defines no dev-route exclusion mechanism and inventing a cross-cutting
    one here would be worse than one line in one file. It sits inside the authenticated tree
    (`isPublicPath()` returns `null` for it, and spec 04's `PublicReason` union gains no dev member), so
    its Playwright specs reuse spec 16's `storageState.json` from `tests/e2e/global-setup.ts` — the same
    fixture `/`, `/workouts` and every other protected route in the axe list already use.
28. **Formatter edge cases.** `formatKg(82.5,"ru") === "82,5"` and `formatKg(82.5,"en") === "82.5"`;
    `formatKg(80,*)` has no trailing `,0`; `formatDurationMs` is **`m:ss` under an hour** —
    `0 → "0:00"`, `-1 → "0:00"`, `59_999 → "0:59"`, `90_000 → "1:30"`, `3_600_000 → "1:00:00"` — and
    every readout that renders it reserves width for the widest form (§6), because `tabular-nums`
    equalises digit widths but cannot hide a digit *count* changing at 9:59 → 10:00.
    `formatDelta(0, …).tone === "flat"` and its text carries no sign. All formatting goes through
    `Intl.NumberFormat` with the active locale; nothing is ever stored formatted. The full vector list
    is in Verification §2.

## Data

This module owns no tables and writes none.

**It reads two preferences whose columns do not yet exist.** `specs/02-data-model.md`'s `settings`
table is `locale, timezone, unit_system, theme, default_rest_seconds, barbell_increment_g, updated_at`
plus its ADDED list (`bar_mass_g`, `ez_bar_mass_g`, `plate_inventory_json`, `streak_freeze_budget`,
`streak_grace_per_week`, `weekly_target_sessions`, `ai_provider`) — **neither `haptics` nor
`reduce_motion` appears**, and spec 02 states that no other spec may define, rename or widen a table.
Both are therefore **UNVERIFIED** and requested as A1 (`haptics` bool `NOT NULL DEFAULT 1`,
`reduce_motion` bool `NOT NULL DEFAULT 0`, as `ALTER TABLE ADD COLUMN` with constant defaults). Nothing
here blocks on them: until they land, `usePrefersReducedMotion()` is the OS media query OR'd with
`localStorage["fit.ui.v1"].reduceMotion`, and `haptic()` is gated by
`localStorage["fit.ui.v1"].haptics ?? true`. When the columns land, D1 becomes the source of truth and
`localStorage` stays a cache — no call site changes.

`localStorage["fit.ui.v1"]` holds `{ haptics: boolean, reduceMotion: boolean }`, mirrored on write.
It is applied **after hydration, not on the first paint**: doing it synchronously would need a blocking
inline `<script>` in `<head>` (the next-themes pattern), and `specs/05-pwa-offline-sync.md` requires
`src/app/layout.tsx` to stay **static**, while reading `localStorage` during a client render produces a
hydration mismatch. There is no flash to hide, because both defaults are the CSS-correct state: motion
is opt-*out* (the OS media query already governs the first paint via the `@media` block and
`<MotionConfig reducedMotion="user">`), and haptics are invisible.

No KV keys, no R2 key patterns, no IndexedDB stores of its own — spec 10's compare components receive
already-signed R2 URLs, and the sync state rendered by spec 06's `SetRow` comes from the Dexie queue
defined in `specs/05-pwa-offline-sync.md`. Fonts come from `next/font` (self-hosted under
`/_next/static/media`); icons are Lucide (bundled) plus static `public/icons/**` owned by spec 05. No
design asset is fetched at runtime.

## UX notes

- Sheet vs page: mutating one record → BottomSheet; browsing or navigating → page. No exceptions, so
  the back gesture always means the same thing — and §10's history sentinel is what makes that true
  rather than aspirational.
- Gestures: swipe-right completes a set, swipe-left reveals delete (two-step), vertical drag on the
  sheet handle snaps or dismisses, horizontal drag on spec 10's compare slider moves the divider. Every
  gesture has a visible button equivalent; nothing is gesture-only.
- Haptic on: set commit, rest-timer zero, PR, destructive confirm, error. Nothing else — and nothing at
  all on iPhone (§17), which is why each of those also changes something visible.
- Animates: sheet Y, FAB press scale, PR badge pop, tab-indicator x and tab glyphs, timer ring
  dashoffset, skeleton shimmer, list-item enter. The TabBar's and FAB's own geometry never moves.
  Everything else is instant.
- One-handed: the right-thumb arc is the bottom 192px (`--spacing-thumb`). The pad's commit key, the FAB
  and the GYM MODE primary buttons sit inside it; `Delete set` and `Discard workout` deliberately sit at
  the top of a sheet, outside it.
- `/dev/design` is the design contract: every primitive state and every token must be reachable there
  with no app data (§27).

## Risks

| Risk | Mitigation |
|---|---|
| `.dark` written before `:root` → equal specificity, later rule wins, the whole app renders light (r12 §C does exactly this). | `design-tokens.test.ts` asserts `indexOf(":root") < indexOf(".dark")`; §2 states the rule. |
| Hex inside a plain `@theme` block → `dark:` silently stops switching (r12 §B). | Same test fails if any line inside `@theme` contains a `#` literal. |
| `color-mix()` alpha stripped from `--shadow-*` → an opaque lime glow, no error (r12 §G4). | Same test rejects `color-mix(` in any shadow token; step 0 asserts the compiled `shadow-glow` still carries its literal `0.45`. |
| A `shadcn add` regenerates `button.tsx` / `input.tsx` and drops the size patches (r12 §G12). | The e2e `data-tap="primary"` test fails immediately; the variants sit in a `// DESIGN-SYSTEM: do not drop` block. |
| shadcn's self-referential `--font-sans` kills all typography invisibly (r12 §G5). | Unit test asserts `@theme inline` maps `--font-sans: var(--font-app-sans)`; e2e asserts `body`'s computed `font-family` is the Inter face, not a system fallback. |
| A component is built twice because two specs claim it. | The **Components this spec does not create** table names one owner and one path per thing; A2/A5/A7 close the remaining overlaps in writing. |
| The heat ramp drifts between `globals.css` and spec 12's `LIME_SCALE`. | `design-tokens.test.ts` imports `LIME_SCALE` and asserts element-for-element equality with the parsed `--heat-*` tokens. |
| Heat levels indistinguishable at 1.46–1.66:1 and colour is the only cue. | §23 makes `data-level`/`data-sets`, a tap readout and a same-view numeric table mandatory; §4 records every failing pair rather than omitting it. |
| Ghost prefill rendered with opacity → 4.12–4.24:1, below AA, and axe reports "incomplete". | `--ghost` token + italic + `·` prefix; a `design-tokens.test.ts` case pins 5.78:1 on `--surface-1`; review rejects `opacity-` on ghost text. |
| Back gesture leaves the workout instead of closing a sheet. | §10's `pushState` sentinel + `popstate` contract; e2e case (i). |
| `overscroll-behavior-y` mistaken for a scroll lock. | §10 names Vaul's body lock as the actual mechanism; e2e case (j) asserts `window.scrollY` is unchanged. |
| Wake lock absent on the real install target (iOS standalone < 18.4). | Spec 06's hook reports `"unsupported"`, the UI says so once, and no video hack ships. |
| Haptics assumed cross-platform → iPhone gets no feedback on set commit. | Every haptic is paired with a visual change; `hapticsSupported()` is unit-tested for the undefined-`vibrate` branch; the native-switch path is dropped (§17). |
| `useWorker: true` confetti throwing on a StrictMode double-mount, or blocked by the CSP. | `useWorker: false` + one module-level canvas outside React's lifecycle (§16). |
| Lime creeping into body text and destroying OLED readability. | `/dev/design` pins the permitted lime usages; review rejects `text-primary` on anything containing a sentence. |
| `backdrop-blur` on the TabBar tanking frame rate on mid-range Android. | Blur only behind `supports-[backdrop-filter:blur(0px)]:` with solid `--surface-1` as the default — see Open question 3. |
| A per-second `aria-live` on the timer flooding VoiceOver. | Edge-triggered, latched thresholds at 60/30/10/0s; the visible readout is `aria-live="off"`. |
| `env(safe-area-inset-*)` resolving to 0 because spec 05 dropped `viewportFit` from `viewport`. | e2e (f) asserts non-zero computed `padding-bottom` on the TabBar under an iPhone descriptor. |
| Fixed-height chrome clipping at 200% text zoom (WCAG 1.4.4/1.4.10), invisible to axe. | §24's rem-only rule + scroll-not-clip rule; e2e (k) at 200% zoom and 320px width. |
| The light `:root` block read as a shipped, measured theme. | §1 and §4 state it is unmeasured; a light theme requires a measurement pass before it ships. |
| `tsc --noEmit` failing on a clean clone before `next typegen` (r12 §G1). | Verification runs `next typegen` first, as CI must. |

## Verification

```bash
# 0a. dependencies this spec introduces — none of them is in the shipped package.json.
#     All three pins re-verified on the npm registry 2026-09-12 (each is the current latest).
npm i motion@13.2.0 canvas-confetti@1.9.4 next-intl@4.14.4
npm i -D @types/canvas-confetti@1.9.0
# `npx shadcn@4.21 add drawer` additionally pulls vaul@1.1.2 — the sheet engine of Behaviour §10.

# 0b. tokens compile and every custom utility is actually emitted.
npx next typegen && npx tsc --noEmit            # PASS: exit 0
npm run build                                    # PASS: exit 0

# Tailwind v4 emits a utility only if some scanned source uses it, so /dev/design is the guaranteed
# consumer of every name below — that page is what makes this check meaningful (Behaviour §27).
# Note: `grep -R` (recursive) not `**/*.css`, because bash globstar is OFF by default.
bash -c 'fail=0
for u in bg-surface-1 bg-surface-2 rounded-card rounded-sheet text-pr text-ghost border-border-strong \
         min-h-tap min-h-gym size-gym font-numeric text-readout text-readout-lg text-gym \
         bg-heat-empty bg-heat-3 bg-heat-5 blur-chrome shadow-sheet ease-spring shadow-glow; do
  grep -qR -- ".${u}" .next/static || { echo "MISSING utility: ${u}"; fail=1; }
done
if grep -hoR -- "\.shadow-glow{[^}]*}" .next/static | grep -q "0\.45"; then :; else
  echo "shadow-glow lost its literal alpha (r12 G4)"; fail=1; fi
if grep -q "color-mix(" src/app/globals.css; then
  echo "color-mix() inside a token (r12 G4)"; fail=1; fi
exit $fail'
# PASS: exit 0 and no output. Any missing name exits 1 — the old assertion-free grep could not fail.

# 1. token + contrast unit tests
npx vitest run --project=unit tests/unit/design-tokens.test.ts
# PASS cases:
#  - ":root appears before .dark"  -> css.indexOf(":root") < css.indexOf(".dark")
#  - "no hex inside @theme"; "every --color-* maps to a var()"
#  - "@import order is tailwindcss, tw-animate-css, shadcn"
#  - "--font-sans maps to --font-app-sans"; "--font-numeric maps to --font-app-mono"
#  - "no color-mix in any shadow token"; "--ring is #c6ff00"
#  - "@theme inline defines --color-border-strong, --color-ghost, --color-heat-empty and
#     --color-heat-1..5"  (without these, border-border-strong / bg-heat-* do not exist)
#  - "heat tokens equal specs/12 LIME_SCALE": parsed [--heat-empty, --heat-1..5] ===
#     [LIME_SCALE.empty, ...LIME_SCALE.levels] case-insensitively, and --heat-rest-ring ===
#     LIME_SCALE.restRing  (imported from @/lib/analytics/scale — one source, two consumers)
#  - one case per row of Behaviour §4, asserting the computed ratio to 2dp:
#     f5f5f5/000000 19.26, f5f5f5/1c1c20 15.58, a1a1aa/000000 8.19, a1a1aa/1c1c20 6.63,
#     8a8a92/0a0a0b 5.78 (>= 4.5, the ghost gate), 8a8a92/1c1c20 4.96,
#     c6ff00/000000 17.71, c6ff00/1c1c20 14.32, 0a0a0a/c6ff00 16.69, 0a0a0a/84aa00 7.29,
#     3ddc97/000000 11.88, ffb020/000000 11.48, ff5449/000000 6.62,
#     84aa00/000000 7.73, 4d6600/000000 3.22, 71717a/1c1c20 3.51 (>= 3.0),
#     27272a/000000 1.41 (< 3.0 -> companion case: no src/components/app/** file uses
#       `border-border` as the only state signal),
#     heat vs #000: 4a6100 3.00, 678600 4.99, 85ad00 7.97, a5d500 12.12, c6ff00 17.71 (all >= 3.0),
#     heat adjacent: 4a6100/678600 1.66, 678600/85ad00 1.60, 85ad00/a5d500 1.52, a5d500/c6ff00 1.46,
#       1f1f1f/4a6100 2.36, 3a3a3a/1f1f1f 1.45  -> each asserted < 3.0 AND paired with a companion
#       case: every heat surface in the repo carries data-level and data-sets|data-date (§23),
#     0a0a0a/4a6100 2.83 (< 4.5 -> companion case: no text node is rendered inside an L1 cell).

# 2. pure functions
npx vitest run --project=unit tests/unit/format-display.test.ts tests/unit/haptics.test.ts \
                             tests/unit/i18n-shape.test.ts
# format — 24 vectors (7 formatKg, 2 formatReps, 2 formatKcal, 5 formatDurationMs, 3 formatDelta,
#          3 formatOrDash, 2 formatEstimate), RU *and* EN for every locale-sensitive one, inputs
#          reused from docs/research/r09-formulas-and-test-vectors.md
#          so display and maths cannot drift (§1's 100 kg x 5; §6's plate totals 20/60/100/102.5 kg):
#   formatKg      82.5/ru "82,5" | 82.5/en "82.5" | 80/ru "80" | 80/en "80" | 0.5/ru "0,5" | 0.5/en "0.5"
#                 | 102.5/ru "102,5"
#   formatReps    5 -> "5" | 12 -> "12"                      (useGrouping: false, both locales)
#   formatKcal    2149.6/ru "2\u00A0150" | 2149.6/en "2,150"
#                 RU's group separator is U+00A0 (NBSP), verified via Intl on ICU 77.1 — the expected
#                 value MUST be written as the escape, never as a literal space, or the test rots into
#                 a false pass/fail nobody can read.
#   formatDurationMs  0 "0:00" | -1 "0:00" | 59_999 "0:59" | 90_000 "1:30" | 3_600_000 "1:00:00"
#   formatDelta   (+2.5,"kg","ru") {text "+2,5 кг", tone "up"} | (-3,"kcal","en") tone "down"
#                 | (0,"pct",*) tone "flat" and text carries no sign
#   formatOrDash  null -> "—" | NaN -> "—" | 137.4 -> formatKg(137.4)
#   formatEstimate  null -> "—" | 612 -> "≈ 612"
# haptics: navigator.vibrate undefined -> hapticsSupported() false and haptic() false (the iOS branch);
#          vibrate defined -> called exactly once with HAPTIC_PATTERNS[name]; reduceMotion true -> not
#          called; the persisted haptics preference false -> not called.
# i18n:    messages/ru.json and messages/en.json have byte-identical key shape (r11 gotcha 5); every
#          a11y.* key referenced by an icon-only control in src/** exists in both.

# 3. e2e — the dev gallery plus a real workout
npx playwright test --project=a11y tests/e2e/design-system.spec.ts tests/e2e/gym-mode.spec.ts
# (--project is mandatory: it is what picks up spec 16's webServer + storageState.json fixture.)
# PASS: (a) every [data-tap="primary"] on /dev/design has boundingBox.height >= 56 and width >= 56,
#           and every [data-tap="dense"] matches one of §8's five named exceptions by role;
#       (b) Tab reaches the first control and getComputedStyle gives outlineWidth "2px",
#           outlineStyle "solid", outlineColor "rgb(198, 255, 0)";
#       (c) exactly one <main>; nav has an aria-label; the active tab has aria-current="page"; the skip
#           link is the first focusable element;
#       (d) on /workout, document.querySelector('[data-chrome="tabbar"]') and
#           '[data-chrome="app-fab"]' are both null, while '[data-chrome="session"]' exists (§20);
#       (e) with the iPhone 15 device descriptor the TabBar's computed padding-bottom > 0px;
#       (f) the rest-timer polite live region, with the fixture totalMs = 60_000 run 61 s on
#           page.clock, receives exactly 4 updates (60/30/10/0); with totalMs = 45_000 run 46 s it
#           receives exactly 3 (30/10/0); and an onAdjust(+15000) that re-crosses 30 s adds none,
#           because thresholds are latched (§13). No assertion uses settings.default_rest_seconds
#           (120), which would yield 1 update over any 65 s run;
#       (g) open a sheet, page.goBack() -> the sheet is closed and page.url() is unchanged (§10);
#       (h) drag across the sheet backdrop -> window.scrollY unchanged from before opening (§10);
#       (i) at 320px width and 200% text zoom, document.scrollingElement.scrollWidth <= clientWidth
#           and the pad's commit key is in the viewport after scrolling its container (§24);
#       (j) under emulateMedia({ reducedMotion: "reduce" }) a simulated PR inserts no <canvas> and
#           every skeleton reports animation-duration <= 0.01ms.
#
# NOT asserted here, deliberately — specs/16-testing-ci-quality.md is the single gate and these were
# duplicated at a looser threshold: the GYM MODE >= 72px bounding-box check (16 §28, raise from 56 —
# ask A6) and the axe scan with the four-tag set ["wcag2a","wcag2aa","wcag21a","wcag21aa"] (16 §25,
# add /dev/design to the route list — ask A6). Two gates for one property is how the looser one wins.
```

## Open questions

1. **`settings.haptics` / `settings.reduce_motion` (blocking, A1).** Spec 02 owns every column and
   currently ships neither, so the persisted overrides are **UNVERIFIED** and the module runs on
   `localStorage` alone until spec 02 confirms. (a) Spec 02 adds both as `ALTER TABLE ADD COLUMN` with
   constant defaults (`haptics` 1, `reduce_motion` 0), alongside spec 06's `keep_screen_awake`.
   (b) The two preferences stay `localStorage`-only forever and never sync across devices.
   **Recommendation: (a)** — they are user settings in a single-user app whose whole premise is that D1
   is the source of truth, and the ALTER is free. Until it lands, no call site changes (## Data).
2. **Bottom nav slot count.** (a) 4 tabs + FAB (Home, Workouts, Food, Body), everything else behind
   `/more`. (b) 5 tabs + FAB, adding Analytics. **Recommendation: (a)** — five 56px targets plus a 72px
   FAB across a 375px viewport leaves ~51px per tab, breaking §8.
3. **Glass chrome at all.** (a) Ship `--blur-chrome` on the TabBar and sheet header. (b) Drop
   `backdrop-filter` and use solid `--surface-1`. **Recommendation: (b) for Phase 1** — on pure black
   the effect is nearly invisible and it is the most expensive paint on mid-range Android; keep the
   token so (a) stays a one-line change.
4. **One radius family vs a tighter radius for dense rows.** (a) Keep the single `--radius: 1.25rem`
   family — consistent, less CSS. (b) Add `--radius-row: 0.75rem` for set rows and table rows so dense
   lists read tighter. **Recommendation: (a)** for Phase 1; revisit only if the set list looks bubbly on
   device.
