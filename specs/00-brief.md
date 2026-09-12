# 00 — Source brief (product definition, authoritative intent)

This is the authoritative product brief. Every other spec in `specs/` refines one slice
of it. Stack facts that override the brief's stale version claims live in
[`docs/research/stack-facts.md`](../docs/research/stack-facts.md).

## Vision & principles

A delightful, data-rich, mobile-first fitness PWA for **one** user. Used in the gym, on a
phone, one-handed. Core jobs:
1. log workouts fast
2. track body measurements & progress photos
3. count calories by photographing food (AI)
4. at-a-glance dashboards with strong visualizations
5. evidence-based gamification so the user trains CONSISTENTLY

Principles: **speed-of-logging above all**; offline-first; beautiful and fun
(micro-interactions, haptics, confetti); **honest data** (show AI confidence, let the user
correct); "everything and more" — err toward richer features and visualizations.

## User

- Single user (Tair, Astana, Kazakhstan). No multi-tenant, no social feed.
- Simple secure auth: passkey/WebAuthn OR magic link (Resend) OR Cloudflare Access in front.
  Pick the simplest secure option; record it in DECISIONS.md.
- Mobile-first installable PWA, offline-first, used in the gym.
- i18n RU/EN (default RU). Units kg. Timezone Asia/Almaty.

## Tech stack (see stack-facts.md for pinned versions)

Next.js App Router + TypeScript strict + Tailwind v4 + shadcn/ui + Radix + Motion.
Drizzle ORM + Cloudflare D1. Deploy via `@opennextjs/cloudflare` to Workers. R2 for photos
(store object keys only, never blobs, in D1). KV for cache. Cron Triggers for reminders and
weekly reports. PWA via Serwist. Web Push via VAPID. Offline data via Dexie/IndexedDB +
background sync + optimistic UI.

AI through the **Vercel AI SDK with a provider-abstraction module**: one module exports
`getVisionModel()` / `getTextModel()` reading `AI_PROVIDER`; default Google Gemini Flash for
food vision, swappable to anthropic()/openai() by env change alone. All structured outputs
go through `generateObject` + Zod. **No provider SDK is imported anywhere else.**

Telegram Bot API for notifications. Recharts for standard charts, visx for the custom SVG
muscle heatmap. Exercise data seeded from free-exercise-db, media in R2. Nutrition DBs:
Open Food Facts (barcode, free), USDA FoodData Central (free, key), Nutritionix (optional).

## Feature modules

1. **WORKOUTS** — start empty or from a routine; log sets with weight, reps, RPE, RIR and set
   type (warmup/working/drop/failure); automatic rest timer with haptics + push + countdown;
   supersets first-class and timer-aware; plate calculator; warm-up set calculator;
   previous-set ghosting (prefill last session values); live e1RM per set via
   Epley `w*(1+r/30)` cross-checked with Brzycki `w*36/(37-r)` and, when RIR is given, an
   RPE-table estimate — take the highest; live PR detection with confetti + haptic;
   progressive-overload suggestions (double progression) with configurable increments and
   microloading.
2. **EXERCISE LIBRARY** — 1000+ exercises with GIF/video, primary/secondary muscles,
   equipment; fuzzy search + filters; user-created custom exercises.
3. **PROGRAMS/ROUTINES** — prebuilt templates (PPL, Upper/Lower, Full-body, 5/3/1, GZCLP,
   nSuns); routine builder; auto-progression schemes; scheduled deload weeks.
4. **BODY & PHOTOS** — bodyweight with EMA-smoothed trend; waist/chest/arms/thighs/etc;
   body fat via US Navy method; progress photos with side-by-side compare slider + overlay +
   chronological timeline (R2).
5. **NUTRITION & FOOD PHOTO AI** — camera then multi-item detection, portion estimation
   (ask for a reference object when possible), per-item macros + calories, overall confidence
   score, structured JSON (Zod); then an **editable correction loop** the user confirms before
   saving. Natural-language logging ("2 eggs and toast"). Barcode via Open Food Facts.
   Macro/calorie targets. **Adaptive TDEE** (MacroFactor-style): back-calculate expenditure
   from bodyweight trend vs logged intake over a rolling window; Mifflin-St Jeor /
   Katch-McArdle only as the initial prior; recompute weekly. Water intake, fasting timer,
   meal templates, micronutrients where available. Log EVERY AI call to `ai_prompt_logs`
   (model, prompt_version, input ref, output json, token cost).
6. **CHECK-INS & RECOVERY** — sleep, mood, energy, soreness, steps; computed readiness score;
   per-muscle recovery estimate from recent volume.
7. **DASHBOARD & ANALYTICS** — GitHub-style calendar heatmap; SVG muscle heatmap (color
   intensity = rolling-7-day volume per muscle, tap a muscle for contributing exercises);
   volume charts; e1RM progression curves; bodyweight trend with EMA; Apple-style macro rings;
   body-composition charts; PR feed; weekly volume-per-muscle-group with under-trained flags.
8. **GAMIFICATION (evidence-based)** — streaks WITH freeze + grace days + adherence %, and
   **NEVER a hard binary reset to zero** (hard resets trigger rage-quit / abstinence-violation
   effect); weekly streaks in addition to daily; XP/levels; achievements/badges; quests/weekly
   challenges; weekly review ritual; monthly report card; Spotify-Wrapped-style year-in-review;
   optional geolocation gym check-in. Reminders gentle/encouraging, **never guilt-based**.
