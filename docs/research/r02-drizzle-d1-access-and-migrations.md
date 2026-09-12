# R02 — Drizzle ORM 0.45.x on Cloudflare D1 inside Next.js App Router on `@opennextjs/cloudflare`

**Researched 2026-09-12.** Supersedes nothing; complements
[`stack-facts.md`](./stack-facts.md), which it does not contradict anywhere.

Every claim below is either (a) read out of the installed package's own shipped source /
`.d.ts`, (b) quoted from official Cloudflare / SQLite / Drizzle docs, (c) produced by a
command I actually ran, or (d) explicitly tagged `UNVERIFIED`.

**Versions actually installed and inspected for this note** (scratchpad, not the project):

| Package | Version installed & inspected |
|---|---|
| `drizzle-orm` | 0.45.2 |
| `drizzle-kit` | 0.31.10 |
| `@opennextjs/cloudflare` | 1.20.6 |
| `wrangler` | 4.131.1 (bundles `workerd@1.20260911.1`) |
| `typescript` | 5.9.3 |
| `node` | 24.12.0 (`node:sqlite` → SQLite **3.50.4**) |

All four match `stack-facts.md` exactly.

**One environment caveat up front:** Miniflare/`workerd` could not start in this research
sandbox — every `wrangler d1 execute --local` / `migrations apply --local` died with
`internal error; reference = …` from `executeLocally`. So I could not execute SQL *against
D1 itself*. I compensated by (1) reading wrangler's shipped `cli.js` to see exactly what it
sends to D1, and (2) executing the same SQL against real SQLite 3.50.4 via `node:sqlite`.
Where a claim rests on that substitution I say so.

---

## 1. Question

For this app, what is the exact, current, correct pattern for:

1. obtaining the D1 binding from Next.js server code — `getCloudflareContext()` vs
   `getCloudflareContext({async:true})`, per execution context, and what breaks if the
   drizzle instance is cached in a module global;
2. the per-request `drizzle(env.DB, { schema })` call, and whether memoising it is safe;
3. migrations — making `drizzle-kit generate` output land where
   `wrangler d1 migrations apply` finds it, the exact `drizzle.config.ts`, `--local` vs
   `--remote`, and where local D1 state lives on disk;
4. the drift between wrangler's `d1_migrations` bookkeeping table and the real schema, plus
   a concrete checked-in guard;
5. seeding a few thousand rows without hitting D1's statement/parameter/size limits;
6. the D1 constraints that actually shape our schema (no native boolean/date, size limits).

---

## 2. Verified answer

### 2.1 How server code gets the D1 binding

`@opennextjs/cloudflare@1.20.6` ships two overloads
(`node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.d.ts`):

```ts
export declare function getCloudflareContext<
  CfProperties extends Record<string, unknown> = IncomingRequestCfProperties,
  Context = ExecutionContext,
>(options: { async: true }): Promise<CloudflareContext<CfProperties, Context>>;

export declare function getCloudflareContext<
  CfProperties extends Record<string, unknown> = IncomingRequestCfProperties,
  Context = ExecutionContext,
>(options?: { async: false }): CloudflareContext<CfProperties, Context>;
```

`CloudflareContext` is `{ env: CloudflareEnv; cf: CfProperties | undefined; ctx: Context }`.

#### The mechanism (this is the part that explains every failure mode)

`dist/api/cloudflare-context.js`, verbatim:

```js
const cloudflareContextSymbol = Symbol.for("__cloudflare-context__");

export function getCloudflareContext(options = { async: false }) {
    return options.async ? getCloudflareContextAsync() : getCloudflareContextSync();
}

function getCloudflareContextFromGlobalScope() {
    const global = globalThis;
    return global[cloudflareContextSymbol];
}

function inSSG() {
    const global = globalThis;
    // Note: Next.js sets globalThis.__NEXT_DATA__.nextExport to true for SSG routes
    return global.__NEXT_DATA__?.nextExport === true;
}

function getCloudflareContextSync() {
    const cloudflareContext = getCloudflareContextFromGlobalScope();
    if (cloudflareContext) {
        return cloudflareContext;
    }
    if (inSSG()) {
        throw new Error(`\n\nERROR: \`getCloudflareContext\` has been called in sync mode in either a static route or at the top level of a non-static one,` +
            ` both cases are not allowed but can be solved by either:\n` +
            `  - make sure that the call is not at the top level and that the route is not static\n` +
            `  - call \`getCloudflareContext({async: true})\` to use the \`async\` mode\n` +
            `  - avoid calling \`getCloudflareContext\` in the route\n`);
    }
    throw new Error(initOpenNextCloudflareForDevErrorMsg);
}

async function getCloudflareContextAsync() {
    const cloudflareContext = getCloudflareContextFromGlobalScope();
    if (cloudflareContext) {
        return cloudflareContext;
    }
    const inNodejsRuntime = process.env.NEXT_RUNTIME === "nodejs";
    if (inNodejsRuntime || inSSG()) {
        const cloudflareContext = await getCloudflareContextFromWrangler();
        addCloudflareContextToNodejsGlobal(cloudflareContext);
        return cloudflareContext;
    }
    throw new Error(initOpenNextCloudflareForDevErrorMsg);
}
```

And in the **production** worker, the value behind that symbol is not a stored object — it
is a live `AsyncLocalStorage` read. `dist/cli/templates/init.js`, verbatim:

```js
import { AsyncLocalStorage } from "node:async_hooks";
const cloudflareContextALS = new AsyncLocalStorage();

// Note: this symbol needs to be kept in sync with `src/api/get-cloudflare-context.ts`
Object.defineProperty(globalThis, Symbol.for("__cloudflare-context__"), {
    get() {
        return cloudflareContextALS.getStore();
    },
});

export async function runWithCloudflareRequestContext(request, env, ctx, handler) {
    init(request, env);
    return cloudflareContextALS.run({ env, ctx, cf: request.cf }, handler);
}
```

And `dist/cli/templates/worker.js` calls it from exactly one place:

```js
export default {
    async fetch(request, env, ctx) {
        return runWithCloudflareRequestContext(request, env, ctx, async () => {
            /* … middleware + Next handler … */
        });
    },
};
```

Three consequences fall straight out of that:

* In production the context exists **only inside the async scope of a `fetch` invocation**.
  Outside it, `getStore()` is `undefined` and the symbol getter returns `undefined`.
* The generated worker exports **only `fetch`** — no `scheduled`. So a Cron Trigger never
  enters the ALS scope (see §2.3).
* `globalThis[Symbol.for("__cloudflare-context__")]` is defined in production with a
  **getter and no setter**. In dev, by contrast, `initOpenNextCloudflareForDev()` does
  `global[cloudflareContextSymbol] = cloudflareContext` — a plain, process-wide, *mutable*
  property built from `wrangler`'s `getPlatformProxy()`. Dev and prod therefore have
  genuinely different lifetimes for the same object, which is why module-level caching
  "works locally" and then misbehaves in production.

#### Which form works where

| Context | `getCloudflareContext()` (sync) | `getCloudflareContext({ async: true })` |
|---|---|---|
| Route handler (`app/api/**/route.ts`) | ✅ works | ✅ works (resolves immediately from ALS) |
| **Dynamic** server component / page | ✅ works | ✅ works |
| Server action (`"use server"`) | ✅ works | ✅ works |
| `middleware.ts` | ✅ works (runs inside the same ALS scope — the worker calls `middlewareHandler` inside `runWithCloudflareRequestContext`) | ✅ works |
| Module top level (import-time side effect) | ❌ **throws** | ✅ in `next dev` / `next build`; ❌ at import time inside the deployed worker (see below) |
| Statically prerendered route (`next build`) | ❌ **throws** | ✅ — but reads your **local** bindings, not production |
| Cron `scheduled()` handler | ❌ **throws** | ❌ **throws** (see §2.3) |

Official wording, from the OpenNext docs (`https://opennext.js.org/cloudflare/bindings`):

> "`getCloudflareContext` can only be used in SSG routes in 'async mode' (making it return
> a promise), to run the function in such a way simply provide an options argument with
> `async` set to `true`"

> "During SSG caution is advised since secrets (stored in `.dev.vars` files) and local
> development values from bindings (like values saved in a local KV) will be used for the
> pages static generation."

And the adapter's own generated API docs:

> "Retrieves the Cloudflare context in async mode. This is required for static routes and
> top-level module code."

Two important precisions on top of the docs, derived from the source above:

* `inSSG()` only detects **Pages Router** export (`globalThis.__NEXT_DATA__.nextExport`).
  For an **App Router** static prerender, `inSSG()` is `false`, so the *sync* form throws
  the misleading `initOpenNextCloudflareForDev` error rather than the helpful SSG one.
  The *async* form still works there, because App Router render workers run with
  `process.env.NEXT_RUNTIME === "nodejs"` and it falls through to `getPlatformProxy()`.
  → **A statically prerendered page that reads D1 at build time reads
  `.wrangler/state/v3/d1`, i.e. your laptop's database, and bakes those rows into the
  deployed HTML.** For this app every D1-reading route must be dynamic.
  (The `NEXT_RUNTIME === "nodejs"` value during App Router prerender is `UNVERIFIED` —
  I read the code path but did not run `next build`. The conclusion is unaffected: sync
  throws either way, and async either throws or reads local data, so neither is acceptable
  in a static route.)
