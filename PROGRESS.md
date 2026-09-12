# PROGRESS

**Live:** https://fitness-pwa.tairkaldybayev.workers.dev · **Repo:** github.com/tairqaldy/fitness-pwa

## Current state — Phase 2 in progress

Phases 0 and 1 are **deployed and verified in production**. Phase 2 (workouts) has its schema and
supporting layers landed but no UI yet.

## Done

- **Planning** — `specs/00-brief.md` + 16 module specs (~17k lines), each drafted, adversarially
  critiqued and revised. 12 verified research notes in `docs/research/`, several backed by real
  probe apps rather than doc reading.
- **Phase 0 — scaffold, deployed.** Next 16.3.5, TS strict, Tailwind v4 OLED/lime theme, shadcn.
  D1 + R2 + KV provisioned and bound. `/api/health` round-trips every binding in prod.
  CI workflow (typecheck, lint, format, test, migration-drift, build).
- **Phase 1 — foundation, deployed.** Password + TOTP auth with a year-long session cookie;
  installable PWA with a precached offline shell; RU/EN i18n with the timezone pinned; bottom tab
  nav and the authenticated route group.
- **Calculators** — `src/lib/calc`, 100% covered: e1RM (Epley/Brzycki/RPE + max rule), RPE grid,
  Navy body fat, EMA trend weight, adaptive TDEE, plate and warm-up math, volume and rolling
  windows.
- **Phase 2 partial** — the 7 workout tables + migration `0002_workouts.sql`; rest timer
  (deadline-based, survives a locked screen); sync backoff and conflict resolution.

633 tests passing. Typecheck, lint, format and drizzle-check all clean.

## Next up

1. **Apply migration 0002 to remote** — `npm run db:migrate:remote`. It is applied locally only.
   Audited already: 7 CREATE TABLE + 25 CREATE INDEX, no destructive statements.
2. **Write `tests/db/schema.test.ts`** — the schema agent was stopped before writing them
   (GLOB checks present, syncCols present, index naming, enum lengths: MUSCLES 17, EQUIPMENT 13).
3. **Exercise library seed** (spec 08 + r07): download free-exercise-db, normalise to our
   taxonomy, images to R2, rows to D1, idempotent with a dry-run.
4. **Workout logging UI** (spec 06): set rows, number pad, previous-set ghosting, supersets,
   live e1RM, PR detection with confetti.
5. **Dexie outbox + flush + `/api/sync`** (spec 05) — the remaining sync work; the pure parts
   are done.
6. Then phases 3–9: programs, body/photos, nutrition AI, dashboard, gamification, coach and
   Telegram cron, export/import.

## Blocked on the owner

- [ ] **Gemini API key** for the food-photo AI (`GOOGLE_GENERATIVE_AI_API_KEY`). I do not create
      API keys. Set with `npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY`. Everything else
      ships without it; the AI features degrade gracefully.
- [ ] **Telegram bot token + chat id** for notifications, same reason. `TELEGRAM_BOT_TOKEN`,
      `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`.
- [ ] **Run first-run setup** at `/setup` to choose your own password and enrol TOTP. Nobody but
      you should do this, and the route closes permanently afterwards.
- [ ] Decide: scheduled jobs in the app Worker via a custom `worker.ts` (recommended) vs a
      separate cron Worker. Only matters at Phase 8.

## Session log

**2026-09-12/13** — Research verified and corrected (AI SDK is v7 not v5; Serwist no longer needs
webpack; Workers cron CPU is 30s for sub-hourly schedules). Phases 0 and 1 built and deployed.
Calculator layer completed at 100% coverage. Phase 2 schema and sync primitives landed.
Bugs caught by verifying against production rather than assuming: `/~offline` returned 401 because
the proxy matcher missed the tilde (would have broken the whole SW install); `getTranslations` on
the offline page silently made it dynamic and dropped it from the precache; `navigateFallback`
does not exist on modern Serwist; r09's "Epley equals Brzycki at 10 reps" is false in IEEE-754 at
20 kg and 100 kg. Stopped mid-Phase-2 at the owner's request (usage limits).
