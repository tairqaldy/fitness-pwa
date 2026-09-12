# 04 — Authentication, session and route protection

## Purpose

Gate the app behind a single identity without breaking the installed PWA's ability to open and log a full workout
with no network. Satisfies the brief's "User → Simple secure auth: pick the simplest secure option" and its Security
bullet ("auth on all routes; rate-limit auth routes"). The mechanism is **one long-lived signed session cookie issued
after a password + TOTP check** — option (d) in
[`docs/research/r04-auth-for-single-user-on-workers.md`](../docs/research/r04-auth-for-single-user-on-workers.md) §3 —
with passkeys deferred as a purely additive credential. This spec also owns the two machine-to-machine secrets
(Telegram webhook, cron), because those are auth decisions.

The brief lists only (a) passkey/WebAuthn, (b) magic link, (c) Cloudflare Access and says *"pick the simplest secure
option; record it in DECISIONS.md"*. We pick **(d)**, which is none of those, on research grounds: (c) cannot work —
`ctx.access` is `undefined` on OpenNext because Workers-with-Assets run behind an internal router Worker that drops it,
and Access's own login redirect is cross-origin, which breaks an installed PWA's manifest scope (r04 §2.4); (b) needs a
third-party mail provider and a network round trip to log in, which is the one thing a gym basement cannot do (r04 §2.6);
(a) is real and verified but cannot be the *only* credential — a lost device would lock the single user out of his own
data with no recovery channel (r04 §2.5), so it lands later as an additive row (Open question 3). Because that deviates
from the brief, the last deliverable of this spec is a `docs/DECISIONS.md` entry (§Files, last row) recording the
mechanism, the three rejections above with their r04 sections, the one-year `Max-Age`, mandatory TOTP, and the accepted
risks of rules 27–28. Open questions 1–3 must be resolved into that entry **before** implementation starts.

## Scope

Session token format, signing, verification, sliding renewal, expiry, revocation; cookie attributes and the http/https
split; `/login`, `/login/recover` plus `/api/auth/{login,logout,refresh,session,recover}`; `src/proxy.ts`, the exact
public-path list **and the literal `PROXY_MATCHER` value**; `requireSession()` as the boundary plus the client
`SessionGate`; offline session semantics, the RU/EN mechanism for every auth surface, and the stale-session-sync
contract; constant-time verification of `X-Telegram-Bot-Api-Secret-Token` and `x-cron-secret`; rate limiting and the
per-IP D1 lockout ladder; recovery codes, the one-time QR and lost-device recovery; the threat model and accepted risks.

### Out of scope

| Excluded | Owned by |
|---|---|
| Serwist config, `sw.ts`, precache manifest, `/~offline`, Dexie, the sync queue | `specs/05-pwa-offline-sync.md` |
| All DDL/Drizzle/migrations, including the **four additions and one seed row** requested in §Data | `specs/02-data-model.md` |
| `wrangler.jsonc`, `worker.ts`, `src/server/{cf,http,errors,rate-limit}.ts`, `/api/cron/[job]`, `/api/health`, CSP | `specs/01-architecture.md` |
| Telegram chat-id lock, message bodies, Web Push VAPID, the webhook route file and its literal slug segment (rule 19) | `specs/14-ai-coach-and-notifications.md` |
| Login-screen colour/type/radius tokens, the sheet primitive | `specs/03-design-system.md` |
| Excluding auth rows from export and the R2 backup | `specs/15-data-portability.md` |
| The RU/EN catalogue *format* (no sibling spec owns i18n — `specs/03` §Out-of-scope); this spec inlines its own strings per rule 17 | Phase-1 foundation work, r11 |
| Passkey/WebAuthn enrollment (Phase 5+; the seam is `issueSessionToken`) | this spec, deferred |

**Cross-spec requests this spec depends on** (it ships nothing itself if these are missing):

| # | Needed from | What | Why |
|---|---|---|---|
| 1 | `specs/02` | `settings.session_version INTEGER NOT NULL DEFAULT 1`; tables `auth_events`, `auth_throttle`; the `kind` domain widened to `password\|totp\|recovery\|passkey`; the single seeded `users` row `id='me'` (+ its `settings` row) | §Data |
| 2 | `specs/01` | `APP_ORIGIN=http://localhost:8787` in `.dev.vars.example`, so local `preview` has a real same-origin value (rule 6, rule 24) | verified override, §Data/Env |
| 3 | `specs/05` | one `meta` key, `auth.pendingReauth: boolean` (rule 18) | §Data |
| 4 | `specs/12` | `(app)/page.tsx` is the one named exception in rule 11's dynamic allowlist and MUST call `requireSession()` first | rule 11 |

## Files to create

| Path | Responsibility |
|---|---|
| `src/proxy.ts` | Next 16 proxy — **next to `src/app`, not the repo root**, because this project has a `src` directory (Phase 0 already put it there). UX only, and exactly one behaviour: redirect an unauthenticated **document navigation** to `/login`. Never the boundary. |
| `src/lib/auth/session.ts` | `jose` HS256 mint/verify of the session JWS. Pure, no I/O, no bindings. |
| `src/lib/auth/cookie.ts` | Cookie name/attribute resolution, `Set-Cookie` serialisation, companion meta cookie. |
| `src/lib/auth/password.ts` | PBKDF2-SHA256 hash/verify, `PasswordRecord` codec, the portable constant-time compare. |
| `src/lib/auth/totp.ts` | `otpauth/slim` verify (±1 step), provisioning URI, clock-skew diagnostic. |
| `src/lib/auth/recovery.ts` | Single-use recovery codes: generate, format, normalise. |
| `src/lib/auth/public-paths.ts` | `isPublicPath()`, the literal `PROXY_MATCHER` and `DYNAMIC_APP_ROUTES`. The one authoritative list. Pure. |
| `src/lib/auth/machine-auth.ts` | `verifyTelegramWebhookSecret()`, `verifyCronSecret()`. Fail-closed. |
| `src/lib/auth/origin.ts` | `checkSameOrigin()` / `assertSameOrigin()` — the whole CSRF story, `Origin` **or** `Sec-Fetch-Site`. |
| `src/lib/auth/schemas.ts` | Zod `LoginBody` / `RecoverBody` and the response types. |
| `src/lib/auth/client.ts` | Browser: read the meta cookie, `login()`, `logout()`, `refreshIfStale()`. |
| `src/server/require-session.ts` | **The boundary**: `requireSession()`, `requireSessionOr401()`, `getSession()`. |
| `src/server/auth-store.ts` | Every auth read/write: `auth_credentials`, `session_version` (+KV cache), `auth_events`. |
| `src/server/auth-throttle.ts` | The D1 lockout ladders (`auth_throttle`): per-IP hard rungs + one soft global rung, on top of 01's `checkRateLimit()`. |
| `src/app/login/page.tsx` | Statically prerendered, public, precacheable. Touches no binding, reads no `cookies()`/`headers()`. |
| `src/app/login/login-form.tsx` | `"use client"`: password + TOTP, offline state, errors, lockout countdown, RU/EN inlined (rule 17). |
| `src/app/login/recover/page.tsx` | Statically prerendered sibling of `/login`: lost-device recovery. Same constraints, same copy mechanism. |
| `src/app/login/recover/recover-form.tsx` | `"use client"`: password + recovery code → the one-time TOTP QR + the remaining-codes count. |
| `src/components/auth/totp-qr.tsx` | Server component, zero client JS: renders `totpProvisioningUri` as an SVG QR via `qrcode-generator@2.0.4` (already in `package.json`; Phase 0 shipped `src/components/qr-code.tsx` — reuse it, do not add a second QR library). Also prints the secret as selectable text for manual entry. |
| `src/lib/auth/copy.ts` | `AUTH_COPY: Record<"ru" \| "en", AuthStrings>` — both locales, one object, imported by every auth surface (rule 17). |
| `src/server/handlers/auth-*.ts` | Where the five route bodies actually live: `(db, req, clock) => Promise<Response>`, per specs/16 §Pyramid 7's contract that every `route.ts` is a ≤ 5-line adapter and never calls `getCloudflareContext()` itself. This is what lets the login/recover flows be unit-tested without a Worker. |
| `src/app/api/auth/login/route.ts` | `POST` → two `Set-Cookie` headers. `dynamic = "force-dynamic"` (01 rule 12). |
| `src/app/api/auth/logout/route.ts` | `POST` → clear cookies; `?everywhere=1` bumps `session_version`. |
| `src/app/api/auth/refresh/route.ts` | `POST` → sliding renewal when the token is stale, else `204`. |
| `src/app/api/auth/session/route.ts` | `GET` → `200 SessionStatus` (incl. `recoveryCodesRemaining`, `serverTimeMs`) or `401` with `details.reason`. `no-store`. |
| `src/app/api/auth/recover/route.ts` | `POST` password + recovery code → session + rotated TOTP secret. |
| `src/components/auth/session-gate.tsx` | Client guard: renders children immediately; owns the single 401 policy of rule 13, the re-auth sheet, the pending-sync banner and the low-recovery-codes banner. |
| `scripts/auth-bootstrap.mjs` | Node-only one-off: prints the secret, the credential rows, 8 recovery codes and the exact `wrangler secret put` / `wrangler d1 execute` lines. Writes nothing; never bundled. |
| `tests/vectors/rfc6238.json`, `tests/vectors/session-token.json` | Committed oracles: the RFC 6238 Appendix B rows (each with a `source` field, mirroring specs/16 §Pyramid 2) and the one golden session token that freezes the HMAC key encoding. |
| `tests/unit/auth/*.test.ts` | Vitest **project `unit`** (`environment: "node"`, specs/16 §Pyramid 1) — so no file under `src/lib/auth/**` may touch a workerd-only or `node:`-only API (rule 21). The case list in §Verification is the contract. |
| `tests/e2e/auth.spec.ts` | Playwright `smoke`: login → offline log → reconnect → stale-session re-auth → lockout escape. |
| `docs/DECISIONS.md` (append one entry) | Shared, append-only, owned by nobody: the §Purpose entry. The only file here this spec does not create outright. |

## Interfaces

Dependency footprint, pinned from [r04 §3.1](../docs/research/r04-auth-for-single-user-on-workers.md) (both already in
`package.json`): **`jose@6.2.12`** (single webapi build, 0 deps, verified on workerd) and **`otpauth@9.5.2`** (imported as
`otpauth/slim`). Plus `zod@4.6.2` (stack-facts) and, from Phase 5 only, `@simplewebauthn/server@14.0.1`. Nothing else.

