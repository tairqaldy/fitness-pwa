/**
 * Every magic number in the calculation layer, once, with its unit and its provenance.
 *
 * Provenance tags are load-bearing, not decoration. Three of the values below contradict either
 * the product brief or the published literature, and a future reader who cannot tell "verified"
 * from "our convention" will eventually "fix" one of them:
 *
 *  - `RPE_INFLATION_CAP` exists only to stop the brief's own `max()` rule from manufacturing an
 *    unbeatable PR (r09 section 2).
 *  - `WARMUP_RAMP` is Wendler's 5/3/1 ramp **re-scoped to the day's top working set**. Wendler's
 *    percentages are of the Training Max (about 90% of 1RM). "Fixing" this by dividing by 0.9
 *    makes every warm-up 11% heavier (r09 section 7).
 *  - `SECONDARY_MUSCLE_CREDIT` is the opposite of what the only paper on the question recommends
 *    (Schoenfeld 2019: count on "a 1:1 basis"). It is a heatmap display convention (r09 s8).
 *
 * Source of record: docs/research/r09-formulas-and-test-vectors.md section 9.
 */

import type { SetType } from "./types";

// ---------------------------------------------------------------------------------------------
// Float comparison
// ---------------------------------------------------------------------------------------------

/**
 * Tolerance for comparing two kilogram values, in kg.
 *
 * Weights are fractional (microloading uses 1.25 kg and 0.5 kg plates), so `===` on kilograms is
 * a bug waiting for the right target: summing a plate list in floats accumulates error the same
 * way `0.1 + 0.2 !== 0.3` does, and the symptom is the last microplate disappearing for some
 * targets only. 1e-9 kg is a microgram: far below any real plate, far above double noise on
 * gym-sized numbers. Plate math avoids the problem entirely by working in integer grams; this
 * constant is for the boundaries where kilograms are unavoidable.
 */
export const WEIGHT_EPSILON_KG = 1e-9;

/** Plate arithmetic runs in integer grams and converts only at the boundary (r09 section 6). */
export const GRAMS_PER_KG = 1000;

// ---------------------------------------------------------------------------------------------
// e1RM (r09 sections 1 and 2)
// ---------------------------------------------------------------------------------------------

/** Epley: `w * (1 + reps / EPLEY_DIVISOR)`. verified (Epley 1985, via Wikipedia). */
export const EPLEY_DIVISOR = 30;

/** Brzycki: `w * BRZYCKI_NUMERATOR / (BRZYCKI_OFFSET - reps)`. verified (Brzycki 1993). */
export const BRZYCKI_NUMERATOR = 36;

/**
 * The denominator is `37 - reps`, **not** `36 - reps`. The off-by-one is the most common
 * hand-written error in this module: at 5 reps it yields 116.129, which is Brzycki's *correct*
 * value at 6 reps, so the whole curve shifts by one rep while every number stays plausible.
 */
export const BRZYCKI_OFFSET = 37;

/** derived: 37 is a pole (`Infinity`), 38 and above is negative (-3600 at 38 reps). */
export const BRZYCKI_MAX_REPS = 36;

/**
 * Above this, `e1rm` returns `null` and the UI shows an em dash. our convention (r09 section 1's
 * own open decision (a), applied one layer deeper by spec 07 rule 10): Brzycki at 36 reps is
 * 3600 kg, and one such row poisons `max(e1rm_kg)` for that lift permanently.
 */
export const MAX_REPS_FOR_E1RM = 12;

/**
 * The RPE branch may raise e1RM at most 10% above the failure-assuming formulas. our convention
 * (r09 section 2, open decision (a)). Uncapped, `100 kg x 12 @ RPE 8` returns 159.49 -- 13.9%
 * above Epley -- and sets a permanent, unbeatable PR. 10% is the divergence Wikipedia already
 * ascribes to these estimates.
 */
export const RPE_INFLATION_CAP = 1.1;

/** The RPE scale runs 6..10; 10 is failure and there is nothing above it. verified (Zourdos 2016). */
export const RPE_MIN = 6;
export const RPE_MAX = 10;

// ---------------------------------------------------------------------------------------------
// US Navy body fat -- METRIC form only (r09 section 3)
// ---------------------------------------------------------------------------------------------

