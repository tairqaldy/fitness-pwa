# r06 — Notification delivery: Web Push (VAPID) + Telegram Bot API from Cloudflare Workers

Research date: **2026-09-12**. Authority order: [`docs/research/stack-facts.md`](./stack-facts.md) >
[`specs/00-brief.md`](../../specs/00-brief.md) > this note. Nothing here contradicts stack-facts;
§10.1 flags one place where this note **extends** a stack-facts rule (the `main` field) and why.

Every claim is either (a) empirically executed on `workerd` in this session, (b) quoted from a
primary source (RFC / vendor docs / MDN browser-compat-data / package source), or (c) explicitly
tagged `UNVERIFIED`.

---

## 1. Question

1. **Web Push (VAPID) from a Worker.** Does the `web-push` npm package run on `workerd` with
   `nodejs_compat`, or must we hand-roll VAPID JWT (ES256) + `aes128gcm` payload encryption on
   WebCrypto? Is there a Workers-native library? Give the working send path, VAPID key generation,
   D1 storage for the subscription, and 404/410 handling. State the hard iOS constraint and the
   Android/Chrome behaviour. Can a push drive the rest-timer countdown while the screen is locked —
   and if not, what actually works?
2. **Telegram Bot API from a Worker.** Sending a message with no library, setting the webhook,
   verifying it with the secret-token header, locking the bot to one chat id, MarkdownV2 escaping
   traps, and sending a photo/chart.
3. **Screen Wake Lock API** for GYM MODE: support, permission, release.

---

## 2. Test rig used for the empirical results

All "verified on workerd" results below come from a throwaway probe Worker run in this session:

```jsonc
// wrangler.jsonc used for the probe
{
  "name": "push-probe",
  "main": "worker.js",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"]
}
```

- `wrangler 4.131.1` (the version pinned in stack-facts), `npx wrangler dev` → local `workerd`.
- Packages installed and executed: `web-push@3.6.7`, `@block65/webcrypto-web-push@2.0.0`,
  `@pushforge/builder@2.0.5`.
- Scratchpad location (not in the project):
  `C:/Users/tairc/AppData/Local/Temp/claude/C--Users-tairc-Documents-codespace-fitness-app-tair/85fb1989-5a8f-448f-9e9a-162342b812b6/scratchpad/push`
- Real network calls were made to `https://fcm.googleapis.com/...` and
  `https://api.telegram.org/...` with deliberately invalid credentials, so the *transport* is
  proven end-to-end while nothing was actually delivered anywhere.

---

## 3. Verified answer — Web Push library choice

### 3.1 `web-push@3.6.7` DOES work on workerd with `nodejs_compat` (verified, with caveats)

This reverses the widely-repeated "web-push doesn't work on Workers" claim. Cloudflare's own docs
now ship a `web-push` example, and the package's full crypto + HTTP path executed for me.

Cloudflare's Agents guide states verbatim:

> "The `nodejs_compat` compatibility flag is required for the `web-push` library."

and installs it directly:

```bash
npm install agents web-push
```

**What I actually ran and got back.**

`webpush.generateVAPIDKeys()` inside the Worker:

```json
{"keys":{"publicKey":"BLcw0h_yovKMm39GZKWzXNIr_x33yuIWUM961SHj0-Kfn7tHMGBHPzX9bItTa3yTrZCliKvEo6P974NKmm5zGA0","privateKey":"zdlhmufife5NnSXUFvl72eh_GrHzPEq_B2lSRH1EdLE"},"ok":true}
```

`webpush.setVapidDetails(...)` + `webpush.generateRequestDetails(sub, payload)` inside the Worker:

```json
{"ok":true,"method":"POST",
 "endpoint":"https://fcm.googleapis.com/fcm/send/FAKE-ENDPOINT-TOKEN",
 "headers":{"TTL":2419200,"Content-Length":117,"Content-Type":"application/octet-stream",
            "Content-Encoding":"aes128gcm",
            "Authorization":"vapid t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL2ZjbS5nb29nbGVhcGlzLmNvbSIsImV4cCI6MTc4OTI2NDIwNSwic3ViIjoibWFpbHRvOnRAZXhhbXBsZS5jb20ifQ.Vz7bdmkvh8fRzdrfvZkpfCAOQ-PG8ZrY7j-M1kB2bPmA6tRhmGgjIIzgM0HB2hjx0BJQq5KMAfN4Qd5CJsco0Q, k=BMqk7knvjd3GLSPYApakTT5cvhDXgVmGgq4lURYJReBiFAkOYtUNfoMR8rZmqiQSSEZY0hKDcUl7pUyp0F5om9U",
            "Urgency":"normal"},
 "bodyLen":117,"bodyIsBuffer":true}
```

`webpush.sendNotification(...)` (a **real** HTTPS request out of workerd to FCM):

```json
{"ok":false,"name":"WebPushError","statusCode":410,
 "errBody":"push subscription has unsubscribed or expired.\n",
 "err":"WebPushError: Received unexpected response code\n    at IncomingMessage.<anonymous> ... at IncomingMessage.emit (node-internal:events:323:41) ..."}
```

So the ES256 VAPID JWT, the RFC 8291 `aes128gcm` encryption, and the outbound `node:https` request
all work. Note the stack frame `node-internal:events` — that is workerd's Node compat layer, i.e.
`web-push` is genuinely running through `nodejs_compat`, not being shimmed away.

`web-push`'s requires (read from `node_modules/web-push/src/*.js`):

| file | requires |
|---|---|
| `web-push-lib.js` | `url`, `https`, and **lazily at line 365** `https-proxy-agent` (only when a proxy is configured — so it never loads for us) |
| `encryption-helper.js` | `crypto`, `http_ece` |
| `vapid-helper.js` | `crypto`, `asn1.js`, `jws`, `url` |

Cloudflare's `node:crypto` page states verbatim:

> "All `node:crypto` APIs are fully supported in Workers with the following exceptions:"
> — `generateKeyPair`/`generateKeyPairSync` do not support DSA or DH key pairs; `argon2`/`argon2Sync`
> are not supported; `ed448`/`x448` curves are not supported; manual FIPS mode control is unavailable.

None of those exceptions touch web-push.

**The `node:https` caveat that will bite a wrong compatibility_date.** Cloudflare's `node:http`
page states that `http.get` / `http.request` "require the `enable_nodejs_http_modules`
compatibility flag in addition to `nodejs_compat`", and that this flag "is automatically enabled for
compatibility dates of `2025-08-15` or later". stack-facts only requires
`compatibility_date >= 2024-12-30` for OpenNext. **A date between 2024-12-30 and 2025-08-14 satisfies
stack-facts and silently breaks `web-push`'s send path.** See gotcha G1.

Cloudflare also notes: *"The implementation of `get` in Workers is a wrapper around the global fetch
API and is therefore subject to the same limits."*

### 3.2 `@block65/webcrypto-web-push@2.0.0` — also works, and is 15× smaller (verified)

Pure WebCrypto, one runtime dependency (`uint8array-extras`), no Node built-ins. Public API
(read from `dist/lib/*.d.ts`):

```ts
export type { PushMessage, PushSubscription } from './types.js';
export type { EncryptOptions } from './encrypt.js';
export { encryptNotification } from './encrypt.js';
export type { VapidKeys } from './vapid.js';
export { vapidHeaders } from './vapid.js';
export { buildPushPayload } from './payload.js';
```

```ts
export declare function buildPushPayload(
  message: PushMessage,
  subscription: PushSubscription,
  vapid: VapidKeys
): Promise<{
  headers: {
    authorization: string;
    ttl: string;
    urgency?: "high" | "low" | "normal";
    topic?: string;
    'content-encoding': string;
    'content-length': string;
    'content-type': string;
  };
  method: string;
  body: Uint8Array<ArrayBuffer>;
}>;

export type PushMessage<T extends Jsonifiable = Jsonifiable> = {
  data: T;
  options?: RequireAtLeastOne<{ ttl?: number; topic?: string; urgency?: 'low' | 'normal' | 'high' }>;
};

export type PushSubscription = {
  endpoint: string;
  /** DOMHighResTimeStamp */
  expirationTime: number | null;
  keys: { auth: string; p256dh: string };
};

export type VapidKeys = { subject: string | undefined; publicKey: string | undefined; privateKey: string | undefined };
```

`buildPushPayload` executed on workerd returned:

```json
{"ok":true,"method":"post",
 "headers":{"authorization":"vapid t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJpYXQiOjE3ODkyMjEwMDUsImF1ZCI6Imh0dHBzOi8vZmNtLmdvb2dsZWFwaXMuY29tIiwiZXhwIjoxNzg5MjY0MjA1LCJzdWIiOiJtYWlsdG86dEBleGFtcGxlLmNvbSJ9...., k=BMqk7knvjd3G...",
            "ttl":"60","topic":"t","content-encoding":"aes128gcm",
            "content-length":"4096","content-type":"application/octet-stream"},
 "bodyType":"[object Uint8Array]","bodyLen":4096}
```

and a real `fetch(SUB.endpoint, payload)` from workerd returned:

```json
{"ok":true,"status":410,"text":"push subscription has unsubscribed or expired.\n"}
```

Correct `aes128gcm`, correct RFC 8292 `vapid t=…, k=…` header, and — because *you* call `fetch` —
you get the raw `Response` and can branch on `res.status` directly, which is exactly what the
404/410 cleanup needs.

Implementation details read from source (they matter, see gotchas):

```js
// dist/lib/encrypt.js
const recordSize = 4096;
// RFC 8188 §2.1 header: salt, record size, key id length, key id
const headerSize = 21 + 65;
// a push service only has to accept 4096 octets in total, so the header shares
// the budget with the record. 17 is the padding delimiter plus the GCM tag
const maxPlaintextSize = recordSize - headerSize - 17;   // = 3993 bytes
...
const padTo = (options.pad ?? true) ? maxPlaintextSize : plaintext.byteLength;
```

```js
// dist/lib/vapid.js  — 12-hour JWT exp, signed per call, RFC 8292 §3.1 header
exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
...
authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
```

- `buildPushPayload` does **not** expose `EncryptOptions.pad`, so every message is padded to a
  4096-byte body. Your plaintext ceiling is **3993 bytes** and over that it throws
  `Payload is N bytes, the maximum is 3993`.
- `ttl` defaults to **60 s** (`(message.options?.ttl || 60)`), versus web-push's 2419200 s. Opposite
  defaults — see gotcha G7.
- `options` uses `RequireAtLeastOne`, so `options: {}` is a type error; pass at least one of
  `ttl` / `topic` / `urgency`.
- `urgency` is typed `'low' | 'normal' | 'high'` — RFC 8030's `very-low` is missing from the type.
- Keys are decoded with `uint8array-extras`' `base64ToUint8Array`, which calls
  `base64UrlToBase64()` first, so **base64url VAPID keys are accepted** (I read the source to check;
  this is not a bug). But `k=` is emitted as the *raw string you stored*, so store the key in
  base64url exactly as generated.

### 3.3 `@pushforge/builder@2.0.5` — REJECT. It emits the deprecated `aesgcm` encoding.

It runs fine on workerd (I executed it), but the headers it produces are the **draft-04 legacy
scheme**, not RFC 8291:

```json
{"ok":true,"endpoint":"https://fcm.googleapis.com/fcm/send/FAKE-ENDPOINT-TOKEN",
 "headers":{"authorization":"vapid t=…, k=…",
            "content-encoding":"aesgcm",
            "content-length":"46","content-type":"application/octet-stream",
            "crypto-key":"dh=BJw9ggNuH2I-zrFuhtFC2PjQFteNpO3QkLZvQQ_Y7qMC6hWIYWnRITSYBcYlGWXctDm5yg_tYsvb2tQ_sR65Q3w",
            "encryption":"salt=A8pKqeUVChkyMq65EquCUw","ttl":"60"},
 "bodyLen":46}
```

Hard-coded, not configurable:

```
dist/lib/payload.js:112:  new TextEncoder().encode('Content-Encoding: aesgcm\0'),
dist/lib/vapid.js:30:     Encryption: `salt=${base64UrlEncode(salt)}`,
dist/lib/vapid.js:31:     'Crypto-Key': `dh=${localPublicKeyBase64}`,
dist/lib/vapid.js:34:     'Content-Encoding': 'aesgcm',
```

Chrome and Firefox still accept `aesgcm` for backwards compatibility; **Apple's push service only
implements `aes128gcm`**. That means pushforge would work in dev on Android/desktop and fail
invisibly on the one device that matters. It also requires you to hand it a private **JWK**
(`privateJWK: JsonWebKey | string`) rather than the base64url VAPID private key, and it does not pad
the record. Do not use it.

`web-push-browser@1.4.2` was **not** tested — `UNVERIFIED`.

### 3.4 Bundle cost (verified: `wrangler deploy --dry-run --outdir`)

| Worker entry | Total Upload | gzip |
|---|---|---|
| `export default { fetch(){} }` only | 0.16 KiB | 0.14 KiB |
| `+ import webpush from 'web-push'` | **258.55 KiB** | **49.27 KiB** |
| `+ import { buildPushPayload } from '@block65/webcrypto-web-push'` | **11.10 KiB** | **3.34 KiB** |

Workers' script limit is generous (Cloudflare's limits page: "no compressed size limit. Only the
uncompressed bundle size counts", 64 MiB uncompressed on both plans), so this is not a hard
blocker — but 259 KiB of Node-crypto polyfill inside an OpenNext bundle for ~40 lines of ECDSA +
AES-GCM is a bad trade, and it inflates Worker cold-start parse time.

---

## 4. Verified answer — VAPID keys

### 4.1 Generate with the `web-push` CLI (one-off, on your laptop)

Executed locally just now:

```
$ npx web-push generate-vapid-keys

=======================================

Public Key:
BGfumHbCUK70ZwXOMgd-a6nZcmA0qglzbd9GXkDIhbzRhxfpxP-8Pf9w9Y9eIwm-bxr70HhVoRDn58bk2sHTA8o

Private Key:
IBHAfs7isTopOvCmHKc_YtmVaXYcaC-zwB-Yunp8PnA

=======================================
```

Shapes (verified by decoding): public key = **65 bytes**, uncompressed P-256 point, first byte
`0x04` (which is why every VAPID public key starts with `B`). Private key = **32 bytes**. Both
base64url, unpadded.

### 4.2 Or generate with WebCrypto only, no dependency (verified in Node 24 and round-tripped through `@block65`)

```js
const b64u = (u8) =>
  btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const kp  = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); // 65 bytes, 0x04-prefixed
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);

console.log("VAPID_PUBLIC_KEY  =", b64u(pub)); // -> BGwJd9UiMGT_1IAL77UN89d5u1WwEc8Xl_b7NjE7Jt_zUSAMSFZfB9a52OlD9E2tGWEfnHZj4ZqIhFW1d5jS1AI
console.log("VAPID_PRIVATE_KEY =", jwk.d);     // -> O8Ebo0ltneXGKUlaymkjV2GP3SFXRald6fbKYVPN8io
```

I fed those exact generated keys into `buildPushPayload` and it signed successfully
(`vapid t=eyJ0eXAiOiJKV1Qi… bodyLen 4096`). So the two generators are interchangeable.

### 4.3 Storage

```bash
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT          # "mailto:tairkaldybayev@gmail.com"
# public key is not a secret; it is shipped to the client. Put it in wrangler.jsonc "vars".
```

`VAPID_SUBJECT` must be a `mailto:` or `https:` URI (RFC 8292 `sub` claim). `UNVERIFIED`: the exact
error each push service returns for a malformed `sub` — I did not test with a bad subject.

**The VAPID key pair is permanent.** Rotating it invalidates every existing subscription (the
`applicationServerKey` is baked into the subscription by the browser at `subscribe()` time), and the
user must re-grant. Treat it like a signing key: generate once, back it up outside Cloudflare.

---

## 5. Verified answer — the working send path

### 5.1 D1 schema

Single user, so the natural key is the endpoint (one row per *device*, not per user).

```sql
-- drizzle/00XX_push_subscriptions.sql
CREATE TABLE push_subscriptions (
  id               TEXT    PRIMARY KEY,            -- crypto.randomUUID()
  endpoint         TEXT    NOT NULL UNIQUE,        -- push service URL; the real identity
  p256dh           TEXT    NOT NULL,               -- base64url, 65-byte uncompressed P-256 point
  auth             TEXT    NOT NULL,               -- base64url, 16 bytes
  expiration_time  INTEGER,                        -- subscription.expirationTime (ms) or NULL
  label            TEXT,                           -- "iPhone (home screen)", "desktop Chrome"
  platform         TEXT,                           -- 'ios' | 'android' | 'desktop' (best effort)
  created_at       INTEGER NOT NULL,
  last_ok_at       INTEGER,
  last_error_at    INTEGER,
  last_error_code  INTEGER,
  fail_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_created_at_idx ON push_subscriptions (created_at);
```

