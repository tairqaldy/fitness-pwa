/**
 * Session cookie: a compact HS256 JWS issued after password + TOTP, with an explicitly long
 * lifetime.
 *
 * The long `Max-Age` is not laziness, it is the offline requirement. A cookie with no
 * `Max-Age` is a session cookie, and the OS kills an installed PWA constantly — the next
 * launch would be unauthenticated, and you cannot re-authenticate without a network. That
 * bricks the app in the gym. See docs/research/r04-auth-for-single-user-on-workers.md §2.8.
 */
import { jwtVerify, SignJWT } from "jose";

/**
 * `__Host-` prefix: the browser enforces Secure + Path=/ + no Domain, so the cookie cannot be
 * set or overridden by any other host on the domain.
 */
export const SESSION_COOKIE = "__Host-fa_session";

/** One year. Re-login is a deliberate act, not a periodic interruption. */
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type SessionClaims = {
  /** User id. */
  sub: string;
  /** Session version — bumping the stored value revokes every outstanding cookie. */
  v: number;
};

function secretKey(secret: string): Uint8Array {
  if (secret.length < 32) {
    // Caught at issue time rather than silently producing a weak signature.
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function issueSession(
  claims: SessionClaims,
  secret: string,
  nowMs: number,
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  return new SignJWT({ v: claims.v })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .sign(secretKey(secret));
}

/**
 * Verify a session token. Returns null for anything invalid — expired, wrong signature,
 * malformed — so callers cannot accidentally treat a failure as success.
 */
export async function readSession(
  token: string | undefined,
  secret: string,
  nowMs: number,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
      currentDate: new Date(nowMs),
    });
    if (typeof payload.sub !== "string") return null;
    const version = payload["v"];
    if (typeof version !== "number") return null;
    return { sub: payload.sub, v: version };
  } catch {
    return null;
  }
}

/**
 * `Set-Cookie` value for a freshly issued session.
 * SameSite=Lax so a push-notification or Telegram link into the app still arrives
 * authenticated, while cross-site POSTs do not carry the cookie.
 */
export function sessionCookieHeader(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearedSessionCookieHeader(): string {
  return [`${SESSION_COOKIE}=`, "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=0"].join(
    "; ",
  );
}
