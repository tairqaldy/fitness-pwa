/**
 * App-facing time facade.
 *
 * This file deliberately contains NO logic. The calendar arithmetic lives in
 * `src/lib/calc/time.ts`, which is pure, clock-free and covered at 100%. An earlier version of
 * this module reimplemented day-key arithmetic independently, which is exactly the
 * "same concept modelled twice" drift that produces off-by-one-day streak bugs: the calc
 * implementation resolves the UTC offset through the IANA database and therefore gets
 * Asia/Almaty's pre-2024 UTC+6 era right, while a hand-rolled `+5` does not.
 *
 * Import from here in app code (routes, components, i18n) so there is one canonical name for
 * the timezone; import from `@/lib/calc` inside the calculation layer.
 */
export { APP_TZ as APP_TIME_ZONE } from "@/lib/calc/constants";

export {
  diffDays,
  endOfLocalDayMs,
  localDateFromInstant,
  rolling7dWindow,
  startOfLocalDayMs,
} from "@/lib/calc/time";

/** `'YYYY-MM-DD'` in the app timezone. Stored at write time, never re-derived at read time. */
export type { LocalDate } from "@/lib/calc/types";
