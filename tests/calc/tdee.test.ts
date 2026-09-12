import { describe, expect, it } from "vitest";

import {
  adaptiveTdee,
  applyActivityFactor,
  ENERGY_DENSITY_KCAL_PER_KG,
  katchMcArdle,
  mifflinStJeor,
  mifflinStJeorCombined,
  TDEE_MAX_WOW_DELTA,
  TDEE_MIN_INTAKE_DAYS,
  TDEE_MIN_WEIGH_INS,
  TDEE_WARMUP_DAYS,
  tdeeFromEnergyBalance,
  type TdeeInput,
} from "@/lib/calc";

import {
  KATCH_M1_BODY,
  M1_BODY,
  MSJ_COMBINED_MALE_82_178_30,
  MSJ_FEMALE_65_165_30,
  MSJ_MALE_82_178_30,
  MSJ_SPLIT_VS_COMBINED_DELTA,
  NOW_MS,
  PRIOR_KATCH_X155,
  PRIOR_MSJ_X155,
  TDEE_TREND_START_KG,
  TDEE_WEEK4,
  TDEE_WEEKS,
} from "./fixtures/r09-vectors";

/** A fully-passing input, so each test can vary exactly the field it is about. */
function anInput(over: Partial<TdeeInput> = {}): TdeeInput {
  return {
    nowMs: NOW_MS,
    priorKcal: PRIOR_MSJ_X155,
    meanIntakeKcal: 2450,
    completeDays: 28,
    weighInsInWindow: 24,
    trendStartKg: TDEE_TREND_START_KG,
    trendEndKg: 81.5,
    lastEstimateKcal: null,
    bodyWeightKg: null,
    ...over,
  };
}

describe("mifflinStJeor -- the split form the app ships", () => {
  it("is 1787.5 for the worked male body and 1370.25 for the female one", () => {
    expect(mifflinStJeor("male", 82, 178, 30)).toBe(MSJ_MALE_82_178_30);
    expect(mifflinStJeor("female", 65, 165, 30)).toBe(MSJ_FEMALE_65_165_30);
  });

  it.each([
    ["age 0", 82, 178, 0],
    ["age 130", 82, 178, 130],
    ["zero height", 82, 0, 30],
    ["zero weight", 0, 178, 30],
    ["negative weight", -82, 178, 30],
    ["a NaN age", 82, 178, Number.NaN],
  ])("is null for %s", (_label, kg, cm, age) => {
    expect(mifflinStJeor("male", kg, cm, age)).toBeNull();
    expect(mifflinStJeorCombined("male", kg, cm, age)).toBeNull();
  });
});

describe("mifflinStJeorCombined -- the 1990 original", () => {
  it("differs from the split form by 1.58 kcal/day", () => {
    // The two forms are not the same equation, and this assertion is the only thing standing between
    // a future reader and "simplifying" one into the other.
    expect(mifflinStJeorCombined("male", 82, 178, 30)).toBeCloseTo(MSJ_COMBINED_MALE_82_178_30, 4);
    const delta =
      (mifflinStJeorCombined("male", 82, 178, 30) ?? 0) - (mifflinStJeor("male", 82, 178, 30) ?? 0);
    expect(delta).toBeCloseTo(MSJ_SPLIT_VS_COMBINED_DELTA, 4);
  });

  it("drops the sex term entirely for a female, rather than negating it", () => {
    expect(mifflinStJeorCombined("female", 65, 165, 30)).toBeCloseTo(
      9.99 * 65 + 6.25 * 165 - 4.92 * 30 - 161,
      6,
    );
  });
});

describe("katchMcArdle", () => {
  it("is 370 + 21.6 x LBM on M1's body, not Cunningham", () => {
    expect(katchMcArdle(M1_BODY.weightKg, M1_BODY.bodyFatPct)).toBeCloseTo(KATCH_M1_BODY, 6);
    expect(katchMcArdle(M1_BODY.weightKg, M1_BODY.bodyFatPct)).not.toBeCloseTo(
      500 + 22 * M1_BODY.leanMassKg,
      1,
    );
  });

  it("is null until a body-fat measurement exists, which is why MSJ is the default prior", () => {
    expect(katchMcArdle(82, 100)).toBeNull();
    expect(katchMcArdle(82, Number.NaN)).toBeNull();
    expect(katchMcArdle(0, 20)).toBeNull();
  });
});