Upsert on `endpoint`, because the browser hands you the **same** endpoint on every
`subscribe()`/`getSubscription()` for an unchanged permission grant:

```sql
INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, expiration_time, label, platform, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
ON CONFLICT(endpoint) DO UPDATE SET
  p256dh = excluded.p256dh,
  auth = excluded.auth,
  expiration_time = excluded.expiration_time,
  fail_count = 0,
  last_error_at = NULL,
  last_error_code = NULL;
```

Do **not** store the raw `PushSubscription` JSON blob as a single column: you need `endpoint` as an
indexed unique column so 410 cleanup is a one-row `DELETE`.

### 5.2 Server send function (recommended: `@block65/webcrypto-web-push`)

```ts
// src/server/push/send.ts
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;            // where notificationclick should navigate
  tag?: string;            // coalescing key (no-op on iOS — see G11)
  requireInteraction?: boolean;
};

type Row = {
  id: string; endpoint: string; p256dh: string; auth: string; expiration_time: number | null;
};

export type SendResult = {
  sent: number;
  removed: string[];        // endpoints deleted (404/410)
  failed: { endpoint: string; status: number; body: string }[];
};

export async function sendWebPush(
  env: { DB: D1Database; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string },
  payload: PushPayload,
  opts: { ttl?: number; urgency?: "low" | "normal" | "high"; topic?: string } = {},
): Promise<SendResult> {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  const { results } = await env.DB
    .prepare(`SELECT id, endpoint, p256dh, auth, expiration_time FROM push_subscriptions`)
    .all<Row>();

  const out: SendResult = { sent: 0, removed: [], failed: [] };
  const data = JSON.stringify(payload);
  // hard ceiling: @block65 throws over 3993 bytes of plaintext
  if (new TextEncoder().encode(data).byteLength > 3993) {
    throw new Error("push payload exceeds 3993 bytes");
  }

  for (const row of results ?? []) {
    const subscription: PushSubscription = {
      endpoint: row.endpoint,
      expirationTime: row.expiration_time,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };

    const req = await buildPushPayload(
      { data, options: { ttl: opts.ttl ?? 60, urgency: opts.urgency ?? "normal", ...(opts.topic ? { topic: opts.topic } : {}) } },
      subscription,
      vapid,
    );

    let res: Response;
    try {
      res = await fetch(row.endpoint, { method: "POST", headers: req.headers, body: req.body });
    } catch (err) {
      out.failed.push({ endpoint: row.endpoint, status: 0, body: String(err) });
      continue;
    }

    // RFC 8030: 404 = subscription expired, 410 = gone. Both are terminal — delete the row.
    if (res.status === 404 || res.status === 410) {
      await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?1`).bind(row.endpoint).run();
      out.removed.push(row.endpoint);
      continue;
    }

    if (res.status === 429) {
      // back off; keep the row. Retry-After is seconds or an HTTP-date.
      const retryAfter = res.headers.get("retry-after");
      out.failed.push({ endpoint: row.endpoint, status: 429, body: `retry-after=${retryAfter ?? ""}` });
      continue;
    }

    if (!res.ok) {
      // 400 = bad VAPID/JWT, 401/403 = wrong key or expired exp, 413 = payload too large
      const body = await res.text().catch(() => "");
      await env.DB.prepare(
        `UPDATE push_subscriptions
            SET fail_count = fail_count + 1, last_error_at = ?2, last_error_code = ?3
          WHERE endpoint = ?1`,
      ).bind(row.endpoint, Date.now(), res.status).run();
      out.failed.push({ endpoint: row.endpoint, status: res.status, body: body.slice(0, 500) });
      continue;
    }

    await env.DB.prepare(`UPDATE push_subscriptions SET last_ok_at = ?2, fail_count = 0 WHERE endpoint = ?1`)
      .bind(row.endpoint, Date.now()).run();
    out.sent += 1;
  }

  return out;
}
```

Status-code semantics quoted from RFC 8030:

> 404 — "A push service MAY expire a subscription at any time… this MUST be signaled by returning a 404"
> 410 — the push service "MUST return a 410 (Gone) response to the application server monitoring the receipt subscription" when it ceases retry attempts
> 413 — "Push services MUST NOT return a 413 status code in responses to an entity body that is 4096 bytes or less in size."
> TTL — "An application server MUST include the TTL (Time-To-Live) header field in its request for push message delivery."
> Urgency values — `very-low` / `low` / `normal` / `high`
> Topic — "restricted to no more than 32 characters from the URL and a filename-safe Base 64 alphabet"

### 5.3 Equivalent with `web-push` (if you take the other branch of the open decision)

Cloudflare's own doc pattern, verbatim from their Agents guide:

```js
webpush.setVapidDetails(
  this.env.VAPID_SUBJECT,
  this.env.VAPID_PUBLIC_KEY,
  this.env.VAPID_PRIVATE_KEY,
);

