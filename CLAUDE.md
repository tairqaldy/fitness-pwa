# CLAUDE.md — project brain

Single-user, mobile-first fitness PWA (workout logging, body tracking, AI food-photo calorie
counting, dashboards, evidence-based gamification) for one owner in Astana, Kazakhstan. Used
one-handed in the gym. Russian by default. Deployed to Cloudflare Workers.

**Live:** https://fitness-pwa.tairkaldybayev.workers.dev

## Stack (pinned — verify before changing)

| Thing | Version | Note |
|---|---|---|
| next | 16.3.5 | App Router. `middleware.ts` is now **`proxy.ts`** |
| react | 19.2.8 | |
| @opennextjs/cloudflare | 1.20.6 | NOT vinext — C3's default would silently switch adapters |
| wrangler | 4.131.1 | |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | |
| tailwindcss | 4.3.3 | no `tailwind.config.js`; theme is `@theme` in globals.css |
| ai (Vercel AI SDK) | 7.x | **v7, not v5.** `generateObject` still exists |
| zod | 4.6.2 | |
| serwist | 9.5.12 | **configurator mode**, not `@serwist/turbopack` |
| next-intl | 4.14.4 | "without i18n routing" mode, cookie locale |
| vitest | 5.0.0 | |

## Commands

```bash
npm run dev              # serwist watch + next dev (real D1/R2/KV bindings)
npm run build            # next build && serwist build   <- order matters
npm run typecheck        # next typegen && tsc && tsc -p tsconfig.sw.json
npm run lint             # eslint . --max-warnings 0
npm run format:check     # prettier
npm test                 # vitest run
npm run test:coverage    # enforces 100% on src/lib/calc
npm run db:generate      # drizzle-kit generate  (developer TTY only)
npm run db:migrate:local # wrangler d1 migrations apply --local
npm run db:migrate:remote
npm run cf-typegen       # regenerate cloudflare-env.d.ts after ANY wrangler.jsonc change
npm run deploy           # opennextjs-cloudflare build && deploy
npm run tail             # wrangler tail
npm run icons            # regenerate PWA icons
```

## Cloudflare bindings — a typo fails SILENTLY

| Binding | Resource |
|---|---|
| `DB` | D1 `fitness-pwa-db` (region EEUR) — app data |
| `NEXT_TAG_CACHE_D1` | D1 `fitness-pwa-cache-db` — **separate DB on purpose** (OpenNext's own tables) |
| `MEDIA` | R2 `fitness-pwa-media` — photos, exercise media. Never public |
| `NEXT_INC_CACHE_R2_BUCKET` | R2 `fitness-pwa-cache` |
| `CACHE_KV` | KV |
| `WORKER_SELF_REFERENCE` | service binding to self |

No `NEXT_CACHE_DO_QUEUE` and no `queue` override in `open-next.config.ts` — they must be added
together or the cache silently misbehaves.

## Non-negotiable conventions

- **No `export const runtime = "edge"`.** Unsupported by OpenNext.
- **Never touch a binding at module scope.** Use `getDb()` inside the request.
  `getCloudflareContext()` **throws inside `scheduled`** — cron code takes `env` explicitly.
- Any page/route reading D1 must be `dynamic = "force-dynamic"`, or a build-time prerender bakes
  local rows into production HTML.
- **`src/lib/calc` is pure**: no I/O, no `Date.now()`, no zero-arg `new Date()`. Every function
  that needs the time takes it as a parameter. A test greps for violations. 100% coverage.
- **Never compare two computed weights with `===`.** Epley and Brzycki are not bit-identical even
  when algebraically equal (fails at 20 kg and 100 kg). Use the epsilon helper.
- Units: kg (`real`, microloading needs 1.25), kcal/grams/ml as integers, instants as
  `integer({mode:"timestamp_ms"})`, calendar days as `'YYYY-MM-DD'` **in Asia/Almaty**.
- Timezone: derive days via `src/lib/time.ts` only. Workers default to UTC; a raw epoch gives the
  wrong day for 5 hours out of 24. Almaty was **UTC+6 before 2024-03-01**.
- IDs are client-mintable ULIDs (`src/lib/ids.ts`) so rows created offline keep their identity.
- All AI calls go through the provider abstraction; no file imports a provider SDK directly.
  Never use a floating model alias — pin the id, and log it.
- Validate every input with Zod. No secrets in client bundles (only `NEXT_PUBLIC_*`).
- API routes answer **401 JSON, never a 302 to HTML** — otherwise the service worker caches a
  login page under an API key.
- Tap targets ≥ 56px in gym mode (`min-h-tap`). Lime is never body text.
- AI estimates are always shown with confidence and are always user-correctable.

## Ask before

- Any schema-breaking migration. On D1 a table recreation **silently deletes child rows**.
- Applying a migration to `--remote`, or anything that deletes data.
- Swapping or adding a dependency.
- Changes that cost money (model tier, new paid service).

## Layout

```
specs/            00-brief + 16 module specs — the contract. 02-data-model is canonical
docs/research/    12 verified notes; stack-facts.md overrides the brief on versions
src/app/          routes. (app)/ = authenticated shell; ~offline must stay STATIC
src/components/   ui/ = shadcn, nav/, workout/
src/db/           schema/ + enums + columns
src/server/db/    the only place a drizzle client is built
src/lib/calc/     pure calculators (100% covered)
src/lib/sync/     offline outbox: backoff, conflict resolution
src/lib/auth/     session, password (PBKDF2), TOTP, require-session (THE boundary)
messages/         ru.json (source of truth) + en.json — keys must match, a test enforces it
drizzle/migrations/
```

## Session loop

Read `PROGRESS.md` → plan → implement one phase → run every gate → verify **against production**,
not just locally → update `PROGRESS.md` and `DECISIONS.md` → conventional commit → **push**.

Commit and push at every milestone; do not accumulate work locally.

## Do not

- Edit a test to make it pass. Fix the code. (Exception: a test whose *premise* is faulty — fix
  the premise and say so.)
- Edit an applied migration.
- Pipe a gate to `tail` in a `&&` chain — it swallows the exit code. Use `set -o pipefail`.
- Guilt-trip the user in any copy. Streaks never hard-reset to zero.
- Trust a spec or research note over reality: verify against the deployed app.
