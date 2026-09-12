import { describe, expect, it } from "vitest";

import {
  emaStep,
  OUTLIER_ABS_KG,
  TREND_ALPHA,
  TREND_HALF_LIFE_DAYS,
  TREND_MEAN_LAG_DAYS,
  trendWeight,
  type WeightReading,
} from "@/lib/calc";

import {
  TREND_AFTER_ONE_MISSED_DAY_KG,
  TREND_DATES,
  TREND_EXPECTED_KG,
  TREND_LAG_VS_MEAN_KG,
  TREND_SERIES_KG,
  TREND_SERIES_MEAN_KG,
  TREND_SKIP_MISSING_KG,
} from "./fixtures/r09-vectors";

/** The r09 10-day series as consecutive daily readings. */
const SERIES: WeightReading[] = TREND_SERIES_KG.map((kg, i) => ({
  localDate: TREND_DATES[i] as string,
  kg,
}));

describe("emaStep", () => {
  it("is the correction form, T + alpha * (W - T)", () => {
    expect(emaStep(82.0, 82.6, 0.1)).toBeCloseTo(82.06, 6);
  });

  it("does not move the trend at alpha 0, and snaps to the reading at alpha 1", () => {
    expect(emaStep(82.0, 90.0, 0)).toBe(82.0);
    expect(emaStep(82.0, 90.0, 1)).toBe(90.0);
  });

  it.each([
    ["alpha above 1", 82.0, 82.6, 1.5],
    ["negative alpha", 82.0, 82.6, -0.1],
    ["NaN alpha", 82.0, 82.6, Number.NaN],
    ["NaN trend", Number.NaN, 82.6, 0.1],
    ["Infinite reading", 82.0, Number.POSITIVE_INFINITY, 0.1],
  ])("rejects %s", (_label, prev, reading, alpha) => {
    expect(emaStep(prev, reading, alpha)).toBeNull();
  });
});

describe("trend constants", () => {
  it("keeps the half-life and the mean lag separate", () => {
    // The famous "9 days" is the mean lag -- the average age of the data -- not the half-life. No UI
    // string may conflate them.
    expect(TREND_ALPHA).toBe(0.1);
    expect(TREND_HALF_LIFE_DAYS).toBeCloseTo(6.578813, 6);
    expect(TREND_HALF_LIFE_DAYS).toBeCloseTo(Math.log(0.5) / Math.log(1 - TREND_ALPHA), 5);
    expect(TREND_MEAN_LAG_DAYS).toBe(9);
    expect(TREND_MEAN_LAG_DAYS).toBeCloseTo((1 - TREND_ALPHA) / TREND_ALPHA, 10);
  });
});