```ts
// src/lib/auth/session.ts — claims are SECONDS since epoch (JWT NumericDate), never ms.
export const SESSION_TTL_SECONDS = 31_536_000;      // 365 d — the offline budget (r04 §2.8)
export const RENEW_AFTER_AGE_SECONDS = 5_616_000;   // 65 d — renew on the next online request
export const CLOCK_TOLERANCE_SECONDS = 60;
/** `sub` is the literal `users.id` of the single seeded row (specs/02 ships `users`, NOT `app_user`). */
export interface SessionClaims { sub: "me"; v: number; iat: number; exp: number }
export type TokenFailure = "missing" | "malformed" | "bad_signature" | "expired";
export type TokenResult = { ok: true; claims: SessionClaims } | { ok: false; reason: TokenFailure };
/**
 * THE key derivation, pinned so a cookie minted today still verifies in a year (rule 3):
 * `SESSION_SECRET` is base64url TEXT; the HMAC key is `base64urlDecode(SESSION_SECRET)` and MUST
 * decode to >= 32 bytes. Never the UTF-8 bytes of the text. Throws `SessionSecretError` otherwise.
 */
export function sessionKeyFromSecret(secret: string): Uint8Array;
export function issueSessionToken(secret: string, version: number, nowMs?: number): Promise<string>;
export function verifySessionToken(token: string | null | undefined, secret: string, nowMs?: number): Promise<TokenResult>;

// src/lib/auth/cookie.ts — https vs http is derived from APP_ORIGIN; there is no APP_ENV var.
export const SESSION_COOKIE_SECURE = "__Host-fa_session";
export const SESSION_COOKIE_INSECURE = "fa_session";
/** Non-HttpOnly; holds ONLY the expiry as decimal epoch-MILLISECONDS. Never an auth input. */
export const SESSION_META_COOKIE = "fa_session_exp";
export type CookieEnv = { APP_ORIGIN: string };
export function sessionCookieName(env: CookieEnv): string;
/**
 * Exactly two Set-Cookie values. `maxAgeSeconds` is passed, never derived from `expEpochMs`:
 * `Math.floor((expEpochMs - Date.now())/1000)` yields 31535999 as soon as one millisecond passes
 * between minting and serialising, and the emitted attribute must be the byte-exact constant.
 * `expEpochMs` supplies only the VALUE of the meta cookie.
 */
export function sessionSetCookies(env: CookieEnv, token: string, expEpochMs: number,
  maxAgeSeconds?: number /* = SESSION_TTL_SECONDS */): [string, string];
export function clearSessionCookies(env: CookieEnv): [string, string];   // Max-Age=0 on both
export function readSessionCookie(request: Request, env: CookieEnv): string | null;
```

```ts
// src/lib/auth/password.ts
export const PBKDF2_ITERATIONS = 210_000;    // 81 ms on workerd, measured — r04 §2.7
export const PBKDF2_DIGEST = "SHA-256" as const;
export const PBKDF2_KEY_BYTES = 32;
/** Serialised into auth_credentials.material as `pbkdf2-sha256$<iters>$<saltB64u>$<hashB64u>`. */
export interface PasswordRecord { algo: "pbkdf2-sha256"; iterations: number; saltB64u: string; hashB64u: string }
export function hashPassword(plaintext: string, iterations?: number): Promise<PasswordRecord>;   // salt 16 B, hash 32 B
export function verifyPassword(plaintext: string, stored: PasswordRecord): Promise<boolean>;
export function encodePasswordRecord(r: PasswordRecord): string;
export function decodePasswordRecord(material: string): PasswordRecord;    // throws on a bad shape
/**
 * A hand-written constant-time XOR loop over the two byte arrays — NOT
 * `crypto.subtle.timingSafeEqual`. That is a workerd extension: it exists on Workers (r04 §2.7,
 * probe output) but is `undefined` in Node (verified here on `node v24.12.0`:
 * `crypto.subtle.timingSafeEqual` → `undefined`, only `node:crypto.timingSafeEqual` exists), and
 * `tests/unit/auth` runs in the `unit` project with `environment: "node"` because specs/16 §Pyramid 5
 * rejects `@cloudflare/vitest-pool-workers` (no build with a `vitest ^5` peer). Importing
 * `node:crypto` instead would put a Node builtin in a `src/lib/**` module that ships to the Worker.
 * One loop, both runtimes, no platform API:
 *   `let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++)
 *      d |= (a[i] ?? 0) ^ (b[i] ?? 0); return d === 0;`
 * Length is folded into the accumulator instead of returning early, so a length mismatch is
 * indistinguishable from a value mismatch. Never throws.
 */
export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean;
/** UTF-8 encodes both sides, then `constantTimeEqualBytes`. false when EITHER side is empty — a
 *  missing expected secret must never mean "allow". */
export function constantTimeEqualUtf8(actual: string, expected: string): boolean;

// src/lib/auth/totp.ts — import "otpauth/slim": the explicit subpath avoids the node: condition (r04 §4.9)
export const TOTP_ALGORITHM = "SHA1" as const;   // RFC 6238 default; what authenticator apps do
export const TOTP_DIGITS = 6; export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW = 1;              // THE acceptance window: t-1, t, t+1. Nothing else grants access.
export const TOTP_SKEW_PROBE_STEPS = 8;    // DIAGNOSTIC ONLY: how far verifyTotp looks to set clockSkewSuspected
export interface TotpResult {
  valid: boolean;               // true ONLY inside TOTP_WINDOW
  step: number | null;          // absolute 30 s step index matched; used for replay rejection
  clockSkewSuspected: boolean;  // matched only at |delta| in 2..TOTP_SKEW_PROBE_STEPS — never grants access
}
export function verifyTotp(code: string, secretBase32: string, nowMs?: number): TotpResult;
export function totpProvisioningUri(secretBase32: string, label?: string): string;
export function generateTotpSecretBase32(): string;    // 20 random bytes -> 32 base32 chars

// src/lib/auth/recovery.ts
export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";   // no 0/O/1/I; 12 chars = 60 bits
export function generateRecoveryCodes(): Promise<{ plaintext: string[]; records: PasswordRecord[] }>;  // "XXXX-XXXX-XXXX", shown once
export function normalizeRecoveryCode(input: string): string;              // "abcd efgh-jklm" -> "ABCDEFGHJKLM"
```

```ts
// src/lib/auth/public-paths.ts
export type PublicReason = "pwa-manifest" | "pwa-icon" | "service-worker" | "offline-fallback"
  | "auth-ui" | "auth-api" | "machine-auth" | "health" | "next-internal";
export function isPublicPath(pathname: string): PublicReason | null;   // null => protected; rule 8 is the contract
/**
 * THE literal value — `src/proxy.ts` does `export const config = { matcher: PROXY_MATCHER }`.
 * One negative-lookahead pattern (the shape r04 §3.2 and Next's own docs prescribe), copied
 * verbatim; rule 9 states the derivation rule and `proxy-matcher.test.ts` locks every row.
 */
/** App-group routes allowed to be `force-dynamic`. Today exactly one: specs/12's dashboard. Rule 11. */
export const DYNAMIC_APP_ROUTES = ["/"] as const;
export const PROXY_MATCHER = [
  "/((?!api/|_next/static/|_next/image/|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|sw.js|icons/|~offline|login).*)",
] as const satisfies readonly string[];

// src/lib/auth/machine-auth.ts
export interface MachineEnv { TELEGRAM_WEBHOOK_SECRET?: string; CRON_SECRET?: string }
/** Header x-telegram-bot-api-secret-token — the only custom header Telegram sends (r06 §8.3). */
export function verifyTelegramWebhookSecret(request: Request, env: MachineEnv): boolean;
/** Header x-cron-secret. Called by 01's /api/cron/[job] handler (r01 §3.3). */
export function verifyCronSecret(request: Request, env: MachineEnv): boolean;

// src/lib/auth/origin.ts — the whole CSRF story. Two accepted proofs, rule 24 is the contract.
export type OriginVerdict = { ok: true; via: "origin" | "sec-fetch-site" } | { ok: false; reason: "mismatch" | "absent" };
export function checkSameOrigin(request: Request, env: { APP_ORIGIN: string }): OriginVerdict;
/** Wraps checkSameOrigin; throws 01's AppError("forbidden", "Forbidden") on `ok: false`. */
export function assertSameOrigin(request: Request, env: { APP_ORIGIN: string }): void;

// src/server/require-session.ts — epoch-MILLISECONDS here, unlike SessionClaims
export type SessionFailureReason = TokenFailure | "stale_version" | "misconfigured";
export interface Session { sub: "me"; version: number; issuedAtMs: number; expiresAtMs: number }
/** Server Actions and any dynamic page. Throws 01's AppError("unauthenticated", …, { details: { reason } }). */
export function requireSession(): Promise<Session>;
/** Route handlers. `response` is present ONLY on failure, always JSON from 01's jsonError(). */
export function requireSessionOr401(request: Request): Promise<
  { session: Session; response?: never } | { session?: never; response: Response }>;
export function getSession(): Promise<Session | null>;
```

```ts
// src/server/auth-store.ts — the DB type and getDb()/dbFromEnv() come from specs/01-architecture.md
export const APP_USER_ID = "me";   // = users.id of the single seeded row; also SessionClaims["sub"]
export type CredentialKind = "password" | "totp" | "recovery" | "passkey";
/** Mirrors specs/02's `auth_credentials` columns exactly, `label` and the NOT NULL FK included. */
export interface Credential {
  id: string; userId: string; kind: CredentialKind; label: string | null; material: string;
  counter: number | null;        // kind='totp': the last ACCEPTED TOTP step
  createdAtMs: number; lastUsedAtMs: number | null; revokedAtMs: number | null;
}
export function loadCredential(db: DB, kind: "password" | "totp"): Promise<Credential | null>;
export function recordTotpStep(db: DB, credentialId: string, step: number): Promise<void>;
export function rotateTotpSecret(db: DB): Promise<string>;             // returns the new base32 secret
/** ALWAYS evaluates every unrevoked `kind='recovery'` row — no early return on the first match —
 *  and folds the results with a constant-time OR, so neither timing nor duration reveals how many
 *  codes remain or which one matched. Revokes the matched row only after the loop (rule 25). */
export function consumeRecoveryCode(db: DB, normalized: string): Promise<boolean>;
export function countUnusedRecoveryCodes(db: DB): Promise<number>;
/** KV-cached (`expirationTtl: 60`) read of settings.session_version; one D1 read on miss. */
export function currentSessionVersion(env: CloudflareEnv): Promise<number>;
/** Increments settings.session_version, deletes the KV key, returns the new value. */
export function bumpSessionVersion(env: CloudflareEnv): Promise<number>;
export type AuthEventKind = "login" | "logout" | "refresh" | "recover" | "lockout";
export function recordAuthEvent(db: DB, e: { kind: AuthEventKind; ok: boolean; reason?: string;
  ip?: string | null; ua?: string | null }): Promise<void>;

// src/server/auth-throttle.ts — the DURABLE ceiling; 01's checkRateLimit() is per-colo only.
// KEYED, never a singleton: two rows per request, `ip:<client ip>` and `global`. Rule 22.
export type ThrottleScope = "ip" | "global";
/** `throttleKey(request)` -> `"ip:" + (request.headers.get("cf-connecting-ip") ?? "unknown")`.
 *  The `"unknown"` fallback matters: `wrangler dev` may not set the header, and a missing header
 *  must degrade to one shared bucket, never to "no limit". */
export function throttleKey(request: Request): string;
export type LockVerdict =
  | { locked: false }
  /** `hard: true` (an `ip` rung) short-circuits BEFORE any PBKDF2. `hard: false` (the `global`
   *  rung) does NOT: the credential check still runs and a correct password + TOTP wins, so the
   *  owner can never be locked out of his own app by someone else's failures (rule 23). */
  | { locked: true; hard: boolean; retryAfterSeconds: number; scope: ThrottleScope };