describe("applyActivityFactor", () => {
  it("produces both priors from the worked example", () => {
    expect(applyActivityFactor(MSJ_MALE_82_178_30, 1.55)).toBeCloseTo(PRIOR_MSJ_X155, 6);
    expect(applyActivityFactor(KATCH_M1_BODY, 1.55)).toBeCloseTo(PRIOR_KATCH_X155, 5);
  });

  it("shows why the prior is only a prior: the two disagree by about 97 kcal/day", () => {
    expect(PRIOR_KATCH_X155 - PRIOR_MSJ_X155).toBeCloseTo(97.0076, 3);
  });

  it.each([
    ["a factor below 1.0", 1787.5, 0.5],
    ["a factor above 2.5", 1787.5, 3],
    ["a NaN factor", 1787.5, Number.NaN],
    ["a zero RMR", 0, 1.55],
  ])("is null for %s", (_label, rmr, factor) => {
    expect(applyActivityFactor(rmr, factor)).toBeNull();
  });
});

describe("tdeeFromEnergyBalance", () => {
  it("the week-4 vector, and the sign that makes it right", () => {
    // `+` instead of `-` gives 2202.5: a 495 kcal/day error that makes the user lose weight twice as
    // fast as intended, from a number that looks entirely plausible.
    const actual = tdeeFromEnergyBalance(
      TDEE_WEEK4.meanIntakeKcal,
      TDEE_WEEK4.trendStartKg,
      TDEE_WEEK4.trendEndKg,
      TDEE_WEEK4.days,
    );
    expect(actual).toBeCloseTo(TDEE_WEEK4.expectedKcal, 6);
    expect(actual).not.toBeCloseTo(TDEE_WEEK4.signBugKcal, 0);
    // The double is 2697.5000000000014, so this must never be a `toBe`.
    expect(actual).not.toBe(TDEE_WEEK4.expectedKcal);
  });

  it("weight gain lowers the estimate below intake", () => {
    expect(tdeeFromEnergyBalance(3000, 80.0, 80.7, 28)).toBeCloseTo(2807.5, 6);
  });

  it("never divides by zero days", () => {
    // Infinity here would be persisted and would poison every later week-over-week cap.
    expect(tdeeFromEnergyBalance(2450, 82.4, 81.5, 0)).toBeNull();
    expect(tdeeFromEnergyBalance(2450, 82.4, 81.5, -7)).toBeNull();
  });

  it.each([
    ["a NaN intake", Number.NaN, 82.4, 81.5],
    ["a zero start weight", 2450, 0, 81.5],
    ["a negative end weight", 2450, 82.4, -81.5],
  ])("is null for %s", (_label, intake, start, end) => {
    expect(tdeeFromEnergyBalance(intake, start, end, 28)).toBeNull();
  });

  it("uses 7700 kcal/kg", () => {
    expect(ENERGY_DENSITY_KCAL_PER_KG).toBe(7700);
  });
});

describe("adaptiveTdee -- the 4-week worked example", () => {
  it.each(TDEE_WEEKS)(
    "%s",
    (_label, meanIntakeKcal, trendEndKg, completeDays, data, blended, blendWeight, status) => {
      const actual = adaptiveTdee(
        anInput({ meanIntakeKcal, trendEndKg, completeDays, weighInsInWindow: completeDays }),
      );

      if (completeDays < TDEE_MIN_INTAKE_DAYS) {
        // r09's worked table shows week 1 (7 complete days) blending to 2730.4688, but both r09's own
        // algorithm step 3 and spec 07 rule 27 say fewer than 14 complete days shows the prior only.
        // The guard wins; the week-1 blend arithmetic is asserted separately below. See the report.
        expect(actual.status).toBe("INSUFFICIENT_INTAKE_DAYS");
        expect(actual.tdeeKcal).toBe(PRIOR_MSJ_X155);
        return;
      }

      expect(actual.tdeeDataKcal).toBeCloseTo(data, 6);
      expect(actual.blendWeight).toBe(blendWeight);
      expect(actual.tdeeKcal).toBeCloseTo(blended, 4);
      expect(actual.status).toBe(status);
      expect(actual.capped).toBe(false);
      expect(actual.priorKcal).toBe(PRIOR_MSJ_X155);
      expect(actual.completeDays).toBe(completeDays);
    },
  );

  it("week 1's blend arithmetic is still correct, it is just gated", () => {
    // 0.25 x 2610 + 0.75 x 2770.625 = 2730.4688, exactly as r09 computes it.
    const week1 = TDEE_WEEKS[0];
    const data = tdeeFromEnergyBalance(week1[1], TDEE_TREND_START_KG, week1[2], week1[3]);
    expect(data).toBeCloseTo(week1[4], 6);
    expect(week1[6] * (data as number) + (1 - week1[6]) * PRIOR_MSJ_X155).toBeCloseTo(week1[5], 4);
  });

  it("blends away from the prior as data accumulates", () => {
    const weights = TDEE_WEEKS.map(
      (w) => adaptiveTdee(anInput({ completeDays: w[3], weighInsInWindow: w[3] })).blendWeight,
    );
    expect(weights[3]).toBe(1);
    expect(weights[2]).toBeLessThan(weights[3] as number);
  });
});