* The async fallback does `await import("wrangler")` (written obfuscated as
  `` `${"__wrangler".replaceAll("_", "")}` `` with a `webpackIgnore` comment specifically
  so "we never want wrangler to be bundled in the Next.js app"). So in the **deployed
  worker** the async fallback cannot work — `wrangler` is not in the bundle. Async mode in
  production is only ever "read the ALS store, already there".

#### What breaks if you cache the drizzle instance in a module global

Three distinct failures, in increasing subtlety:

1. **You cannot even build the cache the obvious way.** `const db = drizzle(getCloudflareContext().env.DB)`
   at module scope throws at import time — there is no ALS store during module evaluation.
   In the deployed worker the async variant throws too (no bundled `wrangler`).
   This one is loud, and therefore harmless.

2. **`next dev` gives you a false positive.** In dev the context is a plain process global
   set once by `initOpenNextCloudflareForDev()`, so a module-level cache appears to work
   perfectly. It holds a `getPlatformProxy()` handle that survives HMR and route
   recompilation, so you will ship a pattern that only ever ran under dev semantics.

3. **The real production hazard is cross-request I/O.** Cloudflare's own rule, from
   [Bindings (`env`)](https://developers.cloudflare.com/workers/runtime-apis/bindings/):

   > "Workers do not allow I/O from outside a request context. This means that even though
   > `env` is accessible from the top-level scope, you will not be able to access every
   > binding's methods."

   and from the Workers error reference:

   > I/O objects (such as streams, request/response bodies, and others) created in the
   > context of one request handler cannot be accessed from a different request's handler.

   A `D1Database` stub is not itself a stream, so a cached one *may* keep working across
   requests — but `drizzle-orm`'s D1 session holds more than the stub. From
   `drizzle-orm/d1/session.js`, verbatim:

   ```js
   prepareQuery(query, fields, executeMethod, isResponseInArrayMode, customResultMapper, queryMetadata, cacheConfig) {
       const stmt = this.client.prepare(query.sql);
       return new D1PreparedQuery(stmt, query, this.logger, /* … */);
   }
   ```

   Every drizzle query materialises a real `D1PreparedStatement` from the client. Caching
   the *database* object across requests is what invites
   `Cannot perform I/O on behalf of a different request`. Cloudflare's guidance is
   unambiguous: *"avoid global mutable state entirely and pass request-scoped data through
   function arguments instead."*

   (That a *module-cached* `drizzle(env.DB)` specifically throws that error on D1 in
   production is `UNVERIFIED` — I could not run workerd here. The rule and the
   recommendation are documented and are what we will follow regardless. The point is: the
   upside of caching is ~nothing, §2.2, and the downside is an error you will only see
   under concurrency in production.)

### 2.2 The per-request `drizzle(env.DB, { schema })` pattern, and memoisation

`drizzle-orm/d1/driver.js`, the whole factory, verbatim:

```js
function drizzle(client, config = {}) {
  const dialect = new SQLiteAsyncDialect({ casing: config.casing });
  let logger;
  if (config.logger === true) {
    logger = new DefaultLogger();
  } else if (config.logger !== false) {
    logger = config.logger;
  }
  let schema;
  if (config.schema) {
    const tablesConfig = extractTablesRelationalConfig(
      config.schema,
      createTableRelationsHelpers
    );
    schema = {
      fullSchema: config.schema,
      schema: tablesConfig.tables,
      tableNamesMap: tablesConfig.tableNamesMap
    };
  }
  const session = new SQLiteD1Session(client, dialect, schema, { logger, cache: config.cache });
  const db = new DrizzleD1Database("async", dialect, session, schema);
  db.$client = client;
  db.$cache = config.cache;
  if (db.$cache) {
    db.$cache["invalidate"] = config.cache?.onMutate;
  }
  return db;
}
```

**Cost of `drizzle()`:** one `SQLiteAsyncDialect`, one call to
`extractTablesRelationalConfig(schema)`, one session, one db object. **No I/O, no
connection, no handshake.** `extractTablesRelationalConfig` walks the schema object once
— for a schema of our size (~20 tables) this is microseconds. There is nothing worth
memoising, and memoising is what buys you the cross-request hazard in §2.1.

**Answer: build it per request. Do not memoise it in a module global.** If you want to
avoid rebuilding it several times within one request, memoise it *per request* — e.g. React
`cache()` in server components, or just pass `db` down as an argument (Cloudflare's own
advice). Do not reach for `globalThis`.

`DrizzleConfig` (from `drizzle-orm/utils.d.ts`) accepts exactly four keys:

```ts
export interface DrizzleConfig<TSchema extends Record<string, unknown> = Record<string, never>> {
    logger?: boolean | Logger;
    schema?: TSchema;
    casing?: Casing;
    cache?: Cache;
}
```

The accessor module below **compiles clean** under `strict: true` with drizzle-orm 0.45.2 +
`@opennextjs/cloudflare` 1.20.6 + a `worker-configuration.d.ts` generated by
`wrangler types` (I ran `tsc --noEmit`; exit 0):

```ts
// src/server/db/index.ts
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export type DB = DrizzleD1Database<typeof schema> & { $client: D1Database };

/** Request-scoped. Safe in route handlers, server actions, dynamic server components. */
export function getDb(): DB {
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema, casing: "snake_case" });
}

/** Additionally works at module top level, in SSG/prerender, and during `next build`. */
export async function getDbAsync(): Promise<DB> {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB, { schema, casing: "snake_case" });
}

/** Explicit-binding form, for the cron `scheduled()` handler where no ALS context exists. */
export function dbFromEnv(env: CloudflareEnv): DB {
  return drizzle(env.DB, { schema, casing: "snake_case" });
}
```

`CloudflareEnv` is the right type to take: OpenNext declares it globally
(`declare global { interface CloudflareEnv { … } }` in `cloudflare-context.d.ts`) and
wrangler augments the same interface. I ran:

```
npx wrangler types --env-interface CloudflareEnv
# ✨ Types written to worker-configuration.d.ts
```

and the head of the generated file is:

```ts
// Generated by Wrangler by running `wrangler types --env-interface=CloudflareEnv` (hash: …)
// Runtime types generated with workerd@1.20260911.1 2025-09-01 nodejs_compat
interface __BaseEnv_CloudflareEnv {
	DB: D1Database;
}
declare namespace Cloudflare {
	interface GlobalProps { mainModule: typeof import("./worker"); }
	interface Env extends __BaseEnv_CloudflareEnv {}
}
interface CloudflareEnv extends __BaseEnv_CloudflareEnv {}
```

**Never call `db.transaction()` with the D1 driver.** `drizzle-orm/d1/session.js`:

```js
async transaction(transaction, config) {
    const tx = new D1Transaction("async", this.dialect, this, this.schema);
    await this.run(sql.raw(`begin${config?.behavior ? " " + config.behavior : ""}`));
    try {
      const result = await transaction(tx);
      await this.run(sql`commit`);
      return result;
    } catch (err) {
      await this.run(sql`rollback`);
      throw err;
    }
}
```

It issues literal `begin` / `commit`. Cloudflare:

> "D1 operates in auto-commit."

and, in the import guide, you must strip `BEGIN TRANSACTION` / `COMMIT;` or you get
`cannot start a transaction within a transaction`. Use `db.batch()` instead — Cloudflare:

> "Batched statements are SQL transactions. If a statement in the sequence fails, then an
> error is returned for that specific statement, and it aborts or rolls back the entire
> sequence."

(The exact runtime error text drizzle's `db.transaction()` produces on D1 is `UNVERIFIED`.)

`db.batch()`'s type wants a **non-empty tuple**, not an array
(`drizzle-orm/d1/driver.d.ts` + `batch.d.ts`):

```ts
batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>;
```

I verified the failure: passing a `.map()` result gives

```
error TS2345: Argument of type 'SQLiteInsertBase<…>[]' is not assignable to parameter of
type 'readonly [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]'.
  Source provides no match for required element at position 0 in target.
```

so dynamic batches need the cast shown in §2.7.

### 2.3 Cron Triggers: the one place `getCloudflareContext()` cannot help

The generated worker exports only `fetch` (§2.1). To add `scheduled` you replace the entry
point. OpenNext's documented custom-worker recipe
(`https://opennext.js.org/cloudflare/howtos/custom-worker`), verbatim:

```ts
// @ts-ignore `.open-next/worker.ts` is generated at build time
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,

  async scheduled(event) {
    // ...
  },
} satisfies ExportedHandler<CloudflareEnv>;

// The re-export is only required if your app uses the DO Queue and DO Tag Cache
// @ts-ignore `.open-next/worker.ts` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
```

with

```json
{
-  "main": "./.open-next/worker.js"
+  "main": "./path/to/custom-worker.ts",
}
```

**Inside that `scheduled`, `getCloudflareContext()` throws, in both modes.** Sync mode:
`runWithCloudflareRequestContext` was never entered, so `getStore()` is `undefined`. Async
mode: the global is absent and the `wrangler` fallback is not bundled. Use the handler
arguments. Cloudflare's real signature
([Scheduled Handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/))
— note the docs' OpenNext snippet above abbreviates it to `scheduled(event)`:

```ts
async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
)
```

with `controller.cron`, `controller.type` (always `"scheduled"`) and
`controller.scheduledTime`. So:

```ts
// src/worker.ts  ← wrangler.jsonc "main" points here
// @ts-ignore generated at build time
import { default as handler } from "../.open-next/worker.js";
import { dbFromEnv } from "@/server/db";
import { runWeeklyReport } from "@/server/jobs/weekly-report";

export default {
  fetch: handler.fetch,

  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    // getCloudflareContext() would THROW here. Use `env` directly.
    const db = dbFromEnv(env);
    ctx.waitUntil(runWeeklyReport(db, env, controller.scheduledTime));
  },
} satisfies ExportedHandler<CloudflareEnv>;

// @ts-ignore generated at build time
export { DOQueueHandler, DOShardedTagCache } from "../.open-next/worker.js";
```

Every function reachable from cron must therefore take `db`/`env` as parameters rather
than calling `getCloudflareContext()` internally. That is a design constraint on the whole
server layer, and it is the subject of the open decision in §5.

### 2.4 The exact `drizzle.config.ts` for D1

`drizzle-kit@0.31.10`'s own `index.d.ts` enumerates the legal values:

```ts
declare const prefixes: readonly ["index", "timestamp", "supabase", "unix", "none"];
declare const drivers: readonly ["d1-http", "expo", "aws-data-api", "pglite", "durable-sqlite"];
declare const dialects: readonly ["postgresql", "mysql", "sqlite", "turso", "singlestore", "gel"];
```

and the D1 member of the `Config` union is exactly:

```ts
} | {
    dialect: Verify<Dialect, 'sqlite'>;
    driver: Verify<Driver, 'd1-http'>;
    dbCredentials: {
        accountId: string;
        databaseId: string;
        token: string;
    };
} | {
```

So: **`dialect: "sqlite"`. There is no `driver: "d1"`.** The only D1 driver value is
`"d1-http"`, and it exists solely so that the *connecting* commands (`push`, `pull`,
`migrate`, `studio`) can reach a remote D1 over the Cloudflare REST API. `generate` and
`export` never connect.

Because we apply migrations with wrangler (§2.5), we do **not** want `driver` at all —
omitting it keeps `drizzle-kit` in pure offline codegen mode and makes it structurally
impossible for `drizzle-kit` to write to the database. This is the config I generated and
ran against:

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",            // D1 is SQLite; there is no "d1" dialect
  schema: "./src/db/schema.ts",
  out: "./migrations",          // == wrangler.jsonc migrations_dir
  casing: "snake_case",         // MUST match the runtime drizzle({ casing }) value
  verbose: true,
  strict: true,
  // NO `driver` and NO `dbCredentials`: drizzle-kit never touches the DB.
  // wrangler owns application. See r02 §2.5.
});
```

If you ever *do* want `drizzle-kit studio` against remote D1, add a **second** config file
(`drizzle.config.studio.ts`) carrying `driver: "d1-http"` + `dbCredentials`, and never let
CI see it. Do not bolt `driver` onto the main config — `drizzle-kit push` with a live
driver is one keystroke from rewriting production schema outside the migration log.

`casing` is load-bearing: the value in `drizzle.config.ts` (used by `generate`) and the
value in `drizzle(client, { casing })` (used at query time) must match, or generated DDL
and runtime SQL will disagree about column names. Explicit column names in the schema
(which I recommend, and used) make this moot — but set both anyway.

### 2.5 Migrations: `drizzle-kit generate` → `wrangler d1 migrations apply`

**They already interoperate with zero glue.** Two independent facts make it work.

**(a) wrangler's default discovery pattern is exactly drizzle-kit's default output shape.**
From `wrangler/wrangler-dist/cli.js`:

```js
DEFAULT_MIGRATION_PATH = "./migrations";
DEFAULT_MIGRATION_TABLE = "d1_migrations";

