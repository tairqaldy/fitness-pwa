import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sql } from "drizzle-orm";

import { dbFromEnv } from "@/server/db";

/**
 * Binding health check.
 *
 * Exists because every binding in this app fails SILENTLY when misconfigured: a mistyped
 * binding name, an unapplied migration, or a bucket that does not exist all surface as a
 * confusing runtime error much later. This endpoint proves D1, R2 and KV are actually
 * reachable and writable from the deployed Worker.
 *
 * Deliberately unauthenticated but information-free: it returns only ok/error per binding and
 * never leaks ids, names or row contents. It is the one route allowed to be public besides the
 * PWA shell.
 */
export const dynamic = "force-dynamic";

type Check = { ok: true; detail?: string } | { ok: false; error: string };

async function check(fn: () => Promise<string | undefined>): Promise<Check> {
  try {
    const detail = await fn();
    return detail === undefined ? { ok: true } : { ok: true, detail };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export async function GET() {
  const { env } = getCloudflareContext();

  // A round-trip per binding, run concurrently: a cold health check should not take 3x as
  // long as it needs to.
  const [d1, migrations, r2, kv] = await Promise.all([
    check(async () => {
      const db = dbFromEnv(env);
      const rows = await db.all<{ n: number }>(sql`select count(*) as n from users`);
      return `users=${rows[0]?.n ?? 0}`;
    }),
    // Asserts migrations actually ran, rather than trusting wrangler's bookkeeping, which is
    // known to drift (docs/research/r02).
    check(async () => {
      const db = dbFromEnv(env);
      const rows = await db.all<{ name: string }>(
        sql`select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf%' order by name`,
      );
      const expected = ["cron_runs", "schema_meta", "sessions", "settings", "users"];
      const present = rows.map((r) => r.name);
      const missing = expected.filter((t) => !present.includes(t));
      if (missing.length > 0) throw new Error(`missing tables: ${missing.join(", ")}`);
      return `tables=${present.length}`;
    }),
    check(async () => {
      // Write-then-delete: a read-only check would pass against a bucket we cannot write to.
      const key = "__health/probe";
      await env.MEDIA.put(key, "ok");
      const got = await env.MEDIA.get(key);
      const body = await got?.text();
      await env.MEDIA.delete(key);
      if (body !== "ok") throw new Error("round-trip mismatch");
      return undefined;
    }),
    check(async () => {
      const key = "__health/probe";
      await env.CACHE_KV.put(key, "ok", { expirationTtl: 60 });
      const got = await env.CACHE_KV.get(key);
      await env.CACHE_KV.delete(key);
      if (got !== "ok") throw new Error("round-trip mismatch");
      return undefined;
    }),
  ]);

  const checks = { d1, migrations, r2, kv };
  const ok = Object.values(checks).every((c) => c.ok);

  return Response.json(
    {
      ok,
      checks,
      // Confirms the timezone var reached the runtime, and that Intl has real ICU data on
      // workerd (needed for every RU date format in the app).
      runtime: {
        tz: env.APP_TZ,
        localeSample: new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "long",
          timeZone: env.APP_TZ,
        }).format(new Date(1_789_221_376_000)),
      },
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