9. **AI COACH** — weekly review summary in natural language; plateau detection (e1RM
   flatlines); deload suggestions; program-adjustment proposals. All via the abstraction.
10. **NOTIFICATIONS / TELEGRAM** — Cron-scheduled reminders; gentle streak-at-risk nudge;
    weekly report to Telegram; web push. Bot locked to the single user's chat id.
11. **SETTINGS / DATA** — units, theme, i18n; export CSV + JSON; import from Hevy / Strong /
    MyFitnessPal CSV; scheduled backup to R2.

## Data model (starting point — refine per spec)

`users; settings; exercises(name, primary_muscles, secondary_muscles, equipment, media_url);
programs; routines; routine_exercises(target_sets, target_reps, progression_scheme);
workouts(date, duration, notes); sets(workout_id, exercise_id, weight, reps, rpe, rir, type,
is_pr); body_measurements(date, weight, waist, chest, arm, thigh, body_fat);
progress_photos(date, r2_key, pose); foods; meals; food_entries(datetime, photo_r2_key,
ai_estimate_json, confidence, corrected_json, calories, protein, carbs, fat); water_logs;
daily_checkins(date, sleep, mood, energy, soreness, steps, readiness); goals; achievements;
streaks(current, longest, freeze_count, grace_used, last_active);
personal_records(exercise_id, type, value, date);
ai_prompt_logs(model, prompt_version, input_ref, output_json, cost, created_at)`
plus indexes for date-range and per-exercise queries.

## Design system (concrete, not generic)

Dark-first, true OLED black `#000` canvas. **One** vivid accent (electric lime ~`#C6FF00`)
used sparingly for CTAs, PRs, active states; muted grays for chrome. Large numeric readouts
(session volume, e1RM, calories) in a tabular/mono display face; body in a clean sans
(Inter/Geist). Generous rounded cards (radius ~20px), soft shadows, subtle glassy layers.
Bottom tab nav + central FAB quick-add; logging in bottom sheets; swipe to complete/delete
sets. A dedicated **GYM MODE** workout screen: 56px+ buttons, minimal chrome, rest timer
front-and-centre, one-handed reach, screen kept awake. Motion spring transitions; confetti +
haptic on PR; skeletons; optimistic UI; respect `prefers-reduced-motion`.

## Non-functional requirements

- **Offline-first**: a full workout is loggable with no network and syncs later
  (queue + background sync + conflict resolution).
- **Performance**: LCP < 2.5s on mid-range mobile; per-route client JS < 200KB gzipped;
  responsive AVIF images via R2/Images.
- **Accessibility**: WCAG AA, visible focus, semantic landmarks, reduced-motion, large taps.
- **Security**: auth on all routes; presigned/signed R2 URLs; no secrets in the client bundle;
  rate-limit AI + auth routes; validate every input with Zod.

## Phases (one per session, each with a Definition of Done)

- **0 Scaffold** — Next+TS strict+Tailwind+shadcn; Drizzle + D1 local + first migration;
  OpenNext hello-world deploy; CI (typecheck+lint+build). DoD: deploys, migration runs, page live, docs exist.
- **1 Foundation** — auth; PWA shell (Serwist, installable, offline fallback); i18n RU/EN;
  dark theme; bottom nav. DoD: installs to home screen, works offline (shell), login works.
- **2 Workouts + Library** — seed exercises + media to R2; logging; rest timer; e1RM; PR
  detection; plate/warm-up calculators; ghosting; supersets. DoD: a full session logs OFFLINE and syncs.
- **3 Programs** — routines, auto-progression, deloads. DoD: a full PPL program runs with progression.
- **4 Body & Photos** — R2 presigned upload, compare slider, EMA trend, Navy BF. DoD: compare + trend render.
- **5 Nutrition + Food AI** — vision pipeline, correction loop, barcode, adaptive TDEE, water, fasting.
  DoD: photo to editable macros saved; barcode lookup works.
- **6 Dashboard** — calendar heatmap, visx muscle heatmap, e1RM curves, volume charts, macro rings.
  DoD: both heatmaps render from real data.
- **7 Gamification** — streaks w/ freeze+grace+adherence, XP/levels, achievements, weekly review,
  monthly report card. DoD: streak survives a grace day; achievements unlock.
- **8 AI Coach + Notifications** — Cron reminders, weekly Telegram report, streak-at-risk nudge.
  DoD: weekly Telegram report fires from Cron.
- **9 Data & Polish** — export/import, performance, a11y. DoD: acceptance checklist green.

## Final acceptance checklist

- [ ] Installable PWA, passes Lighthouse PWA + performance budget
- [ ] Log a full workout fully offline, then it syncs on reconnect
- [ ] Rest timer, e1RM, PR-with-confetti, supersets, plate calc all work
- [ ] Food photo to multi-item macros with confidence, user edits, saved; barcode works
- [ ] SVG muscle heatmap + calendar heatmap render from real data
- [ ] Streak survives a grace day (no hard reset to zero); achievements unlock
- [ ] Weekly report delivered to Telegram via Cron Trigger
- [ ] CSV/JSON export + Hevy/Strong/MFP import work
- [ ] All calculators covered by passing unit tests; smoke test green
