# R11 — i18n for RU (default) + EN on Next.js 16.3.5 App Router / Cloudflare Workers (OpenNext)

Researched and verified **2026-09-12**. Stack baseline: [`docs/research/stack-facts.md`](./stack-facts.md)
(`next@16.3.5`, `@opennextjs/cloudflare@1.20.6`, `wrangler@4.131.1`, `serwist@9.5.12`).
Product intent: [`specs/00-brief.md`](../../specs/00-brief.md) — "i18n RU/EN (default RU). Units kg.
Timezone Asia/Almaty", single user, offline-first installable PWA.

Nothing here contradicts `stack-facts.md`. It **extends** it with one new platform fact that
changes a design decision (OpenNext's Node-middleware path is explicitly unsupported) and one
that contradicts *Cloudflare's own documentation* (local `workerd` timezone — see §8.2).

---

## Question

1. `next-intl` or a hand-rolled `messages/{ru,en}.json` + `getDictionary()` + tiny client context?
2. Is the current `next-intl` compatible with Next 16.3.5, and does its middleware compose with
   our auth middleware?
3. Are `[locale]` URL segments worth their cost for a single-user app with no SEO, or is a
   cookie-based locale with no URL prefix better? (Including PWA `start_url` / service-worker
   precache implications.)
4. Russian pluralization (3–4 forms: one/few/many/other) via `Intl.PluralRules`.
5. Is full ICU data actually present in `workerd`? Do `Intl` number/date formats work for
   `ru-RU` in `Asia/Almaty` on Workers?
6. Where must the timezone be pinned so "today" is correct?

---

## Verified answer

### 0. Summary of what was verified

| Claim | Verdict | How verified |
|---|---|---|
| `next-intl` latest is **4.14.4** | VERIFIED | `npm view next-intl version` |
| `next-intl@4.14.4` peer-allows `next ^16.0.0` | VERIFIED | `npm view next-intl peerDependencies` |
| `next-intl` has explicit Next-16 branching | VERIFIED | read `dist/esm/production/plugin/nextFlags.js` |
| `createNextIntlPlugin()` is essentially one module alias | VERIFIED | read `dist/esm/production/plugin/getNextConfig.js` |
| Next 16 renamed `middleware.ts` → `proxy.ts`, Node runtime only | VERIFIED | nextjs.org docs (quoted below) |
| OpenNext's Node-middleware (`proxy.ts`) support is **experimental & unsupported** | VERIFIED | read `@opennextjs/cloudflare@1.20.6` source header comment |
| `next-intl` works with **no middleware at all** (cookie locale, no prefix) | VERIFIED | next-intl.dev "without i18n routing" docs |
| `workerd` ships full ICU: 418 tz, `ru-RU` data, all 4 RU plural categories | VERIFIED | ran a probe Worker under `wrangler dev` (output below) |
| RU plurals correct through `use-intl` and through raw `Intl.PluralRules` | VERIFIED | executed both (outputs below) |
| Local `wrangler dev` does **not** run at `TZ=UTC` on Windows | VERIFIED (contradicts CF docs) | probe Worker, with and without `TZ=UTC` exported |
| Cloudflare Cron Triggers are UTC | VERIFIED | Cloudflare docs |
| SQLite/D1 `date('now')` is UTC | VERIFIED | sqlite.org docs |
| Client bundle: next-intl 12.5 KB gz / 3.7 KB gz precompiled / hand-rolled 0.43 KB gz | VERIFIED | esbuild + gzip, numbers below |

---

### 1. Versions and Next 16 compatibility

```
$ npm view next-intl version dist-tags peerDependencies
version = '4.14.4'
dist-tags = {
  'v4-beta': '4.0.0-beta-dea867b',
  canary: '0.0.0-canary-061f08c',
  latest: '4.14.4'
}
peerDependencies = {
  next: '^12.0.0 || ^13.0.0 || ^14.0.0 || ^15.0.0 || ^16.0.0',
  react: '^16.8.0 || ^17.0.0 || ^18.0.0 || >=19.0.0-rc <19.0.0 || ^19.0.0'
}
```

`next@16.3.5` satisfies `^16.0.0`. Runtime deps of `next-intl@4.14.4`:

```json
{
  "use-intl": "^4.14.4",
  "@swc/core": "~1.16.0",
  "icu-minify": "^4.14.4",
  "negotiator": "^1.0.0",
  "@eloqnt/config": "^0.1.0",
  "@parcel/watcher": "^2.4.1",
  "@eloqnt/format-po": "^0.1.0",
  "@eloqnt/format-json": "^0.1.0",
  "@formatjs/intl-localematcher": "^0.8.1",
  "next-intl-swc-plugin-extractor": "4.14.4"
}
```

`@swc/core`, `@parcel/watcher`, `next-intl-swc-plugin-extractor` and the `@eloqnt/*` packages are
**build-time only** (the optional message-extraction pipeline). They never reach the Worker bundle.
`use-intl@4.14.4` depends on `@formatjs/fast-memoize`, `@schummar/icu-type-parser`, `icu-minify`
and `intl-messageformat@^11.1.0` (installed: `11.2.14`).

`next-intl` is not merely "peer-compatible" with Next 16 — it branches on it. Verbatim from
`node_modules/next-intl/dist/esm/production/plugin/nextFlags.js` (minified, unmodified):

```js
function e(){return n(r(),"15.3.0")>=0}function o(){return n(r(),"16.0.0")>=0}
export{e as hasStableTurboConfig,o as isNextJs16OrHigher};
```

And from `dist/types/plugin/nextFlags.d.ts`:

```ts
export declare function hasStableTurboConfig(): boolean;
export declare function isNextJs16OrHigher(): boolean;
```

Two `next-intl` features are **hard-gated on Next 16** (verbatim error strings from
`dist/esm/production/plugin/getNextConfig.js`):

- `"Message extraction requires Next.js 16 or higher."`
- `"Message catalog loading requires Next.js 16 or higher."`

### 2. What `createNextIntlPlugin()` actually does (important for OpenNext)

Read from `dist/esm/production/plugin/getNextConfig.js`. The essential behaviour:

```js
const m = null != process.env.TURBOPACK, x = m || a();   // a = isNextJs16OrHigher
...
const s = {"next-intl/config": f(e.requestConfig)};
...
l() && !t?.experimental?.turbo
  ? g.turbopack = {...t?.turbopack, ...m && {rules:m}, resolveAlias:{...t?.turbopack?.resolveAlias, ...s}}
  : g.experimental = {...t?.experimental, turbo:{...}}
```

and the request-config auto-discovery:

```js
for(const e of [...m("./i18n/request"),...m("./src/i18n/request")])if(s(e))return e;
```

where `m(e)` returns the four candidates `${e}.ts`, `${e}.tsx`, `${e}.js`, `${e}.jsx`.

**Conclusion:** on Next 16 the plugin's whole job is to alias the module specifier
`next-intl/config` → `./(src/)i18n/request.ts` (plus, optionally, register two Turbopack loaders
if you opt into extraction/catalogs). It is a `resolveAlias`, not a bundler-internals patch. That
is why it is safe with Turbopack (default in Next 16) and irrelevant to OpenNext, which consumes
the *output* of `next build`, not the Next config.

Two plugin constraints worth recording:

- Turbopack + an **absolute** `requestConfig` path is rejected: `"Turbopack support for next-intl
  currently does not support absolute paths, please provide a relative one (e.g.
  './src/i18n/config.ts')."`
- `trailingSlash: true` in `next.config.ts` makes the plugin inject `env._next_intl_trailing_slash`.
  Don't set `trailingSlash` unless you mean it.

### 3. Middleware: Next 16 renamed it, and OpenNext's support for the new form is UNSUPPORTED

Verbatim, https://nextjs.org/docs/app/guides/upgrading/version-16 :

> The `middleware` filename is deprecated, and has been renamed to `proxy` to clarify network
> boundary and routing focus.
>
> The `edge` runtime is **NOT** supported in `proxy`. The `proxy` runtime is `nodejs`, and it
> cannot be configured. If you want to continue using the `edge` runtime, keep using `middleware`.

Verbatim, https://nextjs.org/docs/app/api-reference/file-conventions/proxy :

> Proxy defaults to using the Node.js runtime. The [`runtime`] config option is not available in
> Proxy files. Setting the `runtime` config option in Proxy will throw an error.

> The file must export a single function, either as a default export or named `proxy`. Note that
> multiple proxy from the same file are not supported.

Version history table on that page:

> | `v16.0.0` | Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime |

Codemod: `npx @next/codemod@canary middleware-to-proxy .`

**Now the load-bearing platform fact.** `@opennextjs/cloudflare@1.20.6` does implement
`proxy.ts` — file `dist/cli/build/open-next/bundle-node-middleware.js` exists and is called
when a Node middleware is detected (`dist/cli/build/build.js`):

```js
// Compile middleware
await createMiddleware(options, { forceOnlyBuildOnce: true });
if (hasNodeMiddleware) {
    await bundleNodeMiddleware(options);
}
```

Detection is automatic (no opt-in flag) — `dist/cli/build/utils/middleware.js`:

```js
export function useNodeMiddleware(options) {
    const buildOutputDotNextDir = path.join(options.appBuildOutputPath, ".next");
    // Look for the edge middleware
    const middlewareManifest = loadMiddlewareManifest(buildOutputDotNextDir);
    const edgeMiddleware = middlewareManifest.middleware["/"];
    if (edgeMiddleware) {
        // The app uses an edge middleware
        return false;
    }
    // Look for the node middleware
    const functionsConfigManifest = loadFunctionsConfigManifest(buildOutputDotNextDir);
    return Boolean(functionsConfigManifest?.functions["/_middleware"]);
}
```

But the adapter's own header comment on that file says, verbatim:

```
/**
 * Bundles the Node.js middleware (`proxy.ts` / `middleware.ts` with the `nodejs` runtime)
 * into a Workers compatible `middleware/handler.mjs`.
 *
 * NOTE: Running Next.js Node.js middleware on workerd is experimental and is not supported
 * by the OpenNext maintainers. It re-bundles the middleware compiled by Next.js, which is an
 * internal output that can change between Next.js versions.
 *
 * `@opennextjs/aws` bundles the external middleware for a Node.js server:
 * the OpenNext config is read from the filesystem at runtime and the middleware compiled
 * by Next.js is loaded with `await import("./.next/server/middleware.js")`.
 *
 * workerd can not access the filesystem nor load modules at runtime, so the handler
 * built by `@opennextjs/aws` is replaced with a fully self-contained bundle:
 *
 * - the config manifests are inlined by `openNextEdgePlugins` (as for the edge middleware)
 * - the middleware compiled by Next.js is statically bundled from the traced files that
 *   `@opennextjs/aws` copies to `middleware/<package path>/.next/server/middleware.js`
 */
```

That is not a warning about i18n specifically — it applies to **any** `proxy.ts` we ship,
auth included. And `https://opennext.js.org/cloudflare` still says (verbatim) *"Node Middleware
introduced in 15.2 are not yet supported"* alongside *"All minor and patch versions of Next.js 16
and the latest minors of Next.js 14 and 15 are supported."* Those two statements cannot both be
fully true for Next 16, whose `proxy` is Node-only; the source is the more reliable of the two and
it says *experimental, unsupported, re-bundles an internal Next output*.

**Design consequence:** every kilobyte of logic we put in `proxy.ts` rides an explicitly
unsupported code path that "can change between Next.js versions". So:

- Do **not** add `next-intl`'s `createMiddleware` to it.
- Keep `proxy.ts` as thin as we can get away with (or, better, do auth in a root layout /
  Server Function guard and keep no `proxy.ts` at all — that is R-auth's call, not this note's).

### 4. Does `next-intl` compose with our auth middleware? Yes — but we should not need to find out

For the record: `createMiddleware` returns a **synchronous** function, so composition is
mechanical. From `dist/types/middleware/middleware.d.ts`:

```ts
export default function createMiddleware<...>(routing: RoutingConfig<...>):
  (request: NextRequest) => NextResponse<unknown>;
```

The documented composition pattern (verbatim from https://next-intl.dev/docs/routing/middleware —
note that the docs already use the Next 16 `proxy` name):

```ts
import createMiddleware from 'next-intl/middleware';
import {NextRequest} from 'next/server';

export default async function proxy(request: NextRequest) {
  // Step 1: Use the incoming request (example)
  const defaultLocale = request.headers.get('x-your-custom-locale') || 'en';

  // Step 2: Create and call the next-intl middleware (example)
  const handleI18nRouting = createMiddleware({
    locales: ['en', 'de'],
    defaultLocale
  });
  const response = handleI18nRouting(request);

  // Step 3: Alter the response (example)
  response.headers.set('x-your-custom-locale', defaultLocale);

  return response;
}

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)'
};
```

The catch is ordering. `createMiddleware` **returns a `NextResponse` of its own** (a rewrite or a
redirect). An auth guard that wants to redirect to `/login` must run *before* it and return early,
and any cookie/header the auth guard set on its own response object is lost if the i18n response
replaces it. That is solvable, but it is exactly the kind of "two middlewares fighting over one
response object" bug that is painful to debug on a platform where the whole `proxy.ts` path is
experimental. **We avoid it entirely by not using `createMiddleware`.**

For completeness, the routing knobs (`dist/types/routing/config.d.ts`) include
`localePrefix?: 'always' | 'as-needed' | 'never'`, `localeCookie?: boolean | CookieAttributes`,
`localeDetection?: boolean`, `alternateLinks?: boolean`. The default cookie is, verbatim from
`dist/esm/production/routing/config.js`:

```js
localeCookie:(o=e.localeCookie,!!(o??1)&&{name:"NEXT_LOCALE",sameSite:"lax",..."object"==typeof o&&o})
```

i.e. `NEXT_LOCALE`, `sameSite: 'lax'`. Note `localePrefix: 'never'` exists — but it still runs the
middleware and still rewrites internally to a `/[locale]/...` tree, so it buys us nothing here.

Locale detection priority with the middleware, paraphrased from the docs: URL prefix → cookie →
`accept-language` (matched with *"the 'best fit' algorithm of `@formatjs/intl-localematcher`"*) →
`defaultLocale`. We reimplement only the cookie → default steps, in `i18n/request.ts`.

### 5. `next-intl` with **no** routing, no middleware, no `[locale]` segment

This is a first-class, documented mode. Verbatim from
https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing :

> "If your app doesn't require unique pathnames per locale, you can provide a locale to
> `next-intl` based on user preferences or other application logic."

`src/i18n/request.ts`:

```ts
import {getRequestConfig} from 'next-intl/server';

export default getRequestConfig(async () => {
  const locale = 'en';
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});
```

`next.config.ts`:

```ts
import {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {};
const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
```

`app/layout.tsx`:

```tsx
import {NextIntlClientProvider} from 'next-intl';

type Props = {
  children: React.ReactNode;
};

export default async function RootLayout({children}: Props) {
  return (
    <html>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

Dynamic locale from a cookie — verbatim, "The simplest option is to use a cookie":

```ts
import {cookies} from 'next/headers';
import {getRequestConfig} from 'next-intl/server';

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = store.get('locale')?.value || 'en';
  return {
    locale
    // ...
  };
});
```

Note `<NextIntlClientProvider>` with **no props**: it inherits locale/messages/timeZone/now/formats
from the request config when rendered from a Server Component. Verbatim from
`dist/types/shared/NextIntlClientProvider.d.ts`:

```ts
type Props = Omit<ComponentProps<typeof IntlProvider>, 'locale'> & {
    /** This is automatically received when being rendered from a Server Component. In all other cases, e.g. when rendered from a Client Component, a unit test or with the Pages Router, you can pass this prop explicitly. */
    locale?: Locale;
};
```

Also relevant: `requestLocale` (the `[locale]`-segment plumbing) is now **deprecated**. Verbatim
from `dist/types/server/react-server/getRequestConfig.d.ts`:

```ts
    /**
     * Typically corresponds to the `[locale]` segment that was matched by the middleware.
     * ...
     * @deprecated Please migrate to [`next/root-params`](https://next-intl.dev/blog/nextjs-root-params).
     * @see https://next-intl.dev/docs/usage/configuration#i18n-request
     */
    requestLocale: Promise<string | undefined>;