export function checkLockout(db: DB, key: string, nowMs: number): Promise<LockVerdict>;
/** Increments BOTH the `ip:<…>` row and `global`, and applies each ladder's rung. */
export function recordAuthFailure(db: DB, key: string, nowMs: number): Promise<void>;
/** Resets BOTH rows to `consecutive_failures = 0, locked_until_ms = null`. Called on every success. */
export function clearLockout(db: DB, key: string): Promise<void>;
/** Per-IP rungs. Deliberately capped at 900 s — there is no 24 h rung (rule 23, risk 11). */
export const LOCKOUT_LADDER: readonly { afterConsecutiveFailures: number; lockSeconds: number }[];
//   = [{ afterConsecutiveFailures: 5, lockSeconds: 60 }, { afterConsecutiveFailures: 10, lockSeconds: 900 }]
/** The distributed-spray brake. Soft by construction: it gates FAILURES, not the owner. */
export const GLOBAL_LOCKOUT = { afterConsecutiveFailures: 100, lockSeconds: 900 } as const;
/** `consecutive_failures` decays to 0 after this long with no new failure (rule 23). */
export const THROTTLE_RESET_SECONDS = 3_600;

// src/lib/auth/schemas.ts — zod 4.6.2 (stack-facts.md)
export const LoginBody = z.object({ password: z.string().min(12).max(256), totp: z.string().regex(/^\d{6}$/),
  next: z.string().max(512).optional() });          // path-only, same-origin; re-validated server-side
export const RecoverBody = z.object({ password: z.string().min(12).max(256), recoveryCode: z.string().min(12).max(20) });
/** `serverTimeMs` is on BOTH the 200 and the 401 body, identically — see rule 5. */
export interface LoginOk { ok: true; expiresAtMs: number; next: string; serverTimeMs: number }
export interface RecoverOk { ok: true; expiresAtMs: number; totpProvisioningUri: string;
  totpSecretBase32: string; recoveryCodesRemaining: number; serverTimeMs: number }
export interface SessionStatus { authenticated: boolean; expiresAtMs: number | null; version: number | null;
  recoveryCodesRemaining: number | null; serverTimeMs: number }
```

## Behaviour

**Identity, bootstrap, secrets**

1. Exactly one identity. specs/02 ships a table called **`users`** (there is no `app_user`), and this spec pins
   `users.id = 'me'` for the single seeded row — `APP_USER_ID`, which is also the literal `claims.sub`. That row (and its
   `settings` row) is the fifth thing §Data needs from specs/02: `auth_credentials.user_id` is a NOT NULL FK, so nothing
   here can be inserted before it exists. **No registration and no password-reset route ever ships.** Any method on any
   `/api/auth/` path other than the five in §Files is 404.
2. Credentials are provisioned out of band by `node scripts/auth-bootstrap.mjs`, which prints a `SESSION_SECRET`
   (48 random bytes, base64url-encoded → a 64-character string), the `auth_credentials` INSERTs for `kind='password'` /
   `'totp'` / eight `'recovery'` rows, the 8 plaintext codes to print on paper, and the exact `wrangler` invocations.
   It writes nothing itself.
3. Secrets come from `env` via 01's `getEnv()` — never `process.env` at module scope, never `runtime = "edge"`.
   **`SESSION_SECRET` is base64url TEXT and the HMAC key is `base64urlDecode(SESSION_SECRET)`**, which MUST decode to
   ≥ 32 bytes; the UTF-8 bytes of the text are never the key. Pinning this is not pedantry: the two readings differ (64
   ASCII bytes vs 48 real bytes), and swapping them later turns every outstanding cookie into `bad_signature`, which is
   indistinguishable from tampering. A secret that is absent, does not decode, or decodes short fails **closed** on every
   auth path, login included: `AppError("internal", …, { details: { reason: "session_secret_missing" }})`, and
   `src/proxy.ts` performs no redirect. A golden-vector test freezes the encoding (§Verification).

**Login**

4. `POST /api/auth/login` runs in this fixed order, stopping at the first failure: `assertSameOrigin` →
   `checkRateLimit(AUTH_LIMITER, new URL(request.url).pathname, request)` — **three arguments, keyed on pathname**, the
   signature and keying specs/01 §Interfaces and 01 rule 28 actually declare → `checkLockout(db, throttleKey(request),
   nowMs)`, which short-circuits only on a `hard` lock (rule 23) → `LoginBody.parse` → `verifyPassword` → `verifyTotp` →
   replay check → mint. Every credential failure — a Zod failure included, which is **401 `unauthenticated`, not 400** —
   returns the identical envelope with message `"Invalid credentials"`, no `details`, no `WWW-Authenticate`, and calls
   `recordAuthFailure` — the one exception being that while a **soft** global lock is active the same failure is reported
   as rule 23's `429` instead of the 401, because the lock gates failures, not attempts. PBKDF2 always runs, including when the credential row is absent (compare against a fixed dummy
   record), so timing never reveals which factor was wrong. **The one field every login/recover response carries is
   `serverTimeMs`** (rule 5) — identical on the 200 and on the 401, so it is not an oracle.
5. TOTP replay: reject when the matched step `<= auth_credentials.counter` of the `'totp'` row; on success write the
   step **before** minting. A code valid only at `|delta| in 2..TOTP_SKEW_PROBE_STEPS` is **rejected** (only
   `TOTP_WINDOW` grants access) and the server records `reason:"clock_skew"` in `auth_events`.
   **The clock hint is client-computed, not server-flagged.** Every login and recover response — success *and* the
   401 — carries `serverTimeMs`; the form shows "проверьте часы на телефоне / check your phone's clock" whenever
   `|serverTimeMs - Date.now()| > TOTP_PERIOD_SECONDS * 1000`. This replaces the earlier design of flagging skew "on the
   next successful login", which was unreachable: while the phone is 2–8 steps off, *every* code lands in the rejected
   band, so there is no successful login to carry a flag. `serverTimeMs` leaks nothing (server time is public) and works
   past 8 steps too, where the probe window gives up.
6. On success: `clearLockout`, write an `auth_events` row, touch `last_used_at` on both credentials, and return
   `200 LoginOk` with **two** `Set-Cookie` headers. When `new URL(env.APP_ORIGIN).protocol === "https:"` the session
   cookie is `__Host-fa_session=<jws>; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`; over http the name is
   `fa_session` and `Secure` is omitted, everything else identical — `__Host-` mandates `Secure` and the cookie would
   otherwise be silently dropped. `Max-Age` is always the literal `SESSION_TTL_SECONDS`, passed in, never recomputed from
   a timestamp. `fa_session_exp=<epoch-ms>` mirrors those attributes minus `HttpOnly`. `SameSite=Lax` keeps a
   notification-click top-level navigation authenticated while blocking cross-site POSTs (r04 §2.8).
   **The http branch is reachable only because specs/01 must put `APP_ORIGIN=http://localhost:8787` in
   `.dev.vars.example`** (cross-spec request 2). Verified mechanism: wrangler 4.131.1's `getVarsForDev`
   (`src/dev/dev-vars.ts`) copies `vars` into the binding map first and then writes every `.dev.vars` key over it, so
   `.dev.vars` **overrides** a same-named `vars` entry in local dev and preview. A wrangler *named environment* is the
   wrong tool here: `vars` is documented as a non-inheritable key, so `env.preview` would have to restate every var, and
   named environments do not inherit bindings either. Without that one line, `assertSameOrigin` compares
   `Origin: http://localhost:8787` against the production https origin and **403s every mutation**, so local login is
   impossible and `cookie.test.ts`'s http case describes a configuration that never exists.
7. `next` is sanitised server-side: `new URL(next, APP_ORIGIN).origin` must equal `APP_ORIGIN` and the result must
   begin with exactly one `/`; `//host`, absolute URLs and anything else fall back to `/`.

**The boundary**

8. `requireSessionOr401()` is the **first** statement of every route handler touching user data, and `requireSession()`
   of every Server Action (01 rule 17). `src/proxy.ts` is never the only gate: Next 16 docs say a matcher excluding a path
   "will also skip Server Function calls on that path… Always verify authentication and authorization inside each
   Server Function rather than relying on Proxy alone", and OpenNext's `proxy.ts` support is *experimental*
   (r04 §2.2–2.3). Verification is: read cookie → `verifySessionToken` (HS256, 60 s tolerance, zero I/O) → compare
   `claims.v` to `currentSessionVersion()`, a mismatch being `stale_version`. **`isPublicPath()` returns non-null for
   exactly the following and nothing else** — getting this list wrong breaks installability or poisons the precache:

   | Path | Reason | Note |
   |---|---|---|
   | `/manifest.webmanifest` | `pwa-manifest` | Worker-rendered route from `app/manifest.ts` (r05 §7b) |
   | `/sw.js` | `service-worker` | Static asset: Cloudflare serves it before the Worker (r05 §5a). **No `/sw.js.map`** — `serwist.config.mts` sets `swDest: "public/sw.js"` and configures no sourcemap, so gating a path that is never emitted is dead surface |
   | `/favicon.ico` | `pwa-icon` | App Router file convention, served as a static asset |
   | `/icon.png`, `/apple-icon.png` | `pwa-icon` | Reserved. specs/05 currently ships icons from `public/icons/` and adds no metadata icon route; these two are listed so that adding `app/icon.tsx` later cannot silently gate an icon |
   | `/icons/**` | `pwa-icon` | The real set — `icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon`, `badge-72` (r05 §7c) |
   | `/~offline` | `offline-fallback` | Must answer 200 to the precache fetch or SW install dies |
   | `/login`, `/login/recover` | `auth-ui` | Prerendered and precached |
   | `/api/auth/{login,logout,refresh,session,recover}` | `auth-api` | Self-authenticating — but **not** exempt from rule 24 |
   | `/api/telegram/webhook/**` | `machine-auth` | Secret header (rule 19) |
   | `/api/cron/**` | `machine-auth` | Shared secret (rule 20) |
   | `/api/health` | `health` | Unauthenticated liveness by design (`specs/01` §Files) |
   | `/_next/static/**` | `next-internal` | Served by Cloudflare's asset layer before the Worker (r05 §5a) |
   | `/_next/image/**` | `next-internal` | Public because it must be, not because it is cheap: on OpenNext this **is** handled by the Worker (it is not a static asset), so leaving it out of the list would gate every optimised image |

9. **`PROXY_MATCHER` is the second half of that contract and its literal value is in §Interfaces** — an invented matcher
   is the single likeliest way to break installability (r04 §4 gotcha 7: a gated `sw.js` or `manifest.webmanifest` and the
   app stops being installable). Derivation rule, stated once: the matcher excludes exactly the paths whose
   `isPublicPath()` reason is `next-internal`, `service-worker`, `pwa-manifest`, `pwa-icon`, `offline-fallback` or
   `auth-ui`, **plus all of `/api/**`** — every API path, public or protected, because rule 10 forbids the proxy from
   touching a non-navigation request at all and `requireSessionOr401()` is the only gate an API route ever needs. So
   `/login` and `/api/auth/**` are public to `isPublicPath()` *and* excluded from the matcher; nothing in this design
   needs the proxy to run on them (see rule 12, which deletes the old `/login` bounce). Because `_next/data` requests run
   the proxy regardless of the matcher (r04 §2.2), `src/proxy.ts` **also** calls `isPublicPath()` as a second gate and
   returns `NextResponse.next()` on a non-null reason. `proxy-matcher.test.ts` asserts match/no-match for every row of
   rule 8 plus `/sw.js`, `/manifest.webmanifest`, `/_next/static/chunk.js` and `/icons/icon-192.png`.
