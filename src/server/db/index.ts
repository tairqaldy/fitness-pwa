/**
 * D1 access. The ONLY place a drizzle client is constructed.
 *
 * HARD RULES (verified in docs/research/r02-drizzle-d1-access-and-migrations.md):
 *  1. Never call `getCloudflareContext()` at module top level — it throws outside a request.
 *  2. Never memoise the drizzle instance in a module global. Build it per request; the `env`
 *     object is per-invocation and a cached client leaks across requests.
 *  3. `getCloudflareContext()` THROWS inside a `scheduled` (cron) handler. Cron code must use
 *     `dbFromEnv(env)` with the `env` passed to the handler.
 *  4. Any page or route that reads D1 must be dynamic, or a build-time prerender bakes the
 *     developer's local rows into production HTML.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "@/db/schema";

export type Db = DrizzleD1Database<typeof schema>;

/**
 * Wraps a raw D1 binding. Use this from cron jobs and tests, where there is no request
 * context to read the binding from.
 */
export function dbFromEnv(env: Pick<CloudflareEnv, "DB">): Db {
  return drizzle(env.DB, { schema, casing: "snake_case" });
}

/**
 * The request-scoped accessor. Call inside a route handler, server action, or dynamic
 * server component.
 */
export function getDb(): Db {
  const { env } = getCloudflareContext();
  return dbFromEnv(env);
}

/**
 * Async variant, for the rare deliberate build-time read. Prefer `getDb()`.
 */
export async function getDbAsync(): Promise<Db> {
  const { env } = await getCloudflareContext({ async: true });
  return dbFromEnv(env);
}

export { schema };