```

So the `[locale]`-segment path is itself mid-migration (to Next 16.3's `next/root-params`, which
per next-intl's own blog post "currently doesn't work in Route Handlers or Server Actions"). One
more reason not to adopt segments. (Next 16 also *removed* `unstable_rootParams` outright — see the
upgrade guide's Removals section.)

### 6. Why `[locale]` segments are **not** worth it here

| Cost of `[locale]` | Detail |
|---|---|
| Requires `proxy.ts` | The prefix has to be applied by `createMiddleware` → the OpenNext experimental path in §3. |
| Doubles the route tree | Every route exists twice; `generateStaticParams` for both; two prerenders of every static page. |
| Doubles the PWA precache | Serwist precaches by concrete URL (see below). `/ru/dashboard` and `/en/dashboard` are two entries. |
| Breaks a single `start_url` | See below. |
| Offline fallback ambiguity | Which of `/ru/offline` / `/en/offline` does the SW serve? Needs a cookie-aware matcher inside the SW. |
| Sits on a deprecating API | `requestLocale` is deprecated; `next/root-params` doesn't work in Route Handlers or Server Actions yet. |
| Buys us | SEO per locale (irrelevant — single user, auth on all routes) and shareable per-locale links (irrelevant). |

**PWA `start_url`.** Verbatim from MDN:

> "The `start_url` manifest member is used to specify the URL that should be opened when a user
> launches your web application, such as when tapping the application's icon on their device's
> home screen or in an application list."
>
> "If `scope` is not specified in the manifest it will be inferred from the `start_url` (or
> effective `start_url` if the value is undefined or invalid)."
>
> "**Note:** The `start_url` is a hint for browsers. Browsers have flexibility in how they handle
> `start_url` and may not always use the specified value."

`start_url` is a single string. With locale prefixes you must either (a) hardcode
`start_url: "/ru"` and accept that switching to EN leaves the installed icon pointing at RU
(the manifest is read at install time; post-install changes are not reliably honoured —
**UNVERIFIED** for specific browser versions, but the spec language above makes `start_url` a
*hint* in any case), or (b) keep `start_url: "/"` and add a redirect, which means the app *always*
costs an extra navigation on cold launch — the worst possible place to add latency for a
"speed-of-logging above all" app. With no prefix, `start_url: "/"` and `scope: "/"` are simply
correct for both locales, forever.

**Serwist precache / fallback.** Offline fallbacks are keyed by a concrete precached URL string.
Verbatim from `serwist@9.5.12` `dist/index.d.mts`:

```ts
interface PrecacheFallbackEntry {
  /**
   * A precached URL to be used as a fallback.
   */
  url: string;
  /**
   * A function that checks whether the fallback entry can be used
   * for a request.
   */
  matcher: (param: HandlerDidErrorCallbackParam) => boolean;
}
interface FallbackEntry extends PrecacheFallbackEntry {}
interface FallbacksOptions {
  /**
   * A list of fallback entries.
   */
  entries: FallbackEntry[];
}
```

A service worker cannot cheaply read `document.cookie`, so picking between `/ru/offline` and
`/en/offline` inside `matcher` means either reading the request URL prefix (works — but the *entry*
navigation to `/` has no prefix yet) or hauling in `cookieStore` (not universally available).
With no prefix there is exactly one `/offline` entry and exactly one precache manifest.

**Verdict: cookie-based locale, no URL prefix, no `[locale]` segment, no i18n middleware.**

### 7. ICU data in `workerd` — VERIFIED empirically

`workerd` embeds Chromium's full ICU data file. Verbatim from
`https://raw.githubusercontent.com/cloudflare/workerd/main/BUILD.bazel`:

```
# This is used to embed the ICU data file which libicu needs at runtime to do its thing.
# We bake this file into the binary to avoid shipping it separately. (V8's normal GN build can
# actually do this for us, but we use the Bazel build which doesn't have this option.) Using #embed
# makes this very fast and convenient.
wd_cc_embed(
    name = "icudata-embed",
    src = "@com_googlesource_chromium_icu//:common/icudtl.dat",
    base_name = "icu-data-file",
```

Cloudflare's own docs say only (verbatim, https://developers.cloudflare.com/workers/runtime-apis/web-standards/):

> "The `Intl` API allows you to format dates, times, numbers, and more to the format that is used
> by a provided locale (language and region)."

So I measured it. I built a probe Worker in the scratchpad and ran it under
`wrangler@4.131.1 dev` (`compatibility_date: "2026-09-01"`, `compatibility_flags: ["nodejs_compat"]`).
Actual JSON response (trimmed; every value below is real output, not reconstructed):

```json
{
  "resolvedDefaultTZ": "Asia/Qyzylorda",
  "supportedValuesOfTimeZoneCount": 418,
  "almatyIncluded": true,
  "almatyFull": "воскресенье, 13 сентября 2026 г. в 00:30:00 GMT+5",
  "almatyParts": "2026-09-13",
  "almatyOffsetName": "9/13/2026, GMT+05:00",
  "ruMonthsStandalone": ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"],
  "ruWeekdayShort": "сб",
  "pluralCategories": ["one","few","many","other"],
  "pluralSamples": {"0":"many","1":"one","2":"few","3":"few","4":"few","5":"many","11":"many","12":"many","21":"one","22":"few","25":"many","100":"many","101":"one","111":"many"},
  "ordinalCategories": ["other"],
  "numberRu": "1 234 567,89",
  "numberRuUnit": "82,5 кг",
  "numberRuCompact": "12 тыс.",
  "rtf": "вчера",
  "rtf2": "3 дня назад",
  "listFmt": "жим, тяга и присед",
  "dn": "английский",
  "collator": ["арбуз","Ёж","ёлка","яблоко"],
  "segmenter": "function",
  "durationFormat": "function"
}
```