10. Every other `/api/**` route is protected at the data layer, and **API routes never redirect**: an auth failure on
    any non-navigation request is a JSON `401` carrying `details.reason` (`missing` | `expired` | `stale_version` | …)
    and `cache-control: no-store`. Verified reason: Serwist's `PrecacheStrategy` rejects only `status >= 400` and
    *copies* redirected responses so they become cacheable, so a `302 → 200` HTML login page would be written into the
    precache under our own shell key (r04 §4 gotcha 2). A 401 cannot poison the precache.
11. **Every route that must survive offline is a public static shell — and the exceptions are named, not implied.**
    A precached route renders a shell holding zero user data; data arrives from `/api/**` after hydration. A
    non-navigation GET of such a page — exactly what the Serwist precache install performs — therefore returns `200`
    regardless of session. On those routes **no page, layout or child layout may call `requireSession()` or touch a
    binding**: that forces `dynamic = "force-dynamic"` (01 rule 12), drops the route from `precachePrerendered`
    (r05 §2b), and silently breaks offline navigation. **The root layout must never read the session cookie** — a dynamic
    root layout removes *every* prerendered route from the precache manifest (r05 §6c), and that has no exception list.

    One route opts out, by name: **`src/app/(app)/page.tsx`, the dashboard**, which specs/12 line 38 deliberately makes
    `force-dynamic` RSC and whose offline story is 12's own IndexedDB snapshot rehydrated by `/~offline`, not the
    precache. So the rule is an explicit one-entry allowlist, not a blanket ban:

    ```ts
    // src/lib/auth/public-paths.ts
    /** App-group routes allowed to be dynamic. Adding a row here is a spec change in BOTH specs. */
    export const DYNAMIC_APP_ROUTES = ["/"] as const;
    ```

    A route on that list **MUST call `requireSession()` as the first statement of its component** (01 rule 17). It is
    already dynamic, so there is nothing left to lose, and it renders user data server-side: without the call, the only
    gate would be `src/proxy.ts`, which is experimental and which rule 13 requires the app to survive without. Every
    other app-group route must contain neither `force-dynamic` nor `requireSession()`. Both halves are CI-checked over
    `src/app/**/*.tsx` — not just `page.tsx`, because a child `layout.tsx` is the fatal case (§Verification).
12. `src/proxy.ts` does **exactly one thing**: a document navigation to a matched, non-public path with no valid session
    → `302` to the *relative, same-origin* `/login?next=<encoded path>`. Construct it literally as

    ```ts
    return new NextResponse(null, { status: 302,
      headers: { location: "/login?next=" + encodeURIComponent(pathname + search) } });
    ```

    — **not** `NextResponse.redirect()`, which requires an absolute URL and emits an absolute `Location`. Behind
    Cloudflare + OpenNext, `request.url`'s scheme and host can be the internal ones, so an absolute `Location` both leaks
    that host and can bounce the installed PWA out of its manifest scope (the Access failure mode, r04 §2.4 a1).
    It never 401s, never blocks a subresource, never emits a cross-origin redirect, and **reads neither D1 nor KV** —
    signature and `exp` only. A request is a document navigation iff `sec-fetch-mode === "navigate"`, falling back to
    `accept` containing `text/html` when that header is absent; Serwist's precache `fetch()` sends
    `sec-fetch-mode: cors` and `accept: */*`, so it is never a navigation.

    **Two things it deliberately no longer does**, both removed because a stateless proxy cannot do them correctly:
    (a) *bouncing an authenticated navigation off `/login`* — it cannot see `session_version`, so a revoked-but-signed
    cookie was bounced `/login → /` while `SessionGate` sent it `/ → /login`, an unbreakable redirect loop that left the
    owner unable to reach the login form after `logout?everywhere=1`. `/login` is now outside `PROXY_MATCHER` entirely;
    the login form itself, on mount, redirects to `next` when `GET /api/auth/session` returns 200 (a convenience, not a
    gate). (b) *sliding renewal* — `issueSessionToken` needs a version, and carrying `claims.v` forward would extend a
    revoked session's cookie by another 365 days on every navigation. Renewal lives in `POST /api/auth/refresh`, which
    re-reads `v` (rule 14) and which `SessionGate` already calls once per page load.
13. **Deleting `src/proxy.ts` must not break correctness** — with no proxy an unauthenticated cold start lands on a
    shell, `SessionGate` handles it, and the dashboard's own `requireSession()` (rule 11) still refuses to render data.
    That is the mitigation for the experimental adapter path, and it is an e2e test (`@no-proxy`). `SessionGate` renders
    `children` immediately, never a blocking spinner: on mount and on `visibilitychange` while `navigator.onLine` it
    calls `GET /api/auth/session`; on a network error it does nothing (that is the offline case); and if `fa_session_exp`
    shows an age past `RENEW_AFTER_AGE_SECONDS` it calls `/api/auth/refresh` once per page load.

    **The single 401 policy — one rule, no reason-dependence, so there is nothing to guess.** On any `401` from
    `/api/auth/session` (or an `auth:expired` event from the sync engine, rule 18), `SessionGate` opens the re-auth
    **sheet** if *any* of `meta["auth.pendingReauth"]`, `meta.workoutActive` or `outboxCount() > 0` is truthy, and
    otherwise navigates to `/login?next=<current path>`. Rationale: those three conditions are exactly the states in
    which navigating away would unmount work in progress; every other state is a plain cold "you are signed out". The
    401's `details.reason` (`missing` | `expired` | `stale_version` | …) is logged and shown in the sheet's subtitle, but
    it never changes which branch runs.

**Renewal, logout, revocation**

14. `POST /api/auth/refresh` requires a valid session **and passes `assertSameOrigin`** (rule 24): age
    `> RENEW_AFTER_AGE_SECONDS` → a new cookie pair with a full 365-day `Max-Age` and `200 {expiresAtMs}`, otherwise
    `204` with no `Set-Cookie`. `v` is re-read from the store, so refresh can never resurrect a revoked session. This is
    the *only* renewal path in the system. `POST /api/auth/logout` → `204` plus both clearing cookies (`Max-Age=0`),
    idempotent even with no session, **also origin-checked**; `?everywhere=1` also calls `bumpSessionVersion()`.
15. `currentSessionVersion()` is KV-cached at `expirationTtl: 60`. **Accepted consequence: a revocation can take up to
    ~60 s plus KV propagation to bite.** Escalation: (a) `logout?everywhere=1`; (b) `wrangler secret put
    SESSION_SECRET`, which invalidates every token instantly; (c) `wrangler d1 execute` to overwrite the credential.
    Anything that changes `settings.session_version` **outside** `bumpSessionVersion()` — raw SQL included — must also
    delete the KV key by hand, or the stale value is served for up to 60 s (this is why the e2e case in §Verification
    does both).

**Offline**

16. **Nothing validates the session offline, by design.** With no network no request reaches the Worker: the SW answers
    navigations from the precache, the UI boots from precached static assets, and sets go to IndexedDB (r04 §2.8). The
    installed app therefore opens and logs a full workout **with no session cookie at all** — the Phase 2 DoD — and
    nothing client-side is trusted, because the only thing the client can do offline is write to its own IndexedDB.
    The single hard requirement this places on the cookie is rule 6's explicit `Max-Age`: without it the cookie is a
    session cookie, the OS kills installed PWAs routinely, and the next cold start in a gym basement cannot
    re-authenticate (r04 §4 gotcha 1). Unit-tested. `/login` itself stays usable offline as a page — when
    `navigator.onLine === false` submit is disabled and the screen reads the offline notice of rule 17, linking to `/`,
    which works because the shell is public.
17. **RU/EN with no dynamic rendering: both locales are inlined and one is picked client-side.** The brief mandates
    "i18n RU/EN (default RU)" and specs/02 defaults `settings.locale='ru'`, but `/login` and `/login/recover` MUST stay
    statically prerendered and precached (rules 11 and 16), so they may not read `cookies()`, `headers()` or call
    `next-intl`'s request config — that is precisely the constraint specs/05 §6 solves by resolving the locale in a
    client provider, and why 05's `/~offline` inlines both locales. This spec does the same thing for every auth
    surface: `src/lib/auth/copy.ts` exports `AUTH_COPY` with a complete `ru` and `en` record; the client component picks
    `meta.locale` from Dexie when present, else `"ru"` (specs/02's default — never `navigator.language`, which would make
    the first screen non-deterministic), and sets `lang` on its root element. The catalogue is ~15 short strings, so
    shipping both costs under 1 KB against `/login`'s 60 KB budget (specs/16 §21). The RU copy is listed in §UX notes;
    the re-auth sheet and the pending-sync banner use the same object.
18. **Stale session syncs.** When the queue drains and any replayed request returns `401`, the sync engine
    (`specs/05-pwa-offline-sync.md`) MUST: stop at that item; leave the queue and every mutation intact; not advance the
    exponential-backoff counter; set `meta["auth.pendingReauth"] = true`; dispatch `auth:expired`. It must never delete,
    truncate or reorder the queue on a 401. Per rule 13 that state guarantees the re-auth **bottom sheet** rather than a
    navigation, so an in-progress workout is never unmounted; on success `SessionGate` clears
    `meta["auth.pendingReauth"]`, dispatches `auth:restored`, and the queue resumes from its head in order. Replays are
    idempotent by client-generated id (specs 05/06), so a partially applied batch is safe. Dismissing the sheet keeps the
    queue paused behind a persistent "N changes waiting — sign in to sync" banner. No data loss in any branch.

**Machine-to-machine**

19. `POST /api/telegram/webhook/<slug>`: the slug is **one literal, committed path segment** — the route file is
    `src/app/api/telegram/webhook/<slug>/route.ts` (owned by specs/14), not a `[slug]` dynamic segment. That choice is
    what makes "hide the endpoint" free: any other path under `/api/telegram/webhook/` is a plain Next **404** with no
    handler to reason about, while the real path answers **401** on a bad secret so the failure surfaces in
    `getWebhookInfo.last_error_message` (r06 §8.4). The slug is not a secret (rule 28 accepts that it may appear in
    logs); the header is the gate. Compare `x-telegram-bot-api-secret-token` to `env.TELEGRAM_WEBHOOK_SECRET` with
    `constantTimeEqualUtf8`. Mismatch or missing expected → bare `401`. Exempt from the session check and from
    `assertSameOrigin` (Telegram sends no `Origin`); never counted against `AUTH_LIMITER`. The chat-id lock is `specs/14`.
20. `POST /api/cron/[job]` (handler owned by 01) calls `verifyCronSecret`; a mismatch is **404**, not 401, so the
    endpoint's existence is not confirmed (r01 §3.3). Exempt from session and origin checks. `scheduled()` calls job
    functions directly and must never `fetch()` its own public hostname: `global_fetch_strictly_public` loops such a
    request back through the Cloudflare front door (stack-facts; r04 §2.4 a4) while `scheduled()` still reports
    success. The only permitted HTTP hop is `env.WORKER_SELF_REFERENCE.fetch()` against
    `APP_ORIGIN + "/api/cron/<job>"` carrying `x-cron-secret` explicitly, because a service-binding call is not
    authenticated by the caller (r01 §2.6).
