# R01 — Cloudflare Cron Triggers (`scheduled` handler) in a Next.js app on `@opennextjs/cloudflare` 1.20.x

**Researched 2026-09-12.** Complements [`stack-facts.md`](./stack-facts.md). It contradicts
`stack-facts.md` in exactly **one** place — the "15 min CPU per Cron Trigger" line, which is
only half the rule. See [§4.1](#41-stack-factsmd-refinement-the-15-min-cron-cpu-budget-is-conditional).

Every claim below is either (a) read out of the installed package's own shipped source,
(b) quoted from official Cloudflare / OpenNext docs or the OpenNext git history,
(c) produced by a command I actually ran against a real build, or (d) tagged `UNVERIFIED`.

**Versions installed and inspected** (in the scratchpad, never in the project):

| Package | Version installed & inspected |
|---|---|
| `@opennextjs/cloudflare` | 1.20.6 |
| `wrangler` | 4.131.1 (bundles `workerd@1.20260911.1`) |
| `next` | 16.3.5 |
| `react` / `react-dom` | 19.2.0 |
| `typescript` | 5.9.3 |
| `node` | 24.12.0 |

All match `stack-facts.md`.

**I built and ran a real probe app.** Unlike a pure docs review, this note is backed by a
throwaway Next 16.3.5 + OpenNext 1.20.6 project I scaffolded, built with
`opennextjs-cloudflare build`, and drove with `wrangler dev`. The custom worker entry,
the `triggers.crons` block, the `/__scheduled` and `/cdn-cgi/local/scheduled` endpoints,
the `getCloudflareContext()` failure, the Durable-Object re-export failure and the
`WORKER_SELF_REFERENCE` round-trip in this note are **observed behaviour**, not inference.
Probe location (disposable):
`C:\Users\tairc\AppData\Local\Temp\claude\C--Users-tairc-Documents-codespace-fitness-app-tair\85fb1989-5a8f-448f-9e9a-162342b812b6\scratchpad\probe`

**One environment caveat, same as R02:** local D1 and local KV could not execute in this
sandbox — every query died with `internal error; reference = …` from miniflare's
`object-entry.worker`. I proved this is **not** cron-specific by running the identical D1/KV
query from a normal Next route handler on the `fetch` path: it failed the same way
(`/api/d1` → `{"d1Error":"Error: internal error; reference = 3f1cg72lp08t7hrkr3paojdf",
"kvError":"Error: Network connection lost."}`). So "bindings are reachable from `scheduled`"
is verified at the object level (`typeof env.DB === "object"`, binding present in
`Object.keys(env)`); "a D1 *query* succeeds from `scheduled`" is `UNVERIFIED` locally and
must be confirmed on the first real deploy.

---

## 1. Question

`wrangler.jsonc`'s `main` points at `.open-next/worker.js`, which OpenNext regenerates on
every build. How do we run Cloudflare Cron Triggers (reminders, the streak-at-risk nudge,
the weekly Telegram report, scheduled R2 backups) in this app?

Options to evaluate and choose between:

- **(a)** a custom worker entry that imports/re-exports the OpenNext-generated default
  handler and adds its own `scheduled(event, env, ctx)`;
- **(b)** `triggers.crons` + a cron handler that `fetch()`es an internal Next route through
  the `WORKER_SELF_REFERENCE` service binding with a shared secret;
- **(c)** a second, separate Worker deployed alongside the app;
- **(d)** any first-class support OpenNext now ships.

Deliverables: a copy-pasteable worker entry, the `wrangler.jsonc` `triggers` block, how the
cron handler reaches app code and the D1/R2 bindings, how to test a cron locally, and the
CPU-limit implication.

---

## 2. Verified answer

### 2.1 Option (d) does not exist — there is no first-class cron support in 1.20.6

`.open-next/worker.js` exports **only** a `fetch` handler plus three Durable Object classes.
The generated file is a byte-for-byte copy of the package's shipped template — I verified
this with `diff`:

```
$ diff .open-next/worker.js node_modules/@opennextjs/cloudflare/dist/cli/templates/worker.js
IDENTICAL
```

and the copy is unconditional
(`node_modules/@opennextjs/cloudflare/dist/cli/build/utils/copy-package-cli-files.js`):

```js
export function copyPackageCliFiles(packageDistDir, buildOpts) {
    console.log("# copyPackageTemplateFiles");
    const sourceDir = path.join(packageDistDir, "cli/templates");
    const destinationDir = path.join(buildOpts.outputDir, "cloudflare-templates");
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.cpSync(sourceDir, destinationDir, { recursive: true });
    fs.copyFileSync(path.join(packageDistDir, "cli/templates/worker.js"), getOutputWorkerPath(buildOpts));
}
```

So **editing `.open-next/worker.js` is pointless** — it is overwritten on every build.

The template itself (`dist/cli/templates/worker.js`, quoted verbatim, abridged only in the
middle of `fetch`):

```js
//@ts-expect-error: Will be resolved by wrangler build
import { handleCdnCgiImageRequest, handleImageRequest } from "./cloudflare/images.js";
//@ts-expect-error: Will be resolved by wrangler build
import { runWithCloudflareRequestContext } from "./cloudflare/init.js";
//@ts-expect-error: Will be resolved by wrangler build
import { maybeGetSkewProtectionResponse } from "./cloudflare/skew-protection.js";
// @ts-expect-error: Will be resolved by wrangler build
import { handler as middlewareHandler } from "./middleware/handler.mjs";
//@ts-expect-error: Will be resolved by wrangler build
export { DOQueueHandler } from "./.build/durable-objects/queue.js";
//@ts-expect-error: Will be resolved by wrangler build
export { DOShardedTagCache } from "./.build/durable-objects/sharded-tag-cache.js";
//@ts-expect-error: Will be resolved by wrangler build
export { BucketCachePurge } from "./.build/durable-objects/bucket-cache-purge.js";
export default {
    async fetch(request, env, ctx) {
        return runWithCloudflareRequestContext(request, env, ctx, async () => {
            /* … skew protection, /cdn-cgi/image, /_next/image, middleware … */
            // @ts-expect-error: resolved by wrangler build
            const { handler } = await import("./server-functions/default/handler.mjs");
            return handler(reqOrResp, env, ctx, request.signal);
        });
    },
};
```

Note `export default { async fetch(...) }` — **no `scheduled`, no `queue`, no `email`**.
Corroborating greps over the whole installed package:

```
$ grep -rn "scheduled" dist templates          # → no matches at all
$ grep -rni "customworker|entrypoint|customEntry" dist templates
# → only esbuild `entryPoints:` internals; no user-facing custom-entry option
```

There is also **no `open-next.config.ts` key** for a custom entry or a scheduled handler.

Upstream confirms this is by design: issue
[opennextjs-cloudflare#446 "[FEATURE] Workers scheduled"](https://github.com/opennextjs/opennextjs-cloudflare/issues/446)
was closed by maintainer `vicb` with a single comment (read via `gh issue view 446 --comments`):

> See https://opennext.js.org/cloudflare/howtos/custom-worker for a solution

**Conclusion: (d) is not available. The supported answer is (a), and OpenNext documents it.**

### 2.2 Option (a) is the officially documented mechanism

`docs/pages/cloudflare/howtos/custom-worker.mdx` in `opennextjs/docs`, quoted **verbatim**
(fetched via `gh api repos/opennextjs/docs/contents/pages/cloudflare/howtos/custom-worker.mdx`):

````md
## Custom Worker

The worker generated by the Cloudflare adapter only exports [a fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/).

Sometimes your application needs to expose another type of handler (i.e. [a scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)) or export a [Durable Object](https://developers.cloudflare.com/durable-objects/api/base/). This can be achieved by creating a custom worker.

The custom worker re-uses the generated fetch handler.

### Create your custom worker Worker

The following custom worker re-uses the generated fetch handler and adds a scheduled handler:

```ts filename="custom-worker.ts"
// @ts-ignore `.open-next/worker.ts` is generated at build time
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,

  async scheduled(event) {
    // ...
  },
} satisfies ExportedHandler<CloudflareEnv>;

// The re-export is only required if your app uses the DO Queue and DO Tag Cache
// See https://opennext.js.org/cloudflare/caching for details
// @ts-ignore `.open-next/worker.ts` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
```

See [an example in the adapter repository](https://github.com/opennextjs/opennextjs-cloudflare/blob/main/examples/playground14/worker.ts).

### Update the entry point in your wrangler configuration

```diff filename="wrangler.jsonc"
{
-  "main": "./.open-next/worker.js"
+  "main": "./path/to/custom-worker.ts",
}
```
````

The example link in those docs is **dead** — `examples/playground14/` was deleted from the
adapter repo in commit `364b7d91` ("Bump react and next (#1255)", 2026-05-06). I recovered
the file from git history (`gh api .../contents/examples/playground14/worker.ts?ref=1868c99…`).
Verbatim, tabs as in the original:

```ts
// @ts-ignore `.open-next/worker.ts` is generated at build time
import { default as handler } from "./.open-next/worker.js";

export default {
	fetch: handler.fetch,

	/**
	 * Scheduled Handler
	 *
	 * Can be tested with:
	 * - `wrangler dev --test-scheduled`
	 * - `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`
	 * @param event
	 */
	async scheduled(event) {
		console.log("Scheduled event", event);
	},
} satisfies ExportedHandler<CloudflareEnv>;

// @ts-ignore `.open-next/worker.ts` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
```

and its `wrangler.jsonc` (note `"main": "worker.ts"` — project root, plain `.ts`):

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"main": "worker.ts",
	"name": "playground14",
	"compatibility_date": "2026-04-15",
	"compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
	"assets": {
		"directory": ".open-next/assets",
		"binding": "ASSETS"
	},
	/* … bindings … */
}
```

**Nothing in the OpenNext CLI reads or validates `main`.** I grepped the whole `dist/`:
the only hit for `main` is esbuild's `mainFields: ["module", "main"]` in
`bundle-node-middleware.js`. `deploy`/`preview` shell out to wrangler
(`dist/cli/commands/utils/run-wrangler.js`) and only ever pass `--config`, `--env`,
`--remote` plus passthrough args. So repointing `main` at our own entry is safe with
respect to the adapter.

### 2.3 The Durable Object re-export is load-bearing — verified failure

This is the trap the task warned about, and I reproduced it. With
`durable_objects.bindings` declaring `NEXT_CACHE_DO_QUEUE → DOQueueHandler` and the
re-export line commented out of `worker.ts`:

```
$ npx wrangler deploy --dry-run --outdir .dryrun2

 ⛅️ wrangler 4.131.1
────────────────────
X [ERROR] Your Worker depends on the following Durable Objects, which are not exported in your entrypoint file: DOQueueHandler.

  You should export these objects from your entrypoint, worker.ts.
```

With the re-export restored, the same dry run succeeds and lists the binding:

```
Your Worker has access to the following bindings:
Binding                                                           Resource
env.NEXT_CACHE_DO_QUEUE (DOQueueHandler)                          Durable Object
env.PROBE_KV (11111111111111111111111111111111)                   KV Namespace
env.DB (probe-db)                                                 D1 Database
env.WORKER_SELF_REFERENCE (cron-probe)                            Worker
env.ASSETS                                                        Assets
env.CRON_SECRET ("probe-secret")                                  Environment Variable
```

Two consequences:

1. **Re-export every DO class you bind.** 1.20.6's generated worker exports **three**:
   `DOQueueHandler`, `DOShardedTagCache`, `BucketCachePurge` (the docs snippet above is one
   version behind — it lists only two). Re-export all three.
2. **Re-exporting a DO class you do *not* bind is harmless** — the successful dry run above
   re-exported all three while binding only `DOQueueHandler`. (This also has to be true,
   since OpenNext's own default worker exports all three for every app.)

### 2.4 `getCloudflareContext()` **throws** inside `scheduled` — verified

This is the single most important finding. In `scheduled` you are outside the request
`AsyncLocalStorage` that OpenNext sets up, so the whole `getCloudflareContext()` /
`drizzle(getCloudflareContext().env.DB)` idiom used everywhere in our Next code **does not
work there**.

Mechanism, from `dist/cli/templates/init.js` (the file that becomes
`.open-next/cloudflare/init.js`):

```js
const cloudflareContextALS = new AsyncLocalStorage();
// Note: this symbol needs to be kept in sync with `src/api/get-cloudflare-context.ts`
Object.defineProperty(globalThis, Symbol.for("__cloudflare-context__"), {
    get() {
        return cloudflareContextALS.getStore();
    },
});

/**
 * Executes the handler with the Cloudflare context.
 */
export async function runWithCloudflareRequestContext(request, env, ctx, handler) {
    init(request, env);
    return cloudflareContextALS.run({ env, ctx, cf: request.cf }, handler);
}
```

`runWithCloudflareRequestContext` is called **only** from the generated `fetch` handler and
takes a `Request`. A `ScheduledController` is not a `Request`, so the ALS store is empty and
`getCloudflareContextSync()` falls through to `throw new Error(initOpenNextCloudflareForDevErrorMsg)`.

Observed, from the probe's `scheduled` handler (`GET /api/probe` after triggering a cron):

```json
"getCloudflareContextError": "Error: ERROR: `getCloudflareContext` has been called without having called `initOpenNextCloudflareForDev` from the Next.js config file. You should update your Next.js config file as shown below: ``` // next.config.mjs im"
```

Note how **misleading** that message is: it blames `next.config.ts`, which is correctly
configured. Anyone hitting this in a cron handler will waste an hour.

**Do not use `getCloudflareContext()` in the `scheduled` handler. Use the `env` argument.**
`getCloudflareContext({ async: true })` is no better: it only falls back to wrangler's
`getPlatformProxy()` when `process.env.NEXT_RUNTIME === "nodejs"`, i.e. in `next dev`, and
that path does `await import("wrangler")`, which cannot work inside workerd.

### 2.5 All bindings are directly available on `env` inside `scheduled` — verified

From the same probe run:

```json
{
  "cron": "0 16 * * *",
  "scheduledTime": 1789222138733,
  "typeofDB": "object",
  "typeofKV": "object",
  "typeofSelfRef": "object",
  "envKeys": ["ASSETS", "CRON_SECRET", "DB", "PROBE_KV", "WORKER_SELF_REFERENCE"]
}
```

So D1 (`env.DB`), R2, KV and the self-reference service binding are all present. The binding
objects need no request context — this is plain Workers runtime API. (Executing a query
could not be proven in this sandbox; see the caveat at the top.)

The handler signature is the standard one
(`worker-configuration.d.ts` generated by `wrangler types`, verbatim):

```ts
type ExportedHandlerScheduledHandler<Env = unknown, Props = unknown> =
  (controller: ScheduledController, env: Env, ctx: ExecutionContext<Props>) => void | Promise<void>;

interface ScheduledController {
    readonly scheduledTime: number;
    readonly cron: string;
    noRetry(): void;
}
```

### 2.6 Option (b) works too — verified end to end

From `scheduled`, `env.WORKER_SELF_REFERENCE.fetch(new Request(...))` reached a real Next
App Router route handler, and inside that route `getCloudflareContext()` worked normally:

```json
"selfRefStatus": 200,
"selfRefBody": "{\"ranVia\":\"next-route-handler\",\"ctxType\":\"object\",\"envKeyCount\":5, … }"
```

`WORKER_SELF_REFERENCE` is already required by OpenNext for cache revalidation
(`stack-facts.md` §OpenNext, and `templates/wrangler.jsonc` ships it by default), so it
costs us nothing extra. Cloudflare's own requirement for a synthetic request
(`workers/runtime-apis/bindings/service-bindings/http.mdx`, verbatim):

> If you construct a new request manually, rather than forwarding an existing one, ensure
> that you provide a valid and fully-qualified URL with a hostname.

and the security-relevant note from `service-bindings/index.mdx`, verbatim:

> Cloudflare Access does not propagate `ctx.access` from Worker A to Worker B. This applies
> to HTTP requests and RPC invocations. Do not treat the downstream invocation as
> authenticated by the caller's Access context.

→ **the internal route must do its own auth** (shared secret), and conversely a
service-binding call is not blocked by Cloudflare Access. But see the origin-poisoning
gotcha in [§4.3](#43-a-fake-hostname-in-the-self-fetch-poisons-the-whole-isolate-verified);
option (b) has a real footgun.

### 2.7 Option (c) — a second Worker — is possible but strictly worse here

A separate Worker with its own `wrangler.cron.jsonc`, its own `triggers.crons`, a service
binding to the app, and duplicated `d1_databases` / `r2_buckets` entries would work. It buys
isolation (a runaway cron cannot affect the app Worker's isolate) at the cost of: a second
deploy in CI, duplicated binding config that silently drifts, no shared code with the Next
app unless we publish an internal package, and a second entry against the per-account Cron
Trigger budget. For a single-user app with three light crons this is pure overhead.
Rejected — but noted as the escape hatch in [§5](#5-open-decision-for-the-owner).

### 2.8 The `triggers` block

`workers/wrangler/configuration/` and `workers/configuration/cron-triggers/`, verbatim:

> Triggers allow you to define the `cron` expression to invoke your Worker's `scheduled`
> function.

```jsonc
{
	"triggers": {
		"crons": [
			"*/3 * * * *",
			"0 15 1 * *",
			"59 23 LW * *"
		]
	}
}
```

Field ranges, from the same page: Minute `0-59` (`* , - /`), Hours `0-23` (`* , - /`),
Days of Month `1-31` (`* , - / L W`), Months `1-12` or names (`* , - /`), Weekdays `1-7`
with **Sunday = 1** or names (`* , - / L #`).

> Cron Triggers execute on UTC time.

I confirmed wrangler actually publishes these from config
(`wrangler-dist/cli.js`, `resolveCronTriggers`):

```js
function resolveCronTriggers(args, config2) {
  return args.triggers ?? config2.triggers?.crons;
}
```

and, in the deploy path:

```js
  if (crons) {
    deployments.push(
      fetchResult(config2, `${workerUrl}/schedules`, {
        // Note: PUT will override previous schedules on this script.
        method: "PUT",
        body: JSON.stringify(crons.map((cron) => ({ cron }))),
        …
```

See [§4.4](#64-deleting-the-triggers-block-does-not-delete-the-cron-verified) for the
consequence of that `if (crons)`.

### 2.9 Local testing — both methods verified against a real OpenNext build

**Method 1 — `wrangler dev --test-scheduled` + `/__scheduled`.** The flag exists in
wrangler 4.131.1 (`wrangler-dist/cli.js`):

```js
        "test-scheduled": {
          describe: "Test scheduled events by visiting /__scheduled in browser",
          type: "boolean",
          default: false
        },
```

It injects `templates/middleware/middleware-scheduled.ts`, shipped in the wrangler package
(verbatim):

```ts
const scheduled: Middleware = async (request, env, _ctx, middlewareCtx) => {
	const url = new URL(request.url);
	if (url.pathname === "/__scheduled") {
		const cron = url.searchParams.get("cron") ?? "";
		await middlewareCtx.dispatch("scheduled", { cron });

		return new Response("Ran scheduled event");
	}
	…
```

Observed against the probe (the custom worker, OpenNext build, Workers Assets configured):

```
$ curl -s -w "\n[%{http_code}]\n" "http://127.0.0.1:8931/__scheduled?cron=5+3+*+*+1"
Ran scheduled event
[200]
```

and the handler's own `console.log` appeared in the `wrangler dev` output:

```
[cron] done {"cron":"5 3 * * 1","scheduledTime":1789222059351,"typeofDB":"object", …}
[wrangler:info] GET /__scheduled 200 OK (60ms)
```

It also works through the OpenNext CLI — the flags pass through because
`dist/cli/index.js` sets `.parserConfiguration({ "unknown-options-as-args": true })`:

```
$ npx opennextjs-cloudflare preview --test-scheduled --port 8961
…
$ curl "http://127.0.0.1:8961/__scheduled?cron=0+16+*+*+*"   → 200 "Ran scheduled event"
```

**Method 2 — `/cdn-cgi/local/scheduled` (no flag needed).** Cloudflare's current docs
(`workers/configuration/cron-triggers.mdx`) document only this one, verbatim:

> Test Cron Triggers using Wrangler with [`wrangler dev`], or using the Cloudflare Vite
> plugin. This exposes a `/cdn-cgi/local/scheduled` route, which can be used to test using
> an HTTP request.
> … By default, the endpoint returns the scheduled handler outcome as text. To return the
> structured scheduled handler result as JSON, pass `?format=json`.
> … The `noRetry` field is `true` when the scheduled handler calls `controller.noRetry()`.
> … To simulate different cron patterns, a `cron` query parameter can be passed in.
> … Optionally, you can also pass a `time` query parameter to override
> `controller.scheduledTime`.

Observed with a **plain** `wrangler dev` (no `--test-scheduled`):

```
$ curl -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8951/__scheduled?cron=0+16+*+*+*"
404
$ curl "http://127.0.0.1:8951/cdn-cgi/local/scheduled?cron=0+16+*+*+*&format=json"
{"outcome":"ok","noRetry":false}
```

(the `404` is Next's own not-found — without the flag there is no `/__scheduled` route)
and `/api/probe` confirmed the handler had actually run.

`wrangler dev` always enables this: `unsafeTriggerHandlers: true` is hard-coded in
`wrangler-dist/cli.js`, and miniflare's `entry.worker.js` gates the route on it:

```js
      if (env[CoreBindings.TRIGGER_HANDLERS]) {
        if (url.pathname === CorePaths.SCHEDULED)
          return await handleScheduled(url.searchParams, service);
```

```js
function handleScheduled(params, service) {
  let time = params.get("time"), scheduledTime = time ? new Date(parseInt(time)) : void 0,
      cron = params.get("cron") ?? void 0, format = params.get("format"),
      result = await service.scheduled({ scheduledTime, cron });
  return format === "json" ? Response.json(result, { status: result.outcome === "ok" ? 200 : 500 })
                           : new Response(result.outcome, { status: result.outcome === "ok" ? 200 : 500 });
}
```

**Workers Assets does not get in the way.** Miniflare explicitly forwards scheduled events
past the asset router (`miniflare/dist/src/workers/assets/rpc-proxy.worker.js`, verbatim
comment):

```js
  // Forward scheduled events to the User Worker. The proxy itself doesn't run
  // any scheduled logic; it just dispatches a real scheduled event to the user
  // worker via the Fetcher built-in, then propagates the user worker's noRetry
  // decision back onto this controller so the outcome surfaces correctly to
  // the caller (e.g. the entry worker's `/cdn-cgi/local/scheduled` handler).
  async scheduled(controller) { … }
```

**Crons never fire on a schedule in local dev.** There is no local cron scheduler in
wrangler 4.131.1 — the only local paths are the two manual endpoints above. Budget for that
in the Phase 8 Definition of Done.

### 2.10 CPU / duration budget

`workers/platform/limits.mdx`, verbatim:

```
| Limit                     | Workers Free | Workers Paid                                                     |
| ------------------------- | ------------ | ---------------------------------------------------------------- |
| CPU time per HTTP request | 10 ms        | 5 min (default: 30 seconds)                                      |
| CPU time per Cron Trigger | 10 ms        | 30 seconds (< 1 hour interval) <br/> 15 min (>= 1 hour interval) |
```

```
## Duration
| Trigger type          | Duration limit |
| HTTP request          | No limit       |
| Cron Trigger          | 15 min         |
```

```
| Number of Cron Triggers per account | 5 | 250 |
```

Raising the HTTP CPU limit (same page, verbatim):

```jsonc
{
	// ...rest of your configuration...
	"limits": {
		"cpu_ms": 300000, // default is 30000 (30 seconds)
	},
	// ...rest of your configuration...
}
```

Reading of this for us:

- CPU time excludes waiting: *"Waiting on network requests (such as `fetch()` calls, KV
  reads, or database queries) does **not** count toward CPU time."* Our crons are almost
  entirely network-bound (D1, Gemini, Telegram), so CPU is unlikely to be the binding
  constraint — **wall clock 15 min is**.
- The generous 15 min CPU budget only applies to crons whose **interval is ≥ 1 hour**
  ([§4.1](#41-stack-factsmd-refinement-the-15-min-cron-cpu-budget-is-conditional)).
- Whether setting `limits.cpu_ms` *lowers* a ≥1h cron's 15-minute budget to that value is
  `UNVERIFIED` — the docs describe `cpu_ms` as "the maximum CPU time allowed per
  invocation" without carving out cron. **Recommendation: do not set `limits.cpu_ms` at
  all** unless a specific HTTP route needs it, so the documented cron default stands.
- Whether the *inner* invocation created by `env.WORKER_SELF_REFERENCE.fetch()` gets its own
  fresh CPU budget (HTTP rules: 30 s default) or shares the caller's is `UNVERIFIED`;
  Cloudflare's service-bindings page documents only the subrequest count and the 32-invocation
  depth cap. Another reason to prefer the direct path (option a).

---

## 3. Recommendation

**Adopt (a) as the mechanism, and structure the jobs so we normally don't need (b).**
Concretely: a custom worker entry at the project root whose `scheduled` handler dispatches on
`controller.cron` into **framework-free job modules** that take `env` explicitly. Keep (b)
available as a thin, secret-guarded escape hatch for the rare job that must run inside Next.

### 3.1 `worker.ts` — copy-pasteable, project root

Place at `<repo>/worker.ts` (the relative import `./.open-next/worker.js` assumes the repo
root; adjust the path if you move it).

```ts
// worker.ts — custom Worker entry. Wrangler's `main` points here, NOT at .open-next/worker.js.
//
// Why this file exists: the worker generated by @opennextjs/cloudflare exports only a
// `fetch` handler. Cron Triggers need a `scheduled` handler, so we wrap the generated
// handler and add our own. See docs/research/r01-cron-triggers-on-opennext.md
//
// HARD RULES:
//  1. NEVER call getCloudflareContext() below — it throws outside a request. Use `env`.
//  2. NEVER drop the DO re-export at the bottom — `wrangler deploy` fails without it.
//  3. Keep everything imported here framework-free (no next/*, no "server-only").

// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as openNextHandler } from "./.open-next/worker.js";

import { runCronJob, type CronName } from "./src/jobs/registry";

/** wrangler.jsonc `triggers.crons` → job name. Keys MUST match the config byte for byte. */
const CRON_ROUTES: Record<string, CronName> = {
  // 16:00 UTC = 21:00 Asia/Almaty (UTC+5, no DST)
  "0 16 * * *": "daily-reminder",
  // 15:30 UTC = 20:30 Asia/Almaty
  "30 15 * * *": "streak-at-risk",
  // Monday 03:05 UTC = Monday 08:05 Asia/Almaty
  "5 3 * * 1": "weekly-review",
  // 18:00 UTC Sunday = 23:00 Asia/Almaty Sunday
  "0 18 * * 7": "backup-to-r2",
};

export default {
  // Delegate every HTTP request to the OpenNext-generated handler, untouched.
  // Called as a method (not `fetch: openNextHandler.fetch`) so a future `this` use upstream
  // cannot silently break us.
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    return openNextHandler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    const job = CRON_ROUTES[controller.cron];

    if (!job) {
      // Misconfiguration, not a transient failure: a cron is registered in wrangler.jsonc
      // that no code handles. Log loudly and do NOT ask for a retry.
      console.error(`[cron] no job registered for "${controller.cron}"`);
      controller.noRetry();
      return;
    }

    const startedAt = Date.now();
    try {
      // `await`, not ctx.waitUntil: we want failures to surface in the invocation outcome.
      await runCronJob(job, {
        env,
        ctx,
        scheduledTime: new Date(controller.scheduledTime),
        cron: controller.cron,
      });
      console.log(`[cron] ${job} ok in ${Date.now() - startedAt}ms`);
    } catch (error) {
      // A failed cron is invisible to the user — there is no browser to show a 500 to.
      // Persist the failure so the dashboard/alerting can see it, and never let the
      // bookkeeping itself throw.
      console.error(`[cron] ${job} FAILED`, error);
      try {
        await env.DB.prepare(
          "insert into cron_runs (cron, job, started_at, finished_at, ok, error) values (?, ?, ?, ?, 0, ?)"
        )
          .bind(
            controller.cron,
            job,
            startedAt,
            Date.now(),
            error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          )
          .run();
      } catch (bookkeepingError) {
        console.error("[cron] could not record failure", bookkeepingError);
      }
      throw error; // marks the invocation outcome as an exception
    }
  },
} satisfies ExportedHandler<CloudflareEnv>;

// ---------------------------------------------------------------------------
// Durable Objects generated by OpenNext. `wrangler deploy` HARD-FAILS with
// "Your Worker depends on the following Durable Objects, which are not exported in your
// entrypoint file" if a bound class is missing here. Re-exporting an unbound class is
// harmless, so export all three and never prune this list.
// ---------------------------------------------------------------------------
// @ts-ignore `.open-next/worker.js` is generated at build time
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
```

### 3.2 `wrangler.jsonc` — the `main` change plus the `triggers` block

Only the cron-relevant parts are shown; keep everything `stack-facts.md` §OpenNext requires.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fitness-app-tair",

  // CHANGED: was ".open-next/worker.js". Points at our custom entry, which re-exports
  // the generated handler. See docs/research/r01-cron-triggers-on-opennext.md
  "main": "worker.ts",

  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],

  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },

  // Cron Triggers. ALL TIMES ARE UTC. Asia/Almaty is UTC+5 year-round (no DST),
  // so local = UTC + 5h. Every entry here MUST have a matching key in CRON_ROUTES
  // in worker.ts, byte for byte.
  "triggers": {
    "crons": [
      "0 16 * * *",  // 21:00 Almaty — daily "log your day" reminder
      "30 15 * * *", // 20:30 Almaty — streak-at-risk nudge
      "5 3 * * 1",   // Mon 08:05 Almaty — weekly review + Telegram report
      "0 18 * * 7"   // Sun 23:00 Almaty — backup to R2  (weekday field: Sunday = 7 or 1)
    ]
  },

  // Required by OpenNext for cache revalidation; we also use it as the option-(b) escape
  // hatch. `service` must equal `name` above.
  "services": [
    { "binding": "WORKER_SELF_REFERENCE", "service": "fitness-app-tair" }
  ],

  "d1_databases": [
    { "binding": "DB", "database_name": "fitness-app-tair", "database_id": "<UUID>" },
    { "binding": "NEXT_TAG_CACHE_D1", "database_name": "fitness-app-tair", "database_id": "<UUID>" }
  ],
  "r2_buckets": [
    { "binding": "MEDIA", "bucket_name": "fitness-app-tair-media" },
    { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "fitness-app-tair-opennext-cache" }
  ],
  "kv_namespaces": [
    { "binding": "CACHE_KV", "id": "<ID>" }
  ],
  "durable_objects": {
    "bindings": [
      { "name": "NEXT_CACHE_DO_QUEUE", "class_name": "DOQueueHandler" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["DOQueueHandler"] }
  ],

  "vars": {
    // The REAL public origin. Used only if a job must go through option (b) —
    // never invent a hostname. See gotcha §4.3.
    "APP_ORIGIN": "https://fitness-app-tair.<subdomain>.workers.dev"
  },

  "images": { "binding": "IMAGES" },
  "observability": { "enabled": true }
}
```

`CRON_SECRET` must be a **secret**, not a `var`: `npx wrangler secret put CRON_SECRET`.
(`wrangler types` inlines `vars` values as literal types into `worker-configuration.d.ts` —
I saw `CRON_SECRET: "probe-secret";` in the generated file — so anything in `vars` is
effectively source-visible.)

### 3.3 How the cron handler reaches app code and the bindings

**Primary path — direct call, no HTTP hop.** Job modules live in `src/jobs/` and receive
`env`. They must be importable by wrangler's esbuild, i.e. framework-free.

```ts
// src/jobs/types.ts
export type CronJobContext = {
  env: CloudflareEnv;
  ctx: ExecutionContext;
  scheduledTime: Date;
  cron: string;
};
```

```ts
// src/db/client.ts — the ONE place that builds a Drizzle instance.
// Takes the D1 binding explicitly so it is usable from BOTH a Next request and `scheduled`.
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function makeDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
```

```ts
// src/db/request-client.ts — Next-only sugar. NEVER import this from worker.ts.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { makeDb } from "./client";

export function db() {
  return makeDb(getCloudflareContext().env.DB);
}
```

```ts
// src/jobs/weekly-review.ts — a job. Pure TS: drizzle + fetch only.
import { makeDb } from "../db/client";
import type { CronJobContext } from "./types";

export async function weeklyReview({ env, scheduledTime }: CronJobContext) {
  const db = makeDb(env.DB);                       // D1  — no request context needed
  const media = env.MEDIA;                        // R2  — same
  const kv = env.CACHE_KV;                        // KV  — same
  // …read the week's sets/meals/check-ins, compute, call the AI abstraction,
  //   POST to the Telegram Bot API with env.TELEGRAM_BOT_TOKEN…
  void media; void kv; void db; void scheduledTime;
}
```

```ts
// src/jobs/registry.ts — the single dispatch table.
import { weeklyReview } from "./weekly-review";
import { dailyReminder } from "./daily-reminder";
import { streakAtRisk } from "./streak-at-risk";
import { backupToR2 } from "./backup-to-r2";
import type { CronJobContext } from "./types";

const JOBS = {
  "daily-reminder": dailyReminder,
  "streak-at-risk": streakAtRisk,
  "weekly-review": weeklyReview,
  "backup-to-r2": backupToR2,
} satisfies Record<string, (c: CronJobContext) => Promise<void>>;

export type CronName = keyof typeof JOBS;

export function runCronJob(name: CronName, c: CronJobContext) {
  return JOBS[name](c);
}
```

Because the jobs are ordinary functions, expose them through a Next route too — same code,
zero duplication — so the owner can trigger one from a phone and so Vitest can unit-test
them with a fake `env`:

```ts
// src/app/api/cron/[job]/route.ts — manual trigger + debugging only.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { runCronJob, type CronName } from "@/jobs/registry";

export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const { env, ctx } = getCloudflareContext();     // fine here — we ARE in a request
  const provided = request.headers.get("x-cron-secret") ?? "";
  const expected = env.CRON_SECRET ?? "";
  // constant-time-ish compare; reject empties so a missing secret never means "allow"
  if (!expected || provided.length !== expected.length) return new Response("nope", { status: 404 });
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return new Response("nope", { status: 404 });

  const { job } = await params;
  await runCronJob(job as CronName, {
    env, ctx, scheduledTime: new Date(), cron: "manual",
  });
  return Response.json({ ok: true, job });
}
```

**Escape-hatch path — option (b), only when a job genuinely needs the Next runtime**
(`revalidateTag`, rendering a React email, `next/og`):

```ts
// inside scheduled(), when and only when the job must run inside Next:
const res = await env.WORKER_SELF_REFERENCE.fetch(
  // Use the REAL origin from config. A placeholder hostname poisons the isolate — see §4.3.
  new Request(`${env.APP_ORIGIN}/api/cron/${job}`, {
    method: "POST",
    headers: { "x-cron-secret": env.CRON_SECRET },
  })
);
if (!res.ok) throw new Error(`cron ${job} via self-reference: ${res.status}`);
```

### 3.4 Build / deploy / test commands

```jsonc
// package.json scripts (unchanged from stack-facts.md, plus the cron test helpers)
{
  "cf-typegen": "wrangler types --env-interface CloudflareEnv",
  "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
  "preview:cron": "opennextjs-cloudflare build && opennextjs-cloudflare preview --test-scheduled",
  "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
}
```

```sh
# 1) types first — `next build` type-checks worker.ts, and it needs CloudflareEnv/ExportedHandler
npm run cf-typegen

# 2) local cron test, method A (explicit flag, friendly URL)
npm run preview:cron
curl "http://localhost:8787/__scheduled?cron=5+3+*+*+1"          # → "Ran scheduled event"

# 3) local cron test, method B (always available, machine-readable, can override the clock)
npm run preview
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=5+3+*+*+1&format=json"
# → {"outcome":"ok","noRetry":false}
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=5+3+*+*+1&time=1789222059351&format=json"

# 4) validate the DO exports + bindings without deploying
npx wrangler deploy --dry-run --outdir .dryrun

# 5) deploy (also PUTs triggers.crons)
npm run deploy

# 6) after deploy: confirm the schedules landed
npx wrangler triggers deploy --dry-run   # or check Dash → Worker → Settings → Trigger Events
```

`wrangler deploy` on its own is also safe: wrangler 4.131.1 detects an OpenNext project and
delegates (`wrangler-dist/cli.js`, `maybeDelegateToOpenNextDeployCommand`):

```js
      logger2.log(
        "OpenNext project detected, calling `opennextjs-cloudflare deploy`"
      );
```

### 3.5 `tsconfig.json` / CI ordering

```jsonc
{
  "compilerOptions": {
    // …existing…
    "types": ["./worker-configuration.d.ts"]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  // .open-next is generated; never type-check it
  "exclude": ["node_modules", ".open-next"]
}
```

CI order must be **`cf-typegen` → build → typecheck/lint**, because `worker.ts` matches
`**/*.ts` and `next build` runs `tsc` over it. Also commit `worker-configuration.d.ts`, or
run `cf-typegen` before anything else: with it missing I hit a real hard failure —

```
error TS2688: Cannot find type definition file for './worker-configuration.d.ts'.
Failed to type check.
Error: Command failed: npm run build
```

---

## 4. Gotchas that will silently break us

### 4.1 `stack-facts.md` refinement: the 15-min cron CPU budget is *conditional*

`stack-facts.md` says "CPU: 5 min per HTTP request, 15 min per Cron Trigger". The official
table is more restrictive for frequent crons:

| Limit | Workers Free | Workers Paid |
|---|---|---|
| CPU time per HTTP request | 10 ms | 5 min (**default: 30 seconds**) |
| CPU time per Cron Trigger | 10 ms | **30 seconds (< 1 hour interval)** / 15 min (>= 1 hour interval) |

Two corrections to internalise:

1. A cron on a **sub-hourly** schedule (`*/15 * * * *`, `*/30 * * * *`) gets **30 seconds**
   of CPU, not 15 minutes. If we ever add "check streak risk every 15 minutes", the budget
   silently drops 30×.
2. The 5-minute HTTP figure is the **maximum you can opt into** via `limits.cpu_ms`; the
   default is 30 seconds. `stack-facts.md` reads as though 5 min is the default.

All four crons recommended in §3.2 are ≥ 1 hour apart, so they land in the 15-min bucket.
Keep them that way. This is a refinement, not a contradiction — I am not overriding
`stack-facts.md`, I am flagging that its line is incomplete and should be amended.

Separately: wall-clock **Duration** for a Cron Trigger is a hard **15 min**, unlike HTTP
requests which have "No limit". Network waits *do* count against duration even though they
don't count against CPU — so a cron that makes hundreds of sequential Gemini calls can die
on duration while nowhere near the CPU ceiling.

### 4.2 `getCloudflareContext()` throws in `scheduled`, with a message that blames the wrong file

Covered in [§2.4](#24-getcloudflarecontext-throws-inside-scheduled--verified). The error text
tells you to fix `next.config.ts`, which is already correct. Any helper that reaches for
`getCloudflareContext()` internally — a `db()` singleton, an auth helper, an R2 signer, the
AI provider module — will explode the first time a cron touches it, at 21:00, with no user
watching. **Enforce the split**: `src/db/client.ts` takes `D1Database`;
`src/db/request-client.ts` is the only file allowed to call `getCloudflareContext()`, and
`worker.ts` must never import it. Worth an ESLint `no-restricted-imports` boundary rule.

### 4.3 A fake hostname in the self-fetch **poisons the whole isolate** (verified)

The nastiest finding. `.open-next/cloudflare/init.js` initialises `process.env` exactly once
per isolate:

```js
let initialized = false;
function init(request, env) {
    if (initialized) { return; }
    initialized = true;
    const url = new URL(request.url);
    initRuntime();
    populateProcessEnv(url, env);
}
```

and `populateProcessEnv` derives two origin values from **whichever request happened to be
first**:

```js
    process.env.OPEN_NEXT_ORIGIN = JSON.stringify({
        default: { host: url.hostname, protocol: url.protocol.slice(0, -1), port: url.port },
    });
    …
    process.env.__NEXT_PRIVATE_ORIGIN = url.origin;
```

I reproduced the poisoning. On a **cold** isolate I triggered the cron first (no prior HTTP
request), and the cron's self-fetch used a placeholder host `https://cron-probe.example.com`:

```json
"processEnvOriginAtStart": null,
"selfRefBody": "{… \"openNextOrigin\":\"{\\\"default\\\":{\\\"host\\\":\\\"cron-probe.example.com\\\",\\\"protocol\\\":\\\"https\\\",\\\"port\\\":\\\"\\\"}}\",\"nextPrivateOrigin\":\"https://cron-probe.example.com\"}",
"processEnvOriginAtEnd": "{\"default\":{\"host\":\"cron-probe.example.com\",\"protocol\":\"https\",\"port\":\"\"}}"
```

`processEnvOriginAtEnd` proves it **stays** wrong for the isolate's lifetime. Every real user
request served afterwards by that isolate inherits
`__NEXT_PRIVATE_ORIGIN = https://cron-probe.example.com` — which is what Next uses for
Server Action origin checks and for absolute redirects. Expected symptom: sporadic,
unreproducible Server Action rejections or wrong `Location` headers in the minutes after a
cron fires. Nothing logs an error.

For contrast, on a **warm** isolate (one `GET /` first) the origin was already correct and
the fake host did *not* overwrite it — which is exactly why this bug would be intermittent
and maddening.

**Mitigations, in order:** (1) prefer the direct job call (option a) so no synthetic request
exists; (2) if you must use option (b), build the URL from the real `APP_ORIGIN` var, never
`https://internal`, `https://localhost` or `https://worker`; (3) add a unit test asserting
that no string literal in `worker.ts` or `src/jobs/**` looks like a placeholder host.

### 4.4 Deleting the `triggers` block does **not** delete the cron (verified in source)

`resolveCronTriggers` returns `args.triggers ?? config2.triggers?.crons`, i.e. `undefined`
when the block is absent, and the deploy path is guarded by `if (crons)`. So:

- remove `triggers` from `wrangler.jsonc` → the previously deployed schedules **keep firing**
  against the new code;
- set `"triggers": { "crons": [] }` → `[]` is truthy, the `PUT` runs with an empty list
  ("*PUT will override previous schedules on this script*") and the schedules are cleared.

To retire a cron, set `crons` to the remaining list (or `[]`) and deploy. Never just delete
the block. And if you delete a `CRON_ROUTES` key without removing the cron, the still-live
schedule hits the `no job registered` branch — hence that branch exists and logs.

### 4.5 Missing the DO re-export fails the deploy (verified) — and it is easy to lose

Verbatim failure in [§2.3](#23-the-durable-object-re-export-is-load-bearing--verified). This
line is the first casualty of a "tidy up unused exports" lint autofix or an over-eager
`knip`/`ts-prune` run. Pin it with the comment block in §3.1 and add an
`eslint-disable`-proof note; better, assert it in CI with `wrangler deploy --dry-run`, which
catches it in seconds without touching production.

### 4.6 Cron times are UTC; Asia/Almaty is UTC+5 with no DST

Docs, verbatim: *"Cron Triggers execute on UTC time."* Verified the offset with Node's ICU
(tzdata bundled with node 24.12.0):

```
$ node -e "…Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',…})…"
UTC 2026-09-12T16:00Z -> 12/09/2026, 21:00:00 GMT+5
UTC 2026-01-15T16:00Z -> 15/01/2026, 21:00:00 GMT+5   # same offset in winter → no DST
UTC 2026-06-15T03:00Z -> 15/06/2026, 08:00:00 GMT+5
```

So **local = UTC + 5**, all year. A "9 pm reminder" is `0 16 * * *`, not `0 21 * * *`. Note
also the weekday field is **1-7 with Sunday = 1** (not the 0-6 most cron implementations
use) — `* * * * 1` is Sunday here, not Monday. Put the local time in a comment next to every
expression, and unit-test `CRON_ROUTES` keys against a table of expected Almaty times.

A second timezone trap, ours alone: the *semantic* day boundary for streaks, "today's
calories" and adherence % must be Asia/Almaty, not UTC. A cron at `0 18 * * *` (23:00
Almaty) still runs on the previous UTC day. Every job must derive "today" from
`scheduledTime` converted to Asia/Almaty, never from `new Date()` in UTC.

### 4.7 A failed cron is completely invisible

There is no browser, no 500, no user. If the Telegram POST fails or a D1 statement throws,
the only trace is the invocation outcome in Workers Logs. That is why §3.1 wraps everything
and persists to a `cron_runs` table, and why the schema should get:

```sql
create table cron_runs (
  id integer primary key autoincrement,
  cron text not null,
  job text not null,
  started_at integer not null,
  finished_at integer not null,
  ok integer not null,
  error text
);
create index cron_runs_job_started_idx on cron_runs (job, started_at desc);
```

Also set `"observability": { "enabled": true }` in `wrangler.jsonc` so Workers Logs retains
the invocations, and surface "last successful run per job" on the settings/dashboard screen —
a cron that has silently not run for nine days is otherwise undetectable.

### 4.8 Retry semantics are undocumented

`ScheduledController` exposes `noRetry(): void`, and miniflare's `/cdn-cgi/local/scheduled`
reports `noRetry` in its JSON, so *some* retry behaviour exists for scheduled invocations.
The exact policy (how many retries, what backoff, whether retries happen at all on the
Workers Paid plan) is **UNVERIFIED** — neither the cron-triggers page nor the scheduled-handler
page states it. Practical consequence: **make every job idempotent** (a "reminder already
sent for 2026-09-12" guard keyed on the Almaty date, an upsert rather than an insert for the
weekly report row), and call `controller.noRetry()` for permanent errors like the unknown-cron
branch. Do not design around retries you cannot confirm.

### 4.9 Cron timing is best-effort, and the account budget is small

Docs, verbatim: *"Workers scheduled by Cron Triggers will run on underutilized machines to
make the best use of Cloudflare's capacity and route traffic efficiently."* Treat the
schedule as approximate — do not build anything that assumes the 21:00 job runs at exactly
21:00:00. Also verbatim: *"Changes may take several minutes (up to 15 minutes)"* to
propagate after deploy, so a freshly deployed cron may not appear in the dashboard at once.

And: *"Number of Cron Triggers per account | 5 | 250"* — **per account, not per Worker**, and
only **5** on the free plan. Four crons is already most of a free account's budget; the
Workers Paid $5/mo plan (which `stack-facts.md` already assumes) lifts it to 250.

### 4.10 `fetch: handler.fetch` drops `this`

The docs' snippet and the historical example both write `fetch: handler.fetch`, which works
today only because the generated `fetch` never touches `this` (verified by reading the
template in [§2.1](#21-option-d-does-not-exist--there-is-no-first-class-cron-support-in-1206)).
That is an upstream implementation detail that could change in any 1.20.x patch. §3.1 wraps
it in a method instead — one line, removes the risk permanently.

### 4.11 Anything imported into `worker.ts` gets bundled by wrangler, not by Next

`worker.ts` is compiled by **wrangler's** esbuild, which knows nothing about Next's module
graph. A job module that transitively imports `next/headers`, `next/cache`, `server-only`,
`next/navigation` or a `"use client"` file will fail the wrangler bundle (or, worse, bundle
a second copy of something heavy and eat into the Worker size limit). Keep `src/jobs/**` and
`src/db/client.ts` framework-free. `@opennextjs/cloudflare` itself must not be imported from
`worker.ts` either — importing it is what tempts you into `getCloudflareContext()`.

### 4.12 Local dev never fires crons on a schedule

No cron scheduler exists in `wrangler dev` 4.131.1. If the Phase 8 DoD says "weekly Telegram
report fires from Cron", the local proof is a `curl` to `/__scheduled` or
`/cdn-cgi/local/scheduled`, and the production proof is a Workers Logs entry plus a row in
`cron_runs`. Write the DoD that way so nobody waits for a cron that will never come.

### 4.13 `wrangler types` must be re-run after every `wrangler.jsonc` change

`wrangler types --env-interface CloudflareEnv` reads `main` and generates
`WORKER_SELF_REFERENCE: Service<typeof import("./worker").default>` — a **circular**
reference back into `worker.ts`. It works (verified: build green), but it means a broken
`worker.ts` can produce confusing type errors on the `env` object itself. Also, adding a
binding without re-running `cf-typegen` gives you `Property 'X' does not exist on type
'CloudflareEnv'` at the exact moment you need it.

---

## 5. Open decision for the owner

**Decision: where do scheduled jobs execute — inside the app Worker (custom entry) or in a
second, dedicated cron Worker?**

- **Option A — custom entry in the app Worker (recommended).** One deploy, one set of
  bindings, jobs share `src/` with the app, and the documented OpenNext path. Cost: a cron
  job runs in the same Worker as the UI, so a pathological job burns the app Worker's CPU
  and a `worker.ts` mistake can break HTTP serving too (mitigated by `--dry-run` in CI and
  by never touching the `fetch` delegation).
- **Option B — a second Worker (`fitness-app-tair-cron`) with its own `triggers.crons`.**
  Full isolation and an independent CPU/duration budget. Cost: a second `wrangler.*.jsonc`
  whose `d1_databases` / `r2_buckets` must be kept in lockstep with the app's (drift here
  fails silently — the cron writes to the wrong D1), a second CI deploy step, no shared
  `src/` without extracting an internal package, and a second slot against the per-account
  Cron Trigger budget.

**My recommendation: Option A now**, because (i) it is what OpenNext documents and supports,
(ii) our jobs are network-bound, not CPU-bound, so co-tenancy is cheap, (iii) code sharing
with `src/jobs/` and Drizzle is the whole point, and (iv) the migration path to Option B is
mechanical if a job ever grows heavy: the job modules already take `env` explicitly, so they
move to a second Worker unchanged.

Record the choice in `DECISIONS.md` at Phase 0/8, together with the `main: "worker.ts"`
change, since that one line affects every future deploy.

Two smaller calls for the owner, both defaultable:

- **`limits.cpu_ms`** — I recommend **not setting it**, so the documented cron default (15
  min for ≥1h crons) applies unambiguously. Whether `cpu_ms` would cap a cron below 15 min
  is `UNVERIFIED`; setting it to "help" could quietly make things worse.
- **Sub-hourly crons** — avoid them. Keep every schedule ≥ 1 hour apart to stay in the
  15-min CPU bucket ([§4.1](#41-stack-factsmd-refinement-the-15-min-cron-cpu-budget-is-conditional)).

---

## 6. Sources

### Official documentation (URLs)

- OpenNext — Custom Worker (the authoritative answer):
  https://opennext.js.org/cloudflare/howtos/custom-worker
  raw source read via `gh api repos/opennextjs/docs/contents/pages/cloudflare/howtos/custom-worker.mdx`
- OpenNext — Bindings / `getCloudflareContext` / `wrangler types --env-interface CloudflareEnv`:
  https://opennext.js.org/cloudflare/bindings
  (raw: `repos/opennextjs/docs/contents/pages/cloudflare/bindings.mdx`)
- OpenNext issue #446 "[FEATURE] Workers scheduled" (closed → custom worker):
  https://github.com/opennextjs/opennextjs-cloudflare/issues/446
- The (now-deleted) official example, recovered from git history:
  `examples/playground14/worker.ts` @ `1868c99071f10f30988844ee9070dc5276ca1f95`;
  deleted in `364b7d91b221cddf0139f6875319de605a8fde77`
- Cloudflare — Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
  (raw: `repos/cloudflare/cloudflare-docs/contents/src/content/docs/workers/configuration/cron-triggers.mdx`)
- Cloudflare — `scheduled()` handler: https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- Cloudflare — Limits (CPU time, Duration, cron count):
  https://developers.cloudflare.com/workers/platform/limits/
  (raw: `.../src/content/docs/workers/platform/limits.mdx`)
- Cloudflare — Wrangler configuration (`main`, `triggers.crons`, `services`, `limits.cpu_ms`):
  https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare — Service bindings (overview + limits + the Access note):
  https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
  (raw: `.../workers/runtime-apis/bindings/service-bindings/index.mdx`)
- Cloudflare — Service bindings, HTTP ("provide a valid and fully-qualified URL"):
  https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http
- Cloudflare — Compatibility flags (`global_fetch_strictly_public`):
  https://developers.cloudflare.com/workers/configuration/compatibility-flags/

### Package source I read (scratchpad paths)

Root: `C:\Users\tairc\AppData\Local\Temp\claude\C--Users-tairc-Documents-codespace-fitness-app-tair\85fb1989-5a8f-448f-9e9a-162342b812b6\scratchpad`

- `cf\node_modules\@opennextjs\cloudflare\package.json` — version 1.20.6, peers
  (`next >=15.5.24 <16 || >=16.3.3`, `wrangler ^4.125.0`)
- `cf\node_modules\@opennextjs\cloudflare\dist\cli\templates\worker.js` — the generated
  worker: `fetch` only, three DO re-exports
- `cf\node_modules\@opennextjs\cloudflare\dist\cli\templates\init.js` —
  `runWithCloudflareRequestContext`, the ALS, `let initialized = false`, `populateProcessEnv`
- `cf\node_modules\@opennextjs\cloudflare\dist\cli\build\utils\copy-package-cli-files.js` —
  `worker.js` is `copyFileSync`'d every build
- `cf\node_modules\@opennextjs\cloudflare\dist\cli\build\build.js`,
  `dist\cli\build\bundle-server.js`, `dist\cli\build\open-next\compile-init.js`,
  `dist\cli\build\open-next\compileDurableObjects.js`
- `cf\node_modules\@opennextjs\cloudflare\dist\cli\build\utils\ensure-cf-config.js` —
  validates `open-next.config.ts` only, never `main`
- `cf\node_modules\@opennextjs\cloudflare\dist\api\cloudflare-context.js` / `.d.ts` —
  `getCloudflareContext` sync/async paths, the `CloudflareEnv` global interface, the
  hard-coded binding names
- `cf\node_modules\@opennextjs\cloudflare\dist\cli\index.js` —
  `parserConfiguration({ "unknown-options-as-args": true })` (flag passthrough)
- `cf\node_modules\@opennextjs\cloudflare\dist\cli\commands\{deploy,preview}.js`,
  `dist\cli\commands\utils\{utils,run-wrangler}.js`
- `cf\node_modules\@opennextjs\cloudflare\templates\{wrangler.jsonc,open-next.config.ts}`
- `cf\node_modules\wrangler\templates\middleware\middleware-scheduled.ts` — the
  `/__scheduled` middleware
- `cf\node_modules\wrangler\wrangler-dist\cli.js` — `test-scheduled` flag,
  `resolveCronTriggers`, the `PUT …/schedules` block, `unsafeTriggerHandlers: true`,
  `maybeDelegateToOpenNextDeployCommand`
- `cf\node_modules\miniflare\dist\src\workers\core\entry.worker.js` — `CorePaths.SCHEDULED`,
  `handleScheduled`
- `cf\node_modules\miniflare\dist\src\workers\assets\rpc-proxy.worker.js` — scheduled events
  forwarded past Workers Assets

### The probe I built and ran

`scratchpad\probe` — Next 16.3.5 + `@opennextjs/cloudflare` 1.20.6 + wrangler 4.131.1, with
`worker.ts`, `wrangler.jsonc` (`main: "worker.ts"`, `triggers.crons`, D1 + KV + service +
DO bindings), `app/api/cron/route.ts`, `app/api/probe/route.ts`, `app/api/d1/route.ts`.
Commands run: `opennextjs-cloudflare build`, `wrangler types --env-interface CloudflareEnv`,
`wrangler dev [--test-scheduled]`, `opennextjs-cloudflare preview --test-scheduled`,
`wrangler deploy --dry-run`, plus `curl` against `/__scheduled`,
`/cdn-cgi/local/scheduled`, `/api/probe`, `/api/d1`. It is disposable; nothing from it
belongs in the project.

### Sibling note consulted

- `C:\Users\tairc\Documents\codespace\fitness-app-tair\docs\research\r02-drizzle-d1-access-and-migrations.md`
  — independently reports the same `internal error; reference = …` sandbox failure for local
  D1, which is why I treat the local D1/KV failures here as environmental.
- `C:\Users\tairc\Documents\codespace\fitness-app-tair\docs\research\stack-facts.md`
- `C:\Users\tairc\Documents\codespace\fitness-app-tair\specs\00-brief.md`
