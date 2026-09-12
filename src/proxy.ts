import { NextResponse, type NextRequest } from "next/server";

import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`. OpenNext's support for it is marked
 * experimental, which is precisely why this file is NOT the security boundary — see
 * `src/lib/auth/require-session.ts`, which every route and page calls.
 *
 * The only job here is UX: turn an unauthenticated *navigation* into a same-origin 302 to
 * /login, so an installed PWA never leaves its manifest scope.
 *
 * Excluded paths matter more than the included ones. The PWA breaks if the service worker, the
 * manifest, the icons or the offline page require auth, and the Telegram webhook and cron
 * endpoint authenticate themselves with a shared secret instead of a cookie.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js|offline|login|setup|api/auth|api/telegram|api/cron|api/health).*)",
  ],
};

export async function proxy(request: NextRequest) {
  const secret = process.env["SESSION_SECRET"];
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // No secret configured: let the request through to the real boundary, which fails closed
  // with a clear error. Redirecting to /login here would mask a misconfiguration as a
  // login loop.
  if (!secret) return NextResponse.next();

  const claims = await readSession(token, secret, Date.now());
  if (claims) return NextResponse.next();

  // A navigation gets a same-origin redirect; anything else gets 401 JSON. Never a 302 to
  // HTML for a fetch, or the service worker could cache a login page under an API key.
  const wantsHtml = request.headers.get("accept")?.includes("text/html");
  if (!wantsHtml) {
    return Response.json(
      { error: "unauthenticated" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const url = new URL("/login", request.url);
  // Bring the user back where they were heading, but only ever to a same-origin path.
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (target !== "/" && target.startsWith("/")) url.searchParams.set("next", target);
  return NextResponse.redirect(url);
}
