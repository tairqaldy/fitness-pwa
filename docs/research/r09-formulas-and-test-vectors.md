# R09 — Formulas and test vectors (the unit-test oracle)

> **Status:** verification research, 2026-09-12.
> **Authority:** [`docs/research/stack-facts.md`](./stack-facts.md) overrides
> [`specs/00-brief.md`](../../specs/00-brief.md) on all stack facts. `stack-facts.md` contains
> **no** claims about any of the formulas below, so there is nothing in this note that
> contradicts it. Where this note contradicts the *brief*, it is called out explicitly and
> loudly — there are **three such places** (§1, §2, §8).
> **Purpose:** this file is the oracle for `*.test.ts` on every pure calculation. Numbers here
> are the expected values. All arithmetic was recomputed with a script; intermediate terms are
> printed so a failing test can be diagnosed without re-deriving anything.
> **Unverified claims carry the literal token `UNVERIFIED`.**

**Units convention for the whole app:** kg, cm, kcal. Timezone `Asia/Almaty`. Never store a
mixed-unit value; convert at the UI edge only.

**Global numeric convention (binds every section):** all formulas operate on IEEE-754 doubles
and are **never** rounded internally. Rounding happens only at display. Where a rounding rule is
part of the *definition* of a value (the RPE chart, plate math, warm-up weights) it is stated
explicitly and the rounding mode is named. Tests compare with `toBeCloseTo(expected, 4)` unless
a section says otherwise.

---

## Table of contents

