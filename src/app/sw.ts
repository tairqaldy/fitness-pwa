/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Replaced at build time by the generated precache manifest. The injection point is
    // `self.__SW_MANIFEST` — the @serwist/cli docs page saying `__WB_MANIFEST` is stale.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // `?? []` because the injected manifest is typed as possibly-undefined and the repo runs
  // with `exactOptionalPropertyTypes`. An empty precache is also the correct degraded
  // behaviour if injection ever fails, rather than a crashing service worker.
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  // Offline navigations fall back to the precached shell.
  //
  // NOTE: `navigateFallback` / `navigateFallbackDenylist` are NOT options on the modern
  // `Serwist` class — they exist only on the legacy `installSerwist` API (verified against
  // serwist@9.5.12 `dist/index.d.mts`, where SerwistOptions has no such keys). `fallbacks` is
  // the supported mechanism, and it is also the safer one: the matcher fires only for
  // `destination === "document"`, and an API fetch has destination `""`. So an offline
  // mutation can never be silently resolved with HTML — it fails loudly and is retried from
  // the outbox, which is exactly what the sync engine needs.
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