describe("adaptiveTdee -- the week-over-week cap", () => {
  it("caps a jump upward", () => {
    const actual = adaptiveTdee(
      anInput({
        meanIntakeKcal: 3000,
        trendStartKg: 82.0,
        trendEndKg: 82.0,
        lastEstimateKcal: 2700,
      }),
    );
    expect(actual.tdeeDataKcal).toBe(3000);
    expect(actual.tdeeKcal).toBe(2950);
    expect(actual.capped).toBe(true);
  });

  it("caps a drop downward", () => {
    const actual = adaptiveTdee(
      anInput({
        meanIntakeKcal: 2300,
        trendStartKg: 82.0,
        trendEndKg: 82.0,
        lastEstimateKcal: 2700,
      }),
    );
    expect(actual.tdeeKcal).toBe(2450);
    expect(actual.capped).toBe(true);
  });

  it("leaves an in-range move alone", () => {
    const actual = adaptiveTdee(anInput({ lastEstimateKcal: 2700 }));
    expect(actual.capped).toBe(false);
    expect(actual.tdeeKcal).toBeCloseTo(2697.5, 4);
  });

  it("is a flat kcal cap, not a percentage", () => {
    // Logging noise is absolute -- a missed meal is about 600 kcal regardless of body size.
    expect(TDEE_MAX_WOW_DELTA).toBe(250);
    const low = adaptiveTdee(
      anInput({ meanIntakeKcal: 3000, trendStartKg: 82, trendEndKg: 82, lastEstimateKcal: 1500 }),
    );
    expect((low.tdeeKcal ?? 0) - 1500).toBe(TDEE_MAX_WOW_DELTA);
  });
});

describe("adaptiveTdee -- the guard ladder", () => {
  it("NO_PRIOR: nothing to show and nothing to blend toward", () => {
    const actual = adaptiveTdee(anInput({ priorKcal: null, completeDays: 0 }));
    expect(actual.status).toBe("NO_PRIOR");
    expect(actual.tdeeKcal).toBeNull();
    expect(actual.tdeeDataKcal).toBeNull();
    expect(actual.blendWeight).toBe(0);
  });

  it("INSUFFICIENT_INTAKE_DAYS one day below the floor, and not at it", () => {
    const below = adaptiveTdee(anInput({ completeDays: TDEE_MIN_INTAKE_DAYS - 1 }));
    expect(below.status).toBe("INSUFFICIENT_INTAKE_DAYS");
    expect(below.tdeeKcal).toBe(PRIOR_MSJ_X155);
    expect(adaptiveTdee(anInput({ completeDays: TDEE_MIN_INTAKE_DAYS })).status).not.toBe(
      "INSUFFICIENT_INTAKE_DAYS",
    );
  });

  it("INSUFFICIENT_WEIGH_INS below the weigh-in floor", () => {
    const actual = adaptiveTdee(anInput({ weighInsInWindow: TDEE_MIN_WEIGH_INS - 1 }));
    expect(actual.status).toBe("INSUFFICIENT_WEIGH_INS");
    expect(actual.tdeeKcal).toBe(PRIOR_MSJ_X155);
  });

  it.each([
    ["a missing trend start", { trendStartKg: null }],
    ["a missing trend end", { trendEndKg: null }],
    ["a missing mean intake", { meanIntakeKcal: null }],
    ["a NaN trend end", { trendEndKg: Number.NaN }],
    ["a zero trend end", { trendEndKg: 0 }],
  ])("INSUFFICIENT_WEIGH_INS for %s", (_label, over) => {
    const actual = adaptiveTdee(anInput(over));
    expect(actual.status).toBe("INSUFFICIENT_WEIGH_INS");
    expect(actual.tdeeKcal).toBe(PRIOR_MSJ_X155);
    expect(actual.tdeeDataKcal).toBeNull();
  });

  it("never divides by zero complete days", () => {
    const actual = adaptiveTdee(anInput({ completeDays: 0 }));
    expect(actual.tdeeDataKcal).toBeNull();
    expect(Number.isFinite(actual.tdeeKcal)).toBe(true);
  });

  it("treats a nonsense count as none logged rather than propagating it", () => {
    for (const completeDays of [Number.NaN, -5, 13.5]) {
      const actual = adaptiveTdee(anInput({ completeDays }));
      expect(actual.completeDays).toBe(0);
      expect(actual.status).toBe("INSUFFICIENT_INTAKE_DAYS");
    }
  });

  it("folds a non-finite prior into no prior at all", () => {
    const actual = adaptiveTdee(anInput({ priorKcal: Number.NaN, completeDays: 0 }));
    expect(actual.status).toBe("NO_PRIOR");
    expect(actual.priorKcal).toBeNull();
  });

  it("stands the data estimate alone when there is no prior but enough data", () => {
    // The ladder only withholds a prior-less estimate below the 14-day floor; above it, blending
    // toward a prior that does not exist would produce NaN, so the weight goes to 1.
    const actual = adaptiveTdee(
      anInput({ priorKcal: null, completeDays: 20, weighInsInWindow: 20 }),
    );
    expect(actual.blendWeight).toBe(1);
    expect(actual.tdeeKcal).toBe(actual.tdeeDataKcal);
    expect(Number.isFinite(actual.tdeeKcal)).toBe(true);
  });
});