1. [e1RM — Epley and Brzycki](#1-e1rm--epley-and-brzycki)
2. [RPE / RIR → %1RM, and the app's e1RM composite rule](#2-rpe--rir--1rm-and-the-apps-e1rm-composite-rule)
3. [US Navy body fat](#3-us-navy-body-fat)
4. [EMA / trend weight](#4-ema--trend-weight)
5. [Adaptive TDEE](#5-adaptive-tdee)
6. [Plate math](#6-plate-math)
7. [Warm-up set calculator](#7-warm-up-set-calculator)
8. [Volume metrics](#8-volume-metrics)
9. [Consolidated constants table](#9-consolidated-constants-table)
10. [Sources](#10-sources)

---

## 1. e1RM — Epley and Brzycki

### Question

What are the exact Epley and Brzycki formulas, over what rep range is each valid, where do they
diverge, and what must the code guard?

### Verified answer

Quoted verbatim from Wikipedia, *One-repetition maximum* (the article renders the maths as
MathML; the plain-text extraction is reproduced exactly as returned):

> **Epley:** `"w ⋅ ( 1 + r / 30 )"` — with the note that this assumes `"r > 1."`

> **Brzycki:** `"w ⋅ 36 37 − r"` which can also be expressed as `"w 37 36 − 1 36 r"` or
> approximately `"w 1.0278 − 0.0278 r"`

> `"Epley and Brzycki return identical results for 10 repetitions."`

> `"for fewer than 10 reps, Epley returns a slightly higher estimated maximum."`

> `"The formulas greatly diverge after about 10 reps."`

> `"the estimate may vary by 10% or more from the actual 1RM"`

Unambiguously:

```
Epley(w, r)   = w * (1 + r / 30)
Brzycki(w, r) = w * 36 / (37 - r)
```

Primary references, as listed in that article's reference section:

- Epley, Boyd (1985). *"Poundage Chart"*, **Boyd Epley Workout**. Lincoln, NE: Body Enterprises. p. 86.
- Brzycki, Matt (1998). *A Practical Approach To Strength Training*. McGraw-Hill. ISBN 978-1-57028-018-4.
  The formula's first journal appearance is Brzycki, M. (1993). "Strength Testing—Predicting a
  One-Rep Max from Reps-to-Fatigue." *Journal of Physical Education, Recreation & Dance*
  **64**(1): 88–90. doi:10.1080/07303084.1993.10606684.

#### Valid rep ranges

| Formula | Domain the code must accept | Justification | Status |
|---|---|---|---|
| Epley | `r >= 2` mathematically; `r` in `[1, 12]` for trustworthy output | Wikipedia states Epley `"assumes r > 1"`. At `r = 1` it returns `1.0333·w`, which is *wrong by definition*. | verified |
| Brzycki | `r` in `[1, 10]`; **hard domain limit `r <= 36`** | `r = 1` returns exactly `w`. Wikipedia: formulas `"greatly diverge after about 10 reps"`. The commonly repeated claim that Brzycki himself capped the formula at 10 reps could **not** be verified — the 1993 JOPERD PDF at paulogentil.com is a **scanned image**, so its text is unreadable. Treat the "Brzycki is valid to 10 reps" limit as `UNVERIFIED` in its attribution, though the divergence statement above is verified. | partially verified |

#### Divergence

Implied `%1RM = w / e1RM`. Lower implied % ⇒ higher e1RM.

| r | Epley implied %1RM = `30/(30+r)` | Brzycki implied %1RM = `(37−r)/36` | Higher e1RM |
|---|---|---|---|
| 1 | 96.7742 | 100.0000 | Epley |
| 2 | 93.7500 | 97.2222 | Epley |
| 3 | 90.9091 | 94.4444 | Epley |
| 4 | 88.2353 | 91.6667 | Epley |
| 5 | 85.7143 | 88.8889 | Epley |
| 6 | 83.3333 | 86.1111 | Epley |
| 7 | 81.0811 | 83.3333 | Epley |
| 8 | 78.9474 | 80.5556 | Epley |
| 9 | 76.9231 | 77.7778 | Epley |
| **10** | **75.0000** | **75.0000** | **identical (crossover)** |
| 11 | 73.1707 | 72.2222 | Brzycki |
| 12 | 71.4286 | 69.4444 | Brzycki |

So: **Epley > Brzycki for r < 10; equal at r = 10; Brzycki > Epley for r > 10.** The crossover is
exact and is a good property-based test: `∀w>0: Epley(w,10) === Brzycki(w,10)`.

Algebraic proof of the crossover, for the test docstring: `1 + 10/30 = 4/3` and
`36/(37−10) = 36/27 = 4/3`. ∎

### ⚠️ The brief and the task premise are WRONG about r = 1

The task brief states that at `r = 1` both formulas "must return `w` exactly". **That is false for
Epley.** Verified arithmetic:

```
Epley(100, 1)   = 100 * (1 + 1/30) = 100 * 31/30 = 103.3333333333…   ← NOT 100
Brzycki(100, 1) = 100 * 36/(37-1)  = 100 * 36/36 = 100.0000000000    ← exactly 100 ✓
```

A single rep performed *to failure* **is** a 1RM; no estimation is meaningful. Therefore the app
must **short-circuit `r === 1` to `e1RM = w`** before either formula runs. Do not "fix" Epley — it
is correct as published and Wikipedia explicitly scopes it to `r > 1`.

### Six test vectors

All with `w = 100 kg` so the value doubles as an implied-percentage check. Arithmetic shown.

| # | w | r | Epley — arithmetic | Epley | Brzycki — arithmetic | Brzycki | App e1RM (see §2 rule) |
|---|---|---|---|---|---|---|---|
| **V1** | 100 | **1** | `100·(1+1/30)=100·1.0333…` | **103.3333** | `100·36/36=100·1` | **100.0000** | **100.0000** (guard: `r===1 ⇒ w`) |
| **V2** | 100 | 5 | `100·(1+5/30)=100·(7/6)` | **116.6667** | `37−5=32`; `100·36/32=100·1.125` | **112.5000** | 123.3046 (RPE, §2) |
| **V3** | 100 | **10** | `100·(1+10/30)=100·(4/3)` | **133.3333** | `100·36/27=100·(4/3)` | **133.3333** | 133.3333 |
| **V4** | 100 | 12 | `100·(1+12/30)=100·1.4` | **140.0000** | `100·36/25=100·1.44` | **144.0000** | 144.0000 |
| **V5** | 100 | 6 | `100·(1+6/30)=100·1.2` | **120.0000** | `100·36/31=100·1.16129…` | **116.1290** | 120.0000 |
| **V6** | 100 | **37** | `100·(1+37/30)=100·2.2333…` | **223.3333** | `100·36/(37−37)=100·36/0` | **DIVISION BY ZERO** | **must throw / return null** |

> **Watch the denominator.** The single most common hand-written-test error in this module is
> computing Brzycki's denominator as `36 − r` instead of `37 − r`. At `r = 5` that gives
> `100·36/31 = 116.1290` — which is Brzycki's *correct* value at `r = 6`, so the mistake produces a
> plausible number that silently shifts the whole curve by one rep. Correct: `37 − 5 = 32`,
> `100 · 36 / 32 = 112.5`. **Brzycki(100, 5) = 112.5000 exactly.**

Full recomputed set, 6 dp:

```
 w=100 r=1  : Epley=103.333333  Brzycki=100.000000
 w=100 r=5  : Epley=116.666667  Brzycki=112.500000
 w=100 r=6  : Epley=120.000000  Brzycki=116.129032
 w=100 r=10 : Epley=133.333333  Brzycki=133.333333
 w=100 r=12 : Epley=140.000000  Brzycki=144.000000
 w=100 r=36 : Epley=220.000000  Brzycki=3600.000000     ← absurd but finite
 w=100 r=37 : Epley=223.333333  Brzycki=DIV/0           ← Infinity in JS
 w=100 r=38 : Epley=226.666667  Brzycki=-3600.000000    ← NEGATIVE
 w=82.5 r=8 : Epley=104.500000  Brzycki=102.413793
```

### Recommendation

```ts
// docs-only reference implementation. NOT to be committed as app code by this session.
export const MAX_REPS_FOR_E1RM = 12;          // beyond this, e1RM is display-suppressed
export const BRZYCKI_MAX_REPS  = 36;          // 37 is a pole, 38+ is negative

export function epley(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

export function brzycki(weightKg: number, reps: number): number | null {
  if (reps >= 37) return null;                // 37 => /0 (Infinity), >37 => negative
  return (weightKg * 36) / (37 - reps);
}

export function e1rmBase(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1) return null;
  if (reps === 1) return weightKg;            // a 1-rep max IS the 1RM. Guard FIRST.
  const b = brzycki(weightKg, reps);
  return b === null ? epley(weightKg, reps) : Math.max(epley(weightKg, reps), b);
}
```

Store `e1rm_kg` on the set row at write time (a stored computed column, not a view), because PR
detection and the e1RM progression chart both read it and D1 has no cheap window functions over
a recomputed expression.

### Gotchas that will silently break us

- **`r = 37` is `Infinity`, not a crash.** In JS `100*36/0 === Infinity`. `Infinity` inserts into
  D1 as the string `"Infinity"` or as `NULL` depending on the driver, and `Math.max(…, Infinity)`
  is `Infinity`. Every e1RM chart y-axis and every PR comparison then breaks *silently and
  permanently*, because a bad row poisons `max(e1rm)`. **Guard `reps >= 37` before dividing.**
- **`r = 38` is negative** (`−3600`), which passes an `> 0` sanity check on *magnitude* but not on
  sign, and will sort to the bottom of a PR query rather than being rejected.
- **Bodyweight and assisted exercises.** `weight = 0` (bodyweight pull-up) makes every e1RM `0`.
  Assisted machines store *assistance*, so the effective load is `bodyweight − assist` and a naive
  `weight` column gives nonsense. Decide per-exercise whether e1RM is meaningful at all; suppress
  it where it is not, rather than storing 0.
- **Epley at `r = 1` returning `103.333`** will manufacture a fake PR the first time the user logs
  a true single. This is the highest-probability real bug in the whole module.
- Rounding `e1RM` to 1 dp *before* comparing against the stored PR makes PR detection flap when
  two sessions differ in the 2nd decimal. Compare full doubles; round only for display.
- Both formulas are load-linear (`e1RM ∝ w`), so a unit slip (lb logged as kg) scales e1RM by
  2.2046 and silently sets an unbeatable PR.

### Open decision for the owner

**Should e1RM be shown at all above 12 reps?** Options:
**(a)** suppress the e1RM readout for `reps > 12` and show "—"; **(b)** show it with a
"low confidence" badge. **Recommendation: (a).** Wikipedia states the formulas
`"greatly diverge after about 10 reps"` and the divergence at r = 12 is already 2.9%
(140.0 vs 144.0). A number the user cannot trust is worse than no number in an app whose stated
principle is "honest data".

---

## 2. RPE / RIR → %1RM, and the app's e1RM composite rule

### Question

What is the standard RTS RPE chart as a `reps × RPE → %1RM` table, what is its source, how do we
interpolate off-grid, and does `e1RM = max(Epley, Brzycki, RPE)` hold up?

### Verified answer

#### The RPE↔RIR mapping (peer-reviewed, verified)

`RIR = 10 − RPE`. Primary source:

> Zourdos MC, et al. "Novel Resistance Training-Specific Rating of Perceived Exertion Scale
> Measuring Repetitions in Reserve." *J Strength Cond Res* **30**(1): 267–275, 2016.
> `"Subjects reported an RPE value that corresponded to an RIR value (RPE-10 = 0-RIR, RPE-9 = 1-RIR, and so forth)."`

Applied form, open access:

> Helms ER, Cronin J, Storey A, Zourdos MC. "Application of the Repetitions in Reserve–Based
> Rating of Perceived Exertion Scale for Resistance Training." *Strength Cond J*
> **38**(4): 42–49, 2016. doi:10.1519/SSC.0000000000000218

`UNVERIFIED` — the exact descriptor wording of Helms et al. **Table 1** could not be read: the
table ships as an image (`scj-38-42-g001.jpg`) and two extraction attempts returned
mutually contradictory transcriptions (one claimed "10 RPE = 0 RIR", the other "10 RPE = 1 RIR";
one claimed "7.5 = 3 RIR" where the diagonal arithmetic requires 2.5 RIR). **Do not quote Table 1
wording in UI copy.** The relation `RIR = 10 − RPE` is independently verified from the Zourdos
abstract and is the only thing the code needs.

Also verified from that paper, and it matters for how we present the number:

> `"there are significant differences in how many repetitions can be performed at the same percentage of 1RM by different individuals"`

> conversion tables `"should be primarily used to conceptualize the relationship"` but
> `"should not be viewed as an absolute conversion tool because of individual differences and day-to-day variations in strength."`

#### The chart

The primary source (Tuchscherer, *The Reactive Training Manual*) is paywalled, and the charts on
RTS's own blog are **images**, so the numbers below are reconstructed from two independent
reproductions and then **proved self-consistent**. That proof is what makes them trustworthy.

**Sources disagree, and one of them must not be used:**

| Source | RPE-10 row (reps 1–5) | Verdict |
|---|---|---|
| fitnessvolt.com, *The Tuchscherer RPE Chart Explained* | 100, 95.5, 92.2, 89.2, 86.3 | **Use this.** Non-linear, matches the widely-circulated RTS chart. |
| 1rmcalculators.com | 100, —, 92.2, —, 86.3 | Agrees on every cell it prints **except** reps 10 / RPE 9, where it prints 71.5 vs the self-consistent 70.7. Treat 71.5 as that page's error. |
| fitnesscalcs.com | 100, 97.5, 95, 92.5, 90 | **Do NOT use.** A linearised 2.5%-per-step grid. It is a simplification, not the RTS chart, despite citing "Reactive Training Systems (Tuchscherer) and Zourdos et al. (2016)". Its chart would inflate e1RM by up to 4 percentage points of %1RM. |

**The generating rule (this is the real finding).** Define `nRM(k)` = the %1RM of a `k`-rep max
(i.e. the RPE-10 column). Then every cell is

```
pct1RM(reps, rpe) = nRM( reps + (10 − rpe) )          // reps + RIR = "effective reps to failure"
nRM(k + 0.5)      = roundHalfUp1dp( (nRM(k) + nRM(k+1)) / 2 )
```

Applying this rule to the attested `nRM` column **reproduces the entire published
10 reps × 8 RPE fitnessvolt table with zero mismatches** (verified by script). That is a strong
internal-consistency check and means we only need to store **one 14-element array**, not an
80-cell matrix.

The attested `nRM` column:

| k | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| nRM(k) % | 100.0 | 95.5 | 92.2 | 89.2 | 86.3 | 83.7 | 81.1 | 78.6 | 76.2 | 73.9 | 70.7 | 68.0 | 65.3 | 62.7 |

`k = 1…12` appear directly as printed cells. `k = 13` is a printed cell (reps 10 / RPE 7 = 65.3).
`k = 14` is back-solved from the printed cell reps 10 / RPE 6.5 = 64.0:
`nRM(14) = 2·64.0 − 65.3 = 62.7`. Cross-check: reps 9 / RPE 6.5 = 66.7 = `roundHalfUp((68.0+65.3)/2)`
= `roundHalfUp(66.65)` = 66.7 ✓.

**The table (%1RM). Cells marked `*` are `UNVERIFIED` — they depend on extrapolated
`nRM(15) = 60.2` / `nRM(16) = 57.8`, which no source attests.**

| reps | RPE 10 | RPE 9.5 | RPE 9 | RPE 8.5 | RPE 8 | RPE 7.5 | RPE 7 | RPE 6.5 | RPE 6 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 100.0 | 97.8 | 95.5 | 93.9 | 92.2 | 90.7 | 89.2 | 87.8 | 86.3 |
| 2 | 95.5 | 93.9 | 92.2 | 90.7 | 89.2 | 87.8 | 86.3 | 85.0 | 83.7 |
| 3 | 92.2 | 90.7 | 89.2 | 87.8 | 86.3 | 85.0 | 83.7 | 82.4 | 81.1 |
| 4 | 89.2 | 87.8 | 86.3 | 85.0 | 83.7 | 82.4 | 81.1 | 79.9 | 78.6 |
| 5 | 86.3 | 85.0 | 83.7 | 82.4 | 81.1 | 79.9 | 78.6 | 77.4 | 76.2 |
| 6 | 83.7 | 82.4 | 81.1 | 79.9 | 78.6 | 77.4 | 76.2 | 75.1 | 73.9 |
| 7 | 81.1 | 79.9 | 78.6 | 77.4 | 76.2 | 75.1 | 73.9 | 72.3 | 70.7 |
| 8 | 78.6 | 77.4 | 76.2 | 75.1 | 73.9 | 72.3 | 70.7 | 69.4 | 68.0 |
| 9 | 76.2 | 75.1 | 73.9 | 72.3 | 70.7 | 69.4 | 68.0 | 66.7 | 65.3 |
| 10 | 73.9 | 72.3 | 70.7 | 69.4 | 68.0 | 66.7 | 65.3 | 64.0 | 62.7 |
| 11 | 70.7 | 69.4 | 68.0 | 66.7 | 65.3 | 64.0 | 62.7 | 61.5* | 60.2* |
| 12 | 68.0 | 66.7 | 65.3 | 64.0 | 62.7 | 61.5* | 60.2* | 59.0* | 57.8* |

**Rounding mode is load-bearing.** Three cells (`93.9`, `79.9`, `69.4`) come from means ending in
`.x5`: `(95.5+92.2)/2 = 93.85`, `(81.1+78.6)/2 = 79.85`, `(70.7+68.0)/2 = 69.35`. The published
chart rounds these **half-up**. Python's `round()` (half-to-even) yields 93.8 / 79.8 / 69.3 and
**fails to reproduce the chart**; JS `Math.round()` on positives is half-up and reproduces it.
If the table is ever generated by a Python fixture script, use `Decimal(...).quantize(ROUND_HALF_UP)`.

#### Interpolation rules

1. **RPE between grid entries** (grid is 0.5 steps from 6 to 10): linear in RPE between the two
   bracketing columns. Equivalent and preferred: interpolate on *effective reps*
   `eff = reps + (10 − rpe)` directly, which is linear in `eff` and gives the same answer on the
   grid. Clamp `rpe` to `[6, 10]`; `rpe > 10` is not a thing (10 is failure).
2. **RPE below 6**: do not extrapolate. Return `null`. A set at RIR ≥ 5 carries no usable 1RM
   information and `UNVERIFIED` extrapolation there would silently dominate the `max()` (see the
   open decision).
3. **Reps beyond the table** (`eff > 14`): return `null`. Do **not** linearly extrapolate — the
   `nRM` first differences are *not* monotone in the published chart (`−4.5, −3.3, −3.0, −2.9,
   −2.6, −2.6, −2.5, −2.4, −2.3,` then **`−3.2`**, `−2.7, −2.7, −2.6`), so any extrapolation model
   fitted to the low-rep end is wrong at the high-rep end. The `−3.2` step from `nRM(10)=73.9` to
   `nRM(11)=70.7` is a genuine kink in the published chart, not a transcription error — it is
   forced by two independently printed cells (reps 8/RPE 7 = 70.7 and reps 9/RPE 7 = 68.0).
4. **Half-rep `eff`**: arithmetic mean of the two neighbouring `nRM`, rounded half-up to 1 dp
   (this is the definition, not an approximation).

```
e1RM_rpe(w, reps, rpe) = w / (pct1RM(reps, rpe) / 100)
```

### The app rule, and where the RPE estimate wins

The brief specifies:

> `e1RM = max(Epley, Brzycki, RPE-table estimate)`

Test vectors for that composite (all `w = 100 kg`):

| # | w | reps | RPE | eff reps | %1RM | e1RM_rpe — arithmetic | Epley | Brzycki | **max** | winner |
|---|---|---|---|---|---|---|---|---|---|---|
| **R1** | 100 | 5 | 10 | 5 | 86.3 | `100/0.863 = 115.8749` | 116.6667 | 112.5000 | **116.6667** | Epley |
| **R2** | 100 | 5 | **8** | 7 | 81.1 | `100/0.811 = 123.3046` | 116.6667 | 112.5000 | **123.3046** | **RPE** ✅ |
| **R3** | 100 | 8 | 10 | 8 | 78.6 | `100/0.786 = 127.2265` | 126.6667 | 124.1379 | **127.2265** | **RPE** (even at failure) |
| **R4** | 100 | 10 | 9 | 11 | 70.7 | `100/0.707 = 141.4427` | 133.3333 | 133.3333 | **141.4427** | **RPE** |
| **R5** | 100 | 5 | **8.25** | 6.75 | 81.75 | see below | 116.6667 | 112.5000 | **122.3242** | **RPE**, interpolated |
| **R6** | 100 | 12 | 8 | 14 | 62.7 | `100/0.627 = 159.4896` | 140.0000 | 144.0000 | **159.4896** | **RPE — and this is the problem** |

**R2 is the requested "RPE wins" vector.** Arithmetic in full:
`eff = 5 + (10 − 8) = 7` → `nRM(7) = 81.1%` → `e1RM = 100 / 0.811 = 123.30456…` → **123.3046**.
It beats Epley by `123.3046 − 116.6667 = 6.6379 kg` (5.69%). This is *correct behaviour*: Epley and
Brzycki assume the set went to failure, so applied to a 2-RIR set they under-estimate. The RPE
path is the only one that uses the RIR information.

**R5 interpolation, in full:** grid neighbours are RPE 8 (`eff = 7`, `nRM = 81.1`) and RPE 8.5
(`eff = 6.5`, `nRM = roundHalfUp((83.7+81.1)/2) = roundHalfUp(82.4) = 82.4`).
`t = (8.25 − 8)/(8.5 − 8) = 0.5`. `pct = 81.1 + 0.5·(82.4 − 81.1) = 81.1 + 0.65 = 81.75`.
`e1RM = 100 / 0.8175 = 122.32415…` → **122.3242**.

**Crossover finding:** at **RPE 10 (true failure)**, the RPE-table estimate is the largest of the
three for **`reps ≥ 8`** and loses for `reps ≤ 7`. Verified boundary: at `reps = 7`, Epley's implied
%1RM is `30/37 = 81.0811` vs the chart's `81.1` — Epley wins by 0.019 percentage points, i.e. by
0.024 kg on a 100 kg set. **A test asserting the winner at reps = 7 is testing floating-point
noise. Do not write it.** Assert the winner at reps = 6 (Epley, margin 0.37pp) and reps = 8
(RPE, margin 0.35pp) instead.

### Recommendation

```ts
const NRM = [ /* index = k */ , 100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1,
              78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.7 ] as const;  // k = 1..14
const NRM_MAX_K = 14;

const roundHalfUp1 = (x: number) => Math.round(x * 10 + Number.EPSILON * 10) / 10;

function nRM(k: number): number | null {
  if (k < 1 || k > NRM_MAX_K) return null;          // NO extrapolation
  const lo = Math.floor(k);
  if (k === lo) return NRM[lo]!;
  if (lo + 1 > NRM_MAX_K) return null;
  return roundHalfUp1((NRM[lo]! + NRM[lo + 1]!) / 2);
}

export function pct1RM(reps: number, rpe: number): number | null {
  if (rpe < 6 || rpe > 10) return null;             // clamp: no sub-6 extrapolation
  const eff = reps + (10 - rpe);
  const lo = Math.floor(eff * 2) / 2, hi = Math.ceil(eff * 2) / 2;  // 0.5 grid
  const a = nRM(lo), b = nRM(hi);
  if (a === null || b === null) return null;
  return lo === hi ? a : a + ((eff - lo) / (hi - lo)) * (b - a);
}

export function e1rmComposite(w: number, reps: number, rpe?: number): number | null {
  if (reps === 1 && (rpe === undefined || rpe >= 10)) return w;     // §1 guard
  const base = e1rmBase(w, reps);                                    // max(Epley, Brzycki)
  if (rpe === undefined) return base;
  const p = pct1RM(reps, rpe);
  const fromRpe = p === null ? null : w / (p / 100);
  if (fromRpe === null) return base;
  const raw = Math.max(base ?? 0, fromRpe);
  return Math.min(raw, (base ?? fromRpe) * RPE_INFLATION_CAP);       // see open decision
}
```

Store both `e1rm_kg` (the composite, used for charts/PRs) and `e1rm_source`
(`'epley' | 'brzycki' | 'rpe' | 'actual_single'`) on the set row. Without `e1rm_source`, a
"PR" the user disputes is undiagnosable.

### Gotchas that will silently break us

- **`max()` makes RPE almost always win whenever RIR > 0, and it has no ceiling.** R6:
  a 100 kg × 12 @ RPE 8 yields **e1RM 159.49** — 10.8% above Brzycki and 13.9% above Epley. One
  optimistic RPE entry on a high-rep back-off set will set a permanent, unbeatable PR and flatten
  the e1RM progression chart for that lift forever. **This is the single most dangerous formula
  interaction in the app.**
- **RPE self-report error is amplified at high reps.** One half-point of RPE at 12 reps moves
  `%1RM` by ~1.3pp, which is ~3.3 kg of e1RM on a 100 kg set. At 3 reps the same half-point moves
  it ~1.4 kg. So the *least* reliable inputs (high-rep sets, where RPE judgement is worst) get the
  *most* leverage.
- **Rounding mode.** See above — Python half-to-even breaks three chart cells. If the RPE table
  ever becomes a generated fixture, this bites in CI only.
- **`rpe` and `rir` are both columns on `sets` in the brief's data model.** If both are writable
  and only one is populated, `pct1RM` silently returns `null` and the composite quietly degrades
  to Epley. Derive one from the other at write time (`rir = 10 − rpe`) and make exactly one the
  source of truth, with a CHECK constraint.
- **Do not use fitnesscalcs.com's chart**, or any chart whose RPE-10 row starts 100 / 97.5 / 95.
  Sanity-assert `NRM[2] === 95.5` in a test so a future "chart update" PR can't swap it.
- A set at RPE 6 with 12 reps hits an `UNVERIFIED` cell (57.8). Because `null` is returned for
  `eff > 14`, this currently returns `null` → falls back to Brzycki. That is the desired
  conservative behaviour; don't "fix" it by extending the array.

### Open decision for the owner

**How do we stop the RPE branch from manufacturing fake PRs (R6)?**

- **(a) Cap the RPE contribution.** `e1RM = min(max(Epley, Brzycki, RPE), max(Epley,Brzycki) × 1.10)`
  — i.e. the RPE estimate may raise e1RM by at most 10% over the failure-assuming formulas. Keeps
  the brief's `max()` semantics, bounds the damage, one constant to tune.
- **(b) Replace `max()` with effective-reps.** Compute `eff = reps + RIR`, then take
  `max(Epley(w, eff), Brzycki(w, eff))` and drop the third term entirely. Theoretically cleaner
  (one model, RIR handled the way it is meant to be) but **contradicts the brief**, and at
  `eff > 12` it inherits Brzycki's blow-up instead.

**Recommendation: (a), with `RPE_INFLATION_CAP = 1.10`.** It honours the brief verbatim, needs no
spec change, is one line, and 10% is exactly the divergence Wikipedia already ascribes to these
estimates (`"the estimate may vary by 10% or more from the actual 1RM"`). Additionally gate PR
detection to `e1rm_source !== 'rpe'` **or** `reps <= 8`, so a high-rep back-off set can never
trigger confetti. Record the choice in `DECISIONS.md`.

---

## 3. US Navy body fat

### Question

What are the exact metric equations for men and women, what are the constants, the log base, the
required measurements, and the documented accuracy?

### Verified answer

**There are two different published forms and they are NOT interchangeable.** The widely-copied
`86.010 / −70.041 / +36.76` constants are for **inches**, not centimetres. At least one search
result asserted they were metric — that is wrong, and it would cost us 6.5 percentage points of
body fat (worked below).

**Metric form (cm) — use this one.** Quoted verbatim from calculator.net, confirmed
independently by omnicalculator.com:

> **Males (Metric Units — centimeters):**
> `"BFP = 495 / [1.0324 - 0.19077×log10(waist-neck) + 0.15456×log10(height)] - 450"`

> **Females (Metric Units — centimeters):**
> `"BFP = 495 / [1.29579 - 0.35004×log10(waist+hip-neck) + 0.22100×log10(height)] - 450"`

**Imperial form (inches) — for reference only, do not ship both.** Quoted verbatim from
Medicine LibreTexts and calculator.net (identical):

> Men: `"BF (%) = 86.010 x log10 (abdomen – neck) – 70.041 x log10 (height) + 36.76"` — **Units: Inches**
> Women: `"BF (%) = 163.205 x log10 (waist + hip – neck) – 97.684 x log10 (height) – 78.387"` — **Units: Inches**

**Log base: base-10 in every form.** LibreTexts states explicitly: `"Log Base: Base 10 (log10)"`.
In JS this is `Math.log10`, **not** `Math.log`.

**Structure of the metric form:** the bracket computes body **density**; `495/D − 450` is the Siri
equation converting density to fat percentage. So the metric form is a *density* model and the
imperial form is a *direct* regression — which is why they disagree slightly (see below).

**Required measurements** (LibreTexts / calculator.net):

| Sex | Measurements | Site guidance |
|---|---|---|
| Male | neck, waist (abdomen), height | neck `"just underneath the larynx (Adam's apple)"`; waist `"at the navel level"` |
| Female | neck, waist, **hip**, height | waist `"around the narrowest part of the abdomen"`; hip `"at the widest part of the buttocks or hip"` |

**Documented accuracy:**

> `"The male and female equations have a standard error of the estimate of 3%–4% body fat."`

More specifically, and cross-confirmed: SEE **3.5% for men, 3.7% for women**, validated against
hydrostatic weighing with **r ≈ 0.90**. `UNVERIFIED` at 2-dp precision — the values `3.52` / `3.72`
circulate but I could not read the primary NHRC reports (the National Academies chapter redirected
and was not retrieved). Report to the user as **±3–4 percentage points**.

**Primary reference:** Hodgdon, J.A. & Beckett, M.B. (1984). *Prediction of percent body fat for
U.S. Navy men from body circumferences and height.* Naval Health Research Center, San Diego, CA.
Report No. **84-11**. Companion women's report: **84-29**.

### Test vectors (2 per sex, metric)

Every intermediate term shown; `log10` values to 7 dp.

**Men — M1:** `waist = 85.0`, `neck = 38.0`, `height = 178.0` (cm)

```
waist − neck            = 47.0
log10(47.0)             = 1.6720979
0.19077 × 1.6720979     = 0.3189861
log10(178.0)            = 2.2504200
0.15456 × 2.2504200     = 0.3478249
denominator = 1.0324 − 0.3189861 + 0.3478249 = 1.0612388
495 / 1.0612388         = 466.436015
BFP = 466.436015 − 450  = 16.4360   %      ← expected
```

**Men — M2:** `waist = 100.0`, `neck = 40.0`, `height = 178.0`

```
waist − neck            = 60.0
log10(60.0)             = 1.7781513
0.19077 × 1.7781513     = 0.3392179
0.15456 × log10(178)    = 0.3478249
denominator = 1.0324 − 0.3392179 + 0.3478249 = 1.0410070
495 / 1.0410070         = 475.501125
BFP = 475.501125 − 450  = 25.5011   %      ← expected
```

**Women — F1:** `waist = 72.0`, `hip = 96.0`, `neck = 32.0`, `height = 165.0`

```
waist + hip − neck      = 136.0
log10(136.0)            = 2.1335389
0.35004 × 2.1335389     = 0.7468240
log10(165.0)            = 2.2174839
0.22100 × 2.2174839     = 0.4900640
denominator = 1.29579 − 0.7468240 + 0.4900640 = 1.0390300
495 / 1.0390300         = 476.405882
BFP = 476.405882 − 450  = 26.4059   %      ← expected
```

**Women — F2:** `waist = 88.0`, `hip = 105.0`, `neck = 34.0`, `height = 165.0`

```
waist + hip − neck      = 159.0
log10(159.0)            = 2.2013971
0.35004 × 2.2013971     = 0.7705770
0.22100 × log10(165)    = 0.4900640
denominator = 1.29579 − 0.7705770 + 0.4900640 = 1.0152769
495 / 1.0152769         = 487.551720
BFP = 487.551720 − 450  = 37.5517   %      ← expected
```

**Unit-slip vector (must be caught by a test):** feeding M1's centimetre values into the *inch*
equation gives `86.010·log10(47) − 70.041·log10(178) + 36.76 = 22.9555 %` — **+6.52 pp** vs the
correct 16.4360. Converting M1 to inches and using the inch equation gives **16.4907**, i.e. the
two published forms differ by **0.055 pp** on the same body. Both facts matter: the first is a
catastrophe, the second means **you must pick one form and never mix them**, or the user's trend
chart will show a phantom step the day you refactor.

### Recommendation

```ts
export type Sex = 'male' | 'female';

export function navyBodyFatPct(sex: Sex, m: {
  heightCm: number; neckCm: number; waistCm: number; hipCm?: number;
}): number | null {
  const { heightCm: h, neckCm: n, waistCm: w } = m;
  if (![h, n, w].every(v => Number.isFinite(v) && v > 0)) return null;
  if (sex === 'male') {
    if (w - n <= 0) return null;                    // log10 of <=0
    const d = 1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h);
    return clampPct(495 / d - 450);
  }
  const hip = m.hipCm;
  if (hip === undefined || !Number.isFinite(hip) || hip <= 0) return null;
  if (w + hip - n <= 0) return null;
  const d = 1.29579 - 0.35004 * Math.log10(w + hip - n) + 0.22100 * Math.log10(h);
  return clampPct(495 / d - 450);
}
const clampPct = (x: number) => (x < 2 || x > 60 ? null : x);   // physiological sanity gate
```

Ship the **metric form only**. Display as `16.4 %` (1 dp) with the text
`"±3–4 % (US Navy tape method, SEE)"` next to it — the brief's "honest data" principle demands the
error bar be visible, because the method's error is larger than most real month-to-month changes.

### Gotchas that will silently break us

- **`Math.log` vs `Math.log10`.** `Math.log(47) = 3.8501` vs `Math.log10(47) = 1.6721`. Using the
  natural log gives a *negative* denominator → `495/D − 450` ≈ **−591 %**. It will not throw.
- **`waist − neck ≤ 0`** (bad input, or neck and waist swapped in a form) → `log10(0) = −Infinity`,
  `log10(negative) = NaN`. `NaN` inserts into D1 as `NULL` on some drivers and as the string
  `"NaN"` on others; either way the body-fat chart develops a permanent hole.
- **The inch constants are on every calculator site labelled as metric by at least one of them.**
  Pin the metric constants in a test with M1 → `16.4360`.
- **Mixing forms across a refactor** produces a 0.055 pp discontinuity — invisible in a single
  reading, clearly visible as a step in a 12-month trend line, and impossible to explain later.
- The equations are **not** defined for a single-sex-neutral user. `sex` is required input; the
  brief's `settings` table must carry it, and `hip` is required for females and meaningless for
  males (don't make it `NOT NULL`).
- The female equation needs **three** circumferences; a partially-filled measurement form must
  return `null`, not silently drop `hip` to 0 (which gives `log10(waist − neck)` — a plausible-looking
  but completely wrong number).

### Open decision for the owner

None. Metric form, both sexes, ±3–4 pp disclosed in the UI.

---

## 4. EMA / trend weight

### Question

What exactly is the trend-weight EMA, what smoothing factor, what half-life, how is the first
reading seeded, and how are gaps and outliers handled?

### Verified answer

**The recurrence.** Quoted verbatim from Wikipedia, *Exponential smoothing*:

> `"s t = α x t + ( 1 − α ) s t − 1"`
> `"α is the smoothing factor, with 0 ≤ α ≤ 1."`

The equivalent "correction" form, which is what *The Hacker's Diet* prescribes and what we should
implement (fewer float ops, and the increment is directly displayable):

```
T[n] = T[n-1] + α · (W[n] − T[n-1])
```

**α = 0.1 is the trend-weight convention, and it comes from a primary source.** John Walker,
*The Hacker's Diet*, "Pencil and Paper" chapter — quoted verbatim:

> 1. `"Subtract yesterday's trend from today's weight. Write the result with a minus sign if it's negative."`
> 2. `"Shift the decimal place in the resulting number one place to the left. Round the number to one decimal place by dropping the second decimal and increasing the first decimal by one if the second decimal place is 5 or greater."`
> 3. `"Add this number to yesterday's trend number and enter in today's trend column."`

Shifting the decimal one place left **is** multiplying by 0.1. So **α = 0.1**, and note that
Walker's step 2 specifies **round-half-up** — the same rounding mode as the RPE chart (§2).

**Seeding — verified, primary.** Same chapter, for the very first day:

> `"enter your weight in the 'Trend' column as well as the 'Weight' column."`

So **`T[1] = W[1]`** exactly. Wikipedia concurs on the general practice:
`"s₀ ... is being initialized to x₀"`.

**The "9 days".** This is the **mean lag / centre of mass** of the EMA, not the half-life. All
three commonly-quoted characterisations of α = 0.1, computed:

| Quantity | Formula | α = 0.1 | Note |
|---|---|---|---|
| **Half-life** | `ln(0.5) / ln(1−α)` | **6.578813 days** | weight of a reading halves every 6.58 d |
| **Mean lag (centre of mass)** | `(1−α)/α` | **9.000000 days** | ← **this is the "9-day" figure** |
| Time constant τ | `−1 / ln(1−α)` | 9.491222 days | 63.2% step response |
| Equivalent SMA window | `2/α − 1` | 19 days | from Wikipedia's `"α = 2/(k + 1)"` |

So the "α = 0.1 / 9-day" convention is **real and internally consistent**, but the 9 days is the
*average age of the data*, and the half-life is **6.58 days**. Quoting "9-day half-life" in the UI
would be wrong. Wikipedia's moving-average equivalence, verbatim:

> `"Both filters also both have roughly the same distribution of forecast error when α = 2/(k + 1) where k is the number of past data points in consideration of moving average."`

**Gaps: the primary source is silent.** Verified negative result — the Hacker's Diet
pencil-and-paper chapter `"does not address what to do when weight readings are skipped"`, and
its own workflow assumes a reading every day. **Any gap policy we choose is a convention, not a
fact.** `UNVERIFIED` for all three variants below as "the standard"; they are engineering options.

### 10-day worked series

Input (kg): `82.0, 82.6, 81.8, 82.4, 83.1, 82.2, 81.9, 82.5, 82.0, 81.6`. α = 0.1, `T[1] = W[1]`.
No intermediate rounding (we do **not** adopt Walker's 1-dp rounding — see gotchas).

| day | W | T_prev | W − T_prev | 0.1 × (W − T_prev) | **T_new** |
|---|---|---|---|---|---|
| 1 | 82.00 | *(seed)* | — | — | **82.000000** |
| 2 | 82.60 | 82.000000 | +0.600000 | +0.060000 | **82.060000** |
| 3 | 81.80 | 82.060000 | −0.260000 | −0.026000 | **82.034000** |
| 4 | 82.40 | 82.034000 | +0.366000 | +0.036600 | **82.070600** |
| 5 | 83.10 | 82.070600 | +1.029400 | +0.102940 | **82.173540** |
| 6 | 82.20 | 82.173540 | +0.026460 | +0.002646 | **82.176186** |
| 7 | 81.90 | 82.176186 | −0.276186 | −0.027619 | **82.148567** |
| 8 | 82.50 | 82.148567 | +0.351433 | +0.035143 | **82.183711** |
| 9 | 82.00 | 82.183711 | −0.183711 | −0.018371 | **82.165340** |
| 10 | 81.60 | 82.165340 | −0.565340 | −0.056534 | **82.108806** |

`T[10] = 82.108806`. Naive mean of the 10 readings = `82.210000`. The EMA lags the (falling) series
and sits **0.101194 kg above** the arithmetic mean — that lag is the *point* of the trend, not a bug.

Assert to 6 dp: `82.000000, 82.060000, 82.034000, 82.070600, 82.173540, 82.176186, 82.148567,
82.183711, 82.165340, 82.108806`.

### Gap handling

Continuing from `T[10] = 82.108806`, day 11 **missing**, day 12 reading `81.4`:

| policy | computation | result |
|---|---|---|
| **(a) skip-missing** — one update per *reading*, ignore the calendar | `82.108806 + 0.1·(81.4 − 82.108806)` | **82.037925** |
| **(b) gap-aware α** — `α_eff = 1 − (1−α)^gapDays`, here `1 − 0.9² = 0.19` | `82.108806 + 0.19·(81.4 − 82.108806)` | **81.974133** |
| (c) carry-forward — impute `T` for day 11 then update normally | identical to (a) | 82.037925 |

The two policies differ by **0.063792 kg** after a single missed day, and the divergence compounds.
Pick one **now** and write it in `DECISIONS.md`.

### Recommendation

```ts
export const TREND_ALPHA = 0.1;              // Hacker's Diet convention
export const TREND_HALF_LIFE_DAYS = 6.578813;      // ln(0.5)/ln(0.9)
export const TREND_MEAN_LAG_DAYS  = 9;             // (1-alpha)/alpha  <- the "9 days"
export const OUTLIER_SIGMA = 3;
export const OUTLIER_ABS_KG = 3;

/** Gap-aware EMA over date-sorted readings. Returns a trend point per reading. */
export function trendWeight(readings: { date: string; kg: number }[]) {
  const out: { date: string; kg: number; trendKg: number; excluded: boolean }[] = [];
  let T: number | null = null;
  let prevDay = 0;
  for (const r of readings) {
    const day = daysSinceEpochInTz(r.date, 'Asia/Almaty');
    if (T === null) { T = r.kg; out.push({ ...r, trendKg: T, excluded: false }); prevDay = day; continue; }
    if (Math.abs(r.kg - T) > OUTLIER_ABS_KG) {         // do not update T; keep the raw point
      out.push({ ...r, trendKg: T, excluded: true }); prevDay = day; continue;
    }
    const gap = Math.max(1, day - prevDay);
    const aEff = 1 - Math.pow(1 - TREND_ALPHA, gap);   // policy (b)
    T = T + aEff * (r.kg - T);
    out.push({ ...r, trendKg: T, excluded: false });
    prevDay = day;
  }
  return out;
}
```

**Policy decisions baked in above:**

- **Gaps: policy (b), gap-aware α.** A 3-week holiday must not leave the trend anchored to
  pre-holiday weight and then crawl. Never insert synthetic weight readings — imputation would
  pollute the `body_measurements` table that §5's TDEE reads.
- **Outliers: clamp-and-flag, never drop.** Reject `|W − T| > 3 kg` from *updating* the trend but
  keep the raw reading visible and greyed on the chart. 3 kg is a convention (`UNVERIFIED` as a
  published threshold); it is roughly 4× the typical daily water swing. Do **not** use a rolling
  σ for a single user with sparse data — σ is unstable below ~14 points and the first few readings
  would each look like outliers.
- **Multiple readings on one calendar day:** average them into one value *before* the EMA, keyed on
  the `Asia/Almaty` local date (see §8).
- **Do not adopt Walker's 1-dp rounding.** It was a concession to paper. Rounding the *increment*
  to 1 dp means any `|W − T| < 0.05 kg` produces a zero increment and the trend **freezes** during
  exactly the plateau periods the user most wants to read.

### Gotchas that will silently break us

- **Seeding with `0` instead of `W[1]`** makes the trend crawl up from zero for ~40 days, showing a
  fake 80 kg "gain". Assert `T[1] === W[1]`.
- **Recomputing the whole EMA client-side from a paginated query.** An EMA is order-dependent and
  prefix-dependent: if the chart fetches "last 90 days" and seeds `T` from the first row *of that
  page*, the trend value for any given day changes depending on the zoom level. Compute the EMA
  server-side over the **full** history and store `trend_kg` per reading, or always seed from the
  persisted trend immediately before the window.
- **Out-of-order inserts.** Backfilling yesterday's weigh-in after today's invalidates every
  subsequent trend value. Any write to `body_measurements.weight` must trigger a recompute from
  that date forward.
- **`gap` computed from UTC dates** gives `gap = 0` or `2` around the Almaty midnight boundary
  (§8), so `α_eff` silently becomes `0` (no update at all) or `0.19`. Hence `Math.max(1, …)`.
- α = 0.1 over **weekly** weigh-ins is a ~63-day half-life — effectively a flat line. If the user
  weighs in sporadically, policy (b) fixes this automatically; policy (a) would not.

### Open decision for the owner

**Gap policy (a) vs (b).** **(a) skip-missing:** simplest, matches every paper-based trend tracker,
but a 14-day gap then a reading only moves the trend 10% of the way. **(b) gap-aware α:** the trend
catches up correctly after absences. **Recommendation: (b).** Single user, real life, travel — the
trend must be honest after a break. Cost: one extra `Math.pow`. Record in `DECISIONS.md`.

---

## 5. Adaptive TDEE

### Question

What is the exact energy-balance back-calculation, what energy-density constant, what window,
what warm-up period, how do we blend with the Mifflin-St Jeor prior, and what are the guards?

### Verified answer

#### The back-calculation

```
TDEE_est = mean_intake_kcal_per_day − (Δtrend_weight_kg × ENERGY_DENSITY_KCAL_PER_KG / days)
```

Sign convention: `Δtrend = trend_end − trend_start`. Losing weight ⇒ `Δ < 0` ⇒ the subtracted term
is negative ⇒ `TDEE_est > mean_intake`. Correct.

**Both inputs must be trend weights (§4), never raw scale readings.** A single 1.5 kg water swing
at a window boundary is `1.5 × 7700 / 28 = 412.5 kcal/day` of pure noise — larger than any real
TDEE change.

#### The energy density constant

**`ENERGY_DENSITY_KCAL_PER_KG = 7700`** (equivalently 3500 kcal/lb). This is **Wishnofsky's rule**.
Verified, with the critique attached:

> `"Wishnofsky's 'rule,' 1 lb of weight loss is equivalent to a deficit of 3500 kcal (ie, 7700 kcal/kg), is one of the most pervasive in clinical nutrition and medicine."`

And **it is known to be wrong for short windows**, which is the whole reason §5 needs a warm-up
period:

> `"At week 4 the measured energy content of weight change was 4858±388 kcal/kg (2208 kcal/lb), far lower than Wishnofsky's value of 7700 kcal/kg (3500 kcal/lb). This is because weight change will have a low energy density as proportionally large amounts of glycogen, protein, and water are catabolized to make up the calorie deficit."`

> `"A more accurate accounting of body composition changes demonstrated that this value is appropriate for modest weight changes in overweight and obese people, but is an overestimate in others."`

> `"a larger cumulative energy deficit is required per unit weight loss for people with greater initial body fat"`

`UNVERIFIED` at full-text level: the `4858 ± 388 kcal/kg` figure was read from a search snippet
attributed to Thomas et al., *Metabolism* (ScienceDirect S0026049511003945), not from the article
itself. The direction and magnitude of the critique are solid; treat the exact number as
indicative.

**It differs for fat vs lean tissue.** Adipose tissue is far more energy-dense than lean tissue,
which is why early-window weight change (mostly glycogen + water, ~1 g glycogen binds ~3 g water)
has a low energy density and late-window change approaches the fat figure. **The specific
per-tissue constants (commonly quoted as ~9440 kcal/kg fat and ~1800 kcal/kg lean) are
`UNVERIFIED` — I did not verify either. Do not hard-code them.** Use the single 7700 constant and
manage the error with the warm-up period.

**Precedent for 7700 in exactly our use case** — MacroFactor's published algorithm page confirms
it uses `"3,500 Calories per pound (or 7,700 per kilogram) as the energy density for weight change
calculations"`. So the brief's "MacroFactor-style" instruction and 7700 agree.

#### Window, warm-up, cadence — all from MacroFactor's published algorithm page

| Parameter | Value | Source status |
|---|---|---|
| Rolling window | **28 days** | MacroFactor uses `"rolling 30-day"` analysis; 28 is 30 rounded to whole weeks so the window boundary always lands on the same weekday. The 28-vs-30 choice is ours. |
| First estimate | day **3** | `"Algorithms begin updating on the third day"` |
| Warm-up before trustworthy | **3–4 weeks** | `"Peak performance achieved after 3-4 weeks of consistent logging"` |
| Recompute cadence | **weekly** | brief mandates weekly; MacroFactor's accuracy figures are quoted per-week and per-30-day |
| Achievable accuracy | `"~110 Calories/day median error (4.4% of TDEE) after initial period"`; `"median error of 1.15lb/month vs. 2.6lb with formulas"` | verified |
| Partial-logging rule | `"flags days with logged intake <50% of surrounding days as 'partially logged'"`; `"partial logging is the single cardinal sin we ask users to avoid"` | verified |

#### The Mifflin-St Jeor prior

Quoted verbatim. The **original 1990 combined regression**:

> `"REE = (9.99 × weight in kg) + (6.25 × height in cm) − (4.92 × age in years) + (166 × sex) − 161"`
> where `sex` = 1 male, 0 female

The **clinically used sex-split simplification** (this is what every app ships):

> Men: `"(10 × weight in kg) + (6.25 × height in cm) − (5 × age in years) + 5"`
> Women: `"(10 × weight in kg) + (6.25 × height in cm) − (5 × age in years) − 161"`

> `"explained about 71% of the variation in measured resting energy expenditure (R² = 0.71)"`

Citation: Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. "A new predictive
equation for resting energy expenditure in healthy individuals." *Am J Clin Nutr* **51**(2):
241–247, Feb 1990. `n = 498` (251 M / 247 F), age 19–78.

⚠️ **These two forms are not equal.** For our worked body (82.0 kg, 178 cm, 30 y, male):
combined = `9.99·82 + 6.25·178 − 4.92·30 + 166 − 161 = 819.18 + 1112.5 − 147.6 + 5 = 1789.0800`;
split = **1787.5000**. Difference **1.58 kcal/day**. Ship the **split** form (it is what MSJ means
in every other tool) and pin it in a test.

MSJ gives **RMR**, not TDEE. Multiply by an activity factor. `UNVERIFIED` — the specific
Harris-Benedict-style activity multipliers (1.2 / 1.375 / 1.55 / 1.725 / 1.9) are near-universal in
calculators but I did not verify them against a primary source. They are the *prior* only and are
discarded after 4 weeks, so the risk is bounded.

**Katch-McArdle**, for users who have a body-fat estimate (which §3 gives us):

```
LBM_kg = weight_kg × (1 − bodyFatPct / 100)
BMR    = 370 + 21.6 × LBM_kg
```

Verified: `"BMR = 370 + (21.6 * Lean Body Mass [kg])"` and
`"LBM (kg) = Total Body Weight (kg) × (1 − Body Fat% ÷ 100)"`. Do not confuse it with Cunningham
(`500 + 22 × LBM`). Katch-McArdle **requires** LBM, so it is unusable until the user has logged a
Navy-method measurement — which is exactly why MSJ must be the default prior.

### 4-week worked example

Male, 82.0 kg, 178 cm, 30 y, activity factor 1.55. `T0 = 82.400 kg` (trend weight at window start).

**Prior:**
```
MSJ(male) = 10·82.0 + 6.25·178.0 − 5·30 + 5
          = 820.0 + 1112.5 − 150 + 5 = 1787.5000 kcal/d
prior_TDEE = 1787.5000 × 1.55        = 2770.6250 kcal/d
```
Katch-McArdle cross-check using §3 vector M1 (16.4360 % BF):
`LBM = 82.0 × (1 − 0.164360) = 68.522480 kg`; `BMR = 370 + 21.6 × 68.522480 = 1850.0856`;
`× 1.55 = 2867.6326 kcal/d`. **97 kcal/d above MSJ** — a good illustration of why the prior is
only a prior.

**Weekly recompute** (cumulative window from `T0`, blend weight `w = min(1, days/28)`):

| wk | days | mean intake | T_start | T_end | Δ kg | `Δ·7700/days` | **TDEE_data** | w | **blended** | after cap |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 7 | 2500.0 | 82.400 | 82.300 | −0.100 | −110.0000 | 2610.0000 | 0.25 | 2730.4688 | 2730.4688 |
| 2 | 14 | 2480.0 | 82.400 | 82.050 | −0.350 | −192.5000 | 2672.5000 | 0.50 | 2721.5625 | 2721.5625 |
| 3 | 21 | 2460.0 | 82.400 | 81.800 | −0.600 | −220.0000 | 2680.0000 | 0.75 | 2702.6563 | 2702.6563 |
| 4 | 28 | 2450.0 | 82.400 | 81.500 | −0.900 | −247.5000 | 2697.5000 | 1.00 | **2697.5000** | **2697.5000** |

Week-4 arithmetic in full:
```
Δ                = 81.500 − 82.400 = −0.900 kg
tissue energy    = −0.900 × 7700   = −6930.0000 kcal over 28 d
per day          = −6930.0000 / 28 = −247.500000 kcal/d
TDEE_data        = 2450.0 − (−247.500000) = 2697.500000 kcal/d
blended (w = 1)  = 2697.500000
vs MSJ prior     = 2697.5000 − 2770.6250 = −73.1250 kcal/d  (the prior was 2.7% high)
```

Week-1 blend, spelled out: `0.25 × 2610.0000 + 0.75 × 2770.6250 = 652.5000 + 2077.9688 = 2730.4688`.
Week-2: `0.50 × 2672.5000 + 0.50 × 2770.6250 = 1336.2500 + 1385.3125 = 2721.5625`.
Week-3: `0.75 × 2680.0000 + 0.25 × 2770.6250 = 2010.0000 + 692.6563 = 2702.6563`.

No cap fired: the largest week-over-week move is `|2730.4688 − 2770.6250| = 40.16 kcal/d`, well
inside ±250.

### Recommendation

```ts
export const ENERGY_DENSITY_KCAL_PER_KG = 7700;      // Wishnofsky; MacroFactor uses the same
export const TDEE_WINDOW_DAYS      = 28;
export const TDEE_MIN_INTAKE_DAYS  = 14;             // below this: prior only
export const TDEE_MIN_WEIGH_INS    = 10;             // in the window
export const TDEE_WARMUP_DAYS      = 21;             // <21d => show "calibrating"
export const TDEE_MAX_WOW_DELTA    = 250;            // kcal/d cap, week over week
export const TDEE_PARTIAL_DAY_FRAC = 0.5;            // <50% of window median => partial

export function mifflinStJeor(sex: Sex, kg: number, cm: number, age: number): number {
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
}
export function katchMcArdle(kg: number, bodyFatPct: number): number {
  return 370 + 21.6 * (kg * (1 - bodyFatPct / 100));
}
```

Algorithm, run by the weekly Cron Trigger (Sunday 23:59 `Asia/Almaty`):

1. Build the trend series (§4). Take `T_start` = trend at `now − 28d`, `T_end` = trend at `now`.
   **Both must be real trend points**, not interpolations across a gap.
2. Compute `completeDays` = days in the window whose logged intake ≥ `0.5 ×` the window median
   intake. **Compute `mean_intake` over complete days only**, and set `days` in the formula to
   `completeDays`, not 28. Otherwise every skipped logging day reads as a fast.
3. Guards — if any fails, keep last week's estimate and surface *why*:
   - `completeDays < 14` → prior only, badge `"needs 14 days of complete logging"`
   - weigh-ins in window `< 10` → prior only
   - `|Δ| > 0.010 × weight` (≈ >0.82 kg/wk here) → still compute, but badge as suspect
4. `w = min(1, completeDays / 28)`; `blended = w · TDEE_data + (1 − w) · prior`.
5. Cap: `final = clamp(blended, last − 250, last + 250)`.
6. Persist `{week_ending, tdee_est, tdee_data, prior, w, complete_days, weigh_ins, capped}`. Never
   overwrite — the history is the only way to debug a weird target later.

Prior selection: **MSJ × activity factor** by default; switch to **Katch-McArdle × activity
factor** only once a Navy body-fat measurement less than 60 days old exists. Show the user which
prior is active.

### Gotchas that will silently break us

- **Incomplete intake logging inflates TDEE, permanently and invisibly.** A day logged at 600 kcal
  because the user gave up after breakfast drags `mean_intake` down; the algorithm then concludes
  expenditure must be higher and *raises* the calorie target — the exact opposite of what the
  user needs. MacroFactor calls this `"the single cardinal sin"`. Step 2's complete-days filter is
  **not optional**.
- **Sign error.** `mean_intake + Δ·7700/days` instead of `−` gives 2202.5 instead of 2697.5 in the
  worked example: a 495 kcal/day error, in the direction that makes the user lose weight twice as
  fast as intended. The number looks plausible. **Pin the worked example as a test.**
- **Using raw weight instead of trend weight** at the window edges injects ±400 kcal/day of noise.
- **Wishnofsky is an overestimate in the first weeks**, so early `TDEE_data` is biased. That is
  what the 3-week warm-up and the `w = days/28` ramp exist for. Do not shorten them to make the
  number appear sooner.
- **Cron and the timezone.** The brief uses Cloudflare Cron Triggers, which fire on **UTC**. A
  "Sunday 23:59 Almaty" recompute is `18:59 UTC Sunday`. A cron written as `59 23 * * 0` runs at
  `04:59 Monday Almaty` and will include Monday's partial intake in the window.
- **Weight in lb anywhere** silently changes the constant's meaning (3500 vs 7700) and produces a
  2.2× error in the correction term.
- **`completeDays = 0`** → division by zero → `Infinity` → the stored TDEE poisons every
  subsequent cap computation (`clamp(x, Infinity−250, Infinity+250)`). Guard before dividing.
- MSJ `R² = 0.71` means the prior is routinely ±200 kcal/day off for an individual. Never present
  the week-1 blended number without the "calibrating" badge.

### Open decision for the owner

**Should the weekly TDEE change be capped at ±250 kcal/day, or at ±10% of the current estimate?**
**(a) ±250 kcal/day flat:** predictable, easy to explain, but at a 2000 kcal TDEE it allows a 12.5%
jump. **(b) ±10% of current:** scale-invariant, tighter at low TDEE. **Recommendation: (a) ±250
flat**, because the cap exists to absorb *logging* noise, and logging noise is roughly absolute
(a missed meal is ~600 kcal regardless of body size), not proportional. Revisit if the estimate
is seen sawtoothing against the cap two weeks running. Record in `DECISIONS.md`.

---

## 6. Plate math

### Question

Given a target weight, a bar weight, and an inventory of plate pairs, produce the per-side plate
list and the achievable weight nearest the target — handling microplates, unreachable targets, and
targets below the bar.

### Verified answer

No formula to cite; this is a bounded coin-change problem. What **is** citable is the plate
inventory the algorithm must model. Verified:

> IWF standardised colour coding: `"red = 25 kg, blue = 20 kg, yellow = 15 kg, green = 10 kg, white = 5 kg, black = 2.5 kg"`, and `"This system is used in all Olympic weightlifting and most IPF powerlifting competitions."`

> `"The men's bar weighs 20 kg and the women's bar weighs 15 kg"`

Sub-2.5 kg change plates (1.25 / 1.0 / 0.5 / 0.25 kg) exist and are ubiquitous in gyms, but the
IWF equipment page returned **HTTP 403** and I could not verify an official list of them.
`UNVERIFIED` — treat the microplate denominations as **user-configurable inventory**, not as a
constant. Which is what a single-user app should do anyway.

**Definitions:**
```
perSideTarget = (target − barKg) / 2
achieved      = barKg + 2 × Σ(loaded plates)
minIncrement  = 2 × (smallest available plate)
```

**Greedy:** walk the inventory descending; take a plate while it fits in the remaining per-side
budget. Greedy is optimal for *canonical* systems (each denomination divides the next) — the
25/20/15/10/5/2.5/1.25 set is **not** canonical (15 does not divide 20), so greedy can be
suboptimal. In practice, with 25 available, greedy is fine; but it is **round-down only** and will
miss a nearer achievable weight above the target. Both answers must be computed.

### Test vectors

Bar **20.0 kg**. Inventory, as *pairs available*:
`{25: 2, 20: 2, 15: 1, 10: 2, 5: 2, 2.5: 2, 1.25: 2, 0.5: 2}`.
`minIncrement = 2 × 0.5 = 1.0 kg`.

| # | target | perSideTarget | greedy plates (per side) | greedy achieved | greedy err | nearest achievable | nearest err | status |
|---|---|---|---|---|---|---|---|---|
| **P1** | 100.0 | 40.00 | `[25, 15]` | **100.0** | +0.0000 | 100.0 | +0.0000 | `EXACT` |
| **P2** | 62.5 | 21.25 | `[20, 1.25]` | **62.5** | +0.0000 | 62.5 | +0.0000 | `EXACT` (microplate) |
| **P3** | 101.9 | 40.95 | `[25, 15, 0.5]` | **101.0** | **−0.9000** | **102.0** | **+0.1000** | `ROUNDED` — greedy is 9× worse |
| **P4** | 15.0 | *n/a* | `[]` | **20.0** | +5.0000 | 20.0 | +5.0000 | `BELOW_BAR` |

Arithmetic for each:

**P1:** `(100 − 20)/2 = 40`. Greedy: `25 → 15 left`; `20 > 15` skip; `15 → 0 left`. Loaded 40.
`20 + 2·40 = 100`. Exact.

**P2:** `(62.5 − 20)/2 = 21.25`. Greedy: `25 > 21.25` skip; `20 → 1.25 left`; `15/10/5/2.5` skip;
`1.25 → 0`. Loaded 21.25. `20 + 2·21.25 = 62.5`. Exact. **This is the microplate vector** — without
1.25 kg plates, 62.5 kg is unreachable on a 20 kg bar.

**P3 (the important one):** `(101.9 − 20)/2 = 40.95`. Greedy: `25 → 15.95`; `20` skip; `15 → 0.95`;
`10/5/2.5/1.25` all `> 0.95` skip; `0.5 → 0.45`; second `0.5 > 0.45` skip. Loaded `40.5`.
`20 + 2·40.5 = 101.0`, error **−0.9**. But the achievable lattice near 101.9 is
`{99.5, 100.0, 101.0, 102.0, 102.5, 103.5, 104.5}` — note **100.5 and 101.5 are NOT achievable**
because `minIncrement = 1.0 kg`. Nearest is **102.0** (`[25, 15, 0.5, 0.5]` per side), error
**+0.1**. Greedy's answer is **9× further from the target**. Ship both, default to nearest.

**P4:** `15 < 20`. Return `{status: 'BELOW_BAR', plates: [], achieved: 20.0}`. Do **not** return
negative plates and do **not** throw — the user is probably on a lighter implement and the UI
should offer a lighter bar.

### Recommendation

```ts
export type PlateResult = {
  status: 'EXACT' | 'ROUNDED' | 'BELOW_BAR' | 'NO_INVENTORY';
  platesPerSide: number[];        // descending
  achievedKg: number;
  errorKg: number;                // achievedKg - targetKg
};

/** Enumerate every achievable total. Inventory is tiny (a dozen plates) so this is cheap
 *  (<= a few thousand subset sums) and exact. Memoise per inventory hash in KV. */
function achievableTotals(barKg: number, inv: [number, number][]): Map<number, number[]> { /* … */ }

export function plateMath(
  targetKg: number, barKg: number, inv: [number, number][],
  mode: 'nearest' | 'roundDown' = 'nearest',
): PlateResult { /* … */ }
```

- Default **`mode: 'nearest'`**, tie-break **toward the heavier** weight (a lifter told "102.5"
  would rather load 102.5 than 102.0 when both are 0.25 off a 102.25 target — and for
  progressive overload the upward tie-break is the one that makes progress).
- Enumerate the full achievable set rather than trusting greedy; it is exact and the inventory is
  tiny. Cache the sorted lattice in KV keyed by an inventory hash.
- Work in **integer grams** internally (`×1000`, integers) and convert at the boundary. See gotchas.
- Return `errorKg` and render it (`"102.0 kg (+0.1)"`). The brief's honest-data principle applies
  here too.

### Gotchas that will silently break us

- **Floating point.** `0.1 + 0.2 !== 0.3`; likewise `2.5 + 1.25 + 0.5` accumulates error, and
  `remaining >= plate` comparisons flip at the last plate. A missing `1e-9` epsilon (or, better,
  integer grams) makes the calculator drop the final microplate **intermittently**, depending on
  the target — the worst kind of bug to reproduce in a gym.
- **`minIncrement` is `2 × smallest plate`, not the smallest plate.** Every "why can't I load
  101.5?" bug is this. `100.5` kg is unreachable with 0.5 kg plates on a 20 kg bar.
- **Greedy round-down presented as "the answer"** gives P3's −0.9 kg. On a progressive-overload
  suggestion of `+2.5 kg`, a −0.9 kg rounding error eats 36% of the increment.
- **Target below bar** must not produce negative plate counts or an empty screen.
- **Collars.** Competition collars weigh 2.5 kg each (5 kg the pair) and gym clips ~0.5–2.5 kg.
  If the user's "bar weight" setting excludes collars, every computed weight is light by that
  amount and every e1RM in §1 is correspondingly wrong. Model `barKg` as *bar + collars* and label
  the setting that way.
- **Odd inventory counts.** Plates come in *pairs*; an inventory of 3 × 10 kg plates means **1
  usable pair**. Store pairs, not plates, or integer-divide by 2 on import.
- Specialty bars (trap, safety squat, 15 kg women's bar, 10 kg technique bar) have different
  weights. `barKg` must be per-exercise-overridable, not a single global setting.

### Open decision for the owner

None. Nearest-achievable with upward tie-break, integer grams, per-exercise bar weight.

---

## 7. Warm-up set calculator

### Question

A cited, conventional warm-up ramp, and how to round it to achievable plate weights.

### Verified answer

The most widely used documented ramp is Jim Wendler's 5/3/1 warm-up. Quoted verbatim from
thefitness.wiki's *5/3/1 for Beginners*:

> `"5 reps @ 40%"`
> `"5 reps @ 50%"`
> `"3 reps @ 60%"`

> These percentages are derived from your current **Training Max**.
> The Training Max is established as `"90% of the estimated 1RM"` when starting the program.

> `"All percentages reference your Training Max, not your true 1RM."`

Independently confirmed: `"Wendler's standard warm-up ramp consists of 40% x5, 50% x5, 60% x3 of
your training max, and these same three sets are used every week."`

⚠️ **Critical scoping point.** Wendler's percentages are of the **Training Max (≈ 90% of 1RM)**,
*not* of the day's working weight. Our calculator's input is the **working weight** for the
exercise. Applying 40/50/60 to the working weight is a **different, lighter** ramp than Wendler's —
correctly so, since the working weight is usually below the training max. I am treating
**"40/50/60% of the day's top working weight × 5/5/3"** as the app's convention, with Wendler as
its provenance. The re-scoping is ours; mark it as a **convention**, and note `UNVERIFIED` for any
claim that Wendler prescribed percentages of the working weight.

**Rounding: round DOWN** to the nearest achievable plate weight (§6). A warm-up must never exceed
its prescription; and a too-heavy warm-up steals reps from the working sets.

### Test vectors

Bar 20.0 kg, inventory as in §6 (`minIncrement = 1.0 kg`).

**W1 — working weight 100.0 kg** (all three land exactly):

| step | raw | arithmetic | round-down | error | nearest | plates per side |
|---|---|---|---|---|---|---|
| 40% × 5 | 40.0000 | `100 × 0.40` | **40.00** | +0.0000 | 40.00 | `[10]` |
| 50% × 5 | 50.0000 | `100 × 0.50` | **50.00** | +0.0000 | 50.00 | `[15]` |
| 60% × 3 | 60.0000 | `100 × 0.60` | **60.00** | +0.0000 | 60.00 | `[20]` |

**W2 — working weight 87.5 kg** (the middle step is unreachable):

| step | raw | arithmetic | round-down | error | nearest | note |
|---|---|---|---|---|---|---|
| 40% × 5 | 35.0000 | `87.5 × 0.40` | **35.00** | +0.0000 | 35.00 | `[5, 2.5]` per side |
| 50% × 5 | **43.7500** | `87.5 × 0.50` | **43.50** | **−0.2500** | 43.50 | 43.75 needs 11.875/side; `minIncrement` is 1.0 kg so only 43.5 / 44.5 exist |
| 60% × 3 | 52.5000 | `87.5 × 0.60` | **52.50** | +0.0000 | 52.50 | `[15, 1.25]` per side |

Note that for W2's middle step round-down and nearest **coincide** at 43.50 (43.50 is 0.25 below,
44.50 is 0.75 above), so this vector does not distinguish the two policies — deliberately: it
tests that the rounding *happens*, and §6/P3 tests that the policies differ.

### Recommendation

```ts
export const WARMUP_RAMP = [
  { pct: 0.40, reps: 5 },
  { pct: 0.50, reps: 5 },
  { pct: 0.60, reps: 3 },
] as const;   // Wendler 5/3/1, re-scoped to the day's top working weight (a convention)

export const WARMUP_MIN_ABOVE_BAR_KG = 5;    // skip a step that is within 5 kg of the empty bar
export const WARMUP_MAX_STEPS = 4;

export function warmupSets(workingKg: number, barKg: number, inv: [number, number][]) {
  return WARMUP_RAMP
    .map(s => {
      const raw = workingKg * s.pct;
      const r = plateMath(raw, barKg, inv, 'roundDown');
      return { ...s, rawKg: raw, weightKg: r.achievedKg, platesPerSide: r.platesPerSide };
    })
    .filter(s => s.weightKg >= barKg + WARMUP_MIN_ABOVE_BAR_KG && s.weightKg < workingKg);
}
```

- **Always** prepend an empty-bar set for barbell exercises; it costs 20 seconds and it is where
  the user actually finds their groove.
- Suppress steps that collapse onto the bar or onto the working weight (the `filter`). For a 30 kg
  working weight on a 20 kg bar, 40% = 12 kg is *below the bar* — the whole ramp is meaningless and
  must not render three "20.0 kg" rows.
- Do **not** apply the ramp to dumbbell or machine exercises without snapping to that
  implement's own increment ladder (DBs jump 2 kg or 2.5 kg; machines have fixed pin positions).

### Gotchas that will silently break us

- **The Training-Max confusion.** If someone later "fixes" the calculator to match Wendler
  literally by dividing by 0.9, every warm-up gets 11% heavier. Put the provenance in a code
  comment and assert W1 in a test.
- **Ramp steps below the bar.** 40% of a 40 kg working weight is 16 kg on a 20 kg bar. Without the
  filter you get three identical 20 kg rows, which looks like a broken calculator.
- **Rounding up instead of down** can put a "warm-up" above the working weight on light lifts.
- Percentages are of the **top** working set, not the first. With ascending working sets those
  differ, and a ramp built off the first set is too light.
- `workingKg <= barKg` must return an empty ramp, not three `BELOW_BAR` rows.

### Open decision for the owner

**Fixed 3-step ramp, or load-dependent step count?** **(a) Fixed 40/50/60:** cited, predictable,
2 vectors to test. **(b) Scale the number of steps with absolute load** (e.g. 5 steps above
140 kg), which is what most strong lifters actually do. **Recommendation: (a) for Phase 2**, ship
`WARMUP_RAMP` as a user-editable array in settings so the owner can add steps without a release.
Revisit in Phase 3 alongside progression schemes.

---

## 8. Volume metrics

### Question

Define working-set volume, how warm-up and drop sets count, "hard sets" per muscle per week, the
primary/secondary credit weighting for the heatmap, and the rolling-7-day window in
`Asia/Almaty`.

### Verified answer

#### Volume load (tonnage)

```
workingSetVolume = Σ over sets with type ∈ {working, drop, failure} of (reps × weightKg)
```

Warm-up sets are **excluded**. Drop sets **are** included — they are taken to or near failure and
are working stimulus by any definition. No citation is needed for the arithmetic; the *inclusion
policy* is a convention and is stated here so it is testable.

#### Hard sets

Verified dose-response basis:

> Schoenfeld BJ, Ogborn D, Krieger JW. "Dose-response relationship between weekly resistance
> training volume and increases in muscle mass: A systematic review and meta-analysis."
> *Journal of Sports Sciences* **35**(11): 1073–1082, 2017. doi:10.1080/02640414.2016.1210197

> `"Studies that used more than 10 sets per muscle per week produced significantly greater hypertrophy than those using fewer than 10."`

> `"The findings indicate a graded dose-response relationship whereby increases in RT volume produce greater gains in muscle hypertrophy."`

`UNVERIFIED` — the paper's exact `<5 / 5–9 / 10+` binning and per-bin effect sizes. The PDF at
ageingmuscle.be is image-only and PubMed is cookie-walled. The `>10 sets/week` threshold and the
graded relationship are verified; do not quote effect sizes.

`UNVERIFIED` — the term "hard set" does not appear with a formal definition in the literature I
could reach. It is practitioner vocabulary. **Our operational definition:**

```
isHardSet(s) = s.type ∈ {working, drop, failure} AND (s.rir ≤ 4)      // i.e. RPE ≥ 6
```

#### ⚠️ Primary/secondary credit — the brief's 0.5 convention contradicts the best available evidence

The brief specifies secondary = 0.5. The one paper written specifically on this question says
otherwise. Quoted verbatim:

> `"Until more research is conducted to derive stronger conclusions on the topic, we propose the best advice would be to view set-volume prescription on a 1:1 basis, and then use logical rationale and personal expertise to make determinations on program design."`

> Schoenfeld BJ, Grgic J, Haun C, Itagaki T, Helms ER. "Calculating Set-Volume for the Limb
> Muscles with the Performance of Multi-Joint Exercises: Implications for Resistance Training
> Prescription." *Sports (Basel)* **7**(7): 177, 2019. doi:10.3390/sports7070177

The authors note biomechanical and EMG theory *suggests* fractional counting may be warranted, but
the longitudinal evidence is `"limited and conflicting"` and they **decline to give a weighting**.

**Therefore: `SECONDARY_MUSCLE_CREDIT = 0.5` is a display convention, explicitly NOT a fact, and
it is the opposite of what the only paper on the topic recommends.** It is defensible for a
*heatmap* — whose job is to show relative colour, not to prescribe — but it must be labelled in
the UI and it must be a single named constant, not a magic number sprinkled through queries.

**Muscle taxonomy.** The brief seeds from free-exercise-db. Verified field names from
`dist/exercises.json` (camelCase — **not** snake_case):

```json
{ "name": "3/4 Sit-Up", "force": "pull", "level": "beginner", "mechanic": "compound",
  "equipment": "body only", "primaryMuscles": ["abdominals"], "secondaryMuscles": [],
  "instructions": ["…"], "category": "strength",
  "images": ["3_4_Sit-Up/0.jpg", "3_4_Sit-Up/1.jpg"], "id": "3_4_Sit-Up" }
```

Observed muscle values include: `abdominals, hamstrings, calves, quadriceps, forearms, shoulders,
glutes, adductors, chest, triceps, biceps, lats, traps, lower back, middle back`. Note `"shoulders"`
is **one** undifferentiated value — the brief's muscle heatmap wants front/side/rear delts
separately, so a mapping layer is required. Also note `mechanic`, `force`, and `equipment` can be
`null`. The brief's data model uses `primary_muscles` / `secondary_muscles` (snake_case) for the D1
column names — that is fine, but the **import mapper must translate**, and `secondaryMuscles` is
frequently `[]`.

#### Rolling 7-day window, `Asia/Almaty`

**`Asia/Almaty` is UTC+5 with no DST — but only since 2024-03-01.** Verified:

> `"Kazakhstan established a single time zone of UTC+05:00 effective since March 1, 2024. Prior to March 1, 2024, Kazakhstan used two time zones: UTC+5 and UTC+6."`

> `"The change affected two time zones: Asia/Almaty and Asia/Qostanay, which were in UTC+6"`; `"Almaty's IANA identifier is Asia/Almaty; older software may still show its former UTC+6 offset."`

**Definition** (both bounds inclusive, 7 local calendar days including today):

```
end   = today 23:59:59.999 local
start = (today − 6 days) 00:00:00.000 local
```

### Worked example

10 sets across one week. Muscle credit: chest 1.0 / front_delts 0.5 / triceps 0.5 for the presses;
Cable Fly chest 1.0; Triceps Pushdown triceps 1.0.

| date | exercise | type | weight | reps | reps×wt | counted? |
|---|---|---|---|---|---|---|
| 2026-09-07 | Barbell Bench Press | warmup | 40.0 | 5 | 200.0 | ✗ warm-up |
| 2026-09-07 | Barbell Bench Press | warmup | 60.0 | 3 | 180.0 | ✗ warm-up |
| 2026-09-07 | Barbell Bench Press | working | 80.0 | 8 | 640.0 | ✓ |
| 2026-09-07 | Barbell Bench Press | working | 80.0 | 7 | 560.0 | ✓ |
| 2026-09-07 | Barbell Bench Press | **drop** | 60.0 | 10 | 600.0 | ✓ |
| 2026-09-09 | Incline DB Press | working | 30.0 | 10 | 300.0 | ✓ |
| 2026-09-09 | Incline DB Press | working | 30.0 | 9 | 270.0 | ✓ |
| 2026-09-11 | Cable Fly | working | 20.0 | 12 | 240.0 | ✓ |
| 2026-09-11 | Cable Fly (RIR **5**) | working | 20.0 | 12 | 240.0 | ✓ volume, ✗ hard set |
| 2026-09-11 | Triceps Pushdown | working | 35.0 | 12 | 420.0 | ✓ |

**Working-set volume** = `640 + 560 + 600 + 300 + 270 + 240 + 240 + 420` = **3270.0 kg**
(the two warm-ups, 200 + 180 = 380 kg, are excluded).

**Credited hard sets** (8 qualifying sets — the 2 warm-ups and the RIR-5 fly are out):

| muscle | arithmetic | credited hard sets |
|---|---|---|
| chest | `3×1.0 (bench) + 2×1.0 (incline) + 1×1.0 (fly)` | **6.0** |
| front_delts | `3×0.5 + 2×0.5` | **2.5** |
| triceps | `3×0.5 + 2×0.5 + 1×1.0` | **3.5** |

**Per-muscle tonnage** with the same weighting:

| muscle | kg |
|---|---|
| chest | **2850.0** |
| front_delts | **1185.0** |
| triceps | **1605.0** |

Sum over muscles = **5640.0 kg** vs total tonnage **3270.0 kg**. The discrepancy is **by design** —
secondary credit double-counts. **Never present the per-muscle sum as "session volume".**

**The window**, evaluated at local `2026-09-13T07:30:00+05:00`:

```
window (local) = [2026-09-07T00:00:00+05:00 , 2026-09-13T23:59:59.999+05:00]
window (UTC)   = [2026-09-06T19:00:00Z     , 2026-09-13T18:59:59.999Z     ]
local dates    = 2026-09-07 … 2026-09-13   (7 days)
```

**Off-by-one demonstration:** a set logged `2026-09-07 00:30` local is `2026-09-06T19:30:00Z`. Its
**UTC date is 2026-09-06** — outside the window if you group by UTC date, inside it if you group by
Almaty date. That one set is 640 kg of chest volume in the example above.

### Recommendation

```ts
export const SECONDARY_MUSCLE_CREDIT = 0.5;   // CONVENTION, not evidence (Schoenfeld 2019: 1:1)
export const PRIMARY_MUSCLE_CREDIT   = 1.0;
export const HARD_SET_MAX_RIR        = 4;
export const COUNTED_SET_TYPES = ['working', 'drop', 'failure'] as const;
export const APP_TZ = 'Asia/Almaty';          // UTC+5, no DST (since 2024-03-01)

export function rolling7dWindow(nowUtc: Date) {
  // Compute in APP_TZ, return UTC instants for the SQL BETWEEN.
  // start = (localToday - 6d) 00:00:00.000 ; end = localToday 23:59:59.999
}
```

- Store **`local_date TEXT` (`YYYY-MM-DD`, Almaty)** alongside the UTC timestamp on `sets`,
  `workouts`, `food_entries`, `water_logs`, `daily_checkins`, and `body_measurements`. Index it.
  Every calendar-shaped query (GitHub heatmap, streaks, rolling windows, daily macro rings) then
  groups on a plain string and cannot drift. Computing `local_date` in SQL from a UTC timestamp is
  not portable on D1 and would recompute on every read.
- Keep the rolling window's UTC instants only for `BETWEEN` on the raw timestamp; prefer
  `local_date BETWEEN '2026-09-07' AND '2026-09-13'`.
- Label the heatmap legend explicitly: *"secondary muscles counted at 50%"*.
- Persist the muscle-credit weights in a table, not in code, so re-weighting doesn't need a
  migration.

### Gotchas that will silently break us

- **UTC-vs-Almaty off-by-one.** UTC+5 means local `00:00–05:00` falls on the *previous* UTC date.
  Late-night and pre-dawn gym sessions land in the wrong day, which corrupts the streak counter
  (§brief: streaks must never hard-reset — a timezone bug that drops a day is the worst possible
  trigger for exactly the rage-quit the brief is designed to avoid), the calendar heatmap, and
  every rolling window. **This is the highest-risk bug in the analytics module.**
- **`Asia/Almaty` was UTC+6 before 2024-03-01.** Any Hevy/Strong/MFP CSV import containing
  pre-March-2024 data must be converted with a real IANA-aware library, not `+05:00`. A hardcoded
  `+5` shifts all historical data by an hour, which can move a late-evening session to the next
  day. Also: `"older software may still show its former UTC+6 offset"` — the Workers runtime's
  tzdata version is not something we control, so **never** rely on runtime `Intl` for the *stored*
  `local_date`; compute it once at write time and store it.
- **Rolling-7 vs calendar-week.** `10+ sets/week` from Schoenfeld is a *calendar* week in the
  studies; our heatmap uses a *rolling* 7 days. They are not the same number and the "under-trained
  flag" threshold should not be copied between them without thought.
- **Double-counting.** Summing per-muscle tonnage gives 5640 vs 3270. If any dashboard tile ever
  sums the heatmap's underlying rows, the number is 72% too high.
- **Drop sets inflate set counts.** One bench triple + a drop = 4 credited hard sets for chest from
  what the user experienced as one hard effort. Consider counting a drop set as 0.5 — but that is a
  *second* convention, so decide once and put it next to `SECONDARY_MUSCLE_CREDIT`.
- **`rir` null.** A set logged without RPE/RIR fails `rir <= 4` and silently drops out of the hard-set
  count while still contributing tonnage — so the heatmap and the volume chart disagree. Decide:
  null RIR on a `working` set **counts** as hard (recommended; the user did the work) or doesn't.
  Currently the reference implementation excludes it. **Pick one and test it.**
- **`secondaryMuscles: []`** is common in free-exercise-db, and `"shoulders"` is a single lumped
  value. Without a mapping layer the heatmap will have a permanently cold rear-delt region no
  matter what the user trains.
- `free-exercise-db` uses **camelCase** (`primaryMuscles`); the D1 schema uses snake_case. A
  mapper that reads `row.primary_muscles` from the JSON gets `undefined` → empty muscle list →
  every seeded exercise credits nothing.

### Open decision for the owner

**`SECONDARY_MUSCLE_CREDIT`: 0.5 (brief) or 1.0 (Schoenfeld 2019)?**
**(a) 0.5, as the brief says**, labelled in the UI as a convention. Makes the heatmap read the way
a lifter intuitively expects (bench lights up chest, warms triceps) and prevents "triceps" from
looking as trained as "chest" after a pressing session.
**(b) 1.0, per the only paper on the question**, which explicitly recommends `"a 1:1 basis"` until
better evidence exists.
**Recommendation: (a) 0.5, kept as one named constant in a config table, with the legend saying
"secondary muscles counted at 50%".** The heatmap's job is relative visual emphasis, not volume
prescription, and 1:1 makes every compound-heavy week look like maximal arm volume. But the owner
should know this is the app taking a position the literature declines to take — and if the
"under-trained muscle" flag ever drives real programming decisions, revisit it, because *there* the
1:1 recommendation is the defensible one.

---

## 9. Consolidated constants table

Every magic number in one place. Copy into `src/lib/calc/constants.ts` in Phase 2.

| Constant | Value | Section | Status |
|---|---|---|---|
| Epley divisor | `30` | §1 | verified |
| Brzycki numerator / offset | `36` / `37` | §1 | verified |
| `BRZYCKI_MAX_REPS` | `36` | §1 | derived (37 is a pole) |
| `MAX_REPS_FOR_E1RM` | `12` | §1 | our convention |
| `NRM[1..14]` | `100.0, 95.5, 92.2, 89.2, 86.3, 83.7, 81.1, 78.6, 76.2, 73.9, 70.7, 68.0, 65.3, 62.7` | §2 | 1–13 attested, 14 back-solved |
| `nRM(15)`, `nRM(16)` | `60.2`, `57.8` | §2 | **UNVERIFIED — do not ship** |
| `RIR = 10 − RPE` | — | §2 | verified (Zourdos 2016) |
| `RPE_INFLATION_CAP` | `1.10` | §2 | our convention (open decision) |
| Navy male density consts | `1.0324`, `0.19077`, `0.15456` | §3 | verified (cm) |
| Navy female density consts | `1.29579`, `0.35004`, `0.22100` | §3 | verified (cm) |
| Siri conversion | `495 / D − 450` | §3 | verified |
| Navy SEE | `±3–4` pp (3.5 M / 3.7 F) | §3 | verified as range; 2-dp values UNVERIFIED |
| `TREND_ALPHA` | `0.1` | §4 | verified (Hacker's Diet) |
| Trend half-life | `6.578813` d | §4 | computed |
| Trend mean lag ("9 days") | `9.000000` d | §4 | computed |
| Trend seed | `T[1] = W[1]` | §4 | verified (primary) |
| `OUTLIER_ABS_KG` | `3` | §4 | our convention, UNVERIFIED as published |
| `ENERGY_DENSITY_KCAL_PER_KG` | `7700` | §5 | verified (Wishnofsky; MacroFactor) |
| `TDEE_WINDOW_DAYS` | `28` | §5 | our convention (MacroFactor uses 30) |
| `TDEE_WARMUP_DAYS` | `21` | §5 | verified basis ("3-4 weeks") |
| `TDEE_MAX_WOW_DELTA` | `250` kcal/d | §5 | our convention |
| MSJ male / female | `+5` / `−161`, coefs `10 / 6.25 / 5` | §5 | verified |
| MSJ original combined | `9.99 / 6.25 / 4.92 / +166 / −161` | §5 | verified |
| Katch-McArdle | `370 + 21.6 × LBM` | §5 | verified |
| Activity factors `1.2…1.9` | — | §5 | **UNVERIFIED** |
| Men's bar / women's bar | `20` / `15` kg | §6 | verified (IWF) |
| IWF plate colours | 25 red, 20 blue, 15 yellow, 10 green, 5 white, 2.5 black | §6 | verified |
| Microplate denominations | user inventory | §6 | **UNVERIFIED** as an official list |
| `WARMUP_RAMP` | `40%×5, 50%×5, 60%×3` | §7 | verified as Wendler's ramp; **re-scoped to working weight is ours** |
| `HARD_SET_MAX_RIR` | `4` | §8 | our convention |
| Hypertrophy volume threshold | `>10` sets/muscle/week | §8 | verified (Schoenfeld 2017) |
| `SECONDARY_MUSCLE_CREDIT` | `0.5` | §8 | **convention; contradicts Schoenfeld 2019's 1:1** |
| `APP_TZ` | `Asia/Almaty` = UTC+5, no DST since 2024-03-01 | §8 | verified |

---

## 10. Sources

### Local files read

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

`stack-facts.md` makes **no** claims about any formula, constant, or calculation in this note, so
there is no conflict to resolve. Nothing in this note contradicts it.

### e1RM (§1)

- https://en.wikipedia.org/wiki/One-repetition_maximum — Epley, Brzycki, Lombardi, Landers,
  Mayhew, Wathen, O'Conner formulas; the r=10 identity; divergence and accuracy statements;
  primary references.
- https://www.tandfonline.com/doi/abs/10.1080/07303084.1993.10606684 — Brzycki 1993, JOPERD 64(1):88–90.
- https://paulogentil.com/pdf/Strength%20Testing%E2%80%94Predicting%20a%20One-Rep%20Max%20from%20Reps-to-Fatigue.pdf
  — **scanned image PDF, text not extractable.** This is why the "valid to 10 reps" attribution is UNVERIFIED.
- https://arxiv.org/abs/2603.17495 — Marzagão (2026), 1RM prediction on 303,494 near-failure sets:
  `"Classical equations, by applying a single conversion factor across all loads, systematically underestimate this variation"`.
  Context for why e1RM should carry a confidence caveat; **not** implemented here.

### RPE (§2)

- https://pubmed.ncbi.nlm.nih.gov/26049792/ — Zourdos et al. 2016, JSCR 30(1):267–275. `RPE-10 = 0-RIR`.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/ — Helms et al. 2016, Strength Cond J 38(4):42–49,
  doi:10.1519/SSC.0000000000000218. Open access. Table 1 is an **image**; wording UNVERIFIED.
- https://fitnessvolt.com/rpe-training/guides/tuchscherer-chart-explained/ — **the chart used**
  (reps 1–10 × RPE 10–6.5). Verified self-consistent under the RIR diagonal rule, 0 mismatches.
- https://www.1rmcalculators.com/blog/rpe-chart/ — independent confirmation of reps 1/3/5/8/10;
  its reps-10/RPE-9 = 71.5 disagrees with the self-consistent 70.7.
- https://fitnesscalcs.com/rpe-percentage-calculator/ — **do NOT use**; linearised 2.5%/step chart.
- https://store.reactivetrainingsystems.com/blogs/advanced-concepts/customizing-your-rpe-chart —
  RTS's own page; charts are images. `"Mike himself will tell you that you must work to develop this chart for yourself"`.
- https://bonvecstrength.com/2020/06/24/choosing-the-weight-on-the-bar-percentage-rpe-and-rir-part-1/ — attribution.

### Body fat (§3)

- https://www.calculator.net/body-fat-calculator.html — **both** metric and imperial Navy forms, verbatim.
- https://www.omnicalculator.com/health/navy-body-fat — independent confirmation of the metric constants.
- https://med.libretexts.org/Courses/Irvine_Valley_College/Physiology_Labs_at_Home/03:_Anthropometrics/3.02:_Part_B-_Circumference_Measures/3.2.04:_Part_B4-_The_U.S._Navy_body_fat_estimation_formula
  — imperial form, explicit "Units: Inches", "Log Base: Base 10".
- https://www.sciepub.com/reference/307403 — Hodgdon JA, Beckett MB, NHRC Report 84-11 (1984).
- https://www.medicalalgorithms.com/equations-of-hodgdon-and-beckett-for-predicting-body-density-and-percent-body-fat-in-adults-us-navy-equations — SEE 3.5% M / 3.7% F, r≈0.90.
- https://nap.nationalacademies.org/read/6104/chapter/4 — **redirect not followed; not retrieved.**

### EMA (§4)

- https://www.fourmilab.ch/hackdiet/e4/pencilpaper.html — **primary.** The 10% rule verbatim, the
  seed rule verbatim, and the verified silence on missing days.
- https://www.fourmilab.ch/hackdiet/e4/signalnoise.html — smoothing-constant discussion.
- https://en.wikipedia.org/wiki/Exponential_smoothing — recurrence, α definition, τ, `α = 2/(k+1)`, `s₀ = x₀`.
- https://www.shortform.com/blog/ewma-formula/ — `Tn = Tn−1 + 0.1(Wn − Tn−1)` restated.

### Adaptive TDEE (§5)

- https://macrofactor.com/algorithm-accuracy/ — **7700 kcal/kg**, day-3 first estimate, 3–4 week
  warm-up, rolling 30-day, partial-logging rule, ~110 kcal/d median error.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC4035446/ (via https://www.jandonline.org/article/S2212-2672(14)00111-7/abstract)
  — Wishnofsky's rule stated as 3500 kcal/lb = 7700 kcal/kg, plus its limitations.
- https://www.sciencedirect.com/science/article/abs/pii/S0026049511003945 — Thomas et al.,
  measured energy content of weight change `4858±388 kcal/kg` at week 4. **Read via search
  snippet only — exact figure UNVERIFIED.**
- https://www.researchgate.net/publication/239943510_Why_is_the_3500_kcal_per_pound_weight_loss_rule_wrong — Hall's critique.
- https://mifflinstjeor.com/mifflin-st-jeor-equation/ — combined and split MSJ forms verbatim, R²=0.71, full citation.
- https://ajcn.nutrition.org/article/S0002-9165(23)16698-6/fulltext — Mifflin 1990 primary; **HTTP 403, not retrieved.**
- https://www.omnicalculator.com/health/bmr-katch-mcardle — Katch-McArdle `370 + 21.6 × LBM`.
- https://med.libretexts.org/Courses/Irvine_Valley_College/Physiology_Labs_at_Home/04:_Metabolism_and_Calorie_Burn/4.02:_Part_B._Calculating_RMR_based_off_of_Lean_Body_Mass_(LBM) — LBM-based RMR.

### Plates and warm-ups (§6, §7)

- https://iwf.sport/weightlifting_/equipment/ — **HTTP 403, not retrieved.** Hence microplates UNVERIFIED.
- https://eleiko.com/en/equipment/plates/weightlifting/3085231-25-eleiko-iwf-weightlifting-competition-plate-25-kg — IWF 25 kg plate.
- https://theworkoutmag.com/learn/bench-press-bar-weights-ipf-standards — 20 kg men's / 15 kg women's bar.
- https://thefitness.wiki/routines/5-3-1-for-beginners/ — `"5 reps @ 40%"`, `"5 reps @ 50%"`,
  `"3 reps @ 60%"`, Training Max = 90% of estimated 1RM, `"All percentages reference your Training Max"`.
- https://liftvault.com/resources/531-calculator/ — independent confirmation of the ramp.

### Volume (§8)

- https://pubmed.ncbi.nlm.nih.gov/27433992/ — Schoenfeld, Ogborn, Krieger 2017,
  *J Sports Sci* 35(11):1073–1082, doi:10.1080/02640414.2016.1210197. **Cookie-walled; abstract
  read via search.** Binning and effect sizes UNVERIFIED.
- https://pmc.ncbi.nlm.nih.gov/articles/PMC6681288/ — Schoenfeld, Grgic, Haun, Itagaki, Helms 2019,
  *Sports* 7(7):177, doi:10.3390/sports7070177. **The `"1:1 basis"` recommendation, verbatim.**
- https://rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth — MEV/MAV/MRV; RP's
  practice of folding indirect volume into the target rather than weighting it.
- https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json — **verified
  field names** (`primaryMuscles`, `secondaryMuscles`, `mechanic`, …) and observed muscle values.
- https://en.wikipedia.org/wiki/Time_in_Kazakhstan — UTC+5 since 2024-03-01, previously UTC+5/+6.
- https://github.com/moment/moment-timezone/issues/1091 — `Asia/Almaty` and `Asia/Qostanay` moved
  from UTC+6; older software may still report the old offset.
- https://astanatimes.com/2024/01/kazakhstan-switches-to-utc05-00-time-zone-from-march-1/ — the change itself.

### Reproducibility

Every numeric value in this note was recomputed by script. The scripts live in the session
scratchpad (`calc1.py` … `calc6.py`) at
`C:/Users/tairc/AppData/Local/Temp/claude/C--Users-tairc-Documents-codespace-fitness-app-tair/85fb1989-5a8f-448f-9e9a-162342b812b6/scratchpad/`
and are **not** part of the project. They are disposable; the tables above are the artifact.

---

## CORRECTION (added 2026-09-13, after implementation)

Two items in this note were found to be wrong while implementing `src/lib/calc`. They are
recorded here because this file is used as the numeric oracle for the unit tests.

### 1. "Epley(w,10) === Brzycki(w,10) exactly" is FALSE in IEEE-754

§1 proposes as a property test that, since both formulas are algebraically `4w/3`, they are
exactly equal at 10 reps. They are not: the two expressions evaluate in different orders
(`w*(1+10/30)` vs `(w*36)/27`) and the rounding differs. Independently reproduced:

| w (kg) | Epley | Brzycki | equal? |
|---|---|---|---|
| 0.5 | 0.66666666666666662966 | 0.66666666666666662966 | yes |
| 2.5 | 3.3333333333333330373 | 3.3333333333333334814 | **no** |
| 20 | 26.666666666666664298 | 26.666666666666667851 | **no** |
| 60 | 80 | 80 | yes |
| **100** | 133.33333333333331439 | 133.33333333333334281 | **no** |
| 140 | 186.66666666666665719 | 186.66666666666665719 | yes |

20 kg and 100 kg are among the most common loads in a gym, so this is not a corner case. A raw
`>` comparison in `bestE1rm` makes it report `'brzycki'` as the winning source at exactly 10
reps, contradicting spec 07's expected `'epley'`.

**Resolution:** comparisons use the exported `WEIGHT_EPSILON_KG` helper, and the test asserts
`toBeCloseTo(4/3 * w, 10)` rather than `===`. Never compare two computed weights with `===`.

### 2. The suggested `roundHalfUp1` technique is unreliable

§4 suggests `Math.round(x * 10 + Number.EPSILON * 10) / 10`. `Number.EPSILON` is the ulp at
magnitude 1; at magnitude ~938 one ulp is ≈1.1e-13, so a 2.2e-15 nudge cannot cross a rounding
boundary. It appears to work for this note's vectors only because 93.85 / 79.85 / 69.35 already
scale to exactly 938.5 / 798.5 / 693.5. The implementation re-normalises with `toPrecision(15)`
instead. The *numbers* in §4 are correct; only the suggested technique is not.

### 3. Confirmed correct

Everything else reproduced exactly: all e1RM and R1–R6 vectors, the nRM column and published
RPE grid, M1/M2/F1/F2 to 4 dp, the 10-day trend series to 6 dp, the gap-aware 81.974133, TDEE
weeks 1–4, all plate vectors including the exact 99–105 lattice, W1/W2, the full volume week,
and the window bounds 1788721200000 / 1789325999999.

### 4. A bug this note's §8 warning caught

`endOfLocalDayMs` cannot be `startOfLocalDay + 24h`. Asia/Almaty moved its clock **backward** an
hour at `2024-02-29T18:00Z`, so local 2024-02-29 is **25 hours** long and a rolling-7-day window
spanning 2024-02-24…2024-03-01 is 167 hours, not 168. The offset must always be resolved through
`Intl.DateTimeFormat` with an explicit `timeZone`, never by arithmetic on a hardcoded `+05:00`.
This only ever surfaces on imported pre-2024 history.