try {
  await webpush.sendNotification(sub, JSON.stringify({ title: "Reminder", body: payload.message, tag: `reminder-${payload.id}` }));
} catch (err) {
  const statusCode = err instanceof webpush.WebPushError ? err.statusCode : 0;
  if (statusCode === 404 || statusCode === 410) {
    deadEndpoints.push(sub.endpoint);
  }
}
```

`err.statusCode === 410` and `err.body === "push subscription has unsubscribed or expired.\n"` are
the exact values I observed from FCM. `setVapidDetails` mutates module-level state, so with
`web-push` you must call it before *every* batch inside a Worker isolate (isolates are reused across
requests; a stale isolate could hold another config in a multi-tenant app — irrelevant for one user,
but the habit is cheap).

### 5.4 Service worker `push` + `notificationclick` handler

Add to the Serwist service-worker source (Serwist does not own the `push` event; you register your
own listener in the SW entry file).

```js
self.addEventListener("push", (event) => {
  const data = (() => { try { return event.data ? event.data.json() : {}; } catch { return {}; } })();

  // You MUST show a notification here, and you MUST pass the promise to waitUntil.
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Fitness", {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      lang: data.lang ?? "ru",
      ...(data.tag ? { tag: data.tag, renotify: true } : {}),   // renotify:true without tag throws TypeError
      requireInteraction: data.requireInteraction === true,      // Chrome only — see G10
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/", self.location.origin);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === target.origin) {
        await w.focus();
        if ("navigate" in w) await w.navigate(target.href);
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
```

web.dev on the show-a-notification rule, verbatim:

> "I've been stating that you **must** show a notification when you receive a push and this is true
> _most_ of the time. The one scenario where you don't have to show a notification is when the user
> has your site open and focused."

MDN on `userVisibleOnly`:

> "A boolean indicating that the returned push subscription will only be used for messages whose
> effect is made visible to the user." … "This parameter is required in some browsers like Chrome and
> Edge. They will reject the Promise if `userVisibleOnly` is not set to `true`."

### 5.5 Client subscribe path

```ts
// src/lib/push/client.ts
export function base64urlToUint8Array(base64url: string): Uint8Array {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** iOS: `Notification` is UNDEFINED unless the PWA is installed to the Home Screen. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"        // <-- the load-bearing check on iOS
  );
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // legacy iOS Safari flag; still the only signal on some versions
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** MUST be called from inside a click/tap handler — see §6.1. */
export async function subscribeToPush(vapidPublicKey: string) {
  if (!pushSupported()) return { ok: false as const, reason: "unsupported" as const };

  const permission = await Notification.requestPermission();   // first await, still inside the gesture
  if (permission !== "granted") return { ok: false as const, reason: permission };

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64urlToUint8Array(vapidPublicKey),
    }));

  const json = sub.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: json.keys,
      label: navigator.userAgent.slice(0, 200),
    }),
  });
  return { ok: true as const, subscription: sub };
}
```

MDN on `applicationServerKey`, verbatim:

> "A Base64-encoded string or `ArrayBuffer` containing an ECDSA P-256 public key that the push server
> will use to authenticate your application server. If specified, all messages from your application
> server must use the VAPID authentication scheme, and include a JWT signed with the corresponding
> private key. This key **_IS NOT_** the same ECDH key that you use to encrypt the data."

Pass a `Uint8Array`/`ArrayBuffer`, never the bare base64url string — Cloudflare's own sample does
`base64urlToUint8Array(vapidPublicKey).buffer`. `UNVERIFIED`: whether Safari/iOS specifically rejects
the string form today; passing bytes is universally accepted, so there is no reason to find out.

Also subscribe to the browser telling you the subscription changed:

```js
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const sub = await self.registration.pushManager.subscribe(event.oldSubscription?.options);
    await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  })());
});
```

`UNVERIFIED`: `pushsubscriptionchange` support on Safari/iOS — it is not reliably implemented
anywhere; treat it as a bonus, and make the app re-POST the current subscription on every launch as
the real repair mechanism.

---

## 6. Verified answer — platform constraints

### 6.1 iOS / iPadOS — the hard constraint

From the WebKit announcement, verbatim:

> "Now with iOS and iPadOS 16.4, we are adding support for Web Push to Home Screen web apps."
> "A web app that has been added to the Home Screen can request permission to receive push
> notifications … as long as that request is in response to direct user interaction — such as
> tapping on a 'subscribe' button provided by the web app."
> Web apps require a "manifest file (with its `display` member set to `standalone` or `fullscreen`)".
> "Home Screen web apps on iOS and iPadOS 16.4 now support the Badging API … web apps are now able to
> set their badge count."

MDN browser-compat-data (`main` branch, read 2026-09-12):

| API | `safari_ios` |
|---|---|
| `PushManager`, `PushManager.subscribe`, `ServiceWorkerRegistration.showNotification` | `16.4` — *"Notifications are supported in web apps saved to the home screen."* |
| `Notification` | `16.4`, **partial** — *"The `Notification` interface is undefined, unless the page is a web app saved to the home screen. The app's manifest must have a non-default `display` value."* |
| `Navigator.setAppBadge` | `16.4` — *"Badging is supported for web apps saved to the home screen."* + *"Passing `0` as an argument will clear the badge instead of displaying an unnumbered dot."* |

So, concretely, for Tair's iPhone:

1. Safari → Share → **Add to Home Screen**. There is no alternative; the requirement is unchanged
   as of iOS 26 (multiple 2026 secondary sources agree; no primary WebKit statement reverses it —
   `UNVERIFIED` that it will stay that way).
2. The manifest must set `display: "standalone"` (or `"fullscreen"`). A default/`browser` display
   value leaves `Notification` undefined.
3. Launch the app **from the Home Screen icon** (not from Safari).
4. `Notification.requestPermission()` must run inside a real tap handler. There is no silent
   permission and no second chance in-app: if the user taps "Don't Allow", the only recovery is
   iOS Settings → Notifications → the web app.
5. Notifications appear on the Lock Screen, in Notification Center, and on a paired Apple Watch —
   the WebKit post: "The notifications from web apps work exactly like notifications from other apps."

**Declarative Web Push** (iOS/iPadOS 18.4+, macOS Safari 18.5+) lets a push render with **no service
worker**. WebKit's example payload, verbatim:

```json
{
    "web_push": 8030,
    "notification": {
        "title": "...",
        "lang": "en-US",
        "dir": "ltr",
        "body": "...",
        "navigate": "https://...",
        "silent": false,
        "app_badge": "1"
    }
}
```

- `"web_push": 8030` is "the magic value that opts the rest of your push message into declarative
  parsing."
- A non-empty `title` is mandatory and `navigate` is required.
- A new content type `application/notification+json` was registered so newer browsers parse it
  declaratively while older browsers still deliver a normal `push` event to the service worker.
- WebKit still "requires push subscriptions to set the `userVisibleOnly` flag to `true`."
- Safari 18.4 notes, verbatim: "Declarative Web Push is now available on iOS and iPadOS 18.4 for
  web apps added to the Home Screen."

Since we need a service-worker `push` handler for Android anyway, and the declarative form is
backwards-compatible, the pragmatic move is: keep the SW handler, and **additionally** put the
`web_push` / `notification` keys in the JSON payload so iOS 18.4+ renders declaratively. Our SW
handler must then be written to read `data.notification?.title ?? data.title`.
`UNVERIFIED`: whether `@block65/webcrypto-web-push` can set `content-type:
application/notification+json` — its return type hard-codes `'content-type': string` to
`application/octet-stream` for the *encrypted body*, which is correct; the declarative content type
applies to the *decrypted* plaintext and is signalled by the payload itself in WebKit's design. I did
not verify an actual declarative delivery to a device.

### 6.2 Android / Chrome

- `PushManager` since Chrome 42; `showNotification` since 42. No install required — a plain tab can
  subscribe. Notifications are delivered via FCM even with the browser closed.
- `Notification.requestPermission()` from a user gesture is best practice and increasingly enforced;
  MDN: *"going forward browsers will explicitly disallow notifications not triggered in response to a
  user gesture. Firefox is already doing this from version 72."*
- `requireInteraction` — Chrome / Chrome Android **47**; Safari **never**; Firefox 117 partial
  (Windows only, otherwise behind `dom.webnotifications.requireinteraction.enabled`).
- `actions` — Chrome 53, Firefox 152, Safari **never**.
- `image` — Chrome 56, Safari never. `badge` — Chrome 53, Safari never (webkit.org/b/280160).
- `silent` — Chrome 43, Safari 16.6 desktop, `safari_ios` **false**.
- `renotify` — Chrome 50, Safari never.
- `Navigator.setAppBadge` — **`chrome_android: false`**. Badging works on iOS PWAs and desktop
  Chrome/Safari, not on Android Chrome.

### 6.3 Notification vibration and haptics — mostly dead

| API | Reality (MDN BCD, 2026-09-12) |
|---|---|
| `showNotification({ vibrate })` | Chrome 45 desktop; **`chrome_android: false`** with the note *"In Android Oreo and above, regardless of Chrome version, this parameter has no effect. See bug 40630890 (crbug.com/40630890)."* Safari: never. |
| `Notification.vibrate` property | Chrome 53; Safari **false**; Firefox **false**. |
| `navigator.vibrate()` | Chrome/Chrome Android 32, but *"Beginning in Chrome 60, this method requires a user gesture. Otherwise it returns `false`."* Safari/iOS: **never**. Firefox: removed in 129. |

So: **the brief's "haptics" can only be delivered from a foreground tap on Android.** On iOS there
is no web vibration API at all; the notification's own sound/haptic is whatever the OS assigns. Any
"vibrate pattern" design in the rest timer is decoration that will do nothing on Android 8+ and
nothing at all on iPhone.

---

## 7. Verified answer — can a push drive the rest-timer countdown while the screen is locked?

**No. Not with any web API, on any platform.** Four independent blockers:

1. **Every push must produce a visible notification.** `userVisibleOnly: true` is required by
   Chrome/Edge and by WebKit ("requires push subscriptions to set the `userVisibleOnly` flag to
   `true`"). A once-per-second silent tick is therefore impossible by design — each tick would be a
   banner. Chrome substitutes its own generic notification if your handler finishes without one.
   `UNVERIFIED`: the precise per-origin "silent push budget" and whether Chromium eventually stops
   waking the worker — that claim appears only in third-party blogs, not in Chrome docs.
2. **You cannot schedule a local notification for a future timestamp.** The Notification Triggers
   API (`showTrigger` + `TimestampTrigger`) ran two Chrome origin trials (Chrome 80–83 and 86–88) and
   was **abandoned** — Chrome's own page: *"The development of the Notification Triggers API … is no
   longer pursued."* It is absent from MDN browser-compat-data entirely (I fetched
   `api/TimestampTrigger.json`: 404).
3. **Page timers are throttled.** Chrome 88 timer rules: hidden page → *"The browser will check
   timers in this group once per second"*; and under **intensive throttling** (hidden > 5 minutes AND
   timer chain ≥ 5 AND silent ≥ 30 s AND no WebRTC) → *"once per minute"*. A 90-second rest timer
   driven by `setInterval` in a backgrounded tab is unreliable at best.
4. **The service worker is not a scheduler.** It is terminated between events; `setTimeout` inside a
   `push` handler is not guaranteed to run. `UNVERIFIED`: the exact suspension semantics of a
   backgrounded iOS Home Screen web app (iOS aggressively freezes the whole web process) — but the
   design below does not depend on knowing.

### What actually works — the rest-timer design

**(a) Never decrement a counter. Store an absolute end timestamp.**

```ts
// state: { restEndsAt: number | null }  — epoch ms, persisted (Dexie/IndexedDB) so it survives a reload
const remainingMs = Math.max(0, restEndsAt - Date.now());
```

Render from `Date.now()` on every `requestAnimationFrame`/tick and on `visibilitychange`. Then any
throttling, suspension, tab-kill or reload is *cosmetic*: the moment the app is visible again the
number is correct. This single rule removes 90% of the problem.

**(b) Stop the screen from locking at all — Screen Wake Lock (see §9).** This is the real answer for
GYM MODE. If the screen never sleeps, there is no background timer problem.

**(c) Exactly one push at rest-end, as a backstop.** Schedule it server-side with a Durable Object
alarm, not a Cron Trigger (Cron granularity is one minute; rest intervals are 60–300 s).

Cloudflare's Durable Objects alarms docs: `setAlarm(scheduledTimeMs: number)`, `getAlarm(): number |
null`, `deleteAlarm()`; *"Each Durable Object is able to schedule a single alarm at a time by calling
`setAlarm()`"* and calling it again *"will override the existing alarm"*; *"Alarms have guaranteed
at-least-once execution and are retried automatically when the `alarm()` handler throws"* with
*"exponential backoff starting at a 2 second delay from the first failure with up to 6 retries"*.
One alarm per object is exactly right here — a new set replaces the previous rest timer.

Send it with a short TTL and high urgency so a late delivery is dropped rather than arriving during
the next exercise:

```ts
await sendWebPush(env, { title: "Отдых закончен", body: "Присед — подход 3", url: "/workout/active", tag: "rest-timer" },
                  { ttl: 30, urgency: "high", topic: "rest" });