function getDefaultMigrationsPattern(migrationsDir) {
  return normalizeRelativePath(`${migrationsDir}/*.sql`);
}
```

**(b) drizzle-kit writes flat, numerically-prefixed `.sql` files there.** I ran it:

```
$ npx drizzle-kit generate --name=init
2 tables
sets 8 columns 2 indexes 1 fks
workouts 6 columns 1 indexes 0 fks

[✓] Your SQL migration file ➜ migrations\0000_init.sql 🚀
```

producing

```
migrations/0000_init.sql
migrations/meta/0000_snapshot.json
migrations/meta/_journal.json
```

`migrations/meta/**` is `.json` inside a subdirectory, so `migrations/*.sql` never matches
it and wrangler ignores it. I verified wrangler genuinely reads drizzle's file: in a
directory containing only drizzle's `0000_init.sql`,

```
$ npx wrangler d1 migrations create DB "probe_next_number"
✅ Successfully created Migration '0001_probe_next_number.sql'!
```

— wrangler parsed `0000` as the leading number and continued the sequence (it uses
`leadingMigrationNumber()` = `parseInt(firstSegment.split("_")[0], 10)`).

So the `wrangler.jsonc` D1 binding is simply:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "fitness-tair",
      "database_id": "<uuid from `wrangler d1 create`>",
      "migrations_dir": "migrations"
      // migrations_table defaults to "d1_migrations"
      // migrations_pattern defaults to "migrations/*.sql" — leave it alone
    }
  ]
}
```

Wrangler 4.131.1 also added a `migrations_pattern` key and a drizzle-aware hint for people
using drizzle's *nested* layout:

```js
logger2.warn(
  `Could not find any migration files matching \`${migrationsPattern}\`. It looks like there are migration files matching \`${drizzlePattern}\` though. If you are using drizzle to manage your migrations, please set \`migrations_pattern\` to \`${drizzlePattern}\` in ${configFile}.`
);
```

We do not need it: drizzle-kit 0.31.10's default output is flat, which the default pattern
already matches. Note the guard — if `migrations_pattern` is set, `migrations_dir` must be
set too and the pattern must start with `${migrations_dir}/`.

#### What `wrangler d1 migrations apply` actually executes

For each unapplied file, verbatim from `cli.js`:

```js
function getCreateMigrationsTableQuery(migrationsTableName) {
  const escapedTableName = escapeIdentifier(migrationsTableName);
  return `CREATE TABLE IF NOT EXISTS ${escapedTableName}(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;
}

function buildMigrationQuery({ migrationsPath, migrationName, migrationsTableName }) {
  const migration = fs.readFileSync(path.join(migrationsPath, migrationName), "utf8");
  const escapedTableName = escapeIdentifier(migrationsTableName);
  return `${migration}
INSERT INTO ${escapedTableName} (name)
values ('${migrationName.replace(/'/g, "''")}');`;
}
```

i.e. *file contents + the bookkeeping INSERT, concatenated into one SQL string*, then
handed to `executeSql`. Locally that becomes one D1 batch:

```js
const sql = input.file ? readFileSync(input.file) : input.command;
const queries = splitSqlQuery(sql);
results = await db.batch(queries.map((query) => db.prepare(query)));
```

Remotely it becomes one POST to the D1 `query` endpoint, whose `sql` parameter the API
reference describes as:

> "Your SQL query. Supports multiple statements, joined by semicolons, which will be
> executed as a batch."

Combined with the D1 batch doc ("Batched statements are SQL transactions"), **every
migration file is applied atomically as one transaction, in both local and remote mode.**
That is good for atomicity and it is the root cause of the `PRAGMA foreign_keys` disaster
in §4.1.

`splitSqlQuery` is a real tokenising splitter (it tracks `'`/`"`/`` ` ``/`[]` quoting,
`--` line comments, `/* */` block comments, and a compound-statement stack for
`BEGIN … END` trigger bodies), so drizzle's `--> statement-breakpoint` markers — which are
`--` line comments — pass through harmlessly.

#### Local vs remote, and where local state lives

Verified flags on `wrangler@4.131.1`:

```
wrangler d1 execute <database>
      --command     The SQL query you wish to execute, or multiple queries separated by ';'
      --file        A .sql file to ingest
  -y, --yes         Answer "yes" to any prompts
      --local       Execute commands/files against a local DB for use with wrangler dev
      --remote      Execute commands/files against a remote D1 database …
      --persist-to  Specify directory to use for local persistence (for use with --local)
      --json        Return output as JSON
      --preview     Execute commands/files against a preview D1 database

wrangler d1 migrations apply <database>
      --local  --remote  --preview  --persist-to
```

**Local is the default.** Running with neither flag printed:

```
Resource location: local

Use --remote if you want to access the remote instance.

🌀 Executing on local database DB (00000000-0000-0000-0000-000000000000) from .wrangler\state\v3\d1:
🌀 To execute on your remote database, add a --remote flag to your wrangler command.
```

That is a real-run confirmation of the on-disk location. The source agrees:

```js
const persistencePath = getLocalPersistencePath(persistTo, config2);       // → <dir of wrangler config>/.wrangler/state
const resourcePersistencePath = path.join(persistencePath, "v3");          // → .wrangler/state/v3
const d1Persist = path.join(resourcePersistencePath, "d1");                // → .wrangler/state/v3/d1
```

and `getLocalPersistencePath` resolves `".wrangler/state"` relative to the directory of the
wrangler config file (or `--persist-to` relative to cwd).

**Local D1 state: `.wrangler/state/v3/d1/`.** Inside it, miniflare stores the SQLite file
under a directory named after the Durable Object unique key —
`miniflare-D1DatabaseObject/` — as `<object-id>.sqlite` plus `.sqlite-wal` / `.sqlite-shm`.
Source for the name: `miniflare/dist/src/index.js` has
`const uniqueKey = \`miniflare-${D1_DATABASE_OBJECT_CLASS_NAME}\`` with
`D1_DATABASE_OBJECT_CLASS_NAME = "D1DatabaseObject"`, and miniflare's docs comment
describes the artefact as *"a file with the extension `.sqlite`, and in certain situations
extra files with the extensions `.sqlite-wal`, and `.sqlite-shm`"*. The exact leaf
filename is `UNVERIFIED` — workerd would not run in this sandbox, so no file was created.
Practical consequence, which *is* verified: the whole tree is regenerable, so
**`.wrangler/` must be in `.gitignore`** (it already is in this repo — confirmed) and
"reset my local DB" is `rm -rf .wrangler/state/v3/d1` followed by a re-apply + re-seed.

