import type { Metadata } from "next";

import ru from "../../../messages/ru.json";

/**
 * Offline fallback shell.
 *
 * MUST be statically prerendered: it is precached at build time and served by the service
 * worker when a navigation cannot reach the network. If it were dynamic there would be no HTML
 * to precache and the fallback would silently do nothing.
 *
 * That is why it does NOT use `getTranslations()` — reading the locale cookie would opt the
 * route into dynamic rendering. It imports the default-locale (RU) messages directly instead.
 * The trade-off is deliberate: an EN user sees this one rarely-shown screen in Russian, which
 * is far better than losing the offline fallback entirely.
 *
 * The tone is matter-of-fact rather than apologetic: losing signal in a basement gym is the
 * expected case, not an error, and logging keeps working offline.
 */
export const dynamic = "force-static";

export const metadata: Metadata = { title: ru.Offline.title };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5 py-10 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{ru.Offline.title}</h1>
      <p className="text-muted-foreground text-balance">{ru.Offline.body}</p>
    </main>
  );
}
