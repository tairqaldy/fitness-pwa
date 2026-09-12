import { clearedSessionCookieHeader } from "@/lib/auth/session";

/**
 * POST /api/auth/logout — clears the session cookie.
 *
 * POST-only: a GET would let any page log the owner out with an <img> tag.
 * This clears the cookie on this device only; to revoke every device, bump
 * `credentials.session_version` (see src/lib/auth/require-session.ts).
 */
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { ok: true },
    { headers: { "cache-control": "no-store", "set-cookie": clearedSessionCookieHeader() } },
  );
}