Package scripts:

```jsonc
{
  "scripts": {
    "db:generate":    "drizzle-kit generate",
    "db:migrate:local":  "wrangler d1 migrations apply DB --local",
    "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
    "db:list:local":  "wrangler d1 migrations list DB --local",
    "db:list:remote": "wrangler d1 migrations list DB --remote",
    "db:verify":      "node scripts/verify-schema.mjs",
    "db:snapshot":    "node scripts/verify-schema.mjs --write",
    "db:studio":      "drizzle-kit studio --config drizzle.config.studio.ts"
  }
}
```

`wrangler d1 migrations apply --help` also documents the CI behaviour, verbatim:

> "When running the apply command in a CI/CD environment or another non-interactive
> command line, the confirmation step will be skipped, but the backup will still be
> captured."
>
> "If applying a migration results in an error, this migration will be rolled back, and the
> previous successful migration will remain applied."

**`drizzle-kit generate` must never run in CI.** Verified: with a renamed column and stdin
not a TTY, it dies with

```
Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false).
This can happen when running in CI, piped input, or non-interactive shells.
    at promptColumnsConflicts (…/drizzle-kit/bin.cjs:32711:65)
```

because it must ask "is `local_day` renamed to `local_date`, or dropped+added?".
`drizzle-kit export` and `drizzle-kit check`, by contrast, are non-interactive and CI-safe
(both ran fine through a pipe here).

### 2.6 The `d1_migrations` drift problem, and a concrete guard

**There are three separate bookkeeping schemes and they know nothing about each other.**

| Owner | Table | Key it records | Source |
|---|---|---|---|
| wrangler | `d1_migrations` | the **filename** (`0000_init.sql`) | `DEFAULT_MIGRATION_TABLE = "d1_migrations"` |
| drizzle-kit / `drizzle-orm/*/migrator` | `__drizzle_migrations` | a **sha256 of the file contents** + `folderMillis` | `config.migrationsTable ?? "__drizzle_migrations"` |
| drizzle-kit (on disk, not in the DB) | `migrations/meta/_journal.json` + `meta/NNNN_snapshot.json` | `{ idx, when, tag }` | generated output |

`drizzle-orm/d1/migrator.js`, verbatim, showing the second scheme and its
content-addressing:

```js
async function migrate(db, config) {
  const migrations = readMigrationFiles(config);
  const migrationsTable = config.migrationsTable ?? "__drizzle_migrations";
  …
  const dbMigrations = await db.values(
    sql`SELECT id, hash, created_at FROM ${sql.identifier(migrationsTable)} ORDER BY created_at DESC LIMIT 1`
  );
  const lastDbMigration = dbMigrations[0] ?? void 0;
  for (const migration of migrations) {
    if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) { … }
  }
}
```

Note also that `readMigrationFiles` lives in `drizzle-orm/migrator.js`, which begins:

```js
import crypto from "node:crypto";
import fs from "node:fs";
```

and does `fs.existsSync(journalPath)` / `fs.readFileSync(...)`. **`migrate()` from
`drizzle-orm/d1` cannot run inside a Worker** — there is no filesystem. Any "run migrations
on first request" idea is dead on arrival. Good: wrangler is the only mechanism anyway.

#### The four concrete ways we drift

1. **`d1_migrations` records a name, not a hash.** Edit an already-applied
   `0003_foo.sql` and wrangler will never reapply it, and never warn. The row says
   `0003_foo.sql` is applied; the file on disk no longer describes the database.
   **Applied migration files are immutable. Full stop.**
2. **Numbering collision between the two tools.** Verified empirically: with
   `0000_init.sql` and a wrangler-created `0001_probe_next_number.sql` in the folder,
   `drizzle-kit generate` ignored the wrangler file entirely (it numbers from its own
   `_journal.json` `idx`) and wrote **`0001_add_rir.sql`**. Two files numbered `0001`.
   Wrangler's `compareSegments` breaks the numeric tie with a plain string compare, so the
   apply order becomes alphabetical and non-obvious. → **Never run
   `wrangler d1 migrations create`.** Drizzle owns file creation; wrangler only applies.
3. **`push` / `studio` writing outside the log.** With `driver: "d1-http"` present,
   `drizzle-kit push` diffs the TS schema straight against the live DB and applies DDL
   without writing to `d1_migrations` *or* `__drizzle_migrations`. Instant, invisible,
   permanent drift. Mitigated structurally by omitting `driver` from the main config
   (§2.4).
4. **A third party creating tables in our database.** Verified: if
   `NEXT_TAG_CACHE_D1` points at the app database, `opennextjs-cloudflare populate-cache`
   runs, verbatim from `dist/cli/commands/populate-cache.js`:

   ```
   d1 execute NEXT_TAG_CACHE_D1 --command "CREATE TABLE IF NOT EXISTS revalidations (tag TEXT NOT NULL, revalidatedAt INTEGER NOT NULL, stale INTEGER, expire INTEGER default NULL, UNIQUE(tag) ON CONFLICT REPLACE);"
   ```

   followed by best-effort `ALTER TABLE revalidations ADD COLUMN stale INTEGER; …`.
   That table is invisible to drizzle and would make any naive drift check scream — or,
   worse, `drizzle-kit push` would offer to drop it.

#### The guard: a checked-in, offline, structural verify script

The idea: **do not compare against the live database at all** for the everyday check.
Compare the two artefacts that a developer can actually get wrong:

* `migrations/*.sql` replayed in order → what the database *will* look like;
* `drizzle-kit export --sql` → what `src/db/schema.ts` *believes*.

Both sides run against a throwaway in-memory SQLite via **`node:sqlite`** (built into
Node ≥ 22.5 — no native module, no `better-sqlite3`, works in CI on any OS). No D1, no
credentials, no network, no wrangler.

`drizzle-kit export --sql` is exactly the right expected-state source. `--help`:

```
Generate diff between current state and empty state in specified formats: sql
Flags:
  --sql   Generate as sql (default: true)
```

and its real output for my probe schema, to stdout, with no DB connection:

```sql
CREATE TABLE `sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	…
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `sets_workout_idx` ON `sets` (`workout_id`);
CREATE UNIQUE INDEX `sets_workout_exercise_order_uq` ON `sets` (`workout_id`,`exercise_id`,`id`);
…
```

**Compare structurally, not as DDL text.** I first wrote the naive string diff and it
produced a false positive on the very first run, because `ALTER TABLE … ADD COLUMN` appends
the column at the end of the table whereas `drizzle-kit export` emits declaration order:

```
  MISSING from migrations: CREATE TABLE "sets" (… "rpe" real, "rir" real, "is_pr" …)
  EXTRA in migrations:     CREATE TABLE "sets" (… "rpe" real, "is_pr" …, "rir" real)
```

So the script compares `PRAGMA table_info` / `index_list` / `index_info` /
`foreign_key_list` as order-independent sets. Here it is, as run:

```js
#!/usr/bin/env node
// scripts/verify-schema.mjs
// Schema-drift guard. Fully offline, no D1, no native deps (node:sqlite, Node >= 22.5).
//
//   A = migrations/*.sql replayed in order   -> what the DB will actually look like
//   B = `drizzle-kit export --sql`           -> what src/db/schema.ts believes
//
// Compares structurally (PRAGMA table_info / index_list / index_info / foreign_key_list)
// so that column ORDER differences -- unavoidable because ALTER TABLE ADD COLUMN appends
// while drizzle-kit export emits declaration order -- are not reported as drift.
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve("migrations");
// Tables owned by someone else that must never count as drift.
const IGNORE_TABLES = new Set(["d1_migrations", "_cf_KV", "revalidations", "__drizzle_migrations"]);

function applySql(db, sql) {
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) db.exec(s);
  }
}

