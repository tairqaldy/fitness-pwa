/**
 * THE security boundary.
 *
 * `proxy.ts` only improves UX (it turns an unauthenticated navigation into a same-origin
 * redirect). It is explicitly NOT trusted, because:
 *  - OpenNext's `proxy.ts` support is marked experimental;
 *  - Next's own docs warn that a matcher excluding a path also skips Server Function calls on
 *    it, and instruct you to verify auth inside each Server Function;
 *  - a matcher typo silently opens a route.
 *
 * So every authenticated route handler, server action and page calls `requireSession()` first.
 * See docs/research/r04-auth-for-single-user-on-workers.md §3.2.
 */
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { credentials } from "@/db/schema";
import { getDb, type Db } from "@/server/db";

import { readSession, SESSION_COOKIE, type SessionClaims } from "./session";

export class UnauthenticatedError extends Error {
  constructor(readonly reason: "no-cookie" | "bad-signature" | "stale-version" | "no-credentials") {
    super(`unauthenticated: ${reason}`);
    this.name = "UnauthenticatedError";
  }
}

type Session = { userId: string };

/**
 * Resolve and fully validate the session, including the revocation check.
 *
 * `nowMs` is injected so tests are deterministic and so a single request evaluates one
 * consistent instant.
 */
export async function readValidatedSession(
  db: Db,
  token: string | undefined,
  secret: string,
  nowMs: number,
): Promise<{ ok: true; session: Session } | { ok: false; reason: UnauthenticatedError["reason"] }> {
  if (!token) return { ok: false, reason: "no-cookie" };

  const claims: SessionClaims | null = await readSession(token, secret, nowMs);
  if (!claims) return { ok: false, reason: "bad-signature" };

  const row = await db
    .select({ sessionVersion: credentials.sessionVersion })
    .from(credentials)
    .where(eq(credentials.userId, claims.sub))
    .get();

  if (!row) return { ok: false, reason: "no-credentials" };
  // The revocation lever: bumping `session_version` invalidates every issued cookie at once.
  if (row.sessionVersion !== claims.v) return { ok: false, reason: "stale-version" };

  return { ok: true, session: { userId: claims.sub } };
}

/** Throws `UnauthenticatedError` if the caller is not signed in. */
export async function requireSession(nowMs: number = Date.now()): Promise<Session> {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    // A missing secret must never silently downgrade to "everyone is authenticated".
    throw new Error("SESSION_SECRET is not configured");
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const result = await readValidatedSession(getDb(), token, secret, nowMs);
  if (!result.ok) throw new UnauthenticatedError(result.reason);
  return result.session;
}

/** Non-throwing variant, for pages that render differently when signed out. */
export async function getOptionalSession(nowMs: number = Date.now()): Promise<Session | null> {
  try {
    return await requireSession(nowMs);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return null;
    throw error;
  }
}

/**
 * API routes MUST answer 401 JSON, never a 302 to an HTML login page. This is what keeps the
 * service-worker precache clean: nothing the SW fetches can come back as a 2xx HTML login
 * page, so precache poisoning is structurally impossible.
 */
export function unauthenticatedJson(): Response {
  return Response.json(
    { error: "unauthenticated" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}