Second probe, same runtime:

```json
{
  "dtfSupportedLocalesOf": ["ru","ru-RU","en","en-US","en-CA","kk","kk-KZ","kk-Cyrl-KZ"],
  "pluralRulesSupportedLocalesOf": ["ru","ru-RU","en","kk"],
  "ruGenitiveMonth": "12 сентября",
  "ruStandaloneMonth": "сентябрь",
  "hourCycleRu": {"locale":"ru-RU","calendar":"gregory","numberingSystem":"latn","timeZone":"Asia/Almaty","hourCycle":"h23","hour12":false,"timeStyle":"short"},
  "almatyDstCheck": ["1/15/2026, GMT+05:00", "7/15/2026, GMT+05:00"],
  "historicalAlmaty2023": "7/15/2023, GMT+06:00",
  "numberFormatRuResolved": {"locale":"ru-RU","numberingSystem":"latn","style":"decimal","maximumFractionDigits":3,"useGrouping":"auto","roundingMode":"halfExpand"}
}
```

Conclusions, all VERIFIED:

- **Full ICU is available.** 418 IANA zones, `Asia/Almaty` present; `ru-RU` has real CLDR data
  (correct genitive `12 сентября` vs standalone `сентябрь` months, `h23` hour cycle, NBSP group
  separator in `1 234 567,89`, comma decimal, `кг` unit, compact `12 тыс.`, `RelativeTimeFormat`
  with `numeric:'auto'` producing `вчера`, `ListFormat`, `DisplayNames`, `Collator` with correct
  Russian collation placing `Ёж` between `арбуз` and `ёлка`, plus `Segmenter` and `DurationFormat`).
  **No polyfill is needed. Do not add `@formatjs/intl-*` polyfills or `full-icu`.**
- `Asia/Almaty` has **no DST** (`GMT+05:00` in both January and July 2026) but ICU *does* carry the
  historical `GMT+06:00` for 2023 — so formatting an old date with a fixed `+05:00` offset instead
  of the zone name would be wrong. Always pass the **zone name**, never a numeric offset.
- ICU data is Chromium's `common/icudtl.dat`, i.e. Chrome's locale set — not every CLDR locale is
  complete. Observed: `new Intl.DateTimeFormat("kk-KZ", {dateStyle:"long"})` returned
  `"2026 M09 13"`, the root-locale fallback pattern, even though `kk-KZ` is reported by
  `supportedLocalesOf`. Irrelevant for RU/EN, but **do not add Kazakh later assuming the date
  patterns exist** — re-probe first.

### 8. Timezone — where it must be pinned

#### 8.1 The library-level pin

`use-intl`'s `IntlConfig` (verbatim, `node_modules/use-intl/dist/types/core/IntlConfig.d.ts`):

```ts
    /** A time zone as defined in [the tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) which will be applied when formatting dates and times. If this is absent, the user time zone will be used. You can override this by supplying an explicit time zone to `formatDateTime`. */
    timeZone?: TimeZone;
```

and next-intl's docs, verbatim:

> "Specifying a time zone affects the rendering of dates and times. By default, the time zone of
> the server runtime will be used, but can be customized as necessary."
>
> ```ts
> export default getRequestConfig(async () => {
>   return {
>     timeZone: 'Europe/Vienna'
>   };
> });
> ```

**"the time zone of the server runtime" on Workers is UTC.** So `timeZone: 'Asia/Almaty'` in
`i18n/request.ts` is mandatory, not cosmetic. Same for `now` if we want deterministic
`formatRelativeTime`; verbatim from the same page:

> "If a now value is provided in `i18n/request.ts`, this will automatically be inherited by Client
> Components if you wrap them in a `NextIntlClientProvider`."

#### 8.2 The local-dev trap — Cloudflare's docs are wrong on this machine

Verbatim from https://developers.cloudflare.com/workers/local-development/ :

> "The local `workerd` runtime runs with `TZ=UTC` so that `Date` and `Intl` APIs inside your Worker
> observe UTC, matching the production Cloudflare runtime regardless of your machine's timezone."

**That is not what happens here.** Under `wrangler@4.131.1 dev` on this Windows 11 machine:

