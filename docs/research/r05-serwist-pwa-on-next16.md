# R05 — Serwist PWA on Next.js 16.3.5 + OpenNext → Cloudflare Workers

Research date: **2026-09-12**. Verification pass for Phase 1 (Foundation / PWA shell).
Authority order: `docs/research/stack-facts.md` > `specs/00-brief.md` > this note.
Nothing here contradicts `stack-facts.md`. One item **does** contradict the brief and is called
out explicitly (§8 Lighthouse).

Every claim below is one of:

* **VERIFIED (built)** — I ran it, on this machine, today, with the pinned versions.
* **VERIFIED (source)** — read out of the installed package source / official docs, and quoted.
* **UNVERIFIED** — marked inline with the literal token `UNVERIFIED`.

---

## Question

For a mobile-first, offline-first PWA on **Next.js 16.3.5** (Turbopack is the default bundler)
deployed with **@opennextjs/cloudflare 1.20.6** to Cloudflare Workers:

1. Pick between **`@serwist/turbopack`** and **Serwist "configurator mode"**
   (`@serwist/next/config` + `@serwist/cli`), both `9.5.12`.
2. Give the exact `next.config.ts`, `app/sw.ts`, `package.json` scripts and tsconfig/types
   additions for the chosen mode, quoted from official docs.
3. Nail the **build order** with OpenNext: where is the service worker emitted, does
   `opennextjs-cloudflare build` pick up a `public/sw.js` written *after* `next build`, and what
   script ordering makes the deployed Worker actually serve `/sw.js` at root scope.
4. How the SW must be served (scope, `Service-Worker-Allowed`, `Cache-Control`), and how
   OpenNext's asset handling interacts.
5. Offline-fallback page pattern for the App Router + precaching app-shell routes.
6. `manifest.webmanifest` + icons via the App Router metadata API (maskable, apple-touch-icon,
   iOS standalone quirks, `theme-color` for OLED black).
7. What Lighthouse's installability audit requires in 2026.

---

## Decision in one line

**Use configurator mode (`@serwist/next/config` + `@serwist/cli`), service worker at
`public/sw.js`, registered at `/sw.js` with scope `/`.** Do **not** use `@serwist/turbopack`: on
OpenNext its service worker is served *by the Worker* out of the incremental cache with
`Cache-Control: s-maxage=31536000`, and that cannot be fixed with `_headers` — I reproduced it
live (§5c).

---

## 0. What was actually installed and run

VERIFIED (built). Throwaway projects under
`C:/Users/tairc/AppData/Local/Temp/claude/C--Users-tairc-Documents-codespace-fitness-app-tair/85fb1989-5a8f-448f-9e9a-162342b812b6/scratchpad/`.
Nothing was added to the real project.

| Thing | Version / value |
|---|---|
| `next` | `16.3.5` (nextjs.org docs header also reports "Latest Version 16.3.5") |
| `@opennextjs/cloudflare` | `1.20.6` |
| `wrangler` | `4.131.1` |
| `serwist`, `@serwist/next`, `@serwist/cli`, `@serwist/turbopack`, `@serwist/build` | `9.5.12` (npm `dist-tags.latest`; `preview` = `10.0.0-preview.14`) |
| `esbuild` | `0.28.1` |
| Node | `v24.12.0` |
| TypeScript (test) | `5.9.3` |
| `lighthouse` | `13.4.1` (`dist-tags.latest`) |

Turbopack really is the default: a plain `npx next build` on 16.3.5 produced a `.next/turbopack/`
directory and **no** `.next/server/webpack-runtime.js`. `npx next build --help` lists both
`--turbopack  Builds using Turbopack.` and `--webpack  Builds using webpack.`
OpenNext detects this (`@opennextjs/aws/dist/build/helper.js` → `getBundlerRuntime()` looks for
`chunks/[turbopack]_runtime.js`) and built the Turbopack output successfully.

---

## 1. The two candidate modes, quoted from the official docs

### 1a. Configurator mode — https://serwist.pages.dev/docs/next/config

> **Why?**
> Prior to Serwist 9.4, Serwist integrated with Next.js by wrapping `withSerwist` around your
> Next.js configuration. This tied Serwist to webpack's lifecycle, and it could only build the
> service worker after webpack finished bundling your app, but before Next.js prerendered any
> route. Because of this timing, Serwist had no visibility into prerendered output and could not
> automatically precache those routes.
>
> Configurator mode exists to solve this problem. Rather than hooking Serwist directly into the
> Next.js build, Serwist now has an external build step. In this mode, `@serwist/next` only
> generates the `@serwist/cli` configuration needed to build the service worker. The service
> worker is then built after Next.js has prerendered everything, allowing Serwist to
> automatically precache all prerendered routes.
>
> This approach also makes the integration bundler–agnostic. Since configurator mode does not
> depend on webpack internals, it works with Turbopack as well, **eliminating the need for a
> separate implementation like `@serwist/turbopack`**.

Install line, verbatim:

```
npm i -D @serwist/next @serwist/cli serwist esbuild concurrently
```

### 1b. `@serwist/turbopack` — https://serwist.pages.dev/docs/next/turbo

> This quick guide is meant for Turbopack. If you are using webpack, head to the webpack quick
> guide. Alternatively, see if configurator mode suits your use case more.

Its own sibling package calls it **experimental**. VERIFIED (source),
`@serwist/next@9.5.12/dist/index.mjs` lines 104–118 — the warning `withSerwistInit` prints when
`process.env.TURBOPACK` is set:

```
[@serwist/next] WARNING: You are using '@serwist/next' with `next dev --turbopack`, but it doesn't support Turbopack. Do one of the following:

- Set `disable` to `process.env.NODE_ENV !== "production"`.

- Use webpack by running `next dev --webpack` instead of `next dev --turbopack`.

- Migrate to '@serwist/turbopack' which has experimental support for Turbopack. See https://serwist.pages.dev/docs/next/turbo for more information.

- Migrate to configurator mode which has support for Turbopack. See https://serwist.pages.dev/docs/next/config for more information.

Follow https://github.com/serwist/serwist/issues/54 for progress on Serwist + Turbopack. You can also suppress this warning by setting SERWIST_SUPPRESS_TURBOPACK_WARNING=1.
```

Note the asymmetry in Serwist's own words: turbopack mode has *"experimental support"*,
configurator mode *"has support"*.

### 1c. How `@serwist/turbopack` actually works, and why that is fatal here

VERIFIED (source), `@serwist/turbopack@9.5.12/src/index.ts`. It does **not** write a file into
`public/`. It registers an App Router **Route Handler** that is prerendered:

```ts
export const createSerwistRoute = (options: InjectManifestOptions) => {
  const dynamic = "force-static" as const,
    dynamicParams = false as const,
    revalidate = false as const;
  ...
  const GET = async (_: Request, { params }: { params: Promise<{ path: string }> }) => {
    ...
    return new NextResponse(map.get(path.join(config.cwd, filePath)), {
      headers: {
        "Content-Type": CONTENT_TYPE_MAP[path.extname(filePath)] || "text/plain",
        "Service-Worker-Allowed": "/",
      },
    });
  };
  return { dynamic, dynamicParams, revalidate, generateStaticParams, GET };
};

export const withSerwist = (nextConfig: NextConfig = {}): NextConfig => ({
  ...nextConfig,
  serverExternalPackages: [...(nextConfig.serverExternalPackages ?? []), "esbuild", "esbuild-wasm"],
});
```

So the SW lives at **`/serwist/sw.js`** — inside the Next.js server output, not in the
static-asset bundle. On Cloudflare that is the wrong side of the fence; §5 has the measurement.

Two further strikes from the same source read:

* `withSerwist` pushes `"esbuild"` and `"esbuild-wasm"` into `serverExternalPackages`. The
  SW-building toolchain (`@serwist/build`, `glob@13`, `source-map`, `browserslist`, `zod`, plus
  esbuild itself) therefore sits in the module graph of an app route that OpenNext bundles into
  the Worker. `@opennextjs/cloudflare/dist/cli/build/bundle-server.js` runs esbuild with
  `bundle: true`, and its `optionalDependencies` allow-list is only
  `["caniuse-lite", "critters", "jimp", "probe-image-size", "react-dom/server.edge"]` — esbuild
  is *not* on it, so it gets inlined rather than shimmed. Whether that overruns the Worker bundle
  size limit or fails outright is `UNVERIFIED` (I did not build turbopack mode end-to-end), but
  the mechanism is real and the blast radius is the whole deploy.
* `@serwist/turbopack@9.5.12` also declares a dependency on `@swc/core@1.15.46`, a native module.
  It is not imported by the shipped `dist/index.mjs` (grep: 0 hits), so it is probably dead
  weight — `UNVERIFIED` whether any code path reaches it.

---

## 2. Exact configuration for the chosen mode (configurator)

### 2a. `package.json` scripts

Official version, verbatim from https://serwist.pages.dev/docs/next/config:

```json
{
  "scripts": {
    // If you don't need the service worker in development, you can set `disable` in `SerwistProvider`
    // (see below) to `process.env.NODE_ENV === "development"` instead.
    "dev": "concurrently -p none 'serwist build --watch' 'next dev'",
    // Alternatively, build the service worker just once before starting the development server.
    "dev:once": "cross-env NODE_ENV=development serwist build && next dev",
    // Add `serwist build` to your build command.
    "build": "next build && serwist build"
  }
}
```

