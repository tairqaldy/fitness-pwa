import { sql } from "drizzle-orm";
import { z } from "zod";

import { credentials, settings, users } from "@/db/schema";
import { sessionSecret } from "@/lib/env";
import { ulid } from "@/lib/ids";
import {
  generateSalt,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  validatePasswordStrength,
} from "@/lib/auth/password";
import { issueSession, sessionCookieHeader } from "@/lib/auth/session";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/auth/totp";
import { getDb } from "@/server/db";

/**
 * First-run setup. Two steps, because a TOTP secret is worthless until the user has proved
 * their authenticator can generate a code from it — otherwise they lock themselves out.
 *
 *   POST { step: "begin", password }      -> creates the account, returns the otpauth:// URI
 *   POST { step: "confirm", code }        -> verifies the code, confirms TOTP, signs them in
 *
 * SECURITY: this route self-disables permanently once setup is complete. The owner chooses
 * their own password here; it is never generated, defaulted, logged, or transmitted anywhere
 * except into the PBKDF2 hash.
 */
export const dynamic = "force-dynamic";

const beginSchema = z.object({
  step: z.literal("begin"),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(512),
});
const confirmSchema = z.object({
  step: z.literal("confirm"),
  code: z.string().min(6).max(10),
});
const bodySchema = z.discriminatedUnion("step", [beginSchema, confirmSchema]);

const noStore = { "cache-control": "no-store" } as const;

/** Whether setup has already been completed — i.e. a confirmed credential exists. */
async function setupState() {
  const db = getDb();
  const row = await db
    .select({
      userId: credentials.userId,
      totpSecret: credentials.totpSecret,
      totpConfirmedAt: credentials.totpConfirmedAt,
      sessionVersion: credentials.sessionVersion,
      lastTotpStep: credentials.lastTotpStep,
    })
    .from(credentials)
    .limit(1)
    .get();
  return { db, row };
}

export async function GET() {
  const { row } = await setupState();
  return Response.json({ complete: Boolean(row?.totpConfirmedAt) }, { headers: noStore });
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  }

  const { db, row } = await setupState();
  const now = Date.now();

  // Once setup is complete this route is closed forever. Re-running it would let anyone who
  // can reach the URL replace the owner's password.
  if (row?.totpConfirmedAt) {
    return Response.json({ error: "already_setup" }, { status: 409, headers: noStore });
  }

  if (parsed.data.step === "begin") {
    const strength = validatePasswordStrength(parsed.data.password);
    if (!strength.ok) {
      return Response.json(
        { error: "weak_password", reason: strength.reason },
        { status: 400, headers: noStore },
      );
    }

    const userId = row?.userId ?? ulid(now);
    const salt = generateSalt();
    const passwordHash = await hashPassword(parsed.data.password, salt, PBKDF2_ITERATIONS);
    const totpSecret = generateTotpSecret();

    // An abandoned half-finished setup is overwritten rather than blocking forever.
    await db.batch([
      db
        .insert(users)
        .values({ id: userId, email: "", createdAt: new Date(now), updatedAt: new Date(now) })
        .onConflictDoNothing(),
      db
        .insert(settings)
        .values({ userId, updatedAt: new Date(now) })
        .onConflictDoNothing(),
      db
        .insert(credentials)
        .values({
          userId,
          passwordHash,
          passwordSalt: salt,
          passwordIterations: PBKDF2_ITERATIONS,
          totpSecret,
          sessionVersion: 1,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .onConflictDoUpdate({
          target: credentials.userId,
          set: {
            passwordHash,
            passwordSalt: salt,
            passwordIterations: PBKDF2_ITERATIONS,
            totpSecret,
            updatedAt: new Date(now),
          },
        }),
    ]);

    return Response.json(
      { ok: true, otpauthUri: totpUri(totpSecret, "tair"), secret: totpSecret },
      { headers: noStore },
    );
  }

  // step === "confirm"
  if (!row) {
    return Response.json({ error: "setup_not_started" }, { status: 409, headers: noStore });
  }

  const result = verifyTotp(parsed.data.code, row.totpSecret, now, row.lastTotpStep);
  if (!result.ok) {
    return Response.json(
      { error: "bad_code", reason: result.reason },
      { status: 401, headers: noStore },
    );
  }

  await db
    .update(credentials)
    .set({ totpConfirmedAt: new Date(now), lastTotpStep: result.step, updatedAt: new Date(now) })
    .where(sql`${credentials.userId} = ${row.userId}`);

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