```

`ttl: 30` means the push service discards it if it cannot deliver within 30 s (RFC 8030). `topic:
"rest"` lets the push service replace an undelivered earlier rest push instead of queueing two
(≤ 32 chars, filename-safe base64 alphabet).

Treat this push as a **backstop, not the timer**. Push latency is not bounded; APNs in particular may
delay or coalesce. `UNVERIFIED`: typical APNs/FCM delivery latency for a high-urgency web push to a
locked iPhone.

**(d) Foreground cues.** While the app is visible: Web Audio beep (must be unlocked by a prior user
gesture on iOS) and `navigator.vibrate([200, 100, 200])` on Android from within a gesture-derived
context. `requireInteraction: true` keeps the banner on screen until tapped — **Chrome only**.

**(e) What does NOT work, for the record:** `vibrate` in `showNotification` (no-op on Android 8+),
`navigator.vibrate` on iOS (absent), `tag`-based notification replacement on iOS (`Notification.tag`
BCD: Safari `false`, *"The property can be set, but has no effect."*), and background audio hacks
(`UNVERIFIED`, and fragile).

---

## 8. Verified answer — Telegram Bot API from a Worker

Bot API version read today: **10.3 (August 24, 2026)**. No library needed — `fetch` + JSON.

### 8.1 Transport, quoted verbatim

> "All queries to the Telegram Bot API must be served over HTTPS and need to be presented in this
> form: `https://api.telegram.org/bot<token>/METHOD_NAME`."
> "We support GET and POST HTTP methods. We support four ways of passing parameters in Bot API
> requests: URL query string / `application/x-www-form-urlencoded` / `application/json` (except for
> uploading files) / `multipart/form-data` (use to upload files)"
> "The response contains a JSON object, which always has a Boolean field 'ok' … If 'ok' equals True,
> the request was successful and the result of the query can be found in the 'result' field. In case
> of an unsuccessful request, 'ok' equals False and the error is explained in the 'description'. An
> Integer 'error_code' field is also returned…"
> "All methods in the Bot API are case-insensitive." / "All queries must be made using UTF-8."

**Verified on workerd**: a JSON POST to `https://api.telegram.org/bot<fake>/sendMessage` from inside
`workerd` returned `HTTP 401` with body
`{"ok":false,"error_code":401,"description":"Unauthorized"}` — transport and error shape confirmed.
Same for `getMe`.

### 8.2 Minimal client

```ts
// src/server/telegram/client.ts
export class TelegramError extends Error {
  constructor(readonly code: number, readonly description: string, readonly parameters?: { retry_after?: number; migrate_to_chat_id?: number }) {
    super(`Telegram ${code}: ${description}`);
  }
}

type TgEnv = { TELEGRAM_BOT_TOKEN: string; TELEGRAM_CHAT_ID: string };

async function call<T>(env: TgEnv, method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: Record<string, number> };
  if (!json.ok) throw new TelegramError(json.error_code ?? res.status, json.description ?? "unknown", json.parameters);
  return json.result as T;
}

export function sendMessage(env: TgEnv, text: string, opts: { parseMode?: "MarkdownV2" | "HTML"; silent?: boolean; noPreview?: boolean } = {}) {
  return call<{ message_id: number }>(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID,                 // always the locked chat, never a caller-supplied id
    text,
    ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
    ...(opts.silent ? { disable_notification: true } : {}),
    ...(opts.noPreview ? { link_preview_options: { is_disabled: true } } : {}),
  });
}
```

`sendMessage` parameters we care about (verbatim from the table):

| Parameter | Type | Notes |
|---|---|---|
| `chat_id` | Integer or String | Yes. "Unique identifier for the target chat or username of the target bot, supergroup or channel in the format `@username`" |
| `text` | String | Yes. "Text of the message to be sent, **1-4096 characters after entities parsing**" |
| `parse_mode` | String | "Mode for parsing entities in the message text." |
| `entities` | Array of MessageEntity | "…can be specified instead of `parse_mode`" |
| `link_preview_options` | LinkPreviewOptions | "Link preview generation options for the message" |
| `disable_notification` | Boolean | "Sends the message silently. Users will receive a notification with no sound." |
| `protect_content` | Boolean | "Protects the contents of the sent message from forwarding and saving" |

### 8.3 setWebhook + secret token

Verbatim from the docs:

> "If you'd like to make sure that the webhook was set by you, you can specify secret data in the
> parameter `secret_token`. If specified, the request will contain a header
> 'X-Telegram-Bot-Api-Secret-Token' with the secret token as content."
> `secret_token` — "A secret token to be sent in a header 'X-Telegram-Bot-Api-Secret-Token' in every
> webhook request, **1-256 characters. Only characters A-Z, a-z, 0-9, `_` and `-` are allowed.**"
> `allowed_updates` — "A JSON-serialized list of the update types you want your bot to receive… Please
> note that this parameter doesn't affect updates created before the call to the setWebhook, so
> unwanted updates may be received for a short period of time."
> `max_connections` — "1-100. Defaults to 40."
> "In case of an unsuccessful request (a request with response HTTP status code different from 2XY),
> we will repeat the request and give up after a reasonable amount of attempts."
> Notes: "You will not be able to receive updates using `getUpdates` for as long as an outgoing
> webhook is set up." / "Ports currently supported for webhooks: **443, 80, 88, 8443**."

One-off registration (run from your laptop, not from the Worker):

```bash
# secret_token charset == base64url minus '=' padding, so this is safe:
SECRET=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')
echo "$SECRET"     # -> wrangler secret put TELEGRAM_WEBHOOK_SECRET

curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"https://<your-domain>/api/telegram/webhook/$(openssl rand -hex 8)\",
       \"secret_token\":\"$SECRET\",
       \"allowed_updates\":[\"message\"],
       \"drop_pending_updates\":true,
       \"max_connections\":1}"

# verify, and use this later to debug delivery failures:
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

`getWebhookInfo` returns `pending_update_count`, `last_error_date`, `last_error_message`,
`last_synchronization_error_date`, `allowed_updates` — `last_error_message` is the single most useful
debugging field when the webhook silently stops working.

### 8.4 Webhook handler: verify secret, lock to one chat

Next.js App Router route handler on the Node runtime. Per stack-facts, **never** `export const
runtime = "edge"`.

```ts
// src/app/api/telegram/webhook/[slug]/route.ts
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

function constantTimeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;     // length is not secret for a fixed-length token
  // Cloudflare non-standard extension: "Compare two buffers in a way that is resistant to timing attacks."
  return crypto.subtle.timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const { env, ctx } = getCloudflareContext();

  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!env.TELEGRAM_WEBHOOK_SECRET || !constantTimeEquals(got, env.TELEGRAM_WEBHOOK_SECRET)) {
    // 401 on purpose: a non-2XX makes Telegram retry, but a request with the WRONG secret is not
    // Telegram — and if it IS Telegram (stale webhook after a secret rotation) you want it to
    // surface in getWebhookInfo.last_error_message instead of being swallowed.
    return new Response("unauthorized", { status: 401 });
  }

  const update = (await request.json()) as {
    update_id: number;
    message?: { message_id: number; text?: string; chat: { id: number }; from?: { id: number } };
    edited_message?: { message_id: number; text?: string; chat: { id: number } };
  };

  const msg = update.message ?? update.edited_message;
  const chatId = msg?.chat?.id;

  // SECOND gate: the bot is locked to one chat. The secret proves the sender is Telegram;
  // it does NOT prove the message came from Tair. Anyone who finds the bot can /start it.
  if (chatId === undefined || String(chatId) !== env.TELEGRAM_CHAT_ID) {
    return new Response(null, { status: 204 });   // 2XX so Telegram stops retrying; do nothing
  }

  // Do the work after responding: Telegram retries any non-2XX, and its client timeout is short.
  ctx.waitUntil(handleCommand(env, msg!));
  return new Response(null, { status: 204 });
}
```

To learn your own chat id once: send the bot any message, then
`curl "https://api.telegram.org/bot$TOKEN/getUpdates"` **before** setting the webhook (the two are
mutually exclusive), and read `result[0].message.chat.id`. Store it as
`TELEGRAM_CHAT_ID` (a `var` is fine; it is not a secret, but keeping it in secrets costs nothing).

Also lock the bot down in `@BotFather`: `/setjoingroups` → Disable, and `/setprivacy` → Enable. Those
reduce the surface but do **not** replace the chat-id check. `UNVERIFIED`: exact current BotFather
command names (read from memory of BotFather's menu, not from a doc I fetched today).

### 8.5 MarkdownV2 escaping — the trap that will break the weekly report

The rules, quoted verbatim from the Bot API "MarkdownV2 style" section:

> - "Any character with code between 1 and 126 inclusively can be escaped anywhere with a preceding
>   '\' character, in which case it is treated as an ordinary character and not a part of the markup.
>   This implies that '\' character usually must be escaped with a preceding '\' character."
> - "Inside `pre` and `code` entities, all '`' and '\' characters must be escaped with a preceding '\'
>   character."
> - "Inside the (...) part of the inline link and custom emoji definition, all ')' and '\' must be
>   escaped with a preceding '\' character."
> - "In all other places characters `'_'`, `'*'`, `'['`, `']'`, `'('`, `')'`, `'~'`, `` '`' ``, `'>'`,
>   `'#'`, `'+'`, `'-'`, `'='`, `'|'`, `'{'`, `'}'`, `'.'`, `'!'` must be escaped with the preceding
>   character `'\'`."
> - "In case of ambiguity between italic and underline entities `__` is always greedily treated from
>   left to right as beginning or end of an underline entity, so instead of `___italic underline___`
>   use `___italic underline_**__`, adding an empty bold entity as a separator."

Escaper (tested — covers all 18 documented characters plus backslash):

```ts
// src/server/telegram/markdown.ts
const MDV2_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** Escape a VALUE for interpolation into MarkdownV2. Never run this over your own markup. */
export const mdv2 = (value: unknown): string => String(value).replace(MDV2_RESERVED, (c) => "\\" + c);
```

Verified outputs:

```
"Bench Press 100.5 kg x 5 (RPE 8.5)"  ->  "Bench Press 100\.5 kg x 5 \(RPE 8\.5\)"
"PR! +2.5 kg vs last week"            ->  "PR\! \+2\.5 kg vs last week"
"e1RM = 121.3 kg"                     ->  "e1RM \= 121\.3 kg"
"Deficit -350 kcal | Protein 180g"    ->  "Deficit \-350 kcal \| Protein 180g"
"a_b_c *bold* [x](y) {z} #tag"        ->  "a\_b\_c \*bold\* \[x\]\(y\) \{z\} \#tag"
documented chars NOT escaped: []
```

Correct usage — escape values, then wrap in markup:

```ts
const line = `*${mdv2(exercise.name)}* — ${mdv2(weight)} кг × ${mdv2(reps)} \\(e1RM ${mdv2(e1rm.toFixed(1))}\\)`;
```

Note the literal `\\(` for the parentheses **you** wrote: your own punctuation needs escaping too,
because MarkdownV2 reserves `(` `)` `.` `-` `!` `+` `=` `|` everywhere. This is why almost every real
bot ends up preferring HTML mode (§8.6).

### 8.6 Strong recommendation: use `parse_mode: "HTML"`, not MarkdownV2

The HTML rules are dramatically smaller and the escape set is three characters:

> "All `<`, `>` and `&` symbols that are not a part of a tag or an HTML entity must be replaced with
> the corresponding HTML entities (`<` with `&lt;`, `>` with `&gt;` and `&` with `&amp;`)."
> Supported tags: `<b> <strong> <i> <em> <u> <ins> <s> <strike> <del> <span class="tg-spoiler">
> <tg-spoiler> <a> <tg-emoji> <tg-time> <code> <pre> <blockquote>` (+ `<blockquote expandable>`).
> "The API currently supports only the following named HTML entities: `&lt;`, `&gt;`, `&amp;` and `&quot;`."

```ts
const h = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const line = `<b>${h(exercise.name)}</b> — ${h(weight)} кг × ${h(reps)} (e1RM ${h(e1rm.toFixed(1))})`;
```

A weekly report full of numbers, dates, `-350 kcal`, `+2.5 kg` and decimal points is the *worst*
possible input for MarkdownV2 and trivially safe in HTML. Escape `&`, `<`, `>` and you are done.

### 8.7 Sending a photo / chart image

`sendPhoto` (verbatim constraints):

> `photo` — "Photo to send. Pass a `file_id` as String to send a photo that exists on the Telegram
> servers (recommended), pass an HTTP URL as a String for Telegram to get a photo from the Internet,
> or upload a new photo using multipart/form-data. The photo must be at most **10 MB** in size. The
> photo's width and height must not exceed **10000 in total**. Width and height ratio must be at most
> **20**."
> `caption` — "Photo caption …, **0-1024 characters** after entities parsing"

**Multipart upload from the Worker — verified.** `FormData` + `Blob` inside workerd produced a
well-formed multipart request that reached Telegram (401, invalid token, i.e. the request was sent and
parsed):

```ts
export async function sendPhotoBytes(env: TgEnv, bytes: Uint8Array, filename: string, caption: string) {
  const fd = new FormData();
  fd.append("chat_id", env.TELEGRAM_CHAT_ID);
  fd.append("caption", caption);
  fd.append("parse_mode", "HTML");
  fd.append("photo", new Blob([bytes], { type: "image/png" }), filename);
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: fd });
  const json = await res.json();
  if (!json.ok) throw new TelegramError(json.error_code, json.description);
  return json.result;
}
```

Do **not** set `content-type` yourself — let `fetch` derive the multipart boundary from `FormData`.

**Where the PNG comes from is the real problem.** There is no canvas in a Worker. Options:

| Option | Verdict |
|---|---|
| Render the chart SVG in the Worker, rasterise with `@resvg/resvg-wasm@2.6.2` or `@cf-wasm/resvg@0.4.0` | Plausible; **`UNVERIFIED` on workerd** (wasm size + `nodejs_compat` interaction untested here). |
| `satori@0.33.4` (JSX → SVG) + a rasteriser | Same caveat; satori alone only gets you to SVG. |
| Render the chart PNG **client-side** (Recharts/visx are already in the app), upload to R2, then `sendPhoto` with the R2 URL | Cheapest. Zero new wasm. But requires the app to be open, so it can't be Cron-driven. |
| Store the chart PNG in R2 from a Cron job and pass a **public HTTP URL** to `sendPhoto` (Telegram fetches it) | Still needs a rasteriser to make the PNG. |
| Cloudflare Browser Rendering (headless Chrome) screenshot of a chart route | Works, but it is a paid binding, slow, and heavy for one weekly report. `UNVERIFIED` pricing/limits. |
| **Send no image**: a well-formatted HTML text report + a deep link into the dashboard | Zero risk, and honestly better UX on a phone. |

Telegram will fetch an `HTTP URL` you pass as `photo`, so R2 + a public bucket (or a signed Worker
route) avoids the 10 MB multipart upload entirely, and you get a reusable `file_id` back in the
result for cheap re-sends.

### 8.8 Rate limits (Telegram FAQ, quoted)

> "In a single chat, avoid sending more than one message per second."
> "For bulk notifications, bots are not able to broadcast more than about 30 messages per second,
> unless they enable paid broadcasts."
> "In a group, bots are not be able to send more than 20 messages per minute."

Exceeding them yields `429` with `parameters.retry_after` (seconds). Irrelevant at our volume, but
the weekly report should be **one** message, not fifteen lines sent separately.

---

## 9. Verified answer — Screen Wake Lock API (GYM MODE)

MDN, verbatim:

```javascript
// Create a reference for the Wake Lock.
let wakeLock = null;

// create an async function to request a wake lock
try {
  wakeLock = await navigator.wakeLock.request("screen");
  statusElem.textContent = "Wake Lock is active!";
} catch (err) {
  // The Wake Lock request has failed - usually system related, such as battery.
  statusElem.textContent = `${err.name}, ${err.message}`;
}
```