/**
 * Male metric density coefficients. verified (calculator.net, confirmed by omnicalculator.com):
 * `density = intercept - waistNeck * log10(waist - neck) + height * log10(height)`.
 *
 * The widely-copied inch constants appear nowhere in this repo. Fed centimetres they read 6.52
 * percentage points high (22.96 vs the correct 16.44 on r09's M1 vector).
 */
export const NAVY_MALE = { intercept: 1.0324, waistNeck: 0.19077, height: 0.15456 } as const;

/** Female metric density coefficients. verified. The female form needs **three** circumferences. */
export const NAVY_FEMALE = { intercept: 1.29579, waistHipNeck: 0.35004, height: 0.221 } as const;

/** Siri: `bodyFatPct = 495 / density - 450`. verified. */
export const SIRI_NUMERATOR = 495;
export const SIRI_OFFSET = 450;

/** Physiological gate, in percentage points. Outside it, return `null` rather than a number. */
export const BODY_FAT_MIN_PCT = 2;
export const BODY_FAT_MAX_PCT = 60;

// ---------------------------------------------------------------------------------------------
// Trend weight (r09 section 4)
// ---------------------------------------------------------------------------------------------

/**
 * verified (John Walker, The Hacker's Diet): "Shift the decimal place in the resulting number one
 * place to the left" -- shifting one place left *is* multiplying by 0.1.
 */
export const TREND_ALPHA = 0.1;

/** computed: `ln(0.5) / ln(1 - alpha)`. A reading's weight halves every 6.58 days. */
export const TREND_HALF_LIFE_DAYS = 6.578813;

/**
 * computed: `(1 - alpha) / alpha`. This -- not the half-life -- is the famous "9 days". It is the
 * mean age of the data. No UI string may call it a half-life.
 */
export const TREND_MEAN_LAG_DAYS = 9;

/**
 * A reading further than this from the current trend does not move the trend. our convention,
 * `UNVERIFIED` as a published threshold; roughly 4x a typical daily water swing. The reading is
 * still emitted and still rendered -- flagged, never dropped and never clamped.
 */
export const OUTLIER_ABS_KG = 3;

// ---------------------------------------------------------------------------------------------
// Energy and adaptive TDEE (r09 section 5)
// ---------------------------------------------------------------------------------------------

/**
 * Wishnofsky's rule, 3500 kcal/lb. verified, and MacroFactor publishes the same constant for
 * exactly this use. It is known to **overestimate** the energy density of early weight change
 * (measured around 4858 kcal/kg at week 4, because glycogen and water dominate), which is what
 * `TDEE_WARMUP_DAYS` and the `completeDays / 28` blend ramp exist to absorb.
 */
export const ENERGY_DENSITY_KCAL_PER_KG = 7700;

/** our convention: 30 rounded to whole weeks, so the window boundary lands on one weekday. */
export const TDEE_WINDOW_DAYS = 28;

/** Below this many complete intake days, show the prior only. */
export const TDEE_MIN_INTAKE_DAYS = 14;

/** Below this many weigh-ins in the window, show the prior only. */
export const TDEE_MIN_WEIGH_INS = 10;

/** verified basis (MacroFactor: "peak performance ... after 3-4 weeks"). Below this: CALIBRATING. */
export const TDEE_WARMUP_DAYS = 21;

/**
 * Week-over-week cap, kcal/day. our convention. Flat, not a percentage: the cap absorbs *logging*
 * noise, and logging noise is absolute -- a missed meal is about 600 kcal regardless of body size
 * (r09 section 5, open decision (a)).
 */
export const TDEE_MAX_WOW_DELTA = 250;

/**
 * A trend-weight change faster than this fraction of bodyweight PER WEEK is badged suspect,
 * but still returned. 1%/week is the conventional ceiling for a sustainable rate of change.
 * Applied as a rate, never as an absolute window delta — see adaptiveTdee.
 */
export const TDEE_SUSPECT_DELTA_FRACTION = 0.01;

/** Mifflin-St Jeor, sex-split clinical form. verified (Mifflin 1990). */
export const MSJ_KG = 10;
export const MSJ_CM = 6.25;
export const MSJ_AGE = 5;
export const MSJ_MALE_OFFSET = 5;
export const MSJ_FEMALE_OFFSET = -161;

/**
 * Mifflin-St Jeor, **original 1990 combined regression**. verified. It exists in the codebase
 * only so a test pins the 1.58 kcal/day difference from the split form and nobody "simplifies"
 * one into the other.
 */