function fromMigrations() {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no .sql files in ${MIGRATIONS_DIR}`);
  for (const f of files) applySql(db, readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  return db;
}

function fromSchemaTs() {
  // Invoke drizzle-kit's own JS entrypoint with node: portable, and avoids the
  // Node >=20 EINVAL when spawning .cmd shims on Windows.
  const bin = path.resolve("node_modules", "drizzle-kit", "bin.cjs");
  const sql = execFileSync(process.execPath, [bin, "export", "--sql"], { encoding: "utf8" });
  const db = new DatabaseSync(":memory:");
  applySql(db, sql);
  return db;
}

function fingerprint(db) {
  const out = {};
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name)
    .filter((n) => !IGNORE_TABLES.has(n));

  for (const t of tables) {
    const cols = db
      .prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)`)
      .all(t)
      .map((c) => `${c.name}:${String(c.type).toLowerCase()}:nn=${c.notnull}:def=${c.dflt_value ?? ""}:pk=${c.pk}`)
      .sort();

    const idx = db
      .prepare(`SELECT name, "unique", origin, partial FROM pragma_index_list(?)`)
      .all(t)
      .filter((i) => i.origin === "c") // explicit CREATE INDEX only; skip pk/unique-constraint indexes
      .map((i) => {
        const on = db.prepare(`SELECT name FROM pragma_index_info(?)`).all(i.name).map((r) => r.name);
        return `${i.name}(${on.join(",")}) uniq=${i.unique} partial=${i.partial}`;
      })
      .sort();

    const fks = db
      .prepare(`SELECT "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list(?)`)
      .all(t)
      .map((f) => `${f.from}->${f.table}.${f.to} upd=${f.on_update} del=${f.on_delete}`)
      .sort();

    out[t] = { cols, idx, fks };
  }
  return out;
}

const a = fingerprint(fromMigrations());
const b = fingerprint(fromSchemaTs());
const problems = [];

for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (!a[t]) { problems.push(`table ${t}: in schema.ts but NOT created by migrations/`); continue; }
  if (!b[t]) { problems.push(`table ${t}: created by migrations/ but NOT in schema.ts`); continue; }
  for (const part of ["cols", "idx", "fks"]) {
    const av = new Set(a[t][part]);
    const bv = new Set(b[t][part]);
    for (const x of bv) if (!av.has(x)) problems.push(`${t}.${part}: missing from migrations/ -> ${x}`);
    for (const x of av) if (!bv.has(x)) problems.push(`${t}.${part}: extra in migrations/   -> ${x}`);
  }
}

if (problems.length) {
  console.error("SCHEMA DRIFT: migrations/ does not replay to src/db/schema.ts\n");
  for (const p of problems) console.error("  " + p);
  console.error("\nFix: run `npm run db:generate` and commit the new migration.");
  process.exit(1);
}
console.log(`OK: migrations/ replays exactly to src/db/schema.ts (${Object.keys(b).length} tables).`);
```

**I ran it both ways.** Clean tree:

```
OK: migrations/ replays exactly to src/db/schema.ts (2 tables).
EXIT=0
```

Then I added a column and an index to `schema.ts` *without* generating a migration:

```
SCHEMA DRIFT: migrations/ does not replay to src/db/schema.ts

  sets.cols: missing from migrations/ -> tempo_sec:integer:nn=0:def=:pk=0
  sets.idx: missing from migrations/ -> sets_exercise_idx(exercise_id) uniq=0 partial=0

Fix: run `npm run db:generate` and commit the new migration.
EXIT=1
```

Wire `npm run db:verify` into CI alongside typecheck/lint. It needs no secrets, so it runs
on every PR including forks.

**The checked-in snapshot, and the live check.** Two complements:

* **Snapshot.** Commit `docs/db/schema.snapshot.sql` = the output of
  `drizzle-kit export --sql`, regenerated by the same script with `--write`. It makes every
  schema change visible as a human-readable diff in code review — which is the only place
  a `notNull()` added to a populated table, or an accidentally dropped index, gets caught
  by a person. (drizzle's own `migrations/meta/NNNN_snapshot.json` is machine-oriented and
  unreviewable; it must still be committed, because `generate` diffs against it — but it is
  not the artefact humans read.)
* **Live check, deploy-time only.** After `db:migrate:remote`, dump the real D1 schema and
  compare it to the snapshot:

  ```
  wrangler d1 export fitness-tair --remote --no-data --output=/tmp/live.sql
  ```

  (`--local`, `--remote`, `--no-data`, `--no-schema`, `--table`, `--output`,
  `-y/--skip-confirmation` all verified present on `wrangler@4.131.1` via
  `wrangler d1 export --help`.) Filter out `d1_migrations` / `revalidations` / `sqlite_%`
  and feed the rest through the same `fingerprint()` comparison. This is the check that
  catches someone having run `push` or a manual `d1 execute` against production.

* **`drizzle-kit check`** is a cheap third layer — it validates the journal/snapshot chain
  for collisions. It ran clean and non-interactively here: `Everything's fine 🐶🔥`.

### 2.7 Seeding a few thousand rows

Three limits collide here. From
[D1 Limits](https://developers.cloudflare.com/d1/platform/limits/), verbatim:

| Limit | Value |
|---|---|
| Maximum SQL statement length | `100,000 bytes (100 KB)` |
| Maximum bound parameters per query | `100` |
| Queries per Worker invocation (read subrequest limits) | `1000 (Workers Paid) / 50 (Free)` |
| Maximum string, BLOB or table row size | `2,000,000 bytes (2 MB)` |
| Maximum number of columns per table | `100` |
| Maximum database size | `10 GB (Workers Paid) / 500 MB (Free)` |

> "Limits for individual queries (listed above) apply to each individual statement
> contained within a batch statement. For example, the maximum SQL statement length of
> 100 KB applies to each statement inside a `db.batch()`."

**The 100-bound-parameters limit is the one that ambushes people.** A multi-row
`INSERT … VALUES (?,?,…),(?,?,…)` through drizzle uses one bound parameter *per value*.
Our `sets` table has 9 columns → **a parameterised multi-row insert caps out at 11 rows per
statement**, not the ~250 you would guess from the 100 KB limit. `db.insert(t).values(bigArray)`
will therefore fail on D1 long before it gets large.

#### Recommended: a generated `.sql` file with literal values + `wrangler d1 execute --file`

Literal values mean **zero bound parameters**, so only the 100 KB per-statement limit
applies. Cloudflare's own advice, verbatim from the import guide:

> "If a single SQL statement exceeds maximum allowed length, split large `INSERT`
> statements into multiple smaller ones. For example, convert one 1,000-row insert into
> four 250-row inserts."

Remote import does not even go through the query API — wrangler uploads the file to R2 and
D1 ingests it server-side (`executeRemotely` → `d1ApiPost(…, "import", { action:"init", etag })`
→ `uploadAndBeginIngestion` → `pollUntilComplete`), reporting
`Executed N queries … (rows read, rows written)`. The import path supports files up to
**5 GiB** (Cloudflare: *"The import feature supports files up to '5GiB,' matching R2's
upload limit"*).

I wrote and ran a generator that keeps every statement under the limit:

```js
// scripts/seedgen.mjs (excerpt)
const MAX_STATEMENT_BYTES = 90_000; // 100 KB hard limit; leave headroom
const q = (v) =>
  v === null || v === undefined ? "NULL"
  : typeof v === "number" ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;

export function buildInsertStatements(table, columns, rows) {
  const head = `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(",")}) VALUES\n`;
  const out = [];
  let tuples = [];
  let bytes = Buffer.byteLength(head);
  const flush = () => {
    if (tuples.length) { out.push(head + tuples.join(",\n") + ";"); tuples = []; bytes = Buffer.byteLength(head); }
  };
  for (const row of rows) {
    const t = `(${columns.map((c) => q(row[c])).join(",")})`;
    const tb = Buffer.byteLength(t) + 2;
    if (bytes + tb > MAX_STATEMENT_BYTES) flush();
    tuples.push(t); bytes += tb;
  }
  flush();
  return out;
}
```

Real run, 3000 synthetic `sets` rows, then replayed against the migrated schema in SQLite
3.50.4 to prove the file is valid:

```
statements: 4
max statement bytes: 89987
file bytes: 191486
seeded rows: 3000
```

Then:

```bash
npm run db:migrate:local && wrangler d1 execute DB --local --file=seed/exercises.sql
npm run db:migrate:remote && wrangler d1 execute DB --remote --file=seed/exercises.sql -y
```

Two things the seed file must respect:

* **No `BEGIN TRANSACTION` / `COMMIT`.** Cloudflare, verbatim: remove
  `"BEGIN TRANSACTION"` and `"COMMIT;"` or you get
  `"cannot start a transaction within a transaction"`.
* **Parent tables before child tables**, because FK enforcement is on by default (§2.8). If
  you cannot order them, Cloudflare's documented lever is
  `PRAGMA defer_foreign_keys = true` — but read §4.1 first, because it does **not** do what
  you probably want.

For our ~1000-exercise seed (name, muscles, equipment, R2 media key), at ~200–400 bytes per
row, expect 1 file of roughly 300 KB in 4–6 statements. Comfortable.

#### Alternative: `db.batch()` from inside a Worker / route handler

Only if the seed must be driven by app code (e.g. a CSV import from Hevy/Strong/MFP, which
this app needs in Phase 9). Then: one statement per row, `≤ 100` bound params per
statement (fine — one row is 9 params), and **`≤ 1000` queries per Worker invocation on
Paid**. So chunk at ~500 and loop across invocations, or accept a 50-row ceiling on Free.
This compiles clean (`tsc --noEmit`, exit 0), including the tuple cast that `db.batch()`
demands:

```ts
// src/server/db/seed.ts
import type { BatchItem } from "drizzle-orm/batch";
import { sets } from "@/db/schema";
import type { DB } from "./index";

type Row = typeof sets.$inferInsert;

export async function seedSets(db: DB, rows: Row[], chunkSize = 50) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const stmts = chunk.map((r) => db.insert(sets).values(r));
    // db.batch() requires a non-empty tuple type; a dynamic array needs this cast.
    await db.batch(stmts as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}
```

