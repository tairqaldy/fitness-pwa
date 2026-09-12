# R07 — Exercise dataset: source, schema, taxonomy, seeding plan

Research date: **2026-09-12**. Verified by direct download + inspection of the dataset, the
GitHub REST API, the wger v2 API, and Cloudflare's own docs. Every claim not marked
`UNVERIFIED` was checked against a primary source on that date.

Supersedes nothing. Consumed by: `specs/` Phase 2 (Workouts + Library) and Phase 6 (muscle
heatmap). Does not contradict [`stack-facts.md`](./stack-facts.md); one discrepancy to check
is flagged in [Gotchas #26](#26-a-stack-facts-number-to-re-check-not-a-contradiction).

---

## Question

1. Is `yuhonas/free-exercise-db` the right exercise library source? What exactly is its
   licence, record shape, size, and URL pattern? Are the images JPG or GIF, and how big is
   the R2 seeding job?
2. Do we need `wger` or ExerciseDB (RapidAPI) as a fallback or supplement?
3. What canonical muscle-group taxonomy should the SVG body map normalise to, and what
   equipment taxonomy?
4. What is the concrete, idempotent, re-runnable seeding plan (download → transform → D1 +
   R2), and how do we attribute the licence in-app?

---

## Verified answer

### 1. Repository identity

`GET https://api.github.com/repos/yuhonas/free-exercise-db` → 2026-09-12:

```json
{
  "full_name": "yuhonas/free-exercise-db",
  "description": "Open Public Domain Exercise Dataset in JSON format, over 800 exercises with a browsable public searchable frontend",
  "default_branch": "main",
  "size_KB": 96992,
  "license": { "key": "unlicense", "name": "The Unlicense", "spdx_id": "Unlicense" },
  "stargazers": 1867,
  "pushed_at": "2026-08-30T07:30:00Z",
  "archived": false,
  "homepage": "https://yuhonas.github.io/free-exercise-db/"
}
```

- `main` HEAD on 2026-09-12: **`a859101d633a01c4a1a920d6a8ce41dabba0705f`** (2026-08-30T07:30:00Z).
- Last commit touching `dist/exercises.json`: `79ca7b47d77cd5a6dd7a50440e9f0bf24da6a142`
  (2026-08-29, *"feat: add Kettlebell halo and overhead extension exercises (#28)"*).
- **No git tags. No GitHub releases.** The only pinnable ref is a commit SHA.

### 2. Licence — two separate answers, and this is the whole legal story

**The repository / data files: Unlicense (public domain).** `GET /repos/yuhonas/free-exercise-db/license`
returns `path: LICENSE.md`, `spdx_id: Unlicense`, content quoted verbatim:

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.
[...]
For more information, please refer to <https://unlicense.org>
```

**The images: copyright status is unknown-to-infringing, stated by the original author.**
This is the single most important finding in this note. The repo is a rework of
`wrkout/exercises.json`. That upstream project's own `CONTRIBUTING.md` (lines 43–48,
`https://raw.githubusercontent.com/wrkout/exercises.json/master/CONTRIBUTING.md`) says,
verbatim, typos included:

```text
#### Exercise Images

**NB:** Any help in creating digital copyright free images for each exercise would be extremely helpful.

Currently all exercises have two images, these have been scrapped off the internet, therefore l do not own the copy right for these images and would advise against using them in comercial projects.
```

The `free-exercise-db` maintainer confirms he inherited them blind
(`yuhonas/free-exercise-db` issue #2, comment 2023-06-27, verbatim):

> "though I actually have no idea where the images are from or if they are royalty free so
> usage would be at your own risk (i will update the README to make this clearer)"

That README update was still not made as of 2026-09-12 (I read the full README; it contains
no image-licence warning). Related open threads: issue #13 has contributors asking for the
images to be **removed**, one commenter (2026-08-01) suspecting ExRx.net as a source, and the
maintainer replying 2026-08-02, verbatim:

> "A good place to start if we're going to drop the current images could be to swap with
> placeholders then we can maintain the same `JSON` schema"

Upstream `wrkout/exercises.json` issue #305 contains a reverse-image-search claim pointing at
bodybuilding.com and a quote of their terms of use. **I did not independently verify the
bodybuilding.com attribution** — that specific origin claim is `UNVERIFIED`. What *is*
verified is the original author's own statement that the images were scraped and that he does
not hold the copyright. Treat the images as **unlicensed third-party content**.

Net: **text/metadata = safe public domain. Images = use at your own risk.** See
[Open decision A](#open-decision-a--do-we-ship-the-scraped-jpgs).

### 3. Exact JSON record shape

Authoritative schema: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/schema.json`
(JSON Schema draft-04). Quoted verbatim below — the only edit is that `secondaryMuscles`'
muscle enum is abridged, because it repeats `primaryMuscles`' 17 names character-for-character.
Reproduced at this length because its `required` list and its tuple-form `items` both matter:

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "id":    { "type": "string", "pattern": "^[0-9a-zA-Z_-]+$" },
    "name":  { "type": "string" },
    "force": { "type": [ "string", "null" ], "enum": [ null, "static", "pull", "push" ] },
    "level": { "type": "string", "enum": [ "beginner", "intermediate", "expert" ] },
    "mechanic": { "type": [ "string", "null" ], "enum": [ "isolation", "compound", null ] },
    "equipment": {
      "type": [ "string", "null" ],
      "enum": [ null, "medicine ball", "dumbbell", "body only", "bands", "kettlebells",
                "foam roll", "cable", "machine", "barbell", "exercise ball",
                "e-z curl bar", "other" ]
    },
    "primaryMuscles": {
      "type": "array",
      "items": [ { "type": "string", "enum": [
        "abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms",
        "glutes", "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps",
        "shoulders", "traps", "triceps" ] } ]
    },
    "secondaryMuscles": { "type": "array", "items": [ { "type": "string", "enum": [ /* ABRIDGED HERE: the identical 17-name list */ ] } ] },
    "instructions":     { "type": "array", "items": [ { "type": "string" } ] },
    "category": {
      "type": "string",
      "enum": [ "powerlifting", "strength", "stretching", "cardio",
                "olympic weightlifting", "strongman", "plyometrics" ]
    },
    "images": { "type": "array", "items": [ { "type": "string" } ] }
  },
  "required": [ "id", "name", "level", "mechanic", "equipment", "primaryMuscles",
                "secondaryMuscles", "instructions", "category", "images" ]
}
```

Note `"force"` is **absent from `required`** — yet present in all 876 records I scanned.

A real record, verbatim from the head of `dist/exercises.json`:

```json
{
  "name": "3/4 Sit-Up",
  "force": "pull",
  "level": "beginner",
  "mechanic": "compound",
  "equipment": "body only",
  "primaryMuscles": [ "abdominals" ],
  "secondaryMuscles": [],
  "instructions": [
    "Lie down on the floor and secure your feet. Your legs should be bent at the knees.",
    "Place your hands behind or to the side of your head. You will begin with your back on the ground. This will be your starting position.",
    "Flex your hips and spine to raise your torso toward your knees.",
    "At the top of the contraction your torso should be perpendicular to the ground. Reverse the motion, going only ¾ of the way down.",
    "Repeat for the recommended amount of repetitions."
  ],
  "category": "strength",
  "images": [ "3_4_Sit-Up/0.jpg", "3_4_Sit-Up/1.jpg" ],
  "id": "3_4_Sit-Up"
}
```

Key order in the combined file is `name, force, level, mechanic, equipment, primaryMuscles,
secondaryMuscles, instructions, category, images, id` (`id` last — the README example shows
it first; both are the same data, do not rely on key order).

### 4. Measured value domains — every field, every value, with counts

Measured by parsing all 876 records of `dist/exercises.json` (sha256
`5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`, 1,005,327 bytes).
**All 876 records carry all 11 keys — exactly one distinct key set, no missing keys.**

| Field | Type | Distinct | Values (count) |
|---|---|---|---|
| `id` | string, **unique** (876/876) | 876 | `^[0-9a-zA-Z_-]+$` holds for all 876 |
| `name` | string, **unique** (876/876) | 876 | longest: `Lying Close-Grip Barbell Triceps Extension Behind The Head` |
| `force` | string \| **null** | 4 | `pull` 371, `push` 371, `static` 104, **null 30** |
| `level` | string, never null | 3 | `beginner` 525, `intermediate` 294, `expert` 57 |
| `mechanic` | string \| **null** | 3 | `compound` 491, `isolation` 298, **null 87** |
| `equipment` | string \| **null** | 13 | see equipment table below |
| `primaryMuscles` | string[], len **1–2** | 17 | never empty; exactly **one** record has 2 |
| `secondaryMuscles` | string[], len **0–10**, mean 1.96 | 17 | 1,719 links total |
| `instructions` | string[], len **0–24**, mean 4.27 | — | longest single step 744 bytes |
| `category` | string, never null | 7 | `strength` 584, `stretching` 123, `plyometrics` 61, `powerlifting` 38, `olympic weightlifting` 35, `strongman` 21, `cardio` 14 |
| `images` | string[], len **0 or 2** | — | 873 records × 2 = **1,746** refs, all unique |

`primaryMuscles` (count as primary / as secondary), union is exactly **17** names:

```
abdominals  93/59    abductors    8/35    adductors   13/41    biceps      53/74
calves      28/181   chest       84/63    forearms    25/94    glutes      22/220
hamstrings  79/201   lats        38/56    lower back  27/104   middle back 34/66
neck         8/1     quadriceps 148/82    shoulders  129/210   traps       15/84
triceps     73/148
```

`equipment` distribution:

```
barbell 170   dumbbell 123   other 122   body only 111   cable 81   <null> 77
machine 67    kettlebells 56  bands 20   medicine ball 17  exercise ball 12
foam roll 11  e-z curl bar 9
```

**876 exercises**, not "1000+". The three records with `images: []` are
`Kettlebell_Halo`, `Kettlebell_Halo_With_Overhead_Extension`,
`Kettlebell_Overhead_Triceps_Extension` (added 2026-08-29, commit `79ca7b4`). The five with
`instructions: []` are `Iron_Cross`, `One-Arm_Kettlebell_Swings`, `Push_Press`,
`Side_Bridge`, `Side_Jackknife`. The one with two `primaryMuscles` is
`Kettlebell_Halo_With_Overhead_Extension` → `["shoulders","triceps"]`.

`id` is *almost* `name.replace(/ /g,'_')` — true for 840/876. It is **not** a derivable
field: `3/4 Sit-Up`→`3_4_Sit-Up`, `Band Good Morning (Pull Through)`→`Band_Good_Morning_Pull_Through`,
`Bicycling, Stationary`→`Bicycling_Stationary`. **Always read `id` from the record.**

### 5. Exact URL patterns (all verified with live requests)

Combined JSON — `HTTP 200`, 1,005,327 bytes:
```
https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
```

Pinned to a commit (byte-identical sha256 confirmed against `main`):
```
https://raw.githubusercontent.com/yuhonas/free-exercise-db/a859101d633a01c4a1a920d6a8ce41dabba0705f/dist/exercises.json
```

Single exercise — `HTTP 200`, **`Content-Type: text/plain; charset=utf-8`** (not JSON):
```
https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<id>.json
```

Images — prefix the record's `images[n]` value verbatim. README, verbatim:

> "prefix any of image path's contained in the `JSON` with
> `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/` to get a hosted
> version of the image"

```
https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<id>/<0|1>.jpg
```
Verified: `.../exercises/3_4_Sit-Up/0.jpg` → `HTTP 200`, `Content-Type: image/jpeg`,
`Content-Length: 38047`, `Cache-Control: max-age=300`.

Bulk download (1 request instead of 1,746) — verified, **99,767,288 bytes** in 60 s at
~1.6 MB/s, top-level dir `free-exercise-db-<sha>/`, contains exactly 1,746 `.jpg`:
```
https://codeload.github.com/yuhonas/free-exercise-db/tar.gz/a859101d633a01c4a1a920d6a8ce41dabba0705f
```

### 6. Images: static JPEG, not GIF. 94.10 MiB total.

**Format: static JPEG.** Every one of the 1,746 refs ends `.jpg`; filenames are only ever
`0.jpg` and `1.jpg`; the image directory always equals the record `id` (0 mismatches in 876
records). I downloaded 4 and checked magic bytes: all `ff d8 ff` (JPEG SOI). JPEG cannot be
animated. **There are no GIFs and no videos in this dataset.** The two images are a
start-position / end-position pair, not an animation.

**Exact total size**, from `GET /repos/yuhonas/free-exercise-db/git/trees/main?recursive=1`
(`truncated: false`, 3,556 entries — every blob size is authoritative):

| Path glob | Count | Bytes | |
|---|---|---|---|
| `exercises/**/*.jpg` | **1,746** | **98,671,281** | **94.10 MiB** |
| `exercises/*.json` | 876 | 959,301 | 0.91 MiB |
| everything else | 46 | — | 1.90 MiB |
| all blobs | 2,668 | — | 96.91 MiB |

Per-image JPEG size: min 15,378 · p50 54,678 · p90 78,421 · p99 114,957 · max 919,342 ·
mean 56,513 bytes.

**Dimensions are NOT uniform.** Sampled 30 evenly across the set:
`850x567` ×23, `750x500` ×2, `850x565` ×1, `850x569` ×1, **`500x750` ×1 (portrait)**,
**`850x1275` ×1 (portrait)**.

Upstream notes a small amount of duplication (README, verbatim):

```sh
jdupes --summarize --recurse .

Scanning: 2620 files, 874 items (in 1 specified)
25 duplicate files (in 22 sets), occupying 809 KB
```

### 7. R2 + D1 sizing for the seeding job

Using the rates in [`stack-facts.md`](./stack-facts.md) (R2 storage $0.015/GB-mo, Class A
$4.50/M ops, egress $0):

| | Value |
|---|---|
| R2 objects (originals) | **1,746** |
| R2 bytes | 98,671,281 = 0.09867 GB |
| R2 storage cost | **$0.0015 / month** |
| R2 Class A (one-off PUTs) | 1,746 ops = **$0.0079 one-off** |
| D1 `exercises` rows | **876** |
| D1 muscle-link rows (if normalised) | 877 primary + 1,719 secondary = **2,596** |
| D1 instruction rows (if normalised) | 3,738 |
| D1 image rows | 1,746 |
| Seed SQL value literals | **712,021 bytes ≈ 695 KiB** |

Cost is effectively zero. **The image licence, not the size, is the only real constraint.**

### 8. Fallback / supplement: wger — verified, and mostly a no

All queried live against `https://wger.de/api/v2/…` on 2026-09-12 with **no API key** —
anonymous read works (`HTTP 200`, `Allow: GET, POST, HEAD, OPTIONS`). No rate-limit headers
were returned on any response.

| Endpoint | `count` |
|---|---|
| `/exercise/` | **862** |
| `/exerciseinfo/` | 862 |
| `/exercise-translation/` | 3,320 |
| `/exerciseimage/` | **374** |
| `/video/` | **78** |
| `/exercisecategory/` | 8 |
| `/muscle/` | 15 |
| `/equipment/` | 12 |
| `/license/` | 5 |

**Licence: per-record Creative Commons, mostly CC-BY-SA 4.** `/license/` returns exactly:
`CC-BY-SA 3` (id 1), `CC-BY-SA 4` (id 2), `CC0` (id 3), `CC-BY 4` (id 4), `ODbL` (id 5). A
real `/exerciseinfo/` record carries:

```json
"license": {
  "id": 2,
  "full_name": "Creative Commons Attribution Share Alike 4",
  "short_name": "CC-BY-SA 4",
  "url": "https://creativecommons.org/licenses/by-sa/4.0/deed.en"
},
"license_author": "BePieToday",
```

Each nested `translations[]` entry has its **own** `license` + `license_author` +
`author_history`. So attribution is **per row, per translation** — not one global notice.
CC-BY-SA is share-alike: merging wger rows into our Unlicense-derived catalogue puts
share-alike obligations on the merged result.

**wger's killer flaw for us: Russian is essentially absent.** I paginated all 3,320
translations (7 pages × 500) and counted by `language` id:

```
en(2) 862 · es(4) 644 · de(1) 627 · fr(12) 582 · it(13) 138 · pt(7) 66 · cs(9) 51
nl(6) 49 · el(8) 48 · ar(17) 48 · id(23) 48 · zh(24) 48 · tr(16) 31 · hr(22) 31
he(21) 22 · ru(5) 10 · pl(14) 4 · no(10) 3 · fa(20) 3 · uk(15) 2 · eo(19) 2 · az(18) 1
```

**Russian = 10 of 862 exercises (1.2%).** wger cannot localise our library to RU. Ukrainian
is 2. Its other assets are thin too: only 374 images and 78 videos across 862 exercises.

wger's 15 muscles are Latin anatomical names with a partially-populated `name_en`
(`Brachialis`, `Obliquus externus abdominis`, `Serratus anterior`, `Soleus`, `Trapezius` all
have `name_en: ""`), and its 8 categories are body regions (`Abs, Arms, Back, Calves, Cardio,
Chest, Legs, Shoulders`) — a *different* axis from free-exercise-db's 7 `category` values
(training modality). These two taxonomies do not compose cleanly.

### 9. Fallback: ExerciseDB (RapidAPI) — needs a key, pricing not verifiable

Verified: the endpoint requires a RapidAPI key.
`GET https://exercisedb.p.rapidapi.com/exercises/bodyPartList` with no key →

```json
HTTP 401
{"message":"Invalid API key. Go to https://docs.rapidapi.com/docs/keys for more info."}
```

**Pricing and quotas: `UNVERIFIED`.** `https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb/pricing`
is a client-rendered SPA and returns no pricing content to a server-side fetch; I could not
read a primary source. Search results suggested a free "BASIC" tier around 500,000
requests/month with ~1,000 requests/hour, but that came from third-party blog synthesis, not
from RapidAPI, so I am recording it as **`UNVERIFIED` — do not budget against it.** RapidAPI
plan terms are publisher-controlled and change without notice. The owner must open the
pricing page in a browser if this path is ever considered.

Also relevant and verified — a runtime API is the wrong shape for us regardless: the app is
**offline-first** (brief NFR: "a full workout is loggable with no network"). An exercise
library behind a metered HTTP API cannot satisfy that; we would end up mirroring it locally
anyway, at which point the API's terms govern our mirror.

Other candidates I checked via the GitHub API (for the record, not recommended now):

| Repo | Stars | Licence | Note |
|---|---|---|---|
| `hasaneyldrm/exercises-dataset` | 21,749 | `NOASSERTION`, `LICENSE` file is **MIT** (© 2026 Hasan Emir Yıldırım) | 1,324 exercises, animation GIFs, 6 languages, 125 MB. Created 2026-03-18. The MIT text is amended to cover "data files". Image provenance `UNVERIFIED`. |
| `ExerciseDB/exercisedb-api` | 638 | **AGPL-3.0** | Only 32 KB — API server code, not data; data lives at `ascendapi.com`. AGPL network-copyleft would attach if we self-hosted it. |
| `RepDB/exercise-dataset` | 34 | `NOASSERTION`, `LICENSE-CODE` is MIT | 600+ exercises, 512px WebP, EN/DE/ES. Describes itself as "Commercial in-app use with attribution" with a paid tier for animations. |
| `wrkout/exercises.json` | 632 | Unlicense | Our upstream. Same images, same problem. Author now sells a 2,500-exercise set at `wrkout.xyz`. |

---

## Recommendation

**Use `yuhonas/free-exercise-db`, pinned to commit
`a859101d633a01c4a1a920d6a8ce41dabba0705f`, as the single seed source. Do not add wger. Do
not add ExerciseDB.**

Reasons: it is the only candidate whose *text* is unambiguously public domain (Unlicense),
its 876 records cover the brief's needs, it is a one-time static download with zero runtime
dependency (which offline-first demands), and it has a published JSON Schema we can validate
against to detect upstream drift. wger is rejected because its one unique selling point for
us — i18n — turns out to be 10 Russian records out of 862, while its CC-BY-SA licence would
add per-row share-alike obligations for nothing. ExerciseDB is rejected because it is a
metered runtime API (wrong shape for offline-first) with pricing I could not verify.

Architect the image layer as **swappable from day one** (see Open decision A): D1 stores an
`image_licence` status per row and the app reads images through one internal route, so the
whole image set can be replaced — with placeholders, AI-generated art, or a purchased set —
without touching the catalogue, the schema, or any logged set.

### Canonical muscle taxonomy — 17 leaf keys, 1:1 with the dataset

**Do not invent finer granularity than the data supports.** The dataset has no
anterior/lateral/posterior deltoid split, no rhomboids, no obliques separate from
`abdominals`, no rectus-vs-transverse. Any extra key would be un-populatable and the heatmap
would show a permanently cold region. So the canonical set is exactly the dataset's 17 names,
snake_cased, with the space-containing ones normalised:

| Canonical key | Dataset name | SVG views | Rollup group |
|---|---|---|---|
| `abdominals` | `abdominals` | front | `core` |
| `abductors` | `abductors` | front | `hips` |
| `adductors` | `adductors` | front | `hips` |
| `biceps` | `biceps` | front | `arms` |
| `calves` | `calves` | front, back | `legs` |
| `chest` | `chest` | front | `chest` |
| `forearms` | `forearms` | front, back | `arms` |
| `glutes` | `glutes` | back | `legs` |
| `hamstrings` | `hamstrings` | back | `legs` |
| `lats` | `lats` | back | `back` |
| `lower_back` | `lower back` | back | `back` |
| `middle_back` | `middle back` | back | `back` |
| `neck` | `neck` | front, back | `neck` |
| `quadriceps` | `quadriceps` | front | `legs` |
| `shoulders` | `shoulders` | front, back | `shoulders` |
| `traps` | `traps` | back | `back` |
| `triceps` | `triceps` | back | `arms` |

The transform is a **total function with no fallback branch**: 17 in, 17 out. The mapping
table is exhaustive by construction, so the Zod enum *is* the validator — any new upstream
muscle name throws at seed time, which is exactly the signal we want.

**SVG body map = 21 regions** (10 front + 11 back), because 4 keys render on both views:

- **front (10):** `neck`, `shoulders`, `chest`, `biceps`, `forearms`, `abdominals`,
  `adductors`, `abductors`, `quadriceps`, `calves`
- **back (11):** `neck`, `shoulders`, `traps`, `middle_back`, `lats`, `lower_back`,
  `triceps`, `forearms`, `glutes`, `hamstrings`, `calves`

The view assignment is a **design decision, not a dataset fact** — notably `abductors`
(gluteus medius / TFL) is anatomically a lateral/posterior muscle that I have placed on the
front view as the outer hip, because a two-view map has nowhere else to put it. Place its
path on the outer hip/upper-thigh silhouette.

The **8 rollup groups** (`chest`, `back`, `shoulders`, `arms`, `legs`, `core`, `hips`, `neck`)
are for the dashboard's top-level summary only. **Use the 17 leaf keys for the brief's
"under-trained flags"**: an 8-group rollup hides neglected hamstrings inside a well-trained
`legs`, which defeats the purpose of the flag.

**Volume attribution weighting — the number that decides whether the heatmap is useful.**
This is a design decision, marked as such. Recommend **primary = 1.0, secondary = 0.5**.
The measured reason: secondary links outnumber primary ones by 1,719 to 877, and the
distributions are inverted. `glutes` is primary for only 22 exercises but secondary for
**220**; `calves` 28 vs **181**; `shoulders` 129 vs **210**. Weight secondary at 1.0 and
`glutes`/`calves`/`shoulders` glow permanently hot on every leg or push day and the map
stops carrying information. Store the weight as a named constant with a unit test asserting
that a pure bench-press week leaves `glutes` cold.

### Canonical equipment taxonomy — 13 keys + `unknown`

| Canonical key | Dataset value | Count | Notes |
|---|---|---|---|
| `barbell` | `barbell` | 170 | plate calc: needs a bar mass **setting** |
| `dumbbell` | `dumbbell` | 123 | |
| `other` | `other` | 122 | **not filterable** |
| `bodyweight` | `body only` | 111 | plate calc: N/A |
| `cable` | `cable` | 81 | |
| `unknown` | `null` | 77 | **not filterable** |
| `machine` | `machine` | 67 | |
| `kettlebell` | `kettlebells` | 56 | de-pluralised |
| `resistance_band` | `bands` | 20 | |
| `medicine_ball` | `medicine ball` | 17 | |
| `exercise_ball` | `exercise ball` | 12 | |
| `foam_roller` | `foam roll` | 11 | |
| `ez_bar` | `e-z curl bar` | 9 | **keep separate from `barbell`** — different bar mass |

Two hard consequences:

1. **`other` (122) + `unknown` (77) = 199 of 876 = 22.7% of the library carries no usable
   equipment value.** The filter UI must not present equipment as a complete partition. Show
   an explicit "Other / unspecified" bucket rather than silently dropping a fifth of the
   library out of every filtered view.
2. **`equipment` is a single scalar, not an array.** A barbell bench press is `barbell` only;
   the bench is invisible. Do not build a "what can I do with this equipment?" feature on
   this field — it will claim you can bench with a barbell and no bench.
3. **Bar mass is not in the dataset.** `barbell` and `ez_bar` need default masses (and an
   Olympic-vs-women's-bar choice) as user settings for the plate calculator. Do not hardcode
   20 kg for both.

---

## Seeding plan (concrete, idempotent, re-runnable)

Runs from the **dev machine**, never from a Worker. Lives in `scripts/seed-exercises/`
(a build-time script, not application code).

### Pin

```ts
// scripts/seed-exercises/pin.ts
export const EXDB_COMMIT = "a859101d633a01c4a1a920d6a8ce41dabba0705f";
export const EXDB_JSON_SHA256 =
  "5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf";
export const EXDB_EXPECTED_COUNT = 876;
export const EXDB_EXPECTED_IMAGES = 1746;
```

### Step 1 — download once, verify, cache

One request to codeload (not 1,746 to raw.githubusercontent):

```
https://codeload.github.com/yuhonas/free-exercise-db/tar.gz/${EXDB_COMMIT}
```

→ extract to a gitignored `.cache/free-exercise-db-${EXDB_COMMIT}/`. Assert the sha256 of
`dist/exercises.json` equals `EXDB_JSON_SHA256` and **abort on mismatch**. A mismatch means
either a wrong SHA or (per issue #13) that the images were swapped for placeholders — either
way a human must re-review before re-seeding. Skip the download entirely if the cache
directory already validates: that alone makes step 1 re-runnable and offline.

### Step 2 — transform + validate

Parse with a Zod schema built from the **measured** domains (17 muscles, 13 equipment,
7 categories, 3 levels, `force`/`mechanic`/`equipment` nullable). Assert
`records.length === 876` and `imageRefs.length === 1746` as tripwires, but let the **enums**
be the real drift detector — a new upstream muscle or equipment value must throw, not
fall through to a default.

Emit two artefacts into `.cache/`:

- `exercises.sql` — literal SQL, `INSERT … ON CONFLICT(id) DO UPDATE SET …`,
  **batched at 25 rows per statement** (worst-case row literal is 3,470 bytes → 25 × 3,470 =
  86.8 KB, safely inside D1's 100,000-byte statement cap).
- `images.manifest.json` — `[{ r2Key, localPath, sha256, bytes, width, height }]`, with
  `width`/`height` read from the JPEG SOF header at transform time (dimensions vary — see
  Gotcha #13).

Write both with **explicit UTF-8 and no BOM** (Gotcha #7).

### Step 3 — D1

Two tables, and this separation is the load-bearing part of the whole plan:

```sql
-- seeded, disposable, source of truth = the pinned dataset
CREATE TABLE exercises_catalog (
  id            TEXT PRIMARY KEY,   -- 'fedb:3_4_Sit-Up'  (NEVER an autoincrement int)
  source        TEXT NOT NULL,      -- 'free-exercise-db'
  source_id     TEXT NOT NULL,      -- '3_4_Sit-Up'
  source_commit TEXT NOT NULL,      -- EXDB_COMMIT
  name          TEXT NOT NULL,
  force         TEXT,               -- nullable: 30 records
  level         TEXT NOT NULL,
  mechanic      TEXT,               -- nullable: 87 records
  equipment     TEXT NOT NULL,      -- normalised; 'unknown' for the 77 nulls
  category      TEXT NOT NULL,
  instructions  TEXT NOT NULL,      -- JSON array; '[]' for 5 records
  image_licence TEXT NOT NULL,      -- 'unknown-third-party' — see Open decision A
  seeded_at     TEXT NOT NULL
);

-- many-to-many: one record has 2 primaryMuscles, secondary goes up to 10
CREATE TABLE exercise_muscles (
  exercise_id TEXT NOT NULL REFERENCES exercises_catalog(id),
  muscle      TEXT NOT NULL,        -- one of the 17 canonical keys
  role        TEXT NOT NULL,        -- 'primary' | 'secondary'
  PRIMARY KEY (exercise_id, muscle, role)
);

CREATE TABLE exercise_images (
  exercise_id TEXT NOT NULL REFERENCES exercises_catalog(id),
  idx         INTEGER NOT NULL,     -- 0 | 1
  r2_key      TEXT NOT NULL,
  sha256      TEXT NOT NULL,        -- cache-busting token + idempotency check
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  PRIMARY KEY (exercise_id, idx)
);
```

User-authored exercises live in their **own** table (or the same one with an `id` prefixed
`usr:`), never interleaved with seeded rows. Then a re-seed can rewrite the catalogue freely
without touching user data.

Apply it with the literal-SQL path, which sidesteps D1's 100-bound-parameter limit entirely:

```sh
npx wrangler d1 execute <DB> --remote --file=./.cache/exercises.sql
```

Cloudflare documents this path as *"limited to 5GiB files, the same as the R2 upload limit"* —
our file is ~700 KB.

**Idempotency:** `ON CONFLICT(id) DO UPDATE SET` (upsert), **not** `INSERT OR REPLACE`.
`REPLACE` in SQLite is a DELETE followed by an INSERT, which fires `ON DELETE CASCADE` on
anything referencing the row — i.e. it would silently delete logged sets. Delete
`exercise_muscles` / `exercise_images` rows for the seeded ids and re-insert them (they hold
no user data); upsert `exercises_catalog`. Cloudflare's SQL page does not explicitly document
UPSERT support (`UNVERIFIED` in their docs, though it states D1 *"is compatible with most
SQLite's SQL convention since it leverages SQLite's query engine"* and SQLite has had UPSERT
since 3.24) — **probe it with one `wrangler d1 execute` before relying on it.**

### Step 4 — R2

**Key scheme — stable, not commit-scoped:**

```
exercises/<source_id>/<idx>.jpg      e.g. exercises/3_4_Sit-Up/0.jpg
```

Do **not** put the commit SHA in the key. That would force a full 1,746-object re-upload on
every dataset bump and leave the old set orphaned. Instead put the provenance in object
metadata and the cache-busting token in the URL:

- object metadata: `src-sha256`, `exdb-commit`, `content-type: image/jpeg`
- serve through one internal authenticated route
  `/api/exercise-image/<source_id>/<idx>?v=<sha256[0:8]>` with
  `Cache-Control: public, max-age=31536000, immutable`. The `v` token comes from
  `exercise_images.sha256`, so content changes bust the cache and nothing else does.

**Idempotency:** for each manifest entry, `HeadObject` → if it exists and its `src-sha256`
metadata equals the manifest sha256, **skip**. Otherwise `PutObject`. A second run of a
completed seed performs 1,746 cheap HEADs (Class B, $0.36/M → $0.0006) and zero PUTs. An
interrupted run resumes exactly where it stopped. Log a one-line summary
(`uploaded / skipped / failed`) and exit non-zero on any failure.

**Use the S3-compatible endpoint** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
(`PutObject`, `HeadObject`, `ListObjectsV2`, `DeleteObjects` are all documented as
implemented) with `@aws-sdk/client-s3` or `aws4fetch`, concurrency ~8. Do **not** shell out to
`wrangler r2 object put` 1,746 times: Cloudflare's R2 limits page states *"The Cloudflare REST
API is rate-limited to 1,200 requests per five minutes"*, and whether `wrangler r2 object put`
routes through that REST path is **`UNVERIFIED`** — 1,746 calls would sit right on the line.
Also respect the documented *"1 per second"* cap on concurrent writes to the **same** key
(HTTP 429): a retry loop must back off per-key, never hot-spin.

### Step 5 — licence attribution in-app

Build a **Settings → About → Data sources** screen (and keep the same content in
`docs/ATTRIBUTION.md`). The Unlicense requires **no** attribution, so this is voluntary
courtesy for the text — but the image provenance note is the part that actually matters:

> **Exercise library** — 876 exercises from
> [free-exercise-db](https://github.com/yuhonas/free-exercise-db) by yuhonas, released into
> the public domain under the [Unlicense](https://unlicense.org). Pinned at commit
> `a859101d` (2026-08-30), retrieved 2026-09-12. Derived from
> [wrkout/exercises.json](https://github.com/wrkout/exercises.json) by Ollie Jennings.
>
> **Exercise images** — origin unknown. The original dataset author states the images were
> collected from the internet and that he does not hold their copyright. Included here for
> private personal use only. Not licensed for redistribution.

Store the same fact per row (`exercises_catalog.image_licence = 'unknown-third-party'`) so a
future filter can exclude or replace unlicensed media programmatically rather than by memory.
Also vendor the full Unlicense text at a `/licences` route.

---

## Gotchas that will silently break us

1. **`force`, `mechanic`, `equipment` are nullable** (30 / 87 / 77 records). The published
   `schema.json` omits `force` from `required` *entirely*. A non-optional TS type or a
   `NOT NULL` column kills the transform on record ~30 — or worse, coerces null to the string
   `"null"`.
2. **`schema.json` does not validate what you think it validates.** It uses draft-04
   **tuple** form — `"items": [ { "enum": [...] } ]` — which constrains only array element
   **0**. A bogus muscle name at index 1 passes upstream `make lint` untouched. Validate with
   your own `z.array(MuscleEnum)`; do not delegate to their schema.
3. **3 exercises have `images: []`** (`Kettlebell_Halo`,
   `Kettlebell_Halo_With_Overhead_Extension`, `Kettlebell_Overhead_Triceps_Extension`). A
   non-optional `<Image>` in the list row renders a broken/blank tile. These were added
   2026-08-29 — i.e. *new* records arrive without images, so this will recur on every bump.
4. **5 exercises have `instructions: []`** (`Iron_Cross`, `One-Arm_Kettlebell_Swings`,
   `Push_Press`, `Side_Bridge`, `Side_Jackknife`). An empty-state is required, and
   `instructions[0]` as a preview snippet will throw.
5. **`primaryMuscles` can have 2 entries** (`Kettlebell_Halo_With_Overhead_Extension` →
   `["shoulders","triceps"]`). A `primary_muscle TEXT` scalar column silently drops
   `triceps`, understating triceps volume forever. Use the join table.
6. **`secondaryMuscles` reaches 10 and `instructions` reaches 24.** Fixed-width UI
   (a 3-chip row, a 5-step list) truncates without warning.
7. **Non-ASCII in 4 records — and this is a Windows trap.** The data contains `¾` (U+00BE),
   `°` (U+00B0), `—` (U+2014) in `3_4_Sit-Up`, `Cable_Internal_Rotation`, `Pallof_Press`,
   `Skating`. PowerShell's `Set-Content`/`Add-Content` default to the **system ANSI**
   codepage, which mangles these into mojibake inside the seed `.sql`. Write with explicit
   UTF-8. Equally: a **UTF-8 BOM** at the start of the `.sql` file can break the first
   statement — emit UTF-8 *without* BOM.
8. **7 names contain a literal apostrophe** (`Child's Pose`, `Conan's Wheel`,
   `Dancer's Stretch`, `Farmer's Walk`, `Landmine 180's`, …). Naive string concatenation into
   SQL produces a syntax error at best. Escape `'` → `''` (or use a real serialiser).
9. **D1: maximum bound parameters per query = 100.** A parameterised bulk insert of
   876 rows × 11 columns = 9,636 parameters fails. At 11 columns you get **9 rows per
   statement**. This is why the plan uses the literal-SQL `--file` route instead.
10. **D1: maximum SQL statement length = 100,000 bytes.** Worst-case row literal here is
    **3,470 bytes**, so never exceed ~28 rows per `INSERT`; the plan uses 25.
11. **D1: maximum queries per Worker invocation = 1000 (Paid) / 50 (Free).** Never expose
    seeding as an HTTP route — on the free tier it dies after 50 statements, and even on Paid
    a 1,746-object R2 loop risks the CPU ceiling.
12. **`INSERT OR REPLACE` will delete logged sets.** In SQLite, REPLACE = DELETE + INSERT,
    firing `ON DELETE CASCADE` on children. A re-seed would wipe every `sets` row referencing
    a re-seeded exercise. Use `ON CONFLICT(id) DO UPDATE SET`.
13. **Never use an autoincrement integer PK for seeded exercises.** A re-seed renumbers them
    and every `sets.exercise_id` silently points at a different movement — the single most
    destructive failure mode in this whole plan. The dataset `id` strings are stable and
    unique (876/876); use them, namespaced (`fedb:` / `usr:`).
14. **Image dimensions are not uniform.** Verified portrait outliers: `500x750` and
    `850x1275` alongside the dominant `850x567`. A hardcoded `aspect-ratio: 3/2` crops heads
    off two-thirds of those frames. Store `width`/`height` at seed time and let the layout
    adapt — this also removes layout shift, which the LCP < 2.5 s budget needs.
15. **There are no GIFs and no videos.** Verified: 1,746 static JPEGs (magic bytes `ff d8 ff`),
    two per exercise, start/end position. The brief's *"1000+ exercises with GIF/video"*
    cannot be satisfied from this source. See Open decision B.
16. **876 ≠ "1000+".** Plan copy, empty states, and any "N exercises" marketing number
    against 876.
17. **`id` is not derivable from `name`** (840/876 match `name.replace(/ /g,'_')`). Computing
    it produces 36 wrong image paths and 36 orphaned R2 keys. Read `id` from the record.
18. **The upstream repo has no tags and no releases.** `main` is the only named ref and it
    **moves** (it moved on 2026-08-29 and 2026-08-30). Pinning to `main` means an unreviewed
    dataset change can land in a rebuild. Pin the SHA.
19. **Upstream is actively discussing deleting every image.** Issue #13, maintainer,
    2026-08-02: *"A good place to start if we're going to drop the current images could be to
    swap with placeholders"*. Our sha256 tripwire catches it; hotlinking `main` would not.
20. **Do not hotlink `raw.githubusercontent.com` at runtime.** Verified: it serves
    `Cache-Control: max-age=300` even for a **pinned SHA** (so no immutable caching), serves
    per-exercise JSON as `Content-Type: text/plain`, is not a CDN we control, and is not a
    dependency an offline-first PWA may have. Copy into R2 once.
21. **R2: writes to the same key are capped at "1 per second"**, returning HTTP 429. A naive
    retry loop on one failing object hammers that cap instead of backing off.
22. **R2: "The Cloudflare REST API is rate-limited to 1,200 requests per five minutes."**
    1,746 PUTs exceeds one window. Use the S3 endpoint. Whether `wrangler r2 object put`
    routes through the REST-limited path is **`UNVERIFIED`** — do not loop wrangler 1,746
    times to find out.
23. **wger's `language=` query parameter is a silent no-op.** Verified:
    `/exercise-translation/?language=5`, `?language=2`, and even `?language=999` all return
    `count=3320` with a first result in `language: 2`; `/exercise/?language=5` returns
    `count=862`. It does not error — it returns everything. Any code trusting it silently
    ingests all 22 languages. Filter client-side.
24. **wger has 10 Russian translations of 862 exercises.** If anyone reaches for wger to
    solve RU i18n, it will look plausible in a spot check of the `/exerciseinfo/` shape
    (`translations[]` is there, it has a `language` field) and then deliver 1.2% coverage.
    RU exercise names must come from elsewhere — hand-curated, or an AI translation pass
    through our existing `getTextModel()` abstraction, reviewed once and committed.
25. **wger licensing is per-row, not per-dataset.** CC-BY-SA 4 dominates but CC-BY-SA 3,
    CC-BY 4, CC0 and ODbL all appear in `/license/`, and every exercise *and every
    translation* carries its own `license` + `license_author`. One global "Data from wger"
    notice would not discharge the attribution obligation, and share-alike would attach to
    our merged table. Another reason to keep wger out.
26. <a id="26-a-stack-facts-number-to-re-check-not-a-contradiction"></a>**A `stack-facts.md`
    number to re-check (not a contradiction).** `stack-facts.md` says *"D1 free tier 5 GB
    storage, 5M reads/day"*. Cloudflare's limits page gives **maximum database size** as
    *"10 GB (Workers Paid) / 500 MB (Free)"*. These are plausibly two different limits — a
    per-database cap versus an account-wide storage quota — so I am **not** claiming
    `stack-facts.md` is wrong. Flagging it because a reader could conflate them. Irrelevant
    to this note either way: our seed is ~695 KB.
27. **wger's HTML docs are behind Anubis proof-of-work anti-scraping.** `wger.de/en/software/api`
    returns an Anubis challenge page to a server-side fetch, so automated doc lookups return
    nothing useful. The `/api/v2/` JSON endpoints are unaffected. Read wger docs in a browser.
28. **25 duplicate image files in 22 sets** (809 KB, per upstream's `jdupes` run). Harmless if
    you key by `exercises/<id>/<idx>.jpg` as planned — but if anyone "optimises" to
    content-addressed keys, two different exercise ids collapse onto one object, and a
    later per-exercise image replacement silently changes the other exercise's image too.
29. **`equipment` is a scalar and 22.7% of it is unusable** (`other` 122 + `null` 77 = 199).
    A filter chip row built as if equipment partitions the library will quietly hide a fifth
    of it. And "barbell bench press" records only `barbell` — the bench is not in the data.
30. **Bar mass is absent from the dataset.** `barbell` (170) and `ez_bar` (9) need different
    default masses for the plate calculator, as user settings. Collapsing `e-z curl bar` into
    `barbell` during normalisation (tempting — it is only 9 records) silently makes every EZ-bar
    plate calculation wrong by ~10 kg.

---

## Open decisions for the owner

### Open decision A — do we ship the scraped JPGs?

**The facts, verified:** the dataset text is public domain (Unlicense). The 1,746 images are
**not** covered by that in any meaningful sense — the original author states in
`CONTRIBUTING.md` that they *"have been scrapped off the internet, therefore l do not own the
copy right for these images and would advise against using them in comercial projects"*, and
the current maintainer says he has *"no idea where the images are from or if they are royalty
free"*. Upstream contributors are asking for their removal. (The specific claim that they come
from bodybuilding.com or ExRx.net is `UNVERIFIED`.)

**Option 1 — ship all 1,746 JPGs into a private R2 bucket.** Served only through an
authenticated route to the single user. The app is private, single-tenant, non-commercial, not
distributed, and never listed in an app store. Practical risk is very low; it is not zero, and
it is a risk the owner takes knowingly rather than one I can license away. Cost: $0.0015/mo.
Gets the brief's "1000+ exercises with GIF/video" visual affordance as close as this source
allows.

**Option 2 — text-only catalogue, no photos.** Render the SVG muscle map (which Phase 6 builds
anyway) as the per-exercise visual. Zero legal exposure, zero R2 objects, noticeably worse
gym-mode UX for unfamiliar movements.

**My recommendation: Option 1, with three conditions** — (a) the R2 bucket is private and
images are served only behind auth, never a public bucket or public custom domain; (b)
`exercises_catalog.image_licence = 'unknown-third-party'` is stored per row and surfaced on the
Data-sources screen; (c) the image layer is swappable behind the single
`/api/exercise-image/…` route, so if the app ever goes public, or upstream removes the images,
we swap the R2 contents without a schema change or a data migration.

**This needs an explicit yes from the owner**, because it is a legal-risk acceptance, not an
engineering trade-off. If the answer is "the app may become public one day", take Option 2 now —
retrofitting is far more expensive than starting without images.

### Open decision B — 876 static photo pairs vs the brief's "1000+ with GIF/video"

**Option 1 — accept 876 exercises with static start/end JPEG pairs.** Free, public-domain
text, zero runtime dependency, ships in Phase 2. Amend the brief's "1000+" and "GIF/video" to
match reality.

**Option 2 — buy a licensed animated set.** `wrkout.xyz` (the original author's commercial
successor: 2,500+ exercises, images and videos, watermarked at lower tiers; he describes the
full dataset as requiring *"some pretty substantial one-off payment"* — actual price
`UNVERIFIED`) or `RepDB` (`exercise-dataset.com`, paid tier adds *"smooth animations with
transparent backgrounds and one consistent character"*, price `UNVERIFIED`). Either resolves
Decision A completely, since the licence would be explicit.

**My recommendation: Option 1 now.** Ship Phase 2 on the free dataset and update the brief's
numbers. Revisit only if the owner finds the static pairs genuinely insufficient in the gym —
that is a question real usage answers better than this note can. The seeding plan's swappable
image layer is what keeps Option 2 cheap later.

---

## Sources

**Local files read**

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

**Dataset artefacts downloaded and inspected** (in the session scratchpad, not the project)

- `dist/exercises.json` — 1,005,327 bytes, sha256
  `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`
- `codeload` tarball at commit `a859101d…` — 99,767,288 bytes, 1,746 `.jpg` verified
- 34 individual JPEGs downloaded for magic-byte and dimension checks

**free-exercise-db**

- https://github.com/yuhonas/free-exercise-db
- https://api.github.com/repos/yuhonas/free-exercise-db
- https://api.github.com/repos/yuhonas/free-exercise-db/license
- https://api.github.com/repos/yuhonas/free-exercise-db/git/trees/main?recursive=1
- https://api.github.com/repos/yuhonas/free-exercise-db/commits?path=dist/exercises.json
- https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/README.md
- https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/schema.json
- https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json
- https://github.com/yuhonas/free-exercise-db/issues/2 (images licence — maintainer reply)
- https://github.com/yuhonas/free-exercise-db/issues/12
- https://github.com/yuhonas/free-exercise-db/issues/13 (removal request; placeholder plan)
- https://yuhonas.github.io/free-exercise-db/ (browsable frontend)

**Upstream provenance**

- https://raw.githubusercontent.com/wrkout/exercises.json/master/CONTRIBUTING.md (lines 43–48 — the decisive quote)
- https://api.github.com/repos/wrkout/exercises.json
- https://github.com/wrkout/exercises.json/issues/305 (licence status thread)
- https://github.com/wrkout/exercises.json/issues/308

**wger** (all queried live, anonymous, 2026-09-12)

- https://wger.de/api/v2/ · `/exercise/` · `/exerciseinfo/` · `/exercise-translation/`
  · `/exerciseimage/` · `/video/` · `/exercisecategory/` · `/muscle/` · `/equipment/`
  · `/license/` · `/language/`
- https://wger.de/en/software/api — **behind Anubis proof-of-work; returned no usable content**

**ExerciseDB / alternatives**

- https://exercisedb.p.rapidapi.com/exercises/bodyPartList → `HTTP 401` (key required)
- https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb/pricing — **SPA, unreadable
  server-side; pricing `UNVERIFIED`**
- https://api.github.com/repos/hasaneyldrm/exercises-dataset (+ `/license`)
- https://api.github.com/repos/ExerciseDB/exercisedb-api (+ `/license`)
- https://api.github.com/repos/RepDB/exercise-dataset (+ `/license`)

**Cloudflare platform limits**

- https://developers.cloudflare.com/d1/platform/limits/ (100 bound params; 100,000-byte
  statement; 1000/50 queries per invocation; 10 GB / 500 MB max DB size)
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
  (`wrangler d1 execute --file` limited to 5 GiB)
- https://developers.cloudflare.com/d1/sql-api/sql-statements/ (SQLite compatibility;
  `PRAGMA foreign_keys`; UPSERT **not** explicitly documented)
- https://developers.cloudflare.com/r2/platform/limits/ (1 write/sec per key; REST API
  1,200 req / 5 min; 1,024-byte key limit)
- https://developers.cloudflare.com/r2/api/s3/api/ (`PutObject`, `HeadObject`,
  `ListObjectsV2`, `DeleteObjects` implemented; `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)
- https://developers.cloudflare.com/workers/wrangler/commands/r2/ (`r2 object put` flags)
- https://unlicense.org
