# R03 — R2 uploads and image delivery (food photos, progress photos)

**Researched:** 2026-09-12 · **Status:** verified against primary sources except where marked `UNVERIFIED`
**Supersedes nothing. Subordinate to** [`stack-facts.md`](./stack-facts.md) — where this note and
stack-facts disagree, stack-facts wins. One clarification (not a contradiction) to stack-facts is
flagged in [§7](#7-relationship-to-stack-factsmd).

Every version number, API signature, config key, limit and error string below was read from the
Cloudflare docs (as Markdown, via `…/index.md`), the installed `.d.ts` files, the `workerd` C++
source, MDN, or MDN's `@mdn/browser-compat-data@8.1.1` dataset. Anything not verified that way is
tagged `UNVERIFIED` inline.

---

## Question

For a single-user, offline-first fitness PWA on Next.js 16 App Router + `@opennextjs/cloudflare`
deployed to Cloudflare Workers:

1. Can a Worker holding an **R2 binding** mint a presigned `PUT` URL?
2. If not, which of the two real upload paths is right for 1–10 MB phone photos, given Worker
   request-body and CPU limits? What is the actual R2 single-part upload ceiling, and when does
   multipart become necessary?
3. How should photos be **served** — authenticated route handler + `bucket.get`, public `r2.dev`
   bucket, or custom domain? With correct `Cache-Control` / `ETag` / `Range` handling.
4. What **resizing/thumbnailing** actually works on Workers today — Cloudflare Images
   transformations, `fetch(url, {cf:{image:{…}}})`, the Images binding, or client-side
   canvas/WebP/AVIF compression before upload? What needs a paid Images plan or a zone?
5. What **object-key scheme** (no PII, sortable, collision-free without `Math.random`) and what
   **D1 columns**?

---

## Verified answer

### 1. No. An R2 binding cannot produce a presigned URL. Presigning is an S3-API-only capability.

#### Evidence A — the binding's full surface has no signing method

Read verbatim from `@cloudflare/workers-types@5.20260911.1`, `index.d.ts:2486-2516`:

```ts
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(
    key: string,
    options: R2GetOptions & {
      onlyIf: R2Conditional | Headers;
    },
  ): Promise<R2ObjectBody | R2Object | null>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value:
      ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions & {
      onlyIf: R2Conditional | Headers;
    },
  ): Promise<R2Object | null>;
  put(
    key: string,
    value:
      ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object>;
  createMultipartUpload(
    key: string,
    options?: R2MultipartOptions,
  ): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}
```

`head`, `get`, `put`, `createMultipartUpload`, `resumeMultipartUpload`, `delete`, `list`. That is
all. `grep -i presign` over the whole 590 KB `index.d.ts` returns **zero** matches.

#### Evidence B — the docs put presigning behind the S3 API and its credentials

From [Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) (page dated
2026-08-22), verbatim:

> Presigned URLs are generated server-side with no communication with R2, requiring only your R2 API
> credentials and an implementation of the AWS Signature Version 4 signing algorithm.

Prerequisites, verbatim:

> * [Account ID](…) (for constructing the S3 endpoint URL)
> * [R2 API token](…) (Access Key ID and Secret Access Key)
> * AWS SDK or compatible S3 client library

The same page lists the R2 binding only under **Related resources**, described as an
"Alternative for server-side R2 access with built-in authentication" — i.e. a different mechanism,
not a presigning mechanism.

**Conclusion:** the binding authenticates *the Worker* to R2 out-of-band (no secret in your code at
all). It cannot delegate that authority to a browser as a URL. To presign you must hold an R2
**Access Key ID + Secret Access Key** and perform SigV4 yourself.

---

### 2. The two real options, and which one is right here

#### Option (i) — S3 presign from the Worker with `aws4fetch`

`aws4fetch@1.0.20` (installed and inspected). Its ESM build is 11,283 bytes, has **zero** `require(`
and **zero** `node:` imports — pure `fetch` + `SubtleCrypto`, so it runs natively in workerd.

Verified signature from `node_modules/aws4fetch/dist/main.d.ts`:

```ts
export class AwsClient {
    constructor({ accessKeyId, secretAccessKey, sessionToken, service, region, cache, retries, initRetryMs }: {…});
    sign(input: Request | { toString: () => string; }, init?: (RequestInit & {
        aws?: {
            accessKeyId?: string;  secretAccessKey?: string; sessionToken?: string;
            service?: string;      region?: string;          cache?: Map<string, ArrayBuffer>;
            datetime?: string;     signQuery?: boolean;      appendSessionToken?: boolean;
            allHeaders?: boolean;  singleEncode?: boolean;
        };
    }) | null | undefined): Promise<Request>;
}
```

Cloudflare's own presigned-PUT example, quoted verbatim from
[R2 → aws4fetch](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/) (page dated
2026-04-21):

```ts
import { AwsClient } from "aws4fetch";

const client = new AwsClient({
	service: "s3", // Required by SDK but not used by R2
	region: "auto", // Required by SDK but not used by R2
	// Retrieve your S3 API credentials for your R2 bucket via API tokens (see: https://developers.cloudflare.com/r2/api/tokens)
	accessKeyId: ACCESS_KEY_ID,
	secretAccessKey: SECRET_ACCESS_KEY,
});

// Provide your Cloudflare account ID
const R2_URL = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

// You can also create links for operations such as PutObject to allow temporary write access to a specific key.
// Specify Content-Type header to restrict uploads to a specific file type.
console.log(
	(
		await client.sign(
			new Request(`${R2_URL}/my-bucket/dog.png?X-Amz-Expires=${3600}`, {
				method: "PUT",
				headers: {
					"Content-Type": "image/png",
				},
			}),
			{
				aws: { signQuery: true },
			},
		)
	).url.toString(),
);
```

Constraints that come with this option, all verbatim from the presigned-URLs and CORS pages:

- Expiry: "Timeout from 1 second to 7 days (604,800 seconds)".
- Methods: `GET`, `HEAD`, `PUT`, `DELETE`. "`POST` (multipart form uploads via HTML forms) is not
  currently supported."
- "Presigned URLs work with the S3 API domain (`<ACCOUNT_ID>.r2.cloudflarestorage.com`) and cannot
  be used with custom domains."
- Browser use requires a bucket CORS policy: "Without a CORS policy, browser-based uploads and
  downloads using presigned URLs will fail, even though the presigned URL itself is valid."
- "Treat presigned URLs as bearer tokens."

#### Option (ii) — upload **through** an authenticated Route Handler using the binding

Cloudflare's own single-upload example, verbatim from
[Upload objects](https://developers.cloudflare.com/r2/objects/upload-objects/) (page dated
2026-07-29):

```ts
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			const object = await env.MY_BUCKET.put("image.png", request.body, {
				httpMetadata: {
					contentType: "image/png",
				},
			});

			if (object === null) {
				return new Response("Precondition failed or upload returned null", {
					status: 412,
				});
			}

			return Response.json({
				key: object.key,
				size: object.size,
				etag: object.etag,
			});
		} catch (err) {
			return new Response(`Upload failed: ${err}`, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
```

In Next.js on OpenNext you reach the binding with `getCloudflareContext`. Verified signature from
`@opennextjs/cloudflare@1.20.6`, `dist/api/cloudflare-context.d.ts`:

```ts
export declare function getCloudflareContext<…>(options: { async: true }):  Promise<CloudflareContext<…>>;
export declare function getCloudflareContext<…>(options?: { async: false }):        CloudflareContext<…>;
```

The same file declares a **global** `CloudflareEnv` interface you extend with your own bindings; it
already ships `ASSETS?: Fetcher` and `IMAGES?: ImagesBinding`, plus (notably) optional
`R2_ACCESS_KEY_ID?: string` / `R2_SECRET_ACCESS_KEY?: string` slots.

#### The limits that decide it

| Limit | Value | Source |
|---|---|---|
| Worker inbound **request body** size | **Free 100 MB · Pro 100 MB · Business 200 MB · Enterprise up to 5 GB** | Workers → Limits (2026-09-05) |
| Worker memory per isolate | 128 MB | Workers → Limits |
| Worker CPU per HTTP request (Paid) | 5 min (**default 30 seconds**) | Workers → Limits |
| Does network waiting count as CPU? | No | Workers → Limits |
| R2 single-part upload max object size | **5 GiB** | R2 → Upload objects / Limits |
| R2 multipart max object size | 5 TiB, up to 10,000 parts | R2 → Upload objects |
| R2 multipart part size | **5 MiB – 5 GiB** per part | R2 → Upload objects |
| Next.js **Server Action** body limit | **1 MB by default** | Next 16.3.5 docs |
| Next.js **Route Handler** body limit | none documented | Next 16.3.5 docs |

Verbatim, Workers → Limits: "Request body size limits depend on your Cloudflare account plan, not
your Workers plan. Requests exceeding these limits return a 413 Request entity too large error."
And: "CPU time measures how long the CPU spends executing your Worker code. Waiting on network
requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU
time."

Verbatim, Next.js `route.js` reference: "Notably, unlike API Routes with the Pages Router, you do
not need to use `bodyParser` to use any additional configuration." — no size cap for Route Handlers.

Verbatim, Next.js `serverActions` reference: "By default, the maximum size of the request body sent
to a Server Action is 1MB, to prevent the consumption of excessive server resources in parsing large
amounts of data, as well as potential DDoS attacks."

**Verdict: Option (ii) — upload through an authenticated Route Handler with `env.PHOTOS.put()`.**

Because:

1. **A 10 MB photo is 10% of the 100 MB request-body limit.** The Worker path is nowhere near a
   ceiling. The presign machinery exists to dodge a limit we will never approach.
2. **CPU cost is ~nil.** Moving bytes from the request into R2 is network-bound, and network waiting
   is explicitly excluded from CPU time. Even buffering 10 MB into an `ArrayBuffer` is 8% of the
   128 MB isolate budget.
3. **Zero new secrets.** The binding needs no Access Key ID / Secret Access Key, so nothing to store
   in `wrangler secret`, nothing to rotate, nothing to leak. Presigning forces long-lived R2
   credentials into the Worker — a strictly larger attack surface for a single-user app.
4. **Zero CORS.** Same-origin `POST /api/photos`. Presigned PUT goes to
   `*.r2.cloudflarestorage.com`, a different origin, and therefore needs a bucket CORS policy the
   app can silently outgrow.
5. **Offline-first is the killer argument.** A presigned URL is minted *before* the upload and
   expires (≤ 7 days, realistically minutes). A background-sync queue that drains hours later will
   hit an expired URL — and, verbatim from R2 → CORS: "Expired presigned URLs return a `403`
   `ExpiredRequest` response. R2 does not include CORS response headers on expired presigned URL
   responses, so browser JavaScript cannot read the error body." The failure is both likely and
   undiagnosable from the client. A same-origin `POST` to our own route has no expiry and is
   trivially retried by Serwist/background sync.
6. **One round trip, one transaction.** The route handler validates (size, declared type, magic
   bytes), writes the object, and writes the D1 row in a single request. Presigning needs a second
   "commit" call after the PUT, which can be lost — leaving orphaned R2 objects that need a
   reconciliation cron.

Choose presign later only if one of these becomes true: uploads exceed ~100 MB (video), you need
resumable/parallel multipart from the browser, or you want R2 bytes to bypass the Worker for cost
reasons at a scale this app will never reach.

#### When multipart becomes necessary

Verbatim from R2 → Upload objects:

| | Single upload (PUT) | Multipart upload |
|---|---|---|
| **Best for** | Small to medium files (under ~100 MB) | Large files, or when you need parallelism and resumability |
| **Maximum object size** | 5 GiB | 5 TiB (up to 10,000 parts) |
| **Part size** | N/A | 5 MiB – 5 GiB per part |
| **Resumable** | No — must restart the entire upload | Yes — only failed parts need to be retried |

And: "Each part must be at least 5 MiB (except the last part)."

**So: single-part `put()` is correct for 1–10 MB photos, and multipart is never needed for them.**
The binding forces the issue anyway — a Worker cannot single-PUT more than its 100 MB request-body
limit regardless of R2's 5 GiB ceiling. Multipart in *this* app only ever becomes relevant for the
Phase 9 "scheduled backup to R2" job, which builds its payload server-side and so is bounded by
memory, not by request body. Even there, prefer many small objects over one multipart object.

---

### 3. Serving: authenticated route handler vs `r2.dev` vs custom domain

| | Authenticated Route Handler + `bucket.get` | Public `r2.dev` dev URL | Custom domain on the bucket |
|---|---|---|---|
| Who can read a photo | only an authenticated session | **anyone on the Internet with the URL** | anyone, unless you add WAF/Access on top |
| Needs a Cloudflare zone | no | no | **yes** — domain must be a zone in the same account |
| Edge cache | via Workers Caching (see gotchas) | **no** | yes (Cloudflare Cache) |
| WAF / Access / Bot Management | in your own code | **not available** | yes |
| Rate limited by Cloudflare | no | **yes** | no |
| Works with `Range` / `ETag` | yes, if you write it (see code) | yes | yes |

Verbatim from [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
(2026-06-16):

> To use features like [WAF custom rules](…), caching, access controls, or [Bot Management](…), you
> must configure your bucket behind a custom domain. These capabilities are not available when using
> the `r2.dev` development url.

> Public access through `r2.dev` subdomains is rate-limited and should only be used for development
> purposes.

> The domain being used must have been added as a [zone](…) in the same account as the R2 bucket.

**Verdict: authenticated Route Handler.** Progress photos and food photos are personal body data;
a public bucket is disqualified on that alone, and `r2.dev` is additionally rate-limited and
explicitly non-production. A custom domain would make the bucket public and then require WAF Token
Authentication or Cloudflare Access bolted in front — more moving parts than a `bucket.get` in a
route we already have to authenticate.

Note `<img src="/api/photos/…">` sends same-origin cookies automatically, so cookie-session auth
works for images with no extra client code. An `<img>` element cannot send an `Authorization`
header — if the app ends up on bearer tokens instead of cookies, the read path needs a short-lived
HMAC query token instead (mint with `crypto.subtle.sign('HMAC', …)`; do not roll a homegrown
scheme).

#### Correct read handler — `ETag`, `If-None-Match`, `Range`, `Cache-Control`

Cloudflare's canonical R2 GET, verbatim from
[Use R2 from Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/):

```ts
      case "GET": {
        const object = await this.env.MY_BUCKET.get(key, {
          onlyIf: request.headers,
          range: request.headers,
        });

        if (object === null) {
          return new Response("Object Not Found", { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);

        // When no body is present, preconditions have failed
        return new Response("body" in object ? object.body : undefined, {
          status: "body" in object ? 200 : 412,
          headers,
        });
      }
```

Three things that example does **not** do, and which we must:

- It returns `412` for any failed precondition. For `If-None-Match` on a `GET` the correct status is
  **`304 Not Modified`**, not `412`. Returning `412` makes browsers re-download every image forever.
- It never returns **`206`** or a **`Content-Range`** header for a ranged read, so a range request
  gets the partial bytes labelled `200 OK` with a full-length semantic — broken for any consumer
  that honours it.
- It sets no `Cache-Control`.

Supporting facts, all verbatim from
[Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/):

- `httpEtag` — "The object's etag, in quotes so as to be returned as a header." Plus the note:
  "Cloudflare recommends using the `httpEtag` field when returning an etag in a response header.
  This ensures the etag is quoted and conforms to RFC 9110."
- `writeHttpMetadata (headers: Headers): void` — "Retrieves the `httpMetadata` from the `R2Object`
  and applies their corresponding HTTP headers to the `Headers` input object."
- `R2HTTPMetadata` fields: `contentType`, `contentLanguage`, `contentDisposition`,
  `contentEncoding`, `cacheControl`, `cacheExpiry`. So **`Cache-Control` set at `put()` time via
  `httpMetadata.cacheControl` is re-emitted for free by `writeHttpMetadata`.**
- Conditional headers: "All conditional headers aside from `If-Range` are supported."
- `R2Range` is one of `{offset, length?}`, `{offset?, length}`, or `{suffix}`.
- `range` on `R2Object` — "A `R2Range` object containing the returned range of the object."

Route handler to write (`app/api/photos/[id]/route.ts`):

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(req: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const session = await requireSession();            // 401 before touching R2
  const { id } = await ctx.params;
  const row = await db.query.photos.findFirst({ where: eq(photos.id, id) });
  if (!row || row.deletedAt) return new Response("Not found", { status: 404 });

  const { env } = await getCloudflareContext({ async: true });
  const object = await env.PHOTOS.get(row.r2Key, {
    onlyIf: req.headers,     // If-None-Match / If-Modified-Since
    range: req.headers,      // Range: bytes=…
  });
  if (object === null) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);                 // Content-Type + Cache-Control from put()
  headers.set("ETag", object.httpEtag);              // already quoted
  headers.set("Accept-Ranges", "bytes");
  // PRIVATE, not public — see gotcha G6. Immutable because keys are content-addressed.
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");

  // Precondition failed => no body on the object.
  if (!("body" in object)) {
    // A GET with If-None-Match that matched is 304; anything else is 412.
    const status = req.headers.has("if-none-match") || req.headers.has("if-modified-since")
      ? 304
      : 412;
    return new Response(null, { status, headers });
  }

  const r = object.range;
  if (r && "offset" in r && typeof r.length === "number") {
    const start = r.offset ?? 0;
    const end = start + r.length - 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(r.length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
```

`UNVERIFIED`: that `object.size` remains the **full** object size (not the slice length) when a
`range` is supplied. The docs describe `size` as "Size of the object in bytes" and `range` as "A
`R2Range` object containing the returned range of the object", and the `workerd` source
(`r2-bucket.c++:198`) populates `size` from the R2 service's `responseReader.getSize()` independently
of the range struct — so the reading is almost certainly correct, but it is not stated. Add one
assertion in the first implementation (`assert(object.size >= (r.length ?? 0))`) and a unit test that
requests `bytes=0-99` on a known 1 MB object and checks `Content-Range` ends in `/1048576`.

For images in this app, `Range` matters less than for video — browsers rarely range-request a JPEG.
Implement it anyway: it is four lines, and `Accept-Ranges: bytes` without correct `206` handling is
worse than not advertising it.

`Cache-Control` set at write time (so `writeHttpMetadata` replays it, and a future custom domain
would honour it too):

```ts
await env.PHOTOS.put(key, bytes, {
  httpMetadata: {
    contentType: "image/jpeg",
    cacheControl: "private, max-age=31536000, immutable",
  },
  customMetadata: { sha256, w: String(width), h: String(height) },
});
```

`immutable` is honest here only because keys are never reused — see §6. If you ever overwrite a key,
drop `immutable` immediately.

---

### 4. Resizing and thumbnails: what actually works, and what it costs

Four candidate mechanisms. All four are real in September 2026; they differ sharply in what they
require.

#### (a) `fetch(url, { cf: { image: { … } } })` — transform via fetch

Typed in `workers-types` as `RequestInitCfPropertiesImage` (`index.d.ts:13514`), with
`format?: "avif" | "webp" | "json" | "jpeg" | "png" | "baseline-jpeg" | "png-force" | "svg"`,
`quality?: number | "low" | "medium-low" | "medium-high" | "high"`, `metadata?: "keep" | "copyright"
| "none"`, `anim?`, `draw?`, plus everything on `BasicImageTransformations` (`width`, `height`,
`fit`, `gravity`, `zoom`).

Verbatim, [Transform via fetch](https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/)
(2026-07-02):

> `cf.image` is available on any zone that hosts a Worker, including `*.workers.dev` subdomains.
> Each transformation is billed to the account that owns the Worker.

So **no zone is required any more** for the Worker path — this is a change from older guidance and
worth knowing. But `cf.image` transforms a **URL**, which means Cloudflare must be able to fetch the
source image over the public Internet. Our photos are auth-gated by design. Making them fetchable
defeats the point. Compounding it, stack-facts requires the `global_fetch_strictly_public` compat
flag for OpenNext, and verbatim from
[Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/):

> When the `global_fetch_strictly_public` compatibility flag is enabled, the global fetch() function
> will strictly route requests as if they were made on the public Internet. […] This means requests
> to a Worker's own zone will loop back to the "front door" of Cloudflare and will be treated like a
> request from the Internet, possibly even looping back to the same Worker again.

A Worker fetching its own `/api/photos/…` with `cf.image` therefore re-enters the Worker — the exact
infinite-loop hazard the Images docs warn about. **Rule out (a) for private photos.**

#### (b) The Images binding — `env.IMAGES`

This is the byte-oriented variant, and it does **not** need a URL. Verbatim,
[Optimize with Workers](https://developers.cloudflare.com/images/optimization/binding/) (2026-09-02):

> The Images binding lets you optimize and manipulate images directly in a Worker. Unlike the URL
> interface, which requires images to be accessible through a URL, the binding works with raw image
> bytes. You can pass images from any source, including Images, R2, a `fetch()` response, or a
> request body.

Config, verbatim:

```jsonc
{
	"images": {
		"binding": "IMAGES", // i.e. available in your Worker on env.IMAGES
	},
}
```

Verified types from `workers-types` (`index.d.ts:15081`, `14852`, `14934`):

```ts
interface ImagesBinding {
  info(stream: ReadableStream<Uint8Array>, options?: ImageInputOptions): Promise<ImageInfoResponse>;
  input(stream: ReadableStream<Uint8Array>, options?: ImageInputOptions): ImageTransformer;
  text(content: string, options: TextOptions): ImageTransformer;
  readonly hosted: HostedImagesBinding;
}
interface ImageTransformer {
  transform(transform: ImageTransform): ImageTransformer;
  draw(image: ReadableStream<Uint8Array> | ImageTransformer, options?: ImageDrawOptions): ImageTransformer;
  output(options: ImageOutputOptions): Promise<ImageTransformationResult>;
}
type ImageOutputOptions = {
  format: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif" | "rgb" | "rgba";
  quality?: number; background?: string; anim?: boolean;
};
```

Caching is **not** automatic. Verbatim from the same page:

> Responses from the Images binding are not automatically cached. Every uncached call performs a full
> decode and re-encode of the source image, which adds unnecessary latency to every request.

…with the fix being `{"cache": {"enabled": true}}` in the Wrangler config plus an explicit
`Cache-Control` passed to `.response({ headers })`.

Hard limit, verbatim from [Limits and formats](https://developers.cloudflare.com/images/get-started/limits/):
"When optimizing with the Images binding, the maximum input size for `.input()` is 20 MB."

#### (c) Cost / plan requirements — and a live documentation conflict

Verbatim from [Images pricing](https://developers.cloudflare.com/images/pricing/) (2026-07-08):

> By default, all users are on the Images Free plan. The Free plan includes access to the
> transformations feature, which lets you optimize images stored outside of Images, like in R2.

> On the Free plan, you can request up to 5,000 unique transformations each month for free.
>
> Once you exceed 5,000 unique transformations:
> * Existing transformations in cache will continue to be served as expected.
> * New transformations will return a `9422` error. […]
> * You will not be charged for exceeding the limits in the Free plan.

| Use case | Metrics | Availability |
|---|---|---|
| Optimize images stored outside of Images | Images Transformed | **Free and Paid plans** |
| Optimize images that are stored in Cloudflare Images | Images Stored, Images Delivered | Only Paid plans |

Paid rate: "First 5,000 unique transformations included + $0.50 / 1,000 unique transformations /
month". Billing note on the binding page: "Calls to the Images binding are billed as unique
transformations […] Calls to `.info()` are free."

**Conflict:** the tutorial
[Transform user-uploaded images before uploading to R2](https://developers.cloudflare.com/images/tutorials/optimize-user-uploaded-image/)
(2026-06-10) states as a prerequisite, verbatim:

> * Add an [Images Paid](…) subscription to your account. This allows you to bind the Images API to
>   your Worker.

The pricing page (2026-07-08) and the binding page (2026-09-02) are both **newer** and neither
mentions a paid requirement; the binding page says only "The Images binding is enabled on a
per-Worker basis." I could not find a changelog entry resolving this (the Images changelog's newest
entry is 2024-04-04). **Treat "the Images binding works on the Images Free plan" as `UNVERIFIED`.**
This is the open decision in §6 below.

#### (d) Client-side downscale before upload — and the format trap

This is where the task's hint needs correcting. **Do not target AVIF, and do not blindly target
WebP.**

From MDN's own `@mdn/browser-compat-data@8.1.1` (`api/HTMLCanvasElement.json`,
`api/OffscreenCanvas.json`):

| Feature | Chrome | Chrome Android | Safari | **iOS Safari** | Firefox |
|---|---|---|---|---|---|
| `canvas.toBlob()` | 50 | 50 | 11 | 11 | 18 |
| `toBlob` `type` = `image/png` | 50 | 50 | 11 | 11 | 18 |
| `toBlob` `type` = `image/jpeg` | 50 | 50 | 11 | 11 | 18 |
| `toBlob` `type` = `image/webp` | 50 | 50 | **NO** | **NO** | 96 |
| `toDataURL` `type` = `image/webp` | 17 | 18 | **NO** | **NO** | 96 |
| `OffscreenCanvas.convertToBlob()` | 69 | 69 | 16.4 | 16.4 | 105 |
| `convertToBlob` `type` = `image/webp` | 69 | 69 | **NO** | **NO** | 105 |

BCD tracks **no** `image/avif` encode subfeature for `toBlob`, `toDataURL` or `convertToBlob` at
all. Independent reports put canvas AVIF **encoding** in Chrome only, absent in Safari and Firefox
(`UNVERIFIED` — blog-tier sources; MDN simply does not track it, which is itself telling).

And the silent-failure mode, verbatim from
[MDN `HTMLCanvasElement.toBlob()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob):

> The desired file format and image quality may be specified. If the file format is not specified,
> or if the given format is not supported, then the data will be exported as `image/png`. Browsers
> are required to support `image/png`; many will support additional formats including `image/jpeg`
> and `image/webp`.

So on an iPhone, `canvas.toBlob(cb, "image/webp", 0.8)` returns a **PNG** — no error, no warning.
A 12 MP camera JPEG "compressed" to PNG typically gets *several times larger*. On a gym Wi-Fi that
is a multi-second upload the user blames on the app.

Second trap: **AVIF as an *input* to Cloudflare Images is Enterprise-only.** From Images → Limits
and formats, input formats list: "PNG · JPEG · GIF (including animations) · WebP (including
animations) · SVG · AVIF\* · HEIC" with the footnote "\*Available on an Enterprise plan." So even if
a future Chrome encodes AVIF client-side, those objects could never be re-transformed server-side on
our plan. (Good news in the same list: **HEIC input is supported**, which matters for iPhone
originals. And AVIF *output* is capped at "Image dimension, AVIF | 1,200 pixels".)

**Recommended client-side pipeline** — feature-detect, never assume:

```ts
// Detect once per session. A canvas that cannot encode the type silently returns PNG.
async function bestLossyType(): Promise<"image/webp" | "image/jpeg"> {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", 0.8));
  return blob?.type === "image/webp" ? "image/webp" : "image/jpeg";
}

export async function prepareUpload(file: File, maxEdge = 1600) {
  // `imageOrientation: "from-image"` is passed EXPLICITLY — see gotcha G4.
  const probe = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(probe.width, probe.height));
  const w = Math.round(probe.width * scale);
  const h = Math.round(probe.height * scale);
  probe.close();

  const bmp = await createImageBitmap(file, {
    imageOrientation: "from-image",
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: "high",          // default is "low" — see gotcha G5
  });

  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();

  const type = await bestLossyType();
  const blob = await canvas.convertToBlob({ type, quality: 0.82 });
  return { blob, type: blob.type, width: w, height: h };   // trust blob.type, not `type`
}
```

MDN, verbatim, on the options used above: `imageOrientation` — "`from-image` (DEFAULT) — Image
oriented according to EXIF orientation metadata, if present"; `resizeQuality` — one of `pixelated`,
`low` (**DEFAULT**), `medium`, `high`. `createImageBitmap` accepts a `Blob` directly, so a `File`
from `<input type="file" capture>` needs no `<img>` round trip.

`OffscreenCanvas.convertToBlob` needs iOS Safari 16.4+; `HTMLCanvasElement.toBlob` works back to iOS
11. Use `OffscreenCanvas` when present (it keeps the work off the main thread in a Worker) and fall
back to a detached `<canvas>` + `toBlob`.

#### Recommended path for this app

**Generate derivatives on the client at capture time; upload them; add no Images dependency.**

| Derivative | Long edge | Format | Purpose |
|---|---|---|---|
| `thumb` | 320 px, q 0.7 | WebP if detected, else JPEG | timeline grid, food-entry list rows |
| `display` | 1600 px, q 0.82 | WebP if detected, else JPEG | compare slider, full-screen view |
| `orig` | untouched | as the camera gave it (HEIC/JPEG) | **progress photos only**, optional |
| (AI input) | 1024 px, q 0.8 | JPEG | sent to Gemini, never stored as a derivative |

Why this is the cheapest correct answer:

- **$0 and no plan ambiguity.** No Images subscription, no 5,000/month transformation ceiling, no
  `9422` error to handle, no exposure to the docs conflict in §4(c).
- **It is the only option that works offline.** Phase 2's DoD is "a full session logs OFFLINE and
  syncs". A photo captured with no network must be resized and queued locally; any server-side
  resize is unavailable at that moment by definition.
- **It shrinks the upload, which is the actual bottleneck.** A 4 MB camera JPEG becomes ~250 KB.
  Server-side transformation would upload the full 4 MB first and *then* shrink it — strictly worse
  for the gym-Wi-Fi case, and it burns R2 storage on bytes we never serve.
- **Two objects beat one plus N transformations.** R2 storage is $0.015/GB-month with 10 GB-month
  free; egress is $0. 3,000 photos × 300 KB ≈ 0.9 GB — comfortably inside the free tier, forever.
- **The AI path needs a downscale anyway.** Gemini bills per input token and a 12 MP photo is pure
  waste. The 1024 px JPEG is required regardless of which resize mechanism we pick elsewhere.

Keep the Images binding as a documented **escape hatch**, not a dependency: if a new UI later needs a
size we did not pre-generate (say a 1200 px hero, or a `next/image` `srcset`), add `env.IMAGES`, run
`.input(object.body).transform({ width }).output({ format: "image/webp" })` inside the existing
authenticated read handler, switch on `cache.enabled = true`, and cap it behind the 5,000/month free
allowance. For `next/image` specifically, `@opennextjs/cloudflare` documents two routes — the Images
binding (`{"images": {"binding": "IMAGES"}}`, recommended) and a custom loader emitting
`/cdn-cgi/image/...` paths, which requires you to "enable Cloudflare Images for your zone" and
therefore a custom domain. Prefer the binding; prefer plain `<img>` with our own pre-generated keys
over `next/image` for user photos entirely.

---

### 5. Object-key scheme

```
photos/{kind}/{yyyy}/{mm}/{id}/{variant}.{ext}
```

Concretely:

```
photos/progress/2026/09/01K4Z8Q2R7N3M5V9J1T6XY0BCD/display.jpg
photos/progress/2026/09/01K4Z8Q2R7N3M5V9J1T6XY0BCD/thumb.webp
photos/progress/2026/09/01K4Z8Q2R7N3M5V9J1T6XY0BCD/orig.heic
photos/food/2026/09/01K4Z9F0P6C2B8H4G7QWERTYUI/display.jpg
exercises/media/<exercise-slug>.gif        # seeded library media, not user content
```

Properties, and why each clause is there:

- **No PII.** No email, no user name, no original filename, no free text. The original filename
  goes in a D1 column if wanted at all — Android camera filenames embed a timestamp, and
  user-supplied names invite path-traversal and Unicode-normalisation bugs in a key that becomes a
  URL path.
- **Sortable.** `yyyy/mm` then a ULID makes `list()` output lexicographic = chronological, which is
  exactly what the "chronological timeline" and "compare slider" screens want, and what a monthly
  archive/GC cron wants (`list({ prefix: "photos/progress/2026/03/" })`).
- **Collision-free without `Math.random`.** Two acceptable generators:
  - `crypto.randomUUID()` — verified present in Workers (`workers-types` `index.d.ts:1295`,
    `randomUUID(): string`, documented as "generate a v4 UUID using a cryptographically secure
    random number generator"). 122 random bits. Not time-sortable on its own, which the `yyyy/mm`
    prefix compensates for at month granularity.
  - **ULID — preferred.** `ulid@3.0.2` (published 2025-11-30, zero dependencies) was inspected:
    `grep -rn "Math.random" dist/` returns **nothing**, and `detectPRNG` uses
    `globalCrypto.getRandomValues` (`dist/browser/index.js:158`). 48-bit ms timestamp + 80 random
    bits, Crockford base32, lexicographically sortable to the millisecond.
    Caveat: the package's `exports` map resolves the `node` condition to `dist/node/index.js`, which
    does `import crypto from 'node:crypto'`. That works with `nodejs_compat` (required anyway per
    stack-facts) but adds a needless polyfill edge. If you would rather not own that risk, a 24-char
    ULID is ~30 lines of `getRandomValues` + base32 you can vendor, or just use
    `crypto.randomUUID()`.
  - Generate the id **on the client**, at capture time, so the offline queue has a stable identity
    before it ever reaches the server, and a retried upload is idempotent (same key, same object).
- **One id, many variants.** `…/{id}/{variant}.{ext}` keeps derivatives together, so deleting a
  photo is `delete()` over a prefix listing instead of three bookkeeping columns. (`delete` accepts
  `string | string[]`, and `DeleteObject` is a **free** operation per R2 pricing.)
- **Key length** is ~60 bytes, far under R2's "Object key length | 1,024 bytes".
- **Never reuse a key.** This is what licenses `Cache-Control: immutable`. A "re-crop" produces a new
  id, not an overwrite. It also sidesteps R2's "Maximum concurrent writes to the same object name
  (key) | 1 per second".
- Lowercase, `[a-z0-9/._-]` only.

### 6. D1 columns

One `photos` table for all user-generated images, referenced by FK from `progress_photos`-style rows
and from `food_entries`. This refines the brief's inline `progress_photos(date, r2_key, pose)` and
`food_entries(… photo_r2_key …)` — the brief explicitly invites refinement per spec, and a single
table stops the two features drifting apart.

```sql
CREATE TABLE photos (
  id            TEXT    PRIMARY KEY,             -- ULID; also the {id} segment of the R2 key
  kind          TEXT    NOT NULL,                -- 'progress' | 'food'  (CHECK constraint)
  r2_key        TEXT    NOT NULL UNIQUE,         -- display variant; the canonical object
  thumb_key     TEXT,                            -- 320px variant, nullable
  orig_key      TEXT,                            -- untouched camera file, nullable
  content_type  TEXT    NOT NULL,                -- 'image/jpeg' | 'image/webp' — from blob.type
  bytes         INTEGER NOT NULL,                -- of r2_key
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  sha256        TEXT,                            -- hex, computed client-side; idempotent retries
  r2_etag       TEXT,                            -- R2Object.etag (UNQUOTED) at write time
  taken_at      INTEGER NOT NULL,                -- unix ms, capture time (device clock, Asia/Almaty)
  uploaded_at   INTEGER NOT NULL,                -- unix ms, server clock
  pose          TEXT,                            -- 'front'|'side'|'back' — progress photos only
  deleted_at    INTEGER,                         -- soft delete; a cron GCs R2 afterwards
  CHECK (kind IN ('progress','food')),
  CHECK (pose IS NULL OR kind = 'progress')
);
CREATE INDEX photos_kind_taken_idx ON photos (kind, taken_at DESC);
CREATE INDEX photos_sha256_idx     ON photos (sha256);
CREATE INDEX photos_gc_idx         ON photos (deleted_at) WHERE deleted_at IS NOT NULL;

-- food_entries gains a FK instead of its own photo_r2_key
ALTER TABLE food_entries ADD COLUMN photo_id TEXT REFERENCES photos(id);
```

Notes:

- **Blobs never go in D1** — the brief already mandates keys only. Enforce it in review.
- `width`/`height` are stored because the UI must reserve layout space before the image loads
  (CLS is in the Phase 9 performance budget) and because `ImagesBinding.info()` is the only other
  way to get them and costs a request.
- `sha256` makes the whole upload idempotent: the offline queue can retry a `POST` and the handler
  can short-circuit on a matching `(kind, sha256)` instead of writing a duplicate object.
- `r2_etag` stores `R2Object.etag`, the **unquoted** form; `httpEtag` is the quoted form and belongs
  only in a response header. Storing the quoted one and comparing against the unquoted one is a
  classic silent-mismatch bug.
- Timestamps as `INTEGER` unix-ms: D1 is SQLite, so there is no native date or boolean type; integer
  ms sorts correctly, indexes well, and maps to Drizzle's `integer("…", { mode: "timestamp_ms" })`.
- `deleted_at` rather than a hard delete: a Worker request should not fan out R2 deletes; let the
  existing Cron Trigger sweep `deleted_at IS NOT NULL` and batch-`delete()` the prefixes.

### 7. Relationship to `stack-facts.md`

Nothing here contradicts stack-facts. Two clarifications and one addition:

- stack-facts says "CPU: 5 min per HTTP request, 15 min per Cron Trigger." The current limits page is
  more granular: CPU per HTTP request on Paid is "5 min (**default: 30 seconds**)" and must be raised
  explicitly in the Wrangler config; CPU per Cron Trigger is "30 seconds (< 1 hour interval) / 15 min
  (>= 1 hour interval)". So the 15 min figure applies only to crons scheduled at intervals of an hour
  or more — relevant to the Phase 9 R2 backup job. **stack-facts is not wrong; it states the
  ceilings.** Do not treat 5 min as the default.
- stack-facts lists R2 prices but not the free tier. Verified: 10 GB-month storage, 1 M Class A
  operations, 10 M Class B operations per month, free; egress always $0. `PutObject` is Class A,
  `GetObject`/`HeadObject` are Class B, `DeleteObject` is free.
- stack-facts requires `global_fetch_strictly_public`. That flag is what rules out the
  `fetch(ownUrl, {cf:{image:…}})` resize path (§4(a)) — the two facts interact, and this note is the
  place that connection is recorded.

---

## Recommendation

| Decision | Choice |
|---|---|
| Presigned PUT from the Worker? | **No.** The binding cannot presign, and presigning solves a problem we do not have. |
| Upload path | `POST /api/photos` — authenticated **Route Handler** → `env.PHOTOS.put()`. Never a Server Action (1 MB default body cap). |
| Upload encoding | Raw body `PUT`/`POST` with `Content-Type` + `X-Photo-*` metadata headers. **Not** `multipart/form-data` — avoids `formData()` parsing cost and the 1 MB Server Action path entirely. |
| Multipart upload | Never, for photos. Single-part `put()` handles up to 5 GiB; the Worker's own 100 MB request-body limit binds first. |
| Serving path | `GET /api/photos/[id]` — authenticated Route Handler → `bucket.get({ onlyIf, range })`, with `ETag` from `httpEtag`, `304` on `If-None-Match`, `206` + `Content-Range` on `Range`, and **`Cache-Control: private, max-age=31536000, immutable`**. |
| Public bucket / `r2.dev` | **No.** Personal body data; also rate-limited and non-production. |
| Custom domain on the bucket | **No**, not for user photos. Reconsider only for the seeded exercise GIF/video library, which is not personal and would benefit from edge cache. |
| Resizing | **Client-side**, at capture: `createImageBitmap(file, { imageOrientation:"from-image", resizeWidth, resizeHeight, resizeQuality:"high" })` → `OffscreenCanvas.convertToBlob`. Upload a 320 px `thumb` and a 1600 px `display`; keep `orig` for progress photos only. |
| Client-side format | **Feature-detected `image/webp`, falling back to `image/jpeg`.** iOS Safari cannot encode WebP and returns a silently larger PNG. |
| AVIF | **Do not use.** No canvas AVIF encoder on iOS/Firefox, MDN tracks none anywhere, and AVIF *input* to Cloudflare Images is Enterprise-only. |
| Cloudflare Images | Not a dependency. Documented escape hatch via the `IMAGES` binding (20 MB input cap, 5,000 free unique transformations/month, `cache.enabled = true` required). |
| Object keys | `photos/{kind}/{yyyy}/{mm}/{ULID}/{variant}.{ext}`, ULID generated **client-side** with `crypto.getRandomValues`. Never `Math.random`. Never reuse a key. |
| D1 | One `photos` table (§6); FK from `food_entries.photo_id`. Keys only, never blobs. |

---

## Gotchas that will silently break us

**G1 — `bucket.put()` with a stream of unknown length throws a `TypeError`.**
Verbatim from `workerd` source, `src/workerd/api/r2-rpc.c++:253-259`:

```cpp
expectedBodySize = stream.tryGetLength(js, StreamEncoding::IDENTITY);
if (expectedBodySize == kj::none) {
  expectedBodySize = streamSize;
}
JSG_REQUIRE(expectedBodySize != kj::none, TypeError,
    "Provided readable stream must have a known length (request/response body or readable "
    "half of FixedLengthStream)");
```

`request.body` from a real HTTP request normally carries a length, which is why Cloudflare's example
works. But a stream that has been `tee()`'d, piped through a plain `TransformStream`, or re-wrapped
by a framework loses it. `UNVERIFIED`: whether `NextRequest.body` under `@opennextjs/cloudflare
1.20.6` preserves the known length. **Mitigation that removes the question entirely:** for ≤10 MB
photos do `await env.PHOTOS.put(key, await request.arrayBuffer(), …)`. An `ArrayBuffer` has a size by
construction, 10 MB is 8% of the 128 MB isolate budget, and you need the bytes in memory anyway to
verify magic bytes and compute a hash. Only reach for `FixedLengthStream` if you later stream
something large.

**G2 — a Server Action will reject the photo at 1 MB.** Next.js 16.3.5 default
`serverActions.bodySizeLimit` is 1 MB, and the docs add that "The limit applies to the raw HTTP
request body, including the bytes that `multipart/form-data` adds for boundaries, part headers, and
field metadata." Use a Route Handler. If someone later "simplifies" the upload into a Server Action,
every photo over ~1 MB starts failing — and the error surfaces as a generic action failure, not a
413.

**G3 — the request-body cap is a *zone/account plan* limit, not a Workers limit.** "Request body size
limits depend on your Cloudflare account plan, not your Workers plan." Free and Pro are both 100 MB,
so we are fine, but do not reason about it from the Workers Paid plan. `UNVERIFIED`: which plan value
applies to a `*.workers.dev` deployment, which is not a zone — assume the 100 MB Free figure.

**G4 — EXIF orientation. Progress photos will appear rotated 90°.** iPhone portraits are stored
landscape with an EXIF orientation tag. Drawing a bitmap to a canvas **discards** EXIF, so the
derivative bakes in whatever orientation the bitmap had. MDN documents `from-image` as the current
default for `createImageBitmap`, but older engines defaulted to `none`. **Pass
`imageOrientation: "from-image"` explicitly, every call.** This one is nasty because it looks fine in
desktop Chrome dev and wrong only on the actual phone — and it breaks the compare slider, which is
Phase 4's entire DoD.

**G5 — `resizeQuality` defaults to `"low"`.** MDN, verbatim: "`low` (DEFAULT)". A 12 MP photo
downscaled with `low` is visibly aliased, which for a *progress photo* app is the whole product
value. Always pass `resizeQuality: "high"`.

**G6 — `Cache-Control: public` on the authenticated photo route leaks every photo.** Workers Caching
keys on path, entrypoint, `ctx.props` and Worker version. Verbatim from
[Cache keys](https://developers.cloudflare.com/workers/cache/cache-keys/):

> Requests that differ only in request headers that are not part of the cache key (for example,
> `User-Agent`, `Accept-Language`, `Cookie`, or `Authorization`) return the same cached response.

So a `public` response for `/api/photos/{id}` would be served from the edge to an **unauthenticated**
request with the same path, bypassing our auth check entirely. Use `private`. Cloudflare also
auto-bypasses: verbatim, "responses with a `Set-Cookie` header and requests with an `Authorization`
header trigger automatic bypass" — but do not rely on a session cookie happening to be refreshed on
that request. `private` is the explicit, correct directive, and browser-level caching is all an
image route actually needs.

**G7 — `Cf-Cache-Status` will say `BYPASS` and someone will "fix" it.** That is the correct state for
G6's reasons. Document it next to the route so nobody flips it to `public` chasing a cache-hit
metric.

**G8 — `304` vs `412`.** Cloudflare's sample returns `412` whenever `onlyIf` fails. For a `GET` with
`If-None-Match` that *matched*, the browser expects `304` and will otherwise re-download the full
image on every view — silently tripling R2 Class B ops and blowing the LCP budget on the timeline
screen. Branch on which precondition header was present (see the handler in §3).

**G9 — advertising `Accept-Ranges: bytes` without emitting `206` + `Content-Range`.** Any client that
takes the hint gets partial bytes labelled `200`. Either implement both or advertise neither.

**G10 — WebP requested, PNG delivered.** `canvas.toBlob`/`convertToBlob` never throw on an
unsupported type; MDN: "if the given format is not supported, then the data will be exported as
`image/png`". On iOS every WebP request becomes a PNG that is *larger* than the source JPEG. Always
read `blob.type` back and store that, never the type you asked for. Add a unit test asserting the
stored `content_type` equals `blob.type`.

**G11 — AVIF input is Enterprise-only.** Images → Limits, input formats: `AVIF*` with
"\*Available on an Enterprise plan." Any AVIF object we store can never be re-transformed
server-side. Combined with G10, AVIF is a dead end on both ends.

**G12 — `cf.image` + `global_fetch_strictly_public` = potential infinite loop.** With that flag
(required by OpenNext), a `fetch()` to our own hostname re-enters the Worker. The Images docs warn:
"you must prevent the Worker from creating an infinite loop", with the guard being
`if (/image-resizing/.test(request.headers.get("via"))) return fetch(request);`. We avoid this
entirely by not using `cf.image` — but if anyone adds it later, that guard is mandatory.

**G13 — the Images binding does not cache.** "Every uncached call performs a full decode and
re-encode of the source image." Without `{"cache": {"enabled": true}}` plus an explicit
`Cache-Control`, a transformed thumbnail is re-encoded on every single view. `UNVERIFIED`: how
`cache.enabled = true` interacts with OpenNext's own incremental cache / `NEXT_INC_CACHE_R2_BUCKET`
and `NEXT_TAG_CACHE_D1` overrides. Test before enabling it globally.

**G14 — the Cache API (`caches.default`) is not the same thing as Workers Caching, and may be inert
here.** Verbatim from [Cache](https://developers.cloudflare.com/workers/runtime-apis/cache/):
"Workers deployed to custom domains have access to functional `cache` operations. So do Pages
functions, whether attached to custom domains or `*.pages.dev` domains." A `*.workers.dev` Worker is
conspicuously absent from that sentence (`UNVERIFIED` whether `caches.default` is a no-op there).
Also: "The `cache.put` method is not compatible with tiered caching", and "For Workers fronted by
Cloudflare Access, the Cache API is not currently available" — which matters because Cloudflare
Access is one of the auth options the brief lists. Workers Caching (`cache.enabled`) explicitly does
work on `workers.dev`. Prefer it; do not hand-roll `caches.default`.

**G15 — presigned-URL expiry is invisible to the browser.** If we ever do adopt presigning: "R2 does
not include CORS response headers on expired presigned URL responses, so browser JavaScript cannot
read the error body." The offline queue would fail with an opaque network error.

**G16 — R2 allows 1 concurrent write per key per second.** "Maximum concurrent writes to the same
object name (key) | 1 per second". Our never-reuse-a-key rule makes this unreachable; a "re-upload
over the same key" retry strategy would hit it.

**G17 — `etag` vs `httpEtag`.** `etag` is bare, `httpEtag` is quoted. Store the bare one in D1, send
the quoted one in the header, and never compare across the two.

**G18 — Images free-tier exhaustion returns `9422`, not a fallback image.** "New transformations will
return a `9422` error." If we ever depend on the binding, broken images appear the moment the 5,000th
unique transformation lands — mid-month, with no warning. Pre-generated client derivatives have no
such cliff.

---

## Open decision for the owner

**Do we take a dependency on Cloudflare Images at all?**

The docs currently disagree about whether the `IMAGES` binding needs a paid plan: the tutorial
(2026-06-10) says "Add an Images Paid subscription to your account. This allows you to bind the
Images API to your Worker", while the newer pricing page (2026-07-08) says the Free plan "includes
access to the transformations feature, which lets you optimize images stored outside of Images, like
in R2" with 5,000 free unique transformations/month, and the newer binding page (2026-09-02) mentions
no plan requirement. I could not resolve this from primary sources.

- **Option A — no Images dependency (recommended).** Pre-generate `thumb` + `display` on the client;
  serve both straight from R2 through the authenticated route. Cost $0. Works offline, which is a
  Phase 2/4 DoD requirement. No plan ambiguity, no 5,000/month cliff, no `9422`. Cost: derivative
  sizes are fixed at capture time, so adding a new size later means either re-deriving from `orig`
  (progress photos only — food photos would have no original) or adding Option B then.
- **Option B — add the `IMAGES` binding now.** One `srcset` for free from any stored object, plus
  `.info()` for dimensions. Cost: possibly $5/mo if the tutorial is right; a 20 MB `.input()` cap;
  `cache.enabled = true` with an unverified interaction with OpenNext's own cache overrides (G13);
  still useless offline.

**Recommendation: Option A.** Ship it, and record in `DECISIONS.md` that the `IMAGES` binding is a
deliberately deferred escape hatch. If the owner wants Option B eventually, the cheap way to settle
the plan question is to open the Cloudflare dashboard → **Images** and read whether the account shows
the Free plan with a transformations quota; no code needed.

A second, smaller decision follows from the brief's auth options: **will the app have a custom
domain on a Cloudflare zone?** It does not affect user photos (which stay behind the Route Handler
either way), but it gates three things — Cloudflare Access as the auth mechanism (which per G14
disables the Cache API), the `/cdn-cgi/image/` `next/image` loader, and putting the seeded exercise
GIF/video library on a cached public custom domain instead of a Worker read path. Recommend deciding
this in Phase 1 alongside the auth choice, not here.

---

## Sources

### Cloudflare docs (fetched as Markdown via `…/index.md`, 2026-09-12; page dates noted)

- R2 Presigned URLs (2026-08-22) — https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 aws4fetch example (2026-04-21) — https://developers.cloudflare.com/r2/examples/aws/aws4fetch/
- R2 Use R2 from Workers — https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
- R2 Workers API reference — https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- R2 Upload objects (2026-07-29) — https://developers.cloudflare.com/r2/objects/upload-objects/
- R2 Platform limits — https://developers.cloudflare.com/r2/platform/limits/
- R2 Pricing (2026-08-07) — https://developers.cloudflare.com/r2/pricing/
- R2 Public buckets (2026-06-16) — https://developers.cloudflare.com/r2/buckets/public-buckets/
- R2 Configure CORS (2026-07-31) — https://developers.cloudflare.com/r2/buckets/cors/
- R2 docs index — https://developers.cloudflare.com/r2/llms.txt
- Workers Limits (2026-09-05) — https://developers.cloudflare.com/workers/platform/limits/
- Workers Cache (2026-07-21) — https://developers.cloudflare.com/workers/cache/
- Workers Cache keys — https://developers.cloudflare.com/workers/cache/cache-keys/
- Workers Cache API runtime (2026-08-14) — https://developers.cloudflare.com/workers/runtime-apis/cache/
- Workers Compatibility flags — https://developers.cloudflare.com/workers/configuration/compatibility-flags/
- Images Transformations overview (2026-05-26) — https://developers.cloudflare.com/images/optimization/transformations/overview/
- Images Transform via fetch (2026-07-02) — https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/
- Images Optimize with Workers / binding (2026-09-02) — https://developers.cloudflare.com/images/optimization/binding/
- Images Limits and formats (2026-06-16) — https://developers.cloudflare.com/images/get-started/limits/
- Images Pricing (2026-07-08) — https://developers.cloudflare.com/images/pricing/
- Images tutorial, transform before R2 upload (2026-06-10) — https://developers.cloudflare.com/images/tutorials/optimize-user-uploaded-image/ *(the page whose "Images Paid" prerequisite conflicts with the two above)*

### Package sources read directly (installed in the session scratchpad)

- `@cloudflare/workers-types@5.20260911.1` — `index.d.ts`: `R2Bucket` 2486–2516, `R2ObjectBody` 2547, `R2Range` 2556, `R2Conditional` 2568, `R2GetOptions` 2575, `R2PutOptions` 2580, `R2HTTPMetadata` 2613, `crypto.randomUUID` 1295, `ImageTransform` 14852, `ImageInputOptions` 14931, `ImageOutputOptions` 14934, `ImagesBinding` 15081, `ImageTransformer` 15112, `RequestInitCfPropertiesImage` 13514
- `aws4fetch@1.0.20` — `dist/main.d.ts` (`AwsClient.sign`, `aws.signQuery`); `dist/aws4fetch.esm.mjs` (11,283 bytes, no `node:` imports)
- `@opennextjs/cloudflare@1.20.6` — `dist/api/cloudflare-context.d.ts` (`getCloudflareContext` overloads, global `CloudflareEnv`)
- `ulid@3.0.2` — `dist/browser/index.js:154-169` (`detectPRNG` → `getRandomValues`); no `Math.random` anywhere in `dist/`
- `@mdn/browser-compat-data@8.1.1` — `api/HTMLCanvasElement.json`, `api/OffscreenCanvas.json`, `api/createImageBitmap.json`
- `workerd` source (GitHub `main`) — `src/workerd/api/r2-rpc.c++:240-266` (known-length `TypeError`), `src/workerd/api/r2-bucket.c++:154-199, 851-870`

### Other primary sources

- Next.js 16.3.5 `route.js` reference — https://nextjs.org/docs/app/api-reference/file-conventions/route
- Next.js 16.3.5 `serverActions` config — https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- OpenNext Cloudflare image optimization — https://opennext.js.org/cloudflare/howtos/image
- MDN `HTMLCanvasElement.toBlob()` — https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- MDN `createImageBitmap()` — https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap

### Local files read

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

### Secondary / blog-tier (used only for the AVIF-encode claim, marked `UNVERIFIED` inline)

- Reports that canvas AVIF encoding exists in Chrome only, absent in Safari/Firefox as of 2026 — e.g. https://avifkit.com/blog/avif-browser-support and https://dev.to/profostropher/canvasconverttoblob-doesnt-throw-on-a-format-it-cant-encode-it-hands-you-a-png-5ce3. MDN's BCD tracks no AVIF encode subfeature at all.
- The `bucket.put` known-length error as encountered in practice — https://github.com/cloudflare/workers-sdk/issues/6425, https://github.com/cloudflare/miniflare/issues/506 *(the authoritative form of this is the `workerd` source quoted in G1)*