```javascript
wakeLock.release().then(() => {
  wakeLock = null;
});
```

```javascript
wakeLock.addEventListener("release", () => {
  // the wake lock has been released
  statusElem.textContent = "Wake Lock has been released";
});
```

- Secure context (HTTPS) required. "Only active documents can acquire wake locks."
- Permissions Policy directive: **`screen-wake-lock`**, default allowlist `self`. There is **no
  permission prompt** — the request either resolves or rejects (typically `NotAllowedError`).
- Auto-released when: system settings change (power save / low battery), **the document becomes
  inactive or not visible**, or the browser decides to.
- MDN marks it **Baseline 2025** — "Newly available since March 2025".

Support (MDN BCD, 2026-09-12) for `Navigator.wakeLock` and `WakeLock.request`:

| Browser | Version |
|---|---|
| Chrome / Chrome Android / Edge | **84** |
| Firefox | **126** |
| Safari (macOS) | **16.4** |
| Safari iOS | **18.4** — and for **16.4 → 18.4**: `partial_implementation`, *"Does not work in standalone Home Screen Web Apps. See [bug 254545](https://webkit.org/b/254545#c32)."* |

WebKit's Safari 18.4 release notes confirm the fix verbatim: *"The Screen Wake Lock API now also
works in Home Screen Web Apps on iOS and iPadOS 18.4."*

**This is a big deal for us.** Our PWA on iOS *must* run as a standalone Home Screen web app (that is
the only way to get Web Push, §6.1) — which is precisely the configuration where Wake Lock was broken
until iOS 18.4. GYM MODE's "screen kept awake" requirement therefore has a hard floor of
**iOS 18.4**, two minor versions above the Web Push floor of 16.4.

Production-ready hook (the re-acquire on `visibilitychange` is mandatory, not optional):

```ts
// src/lib/wake-lock.ts
export function createScreenWakeLock() {
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;

  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  async function acquire(): Promise<{ ok: boolean; reason?: string }> {
    if (!supported) return { ok: false, reason: "unsupported" };
    if (document.visibilityState !== "visible") return { ok: false, reason: "hidden" };
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => { sentinel = null; });
      return { ok: true };
    } catch (err) {
      sentinel = null;
      return { ok: false, reason: `${(err as Error).name}: ${(err as Error).message}` };
    }
  }

  // The lock is auto-released whenever the document is hidden — tab switch, incoming call,
  // app switcher. Without this listener GYM MODE silently stops keeping the screen awake
  // after the first interruption and never recovers.
  const onVisibility = () => { if (wanted && document.visibilityState === "visible" && !sentinel) void acquire(); };

  return {
    supported,
    get active() { return sentinel !== null; },
    async enable() {
      wanted = true;
      document.addEventListener("visibilitychange", onVisibility);
      return acquire();
    },
    async disable() {
      wanted = false;
      document.removeEventListener("visibilitychange", onVisibility);
      try { await sentinel?.release(); } catch { /* already released */ }
      sentinel = null;
    },
  };
}
```

