import type messages from "../../messages/ru.json";
import type { formats } from "@/i18n/formats";
import type { LOCALES } from "@/i18n/config";

/**
 * Makes a missing or misspelled message key a `tsc` error instead of a raw key string
 * rendered mid-set in the gym. RU is the source of truth for the key shape.
 */
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof messages;
    Formats: typeof formats;
  }
}
