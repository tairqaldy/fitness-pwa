import { eq } from "drizzle-orm";
import { z } from "zod";

import { credentials } from "@/db/schema";
import { sessionSecret } from "@/lib/env";
import { verifyPassword } from "@/lib/auth/password";
import { issueSession, sessionCookieHeader } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { getDb } from "@/server/db";

/**
 * POST /api/auth/login — password + TOTP, sets the session cookie.
 *
 * Always answers JSON, never a redirect, so the service worker can never cache an HTML login
 * page under an API key (docs/research/r04 §3.2).
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  password: z.string().min(1).max(512),
  code: z.string().min(6).max(10),
});

const noStore = { "cache-control": "no-store" } as const;

/**
 * One generic failure for every wrong-credential path. Distinguishing "wrong password" from
 * "wrong code" would tell an attacker which factor they already hold.
 */
function rejected() {
  return Response.json({ error: "invalid_credentials" }, { status: 401, headers: noStore });
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  }

  const db = getDb();
  const row = await db.select().from(credentials).limit(1).get();
  if (!row || !row.totpConfirmedAt) {
    return Response.json({ error: "setup_required" }, { status: 409, headers: noStore });
  }

  const now = Date.now();

  const passwordOk = await verifyPassword(
    parsed.data.password,
    row.passwordHash,
    row.passwordSalt,
    row.passwordIterations,
  );
  const totp = verifyTotp(parsed.data.code, row.totpSecret, now, row.lastTotpStep);

  // Both factors are evaluated before branching so the response time does not reveal which
  // one failed.
  if (!passwordOk || !totp.ok) {
    // Still record a successful TOTP step even on a failed login, so a valid code that was
    // paired with a wrong password cannot be reused.
    if (totp.ok) {
      await db
        .update(credentials)
        .set({ lastTotpStep: totp.step })
        .where(eq(credentials.userId, row.userId));
    }
    return rejected();
  }

  await db
    .update(credentials)
    .set({ lastTotpStep: totp.step, updatedAt: new Date(now) })
    .where(eq(credentials.userId, row.userId));

  const token = await issueSession(
    { sub: row.userId, v: row.sessionVersion },
    sessionSecret(),
    now,
  );
  return Response.json(
    { ok: true },
    { headers: { ...noStore, "set-cookie": sessionCookieHeader(token) } },
  );
}