describe("adaptiveTdee -- statuses", () => {
  it("CALIBRATING below the 21-day warm-up, OK at it", () => {
    // 7700 kcal/kg overestimates early tissue energy density, so the first three weeks are labelled.
    expect(
      adaptiveTdee(anInput({ completeDays: TDEE_WARMUP_DAYS - 1, weighInsInWindow: 20 })).status,
    ).toBe("CALIBRATING");
    expect(
      adaptiveTdee(anInput({ completeDays: TDEE_WARMUP_DAYS, weighInsInWindow: 21 })).status,
    ).toBe("OK");
  });

  it("SUSPECT_WEIGHT_CHANGE still returns a number -- it is a badge, not a block", () => {
    const actual = adaptiveTdee(
      anInput({ trendStartKg: 82.4, trendEndKg: 81.2, bodyWeightKg: 82 }),
    );
    expect(actual.status).toBe("SUSPECT_WEIGHT_CHANGE");
    expect(actual.tdeeKcal).not.toBeNull();
    expect(Number.isFinite(actual.tdeeKcal)).toBe(true);
  });

  it("cannot evaluate the suspect badge without a bodyweight", () => {
    // The r09 worked example never states a window bodyweight. Supplying 82 would flag week 4 too
    // (|delta| 0.9 > 0.82), which contradicts spec 07's expected OK for that week -- see the report.
    const withWeight = adaptiveTdee(anInput({ bodyWeightKg: 82 }));
    const without = adaptiveTdee(anInput({ bodyWeightKg: null }));
    expect(withWeight.status).toBe("SUSPECT_WEIGHT_CHANGE");
    expect(without.status).toBe("OK");
    expect(withWeight.tdeeKcal).toBe(without.tdeeKcal);
  });

  it("CALIBRATING takes precedence over the suspect badge", () => {
    const actual = adaptiveTdee(
      anInput({ completeDays: 14, weighInsInWindow: 14, trendEndKg: 81.2, bodyWeightKg: 82 }),
    );
    expect(actual.status).toBe("CALIBRATING");
  });

  it("does not flag a change inside 1% of bodyweight", () => {
    const actual = adaptiveTdee(anInput({ trendEndKg: 81.7, bodyWeightKg: 82 }));
    expect(actual.status).toBe("OK");
  });
});

describe("adaptiveTdee never returns NaN or Infinity", () => {
  it.each([
    [
      "everything null",
      { priorKcal: null, meanIntakeKcal: null, trendStartKg: null, trendEndKg: null },
    ],
    ["every count zero", { completeDays: 0, weighInsInWindow: 0 }],
    ["a huge intake", { meanIntakeKcal: 1e308 }],
    ["a non-finite last estimate", { lastEstimateKcal: Number.POSITIVE_INFINITY }],
    ["a non-finite anchor", { nowMs: Number.NaN }],
  ])("%s", (_label, over) => {
    const actual = adaptiveTdee(anInput(over));
    expect(actual.tdeeKcal === null || Number.isFinite(actual.tdeeKcal)).toBe(true);
    expect(actual.tdeeDataKcal === null || Number.isFinite(actual.tdeeDataKcal)).toBe(true);
    expect(Number.isFinite(actual.blendWeight)).toBe(true);
  });
});