**What we should actually ship** (the docs' `build` is correct but under-specified for our stack;
deltas explained in §4 and Gotcha #1):

```json
{
  "scripts": {
    "dev": "concurrently -p none \"serwist build --watch serwist.config.mts\" \"next dev\"",
    "build": "next build && cross-env NODE_ENV=production serwist build serwist.config.mts",
    "cf:build": "opennextjs-cloudflare build",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.sw.json"
  }
}
```

Three deliberate differences from the doc snippet:

1. `serwist.config.mts`, not `serwist.config.js` — Gotcha #6.
2. `cross-env NODE_ENV=production` is **not** cosmetic. Gotcha #1: without it a stray
   `NODE_ENV=development` in the shell silently produces a service worker that caches nothing.
3. `preview` / `deploy` match `stack-facts.md`. `opennextjs-cloudflare deploy` does **not**
   build — VERIFIED (source), `dist/cli/commands/deploy.js` only runs `populateCache` then
   `wrangler deploy`.

### 2b. `serwist.config.mts`

Official version, verbatim (docs name the file `serwist.config.js`):

```js
// @ts-check
import { spawnSync } from "node:child_process";
import { serwist } from "@serwist/next/config";

// This is optional!
// A revision helps Serwist version a precached page. This
// avoids outdated precached responses being used. Using
// `git rev-parse HEAD` might not the most efficient way
// of determining a revision, however. You may prefer to use
// the hashes of every extra file you precache.
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout ?? crypto.randomUUID();

export default serwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // If you want to precache any other page that is not
  // already detected by Serwist, add them here. Otherwise,
  // delete `revision`.
  additionalPrecacheEntries: [{ url: "/precached", revision }],
});
```

**What we should actually ship** (mine, not from the docs — flagged as such):

```ts
// serwist.config.mts
import { readFileSync } from "node:fs";
import { serwist } from "@serwist/next/config";

// `serwist build` always runs AFTER `next build`, so .next/BUILD_ID exists and is a
// deterministic per-build revision. Preferred over `git rev-parse HEAD`, which is wrong
// for dirty working trees and throws when git is unavailable.
const revision = readFileSync(".next/BUILD_ID", "utf-8").trim();

export default serwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // /~offline must be in the precache manifest or the offline fallback is a no-op (§6b).
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  // MANDATORY. Default globPatterns include `public/**/*`; Cloudflare does not serve
  // _headers / _redirects as assets (verified: GET /_headers -> 404), and a single 404 in
  // the precache manifest fails the entire SW install. See Gotcha #2.
  globIgnores: ["public/_headers", "public/_redirects", "public/_routes.json"],
  // Explicit so nobody is surprised later: entries above this size are silently dropped.
  maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
});
```

`serwist()` resolves a full `@serwist/cli` `BuildOptions`. VERIFIED (source),
`@serwist/next@9.5.12/src/index.config.ts` + `src/lib/config/utils.ts` — defaults it injects:

* `globPatterns` default:
  `` [`${distDir}static/**/*.{js,css,html,ico,apng,png,avif,jpg,jpeg,jfif,pjpeg,pjp,gif,svg,webp,json,webmanifest}`, "public/**/*"] ``
* plus, when `precachePrerendered !== false` (default **true**):
  `` `${distDir}server/{app,pages}/**/*.html` ``
* `globIgnores` it always adds: `` `${distAppDir}**/_not-found.html` ``,
  `` `${distAppDir}_global-error*` ``, `` `${distPagesDir}404.html` ``,
  `` `${distPagesDir}500.html` ``, and the `swSrc` / `swDest` / `swDest.map` paths.
* ``dontCacheBustURLsMatching: new RegExp(`^${distDir}static/`)``
* a `manifestTransforms` entry that rewrites `.next/server/app/x.html` → `/x`,
  `.next/…` → `${assetPrefix}/_next/…`, and `public/y` → `${basePath}/y`.

> **Consequence: you must go through `serwist()`.** A hand-written `serwist.config` produces
> precache URLs like `public/robots.txt` instead of `/robots.txt` — VERIFIED (built): my first
> raw-config run emitted `{url:"public/robots.txt", …}`, and every such entry 404s at install
> time, which kills the whole install (Gotcha #2).

`precachePrerendered` is documented in the type as: *"Whether Serwist should precache prerendered
routes. @default true"* (`@serwist/next/dist/index.config.d.mts`).

### 2c. `app/sw.ts`

Verbatim from https://serwist.pages.dev/docs/next/config (Step 4):

```ts
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// actual precache manifest. By default, this string is set to
// `"self.__SW_MANIFEST"`.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
```

`self.__SW_MANIFEST` is right. The `@serwist/cli` docs page says the injection point is
`self.__WB_MANIFEST` — **that page is stale**. VERIFIED (source),
`@serwist/build@9.5.12/dist/chunks/inject-manifest-8Ec3euyW.js`:
`injectionPoint: z.string().default("self.__SW_MANIFEST")`.

Additions I recommend for a gym-mode logging app (mine, not from the docs):

```ts
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  // App-shell fallback for any navigation that is not precached (most of our routes are
  // dynamic). navigateFallback resolves through matchPrecache(), same as `fallbacks`,
  // so its URL must also be in the manifest.
  navigateFallback: "/~offline",
  navigateFallbackDenylist: [/^\/api\//, /^\/_next\//],
  fallbacks: {
    entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }],
  },
});
```

### 2d. `app/layout.tsx`

Verbatim from https://serwist.pages.dev/docs/next/config (Step 6) — note `swUrl="/sw.js"`:

```tsx
import { SerwistProvider } from "@serwist/next/react";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

const APP_NAME = "PWA App";
const APP_DEFAULT_TITLE = "My Awesome PWA App";
const APP_TITLE_TEMPLATE = "%s - PWA App";
const APP_DESCRIPTION = "Best PWA app in the world!";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_DEFAULT_TITLE,
    // startUpImage: [],
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: { default: APP_DEFAULT_TITLE, template: APP_TITLE_TEMPLATE },
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: { default: APP_DEFAULT_TITLE, template: APP_TITLE_TEMPLATE },
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <head />
      <body>
        <SerwistProvider swUrl="/sw.js" /* disable={process.env.NODE_ENV === "development"} */>
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
```

**`SerwistProvider`'s real defaults.** VERIFIED (source),
`@serwist/turbopack@9.5.12/src/index.react.tsx` (byte-identical logic ships in
`@serwist/next/dist/index.react.mjs`):

```tsx
export function SerwistProvider({
  swUrl,
  disable = false,
  register = true,
  cacheOnNavigation = true,
  reloadOnOnline = true,
  options,
  children,
}: SerwistProviderProps) {
  const [serwist] = useState(() => {
    if (typeof window === "undefined") return null;
    if (disable) return null;
    const scope = options?.scope || "/";
    if (!(window.serwist && window.serwist instanceof Serwist) && "serviceWorker" in navigator) {
      window.serwist = new Serwist(swUrl, { ...options, scope, type: options?.type || "module" });
      if (register && !isCurrentPageOutOfScope(scope)) {
        void window.serwist.register();
      }
    }
    return window.serwist ?? null;
  });
  useEffect(() => {
    const reload = () => location.reload();
    if (reloadOnOnline) {
      window.addEventListener("online", reload);
    }
    return () => { window.removeEventListener("online", reload); };
  }, [reloadOnOnline]);
  ...
```

Good news: `scope` defaults to `"/"` and `type` defaults to `"module"`, so root scope needs no
extra props.

Bad news: **`reloadOnOnline` defaults to `true`**, i.e.
`window.addEventListener("online", () => location.reload())`. In a basement gym with one bar of
LTE this reloads the page mid-set and throws away unsaved React state. Set
`reloadOnOnline={false}` — our reconnect handling is the Dexie/IndexedDB sync queue, not a page
reload.

Our layout, with everything this project needs:

```tsx
import { SerwistProvider } from "@serwist/next/react";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  applicationName: "Fit",
  title: { default: "Fit", template: "%s · Fit" },
  description: "Personal training log",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Fit" },
  formatDetection: { telephone: false },
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
  // Do NOT set `manifest:` here — app/manifest.ts already makes Next emit
  // <link rel="manifest" href="/manifest.webmanifest"> (§7b, verified).
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",              // required for env(safe-area-inset-*) in iOS standalone
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#000000" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" dir="ltr">
      <body>
        <SerwistProvider swUrl="/sw.js" reloadOnOnline={false}>
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
```

`#000000` for both colour schemes is deliberate: the brief mandates a true OLED-black canvas, and
`theme-color` paints the browser chrome and the standalone status-bar area. With
`statusBarStyle: "black-translucent"` iOS draws content *under* the status bar, which is why
`viewportFit: "cover"` plus `env(safe-area-inset-top)` padding is required — otherwise the top of
GYM MODE sits behind the clock.

⚠ **The root layout must stay static.** See §6c — it is the difference between an offline app and
no offline app at all.

### 2e. `next.config.ts`

Configurator mode needs **nothing** from Serwist in `next.config`. Verbatim from Serwist's own
configurator example (`examples/next-basic-cli/next.config.mjs`):

```js
// @ts-check
/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

So our `next.config.ts` carries only the OpenNext dev hook that `stack-facts.md` requires:

```ts
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

// stack-facts.md: required so `next dev` gets the D1 / R2 / KV bindings.
initOpenNextCloudflareForDev();
```

This is the biggest practical win of configurator mode: **`next.config.ts` stays clean**, so
there is no interaction to reason about between `withSerwist`,
`initOpenNextCloudflareForDev()` and OpenNext's own `patchOriginalNextConfig` step.

### 2f. `tsconfig.json` / types

Verbatim, `examples/next-basic-cli/tsconfig.json` (the official configurator example):

```json
{
  "compilerOptions": {
    "target": "es2017",
    "lib": ["dom", "dom.iterable", "esnext", "webworker"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "types": ["@serwist/next/typings"],
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

That config **works** — VERIFIED (built): `tsc` exits 0 on the official `app/sw.ts` with TS 5.9.3.
But it has two traps:

* `"lib": [..., "webworker"]` next to `"dom"` only typechecks because `skipLibCheck: true`.
  VERIFIED (built): flipping `skipLibCheck` to `false` produces **35 errors**, including
  `lib.dom.d.ts(23,1): error TS6200: Definitions of the following identifiers conflict with those in another file: …`
  and `lib.webworker.d.ts(1764,5): error TS2374: Duplicate index signature for type 'number'.`
  The brief says "TypeScript strict"; if anyone reads that as "and no `skipLibCheck`", the build
  breaks.
* `"types": ["@serwist/next/typings"]` turns `types` into an allow-list and therefore **disables
  automatic inclusion of every other `@types/*` package**. It also buys almost nothing:
  VERIFIED (source), `@serwist/next@9.5.12/dist/sw-entry.d.mts` is *only*
  `declare global { interface Window { serwist: Serwist } }` — and `@serwist/next/react` already
  declares that same global itself.

**Recommended instead** — two tsconfigs. VERIFIED (built): 0 errors on the app with
`skipLibCheck: false`, 0 errors on the SW.

`tsconfig.json` (app): Next's defaults, **omit** `"webworker"` from `lib`, **omit** `"types"`, and
add `"app/sw.ts"` to `exclude`.

`tsconfig.sw.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["esnext", "webworker"],
    "skipLibCheck": true,
    "types": []
  },
  "include": ["app/sw.ts"],
  "exclude": []
}
```

`skipLibCheck: true` is still required *here*: VERIFIED (built), with it off,
`serwist@9.5.12/dist/chunks/types-BB8lYSAv.d.ts(731)` fails with
`error TS2304: Cannot find name 'URLPattern'.` and `'URLPatternInit'` — TS 5.9.3's
`lib.webworker.d.ts` has no URLPattern types. Wire `tsc -p tsconfig.sw.json` into the
`typecheck` script so the SW is still checked.

### 2g. `.gitignore`

Verbatim from the docs (Step 3):

```gitignore
# Serwist
public/sw*
```

(The webpack guide also lists `public/swe-worker*`; configurator mode does not emit that file.)

---

## 3. What we are NOT shipping — turbopack mode, for the record

So the owner can see exactly what is being declined. Verbatim from
https://serwist.pages.dev/docs/next/turbo:

`next.config.mjs`

```js
import { withSerwist } from "@serwist/turbopack";

export default withSerwist({
  // Your Next.js configuration
});
```

`app/serwist/[path]/route.ts`

```ts
import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";
// If you are using Next.js versions older than 15.0.0, add the
// `nextConfig` option so that Serwist can configure the service
// worker according to your options. Serwist 10 and newer will
// only support Next.js 15.0.0 and above.
// import nextConfig from "$cwd/next.config.mjs";

// This is optional!
// A revision helps Serwist version a precached page. This
// avoids outdated precached responses being used. Using
// `git rev-parse HEAD` might not the most efficient way
// of determining a revision, however. You may prefer to use
// the hashes of every extra file you precache.
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout ?? crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  swSrc: "app/sw.ts",
  // nextConfig,
  // If set to `false`, Serwist will attempt to use `esbuild-wasm`.
  useNativeEsbuild: true,
});
```

`app/sw.ts` is the same template but imports `defaultCache` from `@serwist/turbopack/worker`, and
`app/layout.tsx` uses `SerwistProvider` from `@serwist/turbopack/react` with
`swUrl="/serwist/sw.js"`.

Install line: `npm i -D @serwist/turbopack esbuild serwist`.

Note the option `useNativeEsbuild`, documented in `@serwist/turbopack@9.5.12/dist/index.d.mts` as
*"Whether to use the native `esbuild` package instead of `esbuild-wasm` for bundling the service
worker. Defaults to `false` if not on Windows, `true` otherwise."* — so on our Windows dev box the
default flips relative to CI. Another reason not to take this path.

---

## 4. BUILD ORDER with OpenNext — proven, step by step

### 4a. `opennextjs-cloudflare build` runs **your `package.json` build script**

This is the fact everything else hangs off, and the one most blog posts get wrong.
VERIFIED (source), `@opennextjs/aws/dist/build/buildNextApp.js`:

```js
export function setStandaloneBuildMode(options) {
    // Equivalent to setting `output: "standalone"` in next.config.js
    process.env.NEXT_PRIVATE_STANDALONE = "true";
    process.env.NEXT_PRIVATE_OUTPUT_TRACE_ROOT = options.monorepoRoot;
}
export function buildNextjsApp(options) {
    const { config, packager } = options;
    const command = config.buildCommand ??
        (["bun", "npm"].includes(packager)
            ? `${packager} run build`
            : `${packager} build`);
    cp.execSync(command, { stdio: "inherit", cwd: path.dirname(options.appPackageJsonPath) });
}
```

Confirmed independently by Cloudflare's own blog: *"the adapter first builds your app by running
the build script in your package.json, and then transforms the build output"*
(https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter).

VERIFIED (built) — my run printed npm's echo of the script it invoked:

```
> next build && node ./fake-serwist.mjs
...
[fake-serwist] wrote public/sw.js after next build

┌──────────────────────────────┐
│ OpenNext — Generating bundle │
└──────────────────────────────┘
Bundling middleware function...
Bundling static assets...
Bundling cache assets...
```

Two consequences:

* `"build": "next build && serwist build"` is all you need. You do **not** need
  `--skipNextBuild`, and you must **never** put `opennextjs-cloudflare build` in your `build`
  script (infinite recursion). `open-next.config.ts` also accepts `buildCommand` if you want to
  name the command explicitly instead of relying on `npm run build`.
* If you *do* want to run `next build` yourself and then
  `opennextjs-cloudflare build --skipNextBuild` (aliases `--skipBuild`, `-s`; env
  `SKIP_NEXT_APP_BUILD=1`), you must set `NEXT_PRIVATE_STANDALONE=true` (or
  `output: "standalone"`) yourself, because OpenNext's own build step is what normally sets it,
  and `createCacheAssets` reads `.next/standalone/<pkg>/.next/server/{app,pages}`. Skipping the
  build without standalone mode gives you an empty cache and a broken server bundle.
  `initOutputDir` only removes `.open-next`, not `.next` — VERIFIED (source),
  `@opennextjs/aws/dist/build/helper.js:347` `fs.rmSync(options.outputDir, …)` — so `.next` does
  survive `--skipNextBuild`.

### 4b. Where the service worker is emitted, per mode

| Mode | SW written to | Ends up in | Served by |
|---|---|---|---|
| **configurator** | `public/sw.js` (by `serwist build`, after `next build`) | `.open-next/assets/sw.js` | Cloudflare's static-asset layer, Worker not invoked |
| turbopack | `.next/server/app/serwist/sw.js.body` + `.meta` (prerendered Route Handler) | `.open-next/cache/<buildId>/serwist/sw.js.cache` | the Worker, out of the incremental cache |

Both rows VERIFIED (built). For turbopack mode I reproduced the shape with an equivalent
`force-static` route handler and got exactly:

```
$ ls .next/server/app/serwist
[path]
sw.js.body
sw.js.meta

$ find .open-next/cache -type f
.open-next/cache/S_iArt4EACyrJEo7YVmeG/index.cache
.open-next/cache/S_iArt4EACyrJEo7YVmeG/serwist/sw.js.cache
.open-next/cache/S_iArt4EACyrJEo7YVmeG/_global-error.cache
.open-next/cache/S_iArt4EACyrJEo7YVmeG/_not-found.cache

$ ls .open-next/assets
BUILD_ID  _headers  _next  robots.txt  sw.js
```

Note: **no `serwist/` directory anywhere under `.open-next/assets`.**

### 4c. Does OpenNext pick up a `public/sw.js` written **after** `next build`? YES

This was the crux of the question. Proven twice over.

VERIFIED (source), `@opennextjs/aws/dist/build/createAssets.js` — `createStaticAssets()` reads
`public/` off disk at the moment it runs:

```js
fs.copyFileSync(path.join(appBuildOutputPath, ".next/BUILD_ID"), path.join(outputPath, "BUILD_ID"));
fs.cpSync(path.join(appBuildOutputPath, ".next/static"), path.join(outputPath, "_next", "static"), { recursive: true });
if (fs.existsSync(appPublicPath)) {
    fs.cpSync(appPublicPath, outputPath, { recursive: true, dereference: true });
}
```

and `@opennextjs/cloudflare/dist/cli/build/build.js` calls it strictly *after*
`buildNextjsApp(options)`. Full order inside `build.js`:

```
initOutputDir            (rm -rf .open-next only)
buildNextjsApp           ← runs `npm run build` = next build && serwist build
patchOriginalNextConfig
compileCache / compileEnvFiles / compileInit / compileImages / compileSkewProtection
createMiddleware
createStaticAssets(options, { useBasePath: true })   ← public/* → .open-next/assets/*
createCacheAssets                                    ← .next/server/**/{.body,.meta,.html} → .open-next/cache
createServerBundle
compileDurableObjects
bundleServer
```

VERIFIED (built). My probe's `build` script wrote `public/sw.js` in a step that ran *after*
`next build`. Result:

```
$ ls -la .open-next/assets
BUILD_ID
_headers
_next
robots.txt
sw.js

$ cat .open-next/assets/sw.js
// SW built AFTER next build
self.addEventListener('fetch', () => {});
```

So the correct ordering, stated plainly:

```
opennextjs-cloudflare build
└─ npm run build
   ├─ next build      # prerenders → .next/static, .next/server/app/**/*.html, .next/BUILD_ID
   └─ serwist build   # globs that output, writes public/sw.js   ← MUST be here, not later
└─ createStaticAssets()   # public/* → .open-next/assets/*        ← picks up sw.js
└─ createCacheAssets() / createServerBundle() / bundleServer()
opennextjs-cloudflare deploy   # populateCache + wrangler deploy (does NOT build)
```

The ordering that **fails silently**: running `serwist build` *after*
`opennextjs-cloudflare build` (e.g.
`"deploy": "opennextjs-cloudflare build && serwist build && opennextjs-cloudflare deploy"`).
`.open-next/assets` is already sealed by then. `public/sw.js` exists on your disk, is absent from
the deployed assets, and `/sw.js` falls through to the Worker and 404s. Nothing in the build
output warns you.

Also verified: in standalone mode (i.e. under `opennextjs-cloudflare build`), the original paths
`serwist build` globs still exist —

```
$ find .next/server/app -maxdepth 1 -name "*.html"
.next/server/app/index.html
.next/server/app/_global-error.html
.next/server/app/_not-found.html
$ ls .next/static
chunks  o0vu2CyjUaXLuloykUqY7
$ ls -d .next/standalone
.next/standalone
```

— so `precachePrerendered` and the `.next/static/**` globs work identically whether you build
through OpenNext or directly.

---

## 5. How the SW is served, and how OpenNext's asset handling interacts

### 5a. Cloudflare serves assets *before* the Worker

> "Cloudflare will first attempt to serve static assets if one matches the incoming request. If an
> appropriate static asset if not found, Cloudflare will invoke your Worker script."
> — https://developers.cloudflare.com/workers/static-assets/routing/worker-script/

OpenNext's generated `wrangler.jsonc` does **not** set `run_worker_first`, so this default applies
and `/sw.js` never reaches the Worker. VERIFIED (source),
`@opennextjs/cloudflare/templates/wrangler.jsonc` (`assets: { directory: ".open-next/assets", binding: "ASSETS" }`,
no `run_worker_first`), plus `dist/cli/templates/worker.js` which contains no `env.ASSETS.fetch()`
call for ordinary paths.

### 5b. Scope

> "The default `scope` for a service worker registration is the directory where the service worker
> script is located (resolving `./` against `scriptURL`)." … "A service worker can't have a scope
> broader than its own location, unless the server specifies a broader maximum scope in a
> `Service-Worker-Allowed` header on the service worker script."
> — MDN, `ServiceWorkerContainer.register()`

`/sw.js` sits at the origin root ⇒ max scope is already `/` ⇒ **no `Service-Worker-Allowed` header
needed**. `SerwistProvider` passes `scope: "/"` anyway (§2d), so registration matches.

`/serwist/sw.js` would have default max scope `/serwist/` and *absolutely requires* the header.
`@serwist/turbopack` does set it, and Next.js does persist it. VERIFIED (built) —
`.next/server/app/serwist/sw.js.meta`:

```json
{"status":200,"headers":{"content-type":"application/javascript","service-worker-allowed":"/","x-next-cache-tags":"_N_T_/layout,_N_T_/serwist/layout,_N_T_/serwist/[path]/layout,_N_T_/serwist/[path]/route,_N_T_/serwist/sw.js"}}
```

and OpenNext preserves it, because `@opennextjs/aws/dist/core/routing/cacheInterceptor.js` for
`case "route"` builds
`headers = { ...cacheControl, ...cachedData.value.meta?.headers, vary: VARY_HEADER }` — the entry's
own headers spread *after* the computed cache-control, so they win. (That detail also explains why
Next's `app/manifest.ts` route is fine and the Serwist route is not; see below.)

### 5c. `Cache-Control` — the decisive measurement

I ran the real Worker (`wrangler dev` against the real `.open-next` output) and measured both
paths.

**Configurator mode, `/sw.js` from `public/` — VERIFIED (built):**

```
$ curl -D - -o /dev/null http://127.0.0.1:8791/sw.js
HTTP/1.1 200 OK
Content-Length: 71
Content-Type: text/javascript; charset=utf-8
Cache-Control: no-cache
ETag: "2e3ad228eb9f3bf5348de70c55683d72"
CF-Cache-Status: HIT
```

`Cache-Control: no-cache` came from a `public/_headers` file. Wrangler logged
`✨ Parsed 1 valid header rule.` — so **`_headers` works on Workers static assets, not just
Pages**, and OpenNext ships it for free (it is just another `public/` file, copied to
`.open-next/assets/_headers`).

With no rule, the platform default applies — VERIFIED (built) on `/robots.txt`:

```
Cache-Control: public, max-age=0, must-revalidate
```

which matches Cloudflare's docs: *"Cache-Control: public, max-age=0, must-revalidate"* is sent
when requests lack `Authorization` or `Range` headers
(https://developers.cloudflare.com/workers/static-assets/headers/).

**Turbopack mode, `/serwist/sw.js` from the Worker — VERIFIED (built):**

```
$ curl -D - -o /dev/null http://127.0.0.1:8793/serwist/sw.js
HTTP/1.1 200 OK
Transfer-Encoding: chunked
Content-Type: application/javascript
Cache-Control: s-maxage=31536000
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
service-worker-allowed: /
x-nextjs-cache: MISS
x-opennext: 1
```

**`s-maxage=31536000` — one year of shared-cache lifetime on a service worker script.** It comes
from `computeCacheControl()` in `cacheInterceptor.js`: a `revalidate: false` route is treated as
SSG (`finalRevalidate = CACHE_ONE_YEAR`) and the function returns
``` `s-maxage=${CACHE_ONE_YEAR}, stale-while-revalidate=${CACHE_ONE_MONTH}` ```.
`@serwist/turbopack` sets no `Cache-Control` of its own, so nothing overrides it. (Same header
observed on the prerendered `/` page: `Cache-Control: s-maxage=31536000`.)

And it is **unfixable with `_headers`**:

> "Custom headers defined in the `_headers` file are not applied to responses generated by your
> Worker code." — https://developers.cloudflare.com/workers/static-assets/headers/

For contrast, Next's own manifest route *does* set its own cache-control —
`.next/server/app/manifest.webmanifest.meta` =
`{"status":200,"headers":{"cache-control":"public, max-age=0, must-revalidate","content-type":"application/manifest+json", …}}`
— which is exactly why `/manifest.webmanifest` is fine and a Serwist route handler is not.

How bad is this in production? The header is measured; whether Cloudflare's edge actually caches
this Worker response for a year on a custom domain is `UNVERIFIED` (I only ran `wrangler dev`
locally, where `CF-Cache-Status` is simulated). Modern browsers largely dodge the browser-side
risk: MDN's `updateViaCache` default is `'imports'` — *"The HTTP cache will be queried for
imports, but the main script will always be updated from the network"* — and web.dev's
service-worker lifecycle article says *"Most browsers, including Chrome 68 and later, default to
ignoring caching headers when checking for updates of the registered service worker script."*
But a year-long `s-maxage` on the SW is a self-inflicted hazard with no upside.

Secondary costs of the turbopack path, both visible in the response above: every `/serwist/sw.js`
fetch is a **billable Worker invocation** with cold-start CPU, and the response carries a
nonsensical `Vary: rsc, next-router-state-tree, …` on a JavaScript file.

### 5d. The `public/_headers` we should ship

VERIFIED (built) in an assets-only Worker: `_headers` can set arbitrary headers including
`Service-Worker-Allowed`, and `/_headers` itself is **404** (never served as an asset).

```
# public/_headers — applies to Cloudflare Workers STATIC ASSETS only.
# It does NOT apply to worker-rendered routes. Limits: max 100 rules, <= 2000 chars per line.
/sw.js
  Cache-Control: no-cache, no-store, must-revalidate
  Service-Worker-Allowed: /

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
```

Test output, VERIFIED (built):

```
[wrangler:info] ✨ Parsed 2 valid header rules.

$ curl -D - -o /dev/null .../sw.js
HTTP/1.1 200 OK
Content-Type: text/javascript; charset=utf-8
Cache-Control: no-cache, no-store, must-revalidate
CF-Cache-Status: HIT
service-worker-allowed: /

$ curl -o /dev/null -w "status=%{http_code}\n" .../_headers
status=404
```

`Service-Worker-Allowed: /` is redundant for a root-scoped `/sw.js`; it is one line of insurance
against a future `basePath` or a move of the SW out of the root.

Two follow-on notes:

* `_headers` is the **only** way to set headers on our assets. `headers()` in `next.config.ts` is
  applied by the Next router inside the Worker, which never runs for `/sw.js`.
* `public/_headers` must be added to Serwist's `globIgnores` — Gotcha #2. Not optional; its 404
  breaks SW installation entirely.

---

## 6. Offline fallback page + precaching the app shell

### 6a. The pattern

`app/~offline/page.tsx`, verbatim from Serwist's own configurator example
(`examples/next-basic-cli/app/~offline/page.tsx`):

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
};

export default function Page() {
  return (
    <>
      <h1>This is offline fallback page</h1>
      <h2>When offline, any page route will fallback to this page</h2>
    </>
  );
}
```

Wired up through `fallbacks.entries` (and `navigateFallback`) in `app/sw.ts` — §2c.

### 6b. The fallback URL **must already be in the precache manifest**

`fallbacks` does not precache anything. VERIFIED (source), `serwist@9.5.12/src/Serwist.ts`:

```ts
if (runtimeCaching !== undefined) {
  if (fallbacks !== undefined) {
    const fallbackPlugin = new PrecacheFallbackPlugin({
      fallbackUrls: fallbacks.entries,
      serwist: this,
    });
    runtimeCaching.forEach((cacheEntry) => {
      if (
        cacheEntry.handler instanceof Strategy &&
        // This also filters entries with `PrecacheFallbackPlugin` as it also has `handlerDidError`.
        !cacheEntry.handler.plugins.some((plugin) => "handlerDidError" in plugin)
      ) {
        cacheEntry.handler.plugins.push(fallbackPlugin);
      }
    });
  }
  ...
```

and `src/lib/precaching/PrecacheFallbackPlugin.ts` resolves via
`await this._serwist.matchPrecache(fallback.url)`. No precache entry ⇒ `undefined` ⇒ no fallback
⇒ the browser's own offline error page. Note also that `fallbacks` is **ignored entirely** if
`runtimeCaching` is undefined — the Serwist docs say the same: *"serwist.PrecacheFallbackPlugin
(if `runtimeCaching` and `fallbacks` are not undefined)"*.

Two ways to get `/~offline` into the manifest:

1. `additionalPrecacheEntries: [{ url: "/~offline", revision }]` — both official examples do
   this. The SW `fetch`es `/~offline` at install time and caches the response.
2. `precachePrerendered: true` (the default) globbing `.next/server/app/~offline.html`.

VERIFIED (built): with a static root layout, `next build` produces
`.next/server/app/~offline.html`, and `@serwist/next/config`'s `manifestTransforms` maps it to
`/~offline` (strip `.next/server/app` prefix → `/~offline.html` → strip `.html` → `/~offline`).
**Use both** — belt and braces, and option 1 is what survives §6c.

### 6c. ⚠ The project-specific landmine: a dynamic root layout kills all precaching

The most important finding in this note for *our* app.

VERIFIED (built). Root layout that awaits `cookies()` (e.g. for locale or the auth session):

```
Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /~offline
├ ○ /apple-icon.png
├ ○ /icon.png
├ ○ /manifest.webmanifest
ƒ  (Dynamic)  server-rendered on demand

$ find .next/server/app -maxdepth 2 -name "*.html"
.next/server/app/_global-error.html
```

Only `_global-error.html` — and `@serwist/next/config` explicitly `globIgnores`
`` `${distAppDir}_global-error*` ``. So `precachePrerendered` precaches **nothing**, `/~offline`
never enters the manifest, and the offline fallback silently does not exist. Nothing fails; you
simply have no offline app.

Same tree, *static* root layout:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /~offline
├ ○ /apple-icon.png
├ ○ /icon.png
├ ○ /manifest.webmanifest
○  (Static)  prerendered as static content

$ find .next/server/app -maxdepth 2 -name "*.html"
.next/server/app/index.html
.next/server/app/_global-error.html
.next/server/app/_not-found.html
.next/server/app/~offline.html
```

**Rules this imposes on Phase 1:**

* The **root layout must not touch Request-time APIs** — `cookies()`, `headers()`,
  `searchParams`, `draftMode()`, uncached `fetch`. Resolve auth and locale in the Cloudflare
  proxy / Next middleware, in a *child* layout, or in a client component reading Dexie.
* Every route we want working offline must be prerenderable and show `○` in the build table. For
  GYM MODE specifically: make the logging screen a **static shell** that hydrates and
  reads/writes IndexedDB, not a server-rendered page. That is what the brief's offline-first NFR
  requires anyway.
* Add a build assertion to CI: fail if `.next/server/app/~offline.html` is missing after
  `next build`. One `test -f` catches this entire failure class.

### 6d. App-shell precaching in practice with the App Router

Default `globPatterns` cover `.next/static/**` (the JS/CSS chunks) and `public/**`, so the client
bundle is precached and a cold offline boot has code to run. But HTML is only half the story for
the App Router: client-side navigations fetch **RSC flight payloads**, not HTML.
`@serwist/next/worker`'s `defaultCache` handles those — VERIFIED (source),
`@serwist/next@9.5.12/dist/index.worker.mjs`:

```js
{
  matcher: ({ request, url: { pathname }, sameOrigin }) => request.headers.get("RSC") === "1" && request.headers.get("Next-Router-Prefetch") === "1" && sameOrigin && !pathname.startsWith("/api/"),
  handler: new NetworkFirst({ cacheName: PAGES_CACHE_NAME.rscPrefetch, ... })
},
{
  matcher: ({ request, url: { pathname }, sameOrigin }) => request.headers.get("RSC") === "1" && sameOrigin && !pathname.startsWith("/api/"),
  handler: new NetworkFirst({ cacheName: PAGES_CACHE_NAME.rsc, ... })
},
```

These are `NetworkFirst`, i.e. *runtime* caches populated by visits, not precached. So the first
offline visit to a route the user has never opened falls back to `/~offline`. Acceptable for this
app **provided** GYM MODE and the dashboard are static shells (§6c) so their HTML *is* precached.

Three more things worth knowing about `defaultCache`, all from the same source read:

* `{ matcher: /\/api\/auth\/.*/, handler: new NetworkOnly({ networkTimeoutSeconds: 10 }) }` — auth
  routes are never cached. Put our auth endpoints under `/api/auth/` to inherit this.
* Other same-origin `GET /api/*` requests get
  `NetworkFirst({ cacheName: "apis", networkTimeoutSeconds: 10, maxEntries: 16 })`. For a
  correction-loop app that is mostly fine, but be aware a stale cached JSON can be served when
  the network is slow rather than absent.
* The HTML rule is `request.headers.get("Content-Type")?.includes("text/html")`. Navigation
  requests do not carry a request `Content-Type`, so that rule effectively never matches and
  documents fall through to the final catch-all `NetworkFirst({ cacheName: "others" })`. Same
  strategy, different cache name — functionally harmless, but do not expect the `pages` cache to
  fill, and do not spend an afternoon debugging why. (Quoted faithfully from source; not filed
  upstream.)
* `SerwistProvider`'s `cacheOnNavigation` (default `true`) patches
  `history.pushState`/`replaceState` and posts `{type:"CACHE_URLS"}` to the SW, so routes the
  user actually visits do get added to the runtime cache.

---

## 7. `manifest.webmanifest` + icons via the App Router metadata API

### 7a. File conventions, quoted

> Add or generate a `manifest.(json|webmanifest)` file that matches the Web Manifest Specification
> in the root of `app` directory to provide information about your web application for the
> browser. … Add a `manifest.js` or `manifest.ts` file that returns a `Manifest` object.
>
> **Good to know:** `manifest.js` is a special Route Handlers that is cached by default unless it
> uses a Request-time API or dynamic config option.
> — https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest (v16.3.5, last updated 2026-03-03)

> | File convention | Supported file types | Valid locations |
> | `favicon` | `.ico` | `app/` |
> | `icon` | `.ico`, `.jpg`, `.jpeg`, `.png`, `.svg` | `app/**/*` |
> | `apple-icon` | `.jpg`, `.jpeg`, `.png` | `app/**/*` |
>
> … `sizes="any"` is added to icons when the extension is `.svg` or the image size of the file is
> not determined.
> … App icons are special Route Handlers that are cached by default unless they use a Request-time
> API or dynamic config option.
> — https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons (v16.3.5)

> **Deprecated**: The `themeColor` option in `metadata` is deprecated as of Next.js 14. Please use
> the `viewport` configuration instead.
> — https://nextjs.org/docs/app/api-reference/functions/generate-metadata (v16.3.5)

### 7b. What Next.js 16.3.5 actually emits — VERIFIED (built)

With `app/manifest.ts`, `app/icon.png` (192×192), `app/apple-icon.png` (180×180),
`appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Fit" }` and
`viewport: { viewportFit: "cover", themeColor: [light, dark] }`, the prerendered `<head>`
contains exactly:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)"/>
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)"/>
<meta name="application-name" content="Fit"/>
<link rel="manifest" href="/manifest.webmanifest"/>
<meta name="format-detection" content="telephone=no"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="Fit"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<link rel="icon" href="/icon.png?icon.431z4-na3nli5.png" sizes="192x192" type="image/png"/>
<link rel="apple-touch-icon" href="/apple-icon.png?apple-icon.23cas60yq32p3.png" sizes="180x180" type="image/png"/>
```

and the route table shows `○ /manifest.webmanifest`, `○ /icon.png`, `○ /apple-icon.png`.

Four things a stale blog post gets wrong here:

1. **`app/manifest.ts` is served at `/manifest.webmanifest`**, not `/manifest.json`, and Next emits
   the `<link rel="manifest">` for you. Do **not** also set `metadata.manifest` — you get a second,
   wrong link tag. (Serwist's docs tell you to create `app/manifest.json` and its webpack guide
   tells you to set `manifest: "/manifest.json"`; both would double up.)
2. **`appleWebApp.capable: true` emits `<meta name="mobile-web-app-capable">`** — the standard
   name, **not** `apple-mobile-web-app-capable`. Every 2019–2023 tutorial says to hand-write the
   `apple-` one. Do not add it back.
3. Generated icon routes get a **content-hash query string** in the `href`
   (`/icon.png?icon.431z4-na3nli5.png`). They are served by the Worker with
   `cache-control: public, max-age=0, must-revalidate` (from `.next/server/app/icon.png.meta`) and
   are **not** reachable by Serwist's `public/**` glob, so they are never precached.
4. **The file conventions cannot express `purpose: "maskable"`.** Maskable icons exist only in the
   manifest's `icons` array.

### 7c. What we should ship

Because of (3) and (4), put the real icon set in `public/icons/` — static assets, precached, zero
Worker invocations — and declare them explicitly.

`app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fit — Personal Training Log",
    short_name: "Fit",
    description: "Workout logging, body tracking and food photo calories",
    start_url: "/",
    scope: "/",
    display: "standalone",          // REQUIRED for Web Push on iOS (§7d)
    orientation: "portrait",
    background_color: "#000000",    // OLED-black splash
    theme_color: "#000000",
    lang: "ru",
    dir: "ltr",
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

Keep `any` and `maskable` as **separate entries**. The Serwist example manifest marks its only
192×192 icon `"purpose": "maskable"` and leaves the 512 unmarked — do not copy that. A
maskable-only set makes Chrome crop artwork that was not drawn for the safe zone; an `any`-only
set makes Android render your square icon inside a white circle.

In `app/layout.tsx` point `metadata.icons.apple` at a static file so there is no hash query
(§2d). `apple-touch-icon.png` must be **180×180, opaque, no transparency, no pre-rounded
corners** — iOS applies its own mask. That is an asset-authoring requirement, not a framework
one (`UNVERIFIED` as Next behaviour), and it is why a transparent PNG shows up black on the iOS
home screen.

Keep `app/favicon.ico` for the browser tab; it is the only icon convention restricted to the top
level of `app/`.

Optional but cheap: if you would rather the manifest be a static asset instead of a Worker route,
put `public/manifest.webmanifest` on disk and set `metadata.manifest: "/manifest.webmanifest"`.
Then it is served by the assets layer and is precachable. `app/manifest.ts` buys you typing and
i18n at the cost of one Worker invocation per install-check. Either is fine; I default to
`app/manifest.ts` for the `MetadataRoute.Manifest` type safety.

### 7d. iOS / Safari standalone quirks (all from WebKit, primary source)

* **Web Push requires an installed web app.** *"A web app that has been added to the Home Screen
  can request permission to receive push notifications"*, minimum *"iOS and iPadOS 16.4"*, and the
  manifest must have its *"display member set to `standalone` or `fullscreen`"*. The permission
  request must be *"in response to direct user interaction — such as tapping on a 'subscribe'
  button"*. — https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
  → **Consequence for the brief's Phase 8:** on iOS, web push does not work in a browser tab at
  all; the user must install to Home Screen first. Telegram is the right primary notification
  channel for this app, with web push as an enhancement.
* **`apple-touch-icon` beats the manifest on iOS.** Same WebKit post: list icons in the manifest
  or use `apple-touch-icon` tags, and *"If both are present, the apple-touch-icon takes
  precedence."* So the 180×180 `apple-touch-icon` is what lands on the iOS home screen.
* **iOS 26 changed installation defaults.** *"By default, every website added to the Home Screen
  opens as a web app."* Users can turn that off with an "Open as Web App" toggle. And explicitly:
  *"This change, of course, is not removing any of WebKit's current support for web app
  features!"* — the manifest `display` member and `apple-mobile-web-app-capable` keep working.
  — https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
* **Module service workers are safe on our targets.** `SerwistProvider` registers with
  `type: "module"` (§2d) and `serwist build` emits `format: "esm"`. MDN BCD
  (`api/ServiceWorker.json` → `ecmascript_modules`, fetched today): **Chrome 91**, **Safari 15**
  (iOS mirrors), **Firefox 147**. Nothing to work around on iOS Safari or Android Chrome. Older
  Firefox would silently get no SW — irrelevant for a single-user mobile app, noted for
  completeness.
* `statusBarStyle: "black-translucent"` + `viewportFit: "cover"` means content extends under the
  status bar and the home indicator. Budget `env(safe-area-inset-top)` /
  `env(safe-area-inset-bottom)` padding in the bottom tab bar and the GYM MODE header, or the 56px
  tap targets the brief demands will be partly unreachable. `UNVERIFIED` on-device.

---

## 8. Lighthouse installability in 2026 — this contradicts the brief

**There is no Lighthouse PWA category any more, and no installability audit.**

VERIFIED (source), today: `lighthouse` on npm is at **`13.4.1`** (`dist-tags.latest`). I fetched
`core/config/default-config.js` from `main` and enumerated the shipped categories:

```
'performance'   'accessibility'   'best-practices'   'seo'   'agentic-browsing'
```

`grep -i pwa` → **0 hits**.
`grep -c "installable-manifest\|maskable-icon\|apple-touch-icon\|splash-screen"` → **0**.

The old audit page carries the notice:

> "PWA testing in Lighthouse is deprecated. For more information on its deprecation see Chrome's
> updated Installability Criteria."
> — https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest

PageSpeed Insights moved to Lighthouse 12.0 on 2024-05-10, which removed the PWA category
outright. The service-worker check had been dropped a version earlier, following Chrome's change:
*"we have removed the requirement to have a service worker that implements the `fetch()` method
for installation from the menu, since version 108 on mobile and 112 on Desktop."*
— https://developer.chrome.com/blog/update-install-criteria

⚠ **`specs/00-brief.md`'s acceptance checklist says "Installable PWA, passes Lighthouse PWA +
performance budget."** The "Lighthouse PWA" half is **not achievable** with any current
Lighthouse — those audits do not exist. This does not contradict `stack-facts.md`, which is silent
on Lighthouse. It needs rewording; see Open decision.

### What to verify instead

The criteria the (deprecated) audit checked, which remain the de-facto Chromium install
requirements — quoted verbatim:

> 1. **Name**: A `short_name` or `name` property
> 2. **Icons**: An `icons` property with both 192x192 px and 512x512 px icons
> 3. **Start URL**: A `start_url` property
> 4. **Display Mode**: A `display` property set to `fullscreen`, `standalone`, or `minimal-ui`
> 5. **Related Applications**: A `prefer_related_applications` property set to something other than `true`

MDN, *Making PWAs installable*, for Chromium browsers requires: `name` or `short_name`; `icons`
containing *"a 192px and a 512px icon"*; `start_url`; `display` and/or `display_override`;
`prefer_related_applications` false or absent; and serving over **HTTPS** (or `localhost` /
`127.0.0.1`). It states a service worker is *not required* for installability, though most PWAs
ship one for offline. Chrome's own post adds that the **install-prompt** algorithm (as opposed to
menu install) still wanted a `fetch` handler, *"though this is being reconsidered"* — so keep the
`fetch` listener, which `serwist.addEventListeners()` gives us.

Our `app/manifest.ts` in §7c satisfies all five.

**Concrete Phase-1 Definition of Done replacement:**

* `npx lighthouse <url> --only-categories=performance,accessibility,best-practices,seo` meets the
  brief's budget (LCP < 2.5 s on mid-range mobile, per-route client JS < 200 KB gzipped).
* Chrome DevTools → **Application → Manifest**: no errors, "Installability: … installable"; the
  install affordance appears in the omnibox.
* `curl -I https://<host>/sw.js` → `200`, `text/javascript`, short `Cache-Control`.
* DevTools → Application → **Service Workers**: exactly one activated SW, scope
  `https://<host>/`.
* DevTools → Application → **Cache Storage** → `serwist-precache-v2` contains `/~offline` plus the
  `_next/static` chunks.
* Offline toggle → hard-navigate to a route never visited → `/~offline` renders.
* iPhone: Share → Add to Home Screen → launches chromeless with a black status bar; log a full
  workout in airplane mode.

---

## Recommendation

**Configurator mode.** Concretely, for Phase 1 and `DECISIONS.md`:

1. `npm i -D @serwist/next@9.5.12 @serwist/cli@9.5.12 serwist@9.5.12 esbuild@0.28.1 concurrently cross-env`.
   Do **not** install `@serwist/turbopack`.
2. `serwist.config.mts` (§2b): `swSrc: "app/sw.ts"`, `swDest: "public/sw.js"`,
   `additionalPrecacheEntries: [{ url: "/~offline", revision: <BUILD_ID> }]`, and `globIgnores`
   covering `public/_headers`.
3. `app/sw.ts` exactly as the official template, plus `navigateFallback: "/~offline"` and
   `navigateFallbackDenylist`.
4. `"build": "next build && cross-env NODE_ENV=production serwist build serwist.config.mts"`, and
   let `opennextjs-cloudflare build` call it. Never run `serwist build` after
   `opennextjs-cloudflare build`.
5. `public/_headers` with `no-cache` for `/sw.js` and `immutable` for `/_next/static/*`.
6. `<SerwistProvider swUrl="/sw.js" reloadOnOnline={false}>` in the root layout.
7. Root layout stays **static** — no `cookies()` / `headers()`. Auth resolution moves to
   middleware / proxy or a child layout. CI asserts `.next/server/app/~offline.html` exists.
8. `app/manifest.ts` → `/manifest.webmanifest`; icons as static files in `public/icons/` with
   separate `any` and `maskable` entries; `theme_color` / `background_color` `#000000`.
9. Two tsconfigs: app (no `webworker` lib, no `types` allow-list) and `tsconfig.sw.json`
   (`lib: ["esnext","webworker"]`, `skipLibCheck: true`).

Why, in order of weight:

1. The SW becomes a **real static asset at root scope**, served by Cloudflare before the Worker,
   with headers we fully control via `_headers`. Turbopack mode's SW is a Worker response carrying
   `s-maxage=31536000` that `_headers` cannot touch. *(measured, §5c)*
2. Turbopack mode drags `esbuild` / `esbuild-wasm` / `@serwist/build` / `glob` / `source-map` into
   the Cloudflare Worker bundle via `serverExternalPackages`. *(mechanism traced §1c; outcome `UNVERIFIED`)*
3. Serwist's own code calls turbopack mode "experimental" and configurator mode supported, and the
   configurator docs say it eliminates the need for `@serwist/turbopack`. *(quoted, §1)*
4. Configurator mode builds after prerendering, so prerendered routes are precached automatically.
   *(quoted §1a, built §6b)*
5. `next.config.ts` stays free of Serwist, so there is no interaction with
   `initOpenNextCloudflareForDev()` or OpenNext's `patchOriginalNextConfig`.
6. Zero Worker invocations and zero CPU for `/sw.js`.

---

## Gotchas that will silently break us

Ordered by how quietly they fail.

### 1. `NODE_ENV` decides whether the SW caches anything — and esbuild's minify flag decides `NODE_ENV`

`@serwist/next/worker`'s `defaultCache` is a ternary on `process.env.NODE_ENV`:

```js
const defaultCache = process.env.NODE_ENV !== "production"
  ? [{ matcher: /.*/i, handler: new NetworkOnly() }]
  : [ /* 18 real strategies */ ];
```

Neither `@serwist/cli` nor `@serwist/turbopack` passes `process.env.NODE_ENV` in esbuild's
`define` (verified: the only `define` entry either adds is the `injectionPoint`). The value comes
from esbuild's implicit behaviour:

> "When using the build API, all `process.env.NODE_ENV` expressions are automatically defined to
> `"production"` if all minification options are enabled and `"development"` otherwise."
> — https://esbuild.github.io/api/#define

`serwist build` sets `minify: !isDev` where `isDev = process.env.NODE_ENV === "development"`.

VERIFIED (built), `NODE_ENV=development npx serwist build`:

```js
// node_modules/@serwist/next/dist/index.worker.mjs
var defaultCache = true ? [{
  matcher: /.*/i,
  handler: new NetworkOnly()
}] : [ … ];
```

`NetworkOnly` for every request. It installs fine, registers fine, activates fine, DevTools shows
a happy green service worker — and the app has **no runtime caching and no offline capability at
all**. Two ways to trip it:

* a stray `NODE_ENV=development` in the shell or CI — the CLI only *defaults* it:
  `if (!process.env.NODE_ENV) process.env.NODE_ENV = params.flags.watch ? "development" : "production"`;
* passing `esbuildOptions: { minify: false }` or even `{ minifyIdentifiers: false }` for
  debuggability — esbuild needs **all** minify options on.

**Fix:** `cross-env NODE_ENV=production serwist build …`, and never disable minify. Assert it in
CI: `grep -q "google-fonts-webfonts" public/sw.js`.

### 2. A single 404 in the precache manifest kills the whole service worker — and `public/_headers` is a 404

`serwist@9.5.12/src/lib/strategies/PrecacheStrategy.ts`:

```ts
    if (!wasCached) {
      // Throwing here will lead to the `install` handler failing, which
      // we want to do if *any* of the responses aren't safe to cache.
      throw new SerwistError("bad-precaching-response", { url: request.url, status: response.status });
    }
```

Default `globPatterns` include `public/**/*`. Cloudflare does not serve `_headers` as an asset —
VERIFIED (built): `GET /_headers` → **404**. So the moment you add `public/_headers` (which §5d
requires), `/​_headers` enters the manifest, install throws `bad-precaching-response`, and you have
**no service worker at all**. Same for `_redirects` and `_routes.json`.
**Fix:** `globIgnores: ["public/_headers", "public/_redirects", "public/_routes.json"]`.

### 3. A dynamic root layout silently removes every precached route

§6c, with build output. `cookies()` in the root layout ⇒ all routes `ƒ` ⇒ only
`_global-error.html` prerendered ⇒ that one is globIgnored ⇒ `precachePrerendered` precaches
nothing and `/~offline` never enters the manifest. **Fix:** keep the root layout static; assert
`.next/server/app/~offline.html` in CI.

### 4. `fallbacks` does not precache, and neither does `navigateFallback`

Both resolve through `matchPrecache()`. Not in the manifest ⇒ `undefined` ⇒ the browser's offline
page. **Fix:** always pair them with `additionalPrecacheEntries`.

### 5. `reloadOnOnline` defaults to `true`

`window.addEventListener("online", () => location.reload())`. In a basement gym with one bar this
reloads the page repeatedly, mid-workout, discarding unsaved React state. Directly contradicts the
brief's "a full workout is loggable with no network". **Fix:** `reloadOnOnline={false}`.

### 6. `serwist.config.js` + a non-ESM `package.json`

`@serwist/cli` loads the config with `await import(pathToFileURL(configPath).href)`, and the
default filename is `serwist.config.js` — VERIFIED (source), `dist/chunks/constants-Dcy7HyXu.js`:
`defaultConfigFile: "serwist.config.js"`. In a Next project without `"type": "module"`, that
file's `export default` is ESM in a CJS scope. On Node 24.12.0 it still works via module-syntax
detection but emits `[MODULE_TYPELESS_PACKAGE_JSON] Warning … Reparsing as ES module` — VERIFIED
(built). On older Node it is a hard failure (`invalid-common-js-module`).
**Fix:** use `serwist.config.mts` and pass it explicitly: `serwist build serwist.config.mts`.
VERIFIED (built) — clean, no warning; Node 24's native type-stripping handles the TypeScript.

### 7. Docs bug: the `@serwist/cli` page says the injection point is `self.__WB_MANIFEST`

The real default is `self.__SW_MANIFEST` (`@serwist/build` zod schema). Using `__WB_MANIFEST` in
`sw.ts` means no manifest is injected, `precacheEntries` is `undefined`, and you get a SW that
precaches nothing — with no error anywhere.

### 8. `maximumFileSizeToCacheInBytes` defaults to 2 MiB

`@serwist/build` schema: `maximumFileSizeToCacheInBytes: z.number().default(2097152)`. Larger
files are dropped from the manifest with a build warning that scrolls past. Relevant to exercise
GIFs — keep them in R2 behind runtime caching, not in `public/`.

### 9. `"types": ["@serwist/next/typings"]` in tsconfig disables all other `@types/*`

`types` is an allow-list. Adding it (as the official example does) drops automatic `@types/node`,
`@types/react`, etc. And it only declares `Window.serwist`, which `@serwist/next/react` already
declares. **Fix:** omit it.

### 10. `lib: ["dom", …, "webworker"]` requires `skipLibCheck: true`

VERIFIED (built): **35 errors** with `skipLibCheck: false` (TS6200 identifier conflicts, TS2374
duplicate index signatures). And even in an isolated worker tsconfig, `serwist@9.5.12`'s own
`.d.ts` needs `skipLibCheck: true` for `URLPattern` / `URLPatternInit` — 2 errors otherwise.

### 11. Never put `opennextjs-cloudflare build` in the `build` script

OpenNext *runs* `npm run build`. Self-reference ⇒ infinite recursion. Use a separate `cf:build` /
`deploy` script. (Related: `opennextjs-cloudflare deploy` sets `OPEN_NEXT_DEPLOY=true` specifically
to stop `wrangler deploy` re-entering `opennextjs-cloudflare deploy`.)

### 12. `next.config.ts` `headers()` cannot touch `/sw.js`

Assets are served before the Worker; Next's header rules run inside the Worker. `public/_headers`
is the only lever. Limits: 100 rules, 2000 chars per line.

### 13. `--skipNextBuild` without standalone mode produces a broken bundle

`opennextjs-cloudflare build` is what sets `NEXT_PRIVATE_STANDALONE=true`. If you skip its build
step, `createCacheAssets` finds no `.next/standalone/...` and you ship an app with an empty
incremental cache. Either let OpenNext run the build (recommended) or set the env var yourself.

### 14. If Cloudflare Access is put in front of the zone, SW registration will break

The brief lists Cloudflare Access as an auth option. Access sits in front of static assets too, so
once its cookie expires `GET /sw.js` returns a redirect to the Access login page, and a non-JS
content type aborts SW registration / update. `UNVERIFIED` — not tested. If we choose Access,
either add a bypass policy for `/sw.js`, `/manifest.webmanifest` and `/icons/*`, or choose
passkeys / magic-link instead.

### 15. Stale-blog-post trip list

* "Serwist requires webpack" / "use `next build --webpack`" — false since Serwist 9.4;
  `stack-facts.md` already flags this. Both configurator and turbopack modes work with the default
  Turbopack build.
* "Use next-pwa" — unmaintained predecessor; its `next.config` API does not exist in Serwist 9.5.
* "Add `<meta name="apple-mobile-web-app-capable">`" — Next 16.3.5 emits the standard
  `mobile-web-app-capable` from `appleWebApp.capable`. Verified §7b.
* "`themeColor` goes in `metadata`" — deprecated since Next 14; it lives in `viewport`. The Next
  docs say so explicitly.
* "`app/manifest.ts` is served at `/manifest.json`" — it is `/manifest.webmanifest`.
* "Run Lighthouse's PWA audit / check your PWA score" — the category was deleted in Lighthouse
  12.0 (2024-05-10); 13.4.1 has zero PWA audits.
* "iOS needs `apple-mobile-web-app-capable` to go standalone" — since iOS 26 every Home Screen site
  opens as a web app by default, and manifest `display` has been honoured for far longer.
* "Web push works in iOS Safari" — only for a web app added to the Home Screen, iOS 16.4+, with
  manifest `display: standalone|fullscreen`.
* "`export const runtime = 'edge'`" — `stack-facts.md`: unsupported by OpenNext, never use it.
* "`opennextjs-cloudflare build` just wraps `next build`" — it runs your **`package.json` build
  script**, whatever that happens to be.
* Anything that has you write the service worker to `public/` *after*
  `opennextjs-cloudflare build`. It will not be deployed, and nothing will tell you.

---

## Open decision for the owner

**One decision, and it is a wording change, not an engineering one.**

`specs/00-brief.md`'s final acceptance checklist item 1 reads "Installable PWA, passes Lighthouse
PWA + performance budget". The Lighthouse PWA category and every installability audit were removed
in Lighthouse 12.0 and are absent from 13.4.1 (§8). The criterion cannot be met as written.

* **Option A (recommended).** Replace it with: *"Installable PWA — Chrome DevTools → Application →
  Manifest reports installable with no errors; the install affordance appears; the checklist in
  `docs/research/r05-serwist-pwa-on-next16.md` §8 passes — and Lighthouse
  `performance, accessibility, best-practices, seo` meet the budget."* Costs nothing, is verifiable
  today, and keeps the performance/a11y teeth the brief wanted.
* **Option B.** Pin `lighthouse@11.x` in CI purely so a "PWA score" number exists. Rejected: an
  abandoned audit set, a two-year-old Lighthouse in CI, and a metric Google no longer computes.

**My recommendation: Option A.**

Two lesser calls I made rather than escalated, flagged so they can be overruled:

* I chose `public/sw.js` + `_headers` over turbopack mode's `/serwist/sw.js`. If someone insists on
  turbopack mode, the mitigation is to wrap the exported `GET` and set `Cache-Control` yourself —
  the entry's own headers beat the computed ones (§5b) — but you still pay a Worker invocation per
  SW fetch and still carry the esbuild bundling risk. I do not recommend it.
* I chose two tsconfigs over the official single-tsconfig `lib: [… "webworker"]` +
  `types: ["@serwist/next/typings"]`. If you prefer to stay byte-identical to the docs, keep
  `skipLibCheck: true` and add `@types/node` / `@types/react` back to `types` explicitly.

---

## Sources

### Local files read

* `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
* `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

### Installed package source read (all `9.5.12` / `1.20.6`, inspected in the scratchpad)

* `@serwist/turbopack/src/index.ts`, `src/lib/build.ts`, `src/lib/validate.ts`,
  `src/lib/constants.ts`, `src/index.react.tsx`, `dist/index.d.mts`, `dist/index.react.d.mts`,
  `package.json`
* `@serwist/next/src/index.config.ts`, `src/lib/config/utils.ts`, `src/index.worker.ts`,
  `dist/index.mjs`, `dist/index.worker.mjs`, `dist/index.react.mjs`, `dist/sw-entry.d.mts`,
  `dist/index.config.d.mts`, `package.json`
* `@serwist/cli/cli.js`, `dist/bin.mjs`, `dist/chunks/errors-DXCDZqq6.js`,
  `dist/chunks/constants-Dcy7HyXu.js`, `package.json`
* `@serwist/build/dist/chunks/inject-manifest-8Ec3euyW.js`, `dist/chunks/glob-CZkjMdJs.js`
* `serwist/src/Serwist.ts`, `src/lib/strategies/PrecacheStrategy.ts`,
  `src/lib/precaching/PrecacheFallbackPlugin.ts`, `src/models/messages/messages.ts`
* `@opennextjs/cloudflare/dist/cli/index.js`, `dist/cli/commands/build.js`,
  `dist/cli/commands/deploy.js`, `dist/cli/build/build.js`, `dist/cli/build/bundle-server.js`,
  `dist/cli/build/patches/plugins/optional-deps.js`, `dist/cli/utils/nextjs-support.js`,
  `dist/cli/utils/create-wrangler-config.js`, `dist/cli/templates/worker.js`,
  `templates/wrangler.jsonc`, `templates/open-next.config.ts`
* `@opennextjs/aws/dist/build/buildNextApp.js`, `dist/build/createAssets.js`,
  `dist/build/helper.js`, `dist/core/routing/cacheInterceptor.js`, `dist/utils/cacheHeaders.js`,
  `dist/types/open-next.d.ts`

### Serwist

* https://serwist.pages.dev/docs/next/config — configurator mode (primary source for §2)
* https://serwist.pages.dev/docs/next/turbo — `@serwist/turbopack`
* https://serwist.pages.dev/docs/next/getting-started — webpack mode
* https://serwist.pages.dev/docs/cli — `@serwist/cli` (note: `__WB_MANIFEST` there is stale)
* https://serwist.pages.dev/docs/serwist/core/serwist — `Serwist` options, `fallbacks`
* https://github.com/serwist/serwist/tree/main/examples/next-basic-cli — configurator example
* https://github.com/serwist/serwist/tree/main/examples/next-turbo-basic — turbopack example
  (note: pins `serwist: "preview"`, i.e. the `10.0.0-preview` line, and `next 16.2.10`)
* https://github.com/serwist/serwist/issues/54 — Turbopack support tracking issue

### Cloudflare / OpenNext

* https://developers.cloudflare.com/workers/static-assets/headers/ — default `Cache-Control`,
  `_headers` location / syntax / limits, "not applied to responses generated by your Worker code"
* https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ — assets-first
  routing, `run_worker_first`
* https://opennext.js.org/cloudflare/caching — incremental cache / queue / tag cache
* https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter
  — "runs the build script in your package.json"
* https://github.com/opennextjs/opennextjs-cloudflare/issues/624 — `public/_headers` for asset
  cache control (community request; no maintainer guidance in the thread)

### Next.js 16.3.5 (docs fetched with `Accept: text/markdown`)

* https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
* https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
* https://nextjs.org/docs/app/api-reference/functions/generate-viewport
* https://nextjs.org/docs/app/api-reference/functions/generate-metadata

### Web platform

* https://esbuild.github.io/api/#define — implicit `process.env.NODE_ENV` from minify
* https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register — scope,
  `Service-Worker-Allowed`, `updateViaCache`
* https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
* https://web.dev/articles/service-worker-lifecycle — browsers ignore caching headers on SW update
  checks since Chrome 68
* https://github.com/mdn/browser-compat-data → `api/ServiceWorker.json` (`ecmascript_modules`:
  Chrome 91 / Safari 15 / Firefox 147)
* https://developer.chrome.com/blog/update-install-criteria — service-worker requirement removed
  (Chrome 108 mobile / 112 desktop)
* https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest — deprecation notice + the
  five manifest requirements
* https://github.com/GoogleChrome/lighthouse/blob/main/core/config/default-config.js — category
  list in 13.4.1, zero PWA audits
* https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ — iOS 16.4 Web Push, Home
  Screen + `display: standalone` requirement, `apple-touch-icon` precedence
* https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
  — iOS 26 "every website added to the Home Screen opens as a web app"

### Throwaway verification projects (scratchpad, safe to delete)

Under `C:/Users/tairc/AppData/Local/Temp/claude/C--Users-tairc-Documents-codespace-fitness-app-tair/85fb1989-5a8f-448f-9e9a-162342b812b6/scratchpad/`:

* `onext/`, `onext2/` — Next 16.3.5 + OpenNext 1.20.6 builds; asset-copy proof, live header
  measurements for `/sw.js` and `/serwist/sw.js`, prerender-vs-dynamic layout experiment,
  metadata/icon `<head>` capture
* `swtest/` — `@serwist/cli` `NODE_ENV` / minify experiment, config-file-extension experiment,
  tsconfig experiments
* `hdrtest/` — assets-only Worker, `_headers` behaviour and `/_headers` 404
* `probe/`, `probe2/` — package source inspection
