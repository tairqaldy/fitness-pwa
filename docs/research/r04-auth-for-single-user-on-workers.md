# R04 — Auth for a single-user PWA on Cloudflare Workers

Research date: **2026-09-12**. Author: research session (specs/docs only, no app code written).

Overrides: [`docs/research/stack-facts.md`](./stack-facts.md) is authoritative over
[`specs/00-brief.md`](../../specs/00-brief.md). Nothing in this note contradicts stack-facts.
Every claim below is either verified by a primary source (quoted verbatim) or by a live
`wrangler dev` run against **workerd**, or is explicitly tagged `UNVERIFIED`.

---

## 1. Question

The brief (`specs/00-brief.md`, "User") says:

> Simple secure auth: passkey/WebAuthn OR magic link (Resend) OR Cloudflare Access in front.
> Pick the simplest secure option; record it in DECISIONS.md.

Choose the authentication approach for a **single-user**, installable, offline-first PWA on
Next.js 16 + `@opennextjs/cloudflare` + D1/R2/KV/Cron. Compare exactly four candidates:

- **(a)** Cloudflare Access / Zero Trust in front of the whole app
- **(b)** Passkey/WebAuthn via `@simplewebauthn/server`
- **(c)** Magic link via Resend + a signed HttpOnly session cookie
- **(d)** One long-lived signed cookie issued after a single password/TOTP check

Judge on: **minutes to implement**, **device-loss recovery**, **whether it blocks the
cron / Telegram-webhook / Web-Push paths**, and **whether the installed app still opens and
logs a workout with no network** — stating explicitly how the session survives offline.

---

## 2. Verified answer

### 2.0 How things were verified

Package versions came from the npm registry on 2026-09-12. Runtime behaviour was verified by
building throwaway Workers in the session scratchpad and running them under
`wrangler dev` (wrangler **4.131.1**, `compatibility_date` `2025-09-01`). Where a probe ran
**without** `nodejs_compat`, that is stated — it is a stronger result than needed, because
stack-facts already requires `nodejs_compat` for OpenNext.

Probe directories (scratchpad, not part of the project):

```
<scratchpad>/webauthn-probe   # @simplewebauthn/server 14.0.1 full ceremony on workerd
<scratchpad>/session-probe    # jose 6.2.12, iron-session 9.0.1, resend 6.28.0 on workerd
<scratchpad>/serwist-probe    # serwist 9.5.12 precache source inspection
<scratchpad>/totp-probe       # otpauth 9.5.2, PBKDF2, timingSafeEqual on workerd
```

### 2.1 Package versions (npm registry, 2026-09-12)

| Package | Latest | Published | Notes |
|---|---|---|---|
| `@simplewebauthn/server` | **14.0.1** | 2026-09-05 | `engines.node >= 20`; 10 deps, **zero** `node:` imports |
| `@simplewebauthn/browser` | **14.0.0** | 2026-09-02 | zero deps; note server is 14.0.**1**, browser 14.0.**0** |
| `jose` | **6.2.12** | 2026-09-05 | ships **only** `dist/webapi` — no Node build exists |
| `iron-session` | **9.0.1** | 2026-08-30 | `engines.node >= 22.13.0`; deps `cookie@^2.0.1`, `iron-webcrypto@^2.0.0` |
| `resend` | **6.28.0** | 2026-09-11 | `engines.node >= 20`; deps `postal-mime`, `standardwebhooks` |
| `otpauth` | **9.5.2** | 2026-09-03 | dep `@noble/hashes@2.4.0` |
| `cookie` | **2.0.1** | 2026-06-30 | `engines.node >= 22` |

`jose` 6's root export, read from its own `package.json`:

```json
{
  "version": "6.2.12",
  "type": "module",
  "main": "./dist/webapi/index.js",
  "exportsRoot": { "types": "./dist/types/index.d.ts", "default": "./dist/webapi/index.js" }
}
```

There is no `node` condition and no `dist/node` directory — `jose@6` is a single
WebCrypto-only build. This is why the Cloudflare Access docs' own Worker sample uses it.

### 2.2 Next.js 16: `middleware.ts` is now `proxy.ts`

Verified against the Next.js docs for version **16.3.5** (`lastUpdated: 2026-09-07`), which
matches the `next` version pinned in stack-facts:

> **Note**: The `middleware` file convention is deprecated and has been renamed to `proxy`.

> The file must export a single function, either as a default export or named `proxy`. Note
> that multiple proxy from the same file are not supported.

> Proxy defaults to using the Node.js runtime. The `runtime` config option is not available in
> Proxy files. Setting the `runtime` config option in Proxy will throw an error.

Version history table, verbatim:

| Version | Changes |
| --- | --- |
| `v16.0.0` | Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime |

Codemod, verbatim:

```bash
npx @next/codemod@canary middleware-to-proxy .
```

Two security-relevant statements from the same page, quoted verbatim because they decide
where our auth check must live:

> **Good to know:** [Server Functions](/docs/app/api-reference/directives/use-server) are not
> separate routes in this chain. They are handled as POST requests to the route where they are
> used, so a Proxy matcher that excludes a path will also skip Server Function calls on that
> path.
>
> A matcher change or a refactor that moves a Server Function to a different route can silently
> remove Proxy coverage. Always verify authentication and authorization inside each Server
> Function rather than relying on Proxy alone.

> Even when `_next/data` is excluded in a negative matcher pattern, proxy will still be invoked
> for `_next/data` routes. This is intentional behavior to prevent accidental security issues
> where you might protect a page but forget to protect the corresponding data route.

And without a matcher:

> Without a `matcher`, Proxy runs on **every request**, including static files (`_next/static`),
> image optimizations (`_next/image`), and assets in the `public/` folder.

### 2.3 `proxy.ts` on `@opennextjs/cloudflare` — supported since 1.20.3, but **experimental**

