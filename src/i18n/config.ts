/** Supported locales. Russian is the default and the source of truth for message keys. */
export const LOCALES = ["ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";

/**
 * Locale lives in a cookie, not a URL segment. A `[locale]` route segment would force
 * proxy.ts (whose OpenNext support is experimental), double the Serwist precache manifest, and
 * make a single PWA `start_url` impossible without a cold-start redirect.
 * Not HttpOnly: the client may need to read it.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as readonly string[]).includes(value);
}