Call `enable()` when GYM MODE mounts and `disable()` on unmount / workout finish — a wake lock held
after the user leaves the gym screen is a battery bug. Show the `supported === false` /
`reason: "unsupported"` case honestly in the UI (the brief's "honest data" principle) rather than
pretending the screen will stay on.

---

## 10. Recommendation

1. **Web Push library: `@block65/webcrypto-web-push@2.0.0`.** Verified working on workerd, 3.34 KiB
   gzipped vs 49.27 KiB, correct RFC 8291 `aes128gcm`, and it hands you the `fetch` so 404/410
   cleanup is a plain `res.status` check instead of catching a typed error. Keep `web-push@3.6.7` in
   your back pocket — it is verified working and it is what Cloudflare documents — but there is no
   reason to pay 259 KiB of Node polyfill for forty lines of crypto. **Never `@pushforge/builder`**
   (legacy `aesgcm` → invisible iOS failure).
2. **Make Telegram the primary notification channel and Web Push the secondary one.** For a
   single user who already uses Telegram, Telegram wins on every axis: no Home Screen install
   requirement, no permission prompt, no VAPID key lifecycle, no 410 churn, no iOS version floor, it
   works when the PWA is uninstalled, and it can carry rich text and images. Web Push earns its place
   for exactly one job Telegram cannot do well: the **rest-timer end** and other in-gym,
   seconds-latency nudges. Route everything else — daily reminder, streak-at-risk nudge, weekly
   report, monthly report card — to Telegram.
3. **Rest timer: absolute `restEndsAt` timestamp + Screen Wake Lock + one Durable Object alarm push
   as a backstop.** Do not attempt to keep a countdown alive in the background; it is not possible on
   the web platform and every approach that looks like it works fails on iOS.
4. **Use `parse_mode: "HTML"` for every Telegram message.** MarkdownV2 requires escaping 19
   characters including `.` `-` `+` `=` `|` `!`, which is exactly what a numeric fitness report is
   made of. HTML needs three. Keep the verified `mdv2()` escaper in the repo anyway, for any place
   that genuinely needs Markdown.
5. **Cron for anything ≥ 1 minute, Durable Object alarm for anything shorter.** Cron Triggers run on
   UTC; Asia/Almaty is **UTC+5 year-round with no DST** (verified against tzdata 2025b: 2026-01-15,
   2026-06-15 and 2026-09-12 all resolve to `GMT+05:00`), so a 21:00 local reminder is
   `0 16 * * *`. Limits: 5 Cron Triggers on Free, 250 on Paid; scheduled invocations get 15 min
   duration and "30 seconds (< 1 hour interval), 15 min (>= 1 hour interval)" of CPU.
6. **Set `compatibility_date` to `2026-09-01` or later**, not merely the `2024-12-30` floor in
   stack-facts. See G1.

### 10.1 One place this note extends stack-facts

stack-facts says `main: ".open-next/worker.js"`. To get a `scheduled()` handler (Phase 8's
Cron reminders and weekly Telegram report) you must point `main` at a **custom worker that re-exports
the generated one**. OpenNext's own doc, verbatim:

```typescript
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,

  async scheduled(event) {
    // ...
  },
} satisfies ExportedHandler<CloudflareEnv>;

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
```

with `"main": "./path/to/custom-worker.ts"`. This is an addition, not a contradiction: the generated
worker is still the one handling `fetch`. **The `export { DOQueueHandler, ... }` line is mandatory
for us** because stack-facts pins `NEXT_CACHE_DO_QUEUE` (class `DOQueueHandler`) — dropping it turns
the incremental cache into a silent failure. Record the switch in `DECISIONS.md`.

---

## 11. Gotchas that will silently break us

- **G1 — `compatibility_date` too old kills `web-push`'s send path.** `node:https` client support
  needs `enable_nodejs_http_modules`, auto-enabled only for compatibility dates **≥ 2025-08-15**.
  stack-facts' floor of `2024-12-30` satisfies OpenNext and silently breaks `web-push`. Encryption
  would still work; only the outbound request dies. (Not an issue if we take the `@block65`
  recommendation, which uses plain `fetch`.)
- **G2 — `main` override drops the Durable Object export.** See §10.1. A missing
  `export { DOQueueHandler }` = silent cache failure, exactly the failure mode stack-facts warns about.
- **G3 — `Notification` is `undefined` on iOS Safari, not `"denied"`.** Any feature check written as
  `Notification.permission === "granted"` throws a `ReferenceError` on an iPhone that has not
  installed the PWA. Gate on `typeof Notification !== "undefined"` first, always.
- **G4 — iOS needs manifest `display: "standalone"` (or `"fullscreen"`) AND a Home Screen install AND
  a real tap.** Miss any one and Web Push is simply absent. There is no error message.
- **G5 — Screen Wake Lock does not work in an iOS standalone PWA before 18.4** (webkit.org/b/254545).
  The `request()` promise rejects; if you don't surface it, GYM MODE looks like it works and the
  screen dims mid-set.
- **G6 — Wake Lock auto-releases on every `visibilitychange`** and does **not** come back on its own.
  Without a `visibilitychange` re-acquire, the first incoming call or notification permanently ends
  the wake lock for that session.
- **G7 — The two libraries have opposite TTL defaults.** `web-push` → `TTL: 2419200` (28 days, so a
  rest-timer push can be delivered next week); `@block65` → `ttl: 60`, so a *daily reminder* built
  on the default will be dropped if the phone is offline for a minute. Always set `ttl` explicitly
  per message class.
- **G8 — 4096-byte push ceiling, and `@block65` pads everything to it.** Plaintext limit is exactly
  **3993 bytes** (`recordSize 4096 − headerSize 86 − 17`) and it throws above that. Never put a chart,
  a set list, or an AI summary in a push payload; put an id and fetch on click.
- **G9 — a push that shows no notification is punished.** Chrome substitutes its own generic
  "site updated in the background" banner; WebKit requires `userVisibleOnly: true`. Also: forgetting
  `event.waitUntil(...)` around `showNotification()` produces the same outcome even though your code
  "called" it. `UNVERIFIED`: the exact throttling penalty.
- **G10 — `requireInteraction` is Chrome-only.** Safari/iOS: never implemented. Designing the rest
  timer around a sticky banner means it does nothing on the target device.
- **G11 — `tag` does nothing on Safari.** BCD: *"The property can be set, but has no effect."*
  (webkit.org/b/258922). On iOS, ten rest-timer pushes = ten separate banners; there is no
  coalescing. Use the RFC 8030 `Topic` **request header** (server side, ≤ 32 chars) to get
  replacement at the push service instead.
- **G12 — notification `vibrate` is a no-op on Android 8+** *"regardless of Chrome version"*
  (crbug.com/40630890) and `navigator.vibrate` does not exist on iOS at all. Every "haptic" in the
  brief is a foreground-only, Android-only effect.
- **G13 — `Navigator.setAppBadge` is `false` on Chrome Android.** The badge story works on iPhone and
  desktop, not on an Android phone.
- **G14 — Telegram retries every non-2XX webhook response.** Slow work inside the handler produces
  duplicate updates. Always return `204` immediately and do work in `ctx.waitUntil`. Also dedupe on
  `update_id` if a command has side effects.
- **G15 — the secret token proves the sender is Telegram, not that the sender is Tair.** Anyone who
  finds the bot username can `/start` it, and Telegram will faithfully forward their messages with a
  valid secret header. The `String(chat.id) !== env.TELEGRAM_CHAT_ID` check is the actual
  authorisation. Check it for **every** update shape you handle (`message`, `edited_message`,
  `callback_query.message.chat.id`, …), not just `message`.
- **G16 — `crypto.subtle.timingSafeEqual` is a Cloudflare non-standard extension** and its behaviour
  for mismatched lengths is undocumented. Compare lengths first (safe: the token length is not
  secret), then call it.
- **G17 — MarkdownV2 `400 Bad Request: can't parse entities`.** One unescaped `.` in `100.5` or `-`
  in `-350` kills the whole message. It will pass every test written with round numbers and fail the
  first real weekly report. Use HTML mode.
- **G18 — don't run the escaper over your own markup.** `mdv2("*bold*")` produces `\*bold\*`, i.e.
  literal asterisks. Escape interpolated values only, then wrap.
- **G19 — Telegram length caps are enforced after entity parsing**: text 1–4096, caption 0–1024.
  A long AI weekly summary must be chunked, and escaping *increases* length.
- **G20 — `setWebhook` and `getUpdates` are mutually exclusive.** Grab your `chat_id` via `getUpdates`
  *before* setting the webhook, or you will get an empty array and assume the bot is broken.
- **G21 — rotating the VAPID key pair invalidates every existing subscription.** The public key is
  embedded in the subscription by the browser. Back the pair up outside Cloudflare; there is no
  "rotate" path that doesn't require re-granting permission on the device.
- **G22 — the VAPID JWT `exp` must be ≤ 24 h from now** (`@block65` uses 12 h and signs per call). If
  you ever add JWT caching, a cached token silently starts returning `403` from FCM.
- **G23 — Notification Triggers (`TimestampTrigger`) does not exist.** It is abandoned and absent
  from MDN BCD. Any design doc that says "schedule a local notification for when rest ends" is
  describing an API that was never shipped.
- **G24 — Worker cron cannot fire more often than once a minute**, and it runs in UTC. The rest timer
  cannot use it; use a Durable Object alarm.

---

## 12. Open decisions for the owner

**D1 — Does Web Push ship at all, or is Telegram the only channel?** (the one that actually matters)

- **Option A — Telegram only.** Zero iOS version floor, zero install requirement, zero permission
  UX, zero 410 churn, no VAPID key to protect, richer formatting, images. Cost: no in-gym
  rest-timer notification when the phone is locked; the rest timer then relies entirely on Screen
  Wake Lock keeping the screen on (iOS 18.4+).
- **Option B — Telegram + Web Push.** Adds the rest-timer backstop and a Lock Screen banner, at the
  cost of: the PWA must be installed to the Home Screen on iOS, a permission flow that can only be
  granted once, a `push_subscriptions` table with 404/410 lifecycle, and a service-worker `push`
  handler that Serwist doesn't manage for you.
- **Recommendation: B, but sequenced.** Ship Telegram in Phase 8 and make the DoD ("weekly Telegram
  report fires from Cron") green on Telegram alone. Add Web Push as a clearly scoped sub-task whose
  only consumer is the rest timer. If the wake lock proves sufficient in real gym use, Web Push can
  be dropped without touching anything else.

**D2 — Web Push library: `@block65/webcrypto-web-push` or `web-push`?**

- **Option A — `@block65/webcrypto-web-push@2.0.0`**: 3.34 KiB gzip, pure WebCrypto, you own the
  `fetch` (clean 404/410 handling), ESM-only, small maintainer. Verified working on workerd today.
- **Option B — `web-push@3.6.7`**: 49.27 KiB gzip, pulls `node:crypto` + `node:https` polyfills,
  documented by Cloudflare itself, huge install base, includes the VAPID keygen CLI. Also verified
  working on workerd today, including a real send.
- **Recommendation: A**, and keep B pinned in a comment as the escape hatch. Either way, record the
  choice plus the `compatibility_date` floor in `DECISIONS.md`.

**D3 — How do charts reach Telegram?** (§8.7)

- **Option A — text-only report + a deep link** into the dashboard. Zero new dependencies, zero risk.
- **Option B — rasterise SVG in the Worker** (`@resvg/resvg-wasm@2.6.2` / `@cf-wasm/resvg@0.4.0`),
  upload to R2, `sendPhoto` with the URL. `UNVERIFIED` on workerd — needs a spike before it is
  planned into Phase 8.
- **Recommendation: A for Phase 8's DoD, B as a Phase 9 polish item behind a verification spike.**
  A gorgeous chart that blocks the "weekly report fires from Cron" acceptance criterion is a bad
  trade.

---

## 13. Sources

### Local files read

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

### Package source / types read directly (installed in the scratchpad)

- `web-push@3.6.7` — `src/index.js`, `src/web-push-lib.js`, `src/encryption-helper.js`, `src/vapid-helper.js`
- `@block65/webcrypto-web-push@2.0.0` — `dist/lib/main.d.ts`, `types.d.ts`, `payload.d.ts`, `vapid.d.ts`,
  `encrypt.d.ts`, `payload.js`, `vapid.js`, `encrypt.js`
- `@pushforge/builder@2.0.5` — `dist/lib/types.d.ts`, `dist/lib/payload.js`, `dist/lib/vapid.js`
- `uint8array-extras` — `index.js` (`base64ToUint8Array`)
- MDN browser-compat-data (`main`, fetched 2026-09-12):
  `api/WakeLock.json`, `api/PushManager.json`, `api/Notification.json`,
  `api/ServiceWorkerRegistration.json`, `api/Navigator.json`
  (`api/TimestampTrigger.json` → 404, i.e. not a shipped API)

### URLs

- https://developers.cloudflare.com/agents/guides/push-notifications/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://opennext.js.org/cloudflare/howtos/custom-worker
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://webkit.org/blog/16535/meet-declarative-web-push/
- https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
- https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- https://web.dev/articles/push-notifications-common-notification-patterns
- https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- https://developer.chrome.com/docs/web-platform/notification-triggers
- https://www.rfc-editor.org/rfc/rfc8030.html (HTTP Web Push: TTL, Urgency, Topic, 404/410, 4096 bytes)
- RFC 8291 (aes128gcm payload encryption) and RFC 8292 (VAPID) — referenced by the above and by the
  library source; not fetched in full this session
- https://core.telegram.org/bots/api (Bot API **10.3**, August 24 2026 — sections: Making requests,
  setWebhook / deleteWebhook / getWebhookInfo / WebhookInfo, sendMessage, Formatting options,
  MarkdownV2 style, HTML style, sendPhoto)
- https://core.telegram.org/bots/faq (rate limits)
