import { readFileSync } from "node:fs";

import { serwist } from "@serwist/next/config";

/**
 * Serwist runs in CONFIGURATOR mode, not `@serwist/turbopack`.
 *
 * Reason (verified in docs/research/r05-serwist-pwa-on-next16.md §5c): in turbopack mode the
 * service worker is emitted as a prerendered route handler, so on OpenNext it is served BY THE
 * WORKER out of the incremental cache with `Cache-Control: s-maxage=31536000`, which cannot be
 * overridden. In configurator mode it is written to `public/sw.js`, lands in
 * `.open-next/assets/sw.js`, and is served by Cloudflare's static-asset layer instead.
 *
 * Build order: `opennextjs-cloudflare build` invokes this package's own `build` script, so
 * `"build": "next build && serwist build"` is sufficient — `serwist build` always runs after
 * `next build`.
 */

// `.next/BUILD_ID` exists by the time this runs and is a deterministic per-build revision.
// Preferred over `git rev-parse HEAD`, which is wrong for a dirty tree and throws with no git.
const revision = readFileSync(".next/BUILD_ID", "utf-8").trim();

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // /~offline MUST be in the precache manifest or the offline fallback silently does nothing.
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  // MANDATORY: the default glob includes `public/**/*`, but Cloudflare does not serve
  // _headers/_redirects as assets (they 404), and ONE 404 in the manifest fails the entire
  // service-worker install.
  globIgnores: ["public/_headers", "public/_redirects", "public/_routes.json"],
  // Explicit so nobody is surprised: anything larger is silently dropped from the precache.
  maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
});