21. Both machine comparisons fail closed: an empty or undefined expected secret returns `false`, never `true`.
    Unit-tested — the inverse is the quietest possible hole. The same constraint applies to *how* they compare: every
    file under `src/lib/auth/**` must run unchanged on workerd **and** on Node, because the unit suite is the `unit`
    project with `environment: "node"` (specs/16 §Pyramid 1/5). So no `crypto.subtle.timingSafeEqual` (workerd-only) and
    no `node:crypto` import (Node-only, and a Node builtin in a Worker bundle) — `constantTimeEqualBytes` is the one
    portable primitive, and both machine checks plus `verifyPassword` and `consumeRecoveryCode` go through it.

**Rate limiting and CSRF**

22. `AUTH_LIMITER` (`ratelimits[0]`, `{limit:10, period:60}`; 01 owns the config) is called as
    `checkRateLimit(env.AUTH_LIMITER, new URL(request.url).pathname, request)` — the three-argument signature specs/01
    §Interfaces declares, **keyed on pathname** as 01 rule 28 requires. Pathname keying already gives `/api/auth/login`
    and `/api/auth/recover` independent per-colo counters, so no bespoke `"auth:*"` keys and no third binding. A
    rejection is 01's ready-made `429 rate_limited` + `Retry-After`, and it does **not** count as an auth failure
    (rule 23).
23. Edge limits are per-colo, not a global ceiling (r04 §3.2, verbatim), so the durable ceiling lives in D1 — but keyed,
    **never as one singleton row**. A single global lock keyed to nothing is a one-command denial of service on the app's
    only user: 20 wrong passwords from anywhere and the owner is locked out, repeatedly, with no email channel and
    `wrangler d1 execute` as his only escape — from the gym. So:

    - **Per-IP ladder** (`auth_throttle.id = throttleKey(request)`, i.e. `"ip:<CF-Connecting-IP>"`): 5 consecutive failures → 60 s, 10 → 900 s.
      **There is no 24-hour rung**; 900 s is the ceiling, so the worst case for anybody, attacker or owner, is bounded by
      a quarter hour. This lock is `hard`: it short-circuits before any PBKDF2, so hammering one IP costs us nothing.
    - **Global counter** (`auth_throttle.id = "global"`): 100 consecutive failures → 900 s, and this lock is **soft**. A
      soft lock does *not* skip the credential check: the request runs `verifyPassword` + `verifyTotp` as usual, a
      correct password + TOTP **succeeds and clears every row**, and only a *failure* returns 429. It therefore shapes a
      distributed spray (whose attempts are already capped at `10 × colos`/min by rule 22) without ever standing between
      the owner and his own data.
    - **Decay and re-application, stated so two engineers cannot implement two ladders**: `consecutive_failures` resets
      to 0 on any success and after `THROTTLE_RESET_SECONDS = 3600` with no new failure (so 20 typos spread over a year
      never compound). Every failure at or past a rung re-applies that rung's `lockSeconds` — failure 6, after the 60 s
      lock expired, locks 60 s again; failure 10 and every failure after it locks 900 s.
    - **What counts as a failure** — exactly two things: a credential failure and a Zod failure (rule 4 already makes
      both the same 401). A 403 from rule 24, a 429 from rule 22 and a 429 from this rule itself **never** call
      `recordAuthFailure`, so a rejection can never compound itself.

    A lockout rejection is `429 rate_limited` with `details.retryAfterSeconds`. Both rows are written in one
    `db.batch([...])` (D1 has no transactions — specs/05 §25).
24. **Every non-GET/HEAD request to any route in this app calls `assertSameOrigin`; rules 19–20 are the only two
    exemptions.** Not "every session-protected route": `/api/auth/{login,logout,refresh,recover}` are `auth-api` public
    paths, and leaving them out would make `POST /api/auth/logout?everywhere=1` a cross-site CSRF that bumps
    `session_version` and signs the owner out of every device — cheap, repeatable, and not stopped by `SameSite=Lax`,
    which permits a cross-site form POST carried by a top-level navigation. Rules 4, 14 and 25 name the check explicitly
    for login, logout, refresh and recover.

    The check accepts **two proofs, and requires at least one** (`checkSameOrigin`):
    (a) `Origin` present and byte-equal to `env.APP_ORIGIN` → pass; (b) `Origin` absent, or the literal string `null` →
    pass only if `Sec-Fetch-Site: same-origin`. An `Origin` that is present and different always fails, whatever
    `Sec-Fetch-Site` says. Both absent → fail (`reason: "absent"`).

    Why two proofs: the headline promise of this app is that a queued mutation replays on reconnect, and specs/05 §25
    replays from a reconstructed `Request` inside the service worker, where `Origin` is a forbidden header the SW cannot
    set itself. Per the Fetch standard the browser should still append the SW's origin to a non-GET/HEAD request — but a
    `no-referrer` referrer policy serialises it as `null`, and **we did not verify this end to end** (UNVERIFIED, see
    §Open questions). If that one header were missing, every offline mutation would 403 on reconnect and specs/05's
    `classifyFailure` maps 403 → `auth`, so it would present as a permanent bogus re-auth prompt rather than an error:
    the quietest possible way to break the product's core promise. `Sec-Fetch-Site` is browser-set, cannot be forged by
    page script, and is `cross-site`/`same-site` for exactly the requests we mean to reject. With `SameSite=Lax` on top,
    that is the whole CSRF story — no token is minted. A Playwright case proves the real SW replay succeeds (§Verification).

**Recovery**

25. `POST /api/auth/recover` takes **password + one unused recovery code** (not TOTP), is origin-checked (rule 24), sits
    behind the same limiter and ladder, and on success revokes that code (`revoked_at`), rotates the TOTP secret, bumps
    `session_version`, mints a session, and returns `RecoverOk`. `consumeRecoveryCode` always PBKDF2-compares against
    **every** unrevoked `recovery` row — 8 × 81 ms ≈ 650 ms, well inside the CPU budget — and folds the results with a
    constant-time OR, so response time never reveals how many codes are left or which one matched. Rotation is
    deliberate: you used a recovery code because the authenticator is gone.

    The UI is `/login/recover`, a prerendered sibling of `/login` with the same copy mechanism (rule 17). On success it
    renders `totpProvisioningUri` **once** as a QR (`src/components/auth/totp-qr.tsx`) beside `totpSecretBase32` as
    selectable text, plus "scan this now — it is shown once" and `recoveryCodesRemaining`. There is no settings screen to
    own a low-codes warning and no spec claims one, so the warning lives where this spec already has a surface on every
    screen: `GET /api/auth/session` returns `recoveryCodesRemaining` and **`SessionGate` renders a persistent banner at
    `<= 2`**, linking to the regeneration instructions. Regeneration itself is
    `node scripts/auth-bootstrap.mjs --recovery-only`, never a route.
26. Last resort (the password vault itself is lost) is documented, not automated: overwrite the `kind='password'` and
    `kind='totp'` materials with fresh bootstrap output and bump the version —
    `wrangler d1 execute fitness-pwa-db --remote --command "update auth_credentials set material='…' where kind='password'"`,
    the same for `'totp'`, then `update settings set session_version = session_version + 1`, then
    `wrangler kv key delete --binding CACHE_KV auth:session_version` (rule 15 — raw SQL does not invalidate the cache).
    **`fitness-pwa-db` is the real database name**, as committed in `wrangler.jsonc` and used by specs/02 line 475 and by
    `package.json`'s `db:migrate:*` scripts; specs/01's `fitness-db` is stale. `wrangler d1 execute` also accepts the
    *binding* name `DB` (verified in wrangler 4.131.1: `nameOrBinding === d1Database.database_name || nameOrBinding ===
    d1Database.binding`), so `wrangler d1 execute DB …` is the copy-paste-safe form if the database is ever renamed.
    This is the accepted price of having no email channel.

**Accepted risk, stated explicitly**

27. The shell HTML, JS, CSS and icons are world-readable. Not a choice: Cloudflare serves static assets **before**
    invoking the Worker (r05 §5a), so `_next/static` can never be gated. Accepted; rule 11 keeps user data out of every
    prerendered asset. The cookie is a 1-year bearer token, so theft (malicious extension, cloned profile, unlocked
    phone) grants full access until a version bump or secret rotation — accepted, mitigated by `HttpOnly`, `Secure`,
    `__Host-`, `SameSite=Lax`, 01's CSP and no third-party script on the origin. Locally cached workouts, photos and
    nutrition data in IndexedDB and the Cache API are readable by anyone holding the unlocked device — accepted, the OS
    device lock is the control, and encrypting IndexedDB under a login-derived key would defeat offline logging.
28. Also accepted, each one named rather than discovered later:
    - The webhook slug may leak into logs — the secret header is the real gate and rotation is one `setWebhook` call.
    - A distributed attacker gets `10 × colos` login attempts per minute before rule 23's global rung bites, and the
      global rung is deliberately soft, so it slows a spray rather than stopping it. Password (≥ 12 chars, from a vault)
      **and** a 6-digit TOTP must both be right, and each attempt costs an 81 ms PBKDF2 — this is a courtesy brake on a
      hopeless search, not the control.
    - **Someone sharing the owner's public IP (gym Wi-Fi, CGNAT) can burn the per-IP ladder and cost the owner up to
      900 s.** That is the price of keying the ladder at all; it is bounded, it never exceeds 15 minutes, and the global
      row cannot lock him out. Accepted in preference to the singleton row's unbounded, remotely triggerable lockout.
    - `throttleKey()` trusts `CF-Connecting-IP`, which is set by Cloudflare and unspoofable *from outside*, but degrades
      to one shared `ip:unknown` bucket if the header is ever absent (local `wrangler dev`). Accepted: the degradation is
      to *more* limiting, never less.
    - `auth_events` is written but alerts nobody (a failed-login count may ride along in the weekly Telegram report).

    **Never acceptable:** a registration or reset endpoint, a password in a query string, a secret in a log line or in
    `ai_prompt_logs`, a `middleware.ts` (inert on Next 16 — r04 §4 gotcha 6), a 302 answering a non-navigation request,
    or a durable lock that a correct password cannot escape.

## Data

`specs/02-data-model.md` owns every definition. It already declares `auth_credentials` ("04-auth owns semantics") and
the `settings` singleton; this spec needs **four additions and one seed row** from it, and nothing more:

1. `settings.session_version INTEGER NOT NULL DEFAULT 1` (an `ALTER TABLE ADD COLUMN` with a constant default, 02's
   established pattern for `settings`).
2. The table `auth_events`.
3. The table `auth_throttle` — **keyed, not a singleton** (rule 23): `id TEXT PRIMARY KEY` holding either
   `"ip:<client ip>"` or `"global"`.
4. The documented `auth_credentials.kind` domain widened from `password|totp|passkey` to
   **`password|totp|recovery|passkey`**. Cheap on purpose: 02 line 179 carries no `C(kind∈…)`, and 02 rule 13 reserves
   CHECKs for dataset-frozen enums, so this is a comment + Zod change with **no** table recreate. If a CHECK is ever
   added it must include `recovery` from the start, because adding one later forces 02 rule 11's recreate.
5. The single seeded `users` row **`id = 'me'`** plus its `settings` row. `auth_credentials.user_id` is a NOT NULL FK, so
   without it the bootstrap INSERTs of rule 2 fail. `'me'` is the value `claims.sub` and `APP_USER_ID` are pinned to.

Two tables this design does **not** use, called out so nobody wires them in by accident:

- **`sessions`** (shipped in 02's `0000_init.sql`, and 02 line 24 assigns its lifecycle to "04-auth.md"). This spec is
  **stateless**: the signed cookie plus `settings.session_version` is the entire session store, so `sessions` is written
  by nothing and read by nothing here. It is 02's to drop or leave inert — 04 requires neither, and the expired-row
  cleanup cron 02 mentions is harmless either way. Any future code inserting into `sessions` is a design regression.
- **`credentials`** — Phase 0 shipped `drizzle/migrations/0001_credentials.sql` (columns `password_hash`,
  `password_salt`, `password_iterations`, `totp_secret`, `session_version`, `last_totp_step`), a one-table shortcut that
  predates this spec and cannot express recovery codes, per-credential revocation or passkeys. Phase 1 uses
  `auth_credentials` + `settings.session_version` as specified here; reconciling or dropping `credentials` is specs/02's
  migration to write (it also means Phase 0's `src/lib/auth/*` and `/setup` route are replaced, not extended).

| Table | Used here | Notes |
|---|---|---|
| `auth_credentials` | `user_id` = `'me'`; `kind` ∈ `password`\|`totp`\|`recovery`\|`passkey`; `label?` free text (e.g. `"paper card 2026-09"`); `material` = `PasswordRecord` string for `password`/`recovery`, base32 seed for `totp`; `counter` = last accepted TOTP step; `revoked_at` = "recovery code consumed"; `last_used_at` touched on success | exactly one unrevoked `password` and one `totp` row at a time |
| `settings` | `session_version` — read on the hot path via KV, written by `bumpSessionVersion()` | singleton row, PK `user_id` |
| `auth_events` | `id`, `at_ms`, `kind`, `ok`, `reason`, `ip`, `ua` | append-only; index `(at_ms DESC)` |
| `auth_throttle` | `id` (`"ip:<ip>"` \| `"global"`), `consecutive_failures`, `locked_until_ms`, `updated_at` | upserted; both rows written in one `db.batch()` |

- **Hot path:** one KV read per protected request, zero D1 reads while the key is warm. Only login, recover and
  refresh read `auth_credentials`. The one deliberate exception is `GET /api/auth/session`, which adds a single
  `count(*)` over the ≤ 8 `recovery` rows for `recoveryCodesRemaining` (rule 25); `SessionGate` calls it on mount and on
  `visibilitychange`, not per request, and no other protected route reads D1 for auth.
- **KV** (`CACHE_KV`): `auth:session_version` → decimal integer string, `expirationTtl: 60`, deleted by
  `bumpSessionVersion()`. Never store a token, hash or seed in KV — its eventual consistency makes it wrong for
  anything authoritative (r04 §2.5).
- **R2:** none. No auth artefact is ever written to R2, backups included.
- **IndexedDB**: **one** key in 05's existing key-value `meta` store (`meta: "&key"`, owned by
  `specs/05-pwa-offline-sync.md`, which declares `pullCursor`, `schemaVersion`, `deviceId`, `locale`, `hydration`,
  `persisted`, `workoutActive`) — `auth.pendingReauth: boolean`. That key is cross-spec request 3: 05 must add it, the
  same way the DDL additions above are 02's. No new store. An earlier draft also mirrored the expiry as
  `auth.expiresAtMs`; it is **deleted** — the `fa_session_exp` cookie is readable with no network, which is the entire
  point of a non-`HttpOnly` meta cookie, so a second source of truth for one value bought nothing and every rule that
  needs the expiry (rule 13) reads the cookie.
  **No token, password, TOTP seed or recovery code is ever written to IndexedDB, `localStorage` or the Cache API.**
- **Env** (01 owns `wrangler.jsonc`): secrets `SESSION_SECRET`, `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`; var
  `APP_ORIGIN`; bindings `DB`, `CACHE_KV`, `AUTH_LIMITER`. Plus the fourth thing this spec needs from 01:
  **`APP_ORIGIN=http://localhost:8787` in `.dev.vars.example`** (and therefore in every developer's `.dev.vars`), which
  is what makes rule 6's http branch and the whole local HTTP matrix reachable. `SESSION_SECRET` there may be any
  base64url string decoding to ≥ 32 bytes; `scripts/auth-bootstrap.mjs` prints one.

## UX notes

- Login is a **full page** (a cold-start destination that must stay prerenderable); re-authentication after a stale
  sync is a **bottom sheet** over the live screen — an in-progress workout is never unmounted to sign in.
- One-handed reach: both fields and the 56 px submit button sit in the lower two-thirds; the heading may scroll away.
  Submit is the only primary action on the screen.
- `type="password" autocomplete="current-password"` so the password manager fills it; the TOTP field is
  `inputMode="numeric" autocomplete="one-time-code" maxLength={6}` so iOS can offer the code from the keyboard strip.
- **Auto-submit on the 6th digit is armed once.** It fires only while no attempt is in flight **and** no attempt has yet
  failed in this page life; after any failure, submitting requires an explicit tap. A hair-trigger submit feeding rule
  23's ladder is how a stale code pasted by a password manager, or a drifting clock, silently walks the only user toward
  a 60 s lock — five keystroke-triggered attempts is trivially reachable, and nothing about it is the user's intent.
- Haptics: one short `navigator.vibrate?.(20)` on failure only. Success has no haptic and no animation — it navigates.
  Confetti stays reserved for PRs. No skeleton on `/login` (it is static): in flight the submit button swaps its label
  for an inline spinner at fixed width and sets `disabled`, and a `role="status"` node announces "Проверяем…". The form
  is **not** made `inert`: `inert` strips the submit button from the a11y tree and blurs it, so `aria-busy` on it would
  never be announced and the screen-reader cursor would be dropped mid-action.
- The re-auth sheet uses 03's standard spring and is swipe-down dismissible — dismissing is a legitimate choice (keep
  logging offline), so it must not feel like a trap; under `prefers-reduced-motion` it cross-fades without translating.
- a11y: one `<h1>`; a visible `<label>` per input; a visible focus ring on every control; the lockout countdown announced
  once, not per second; the offline notice is `role="status"`. Errors go in a **`role="alert"`** region with **no
  `aria-live`** — `role="alert"` already implies `assertive`, and overriding it to `polite` is contradictory and
  inconsistently supported. The alert region does **not** take focus (that double-announces and moves the user away from
  the field to fix); instead focus moves to the offending `<input>`, which carries `aria-invalid="true"` and
  `aria-describedby` pointing at the alert. Never show more than "Wrong password or code", plus rule 5's clock hint.
- Contrast: the lockout countdown, the offline notice, the low-recovery-codes banner and the pending-sync banner are new
  surfaces on the OLED-black canvas and each must meet **WCAG AA (4.5:1 body, 3:1 for ≥ 24 px)** against it, using 03's
  tokens (`--color-warning` / `--color-muted-foreground`, never a one-off hex) — the brief's AA requirement, and
  specs/16 §25's axe gate already scans `/login`.
- **Copy, both locales (rule 17).** RU is the default; EN is the same object's other half. The strings, verbatim:

  | Key | RU | EN |
  |---|---|---|
  | `title` | «Вход» | "Sign in" |
  | `password` | «Пароль» | "Password" |
  | `totp` | «Код из приложения» | "Authenticator code" |
  | `submit` | «Войти» | "Sign in" |
  | `pending` | «Проверяем…» | "Checking…" |
  | `badCredentials` | «Неверный пароль или код» | "Wrong password or code" |
  | `clockHint` | «Проверьте часы на телефоне» | "Check your phone's clock" |
  | `lockedFor` | «Слишком много попыток. Повторите через {n} с» | "Too many attempts. Try again in {n} s" |
  | `offline` | «Нет сети — приложение открывается и записи сохраняются» | "No connection — you can still open the app and keep logging" |
  | `offlineLink` | «Продолжить без сети» | "Continue offline" |
  | `pendingSync` | «{n} изменений ждут отправки — войдите, чтобы синхронизировать» | "{n} changes waiting — sign in to sync" |
  | `reauthTitle` | «Войдите снова, чтобы синхронизировать» | "Sign in again to sync" |
  | `recoverLink` | «Потерян доступ к приложению-аутентификатору?» | "Lost your authenticator?" |
  | `recoverTitle` | «Восстановление доступа» | "Recover access" |
  | `recoveryCode` | «Код восстановления» | "Recovery code" |
  | `scanOnce` | «Отсканируйте сейчас — код показывается один раз» | "Scan this now — it is shown once" |
  | `codesLeft` | «Осталось кодов восстановления: {n}» | "Recovery codes left: {n}" |
- The one-time QR screen: the `<img>`-equivalent SVG carries an `aria-label` naming it ("QR-код для приложения-аутентификатора"),
  and the base32 secret sits next to it in a `<code>` element that is selectable and readable by a screen reader —
  a QR alone is unusable to anyone who cannot point a camera at their own screen. Both are inside one `role="group"`
  labelled by the `scanOnce` heading, and the screen has no auto-dismiss.

## Risks

1. **Someone adds `requireSession()` or a D1 read to an app-group page that is not on `DYNAMIC_APP_ROUTES`** → the route
   goes dynamic → drops out of the precache → offline navigation silently falls back to `/~offline`, mid-session, in the
   gym. **And its mirror image**: someone adds a route to the allowlist without `requireSession()`, and a dynamic page
   renders user data to anyone who reaches it past the proxy. Both directions are grepped in CI over `src/app/**/*.tsx`
   (`layout.tsx` included — the child-layout case is the fatal one), plus the prerender-artifact checks below.
2. **`src/proxy.ts` regresses** (experimental; the `Dynamic require of ".next/server/instrumentation.js"` bug class is
   already documented — r04 §2.3). Mitigated by rule 13 and the `@no-proxy` e2e test.
3. **A leftover `middleware.ts`** from any pre-Next-16 snippet is never invoked, so an auth check written there
   evaporates. Mitigated by the `test ! -f middleware.ts && test ! -f src/middleware.ts` check — both locations, since
   this project's proxy lives at `src/proxy.ts`.
4. **A 302 leaking onto a non-navigation response** poisons the precache with the login page — the worst and quietest
   failure in this module. Mitigated by rule 10, the `sec-fetch-mode: cors` curl **against a route that exists**, and
   auth code never constructing a redirect outside `src/proxy.ts`.
5. **`__Host-` over http://localhost** behaves inconsistently across browsers. Mitigated by rule 6's
   `APP_ORIGIN`-derived switch, exercised in both modes, with the https name asserted by a unit test so the insecure
   fallback cannot reach production.
6. **Fail-open on a missing secret** — mitigated by rule 21's empty-secret tests and rule 3's hard failure.
7. **Cron self-fetch** through the public hostname dies silently. Mitigated by rule 20 plus a CI grep for `APP_ORIGIN`
   fetches in `worker.ts` / `src/jobs/**` that skip `WORKER_SELF_REFERENCE`.
8. **Telegram retries a 401 webhook** after a secret rotation, which looks like an outage. Rotate by calling
   `setWebhook` first and `wrangler secret put` second; debug with `getWebhookInfo.last_error_message` (r06 §8.3).
9. **Lost password vault = D1 surgery.** Mitigated by printing the recovery codes on paper at bootstrap, keeping the
   TOTP seed in the *synced* vault, and rule 26's exact commands.
10. **Phone clock drift** produces a maximally unhelpful "wrong code" — mitigated by rule 5's `serverTimeMs`, which is
    present on the failing response itself (the earlier "flag it on the next success" design could never fire).
11. **The durable lockout becomes a denial of service on the only user.** The failure mode this spec had: one singleton
    `auth_throttle` row keyed to nothing, checked before any credential work, with a 24 h rung — so any unauthenticated
    stranger could POST 20 wrong passwords and lock the owner out for a day, repeatedly, forever, with `wrangler d1
    execute` as the only escape. Mitigated structurally by rule 23 (per-IP keying, a 900 s ceiling, and a *soft* global
    rung a correct password always beats), and proved by a verification case that logs in successfully while the global
    row is locked.
12. **A redirect loop between `src/proxy.ts` and `SessionGate`** after a revocation: a signature-valid but stale cookie
    was bounced off `/login` by a proxy that cannot read `session_version`, while the client was sent *to* `/login` by a
    401 it could read. The user could never reach the form. Structurally impossible now — rule 12 deletes the bounce and
    `/login` is outside `PROXY_MATCHER` — and asserted by the e2e stale-session case, which must end on the login form.
13. **`Origin` missing on the service worker's replayed POST** would 403 every offline mutation on reconnect and, via
    05's `classifyFailure` (403 → `auth`), surface as a permanent bogus re-auth prompt instead of an error. Mitigated by
    rule 24 accepting `Sec-Fetch-Site: same-origin` as a second proof, and by an e2e case that replays a real queued
    mutation from the SW. The underlying browser behaviour is UNVERIFIED (§Open questions).

## Verification

```bash
npx tsc --noEmit                 # PASS: exit 0
npx vitest run tests/unit/auth   # PASS: exit 0, 0 skipped
```

`tests/unit/auth/**` belongs to Vitest **project `unit`** (`environment: "node"`), the only project specs/16 defines for
non-DOM code — 16 §Pyramid 5 rejects `@cloudflare/vitest-pool-workers` outright (no published build carries a
`vitest ^5` peer). Everything asserted below therefore has to run on plain Node 24: that is why rule 21 forbids
`crypto.subtle.timingSafeEqual` (verified `undefined` on `node v24.12.0`) and `node:crypto` in `src/lib/auth/**`.
No test in this list needs a binding, a DOM or a fake timer; time is always an explicit `nowMs` (16 §14).

Required unit cases — file → case → assertion:
- `session.test.ts`: `exp - iat === 31_536_000`; `token.length < 512` (r04 measured 217 B); tampered →
  `bad_signature`; expired → `expired`; tolerance: `exp = now-59s` ok, `now-61s` → `expired`; garbage → `malformed`;
  `""`/`undefined` → `missing`. **Key derivation, locked two ways:** `sessionKeyFromSecret` returns exactly
  `base64urlDecode(secret)` (32-byte and 48-byte secrets pass; a 31-byte-decoding secret and a non-base64url string both
  throw `SessionSecretError`), and one **golden vector** asserts that
  `issueSessionToken(<the base64url secret in tests/vectors/session-token.json>, 1, 1_757_000_000_000)` is byte-equal to
  the token string in that same file. The vector is generated once by the implementation and reviewed; its whole purpose
  is that changing the encoding — text-bytes vs decoded-bytes, header order, anything — fails loudly here instead of
  turning every live cookie into `bad_signature` months later. Regenerating it requires editing this spec.
- `cookie.test.ts`: with an `https` `APP_ORIGIN` the session `Set-Cookie` matches
  `/^__Host-fa_session=[^;]+; Path=\/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax$/` — exact, because
  `maxAgeSeconds` is a passed constant and never recomputed from `expEpochMs` (a derived value yields `31535999` the
  moment a millisecond elapses, and this is the attribute whose absence bricks the app in a gym); with
  `http://localhost:8787` (the value `.dev.vars` supplies — cross-spec request 2) the name is `fa_session` and `Secure`
  is absent; ***every emitted Set-Cookie contains `Max-Age=`*** (r04 §4 gotcha 1); clear emits `Max-Age=0` on both; the
  meta cookie is not `HttpOnly` and its value parses as an integer epoch-ms.
- `password.test.ts`: round-trip true; wrong password false; a record stored at 100 000 iterations still verifies
  (iterations honoured, not assumed); encode/decode round-trips and `decode` throws on a malformed string;
  `constantTimeEqualUtf8("","")` → **false**; `("a","ab")` → false with no throw;
  `constantTimeEqualBytes(new Uint8Array(0), new Uint8Array(0))` → true (the bytes primitive has no emptiness rule; the
  UTF-8 wrapper is where "empty means deny" lives).
- `totp.test.ts`: the RFC 6238 Appendix B SHA-1 vectors, secret ASCII `12345678901234567890`. **Appendix B publishes
  8-digit values** while this spec pins `TOTP_DIGITS = 6`, which is exactly the trap that makes a hand-written oracle
  fail with no clue why — so the file has two case sets. (a) *Unmodified vector*, `digits: 8`, asserting the published
  value; (b) *our configuration*, `digits: 6`, asserting **the low six digits of that same value**. Both sets read `tests/vectors/rfc6238.json`, which carries the table below with a `source` field per row. Verified
  against `rfc-editor.org/rfc/rfc6238.txt` Appendix B on 2026-09-12:

  | T (s) | Appendix B SHA-1 value (8 digits) | expected at `TOTP_DIGITS = 6` |
  |---|---|---|
  | 59 | `94287082` | `287082` |
  | 1111111109 | `07081804` | `081804` |
  | 1111111111 | `14050471` | `050471` |
  | 1234567890 | `89005924` | `005924` |
  | 2000000000 | `69279037` | `279037` |

  Plus: `TOTP_WINDOW = 1` accepts `now ± 30 s` and rejects `now ± 90 s`; at `now + 120 s` (delta 4, inside
  `TOTP_SKEW_PROBE_STEPS`) `valid === false` **and** `clockSkewSuspected === true`; at `now + 600 s` (delta 20, past the
  probe) `valid === false` and `clockSkewSuspected === false`.
- `recovery.test.ts`: `normalizeRecoveryCode("abcd efgh-jklm") === "ABCDEFGHJKLM"`; 8 distinct codes, 8 distinct
  salts, no character outside `RECOVERY_CODE_ALPHABET`. `consumeRecoveryCode` **always** evaluates every unrevoked row:
  with a spy on `verifyPassword`, a code matching the first record still produces 8 calls (rule 25's timing property).
- `public-paths.test.ts`: a table test over **every** row of rule 8 asserting a non-null reason, and over `/`,
  `/workouts`, `/workouts/new`, `/api/workouts`, `/api/ai/food`, `/api/export`, `/api/sync/batch` asserting `null`. This
  is the test that keeps the PWA installable.
- `proxy-matcher.test.ts`: compile each `PROXY_MATCHER` entry to a `RegExp` (the same way Next does) and assert
  **no-match** for `/sw.js`, `/manifest.webmanifest`, `/_next/static/chunk.js`, `/_next/image/x`, `/favicon.ico`,
  `/icons/icon-192.png`, `/~offline`, `/login`, `/login/recover`, `/api/auth/login`, `/api/health`,
  `/api/telegram/webhook/abc`, `/api/cron/nightly-rollup`, `/api/workouts`; and **match** for `/`, `/workouts`,
  `/workouts/new`, `/body`, `/nutrition/camera`, `/settings/data`. Rule 9 is the derivation rule; this file is the proof.
- `machine-auth.test.ts`: correct → true; one character different → false; wrong length → false; header absent →
  false; **expected `""` → false**; the same five for `verifyCronSecret`.
- `origin.test.ts`: `Origin` matching → `{ok:true, via:"origin"}`; mismatched → `{ok:false,reason:"mismatch"}` (and still
  mismatched when `sec-fetch-site: same-origin` is also present); both headers absent → `{ok:false,reason:"absent"}`;
  **`Origin` absent + `sec-fetch-site: same-origin` → `{ok:true, via:"sec-fetch-site"}`** (the SW-replay case, rule 24);
  `Origin: null` + `sec-fetch-site: same-origin` → pass; `Origin: null` alone → fail; `sec-fetch-site: cross-site` with
  no `Origin` → fail; GET and HEAD always pass; and `assertSameOrigin` throws `AppError("forbidden")` for every failing
  row. Cover `POST /api/auth/logout` and `POST /api/auth/recover` explicitly, since those are public paths that are
  nonetheless origin-checked.
- `auth-throttle.test.ts`: keyed rows — a failure on `ip:1.2.3.4` leaves `ip:5.6.7.8` unlocked; 4 failures → not locked;
  5 → `{locked:true, hard:true, retryAfterSeconds:60, scope:"ip"}`; **failure 6 after the 60 s lock expires re-locks
  60 s**; 10 → 900 s and every failure past 10 → 900 s (there is no 86 400 rung); decay — a failure at `t`, then
  `checkLockout` at `t + THROTTLE_RESET_SECONDS + 1` followed by one failure, leaves `consecutive_failures === 1`;
  `clearLockout` resets both the ip row and `global`; the global row at 100 failures returns
  `{locked:true, hard:false, scope:"global"}`, and `handleLogin` (the `src/server/handlers` function, called
  directly per specs/16 §Pyramid 7) under a soft lock still reaches `verifyPassword` (spy) and returns 200 for correct
  credentials — **the owner-can-always-get-in property, rule 23**.
- `next-param.test.ts`: `/workouts` → `/workouts`; `//evil.com` → `/`; `https://evil.com/x` → `/`; `/a?b=c#d` kept.

`docs/research/r09-formulas-and-test-vectors.md` holds **no auth vectors** (it covers e1RM, Navy BF, EMA, adaptive
TDEE and plate math), so nothing here invents a numeric oracle: TOTP uses RFC 6238 Appendix B, and PBKDF2-SHA256 is
verified by round-trip only.

HTTP matrix — `npm run preview`, then `O` = the origin wrangler prints (and the same value `.dev.vars` gives
`APP_ORIGIN`, or every mutation below 403s instead of doing what it says — rule 6). **Split by phase, because half of
these routes do not exist when this spec is implemented:** group A runs at Phase 1 against only 01/04/05 code; group B is
re-run at the phase that ships each route. `P` is the protected probe path: **`/` at Phase 1** (the app shell exists and
is still static then) and **`/workouts` from Phase 2 on**, once specs/12 makes `/` `force-dynamic` and specs/06 ships
`/workouts` as a static shell. Never `/dashboard` — no spec defines that path; specs/12 line 38 puts the dashboard at
`(app)/page.tsx`, i.e. `/`.

```bash
# ---- Group A: runnable at Phase 1 ----
O=http://localhost:8787 ; P=/            # P=/workouts from Phase 2 on
curl -si $O/manifest.webmanifest | head -1   # PASS 200, and no Location header anywhere in it
curl -si $O/sw.js          | head -1         # PASS 200
curl -si $O/~offline       | head -1         # PASS 200
curl -si $O/login          | head -1         # PASS 200
curl -si $O/login/recover  | head -1         # PASS 200
curl -si $O/api/health     | head -1         # PASS 200
curl -si -H 'sec-fetch-mode: navigate' -H 'accept: text/html' $O$P | grep -i '^location'
                                             # PASS location: /login?next=%2F        (relative! /workouts -> %2Fworkouts)
curl -si -H 'sec-fetch-mode: cors' -H 'accept: */*' $O$P | head -1
                                             # PASS 200 — the precache fetch; must NOT 302 or 401. THE anti-poisoning check.
curl -si -X POST $O/api/telegram/webhook/definitely-not-the-slug | head -1              # PASS 404 (no such route)
curl -si -X POST $O/api/cron/weekly-review -H 'x-cron-secret: wrong' | head -1          # PASS 404 (01 rule 26)
curl -si -X POST $O/api/auth/login -H 'content-type: application/json' \
  -H 'origin: https://evil.example' -d '{}' | head -1              # PASS 403 (Origin rejected; NOT counted as a failure)
curl -si -X POST $O/api/auth/logout -H 'origin: https://evil.example' | head -1         # PASS 403 — rule 24 covers
curl -si -X POST $O/api/auth/recover -H 'origin: https://evil.example' -d '{}' | head -1 # PASS 403   public paths too
curl -si -X POST $O/api/auth/login -H 'content-type: application/json' -H "origin: $O" \
  -d '{"password":"wrongwrongwrong","totp":"000000"}' | head -1    # PASS 401, message "Invalid credentials"

# The two 429s are DIFFERENT mechanisms and are asserted separately, in this order.
# (1) the D1 lockout: failure 1 above + 4 more => the 5th rung. Body carries details.retryAfterSeconds.
for i in 1 2 3 4; do curl -s -o /dev/null -w '%{http_code} ' -X POST $O/api/auth/login \
  -H 'content-type: application/json' -H "origin: $O" \
  -d '{"password":"wrongwrongwrong","totp":"000000"}'; done; echo   # PASS 401 401 401 401
curl -s -X POST $O/api/auth/login -H 'content-type: application/json' -H "origin: $O" \
  -d '{"password":"wrongwrongwrong","totp":"000000"}' | grep -o '"retryAfterSeconds":60'   # PASS: prints the match
# (2) the per-colo limiter, reachable ONLY with the lockout cleared between batches (otherwise every
#     response from the 6th on is a lockout 429 and the assertion proves nothing).
wrangler d1 execute DB --local --command \
  "update auth_throttle set consecutive_failures = 0, locked_until_ms = null"
for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' -X POST $O/api/auth/login \
  -H 'content-type: application/json' -H "origin: $O" -d '{}' \
  ; wrangler d1 execute DB --local --command \
    "update auth_throttle set consecutive_failures = 0, locked_until_ms = null" >/dev/null; done; echo
                                             # PASS a 429 WITHOUT details.retryAfterSeconds appears by the 11th
# Leave the box usable for every later step and for Playwright:
wrangler d1 execute DB --local --command \
  "update auth_throttle set consecutive_failures = 0, locked_until_ms = null"   # PASS: mandatory reset

# ---- Group B: re-run when the route lands ----
# Phase 2 (specs/06):
curl -si $O/api/workouts | head -1                               # PASS 401
curl -s  $O/api/workouts | grep -o '"code":"unauthenticated"'    # PASS: prints the match
# Phase 8 (specs/14), with the real committed slug from src/app/api/telegram/webhook/<slug>/route.ts:
curl -si -X POST $O/api/telegram/webhook/$SLUG \
  -H 'x-telegram-bot-api-secret-token: wrong' | head -1          # PASS 401 (visible in getWebhookInfo)
```

Structural checks:

```bash
test ! -f middleware.ts && test ! -f src/middleware.ts && echo PASS   # inert on Next 16 if present
test -f src/proxy.ts && echo PASS                        # next to src/app, not the repo root
grep -rEl 'SESSION_SECRET|CRON_SECRET|TELEGRAM_WEBHOOK_SECRET' .open-next/assets && echo FAIL || echo PASS
grep -rn 'runtime = "edge"' src && echo FAIL || echo PASS
# (a) no auth or binding access in an app-group route that must stay prerendered -- *.tsx, so a child
#     layout.tsx is covered, and the dashboard is the one allowed exception (rule 11).
grep -rn 'requireSession\|force-dynamic' 'src/app/(app)' --include='*.tsx' \
  | grep -v '^src/app/(app)/page.tsx:' && echo FAIL || echo PASS
# (b) ...and the exception must actually be gated.
grep -q 'requireSession' 'src/app/(app)/page.tsx' && echo PASS || echo FAIL
grep -rn 'crypto.subtle.timingSafeEqual\|node:crypto' src/lib/auth && echo FAIL || echo PASS  # rule 21
test -f .next/server/app/login.html && echo PASS         # /login stays prerendered => precacheable
test -f .next/server/app/index.html && echo PASS         # Phase 1 only: `/` is static until specs/12 lands
test -f .next/server/app/workouts.html && echo PASS      # Phase 2 on: the protected probe stays prerendered
wrangler d1 execute DB --local --command "select session_version from settings"  # PASS one row, int >= 1
```

`wrangler d1 execute` takes the **binding** `DB` as well as the database name (verified in wrangler 4.131.1:
`nameOrBinding === d1Database.database_name || nameOrBinding === d1Database.binding`), so these lines keep working
whatever the database is called; the deployed name today is `fitness-pwa-db` (`wrangler.jsonc`, specs/02 line 475), not
specs/01's stale `fitness-db`.

Playwright (`npx playwright test tests/e2e/auth.spec.ts`) — PASS = all green. `P` is the same probe path as the HTTP
matrix (`/` at Phase 1, `/workouts` from Phase 2):
1. *unauthenticated cold start* — goto `/workouts`; the URL becomes `/login?next=%2Fworkouts` (at Phase 1, goto `/` →
   `/login?next=%2F`).
2. *year-long cookie* — after a valid login the session cookie exists, `httpOnly === true`, `expires` > 300 days out.
3. *offline cold start* — `context.setOffline(true)`, reload: the shell renders, one set logs, and it is still there
   after a second offline reload.
4. *stale session loses nothing* — log 3 sets offline; revoke by doing **both** halves, because raw SQL does not touch
   the cache (rule 15): `wrangler d1 execute DB --local --command "update settings set session_version =
   session_version + 1"` **and** `wrangler kv key delete --binding CACHE_KV auth:session_version --local`. Then go
   online: the re-auth **sheet** appears (never a navigation — `outboxCount > 0`, rule 13), the banner says 3 changes
   waiting, no `/api` mutation succeeded, and after re-login all 3 rows exist in D1 exactly once. Without the KV delete
   this case is flaky by construction for up to 60 s.
5. *the SW's replay is not CSRF* — with the SW controlling the page, queue one mutation offline, go online, and assert
   the queued op reaches `POST /api/sync/batch` with a **2xx** and that no request in `page.on("response")` returned 403.
   This is the only case that can catch rule 24's UNVERIFIED header behaviour; case 4 cannot, because it asserts success
   only *after* a re-login.
6. *logout everywhere revokes the OTHER device* — open two contexts, log in in both. From context A call
   `POST /api/auth/logout?everywhere=1`. Assert context B's `GET /api/auth/session` → **401** within 65 s (poll; the KV
   TTL is 60 s — rule 15). Asserting it in context A would pass on the cookie clear alone and prove nothing about
   `session_version`.
7. *the owner is never locked out* — set the global row locked: `wrangler d1 execute DB --local --command "insert into
   auth_throttle (id, consecutive_failures, locked_until_ms, updated_at) values ('global', 100, <now+900000>, <now>) on
   conflict(id) do update set consecutive_failures = 100, locked_until_ms = <now+900000>"`, then log in with **correct**
   credentials → `200`, and afterwards both rows read `consecutive_failures = 0, locked_until_ms = null`. Rule 23's
   central promise; without it the app ships a remote DoS on its only user.
8. *three wrong codes leave the form usable* — submit a wrong TOTP three times: the form is still interactive, submit is
   enabled, no `429`, and after the first failure typing a 6th digit does **not** auto-submit (rule §UX auto-submit).
9. *`@no-proxy`* — with `src/proxy.ts` renamed away and rebuilt, goto `/workouts`: the shell renders and `SessionGate`
   still lands on `/login`. At Phase 2+, also goto `/`: the dashboard's own `requireSession()` refuses to render data
   (redirect or 401 boundary, never user rows).

## Open questions

**Questions 1–3 are decisions, not research**: each already has a recommendation this spec implements, and all three must
be written into `docs/DECISIONS.md` (§Purpose) before implementation starts. Questions 4–6 are open facts.

1. **Mandatory TOTP?** (a) Keep it — what this spec implements; public internet, a one-year cookie, the seed in the
   synced vault plus 8 paper recovery codes. (b) Drop it: password + lockout only, one fewer thing to lose, gym login
   ~4 s faster. **Recommendation (a)**; switching to (b) is deleting one field from `LoginBody` and one call in the
   login route.
2. **`Max-Age` = 1 year?** (a) `31_536_000` — what this spec implements; never a forced re-login where there is no
   signal. (b) 90 days: a smaller stolen-cookie window, at the cost of a forced re-login roughly quarterly and
   possibly offline. **Recommendation (a)** — rule 15 means the app still opens and logs after expiry, only syncing
   blocks, and revocation is one command away.
3. **When do passkeys land?** (a) Phase 5+ as an extra `auth_credentials` row minting the same cookie
   (`@simplewebauthn/server@14.0.1`, verified on workerd — r04 §2.5), with password+TOTP staying as the fallback.
   (b) Never. **Recommendation (a)** — it is the only change that makes the daily unlock pleasant (Face ID), and it is
   purely additive because `issueSessionToken` is the seam.
4. **UNVERIFIED: does a service-worker-initiated same-origin `POST` carry `Origin`?** The Fetch standard's "append a
   request `Origin` header" step appends the serialised origin to every non-GET/HEAD request, but serialises it as `null`
   under a `no-referrer` referrer policy, and the algorithm text could not be retrieved from
   `fetch.spec.whatwg.org` in this session (the page's own summary did not return that section), so nothing here is
   asserted from memory. It does not block implementation — rule 24 is written to pass in all three worlds (`Origin`
   present, absent, or `null`) by accepting `Sec-Fetch-Site: same-origin` as a second proof — but the real behaviour
   should be recorded once Playwright case 5 runs against a deployed https Worker, and the losing branch of rule 24 can
   then be simplified. Do **not** tighten rule 24 to `Origin`-only before that evidence exists.
5. **Cross-spec: specs/05's CI assertion `test -f .next/server/app/index.html` stops holding at Phase 2.** 05 risk-table
   line 469 asserts both `~offline.html` and `index.html` exist as the canary for "a dynamic root layout killed the
   precache", but specs/12 line 38 deliberately makes `(app)/page.tsx` `force-dynamic`, so from that phase on there is no
   `index.html` and the canary fails for a legitimate reason. The structural checks above already switch the protected
   probe to `workouts.html`; **specs/05 needs the same edit** (canary on `~offline.html` + `login.html` + `workouts.html`),
   otherwise Phase 2 CI goes red on a correct build. Flagged here because this spec is where both constraints met; the
   fix belongs to 05.
6. **Does `wrangler dev` / `opennextjs-cloudflare preview` set `CF-Connecting-IP` locally?** Unverified. Rule 23 is
   written so it does not matter (`throttleKey` falls back to one shared `ip:unknown` bucket, which is strictly more
   limiting), and the per-IP unit tests pass keys explicitly. Worth confirming once, because a local `unknown` bucket
   means the HTTP matrix's lockout batch and Playwright case 7 share one row — which is why both reset it explicitly.