Do **not** use the multi-row form (`db.insert(sets).values(chunk)`) for chunks above
`floor(100 / columnCount)` rows — that is the bound-parameter trap.

### 2.8 D1 constraints that shape this app's schema

**No native boolean, no native date.** SQLite has neither; drizzle models both as
`integer` with a `mode`. From `drizzle-orm/sqlite-core/columns/integer.js`:

```js
function integer(a, b) {
  const { name, config } = getColumnNameAndConfig(a, b);
  if (config?.mode === "timestamp" || config?.mode === "timestamp_ms") {
    return new SQLiteTimestampBuilder(name, config.mode);
  }
  if (config?.mode === "boolean") {
    return new SQLiteBooleanBuilder(name, config.mode);
  }
  return new SQLiteIntegerBuilder(name);
}
```

with the exact conversions:

```js
class SQLiteTimestamp extends SQLiteBaseInteger {
  mapFromDriverValue(value) {
    if (this.config.mode === "timestamp") { return new Date(value * 1e3); }  // seconds
    return new Date(value);                                                  // milliseconds
  }
  mapToDriverValue(value) {
    const unix = value.getTime();
    if (this.config.mode === "timestamp") { return Math.floor(unix / 1e3); }
    return unix;
  }
}
class SQLiteBoolean extends SQLiteBaseInteger {
  mapFromDriverValue(value) { return Number(value) === 1; }
  mapToDriverValue(value) { return value ? 1 : 0; }
}
```

and `getSQLType()` on the base class returns `"integer"` for all three. Rules for us:

* **`integer({ mode: "boolean" })`** for `is_pr`, `is_deleted`, `is_warmup`, etc.
* **`integer({ mode: "timestamp_ms" })`** — always `_ms`, never plain `timestamp`.
  `mode: "timestamp"` silently truncates to whole seconds via `Math.floor(unix / 1e3)`, and
  this app has a rest timer and per-set timestamps where sub-second matters. Mixing the two
  modes across tables is a guaranteed off-by-1000 bug.
* **Local calendar days get their own `text` column.** The user is in `Asia/Almaty`
  (UTC+05, no DST). "Which day did this workout happen on" must not be derived from a UTC
  epoch in SQL — the streak/grace logic and the calendar heatmap both depend on it.
  Store `local_day TEXT` as `YYYY-MM-DD`, computed in app code, and index it. (I used
  `local_day text NOT NULL` in the probe schema for exactly this reason.)
* **`real` for weights, RPE, RIR.** Microloading needs 1.25 kg plates → `real`, not
  `integer`.
* **Never `boolean()` or a date type from `pg-core`/`mysql-core`.** They do not exist in
  `sqlite-core`; `integer({mode})` is the only route.
* **`defaultNow()` is deprecated.** drizzle's own JSDoc: *"@deprecated Use `default()`
  with your own expression instead."* Its expression is
  `(cast((julianday('now') - 2440587.5)*86400000 as integer))`. Prefer
  `.default(sql\`(unixepoch() * 1000)\`)` — verified to parse and evaluate correctly
  (`created_at` came back as `1789221376000` on SQLite 3.50.4).

**Booleans in generated DDL.** drizzle-kit emits the literal keyword `false`:

```sql
`is_pr` integer DEFAULT false NOT NULL,
`is_deleted` integer DEFAULT false NOT NULL,
`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
```

I verified on SQLite 3.50.4 that this parses and stores integer `0`
(`{ is_deleted: 0, t: 'integer' }`). That D1's SQLite build accepts the `false` keyword is
`UNVERIFIED` — Cloudflare does not publish D1's SQLite version (their docs only reference
3.24.0 in the context of `PRAGMA legacy_alter_table`, and say to use
`wrangler d1 info <DATABASE_NAME>` to see your database's version). SQLite has recognised
`TRUE`/`FALSE` as aliases for 1/0 since 3.23.0, and D1 is far newer than that, so this is
very likely fine — **but the very first `wrangler d1 migrations apply --remote` is the
moment to confirm it**, and it is a one-line smoke test in Phase 0's DoD.

**Other limits worth writing into the schema spec:**

* **Max 100 columns per table.** Our widest planned table, `food_entries`, is nowhere near
  it. Fine.
* **Max 2 MB per string/BLOB/row.** This is why the brief's "store R2 object keys only,
  never blobs, in D1" is not a style preference — a progress photo would blow the row
  limit. Also relevant to `ai_prompt_logs.output_json` and `food_entries.ai_estimate_json`:
  cap or truncate what you store, and keep the raw AI response in R2 if it can be large.
* **Max 100 bound parameters per query.** Beyond seeding, this bites on `WHERE x IN (…)`
  with a long list — e.g. "give me the last set for each of these 40 exercises" for
  previous-set ghosting. 40 is fine; 150 is not. Chunk `IN` lists, or restructure as a
  join/subquery.
* **1000 queries per Worker invocation (Paid) / 50 (Free).** Hard ceiling on N+1 patterns.
  Dashboard aggregates must be SQL aggregates, not per-row loops.
* **Storage.** `stack-facts.md` says "D1 free tier 5 GB storage, 5M reads/day" — that is
  correct and matches the pricing page (`Storage: "5 GB (total)"`,
  `Rows read: "5 million / day"`). It is a *different* limit from the limits page's
  **per-database** maximum of `500 MB (Free) / 10 GB (Workers Paid)`. Both are true; no
  contradiction. Neither constrains a single-user gym log.
* **No explicit transactions.** `db.batch()` is the only atomic unit (§2.2). Every
  multi-write operation in this app that must be all-or-nothing — "finish workout" writing
  a `workouts` row plus N `sets` rows plus a `personal_records` row plus a streak update —
  has to be expressed as one `db.batch()`, within the 100-param-per-statement and
  1000-query-per-invocation budget. Design the offline sync queue's flush around that.
* **`D1Database.withSession()` (read replication) exists in the runtime but drizzle 0.45.2
  does not support it.** `grep -r withSession node_modules/drizzle-orm` → zero hits. The
  runtime type is `withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint): D1DatabaseSession`
  with constraints `'first-primary' | 'first-unconstrained'`. Passing a session to
  `drizzle()` is a type error, verified:

  ```
  error TS2345: Argument of type 'D1DatabaseSession' is not assignable to parameter of type 'D1Database'.
    Type 'D1DatabaseSession' is missing the following properties from type 'D1Database': exec, withSession, dump
  ```

  It would work at runtime (drizzle only calls `.prepare()` and `.batch()`) behind a cast,
  but a single-user app in one region has no use for read replicas. Ignore it.

---

## 3. Recommendation

**File layout**

```
drizzle.config.ts                  # dialect:"sqlite", NO driver, out:"./migrations"
migrations/                        # drizzle-kit generate writes here; wrangler applies from here
  0000_init.sql
  meta/_journal.json               # committed, machine-only
  meta/0000_snapshot.json          # committed, machine-only