export const MSJ_COMBINED_KG = 9.99;
export const MSJ_COMBINED_CM = 6.25;
export const MSJ_COMBINED_AGE = 4.92;
export const MSJ_COMBINED_SEX = 166;
export const MSJ_COMBINED_OFFSET = -161;

/** Katch-McArdle: `370 + 21.6 * LBM`. verified. **Not** Cunningham (`500 + 22 * LBM`). */
export const KATCH_INTERCEPT = 370;
export const KATCH_LBM = 21.6;

/** Accepted activity-factor range. The 1.2..1.9 ladder is `UNVERIFIED` and lives in settings. */
export const ACTIVITY_FACTOR_MIN = 1;
export const ACTIVITY_FACTOR_MAX = 2.5;

/** Plausible age range. The MSJ regression was validated on ages 19-78. */
export const AGE_MIN_YEARS = 1;
export const AGE_MAX_YEARS = 120;

// ---------------------------------------------------------------------------------------------
// Plate math and warm-ups (r09 sections 6 and 7)
// ---------------------------------------------------------------------------------------------

/**
 * Upper bound on the enumerated plate lattice. A real gym inventory produces a few hundred
 * combinations; this exists only so a nonsense inventory (a million pairs) returns `null`
 * instead of hanging the render.
 */
export const MAX_PLATE_COMBINATIONS = 100_000;

/**
 * 40% x 5, 50% x 5, 60% x 3. verified as Wendler's 5/3/1 ramp; **re-scoping it to the day's top
 * working set is our convention**, and it is a deliberately *lighter* ramp than Wendler's,
 * because Wendler's percentages are of the Training Max (about 90% of 1RM). Do not "correct"
 * this by dividing by 0.9.
 */
export const WARMUP_RAMP = [
  { pct: 0.4, reps: 5 },
  { pct: 0.5, reps: 5 },
  { pct: 0.6, reps: 3 },
] as const;

/** Drop a step landing within this of the empty bar -- three "20.0 kg" rows read as broken. */
export const WARMUP_MIN_ABOVE_BAR_KG = 5;

/** Sanity bound on a caller-supplied ramp. */
export const WARMUP_MAX_STEPS = 4;

// ---------------------------------------------------------------------------------------------
// Volume, hard sets, muscle credit (r09 section 8)
// ---------------------------------------------------------------------------------------------

/** Warm-ups carry no tonnage and no hard sets. Drop sets carry both. our convention. */
export const COUNTED_SET_TYPES: readonly SetType[] = ["working", "drop", "failure"];

/**
 * A counted set at RIR <= 4 (RPE >= 6) is a hard set. our convention -- "hard set" has no formal
 * definition in the literature r09 could reach. A counted set logged *without* RPE/RIR also
 * counts (spec 07 rule 39): the user did the work, and excluding it makes the heatmap and the
 * volume chart disagree about one session.
 */
export const HARD_SET_MAX_RIR = 4;

/** Full credit for a primary muscle. */
export const PRIMARY_MUSCLE_CREDIT = 1;

/**
 * Half credit for a secondary muscle. **A display convention, explicitly not a fact, and the
 * opposite of Schoenfeld 2019's "1:1 basis" recommendation** (r09 section 8). Defensible for a
 * heatmap, whose job is relative visual emphasis; spec 12's legend must read "secondary muscles
 * counted at 50%". If the under-trained-muscle flag ever drives real programming, revisit --
 * there, 1:1 is the defensible number.
 */
export const SECONDARY_MUSCLE_CREDIT = 0.5;

// ---------------------------------------------------------------------------------------------
// Calendar (r09 section 8)
// ---------------------------------------------------------------------------------------------

/**
 * verified: Kazakhstan moved to a single UTC+5 zone effective 2024-03-01. Before that,
 * `Asia/Almaty` was UTC+6 -- which is why the offset is resolved through the IANA database
 * rather than hardcoded. Imported pre-2024 history (spec 15) would otherwise shift by an hour,
 * and an hour is enough to move a late-evening session onto the next calendar day.
 */
export const APP_TZ = "Asia/Almaty";

/** Both bounds inclusive: 7 local calendar days including today. */
export const ROLLING_WINDOW_DAYS = 7;

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

/** The ECMAScript time-value limit. Beyond it, every `Date` operation yields `NaN`. */
export const MAX_TIME_MS = 8.64e15;