```json
{
  "processEnvTZ": "(undefined)",
  "defaultResolved": { "locale": "en-US", "timeZone": "Asia/Qyzylorda", "calendar": "gregory" },
  "dateGetTimezoneOffset": -300,
  "toStringLocal": "Sat Sep 12 2026 18:51:09 GMT+0500 (Kazakhstan Time)"
}
```

and re-running with `TZ=UTC` exported into wrangler's environment changed **nothing** — still
`Asia/Qyzylorda`, still `getTimezoneOffset() === -300`. `workerd` picked up the host OS timezone.
(Whether this is Windows-specific, or also affects macOS/Linux, is **UNVERIFIED** — I only have
this platform. Treat the docs' claim as unreliable regardless.)

The production claim — that deployed Workers run at UTC — is asserted by that same Cloudflare
docs sentence and is consistent with everything else in the ecosystem, but I could **not**
independently verify it against a deployed Worker in this session: **UNVERIFIED for production.**
That uncertainty does not change the recommendation; it strengthens it, because the fix (always
pass an explicit `timeZone`) is correct under either behaviour.

This is the single most dangerous fact in this note, for one specific reason: **the dev machine is
in Kazakhstan at UTC+5, which is exactly `Asia/Almaty`'s offset.** So any code that relies on the
ambient timezone — `new Date().getDate()`, `d.toLocaleDateString()` with no `timeZone`,
`new Intl.DateTimeFormat()` with no `timeZone` — will be **correct in local dev and wrong in
production, only between 00:00 and 05:00 Almaty time.** A 5-hour window, once a day, in which
"today's workout" lands on yesterday's date row. That will pass every test written at 15:00.

Demonstration (executed, Node + the helper below):

```
todayInZone Almaty: 2026-09-13                  // instant 2026-09-12T19:30:00Z
todayInZone UTC   : 2026-09-12
todayInZone Almaty (02:00 local): 2026-09-13    // instant 2026-09-12T21:00:00Z
naive toISOString  (same instant): 2026-09-12   // <-- the bug
```

The helper, verified working with zero dependencies:

```ts
// src/lib/time.ts
export const APP_TIME_ZONE = 'Asia/Almaty';

/** A stable YYYY-MM-DD "day key" in the app's zone. The only correct way to say "today". */
export function todayInAppZone(at: Date = new Date(), tz: string = APP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
```

(`en-CA` is used only because its `formatToParts` order is ISO-like; the parts are read by `type`,
so the locale choice is not load-bearing. `formatToParts` output was verified:
`[{year:"2026"},{literal:"-"},{month:"09"},{literal:"-"},{day:"12"}]`.)

#### 8.3 The five places the zone must be pinned

1. **`src/i18n/request.ts`** → `timeZone: 'Asia/Almaty'` (display formatting, server + inherited by client).
2. **`src/lib/time.ts`** → a single `APP_TIME_ZONE` constant and `todayInAppZone()` that every
   "date key" write goes through. Never `toISOString().slice(0,10)`.
3. **D1 / SQL.** Verbatim from https://sqlite.org/lang_datefunc.html : *"Format 11, the string
   'now', is converted into the current date and time as obtained from the xCurrentTime method of
   the sqlite3_vfs object in use. … Universal Coordinated Time (UTC) is used."* So `date('now')` in
   D1 is a **UTC** date. Never use it for a user-facing day boundary; pass the app-zone day key
   computed in TypeScript as a bound parameter. The `'localtime'` modifier is also useless here —
   docs: *"The 'localtime' modifier assumes the time-value to its left is in Universal Coordinated
   Time (UTC) and adjusts that time value so that it is in localtime"* — and the Worker's
   "localtime" is UTC.
4. **Cron Triggers.** Verbatim from Cloudflare docs: *"Cron Triggers execute on UTC time."* Config
   key is `"triggers": { "crons": [...] }`; handler is `async scheduled(controller, env, ctx)`.
   A "21:00 Almaty" reminder is `0 16 * * *` UTC. A "Sunday evening weekly report" is Sunday 16:00
   UTC. Write the UTC expression *and* the Almaty intent in a comment, or it will silently drift
   the first time anyone reasons about it.
5. **Client components.** Inherited from `NextIntlClientProvider`, but any raw `new Date()` math in
   a client component (rest timer is fine — it's a duration; "is this today?" is not) must use the
   same `APP_TIME_ZONE` helper. Note the device's own zone *is* Almaty in practice, which is
   precisely why this will never fail in manual testing.

### 9. Pluralization for Russian — VERIFIED both ways

Russian needs 4 categories. Confirmed present in `workerd` (§7):
`["one","few","many","other"]`, with `0 → many`, `1 → one`, `2 → few`, `5 → many`, `11 → many`,
`21 → one`, `22 → few`, `101 → one`, `111 → many`. (Ordinals in Russian are `["other"]` only —
so `selectordinal` is pointless for RU.)

`use-intl` uses the **native** `Intl.PluralRules`, memoized. Verbatim from
`node_modules/use-intl/dist/esm/production/formatters-CJcico0N.js`:

```js
function l(e){return{getDateTimeFormat:I(Intl.DateTimeFormat,e.dateTime),getNumberFormat:I(Intl.NumberFormat,e.number),getPluralRules:I(Intl.PluralRules,e.pluralRules),getRelativeTimeFormat:I(Intl.RelativeTimeFormat,e.relativeTime),getListFormat:I(Intl.ListFormat,e.list),getDisplayNames:I(Intl.DisplayNames,e.displayNames)}}
```

**Option A — through `use-intl`/`next-intl` (executed, real output).**

Message: `'{count, plural, one {# подход} few {# подхода} many {# подходов} other {# подхода}}'`

```
RU sets: 0=>0 подходов | 1=>1 подход | 2=>2 подхода | 3=>3 подхода | 4=>4 подхода | 5=>5 подходов | 11=>11 подходов | 21=>21 подход | 22=>22 подхода | 25=>25 подходов | 100=>100 подходов | 101=>101 подход | 111=>111 подходов
RU days: 0=>нет дней | 1=>1 день | 2=>2 дня | 5=>5 дней      // with an `=0 {нет дней}` exact match
EN sets: 0=>0 sets | 1=>1 set | 2=>2 sets
formatter dateTime: воскресенье, 13 сентября 2026 г. в 00:30  // createFormatter({locale:'ru', timeZone:'Asia/Almaty'})
formatter number: 1 234,5
formatter relativeTime: 1 день назад
formatter list: жим и тяга
```

**Option B — hand-rolled (executed, real output).** The whole thing:

```ts
// src/lib/i18n/plural.ts
const prCache = new Map<string, Intl.PluralRules>();
function pluralRules(locale: string) {
  let pr = prCache.get(locale);
  if (!pr) { pr = new Intl.PluralRules(locale); prCache.set(locale, pr); }
  return pr;
}
/** forms: { one?, few?, many?, other } plus exact "=N" keys. `#` is replaced by the number. */
export function plural(
  locale: string,
  n: number,
  forms: Partial<Record<Intl.LDMLPluralRule | `=${number}`, string>> & {other: string},
): string {
  const exact = forms[`=${n}` as const];
  if (exact !== undefined) return exact.replaceAll('#', String(n));
  const tpl = forms[pluralRules(locale).select(n)] ?? forms.other;
  return tpl.replaceAll('#', new Intl.NumberFormat(locale).format(n));
}
```

```
RU: 0=>0 подходов | 1=>1 подход | 2=>2 подхода | 5=>5 подходов | 11=>11 подходов | 21=>21 подход | 22=>22 подхода | 101=>101 подход | 111=>111 подходов | 1234=>1 234 подхода
EN: 0=>0 sets | 1=>1 set | 2=>2 sets
RU days: 0=>нет дней | 1=>1 день | 2=>2 дня | 5=>5 дней
```

Both are correct. Plurals are therefore **not** a differentiator between the two approaches —
`Intl.PluralRules` does the hard part either way. What differs is everything *around* plurals:
nested ICU (`plural` inside `select` inside rich text), compile-time key checking, error handling,
and the fact that a hand-rolled `t()` has to grow a parser the first time a screen needs
`"<b>{weight} кг</b> × {reps}"`.

### 10. Bundle cost — measured, not guessed

esbuild, `--bundle --format=esm --minify`, `react`/`react-dom` external, then `gzip -9`:

| Client entry | minified | gzipped |
|---|---|---|
| `next-intl` (`useTranslations`, `useFormatter`, `useLocale`, `NextIntlClientProvider`), default full ICU parser | 41 024 B | **12 483 B** |
| same, with `use-intl/format-message` aliased to `use-intl/format-message/format-only` (what `experimental.messages.precompile: true` does) | 9 599 B | **3 705 B** |
| hand-rolled context + `t()` + `plural()` | 653 B | **433 B** |
| a 300-key `ru.json` of realistic Russian UI copy (for scale, either approach pays this) | 16 731 B | 1 517 B |

Budget context: the brief's limit is "per-route client JS < 200KB gzipped". 12.5 KB is 6.2% of it;
3.7 KB is 1.9%. Neither is a blocker. The message catalogue itself (~1.5 KB gz per 300 keys) is
smaller than the library either way.

Caveat: these are isolated esbuild measurements of the library entry points, not real Next 16
route budgets — Turbopack's tree-shaking and chunk splitting will differ somewhat. Treat them as
an upper bound on the *delta* between the two approaches, not as exact route sizes.

The precompile path is real and documented in the plugin types
(`dist/types/plugin/types.d.ts`), verbatim:

```ts
            /**
             * When enabled, ICU messages are precompiled at build time, resulting in smaller bundles and faster message formatting.
             */
            precompile?: boolean;
```

…but it lives under `experimental.messages`, which the plugin hard-gates on Next 16 and wires
through a Turbopack loader (`next-intl/extractor/catalogLoader`). See the Open decision below.

---

## Recommendation

**Adopt `next-intl@4.14.4` in "without i18n routing" mode. No `[locale]` route segment, no
`next-intl/middleware`, locale in a cookie, `timeZone: 'Asia/Almaty'` pinned in
`src/i18n/request.ts`. Start with `precompile` OFF.**

Why this over hand-rolling, given the app is single-user:

1. **It costs us nothing on the risky axis.** The one genuinely scary thing in this stack is
   OpenNext's `proxy.ts` path being *"experimental and … not supported by the OpenNext
   maintainers"* (§3). In this mode `next-intl` never touches `proxy.ts`. The entire integration is
   a `resolveAlias` (§2) plus a server-side `getRequestConfig`. There is no OpenNext-specific
   surface at all.
2. **One choke point for the timezone.** `timeZone: 'Asia/Almaty'` in one file governs every
   `f.dateTime()` / `f.relativeTime()` in the app, server *and* client, because
   `NextIntlClientProvider` inherits it. Hand-rolling means writing that discipline yourself and
   enforcing it by review — against a §8.2 bug class that is invisible on the dev machine.
3. **ICU message formatting is the part you don't want to own.** Plurals alone are easy (§9), but
   nested plural-in-select, `=0` exact forms, rich text with React tags, `::unit/kilogram`
   skeletons and `RelativeTimeFormat` integration are not. `intl-messageformat@11` already handles
   them and uses the native `Intl.*` we just verified is fully present in `workerd`.
4. **Compile-time key safety, which matters most for a solo dev.** `declare module 'next-intl' {
   interface AppConfig { Messages: typeof messages } }` turns a missing RU key into a `tsc` error
   instead of a `Workout.setsLabel` string rendered mid-set in the gym. Verified type surface:
   `use-intl/dist/types/core/AppConfig.d.ts` exposes `Locale`, `Messages`, `FormatNames`.
5. **Cost is measured and small** (§10): ~12.5 KB gz now, a documented path down to ~3.7 KB gz later.

Reject `[locale]` segments outright: they force `proxy.ts`, double the route tree and the Serwist
precache manifest, make a single `start_url` impossible without a cold-start redirect, create an
ambiguous offline fallback, and sit on `requestLocale`, which `next-intl` has already deprecated in
favour of an API that doesn't work in Route Handlers or Server Actions yet (§5, §6).

Hand-rolling is the *defensible second choice* and I would pick it if the app had fewer than ~50
strings. It does not — the brief describes 11 feature modules, dashboards, achievements, a weekly
review, a monthly report card and a year-in-review. At that volume the library pays for itself.

### File layout

```
next.config.ts                    # withNextIntl(nextConfig) — nothing else i18n-related
proxy.ts                          # AUTH ONLY (or absent). next-intl contributes nothing here.
messages/
  ru.json                         # source of truth; RU is default
  en.json                         # must have identical key shape (see gotcha 5)
src/
  i18n/
    config.ts                     # LOCALES = ['ru','en'] as const; DEFAULT_LOCALE = 'ru';
                                  #   LOCALE_COOKIE = 'NEXT_LOCALE'; isLocale(v): v is Locale
    request.ts                    # getRequestConfig — the ONLY place locale + timeZone + formats
                                  #   are resolved. Auto-discovered by the plugin.
    locale.ts                     # 'use server' — getUserLocale() / setUserLocale(locale)
    formats.ts                    # global Formats: dateTime.{short,long}, number.{kg,kcal,percent}
  lib/
    time.ts                       # APP_TIME_ZONE = 'Asia/Almaty'; todayInAppZone();
                                  #   dayKeyOf(date); startOfDayUtc(dayKey) — used by ALL D1 writes
  types/
    next-intl.d.ts                # declare module 'next-intl' { interface AppConfig {...} }
app/
  layout.tsx                      # <html lang={locale}> + <NextIntlClientProvider>
  offline/page.tsx                # locale-agnostic or RU-only (see gotchas 4 and 6)
```

`src/i18n/request.ts` — the one file that matters:

```ts
import {cookies} from 'next/headers';
import {getRequestConfig} from 'next-intl/server';
import {DEFAULT_LOCALE, LOCALE_COOKIE, isLocale} from './config';
import {formats} from './formats';
import {APP_TIME_ZONE} from '@/lib/time';

export default getRequestConfig(async () => {
  const store = await cookies();                 // async in Next 16 — sync access was removed
  const candidate = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(candidate) ? candidate : DEFAULT_LOCALE;

  return {
    locale,
    timeZone: APP_TIME_ZONE,                     // 'Asia/Almaty' — NOT the runtime default (UTC)
    now: new Date(),
    formats,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

`src/i18n/locale.ts` — the switcher. (Composed from verified primitives: `cookies()` is async in
Next 16 per the upgrade guide, and `ResponseCookies.set` is documented on the proxy page. The
exact shape of this file is **UNVERIFIED** against a next-intl doc example — the docs page I
fetched showed only the *read* side.)

```ts
'use server';

import {cookies} from 'next/headers';
import {DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, isLocale} from './config';

export async function getUserLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function setUserLocale(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,       // the SW/client may want to read it; see gotcha 4
    maxAge: 60 * 60 * 24 * 365,
  });
}
```

`src/types/next-intl.d.ts` — the module name to augment is `'next-intl'` (verified against the
next-intl TypeScript workflow docs):

```ts
import type messages from '../../messages/ru.json';
import type {formats} from '@/i18n/formats';
import type {LOCALES} from '@/i18n/config';

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof messages;
    Formats: typeof formats;
  }
}
```

Usage: `useTranslations('Workout')` in Server **and** Client Components; `getTranslations()` /
`getFormatter()` / `getLocale()` / `getTimeZone()` from `next-intl/server` in async server code.
Verified export list of `next-intl/server` (`dist/types/server/react-server/index.d.ts`):
`getRequestConfig, getFormatter, getNow, getTimeZone, getTranslations, getExtracted, getMessages,
getLocale, setRequestLocale`.

---

## Gotchas that will silently break us

1. **`new Date()` day arithmetic is right in dev and wrong in prod, for 5 hours a day.** (§8.2.)
   `wrangler dev` inherits the Windows host zone (measured: `Asia/Qyzylorda`, UTC+5), which is the
   same offset as `Asia/Almaty`. Deployed Workers run at UTC. Every naive "today" is therefore
   correct locally and off-by-one-day in production between 00:00 and 05:00 Almaty.
   **Mitigation:** ban `toISOString().slice(0,10)`, `getDate()`, and
   `toLocaleDateString()`-without-`timeZone` via an ESLint `no-restricted-syntax` rule; route every
   day key through `src/lib/time.ts`. Add one unit test that freezes time to
   `2026-09-12T21:00:00Z` and asserts the day key is `2026-09-13`. Vitest must be run with
   `TZ=UTC` so the test actually exercises the production condition.
2. **`date('now')` in D1 is UTC** (sqlite.org, quoted in §8.3). A `DEFAULT (date('now'))` column or
   a `WHERE date = date('now')` filter will disagree with the UI's notion of today for 5 hours
   daily. Compute the day key in TypeScript and bind it.
3. **Cron Triggers are UTC** and there is no timezone option. `0 21 * * *` fires at 02:00 Almaty —
   a "gentle evening nudge" arriving in the middle of the night, which is precisely the
   guilt-inducing experience the brief forbids. Write `0 16 * * *` with an inline comment stating
   the Almaty intent.
4. **The service worker will serve the wrong language after a locale switch.** With a cookie-driven
   locale and no URL prefix, `/dashboard` has two different HTML bodies at the *same* URL. Any HTML
   caching (Serwist precache of prerendered routes, or a `NetworkFirst`/`StaleWhileRevalidate`
   runtime rule on navigations) will hand back the stale language — possibly indefinitely.
   **Mitigation:** after `setUserLocale`, delete the HTML cache entries and hard-reload; never
   precache authenticated HTML; keep `/offline` locale-agnostic. This is not a next-intl problem —
   the hand-rolled approach has it identically. A `[locale]` prefix would *avoid* it, and that is
   genuinely the one thing prefixes buy us. It is still not worth the rest of the cost in §6.
5. **A key present in `ru.json` but missing from `en.json` fails at runtime, not build time** —
   typing `Messages: typeof messages` (RU) gives key-safety at call sites but does **not** prove
   `en.json` has the same keys. Add a test that deep-compares the key sets of both files.
   Otherwise `next-intl` renders the fallback; per `use-intl/dist/types/core/IntlConfig.d.ts`,
   `getMessageFallback` *"defaults to `${namespace}.${key}`"* — i.e. the literal string
   `Workout.setsLabel` appears in the UI.
6. **Reading `cookies()` in `i18n/request.ts` makes every route dynamic.** That is fine here (auth
   on all routes per the brief) but it means nothing renders statically — so `/offline` cannot be
   prerendered if it calls `useTranslations`. Keep `/offline` free of `next-intl` and hardcode its
   RU copy, or the PWA offline shell silently becomes a dynamic route that cannot be precached.
7. **Do not put `createMiddleware` in `proxy.ts`.** Beyond the OpenNext experimental-path risk
   (§3), Next 16's `proxy` runs on the Node runtime and *cannot* be configured — and
   `stack-facts.md` already records that `export const runtime = "edge"` is unsupported under
   OpenNext. Two middlewares competing for one `NextResponse` on an unsupported bundling path is a
   debugging nightmare on a platform with no useful stack traces out of the middleware bundle.
8. **`middleware.ts` → `proxy.ts` is a rename with a deprecation attached.** Official docs: *"The
   `middleware` file convention is deprecated and has been renamed to `proxy`."* One secondary
   source claims that as of Next 16.2.4 Next no longer looks for `middleware.ts` by default —
   **UNVERIFIED**; I could not confirm it in the official docs (the version table only records the
   v16.0.0 deprecation). Either way: name the file `proxy.ts` and the export `proxy`, and run
   `npx @next/codemod@canary middleware-to-proxy .` if a `middleware.ts` ever appears.
9. **Never format a historical date with a fixed `+05:00` offset.** Kazakhstan moved to UTC+5; ICU
   in `workerd` correctly reports `GMT+06:00` for `Asia/Almaty` in July 2023 (§7). Progress photos
   and workouts from before the change would shift by an hour. Always pass the zone *name*.
10. **`next-intl`'s absolute-path restriction under Turbopack.** If we ever pass an explicit path to
    `createNextIntlPlugin()`, it must be relative. The plugin throws: *"Turbopack support for
    next-intl currently does not support absolute paths, please provide a relative one (e.g.
    './src/i18n/config.ts')."* Simplest fix: keep the file at the auto-discovered
    `src/i18n/request.ts` and pass nothing.
11. **Kazakh is a trap if we ever add it.** `kk-KZ` is listed by `supportedLocalesOf` but its date
    patterns fall back to root (`"2026 M09 13"`) in `workerd`'s ICU data (§7). Re-probe before
    promising a third locale.
12. **`Intl.PluralRules` ordinal for RU is `["other"]` only** (§7). Any `selectordinal` in a RU
    message silently collapses to a single form. Write RU ordinals as literal text.
13. **Do not add an ICU/Intl polyfill "to be safe".** It would shadow the fully-capable native
    implementation verified in §7, ship tens of KB, and diverge from the device's own formatting.

---

## Open decision for the owner

**Enable `experimental.messages.precompile`?**

The next-intl client runtime measures 12 483 B gz with the full ICU parser, or 3 705 B gz when
messages are precompiled at build time (§10). Precompiling means passing an `experimental.messages`
block to `createNextIntlPlugin()`, which registers a Turbopack loader
(`next-intl/extractor/catalogLoader`) over the message JSON and aliases `use-intl/format-message`
→ `use-intl/format-message/format-only`.

- **Option A — leave it off (Phase 1 default).** Costs ~8.8 KB gz more client JS (≈4.4% of the
  200 KB per-route budget). Zero experimental build surface; the whole integration stays a single
  `resolveAlias`. Revisit in Phase 9 ("Data & Polish / performance") once real route budgets are
  measured with `next build`.
- **Option B — turn it on now.** Saves ~8.8 KB gz and speeds message formatting, at the cost of an
  `experimental.`-namespaced Turbopack loader in the build. The exact accepted values of the
  loader's `messages.format` / `messages.path` keys are **UNVERIFIED** — I read the plugin source
  and types but did not run a real Next 16 build with it.

**Recommendation: Option A**, recorded in `DECISIONS.md` with a Phase 9 revisit note.

A second, smaller decision belongs to R-auth rather than here: **whether `proxy.ts` exists at all.**
Given §3, the cheapest correct answer for a single-user app is probably *no* `proxy.ts` — guard in
layouts and Server Functions instead. The Next docs themselves warn, verbatim: *"A matcher change
or a refactor that moves a Server Function to a different route can silently remove Proxy coverage.
Always verify authentication and authorization inside each Server Function rather than relying on
Proxy alone."* This note's recommendation is deliberately independent of that outcome.

---

## Sources

### Primary — package source / types read locally
Installed under the session scratchpad
`C:\Users\tairc\AppData\Local\Temp\claude\C--Users-tairc-Documents-codespace-fitness-app-tair\85fb1989-5a8f-448f-9e9a-162342b812b6\scratchpad\node_modules\`:

- `next-intl@4.14.4` — `package.json`; `dist/types/plugin/{types,nextFlags,createNextIntlPlugin,config}.d.ts`;
  `dist/esm/production/plugin/{nextFlags,getNextConfig}.js`;
  `dist/types/middleware/middleware.d.ts`; `dist/types/routing/{config,types}.d.ts`;
  `dist/esm/production/routing/config.js`;
  `dist/types/server/react-server/{index,getRequestConfig,getFormatter,getTimeZone,getTranslations}.d.ts`;
  `dist/types/shared/NextIntlClientProvider.d.ts`;
  `dist/types/react-server/NextIntlClientProviderServer.d.ts`
- `use-intl@4.14.4` — `package.json`; `dist/types/core/{IntlConfig,AppConfig}.d.ts`;
  `dist/esm/production/formatters-CJcico0N.js`; `dist/esm/production/format-message/format-only.js`
- `@opennextjs/cloudflare@1.20.6` — `dist/cli/build/open-next/bundle-node-middleware.{d.ts,js}`;
  `dist/cli/build/utils/middleware.{d.ts,js}`; `dist/cli/build/build.js`
- `serwist@9.5.12` — `dist/index.d.mts` (`PrecacheFallbackEntry`, `FallbacksOptions`, `SerwistOptions`)
- `intl-messageformat@11.2.14`, `icu-minify@4.14.4`

### Primary — executed in this session
- Probe Worker under `wrangler@4.131.1 dev` (`compatibility_date "2026-09-01"`, `nodejs_compat`),
  two runs, ~30 `Intl` assertions — §7 and §8.2 outputs.
- Same probe re-run with `TZ=UTC` exported into wrangler's environment — no change (§8.2).
- `use-intl/core` `createTranslator` + `createFormatter` RU plural/format run — §9 Option A.
- Standalone `Intl.PluralRules` implementation run — §9 Option B, and `todayInAppZone` (§8.2).
- esbuild + `gzip -9` bundle measurements — §10.

### Primary — official docs (URLs)
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- https://nextjs.org/docs/app/guides/upgrading/version-16
- https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing
- https://next-intl.dev/docs/routing/middleware
- https://next-intl.dev/docs/usage/configuration
- https://next-intl.dev/docs/workflows/typescript
- https://next-intl.dev/blog/nextjs-root-params
- https://developers.cloudflare.com/workers/runtime-apis/web-standards/
- https://developers.cloudflare.com/workers/local-development/ — the `TZ=UTC` claim contradicted in §8.2
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://raw.githubusercontent.com/cloudflare/workerd/main/BUILD.bazel
- https://opennext.js.org/cloudflare
- https://github.com/opennextjs/opennextjs-cloudflare/issues/962 — "[BUG] Next 16 proxy (former middleware) not supported", closed
- https://sqlite.org/lang_datefunc.html
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url

### Local project files read
- `C:\Users\tairc\Documents\codespace\fitness-app-tair\specs\00-brief.md`
- `C:\Users\tairc\Documents\codespace\fitness-app-tair\docs\research\stack-facts.md`
