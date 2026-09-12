import type { Formats } from "next-intl";

/**
 * Global format definitions, so units are written once instead of at every call site.
 * `::unit/kilogram` style skeletons are handled by intl-messageformat over the native Intl.
 */
export const formats = {
  dateTime: {
    short: { day: "numeric", month: "short" },
    long: { day: "numeric", month: "long", year: "numeric" },
    weekday: { weekday: "long" },
  },
  number: {
    kg: { style: "unit", unit: "kilogram", maximumFractionDigits: 2 },
    kcal: { maximumFractionDigits: 0 },
    percent: { style: "percent", maximumFractionDigits: 0 },
  },
} satisfies Formats;
