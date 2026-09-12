# Verified stack facts (checked 2026-09-12)

All version numbers below were read from the npm registry, the installed `.d.ts`
files, or official docs on 2026-09-12. **Do not trust the numbers in the original
project brief** — several were stale. Re-verify before pinning anything new.

## Latest published versions (npm, 2026-09-12)

| Package | Version | Note |
|---|---|---|
| `next` | 16.3.5 | peer: `react ^19` |
| `@opennextjs/cloudflare` | 1.20.6 | |
| `wrangler` | 4.131.1 | |
| `drizzle-orm` | 0.45.2 | |
| `drizzle-kit` | 0.31.10 | |
| `tailwindcss` | 4.3.3 | |
| `ai` (Vercel AI SDK) | **7.0.99** | brief said v5 — WRONG |
| `@ai-sdk/google` | 4.0.69 | peer: `zod ^3.25.76 \|\| ^4.1.8` |
| `@ai-sdk/anthropic` | 4.0.53 | |
| `@ai-sdk/openai` | 4.0.66 | |
| `zod` | 4.6.2 | use zod 4 |
| `serwist`, `@serwist/next`, `@serwist/turbopack` | 9.5.12 | |
| `motion` | 13.2.0 | successor to framer-motion |
| `recharts` | 3.10.1 | |
| `@visx/visx` | 4.0.0 | |
| `dexie` | 4.4.6 | |
| `vitest` | 5.0.0 | |
| `@playwright/test` | 1.63.0 | |

## AI SDK v7 — corrections to the brief

- `generateObject` **still exists** in `ai@7` (verified in `ai/dist/index.d.ts:7730`).
  Use it for structured output. The newer `generateText({ output: Output.object({schema}) })`
  form also exists; `generateObject` is the simpler choice for our one-shot calls.
- Image input in messages uses a **file part**, not a bare `image` part:
  `{ type: 'file', mediaType: 'image/jpeg', data: <Uint8Array|base64|URL> }`.
- Env var for Google: `GOOGLE_GENERATIVE_AI_API_KEY`.
- Google structured output caveat: Gemini's OpenAPI-3.0 schema subset rejects some
  Zod features (unions, records). Workaround is
  `providerOptions: { google: { structuredOutputs: false } }` which falls back to
  JSON-mode + client-side validation. **Keep food schemas union-free and record-free.**

## Gemini model IDs + price (Google AI pricing page, 2026-09-12)

Vision-capable, per 1M tokens (input / output):

| Model ID | Input | Output |
|---|---|---|
| `gemini-2.5-flash-lite` | $0.10 | $0.40 |
| `gemini-3.1-flash-lite-preview` | $0.25 | $1.50 |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 |
| `gemini-3.5-flash` | — | — (mid tier) |
| `gemini-3.7-flash` / `gemini-3.8-flash` | $0.75 | $3.75 |

Floating aliases also exist: `gemini-flash-latest`, `gemini-flash-lite-latest`.
**Never use a floating alias in code** — food-estimate output must be reproducible and
attributable to a pinned model id stored in `ai_prompt_logs`.

## OpenNext on Cloudflare — exact requirements

- `wrangler.jsonc` needs compat flags `nodejs_compat` **and** `global_fetch_strictly_public`;
  `compatibility_date` >= `2024-12-30`.
- `main: ".open-next/worker.js"`, `assets: { directory: ".open-next/assets", binding: "ASSETS" }`.
- Hardcoded binding names (typo = silent cache failure):
  - `NEXT_INC_CACHE_R2_BUCKET` (R2, incremental cache)
  - `NEXT_TAG_CACHE_D1` (D1, tag cache)
  - `NEXT_CACHE_DO_QUEUE` (Durable Object queue, class `DOQueueHandler`)
  - `WORKER_SELF_REFERENCE` (service binding to the worker itself)
- `open-next.config.ts` wires those via
  `@opennextjs/cloudflare/overrides/{incremental-cache/r2-incremental-cache,queue/do-queue,tag-cache/d1-next-tag-cache}`.
- `initOpenNextCloudflareForDev()` must be called from `next.config.ts` for local dev bindings.
- `export const runtime = "edge"` is unsupported — never use it.
- Scripts: `preview` = `opennextjs-cloudflare build && opennextjs-cloudflare preview`,
  `deploy` = `opennextjs-cloudflare build && opennextjs-cloudflare deploy`.

## Serwist — correction to the brief

The brief says "Serwist requires Webpack". **Outdated.** Serwist 9.5 offers two
Turbopack-compatible paths:
1. `@serwist/turbopack` — `import { withSerwist } from "@serwist/turbopack"`.
2. **Configurator mode** (`@serwist/next/config` + `@serwist/cli`) — builds the SW
   *after* Next prerenders, so prerendered routes are precached automatically. Does not
   touch bundler internals, so it works with Turbopack.
Neither requires `next build --webpack`. Phase 1 must pick one and record it in DECISIONS.md.

## Worker platform limits that constrain design

- CPU: 5 min per HTTP request, 15 min per Cron Trigger. Memory 128 MB.
- R2 egress is $0; storage $0.015/GB-mo; Class A $4.50/M ops, Class B $0.36/M ops.
- D1 free tier 5 GB storage, 5M reads/day.
- Workers Paid $5/mo covers 10M requests + 30M CPU-ms.