docs/db/schema.snapshot.sql        # committed, HUMAN-reviewable; == drizzle-kit export --sql
scripts/verify-schema.mjs          # §2.6 guard; CI-safe, offline
seed/*.sql                         # generated literal-value seeds; committed or built
src/db/schema.ts                   # single source of truth
src/server/db/index.ts             # getDb() / getDbAsync() / dbFromEnv()
src/worker.ts                      # custom entrypoint: fetch: handler.fetch + scheduled()
.wrangler/                         # gitignored
```

**Rules, in priority order**

1. **`getDb()` (sync) everywhere in request-handling code.** Build the drizzle instance
   per request; never memoise it in a module global. Never call `getCloudflareContext()` at
   module top level.
2. **Every D1-reading route is dynamic.** Add `export const dynamic = "force-dynamic"` (or
   a genuine dynamic API) to any page/route that touches the DB, so a build-time prerender
   can never bake local rows into production HTML. Reserve `getDbAsync()` for the rare
   deliberate build-time read.
3. **Cron code takes `db`/`env` as parameters.** `getCloudflareContext()` throws in
   `scheduled()`. Keep the job layer pure (`runWeeklyReport(db, env, at)`) so it is also
   unit-testable against `node:sqlite`.
4. **`drizzle-kit` generates; `wrangler` applies. No exceptions.**
   - No `driver` / `dbCredentials` in `drizzle.config.ts`.
   - Never `drizzle-kit push`, never `drizzle-kit migrate`, never
     `wrangler d1 migrations create`.
   - Never edit an applied migration file.
   - `drizzle-kit studio` only via a separate, CI-invisible config.
5. **`db:verify` in CI on every PR.** `db:generate` only ever on a developer's TTY.
6. **Local first, then remote, always in that order:** `db:generate` →
   `db:migrate:local` → app works → commit → CI `db:verify` → `db:migrate:remote` →
   live-schema check against `docs/db/schema.snapshot.sql`.
7. **Give the OpenNext tag cache its own D1 database.** Point `NEXT_TAG_CACHE_D1` at
   `fitness-tair-cache`, not at `fitness-tair`. Databases are free and the limit is
   50,000 on Paid. This keeps `revalidations` out of our schema entirely and removes a
   whole class of false-positive drift.
8. **Schema conventions:** explicit `snake_case` column names, `casing: "snake_case"` set
   in *both* places, `integer({mode:"boolean"})`, `integer({mode:"timestamp_ms"})` (never
   plain `"timestamp"`), a separate indexed `local_day TEXT` for Asia/Almaty calendar days,
   `real` for weights/RPE/RIR, R2 keys not blobs.
9. **Seed via generated literal-value `.sql` + `wrangler d1 execute --file`.** Chunk every
   `INSERT` to stay under 90 KB. No `BEGIN`/`COMMIT` in the file. Parents before children.
   Only use `db.batch()` seeding for user-driven imports, chunked at ≤ 500 statements.
10. **Treat every table recreation as a data-loss event until proven otherwise.** See §4.1
    — this is the single most dangerous thing in this whole stack.

---

## 4. Gotchas that will silently break us

Ordered by how much damage they do before you notice.

### 4.1 ⚠️ A drizzle-kit table recreation will silently delete child rows on D1

This is the headline finding. It is silent, it reports success, and it destroys data.

SQLite cannot `ALTER COLUMN`. So whenever you change a column's nullability, type, or
default, drizzle-kit emits the 12-step recreate. Verified output — I added
`.notNull().default("")` to `workouts.notes` and ran `drizzle-kit generate`:

```sql
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`duration_sec` integer,
	`notes` text DEFAULT '' NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_workouts`("id", "started_at", "duration_sec", "notes", "is_deleted", "created_at") SELECT "id", "started_at", "duration_sec", "notes", "is_deleted", "created_at" FROM `workouts`;--> statement-breakpoint
DROP TABLE `workouts`;--> statement-breakpoint
ALTER TABLE `__new_workouts` RENAME TO `workouts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workouts_started_at_idx` ON `workouts` (`started_at`);
```

Now stack three verified facts:

1. **`wrangler d1 migrations apply` runs the whole file as one transaction.** Verified from
   wrangler's source (`db.batch(queries.map(q => db.prepare(q)))` locally; the `query`
   endpoint's *"executed as a batch"* remotely) plus Cloudflare's *"Batched statements are
   SQL transactions."*
2. **`PRAGMA foreign_keys` is a no-op inside a transaction.** SQLite docs, verbatim:
   > "This pragma is a no-op within a transaction; foreign key constraint enforcement may
   > only be enabled or disabled when there is no pending BEGIN or SAVEPOINT."

   And D1 enforces FKs by default: *"By default, D1 enforces that foreign key constraints
   are valid within all queries and migrations."*
3. **`DROP TABLE` with FKs on runs an implicit `DELETE FROM`, and ON DELETE actions fire.**
   SQLite docs, verbatim:
   > "a DROP TABLE command performs an implicit DELETE FROM command before removing the
   > table from the database schema. Any triggers attached to the table are dropped from the
   > database schema before the implicit DELETE FROM is executed, so this cannot cause any
   > triggers to fire. By contrast, an implicit DELETE FROM does cause any configured
   > foreign key actions to take place."

Therefore: `DROP TABLE workouts` cascades into `sets` (which has
`ON DELETE cascade`) and **wipes every set in the database**, while the migration reports
success.

I reproduced it end to end on SQLite 3.50.4 (`node:sqlite`), running exactly the SQL above
inside a transaction with `foreign_keys` on:

```
fk on? { foreign_keys: 1 }
fk state AFTER 'PRAGMA foreign_keys=OFF' inside txn: { foreign_keys: 1 }   ← no-op, as documented
recreate committed
sets AFTER recreate: { c: 0 }     ← started at 3.  ALL CHILD ROWS GONE.
workouts AFTER recreate: { c: 1 }
```

**Cloudflare's documented workaround does not fix this.** `PRAGMA defer_foreign_keys = on`
defers constraint *checking*; it does not suppress `ON DELETE` *actions*. Tested:

```
A committed
A: sets rows = 0  (started 3)
```

Only genuinely-off FK enforcement saves the rows, which requires being outside a
transaction — impossible inside `wrangler d1 migrations apply`:

```
B: fk state = 0
B ok
B: sets rows = 3  (started 3)   ← survived
```

(That D1's transaction semantics make its `PRAGMA foreign_keys=OFF` a no-op exactly as
stock SQLite's do is `UNVERIFIED` — I could not run D1. But D1 *is* SQLite's query engine,
D1 batches *are* transactions per Cloudflare's own docs, and Cloudflare explicitly tells
you to use `defer_foreign_keys` because *"users cannot modify this setting mid-query"*.
Every piece of evidence points the same way, and the mitigation below is correct whether or
not the pragma happens to work.)

**Mitigation — treat this as a standing rule:**

* **Review every generated migration before applying it.** If it contains `DROP TABLE`,
  stop and think. Make this a checklist item in the migration workflow doc.
* **Prefer additive changes.** New nullable column + backfill + (much later, if ever) a
  tightening. Avoid changing nullability/type/default on a populated parent table.
* **If a recreate on a parent table is unavoidable**, hand-write the migration:
  recreate the *child* tables' FK definitions in the same file, or temporarily rewrite the
  child FK to remove `ON DELETE cascade`, or stage the data out and back. Split it into
  several migration files if you need separate transactions. Verify on a copy first —
  `wrangler d1 time-travel` exists for recovery, but restoring is not a plan.
* **Consider omitting `ON DELETE cascade` from the schema entirely.** For a single-user
  app, soft deletes (`is_deleted`) plus explicit cleanup are safer than a cascade that a
  future migration can weaponise. This is worth deciding in the schema spec.
* **Test every migration by replaying it against a seeded `node:sqlite` copy** and asserting
  row counts before/after. `scripts/verify-schema.mjs` proves the *shape* is right; a
  row-count assertion is what catches this.

### 4.2 A statically prerendered page bakes your laptop's D1 data into production

`getCloudflareContext({async:true})` in a route Next.js decides to prerender falls back to
`getPlatformProxy()` → `.wrangler/state/v3/d1`. It does not error; it returns your local
rows and they ship. OpenNext warns about this for SSG generally
(*"secrets … and local development values from bindings … will be used for the pages static
generation"*), and for App Router the sync form's error message is misleading because
`inSSG()` only detects Pages Router export. **Force every D1-reading route dynamic.**

### 4.3 `getCloudflareContext()` throws in the cron handler — including in async mode

Sync throws (no ALS scope). Async also throws, because its fallback needs `wrangler`, which
is deliberately excluded from the worker bundle. If you build the cron job by calling a
shared helper that internally calls `getCloudflareContext()`, it will typecheck, deploy,
and then fail at 08:00 every morning with a stack trace nobody is watching. Pass `env`
explicitly. Add a log line + a Telegram failure ping to the cron path so a throw is visible.

### 4.4 Editing an applied migration is invisible

`d1_migrations` stores the *filename*, not a content hash
(`INSERT INTO "d1_migrations" (name) values ('0003_foo.sql')`). Change the file and
wrangler will never notice. drizzle's own migrator hashes contents, but we do not use it.
`scripts/verify-schema.mjs` catches this **only** if the edit also diverges from
`schema.ts`; a "fix" that touches both stays invisible. **Applied migration files are
append-only. Never edit.**

### 4.5 Duplicate migration numbers from mixing the two tools

Verified: drizzle-kit numbers from `meta/_journal.json` `idx`; wrangler numbers from the
max leading file number. They collide. Two `0001_*.sql` files apply in alphabetical order
via wrangler's `compareSegments` tiebreak. **Never run `wrangler d1 migrations create`.**

### 4.6 `db.transaction()` compiles and then fails at runtime

drizzle's D1 session emits raw `begin` / `commit`; D1 is auto-commit only. TypeScript is
perfectly happy. Ban `db.transaction()` in review (an ESLint `no-restricted-syntax` rule on
`db.transaction` would be cheap insurance). Use `db.batch()`.

### 4.7 The 100-bound-parameter limit, not the 100 KB one, kills bulk inserts

`db.insert(t).values(arrayOf200)` on a 9-column table = 1800 bound parameters = 18× over
the limit. It will look like a size problem and it is not. Cap parameterised multi-row
inserts at `floor(100 / columnCount)` rows, or drop to literal SQL.

### 4.8 `db.batch([])` on an empty array

drizzle's type demands a non-empty tuple, and the cast in §2.7 defeats that check. A
chunking loop that produces an empty final chunk will hand D1 an empty batch. Guard with
`if (chunk.length === 0) continue;`.

### 4.9 `casing` mismatch between `drizzle.config.ts` and `drizzle()`

`generate` uses the config value; runtime queries use the `drizzle()` value. Disagree and
the DDL says `local_day` while queries say `localDay`, producing "no such column" only on
the code paths you did not exercise. Set both; also name columns explicitly in the schema
so neither matters.

### 4.10 `drizzle-orm/d1`'s `migrate()` cannot run in a Worker

`drizzle-orm/migrator.js` imports `node:fs` and calls `fs.readFileSync` at the top of
`readMigrationFiles`. Any "migrate on boot" route will throw. Not a footgun we are likely
to step on given the workflow above, but worth knowing why the option does not exist.

### 4.11 `revalidations` appearing in your app database

If `NEXT_TAG_CACHE_D1` shares the app DB, `opennextjs-cloudflare populate-cache` creates
`revalidations` there (verified command in §2.6). It is then a permanent unexplained table
that any drift check or `drizzle-kit pull` will trip over. Use a separate database. If you
must share, the `IGNORE_TABLES` set in the verify script already lists it.

### 4.12 `drizzle-kit generate` hangs/fails in CI on ambiguous renames

Verified error: `Interactive prompts require a TTY terminal`. Never in CI. Only
`drizzle-kit export` and `drizzle-kit check` are CI-safe.

### 4.13 `wrangler d1 execute --file` rejects binary SQLite files

`checkForSQLiteBinary` reads the first 15 bytes and throws if they are
`SQLite format 3`:
> "Provided file is a binary SQLite database file instead of an SQL text file. The execute
> command can only process SQL text files. Please export an SQL file from your SQLite
> database and try again."

Relevant if anyone tries to seed from a `.sqlite` dump. Use `wrangler d1 export` /
`sqlite3 .dump` to get text first.

### 4.14 `.wrangler/` is disposable, and so is your local data

Everything in `.wrangler/state/v3/d1` is ephemeral by design and gitignored. Seeding must
be a repeatable script, never a one-off manual session, or the local DB becomes
unreproducible. `npm run db:reset` = `rm -rf .wrangler/state/v3/d1 && db:migrate:local && db:seed:local`.

### 4.15 Environment note for whoever implements this

Miniflare/workerd would not start in the research sandbox (`internal error; reference = …`
from every `--local` D1 command). If that recurs on the dev machine, it is a sandbox /
permissions / antivirus issue with spawning `workerd`, not a wrangler bug — and it blocks
all local D1 work, so surface it in Phase 0 rather than after the schema is written.
(Separately: `npm install` in this sandbox once silently removed an already-installed
`drizzle-orm` when co-installing `drizzle-kit`; verify `node_modules/drizzle-orm` exists
after install if imports mysteriously fail.)

---

## 5. Open decision for the owner

**How does the Cron Trigger reach application logic?** This changes the Phase-0 scaffold —
specifically `wrangler.jsonc`'s `main` — so decide it now rather than in Phase 8.

**Option A — plain `scheduled()` + `dbFromEnv(env)`** *(recommended)*
A custom `src/worker.ts` that re-exports `handler.fetch` and adds
`scheduled(controller, env, ctx)` calling plain functions that take `db`/`env` as
arguments.
*Pros:* no self-request, no auth surface, no HTTP overhead, full 15-minute cron CPU budget,
jobs are trivially unit-testable against `node:sqlite`.
*Cons:* cron code cannot use `getCloudflareContext()`, `next/headers`, `cookies()`, server
components, or the `next-intl` request-scoped i18n context. If the weekly Telegram report
wants to reuse i18n message catalogues, you must call the i18n library directly with an
explicit locale rather than going through Next's request context.

**Option B — cron dispatches a synthetic request into the Next.js handler**
`scheduled()` calls `handler.fetch(new Request("https://internal/api/cron/weekly", { headers: { "x-cron-secret": env.CRON_SECRET }}), env, ctx)`, and the work happens in a normal
route handler.
*Pros:* full Next.js request context — `getCloudflareContext()`, i18n, and every shared
helper work unchanged; report rendering can reuse the same code as an on-demand
"regenerate my weekly report" button.
*Cons:* an internal HTTP endpoint that must be authenticated and must not be reachable from
the internet (a shared-secret header plus a check is the minimum); an extra request hop;
cron failures now surface as HTTP errors; and if the secret check is ever wrong, you have
exposed a job trigger.

**Recommendation: Option A**, with Option B's mechanism kept in reserve for the one job
that genuinely needs Next.js rendering. Concretely: put every job in
`src/server/jobs/*.ts` as `(db: DB, env: CloudflareEnv, at: number) => Promise<void>`, call
them from `scheduled()`, and *also* expose them behind an authenticated
`/api/admin/jobs/[name]` route for manual re-runs and for Phase-8 testing. That gets both
call paths without making cron depend on HTTP. Record the choice in `DECISIONS.md`.

**Secondary decision, lower stakes:** should the schema use `ON DELETE cascade` at all
(§4.1)? A single-user app with soft deletes may be safer without it. Recommend deciding
this in the schema spec, with a bias toward **no cascade on any table that could plausibly
be recreated by a future migration**.

---

## 6. Sources

**Local files read in this repo**

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

**Package source / `.d.ts` read directly (installed in the session scratchpad)**

- `@opennextjs/cloudflare@1.20.6` — `dist/api/cloudflare-context.d.ts`,
  `dist/api/cloudflare-context.js`, `dist/api/index.d.ts`,
  `dist/cli/templates/worker.js`, `dist/cli/templates/init.js`,
  `dist/api/overrides/tag-cache/d1-next-tag-cache.js`,
  `dist/cli/commands/populate-cache.js`
- `drizzle-orm@0.45.2` — `d1/driver.d.ts`, `d1/driver.js`, `d1/session.js`,
  `d1/migrator.d.ts`, `d1/migrator.js`, `migrator.js`, `batch.d.ts`, `utils.d.ts`,
  `sqlite-core/columns/integer.d.ts`, `sqlite-core/columns/integer.js`
- `drizzle-kit@0.31.10` — `index.d.ts` (the `Config` union, `prefixes`, `drivers`,
  `dialects`), `bin.cjs` (observed error paths)
- `wrangler@4.131.1` — `wrangler-dist/cli.js`: `src/d1/constants.ts`,
  `src/d1/splitter.ts` (`splitSqlQuery`, `normalizeSqlLineEndings`,
  `splitSqlIntoStatements`), `src/d1/execute.ts` (`executeSql`, `executeLocally`,
  `executeRemotely`, `uploadAndBeginIngestion`, `checkForSQLiteBinary`),
  `src/d1/migrations/helpers.ts` (`resolveMigrationsConfig`,
  `getDefaultMigrationsPattern`, `getCreateMigrationsTableQuery`, `buildMigrationQuery`,
  `getMigrationNames`, `compareMigrationPaths`, `leadingMigrationNumber`),
  `src/d1/migrations/apply.ts`, `src/dev/get-local-persistence-path.ts`
- `miniflare` (bundled with wrangler) — `dist/src/index.js`: `D1_PLUGIN`,
  `D1_DATABASE_OBJECT_CLASS_NAME`, `getPersistPath`
- `worker-configuration.d.ts` generated here by `wrangler types --env-interface CloudflareEnv`
  — `D1Database`, `D1DatabaseSession`, `D1PreparedStatement`, `D1SessionConstraint`

**Commands actually run (scratchpad)**

- `npx drizzle-kit generate --name=…` (×4: init, add column, notNull recreate, rename)
- `npx drizzle-kit export --sql`, `npx drizzle-kit check`, `npx drizzle-kit --help`,
  `npx drizzle-kit export --help`
- `npx wrangler d1 migrations create DB "probe_next_number"` (proved wrangler reads
  drizzle's `0000_init.sql`)
- `npx wrangler types --env-interface CloudflareEnv`
- `npx wrangler d1 --help`, `d1 execute --help`, `d1 export --help`,
  `d1 migrations apply --help`
- `npx wrangler d1 execute DB [--local] --command …` (confirmed default location and the
  `.wrangler/state/v3/d1` path message; execution itself blocked by the sandbox)
- `npx tsc --noEmit` on the recommended accessor/seed modules (exit 0) and on two
  deliberate negative cases (`db.batch(array)`, `drizzle(withSession())`)
- `node scripts/verify-schema.mjs` — clean (exit 0) and drifted (exit 1)
- `node scripts/seedgen.mjs` — 3000 rows → 4 statements, max 89,987 bytes, replayed OK
- `node` + `node:sqlite` (SQLite 3.50.4) — `DEFAULT false`, `unixepoch()*1000`,
  `PRAGMA foreign_keys` no-op inside a transaction, `DROP TABLE` cascade data loss,
  `PRAGMA defer_foreign_keys` failing to prevent it

**Official documentation**

- D1 limits — https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing — https://developers.cloudflare.com/d1/platform/pricing/
- D1 `D1Database` Worker API (`batch`, auto-commit) — https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 import/export — https://developers.cloudflare.com/d1/best-practices/import-export-data/
- D1 foreign keys / `defer_foreign_keys` — https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- D1 SQL statements & supported PRAGMAs — https://developers.cloudflare.com/d1/sql-api/sql-statements/
- D1 REST `query` endpoint (multiple statements "executed as a batch") — https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
- Workers bindings / `env` in global scope / `cloudflare:workers` — https://developers.cloudflare.com/workers/runtime-apis/bindings/
- Workers errors ("Cannot perform I/O on behalf of a different request") — https://developers.cloudflare.com/workers/observability/errors/
- Workers best practices (no global mutable state) — https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Workers scheduled handler signature — https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- OpenNext Cloudflare — bindings / `getCloudflareContext` — https://opennext.js.org/cloudflare/bindings
- OpenNext Cloudflare — custom worker (`scheduled`) — https://opennext.js.org/cloudflare/howtos/custom-worker
- Drizzle — Cloudflare D1 connect — https://orm.drizzle.team/docs/connect-cloudflare-d1
- Drizzle — D1 get-started (`driver: 'd1-http'` config) — https://orm.drizzle.team/docs/get-started/d1-new
- SQLite — `PRAGMA foreign_keys` / `defer_foreign_keys` — https://www.sqlite.org/pragma.html
- SQLite — `DROP TABLE` implicit `DELETE FROM` — https://www.sqlite.org/lang_droptable.html