describe("trendWeight", () => {
  it("reproduces the r09 10-day series to 6 dp", () => {
    const points = trendWeight(SERIES);
    expect(points).not.toBeNull();
    expect(points).toHaveLength(10);
    (points as NonNullable<typeof points>).forEach((p, i) => {
      expect(p.trendKg).toBeCloseTo(TREND_EXPECTED_KG[i] as number, 6);
      expect(p.kg).toBe(TREND_SERIES_KG[i]);
      expect(p.excluded).toBe(false);
      expect(p.localDate).toBe(TREND_DATES[i]);
    });
  });

  it("seeds T[0] = W[0] exactly", () => {
    // A zero seed makes the trend crawl up from nothing for about 40 days, displaying a fake 80 kg
    // gain. This is the assertion that catches it.
    const points = trendWeight(SERIES);
    expect(points?.[0]?.trendKg).toBe(82.0);
  });

  it("lags a falling series, which is the point of a trend rather than a bug", () => {
    const points = trendWeight(SERIES);
    const last = points?.[9]?.trendKg as number;
    expect(last - TREND_SERIES_MEAN_KG).toBeCloseTo(TREND_LAG_VS_MEAN_KG, 6);
    expect(last).toBeGreaterThan(TREND_SERIES_MEAN_KG - 0.2);
  });

  it("returns one point for a single reading, and [] for none", () => {
    const single = trendWeight([{ localDate: "2026-09-07", kg: 82.0 }]);
    expect(single).toEqual([{ localDate: "2026-09-07", kg: 82.0, trendKg: 82.0, excluded: false }]);
    expect(trendWeight([])).toEqual([]);
  });

  it("widens alpha after a missed day (policy b), and is NOT skip-missing", () => {
    // After one missed day alphaEff is 1 - 0.9^2 = 0.19, so the trend catches up instead of crawling
    // 10% of the way. The two policies differ by 0.064 kg after a *single* gap and compound from
    // there; a three-week holiday must not leave the trend anchored to pre-holiday weight.
    const withGap: WeightReading[] = [...SERIES, { localDate: "2026-09-18", kg: 81.4 }];
    const points = trendWeight(withGap);
    const last = points?.[10]?.trendKg as number;
    expect(last).toBeCloseTo(TREND_AFTER_ONE_MISSED_DAY_KG, 6);
    expect(last).not.toBeCloseTo(TREND_SKIP_MISSING_KG, 4);
  });

  it("flags an outlier without moving the trend, and resumes from the un-moved value", () => {
    const points = trendWeight([
      { localDate: "2026-09-07", kg: 82.1 },
      { localDate: "2026-09-08", kg: 90.0 },
      { localDate: "2026-09-09", kg: 82.0 },
    ]);
    expect(points?.[1]?.excluded).toBe(true);
    expect(points?.[1]?.kg).toBe(90.0);
    // The raw reading stays visible; only its influence is withheld.
    expect(points?.[1]?.trendKg).toBe(82.1);
    expect(points?.[2]?.excluded).toBe(false);
    expect(points?.[2]?.trendKg).toBeCloseTo(82.09, 6);
  });

  it("advances the gap clock across an excluded point so the next gap is not doubled", () => {
    // If an excluded reading did not advance the clock, the following day would be treated as a
    // two-day gap and would get alphaEff 0.19 instead of 0.1.
    const points = trendWeight([
      { localDate: "2026-09-07", kg: 82.1 },
      { localDate: "2026-09-08", kg: 90.0 },
      { localDate: "2026-09-09", kg: 82.0 },
    ]);
    expect(points?.[2]?.trendKg).toBeCloseTo(82.1 + 0.1 * (82.0 - 82.1), 9);
  });

  it("treats exactly OUTLIER_ABS_KG as inside the band", () => {
    const points = trendWeight([
      { localDate: "2026-09-07", kg: 82.0 },
      { localDate: "2026-09-08", kg: 82.0 + OUTLIER_ABS_KG },
    ]);
    expect(points?.[1]?.excluded).toBe(false);
  });

  it.each([
    [
      "descending dates",
      [
        { localDate: "2026-09-09", kg: 82.0 },
        { localDate: "2026-09-07", kg: 82.2 },
      ],
    ],
    [
      "two readings on one local date",
      [
        { localDate: "2026-09-07", kg: 82.0 },
        { localDate: "2026-09-07", kg: 82.2 },
      ],
    ],
    ["a malformed date", [{ localDate: "2026-9-7", kg: 82.0 }]],
    ["an impossible date", [{ localDate: "2026-02-30", kg: 82.0 }]],
  ])("rejects %s rather than producing a wrong answer", (_label, readings) => {
    // An EMA is order- and prefix-dependent, so silently accepting a mis-ordered series produces
    // trend values that look reasonable and are not reproducible.
    expect(trendWeight(readings)).toBeNull();
  });

  it("drops unusable readings without disturbing the rest", () => {
    const withJunk: WeightReading[] = [
      { localDate: "2026-09-05", kg: Number.NaN },
      { localDate: "2026-09-06", kg: 0 },
      ...SERIES,
    ];
    const points = trendWeight(withJunk);
    expect(points).toHaveLength(10);
    (points as NonNullable<typeof points>).forEach((p, i) => {
      expect(p.trendKg).toBeCloseTo(TREND_EXPECTED_KG[i] as number, 6);
    });
  });

  it("never emits a point whose trend is not a real number", () => {
    const points = trendWeight(SERIES);
    for (const p of points as NonNullable<typeof points>) {
      expect(Number.isFinite(p.trendKg)).toBe(true);
    }
  });
});