From `packages/cloudflare/CHANGELOG.md` on `main`, under the `## 1.20.3` heading
(PR [#1309](https://github.com/opennextjs/opennextjs-cloudflare/pull/1309)), verbatim:

```
- feature: support Node.js middleware (`proxy.ts`)

  Next.js 16 replaces `middleware.ts` with `proxy.ts` which always runs on the Node.js runtime.

  The Node.js middleware is now bundled into a Workers compatible `middleware/handler.mjs`:
  the OpenNext config manifests are inlined at build time (as for the edge middleware) and the
  middleware compiled by Next.js is statically bundled instead of being loaded from the
  filesystem at runtime (workerd can not access the filesystem nor load modules at runtime).

  The support is experimental and requires the `nodejs_compat` compatibility flag.
```

stack-facts pins `@opennextjs/cloudflare` **1.20.6** (> 1.20.3), so `proxy.ts` is supported.
`nodejs_compat` is already mandated by stack-facts. **But "experimental" plus the Next.js
Server-Function warning above means `proxy.ts` must not be our only security check.**

Also from the changelog (`## 1.20.3`, PR #1359) — a bug class specific to this combination:

> Next.js 16.3 registers the instrumentation hook from the middleware itself when the middleware
> […] workerd does not support dynamic requires so every request handled by the Node.js middleware
> (`proxy.ts`) failed with `Dynamic require of ".next/server/instrumentation.js" is not supported`.

Next.js version support, from the OpenNext Cloudflare docs:

> All minor and patch versions of Next.js 16 and the latest minors of Next.js 14 and 15 are supported.

### 2.4 Option (a) — Cloudflare Access / Zero Trust

#### Free tier

Cloudflare's own blog (Cloudflare One for small business):

> a new free plan which provides many of the features of Cloudflare One, including DNS filtering,
> Zero Trust access, and a management dashboard - for up to 50 users at no cost.

> Cloudflare's free plan includes up to 50 seats of Cloudflare Access at no cost so that your team
> can begin

So: **50 free seats**; we need 1. Cost is $0. The current docs pricing page does not restate the
number, so treat "50" as sourced from the Cloudflare blog rather than the reference docs.
Seat exhaustion behaviour, from the seat-management docs:

> Once the total amount of seats in the subscription has been consumed, additional users who
> attempt to log in are blocked.

#### How the app reads identity — the classic way (JWKS)

The cookie is `CF_Authorization`, but the docs tell you **not** to read it:

> We recommend validating the `Cf-Access-Jwt-Assertion` header instead of the `CF_Authorization`
> cookie, since the cookie is not guaranteed to be passed.

Cookie properties, from the authorization-cookie docs — note there are **two** cookies:

> JSON web token (JWT) set on the cloudflareaccess.com team domain that contains the user's
> identity and enables Access to perform single sign-on (SSO)

> JSON web token (JWT) set on the domain protected by Access that allows Access to confirm that
> the user has been authenticated and is authorized to reach the origin

The team-domain cookie is `HttpOnly: Yes`, `SameSite: None`. The application-domain cookie is
"Admin choice (Default: None)" for both `HttpOnly` and `SameSite`. And:

> If a request does not include the cookie, Access will block the request.

Keys come from `https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/certs`. The AUD tag
"will never change unless you delete or recreate the Access application."

The official Workers sample, quoted verbatim from the Cloudflare docs:

```js
import { jwtVerify, createRemoteJWKSet } from "jose";

export default {
	async fetch(request, env, ctx) {
		// Verify the POLICY_AUD environment variable is set
		if (!env.POLICY_AUD) {
			return new Response("Missing required audience", {
				status: 403,
				headers: { "Content-Type": "text/plain" },
			});
		}

		// Get the JWT from the request headers
		const token = request.headers.get("cf-access-jwt-assertion");

		// Check if token exists
		if (!token) {
			return new Response("Missing required CF Access JWT", {
				status: 403,
				headers: { "Content-Type": "text/plain" },
			});
		}

		try {
			// Create JWKS from your team domain
			const JWKS = createRemoteJWKSet(
				new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`),
			);

			// Verify the JWT
			const { payload } = await jwtVerify(token, JWKS, {
				issuer: env.TEAM_DOMAIN,
				audience: env.POLICY_AUD,
			});

			// Token is valid, proceed with your application logic
			return new Response(`Hello ${payload.email || "authenticated user"}!`, {
				headers: { "Content-Type": "text/plain" },
			});
		} catch (error) {
			// Token verification failed
			const message = error instanceof Error ? error.message : "Unknown error";
			return new Response(`Invalid token: ${message}`, {
				status: 403,
				headers: { "Content-Type": "text/plain" },
			});
		}
	},
};
```

#### How the app reads identity — the new way (`ctx.access`), and why it will NOT work for us

Shipped **2026-08-14** (Cloudflare changelog): Access can now be attached to a Worker itself
rather than to a hostname. Local testing config, verbatim:

```jsonc
{
	"access": {
		"dev": {
			"aud": "my-app",
			"identity": { "email": "admin@example.com" }
		}
	}
}
```

```js
const identity = await ctx.access.getIdentity();
return Response.json({ aud: ctx.access.aud, email: identity?.email });
```

> Every request is checked before your Worker runs.

But the limitations section, verbatim — and this is decisive for our stack:

> ctx.access applies only to the Worker invocation authenticated by Access. Cloudflare Access does
> not propagate ctx.access through Service Binding HTTP requests or remote procedure call (RPC)
> invocations.

> Workers with Static Assets execute behind an internal router Worker. Access still protects the
> application and its assets. However, the router does not pass ctx.access to the user Worker.

stack-facts requires `assets: { directory: ".open-next/assets", binding: "ASSETS" }` — OpenNext
**always** deploys as a Worker with Static Assets. Therefore `ctx.access` will be `undefined`
inside our Next.js worker and we would be back to manual `Cf-Access-Jwt-Assertion` + JWKS
verification anyway. The new ergonomic path is unavailable to us.

#### Session duration

From the Access session-management docs: durations range "from immediate timeout to one month";
the default application and global session durations are both **24 hours**; global sessions are
configurable "between 15 minutes and one month".

> By default, the policy session duration is equal to the application session duration.

> The user will be required to re-authenticate with the IdP after this period of time.

**So the maximum time between forced interactive re-logins is one month.**

#### (a1) Does Access break an installed PWA's service worker + offline shell?

Yes — and it does so *silently*, which is the worst failure mode. Mechanism, fully verified:

1. An unauthenticated request to an Access-protected hostname is redirected into the Access
   login flow (Access "honors all redirects"; the login lives on the cross-origin
   `<team>.cloudflareaccess.com` team domain).
2. Serwist's precache strategy accepts any non-4xx/5xx response **and explicitly copies
   redirected responses** so they become cacheable. From
   `serwist@9.5.12`, `node_modules/serwist/dist/chunks/printInstallDetails-ESDOoMBE.js`,
   lines 1517–1534, verbatim:

```js
var PrecacheStrategy = class PrecacheStrategy extends Strategy {
	_fallbackToNetwork;
	static defaultPrecacheCacheabilityPlugin = { async cacheWillUpdate({ response }) {
		if (!response || response.status >= 400) return null;
		return response;
	} };
	static copyRedirectedCacheableResponsesPlugin = { async cacheWillUpdate({ response }) {
		return response.redirected ? await copyResponse(response) : response;
	} };
	/**
	* @param options
	*/
	constructor(options = {}) {
		options.cacheName = cacheNames.getPrecacheName(options.cacheName);
		super(options);
		this._fallbackToNetwork = options.fallbackToNetwork !== false;
		this.plugins.push(PrecacheStrategy.copyRedirectedCacheableResponsesPlugin);
	}
```

   A 302 → 200 login page therefore does **not** raise `bad-precaching-response`
   (`"The precaching request for '${url}' failed${status ? ...}"`). It is copied, stripped of its
   `redirected` flag, and written into the precache **under our app-shell URL key**. The installed
   app then boots to a cached Cloudflare login page, offline, forever, until the cache is purged.

3. Fetch/XHR from the app to its own origin hits documented CORS breakage. From the Access
   troubleshooting docs, verbatim:

   > Cloudflare Access requires that the `credentials: same-origin` parameter be added to
   > JavaScript when using the Fetch API to include cookies.

   > Firefox's default tracking prevention in Private Windows may prevent the `CF_authorization`
   > cookie from being sent, especially for XHR requests.

   The Access CORS documentation additionally describes the SPA failure: because Access honors the
   redirect chain and the final redirect returns to the original domain, the browser sets the
   `Origin` header to `null`, so the XHR fails CORS unless all origins (or `null`) are allowed,
   and a manual page refresh is needed to recover.

4. The re-login navigation leaves our manifest `scope`. Per MDN:

   > When users navigate to pages outside the app's scope, they still broadly experience the
   > app-like interface; however, in these pages, browsers display additional UI elements like the
   > URL bar.

   > **Note:** The `scope` member doesn't prevent users from navigating to app pages outside of the
   > defined scope. Off-scope navigations are not blocked by browsers and are allowed to be opened
   > in a new top-level browsing context.

   So at least monthly, the gym-mode app pops a URL bar (or a new browsing context) and shows a
   Cloudflare login. We cannot control the status code or the styling.

**Net:** true airplane-mode opening still works if the shell was precached while authenticated
(no network means no edge, so Access never runs). The lethal case is **flaky gym network** —
which is the actual case — where Access answers with redirects our service worker treats as real
content.

#### (a2) Does Access break Web Push?

**No, delivery is unaffected.** The push subscription endpoint is not on our origin. Per MDN:

> The endpoint takes the form of a custom URL pointing to a push server, which can be used to send
> a push message to the particular service worker instance that subscribed to the push service.

Our Worker's outbound VAPID POST goes to the browser vendor's push service, not through our
Access-protected hostname, so Access is not in that path. Two second-order effects remain:
the client's `POST /api/push/subscribe` goes through Access (fine while authenticated, subject to
the CORS issue in (a1)); and a `push` handler that fetches our own origin to build the
notification body, or a `notificationclick` → `clients.openWindow()`, will hit the Access
redirect if the session has lapsed.

#### (a3) Does Access break the Telegram webhook?

**Yes, by default, and service tokens cannot fix it.** Telegram sends only one custom header.
From the Telegram Bot API `setWebhook` docs, verbatim:

> A secret token to be sent in a header "X-Telegram-Bot-Api-Secret-Token" in every webhook request,
> 1-256 characters.

> Only characters `A-Z`, `a-z`, `0-9`, `_` and `-` are allowed.

> Ports currently supported _for webhooks_: **443, 80, 88, 8443**.

Access service tokens require two specific headers that Telegram will never send:

```sh
curl -H "CF-Access-Client-Id: <CLIENT_ID>" -H "CF-Access-Client-Secret: <CLIENT_SECRET>" https://app.example.com
```

(`CF-Access-Client-Id` / `CF-Access-Client-Secret`.) So **Service Auth is not usable for the
Telegram path.** The only workaround is a second, path-scoped Access application over the webhook
route carrying a **Bypass** policy. Policy actions are Allow, Block, Bypass, Service Auth, and:

> The Bypass action in Cloudflare Access disables Access enforcement for specific traffic.

> Bypass does not enforce any Access security controls and requests are not logged.

Path precedence makes this work. From the app-paths docs, verbatim:

> When multiple rules are set for a common root path, the more specific rule takes precedence. For
> example, when setting rules for `dashboard.com/eng` and `dashboard.com/eng/exec` separately, the
> more specific rule for `dashboard.com/eng/exec` takes precedence, and no rule is inherited from
> `dashboard.com/eng`.

So: app #1 = `app.example.com` → Allow (me only); app #2 = `app.example.com/api/telegram/webhook`
→ Bypass Everyone, and we authenticate it ourselves with
`X-Telegram-Bot-Api-Secret-Token`. That works, but it means the webhook route needs
hand-written auth **anyway** — so Access is not actually "auth for the whole app".

#### (a4) Does Access break cron-triggered internal fetches?

**The `scheduled()` handler itself is not affected; a self-`fetch()` is.**

Cron Triggers invoke a handler, not an HTTP route:

> To respond to a Cron Trigger, you must add a "scheduled" handler to your Worker.

The Access docs frame all enforcement around *requests* ("Every request is checked before your
Worker runs"), and a Cron invocation is not an HTTP request arriving at the zone's front door.
`UNVERIFIED` by direct test — I could not deploy a real Access-protected Worker from this
session — but both primary sources point the same way.

The real hazard is the compatibility flag stack-facts already mandates. From the Workers
compatibility-flags docs, verbatim:

> When the `global_fetch_strictly_public` compatibility flag is enabled, the global
> [fetch() function](https://developers.cloudflare.com/workers/runtime-apis/fetch/) will strictly
> route requests as if they were made on the public Internet.
>
> This means requests to a Worker's own zone will loop back to the "front door" of Cloudflare and
> will be treated like a request from the Internet, possibly even looping back to the same Worker
> again.

So `fetch("https://app.example.com/api/cron/weekly-report")` from inside `scheduled()` **leaves and
re-enters through the edge**, where Access intercepts it and returns a login redirect instead of
running our job. The weekly Telegram report (Phase 8 DoD) would silently stop firing and the
`scheduled()` handler would report success.

Fix: never self-fetch. Call the job function directly from `scheduled()`. OpenNext's own recipe for
adding the handler, verbatim from the OpenNext Cloudflare docs:

```typescript
// @ts-ignore `.open-next/worker.ts` is generated at build time
import { default as handler } from "./.open-next/worker.js";
 
export default {
  fetch: handler.fetch,
 
  async scheduled(event) {
    // ...
  },
} satisfies ExportedHandler<CloudflareEnv>;
 
// The re-export is only required if your app uses the DO Queue and DO Tag Cache
// See https://opennext.js.org/cloudflare/caching for details
// @ts-ignore `.open-next/worker.ts` is generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
```

The `WORKER_SELF_REFERENCE` service binding is the other escape hatch: the Access docs state Access
"does not propagate ctx.access through Service Binding HTTP requests", which implies service-binding
invocations are not Access-authenticated at all. That service-binding requests **skip Access
enforcement** (rather than merely losing the identity object) is `UNVERIFIED`.

### 2.5 Option (b) — Passkey/WebAuthn via `@simplewebauthn/server`

#### Current major version: 14

`@simplewebauthn/server@14.0.1` (2026-09-05), `@simplewebauthn/browser@14.0.0` (2026-09-02).

#### Does it run on workerd? **Yes — verified, WebCrypto-only, and it does not even need `nodejs_compat`.**

Static evidence: a recursive grep for `node:` built-in imports across the **entire** installed
dependency tree (25 packages: `@peculiar/*`, `@hexagon/base64`, `@levischuck/tiny-cbor`,
`reflect-metadata`, `tsyringe`, `asn1js`, `pvtsutils`, `pvutils`, `tslib`) returned **zero hits**,
in both the ESM and the CJS (`script/`) builds. The only occurrences of `Buffer` anywhere are in
code comments.

Crypto access is `globalThis.crypto` only. From
`node_modules/@simplewebauthn/server/esm/helpers/iso/isoCrypto/getWebCrypto.js`, verbatim
(comments trimmed):

```js
let webCrypto = undefined;
export function getWebCrypto() {
    const toResolve = new Promise((resolve, reject) => {
        if (webCrypto) {
            return resolve(webCrypto);
        }
        /**
         * Naively attempt to access Crypto as a global object, which popular ESM-centric run-times
         * support (and Node v20+)
         */
        const _globalThisCrypto = _getWebCryptoInternals.stubThisGlobalThisCrypto();
        if (_globalThisCrypto) {
            webCrypto = _globalThisCrypto;
            return resolve(webCrypto);
        }
        // We tried to access it both in Node and globally, so bail out
        return reject(new MissingWebCrypto());
    });
    return toResolve;
}
...
export const _getWebCryptoInternals = {
    stubThisGlobalThisCrypto: () => globalThis.crypto,
```

Dynamic evidence: a probe Worker ran a **complete registration + authentication ceremony** on
workerd. `wrangler.jsonc` had **no `compatibility_flags` at all**:

```jsonc
{
  "name": "webauthn-probe",
  "main": "src/index.js",
  "compatibility_date": "2025-09-01"
}
```

The probe called `generateRegistrationOptions`, hand-built a structurally real `fmt: "none"`
attestation (CBOR via the library's own `isoCBOR`, a WebCrypto-generated P-256 key encoded as a
COSE key, `rpIdHash` via `crypto.subtle.digest`), verified it, then called
`generateAuthenticationOptions`, signed `authenticatorData || SHA256(clientDataJSON)` with
`crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"})`, DER-encoded the raw r‖s signature, and
verified the assertion. Response:

```json
{
  "globalThis.crypto.subtle present": true,
  "globalThis.Buffer present": "undefined",
  "generateRegistrationOptions": {
    "challengeLen": 32,
    "userID": "1Eu7eJFGqes_V9YOQIcLcwsEcp00Um7uxA7XwfWwm-I",
    "pubKeyCredParams": [-8, -7, -257]
  },
  "verifyRegistrationResponse": {
    "verified": true,
    "fmt": "none",
    "credentialID": "_Q10hzMbGtWExGcrn3ISGSbXFnU7TujROrtQp6hP6bw",
    "counter": 0,
    "credentialDeviceType": "multiDevice",
    "credentialBackedUp": true
  },
  "verifyAuthenticationResponse": { "verified": true, "newCounter": 0 }
}
```

Facts that fall out of this: challenges are **32 bytes**; default `pubKeyCredParams` are
`[-8, -7, -257]` (Ed25519, ES256, RS256); `Buffer` is genuinely absent and nothing needed it.

Client API in v14 takes a wrapper object (this changed from earlier majors — do not pass options
positionally). From `@simplewebauthn/browser@14.0.0`:

```ts
export declare function startRegistration(options: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
    useAutoRegister?: boolean;
}): Promise<RegistrationResponseJSON>;

export declare function startAuthentication(options: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
    useBrowserAutofill?: boolean;
    verifyBrowserAutofillInput?: boolean;
}): Promise<AuthenticationResponseJSON>;
```

#### Challenge storage — do **not** use KV

The challenge from `generateRegistrationOptions()` / `generateAuthenticationOptions()` must be
handed back to `verify*Response()` as `expectedChallenge`, so it has to survive one round trip.
KV is the wrong store. From the KV docs, verbatim:

> Changes may take up to 60 seconds or more to be visible in other global network locations as
> their cached versions of the data time out.

> At the Cloudflare global network location at which changes are made, these changes are usually
> immediately visible. However, this is not guaranteed and therefore it is not advised to rely on
> this behaviour.

> Negative lookups indicating that the key does not exist are also cached, so the same delay exists
> noticing a value is created as when a value is changed.

A WebAuthn ceremony completes in seconds. "Usually immediately visible… not guaranteed" means
intermittent, unreproducible login failures. Correct options, in order of preference:

1. **A short-lived signed cookie** holding the challenge (stateless; 120 s expiry; no store at all).
   Sidesteps consistency entirely and is the right answer for one user.
2. **D1**, which is read-after-write consistent as long as read replication stays off — it is
   opt-in: "Read replication can be enabled at the database level in the Cloudflare dashboard."
   If replication is ever enabled, the D1 Sessions API is required for "Read my own writes".

#### Device loss

Better than folklore suggests, *if* the passkey is synced. The probe shows the flags the server
reports: `credentialDeviceType: "multiDevice"` and `credentialBackedUp: true` are produced when the
authenticator sets the BE/BS flags — i.e. iCloud Keychain / Google Password Manager synced
passkeys. Those survive losing the phone. A device-bound credential (`singleDevice`,
`backedUp: false`) with only one credential enrolled = **permanent lockout**, recoverable only by
editing D1 by hand with `wrangler`. Mitigation is to enroll ≥2 credentials and to record and act on
`credentialBackedUp` at registration time.

#### Offline

The ceremony needs the network. Once done, you hold a session cookie, which is the part that works
offline — see §2.8. If the cookie expires while you are offline, you cannot re-authenticate.

### 2.6 Option (c) — Magic link via Resend + signed cookie

`resend@6.28.0` was constructed successfully on workerd with no `nodejs_compat`
(`"resend constructed": true`, i.e. `typeof resend.emails.send === "function"`), and a grep for
`node:` imports across `resend`, `postal-mime` and `standardwebhooks` found none. The send options
are typed as `CreateEmailBaseOptions` with `from`, `to` ("For multiple addresses, send as an array
of strings. Max 50."), `subject`, `replyTo`, `headers`, `tags`, `attachments`.

The blocking cost is domain setup. From the Resend domains docs, verbatim:

> You must [add and verify at least one domain](/docs/add-a-domain) to send emails with Resend.

So: buy/point a domain, add DNS records, wait for verification, store `RESEND_API_KEY`, write a
token table + an email template + two routes. Everything Access gives for free in ten minutes.

The fatal UX detail for this app: re-login requires **receiving an email on the phone in the gym**.
Gym basements have no signal. This is the worst possible re-auth channel for the stated use case.

Recovery from device loss is excellent (email is inherently a recovery channel), and it blocks
nothing — cron, webhook and push are untouched, because auth is just a cookie on app routes.

### 2.7 Option (d) — one long-lived signed cookie after a single password/TOTP check

All primitives verified on workerd.

**`jose@6.2.12` — HS256 session cookie.** Probe output:

```json
{
  "Buffer global": "undefined",
  "jose HS256": { "alg": "HS256", "sub": "tair", "exp": 1820757139, "tokenBytes": 217 },
  "jose tamper rejected": "JWSSignatureVerificationFailed",
  "jose expiry enforced": "JWTExpired"
}
```

A full year-long session token is **217 bytes** — trivial cookie weight. Tampering raises
`JWSSignatureVerificationFailed`; expiry raises `JWTExpired`.

**`iron-session@9.0.1` — the alternative (encrypted seal).** Also verified on workerd:

```json
{
  "iron-session sealData": {
    "sealBytes": 286,
    "sealPrefix": "Fe26.2*1*a31",
    "unsealed": { "userId": 1, "loggedInAt": 1789221139523 }
  },
  "iron-session webCookies Set-Cookie": "fa_session=Fe26.2*1*452e90685764f0763029744a73233d66f83c59df17eebc0a2d9e6f63ba06833f*UnJqb...",
  "iron-session round-trip userId": 1
}
```

v9 ships Workers-native adapters — `webCookies(request, response|Headers)` and
`nextProxyCookies(request, response)`, the latter documented in its own types as being for
"Next.js `proxy.ts` (called `middleware.ts` before Next 16)". Two facts from its types worth
recording, verbatim:

> The time (in seconds) that the session will be valid for. Also sets the `max-age` attribute of
> the cookie automatically (`= ttl - 60s`, so that the cookie always expire before the session).
>
> `ttl = 0` means no expiration. Do not use it for authentication: the seal is then accepted
> forever and there is no way to revoke it.

(default `ttl` is `1209600` = 14 days). And a caution on why raw `set-cookie` in proxy fails:

> Writing a raw `set-cookie` header here does not work the way you would expect: Next only merges a
> cookie into the current render when it goes through `response.cookies.set()`, so `session.save()`
> in middleware appeared to succeed and then vanished.

**`otpauth@9.5.2` — TOTP.** Verified twice. Without `nodejs_compat` (resolving to the `default`
export, `otpauth.esm.js`):

```json
{ "totp": { "code": "522536", "validateDelta": 0, "wrongTokenDelta": null, "secretBase32Len": 32 } }
```

And with `nodejs_compat`, both the WebCrypto and the `node:crypto` builds work:

```json
{
  "otpauth/slim": { "code": "367210", "delta": 0 },
  "otpauth.node.mjs (node:crypto build)": { "code": "178815", "delta": 0 }
}
```

This matters because `otpauth`'s `exports` map has a `"node"` condition pointing at
`./dist/otpauth.node.mjs`, which does `import * as crypto from 'node:crypto'`. Next.js server
bundling applies the `node` condition, so we will most likely get that build — and it works,
because `nodejs_compat` is already on. Importing `otpauth/slim` removes the ambiguity.

**Password hashing.** PBKDF2 and HKDF are available in workerd; **scrypt is not**:

```json
{
  "pbkdf2": { "iterations": 210000, "wallClockMs": 81, "digestBytes": 32 },
  "timingSafeEqualAvailable": true,
  "timingSafeEqual": { "samePassword": true, "wrongPassword": false },
  "kdfSupport": {
    "PBKDF2": true,
    "HKDF": true,
    "scrypt": "NotSupportedError: Unrecognized key import algorithm \"scrypt\" requested."
  }
}
```

PBKDF2-SHA256 at **210 000 iterations costs 81 ms** of wall clock on workerd — three orders of
magnitude inside the 5-minute-per-request CPU budget from stack-facts. Cloudflare's
`crypto.subtle.timingSafeEqual` extension exists and behaves correctly.

Device loss: you re-enter the password (from your password manager) plus a TOTP code on the new
device. Blocks nothing. Offline behaviour is the best of the four — see next.

### 2.8 The offline question, answered explicitly

**Requirement** (brief, Non-functional): "a full workout is loggable with no network and syncs
later". Phase 2 DoD: "a full session logs OFFLINE and syncs."

**How the session survives offline, mechanically:** it survives because *nothing checks it*. With
no network, the service worker answers navigations from the precache, the UI runs from the
precached bundle, and workout sets are written to IndexedDB via Dexie. No request reaches the
Worker, so no auth decision is made. The cookie sits in the browser's cookie jar and is simply
replayed later when connectivity returns and the background-sync queue drains — at which point the
server validates it for the first time.

The one thing that can break this is cookie lifetime, and the default is the trap. From MDN
`Set-Cookie`:

> If unspecified, the cookie becomes a **session cookie**. A session finishes when the client shuts
> down, after which the session cookie is removed.

An installed PWA gets killed by the OS constantly. A cookie without an explicit `Max-Age`
disappears, the next launch is unauthenticated, and **you cannot re-authenticate without a
network** — the app is bricked in the gym. So:

- Every option must issue an explicit, long `Max-Age`. Options (b), (c) and (d) all control this.
- Option **(a) does not**, because Access owns the cookie and caps re-authentication at **one month**.

Recommended attributes (MDN, verbatim, for the `__Host-` prefix):

> **`__Host-`**: Cookies with names starting with `__Host-` must be set with the `Secure` attribute
> by a secure page (HTTPS). In addition, they must not have a `Domain` attribute specified, and the
> `Path` attribute must be set to `/`. This guarantees that such cookies are only sent to the host
> that set them, and not to any other host on the domain. It also guarantees that they are set
> host-wide and cannot be overridden on any path on that host.

`SameSite=Lax` is the right value (MDN: sends the cookie for same-site requests and for cross-site
**top-level navigations using safe methods**), so a link or a push-notification click into the app
still arrives authenticated, while cross-site POSTs do not.

### 2.9 Scorecard

| | **(a) CF Access** | **(b) Passkey** | **(c) Magic link** | **(d) Long-lived cookie** |
|---|---|---|---|---|
| **Minutes to implement** | **~10** (dashboard only) — but +60 for the webhook Bypass app and +JWKS code if identity is needed | ~180–240 (2 tables, 4 routes, client hooks, challenge store) | ~120 + domain/DNS verification wait | **~45–60** |
| **App code required** | ~0, or the JWKS snippet | substantial | moderate | small |
| **Lose the device** | **Best.** IdP-based; log in on the new phone. Nothing stored on the device. | Good **if** synced (`credentialBackedUp: true`); **permanent lockout** if device-bound and only one credential | **Best.** Email is the recovery channel | Good. Password manager + TOTP seed; last resort is `wrangler d1 execute` |
| **Blocks cron?** | `scheduled()` no; **self-`fetch()` yes** (`global_fetch_strictly_public` loops through the front door) | no | no | no |
| **Blocks Telegram webhook?** | **Yes.** Service tokens impossible (2 headers vs Telegram's 1). Needs a path-scoped **Bypass** app, which is unlogged and needs hand-written auth anyway | no | no | no |
| **Blocks Web Push?** | Delivery no (endpoint is the vendor's push service). SW-side fetches to our origin yes, once the session lapses | no | no | no |
| **Opens + logs offline?** | Shell opens in true airplane mode, but **silently poisoned precache on flaky network** (Serwist copies the redirected login page under our shell key), forced cross-origin re-login ≤1 month, documented `null`-Origin CORS failures | **Yes** | **Yes**, but re-login needs email in the gym | **Yes**, best |
| **Max time between forced re-logins** | **1 month (hard cap)** | our choice | our choice | **our choice (1 year)** |
| **Cost** | $0 (50 free seats) | $0 | $0 (+ domain) | $0 |

---

## 3. Recommendation

> **Choose (d): one long-lived signed session cookie, issued after a single
> password + TOTP check.** Build it so that (b) passkeys can be added later as an *additional
> credential* without touching the session layer.

Reasoning, in the order the brief weights things:

1. **Offline-first is the app's identity.** Only (b), (c), (d) let us set our own `Max-Age`; (a)
   caps re-auth at one month and hands our service worker redirects it silently caches as content.
2. **Speed of logging above all.** (d) is the only option where the auth system is provably
   invisible after first login — no email round trip, no ceremony, no cross-origin popout.
3. **"Pick the simplest secure option."** (d) is ~45–60 minutes with two tiny, already-verified
   dependencies and zero new infrastructure. Every primitive it needs (HS256, PBKDF2, TOTP,
   `timingSafeEqual`) was executed on workerd in this session.
4. **It blocks nothing.** Cron, the Telegram webhook and Web Push are all untouched, because the
   session is just a cookie checked by app-level code we control per route.
5. **Passkeys stay open.** Because the session cookie is the boundary, adding
   `@simplewebauthn/server` later is purely additive: a `credentials` table plus two routes that
   mint the *same* cookie. Do it in a later phase as the everyday unlock (Face ID) with
   password+TOTP as the standing fallback.

Access is genuinely the fastest way to *secure* this app and has the best device-loss story. It is
the wrong fit only because the app is an installed, offline-first PWA with a Telegram webhook — the
two things Access is worst at.

### 3.1 Exact packages and versions to pin

```jsonc
{
  "dependencies": {
    "jose": "6.2.12",       // session cookie (HS256 JWS). Single webapi build, 0 deps. Verified on workerd.
    "otpauth": "9.5.2"      // TOTP. Import "otpauth/slim" to avoid the node: conditional export.
  }
}
```

That is the whole auth dependency footprint. Deliberately **not** included:

- `iron-session@9.0.1` — verified working, but its `.d.ts` imports `IncomingMessage`/`ServerResponse`
  from `node:http` (type-only, so it needs `@types/node` present to typecheck under `strict`), it
  adds two transitive deps, and we do not need an *encrypted* session for one boolean claim. Keep it
  on the bench; if we ever want cookie encryption or its `nextProxyCookies` adapter, it is a
  drop-in and was proven to work here.
- `bcrypt`/`argon2`/`scrypt` — scrypt is **not** available in workerd (verified
  `NotSupportedError`), and the native ones do not run on Workers. PBKDF2-SHA256 via WebCrypto is
  the correct Workers-native choice.

Phase-later additions for passkeys: `@simplewebauthn/server@14.0.1` +
`@simplewebauthn/browser@14.0.0`.

### 3.2 Route / proxy shape

```
proxy.ts                                  # Next 16 (was middleware.ts). UX redirect only — NOT the boundary.
src/lib/auth/
  session.ts                              # jose: issueSession(), readSession()
  require-session.ts                      # THE boundary. Called by every route handler, page, server action.
  password.ts                             # PBKDF2-SHA256 + crypto.subtle.timingSafeEqual
  totp.ts                                 # otpauth/slim
src/app/
  login/page.tsx                          # in-scope, same-origin, precacheable
  api/auth/login/route.ts                 # POST { password, totp } -> Set-Cookie
  api/auth/logout/route.ts                # clears cookie
  api/telegram/webhook/route.ts           # NOT session-gated: X-Telegram-Bot-Api-Secret-Token + timingSafeEqual
worker.ts                                 # custom OpenNext entry: { fetch, scheduled } (see §2.4 a4)
```

**Cookie contract**

| | |
|---|---|
| Name | `__Host-fa_session` |
| Value | compact HS256 JWS: `{ sub: "tair", v: <session_version>, iat, exp }` |
| Attributes | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000` |
| Secret | `SESSION_SECRET` (≥32 bytes) via `wrangler secret put` |
| Revocation | bump `session_version` in D1/KV; `require-session.ts` rejects a stale `v`. Only evaluated when a request actually reaches the Worker, so it never affects offline use. |

**`proxy.ts` — deliberately thin.** Its only job is to turn an unauthenticated *navigation* into a
same-origin `302 /login` so the PWA never leaves its manifest scope. It is **not** the security
boundary, for three verified reasons: OpenNext's `proxy.ts` support is "experimental"; Next's own
docs say a matcher that excludes a path "will also skip Server Function calls on that path" and
instruct you to "Always verify authentication and authorization inside each Server Function rather
than relying on Proxy alone"; and `_next/data` runs proxy regardless of the matcher.

```ts
// proxy.ts — shape only, not the security boundary
import { NextResponse, type NextRequest } from "next/server";

export const config = {
  matcher: [
    // exclude static output, the SW and manifest, the login page, and the Telegram webhook
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|login|api/auth|api/telegram).*)",
  ],
};

export async function proxy(request: NextRequest) {
  // read the cookie and verify the JWS with jose; on failure:
  //   - navigation (Accept: text/html)  -> NextResponse.redirect(new URL("/login", request.url))
  //   - anything else                   -> Response.json({ error: "unauthenticated" }, { status: 401 })
  // never emit a cross-origin redirect: that is the Access failure mode from §2.4 (a1)
  return NextResponse.next();
}
```

**`require-session.ts` — the actual boundary.** Every Route Handler, every Server Action and every
authenticated page calls it first and it throws/redirects on failure. This is what survives an
`experimental` adapter regression or a matcher typo.

**API routes must answer `401 JSON`, never `302 HTML`.** This is the single design choice that keeps
the Serwist precache clean: nothing the service worker fetches can ever come back as a 2xx HTML
login page, so the poisoning described in §2.4 (a1) is structurally impossible.

**Rate limiting** on `/api/auth/login` — the Workers native binding:

```jsonc
{
  "ratelimits": [
    { "name": "AUTH_LIMITER", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } }
  ]
}
```

```js
const { success } = await env.AUTH_LIMITER.limit({ key: pathname })
```

`period` "Must be either 10 or 60" seconds. Caveat, verbatim: "Rate limits that you define and
enforce in your Worker are local to the Cloudflare location that your Worker runs in." For one user
that is fine; it is not a global counter.

---

## 4. Gotchas that will silently break us

Ordered by how quietly they fail.

1. **A session cookie with no `Max-Age` bricks the installed app in the gym.** MDN: "If unspecified,
   the cookie becomes a session cookie. A session finishes when the client shuts down." The OS kills
   PWAs routinely; the next cold start is unauthenticated and **cannot re-authenticate offline**.
   Always set `Max-Age` explicitly. This is the #1 auth bug for this specific app.
2. **Serwist will happily precache an auth redirect as the app shell.** Verified in
   `serwist@9.5.12` source: `status >= 400` is the only rejection, and
   `copyRedirectedCacheableResponsesPlugin` *copies* redirected responses so they become cacheable.
   Any auth mechanism that answers a precache request with `302 → 200 HTML` poisons the offline
   shell with no error. Rule: **auth failures on non-navigation requests return `401`, never a
   redirect.**
3. **`global_fetch_strictly_public` + any edge-level auth = dead cron jobs.** Verbatim: "requests to
   a Worker's own zone will loop back to the 'front door' of Cloudflare". `scheduled()` self-fetching
   its own `/api/cron/...` route will be intercepted, and `scheduled()` still reports success. Call
   job functions directly.
4. **`proxy.ts` does not cover Server Actions.** Next 16 docs, verbatim: "a Proxy matcher that
   excludes a path will also skip Server Function calls on that path… Always verify authentication
   and authorization inside each Server Function rather than relying on Proxy alone." Every Server
   Action that touches D1 needs its own `requireSession()`.
5. **`proxy.ts` on OpenNext is experimental.** Changelog, verbatim: "The support is experimental and
   requires the `nodejs_compat` compatibility flag." Do not make it the only gate. Related regression
   already seen in the wild: `Dynamic require of ".next/server/instrumentation.js" is not supported`.
6. **`middleware.ts` silently does nothing on Next 16.** The convention is renamed; a leftover
   `middleware.ts` is simply not invoked, so an auth check living there evaporates on upgrade. Run
   `npx @next/codemod@canary middleware-to-proxy .`
7. **No `matcher` means proxy runs on `_next/static` and `public/`.** Next docs: "Consider using a
   negative match pattern to exclude these paths, otherwise auth logic or redirects can
   unintentionally block CSS, JS, or images from loading." A gated `sw.js` or
   `manifest.webmanifest` breaks installability.
8. **KV is the wrong store for WebAuthn challenges** (if/when we add passkeys). "usually immediately
   visible. However, this is not guaranteed" + 60 s negative-lookup caching = intermittent,
   unreproducible login failures. Use a short-lived signed cookie, or D1 with replication off.
9. **`otpauth` resolves to a `node:crypto` build under the `node` export condition** that Next.js
   server bundling uses. It works (verified) because `nodejs_compat` is mandatory for us — but if
   that flag were ever dropped, TOTP breaks at import time. Import `otpauth/slim` to be explicit.
10. **`scrypt` does not exist in workerd** (`NotSupportedError: Unrecognized key import algorithm
    "scrypt" requested`). Neither do `bcrypt`/`argon2` native bindings. PBKDF2-SHA256 only.
11. **`ctx.access` is `undefined` on OpenNext even with Access enabled.** Verbatim: "Workers with
    Static Assets execute behind an internal router Worker… the router does not pass ctx.access to
    the user Worker." If we ever do adopt Access, budget for the JWKS path, not the new easy API.
12. **Access service tokens cannot authenticate Telegram.** Telegram sends exactly one custom header
    (`X-Telegram-Bot-Api-Secret-Token`); Access Service Auth needs two (`CF-Access-Client-Id` +
    `CF-Access-Client-Secret`). A **Bypass** policy is the only route, and "Bypass does not enforce
    any Access security controls and requests are not logged."
13. **`iron-session`'s `session.save()` inside proxy silently vanishes if you write a raw
    `set-cookie`.** Its own docs: "Next only merges a cookie into the current render when it goes
    through `response.cookies.set()`". Use `nextProxyCookies(request, response)` if we ever adopt it.
14. **`iron-session` `ttl: 0` is a permanent, unrevocable seal** — "Do not use it for
    authentication". Tempting for an offline-first app; do not.
15. **Rate limiting is per-colo, not global** — "local to the Cloudflare location that your Worker
    runs in". Do not treat `AUTH_LIMITER` as a global brute-force ceiling.
16. **Read every AI/auth secret from `env`, never `process.env` at module scope** on Workers, and
    remember stack-facts: `export const runtime = "edge"` is unsupported — never use it.

---

## 5. Open decision for the owner

**Decision:** which authentication mechanism goes into `DECISIONS.md` for Phase 1?

- **Option A — Cloudflare Access in front of everything.** ~10 minutes of dashboard work, $0
  (50 free seats), zero app code, and the best device-loss story (nothing is stored on the phone).
  **Cost:** a forced cross-origin re-login at least every month that pops a URL bar out of gym mode;
  a documented `null`-Origin CORS failure class for our own XHRs; a Serwist precache that can
  silently cache Cloudflare's login page as our app shell; a Telegram webhook that needs a separate
  unlogged Bypass application *plus* hand-written header auth anyway; and `ctx.access` unavailable
  because OpenNext deploys with Static Assets.
- **Option B — one long-lived signed cookie after a password + TOTP check** (`jose@6.2.12` +
  `otpauth@9.5.2`). ~45–60 minutes, $0, no new infrastructure, one-year `Max-Age` so the installed
  app opens and logs a full workout offline indefinitely, and zero impact on cron, the Telegram
  webhook or Web Push. **Cost:** we own the code; if you lose both the password and the TOTP seed,
  recovery means editing D1 by hand with `wrangler`.

**Recommendation: Option B.** Then add passkeys (`@simplewebauthn/server@14.0.1`, verified working
on workerd) in a later phase as the everyday Face-ID unlock, keeping password+TOTP as the standing
fallback — this is purely additive because the session cookie is the boundary either way.

**Two sub-questions to confirm along with it:**

1. **Is TOTP worth the second factor?** For one user behind a long-lived cookie, a strong password
   plus rate limiting is defensible, and TOTP is a second thing to lose. If yes: the TOTP seed
   **must** live in a synced password manager, not only on the phone, or device loss becomes
   lockout.
2. **Session lifetime.** Recommending `Max-Age=31536000` (1 year). Anything shorter is a re-login
   risk in a place with no signal. Confirm you are comfortable with a one-year bearer cookie whose
   only revocation is bumping `session_version` server-side.

---

## 6. Sources

### Local files read

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

### Package sources read directly (installed in the session scratchpad)

- `@simplewebauthn/server@14.0.1` — `package.json`, `esm/index.d.ts`, `esm/helpers/index.d.ts`,
  `esm/helpers/iso/isoCrypto/getWebCrypto.js`, `esm/helpers/iso/isoCBOR.js`; recursive `node:`-import
  grep over the whole 25-package dependency tree
- `@simplewebauthn/browser@14.0.0` — `esm/methods/startRegistration.d.ts`,
  `esm/methods/startAuthentication.d.ts`
- `jose@6.2.12` — `package.json` (`exports`, `main`), `dist/` tree listing
- `iron-session@9.0.1` — `dist/index.d.ts` (full public API + doc comments), `dist/index.js` exports
- `resend@6.28.0` — `package.json`, `dist/index.d.mts` (`CreateEmailBaseOptions`)
- `otpauth@9.5.2` — `package.json` (`exports` conditions), `dist/otpauth.node.mjs`
- `serwist@9.5.12` — `dist/chunks/printInstallDetails-ESDOoMBE.js` lines 1517–1534
  (`PrecacheStrategy`), `dist/chunks/waitUntil-BDu76Zx7.js` (`bad-precaching-response` message)
- npm registry metadata for all of the above (`https://registry.npmjs.org/<pkg>`)
- `@opennextjs/cloudflare` CHANGELOG:
  <https://raw.githubusercontent.com/opennextjs/opennextjs-cloudflare/main/packages/cloudflare/CHANGELOG.md>

### Live runtime verification (`wrangler dev` 4.131.1, workerd)

- `<scratchpad>/webauthn-probe` — full WebAuthn registration + authentication ceremony, **no
  `compatibility_flags`**
- `<scratchpad>/session-probe` — `jose` HS256 sign/verify/tamper/expiry, `iron-session`
  seal/unseal/`webCookies` round trip, `resend` construction, **no `compatibility_flags`**
- `<scratchpad>/totp-probe` — `otpauth` TOTP (both builds), PBKDF2-SHA256 210k timing,
  `crypto.subtle.timingSafeEqual`, KDF algorithm support probe

### Cloudflare documentation

- Validating the Access JWT (Workers sample): <https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/>
- Access authorization cookie: <https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/>
- Access policies (Allow/Block/Bypass/Service Auth): <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/>
- Application paths & precedence: <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/>
- Service tokens: <https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/>
- Session management: <https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/>
- Access CORS settings: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/>
- Access troubleshooting (fetch `credentials`, Firefox tracking prevention): <https://developers.cloudflare.com/cloudflare-one/access-controls/troubleshooting/>
- Seat management: <https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/>
- **Cloudflare Access for Workers** (`ctx.access`, Static Assets limitation): <https://developers.cloudflare.com/workers/configuration/cloudflare-access/>
- Changelog, 2026-08-14 "enable Access on a Worker": <https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/>
- Compatibility flags (`global_fetch_strictly_public`): <https://developers.cloudflare.com/workers/configuration/compatibility-flags/>
- Cron Triggers (`scheduled` handler): <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Rate limiting binding: <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- Workers KV consistency: <https://developers.cloudflare.com/kv/concepts/how-kv-works/>
- D1 read replication / Sessions API: <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- Zero Trust free plan (50 users): <https://blog.cloudflare.com/zero-trust-week-setting-up-cloudflare-one-as-a-small-business/>

### Framework & platform documentation

- Next.js 16.3.5 `proxy.js` reference (rename, Node runtime, matcher, Server Functions warning, codemod): <https://nextjs.org/docs/app/api-reference/file-conventions/proxy>
- OpenNext Cloudflare overview (supported Next versions): <https://opennext.js.org/cloudflare>
- OpenNext Cloudflare custom worker (`scheduled` handler): <https://opennext.js.org/cloudflare/howtos/custom-worker>
- OpenNext Cloudflare issue #962 (Next 16 `proxy.ts`, closed): <https://github.com/opennextjs/opennextjs-cloudflare/issues/962>
- Telegram Bot API `setWebhook` (`secret_token`, header name, ports): <https://core.telegram.org/bots/api#setwebhook>
- MDN `Set-Cookie` (`__Host-` prefix, `SameSite=Lax`, session-cookie default): <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie>
- MDN web app manifest `scope` (off-scope navigation): <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope>
- MDN `PushSubscription.endpoint`: <https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/endpoint>
- Serwist / Workbox `bad-precaching-response` reports: <https://github.com/serwist/serwist/issues/229>, <https://github.com/GoogleChrome/workbox/issues/2879>

### Claims marked UNVERIFIED in this note

- That Cron Trigger (`scheduled()`) invocations are not subject to Cloudflare Access enforcement.
  Both primary sources point that way (Access enforces on *requests*; Cron invokes a handler) but I
  could not deploy a real Access-protected Worker to test it.
- That service-binding (`WORKER_SELF_REFERENCE`) requests **skip Access enforcement** rather than
  merely losing `ctx.access`. The docs only state that `ctx.access` is not propagated.
