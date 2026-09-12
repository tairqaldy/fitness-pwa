import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import { APP_TIME_ZONE } from "@/lib/time";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "./config";
import { formats } from "./formats";

/**
 * The ONE place locale, timezone and formats are resolved. Auto-discovered by the next-intl
 * plugin. Pinning `timeZone` here governs every date format in the app, server and client,
 * because NextIntlClientProvider inherits it — the runtime default would be UTC.
 */
export default getRequestConfig(async () => {
  // `cookies()` is async in Next 16; the sync form was removed.
  const candidate = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(candidate) ? candidate : DEFAULT_LOCALE;

  return {
    locale,
    timeZone: APP_TIME_ZONE,
    formats,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
