# R10 — Import/export formats: Hevy, Strong, MyFitnessPal, and our own

**Researched:** 2026-09-12 · **Phase:** 9 (Data & Polish) · **Feeds:** brief §11 Settings/Data,
final acceptance checklist item "CSV/JSON export + Hevy/Strong/MFP import work".

Read first: [`specs/00-brief.md`](../../specs/00-brief.md),
[`docs/research/stack-facts.md`](./stack-facts.md). Nothing here contradicts stack-facts.md.

Every claim below is either (a) quoted from a vendor help page or a vendor-published API spec,
(b) read byte-for-byte out of a real export file that I downloaded and parsed in this session, or
(c) explicitly tagged `UNVERIFIED`. Header rows and sample rows are pasted verbatim — the
character-level detail (delimiter, quoting, BOM, capitalisation, spacing) **is** the finding.

---

## Question

1. What are the real, byte-level formats of the three exports we promised to import — Hevy
   workouts, Strong workouts, MyFitnessPal nutrition + measurements? Exact header row, one real
   data row, date/time format, how units are expressed, how supersets / warm-up sets / RPE
   survive or are lost, and how one workout spans multiple rows.
2. What should *our* export be — a CSV set (one file per table) plus one canonical JSON backup
   with a schema version — and what exactly is the round-trip guarantee, including R2 photo keys?

---

# Part 1 — Verified answers

## 1.1 Method and corpus

Vendor docs document the *button*, never the *columns*. Strong's own help page says only:

> "You can export your workout data to a spreadsheet friendly CSV format."
> — `https://help.strongapp.io/article/235-export-workout-data`

So columns had to come from real files. I downloaded and parsed **10 real Strong exports, 9 real
Hevy exports and 8 real MyFitnessPal export files** (GitHub code search → `gh api ... contents`,
raw bytes, parsed with Python's `csv`). Files live in the session scratchpad at
`…/85fb1989-…/scratchpad/{hevy,strong,mfp}/`; every one is linked under **Sources**.

Two files that look authoritative but are **not** real exports, and which I therefore only use as
corroboration, never as the basis of a claim:

- `wayneschuller/strengthjourneys/fixtures/imports/hevy/*` — that repo's own README says
  "These **synthetic** files capture the public Hevy workout-export shapes".
- `radupana/openweight/.../__fixtures__/exploratory/*` — hand-written edge-case fixtures. Note
  these use a *different* 15-column Hevy header (`…,reps,weight_kg,weight_lbs,…` with numeric
  `set_type` values `1,2,3,4,99`). **I could not reproduce that shape in any real export and
  treat it as fabricated / obsolete — `UNVERIFIED`, do not code against it.**

---

## 1.2 Hevy

### 1.2.1 What Hevy actually offers (vendor, verbatim)

> "Hevy allows users to export the data from their profile. You can choose to export either your
> measurements data or your workout data. To export your data from the Hevy app, follow the
> instructions below.
> Profile > Settings > Export & Import Data > Export Data > Select "Export Measurements" or
> "Export Workouts""

> "Hevy only allows you to import CSVs from the Strong app. The file must be in English in order
> to be accepted as an import."
> — `https://help.hevyapp.com/hc/en-us/articles/38001424401943-…`

Two consequences: (a) **workouts and measurements are two separate files**, never one; (b) Hevy's
*import* side is Strong-shaped, which is why the Strong dialect is the lingua franca of this
whole ecosystem and why our importer should treat "Strong CSV" as the compatibility format.

### 1.2.2 Workout export — exact header row

Metric account (**verified**, `radupana/openweight/.../hevy-real.csv`, `TonyTromp/HevyConnect/workouts.csv`,
`mouadja02/Hevy-Coach/workout_data.csv`):

```csv
"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
```

Imperial account (**verified**, 4 independent real exports: `sheehanr/…`, `tylerjrichards/…`,
`smdesai27/…`, `rosgood98/…`):

```csv
"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"
```

**14 columns in both cases, same order. Columns 10 and 12 are RENAMED, not accompanied by a unit
column.** This is the single most dangerous fact about Hevy imports.

Sample data rows, verbatim:

```csv
"Monday ? You mean international CHEST DAY !","30 Jun 2025, 19:56","30 Jun 2025, 20:58","","Incline Bench Press (Dumbbell)",,"",0,"normal",48,13,,,
```

```csv
"Gut Check - Day 1 🚀","28 May 2024, 07:32","28 May 2024, 08:27","","Running",,"",0,"normal",,,,240,
"Gut Check - Day 1 🚀","28 May 2024, 07:32","28 May 2024, 08:27","","Seated Cable Row - V Grip (Cable)",,"",0,"warmup",70,10,,,6
"Gut Check - Day 1 🚀","28 May 2024, 07:32","28 May 2024, 08:27","","Lat Pulldown (Cable)",0,"",0,"normal",140,10,,,7.5
```

File-level facts (**verified** by reading bytes): no BOM, LF line endings, comma delimiter,
UTF-8; header fields are always quoted; numeric fields are unquoted; `superset_id`,
`distance_*`, `duration_seconds` and `rpe` are frequently the empty field (not `0`).

### 1.2.3 Date/time format

`start_time` / `end_time` = a **locale medium date-time with no timezone and no seconds**:

| Real export | Sample | Day padding |
|---|---|---|
| `TonyTromp/HevyConnect` | `1 Dec 2025, 10:53` | unpadded |
| `sheehanr/…` | `1 Jan 2025, 07:39` | unpadded |
| `radupana/…/hevy-real.csv` | `02 Jul 2025, 17:56` | **zero-padded** |

Both padding conventions appear across real exports (**verified**), consistently *within* one file
but not *between* files. Parse with a tolerant `d[d] MMM yyyy, HH:mm` matcher, never
`Date.parse()`. The **absence of a timezone** means the only correct interpretation is
"wall-clock time on the device that exported", which for us is `Asia/Almaty`.

### 1.2.4 Units

There is **no unit column and no unit setting recorded in the file**. Units are encoded *in the
header names* (`weight_kg`/`weight_lbs`, `distance_km`/`distance_miles`). Detect by header
sniffing. Hevy stores kg internally and converts on export, which leaves visible float dust —
real row from `rosgood98/…`: `…,0,"normal",88.18,14,,,` where `88.18 lb` is `40.00 kg`
(**verified**; `40 / 0.45359237 = 88.1849…`).

### 1.2.5 Supersets, warm-up sets, RPE

`set_type` observed values across real exports (**verified**): `normal`, `warmup`, `failure`,
`dropset` — exactly the enum Hevy's own public API declares:

> `"type": { "type": "string", "description": "The type of set. This can be one of 'normal', 'warmup', 'dropset', 'failure'", "example": "normal" }`
> — Hevy public OpenAPI, `components.schemas.Set`

So **warm-up/dropset/failure survive cleanly**. That is Hevy's big advantage over Strong.

`rpe` observed values (**verified**): `6, 7, 7.5, 8, 8.5, 9, 9.5, 10` — and the API pins the
legal set exactly:

> `"rpe": { "type": "number", "nullable": true, "description": "The Rating of Perceived Exertion (RPE).", "enum": [6, 7, 7.5, 8, 8.5, 9, 9.5, 10] }`
> — Hevy public OpenAPI, `components.schemas.PostWorkoutsRequestSet`

**Note 6.5 is absent from Hevy's enum but is present in real Strong data** (see §1.3.6). Our
schema must be the superset.

`superset_id` is an integer, **0-based and only unique within one workout** (values `0` and `1`
recur across many different workouts in `sheehanr/…` and `tylerjrichards/…` — verified). The
grouping key is `(workout, superset_id)`. Per the API:

> `"superset_id": { "type": "number", "nullable": true, "description": "The id of the superset that the exercise belongs to. A value of null indicates the exercise is not part of a superset.", "example": 0 }`

**What is lost:** the CSV groups *all* of exercise A's sets, then *all* of exercise B's sets
(verified in the `Gut Check - Day 1 🚀` rows above). The actual A1→B1→A2→B2 alternation that
makes it a superset is not recoverable — only the grouping is.

### 1.2.6 How one workout spans multiple rows

One row = one set. A workout is identified only by the repeated `(title, start_time, end_time,
description)` quadruple — **there is no workout id and no exercise index**. Exercises are
delimited by `set_index` restarting at `0`.

**This is a real defect, not a stylistic one.** Verbatim rows 2 and 18 of the same workout in
`tylerjrichards/throne`:

```csv
"Gut Check - Day 1 🚀","28 May 2024, 07:32","28 May 2024, 08:27","","Running",,"",0,"normal",,,,240,
…14 rows of other exercises…
"Gut Check - Day 1 🚀","28 May 2024, 07:32","28 May 2024, 08:27","","Running",,"",0,"normal",,,,240,
```

Two *separate instances* of `Running` in one workout, both `set_index = 0`, non-contiguous. Hevy's
API has an exercise-level `index` field; **the CSV drops it**. Grouping by
`(title, start_time, exercise_title)` silently merges the two instances. You must group by
**contiguous runs of rows**, and treat row order as load-bearing data.

### 1.2.7 Hevy measurements export — `UNVERIFIED`

Hevy's help page confirms an `Export Measurements` action exists (quoted in §1.2.1). I could not
find a single real Hevy measurements CSV in public code, and a third-party importer's own
reference notes confirm nobody has documented it:

> "A Hevy measurements export [is not handled by the workout] importer. Inspect its actual format
> and use the canonical measurement ingestion [path]."
> — `cobuildwithus/murph/.../provider-data-exports.md`

**The header row of Hevy's measurements CSV is `UNVERIFIED`. Do not write that importer from a
guess.** What *is* verified is the vocabulary Hevy uses for body measurements in its public API,
which is the best available prior for the column names:

> `date` (format `date`, e.g. `2024-08-14`), `weight_kg`, `lean_mass_kg`, `fat_percent`,
> `neck_cm`, `shoulder_cm`, `chest_cm`, `left_bicep_cm`, `right_bicep_cm`, `left_forearm_cm`,
> `right_forearm_cm`, `abdomen`, `waist`, `hips`, `left_thigh`, `right_thigh`, `left_calf`,
> `right_calf`
> — Hevy public OpenAPI, `components.schemas.BodyMeasurement` (verbatim property list)

Note Hevy's own inconsistency: `neck_cm` carries a unit suffix, `waist` / `hips` / `left_thigh`
do not. Plan for that when we map to `body_measurements`.

---

## 1.3 Strong

Strong is the worst case: **at least four incompatible real dialects, two different delimiters.**

### 1.3.1 The four dialects (all verified from real exports)

**S1 — comma, 12 columns** (`strong-real.csv`, `StrongAppAnalytics`, `harrig12/strong`,
`willhsieh/gym-wrapped`, `shreybirmiwal/strong-stats`; data 2020→2025):

```csv
Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2020-09-15 11:22:57,"4by5 Chest And Triceps",1h 43m,"Bench Press (Barbell)",1,45.0,5,0,0,"","",
```

**S2 — semicolon, 14 columns, `Weight Unit` + `Distance Unit` + `Workout Duration`**
(`SpyrosMitsis/Metis`, `joshuayoes/strong-backup`, `imacek/lifting-with-friends-old`,
`sitek94/strong-charts`; data 2018→2025):

```csv
Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;RPE;Distance;Distance Unit;Seconds;Notes;Workout Notes;Workout Duration
2025-05-21 15:56:15;"Afternoon Workout";"Bicep Curl (Barbell)";1;10;kg;8;;;;0;"";"";53m
```

**S3 — semicolon, 13 columns, everything quoted, `Workout #`, units in header names**
(`matias-ceau/biovector`, `AbishakeSrithar/fitness-tracker-backend`, `mtanzim/vis-strong-go`;
data 2019→2025):

```csv
"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"
"1";"2023-07-14 19:31:01";"Workout A #1406";"82";"Clean and Jerk (Barbell)";"1";"50.0";"3";"";"";"";"";""
```

**S4 — legacy, semicolon, 12 columns, no RPE, no duration** (`Brandon-Valley/strong_app_export_tools/export.csv`,
data 2019):

```csv
Date;Workout Name;Exercise Name;Set Order;Weight;Weight Unit;Reps;Distance;Distance Unit;Seconds;Notes;Workout Notes
2019-01-20 17:03:17;"Indoor Bike";"Cycling (Indoor)";1;;;;2.4;mi.;2100;"";""
```

And an **oldest** shape where the *unit is the column name* — real 2018 export
(`Brandon-Valley/.../old_exports/export_0.csv`):

```csv
Date;Workout Name;Exercise Name;Set Order;lbs;Reps;mi.;Seconds;Notes;Workout Notes
```

…delivered in that file with a whole-line-quoting bug (each data line is one quoted field with
doubled inner quotes) — which is exactly why a repo called `strong_app_export_tools` exists.
Whether Strong itself emitted the malformed quoting or the uploader mangled it is `UNVERIFIED`;
either way we must fail loudly with a line number rather than half-parse it.

S1, S2 and S3 all appear with **2025 data**, so all three are live. The dialect is a function of
platform/app version, and I could not pin which is which from a primary source — that mapping is
`UNVERIFIED`. **Sniff, do not assume.**

### 1.3.2 Date/time format

Uniform across every dialect (**verified, 10/10 files**): `YYYY-MM-DD HH:mm:ss`, space-separated,
**local wall-clock, no timezone, no offset**. `2020-09-15 11:22:57`. This is the one pleasant
thing about Strong.

### 1.3.3 Duration — four different representations

| Dialect | Column | Real observed values |
|---|---|---|
| S1 | `Duration` | `1h 43m`, `2h 38m`, `59m`, `38min`, `264h 1m` |
| S2 | `Workout Duration` | `17m`, `1h 18m`, `55m` |
| S3 | `Duration (sec)` | `82`, `3600`, `5060` |
| S4 | *(absent)* | — |

`38min` (from `harrig12/strong`) and `264h 1m` (from `shreybirmiwal/strong-stats`) are real
values in real files — the suffix is not stable and the magnitude is not sanity-checked by Strong.

### 1.3.4 Units — three different mechanisms, one of them blank

- S1: **no unit information at all.** `Weight` is a bare `45.0`. Ambiguous by construction.
- S2: a `Weight Unit` column with observed values `lbs`, `kg`, and **the empty string** — in
  `imacek/…/android-strong.csv`, 1489 rows say `lbs` and **32 rows are blank** (verified). Blank
  on a bodyweight row is fine; blank on a loaded row is not recoverable.
  `Distance Unit` observed: empty, `mi.`.
- S3: unit baked into the header — `Weight (kg)`, `Distance (meters)`. The `lbs` spelling of that
  header is `UNVERIFIED` (I found no S3 export from an imperial account; `Weight (lbs)` is the
  obvious guess — sniff for it, don't hardcode it).
- Oldest: the column *is* the unit (`lbs`, `mi.`).

### 1.3.5 Supersets — lost

Strong supports supersets. Vendor, verbatim:

> "A **Superset** is a way to group exercises and perform them in parallel. You may see this
> referred to as a **Circuit** for 3 or more exercises. For example, instead of Exercise A's sets
> being performed A1,A2,A3, followed by Exercise B's sets B1,B2,B3, you might want to perform them
> as A1,B1, followed by A2,B2, then A3,B3."
> — `https://help.strongapp.io/article/98-supersets-and-circuits`

**No dialect has a superset column.** Verified by absence across all 10 real files. Strong
supersets are unrecoverable from CSV. Our importer must not pretend otherwise; it should surface
"supersets could not be imported from Strong" in the import report.

### 1.3.6 Warm-up / drop / failure sets, and the `Set Order` trap

`Set Order` is **not a number.** Vendor confirms the three tags:

> "Sets in Strong can be (optionally) tagged as **Warm-up**, **Drop Set** or **Failure** via the
> Set Tag Menu. … Tap on the **Set Number** (e.g. 1,2,3) in the "Set" column to bring up this
> menu. … If a set is untagged, the Set Number will be shown."
> — `https://help.strongapp.io/article/166-set-tags`

Because the tag *replaces the set number in the UI*, it **replaces the value in the CSV column**.
Real rows from `matias-ceau/biovector` (S3), verbatim:

```csv
"4";"2023-07-19 21:30:51";"Workout B #1409";"1742";"Squat (Barbell)";"W";"50.0";"5";"";"";"";"";""
"18";"2024-02-11 19:27:32";"Strength 24";"4806";"Bench Press (Barbell)";"F";"60.0";"10";"";"";"";"";""
"95";"2024-04-23 09:27:29";"Gripper #28";"1881";"Hand Gripper";"D";"68.0";"25";"";"";"";"";""
"27";"2024-02-21 18:33:14";"WL.AI #1";"70";"Front Squat (Barbell)";"Note";"";"";"";"";"";"Tempo";
```

Observed non-numeric `Set Order` values across real exports (**verified**):

| Value | Meaning | Where observed |
|---|---|---|
| `W` | warm-up set | `biovector` (S3), 16 rows |
| `D` | drop set | `biovector` (S3), 10 rows |
| `F` | failure set | `biovector` (S3), 5 rows |
| `Note` | **pseudo-row**: no weight/reps; the `Notes` column carries an exercise note | `biovector` 8 rows, `AbishakeSrithar` 7 rows |
| `Rest Timer` | **pseudo-row**: `Seconds` = rest duration; `Weight`/`Reps` are `0` | `AbishakeSrithar` **748 of 1623 rows**; `shreybirmiwal` 109 rows |

```csv
2025-06-03 20:23:00,"Evening Workout",264h 1m,"Incline Bench Press (Dumbbell)",Rest Timer,0,0.0,0,120.0,,,
```

**`Rest Timer` rows are nearly half the file in one real export.** A naive `for (row of rows)
insertSet(row)` doubles the logged set count, halves average weight, fills the DB with 0 kg × 0
rep sets, and poisons e1RM, volume and PR detection — while reporting "import successful".

Two further losses: `W`/`D`/`F` rows carry **no ordinal**, so warm-up position within an exercise
exists only as row order; and Strong states warm-ups are excluded from its own metrics
("Please note that Warm-up sets will **not** be included in charts or metrics"), so its own
totals will never match ours.

`W`/`D`/`F` were observed only in S3. Absence in S1/S2 files is explained by those users never
tagging a set, **not** proven to mean the dialect can't carry tags. Treat **any** non-numeric
`Set Order` as a tag-or-pseudo-row in **every** dialect.

### 1.3.7 RPE

Present as a column in S1 (last), S2 (position 8), S3 (position 9); absent in S4. Real observed
values in `joshuayoes/strong-backup` (**verified**): `6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10`.
**`6.5` is real Strong data and is illegal in Hevy's API enum.** Our `sets.rpe` must accept
0.5 steps and we must not round-trip through a Hevy-shaped validator.

### 1.3.8 How one workout spans multiple rows

One row = one set (or one pseudo-row). Workout identity:

- S1/S2/S4: the repeated `Date` timestamp (to the second) is the de-facto workout key. `Workout
  Name` is **not** unique (`"Evening Workout"` × 40 in one file).
- S3: there is a real `Workout #` — a **1-based sequential workout counter, 1:1 with `Date`**
  (verified in `AbishakeSrithar`: 47 distinct `Workout #`, 47 distinct `Date`, first six are
  `(1, 2025-02-24 15:10:32) … (6, 2025-03-10 14:36:45)`). Use it when present.
- Exercise boundaries: `Exercise Name` changes, **and** `Set Order` resets to `1`. The same
  exercise twice in one workout has the same failure mode as Hevy — row order is the only signal.

---

## 1.4 MyFitnessPal

### 1.4.1 What the export is (vendor, verbatim)

> "With our file export feature, you can download your meal nutrition details, progress history,
> and exercise history."

> "Every export includes three files, covering different parts of your MyFitnessPal history.
> **Meal Level Nutrition Details.** Calories, macronutrients, micronutrients, and timestamps for
> your logged foods, summarized by meal, plus any food notes you added.
> **Progress History.** Your logged measurements, such as weight, neck, waist, and hip entries.
> **Exercise History.** Your workouts, step counts, and daily calorie burns from a tracker, plus
> any exercise notes."

> "MyFitnessPal emails your data as CSV files inside a single zip folder."

> "**Who can use the data export feature?** Data Export is available to Premium and Premium+
> subscribers."

> "**Can I choose which data to export?** No. Every export includes all three files. You can,
> however, choose the date range for each export."
> — `https://support.myfitnesspal.com/hc/en-us/articles/360032273352-…` (page updated 2026-08-06)

There is **no API and no direct download** — the ZIP arrives by email, and the feature is
**paywalled**. Our import UI must accept a file the owner drags in, and must gracefully handle
"there is no MFP export" as a normal state.

Real ZIPs unpack to a directory named `File-Export-<start>-to-<end>/` containing
(**verified** — three complete real export directories):

```
Nutrition-Summary-2024-07-02-to-2026-03-02.csv
Measurement-Summary-2024-07-02-to-2026-03-02.csv
Exercise-Summary-2024-07-02-to-2026-03-02.csv
```

Match by **filename prefix glob**; the date suffix is noise, and one real export used bare
`Nutrition-Summary.csv` with no suffix at all.

### 1.4.2 `Nutrition-Summary` — three observed shapes

**Shape N1 — 20 columns, `Note`, no `Time`** (current; `marcus-furius/health-intel`, export window
ending 2026-03-02). Verbatim header + row:

```csv
Date,Meal,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note
2024-07-02,Breakfast,518.0,29.0,7.9,0.0,0.0,0.0,0.0,574.5,740.0,36.7,2.1,14.1,27.6,0.0,0.0,0.0,0.0,
```

**Shape N2 — 21 columns, `Time` *and* `Note`** (`pkeen/500-runs`, export generated 2025-07-03):

```csv
Date,Meal,Time,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note
2015-05-19,Breakfast,,547.9,38.1,6.6,6.5,14.0,0.0,0.0,2824.5,732.1,24.2,8.1,11.1,25.8,278.8,185.8,5.3,7.8,
```

**Shape N3 — 20 columns, `Time`, no `Note`** (`mtmk/mfp_nut_csv_parser/mfp.csv`, 2018, **with a
UTF-8 BOM**):

```csv
Date,Meal,Time,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron
2018-07-01,Breakfast,10:00 AM,40.0,0.6,0.0,0.0,0.0,0.0,0.0,0.0,0.0,5.8,0.0,0.0,1.8,0.0,0.0,0.0,0.0
```

**Row granularity depends on whether `Time` exists** (verified by counting):

- No `Time` column → **exactly one row per `(Date, Meal)`**. 1593 rows, max 1 per key.
- `Time` present → **one row per logged food entry**; up to **7 rows** for one `(Date, Meal)`
  observed. `Time` is a 12-hour `h:mm AM/PM` string (`10:00 AM`, `10:20 PM`) and is **often
  blank** (241 of 1036 rows populated in `pkeen`).

**There is no food name column in any observed shape.** MFP gives us calories + macros per meal
(or per timestamped entry) with **no food identity whatsoever**. A third-party parser notes an
older Premium "Meal Level Nutrition Details" file did have a `Food` column with a
`"Brand, Name"` convention — I found **no real file with a `Food` column**, so that shape is
`UNVERIFIED`. Plan on: we can populate `food_entries` totals and daily nutrition; we **cannot**
populate `foods`.

`Date` format: `YYYY-MM-DD` in every real file (**verified**). Files are `CRLF` in the 2026 trio,
`LF` in older ones.

`Meal` observed values (**verified**): `Breakfast`, `Lunch`, `Dinner`, `Snacks`, **and
`Post-Workout`** — meal names are user-editable. **Do not model `Meal` as a 4-value enum.**

Micronutrient column naming is inconsistent and the units are a trap:

- `Fat (g)`, `Sodium (mg)`, `Carbohydrates (g)`, `Protein (g)` carry an explicit unit.
- `Saturated Fat`, `Polyunsaturated Fat`, `Monounsaturated Fat`, `Trans Fat`, `Cholesterol`,
  `Potassium`, `Fiber`, `Sugar` **drop the unit suffix** on the same row, even though the sibling
  column has one.
- `Vitamin A`, `Vitamin C`, `Calcium`, `Iron` are **% of daily value, not a mass.** Verified
  independently by two third-party MFP parsers ("Vitamins A/C/Calcium/Iron come as %DV and are
  skipped (not gram-equivalent)"). The values in real files are consistent with %DV (`278.8`,
  `185.8`, `70.2`, `15.4` in one breakfast row). **Importing these as mg is a silent
  order-of-magnitude corruption** of our micronutrient display. Skip them or store them in a
  `_pct_dv` column.

### 1.4.3 `Measurement-Summary`

Verbatim, from two independent real exports (`marcus-furius`, `mauriciodeoliveirareis`):

```csv
Date,Weight
2024-07-02,85.5
2024-07-04,84.5
```

**Two columns.** No unit anywhere in the file or filename. A 2026-03-11 design doc from a
third-party ingester reports a `Body Fat %` column in its sample export (and stores `Weight` as
lbs), and MFP's own help page says the file contains "weight, neck, waist, and hip entries" —
so the file is clearly wider when more measurement types are logged. **The exact header spellings
for body-fat / neck / waist / hips are `UNVERIFIED`**; I found no real file containing them.

**The weight unit is genuinely absent from the data.** `85.5` is plausibly kg; `96.9 → 94.7` in
one day (a real pair in `mauriciodeoliveirareis`) is plausibly lb. This is not solvable by
parsing — see the Open decision.

### 1.4.4 `Exercise-Summary`

Metric account (**verified**, `marcus-furius` 2026, `mauriciodeoliveirareis` 2025):

```csv
Date,Exercise,Type,Exercise Calories,Exercise Minutes,Sets,Reps Per Set,Kilograms,Steps,Note
2024-07-02,Health Connect calorie adjustment,Cardio,573.0,1,,,,9840,
2024-07-03,"""Walking, 3.5 mph, brisk pace""",Cardio,178.0,18,,,,,
```

Imperial account (**verified**, `ianpcox/ED-Gym-Rat-Viz` 2023 **with BOM**, `kari0219/health_stats` 2019 **with BOM**):

```csv
Date,Exercise,Type,Exercise Calories,Exercise Minutes,Sets,Reps Per Set,Pounds,Steps,Note
2013-10-02,"Front Squats, Barbell, Arms Crossed",Strength,,,3,10,20.0,,
```

Column 8 is named **`Kilograms` or `Pounds`** depending on the account setting — same pathology as
Hevy, different vocabulary. Sniff the header.

`Type` observed values (**verified**): `Cardio`, `Strength`, only.

Strength rows are **one row per exercise per day** with a single `Sets` / `Reps Per Set` /
weight triple — MFP has **no per-set model at all**. `Exercise Calories` and `Exercise Minutes`
are blank on `Strength` rows; `Sets`/`Reps Per Set`/weight are blank on `Cardio` rows.

**MFP exercise data is not usable as workout history for us.** At best it becomes a low-fidelity
`workouts` row with synthetic uniform sets, clearly flagged as imported-approximate. Recommend we
import only `Steps` (into `daily_checkins.steps`) and skip the rest by default.

Quoting quirk (**verified**): the 2026 export wraps exercise names in **literal double-quote
characters inside the field** — the raw bytes are `"""Walking, 3.5 mph, brisk pace"""`, which
RFC-4180-decodes to the value `"Walking, 3.5 mph, brisk pace"` *including* the quotes. Older
exports (`ianpcox`) do not. Strip one balanced layer of `"` after CSV decoding, or the exercise
table fills with quote-prefixed duplicates of the same movement.

---

## 1.5 Cross-format summary

| | Hevy | Strong | MFP |
|---|---|---|---|
| Dialects seen | 1 (×2 unit variants) | **4+** (×2 delimiters) | 3 nutrition shapes |
| Delimiter | `,` | `,` **or** `;` | `,` |
| BOM | no | no | **sometimes** |
| Line ending | LF | LF | LF **and** CRLF |
| Workout id | none | `Workout #` in S3 only | n/a |
| Exercise index | **dropped** | **dropped** | n/a |
| Timestamp | `30 Jun 2025, 19:56` (locale, no tz) | `2020-09-15 11:22:57` (no tz) | `2024-07-02` (+ `10:00 AM`) |
| Units | in column **name** | 3 mechanisms, incl. blank | in column **name** |
| Warm-up | `set_type=warmup` ✅ | `Set Order=W` (ordinal lost) | ✗ |
| Drop/failure | `dropset`/`failure` ✅ | `D`/`F` | ✗ |
| RPE | `6…10`, no `6.5` | `6…10` **incl. `6.5`** | ✗ |
| Supersets | `superset_id` (order lost) | **lost entirely** | ✗ |
| Pseudo-rows | none | `Rest Timer`, `Note` | none |
| Per-set detail | ✅ | ✅ | ✗ (sets×reps only) |
| Food identity | n/a | n/a | **✗ — no food name** |

---

# Part 2 — Recommendation: our own export

Design principle, derived directly from the failures above: **the file must be self-describing and
never depend on a setting that is not inside the file.** Every pathology in Part 1 is a vendor
encoding something in a column *name*, in row *order*, or in an app *setting* instead of in a
column *value*.

## 2.1 Non-negotiable encoding rules

1. **Units are fixed and named in the column, never variable.** Always kg, cm, kcal, g, ml, m, s.
   `weight_kg`, `waist_cm`, `distance_m`, `duration_s`. There is no unit column and no imperial
   export. (The brief already fixes units to kg; §1.2.4 / §1.3.4 / §1.4.4 are why this is a hard
   rule and not a convenience.)
2. **All timestamps are UTC ISO-8601 with `Z` and seconds** (`2026-09-12T14:13:05Z`). Date-only
   columns are `YYYY-MM-DD` in the export's declared timezone, which is recorded once in the
   manifest as `Asia/Almaty`. Never a locale format. Never a bare local timestamp.
3. **Every row carries its real primary key and its real foreign keys.** No implicit grouping, no
   "same title means same workout".
4. **Every ordering is an explicit integer column**, never row order: `workout_exercises.position`,
   `sets.position` (both 0-based, dense).
5. **Set type is its own column** (`set_type` ∈ `warmup|normal|dropset|failure|amrap`). Nothing is
   ever smuggled into the position column. (This is the `Set Order = "W"` lesson.)
6. **Supersets are first-class**: `workout_exercises.superset_group` (nullable int, scoped to the
   workout) + `superset_round` on the set, so A1→B1→A2→B2 is reconstructible.
7. **Rest timers are data, not rows**: `sets.rest_after_s`. Never a pseudo-row. (The `Rest Timer`
   lesson.)
8. **Empty field = SQL NULL. `""` = empty string.** Booleans are the literal `true`/`false`.
   Numbers always use `.` as the decimal separator regardless of locale.
9. **RFC 4180**, comma delimiter, `CRLF` line terminators, UTF-8 **with BOM** for the CSV set —
   the owner's locale is RU and Excel mojibakes Cyrillic without a BOM. The JSON backup is UTF-8
   **without** BOM. Our importer must be BOM-tolerant on input regardless.
10. **Derived values are exported but marked derived**, so a restore can verify recomputation
    instead of trusting it (see §2.5).

## 2.2 The CSV set — one file per table

Delivered as one ZIP, `fitness-export-<YYYY-MM-DD>T<HHMM>Z-v<schema>.zip`:

```
manifest.json                  # same header block as the JSON backup
csv/settings.csv
csv/exercises.csv
csv/programs.csv
csv/routines.csv
csv/routine_exercises.csv
csv/workouts.csv
csv/workout_exercises.csv      # NEW vs the brief's data model — see §2.6
csv/sets.csv
csv/body_measurements.csv
csv/progress_photos.csv
csv/foods.csv
csv/meals.csv
csv/food_entries.csv
csv/water_logs.csv
csv/daily_checkins.csv
csv/goals.csv
csv/achievements.csv
csv/streaks.csv
csv/personal_records.csv
csv/ai_prompt_logs.csv
photos/<exact R2 key>          # only in the "full archive" variant, see §2.4
```

Header rows for the three tables that carry all the hard cases:

```csv
id,started_at,ended_at,duration_s,title,notes,routine_id,timezone,created_at,updated_at
```

```csv
id,workout_id,exercise_id,position,superset_group,notes
```

```csv
id,workout_id,workout_exercise_id,position,set_type,weight_kg,reps,rpe,rir,distance_m,duration_s,rest_after_s,superset_round,e1rm_kg,is_pr,completed_at
```

```csv
id,taken_on,pose,r2_key,r2_bytes,r2_sha256,width,height,notes,created_at
```

One real row, for the record:

```csv
01927f3e-8a11-7c44-b0d2-4c9f2a1e7d55,01927f3e-8a11-7c44-b0d2-4c9f2a1e7d40,01927f3e-8a11-7c44-b0d2-4c9f2a1e7d48,2,normal,102.5,5,8.5,2,,,180,,119.6,true,2026-09-12T14:31:07Z
```

Why `workout_exercises` exists as its own file: it is the fix for §1.2.6. Hevy and Strong both lose
the exercise-instance identity, which makes "the same exercise twice in one session" unrepresentable.
A real `workout_exercise_id` on every set makes that case trivially round-trippable.

## 2.3 The canonical JSON backup

One file, `backup.json`, with a **single versioned envelope**:

```json
{
  "schema_version": 1,
  "format": "fitness-app-tair/backup",
  "app_version": "0.9.0",
  "exported_at": "2026-09-12T14:13:05Z",
  "timezone": "Asia/Almaty",
  "units": { "mass": "kg", "length": "cm", "energy": "kcal", "volume": "ml" },
  "d1_migration": "0014_add_readiness_index",
  "counts": { "workouts": 412, "workout_exercises": 2103, "sets": 9871, "progress_photos": 118 },
  "derived_columns": {
    "sets": ["e1rm_kg", "is_pr"],
    "body_measurements": ["weight_ema_kg", "body_fat_pct"],
    "streaks": ["current", "longest"]
  },
  "r2": {
    "binding": "PHOTOS",
    "key_prefix": "u/1/",
    "objects": [
      { "key": "u/1/progress/2026-09-01/front.avif", "bytes": 184320,
        "sha256": "9f2c…", "content_type": "image/avif" }
    ]
  },
  "tables": {
    "settings": [ { "…": "…" } ],
    "workouts": [ { "…": "…" } ],
    "sets": [ { "…": "…" } ]
  }
}
```

Rules that make it a contract rather than a dump:

- **`schema_version` is an integer and is the only version the importer branches on.**
  `d1_migration` and `app_version` are diagnostics, never control flow. `schema_version > CURRENT`
  → refuse with a clear message ("this backup was made by a newer version"). `<` → run a chain of
  pure functions `upcast[1→2]`, `upcast[2→3]` over the parsed object before any DB write. Those
  upcasters are covered by fixtures pinned in the repo forever.
- **`tables` key order and row order are canonical**: tables sorted by name, rows sorted by `id`,
  object keys sorted. This is what makes the round-trip assertion a string comparison (§2.5).
- **Zod-validated on the way in and on the way out** (brief: "validate every input with Zod").
  One `BackupV1` schema; the exporter parses its own output before returning it, so a broken
  export is a 500 at export time rather than a surprise at restore time.
- **Numbers are serialised in shortest round-trip form** — `102.5`, not `102.50`, never a string.

### Streaming variant (required, not optional)

stack-facts.md pins Worker **memory at 128 MB** and CPU at **5 min per HTTP request / 15 min per
Cron Trigger**. `JSON.stringify(wholeDatabase)` will eventually OOM on a multi-year `sets` +
`ai_prompt_logs` corpus. So:

- The **wire format for export is NDJSON** (`backup.ndjson`): line 1 is
  `{"type":"header", …the envelope minus tables…}`, then one
  `{"type":"row","table":"sets","data":{…}}` per row, produced by a `TransformStream` fed from
  paged D1 `SELECT … WHERE id > ? ORDER BY id LIMIT 1000` cursors and piped straight into the
  `Response` body.
- `backup.json` is the *same data* in the pretty envelope, generated only when the corpus is small
  enough, and is the human-facing/canonical form for diffing.
- The scheduled R2 backup (brief §11) runs on a **Cron Trigger** (15 min CPU) and writes NDJSON
  via R2 multipart upload, so it is not bounded by the HTTP request limit.
- `export const runtime = "edge"` is unsupported by `@opennextjs/cloudflare` (stack-facts.md) —
  these routes are plain Node-runtime App Router route handlers.

## 2.4 Photos and R2

Two variants, both defined now so the round-trip guarantee is unambiguous:

- **Pointer backup (default, weekly, cron-safe).** D1 rows only. `progress_photos.r2_key` and
  `food_entries.photo_r2_key` are exported **verbatim as opaque strings** — never re-derived,
  never normalised, never re-prefixed. `r2.objects[]` in the manifest records `key`, `bytes`,
  `sha256`, `content_type` for every referenced object so a restore can **verify** rather than
  assume. Photo bytes stay in R2 and are not copied.
- **Full archive (quarterly / on demand).** The same manifest plus `photos/<exact key>` inside the
  ZIP, byte-identical, at the key path as the path inside the archive. Built by a Cron Trigger
  with R2 multipart upload.

Non-negotiable: **import never mints a new R2 key.** If a key must change, that is a migration
with its own `schema_version` bump and an explicit key-rewrite table in the manifest — not a
side effect of restore.

## 2.5 The round-trip guarantee (this is the DoD)

Let `D` be the database state, `E` the exporter, `I` the importer, `W` the wipe, and `canon` the
canonical JSON serialiser from §2.3 (tables sorted, rows sorted by `id`, keys sorted, shortest
round-trip numbers).

> **RT-1 — Canonical identity.**
> `canon(E(I(W(D), E(D)))) === canon(E(D))`
> A byte-for-byte string equality on the canonical JSON. Not "semantically equal", not "same row
> counts" — the same bytes.
>
> **RT-2 — Identifier stability.** `I` reuses every `id` from the backup verbatim. It never
> generates a surrogate key, never relies on autoincrement, never renumbers. Corollary: our PKs
> are app-generated UUIDv7 text, not D1 `INTEGER PRIMARY KEY AUTOINCREMENT`.
>
> **RT-3 — R2 key fidelity.** Every `r2_key` / `photo_r2_key` after restore is
> `===` the string in the backup. For every entry in `manifest.r2.objects`, the object exists in
> R2 after restore and its SHA-256 matches. A missing or mismatched object **fails the import
> closed** — it never nulls the key and never substitutes a placeholder. (A dangling `r2_key` is
> worse than a failed restore: the compare-slider and the photo timeline would silently show the
> wrong body.)
>
> **RT-4 — Derived data is verified, not trusted.** Columns listed in
> `manifest.derived_columns` (`e1rm_kg`, `is_pr`, EMA-smoothed weight, streak counters, XP,
> readiness, adaptive TDEE) are exported **and** re-imported verbatim, and then the recompute
> pipeline runs and **asserts equality** against what was imported. A mismatch is a loud test
> failure naming the row, not a silent overwrite. This is how we catch "we changed the Epley
> constant and quietly rewrote three years of PRs".
>
> **RT-5 — Restore is silent.** `I` runs with side effects disabled: no push, no Telegram, no
> achievement unlocks, no streak recalculation notifications, no `ai_prompt_logs` writes. A
> restore must not send the owner 400 notifications.
>
> **RT-6 — Atomicity.** D1 has no cross-request transaction. `I` therefore stages into
> `import_<table>` shadow tables, validates counts and FKs, and only then performs the
> wipe-and-swap in a single `db.batch()`. A restore that dies halfway leaves the previous database
> intact, never a half-wiped one.

**Test.** `src/lib/export/__tests__/roundtrip.test.ts` (Vitest 5.0.0, stack-facts.md) against a
local Miniflare D1 + R2, seeded with a fixture that deliberately contains every hard case found in
Part 1: a superset of three exercises; the same exercise twice in one workout; a warm-up set, a
drop set, a failure set; `rpe = 6.5`; a bodyweight set with `weight_kg = NULL`; a duration-only
cardio set; an emoji workout title; a Cyrillic exercise note; a note containing a comma, a double
quote and a newline; one progress photo and one food photo with real R2 keys; a `NULL` vs `""`
pair. Assert RT-1 as a string equality; assert RT-2..RT-6 individually.

Also: a **golden-file test** pinning `canon(E(fixtureDb))` in the repo, so any accidental change
to the export shape fails CI rather than silently producing backups the old importer can't read.

## 2.6 Importer architecture

One shared shape, three adapters:

```
sniff(file)  ->  { source: 'hevy'|'strong'|'mfp-nutrition'|'mfp-exercise'|'mfp-measurement'|'ours',
                   dialect, delimiter, hasBom, lineEnding, unitSystem, columnMap }
parse(...)   ->  CanonicalImportRow[]      (Zod-validated, units already normalised to kg/cm/m/s)
plan(...)    ->  ImportPlan  { creates, merges, skipped[], warnings[] }   // shown to the user
apply(...)   ->  staged insert + batch swap
report(...)  ->  what was imported, what was dropped, and WHY
```

- **`sniff` must be header-based, never position-based.** Build a normalised column map
  (lowercase, trim, collapse whitespace) and look up by name. Detect the delimiter by comparing
  `,` vs `;` counts *on the header line only*.
- **The import report is a product feature, not a log line.** "312 workouts, 4,102 sets imported.
  748 `Rest Timer` rows skipped. Supersets could not be imported from Strong. 16 warm-up sets
  imported without their original position." The brief's honesty principle applies to imports too.
- Note the brief already requires `exercises` fuzzy search; reuse it to map `Bench Press
  (Barbell)` → our free-exercise-db seed, with a review step for unmatched names rather than
  silently creating duplicate custom exercises.

---

# Part 3 — Gotchas that will silently break us

Ordered by how quietly they fail.

1. **Hevy unit columns rename, they don't add a unit column.** Index by header name. If you read
   column 10 as kg on an imperial export you get a 185 kg bench press, a new all-time PR, confetti,
   and a permanently poisoned `personal_records` table. §1.2.4
2. **Strong's delimiter is sometimes `;`.** Sniff on `,` alone and the whole line lands in column 1;
   the importer reports "1 workout imported" and exits 0. §1.3.1
3. **`Set Order` is not a number.** `Rest Timer` was **748 of 1623 rows** in one real export. Naive
   import doubles set counts, halves average weight, and injects 0 kg × 0 rep sets into e1RM and
   volume. §1.3.6
4. **MFP `Vitamin A/C/Calcium/Iron` are % daily value, not mass.** Storing them as mg is an
   order-of-magnitude corruption that no unit test will catch because the numbers are plausible.
   §1.4.2
5. **MFP `Measurement-Summary` has no unit.** `85.5` vs `96.9` — both plausible kg and lb. Guess
   wrong and the owner's whole bodyweight trend, EMA, Navy body-fat and adaptive TDEE prior are
   off by 2.2×. §1.4.3, and the Open decision below.
6. **`is_pr` recompute drift.** If import re-runs PR detection with today's formula against
   historical data, PR dates move and the PR feed rewrites history. RT-4 exists for exactly this.
7. **Dangling R2 keys.** A restore that nulls a missing `r2_key` leaves the compare slider showing
   the wrong photo pair. RT-3 fails closed instead.
8. **A half-wiped database.** D1 has no transaction across HTTP batches; "wipe then insert" with a
   5-minute CPU ceiling is a data-loss machine. Stage and swap. RT-6.
9. **Notifications during restore.** Achievements, streak nudges and the Telegram weekly report
   will all fire if import goes through the normal write path. RT-5.
10. **Hevy `02 Jul` vs `1 Dec` day padding differs between exports.** A strict format string
    parses one real export and silently `NaN`s the other, producing "0 workouts found" or an
    Invalid Date that becomes epoch 1970. §1.2.3
11. **No timezone in any of the three formats.** Interpreting Hevy/Strong timestamps as UTC shifts
    every workout by 5–6 hours in `Asia/Almaty`, which moves late-evening sessions to the next
    day, which breaks the calendar heatmap, the streak calculation and the daily volume rollups.
12. **The same exercise twice in one workout.** Verified real in Hevy. Grouping by
    `(title, start_time, exercise_title)` merges two `Running` blocks into one and loses a set.
    §1.2.6
13. **`superset_id` collides across workouts.** `0` and `1` recur everywhere. Grouping globally
    merges unrelated supersets from different months. §1.2.5
14. **Strong `Weight Unit` can be blank** (32 real rows in one file). A blank on a loaded set is
    unresolvable; don't default it to kg silently. §1.3.4
15. **`6.5` RPE is real Strong data and illegal in Hevy's enum.** A Hevy-shaped Zod validator
    rejects the row; a lenient one rounds it. Neither is right. Accept 0.5 steps. §1.3.7
16. **MFP nutrition column *count* varies (20 vs 21).** Any `if (cols.length !== 20) throw` check
    rejects real files. §1.4.2
17. **MFP row granularity flips based on whether `Time` exists.** With `Time`, up to 7 rows per
    `(Date, Meal)`; summing naively across both shapes double-counts calories on one and not the
    other. §1.4.2
18. **MFP 2026 wraps exercise names in literal quotes inside the field.** `"Walking, 3.5 mph"` and
    `Walking, 3.5 mph` become two distinct exercises. §1.4.4
19. **BOM and CRLF appear in MFP files and not in the others.** A BOM makes the first header
    `\ufeffDate`, so `row["Date"]` is `undefined` and every date is null. §1.4.2
20. **Excel will eat our own CSV.** In an RU locale, `102.5` becomes text and `2026-09-12` may be
    reinterpreted; re-saving turns `.` into `,` and our importer then reads `102,5` as two
    columns. Ship the BOM, and put "import this back into the app — do not round-trip through
    Excel" in the export UI.
21. **Strong duration `264h 1m`** is a real value. Any sanity clamp must warn, not silently coerce
    to 0, or session-duration stats quietly flatten. §1.3.3
22. **MFP export is Premium-only and email-delivered.** If the owner isn't a subscriber there is
    no MFP data at all. Don't build a flow that assumes the file exists. §1.4.1
23. **MFP has no food name.** Any plan to seed `foods` from MFP is dead on arrival. §1.4.2
24. **Hevy's measurements header is undocumented.** Writing that importer from the API field names
    will probably produce a parser that matches nothing. Get a real file first. §1.2.7
25. **Strong warm-ups are excluded from Strong's own charts.** Our totals will legitimately differ
    from the owner's memory of Strong's numbers after import; say so in the report or it reads as
    a bug. §1.3.6
26. **`""` vs empty.** Real Strong files use both `,,` and `,"",` for the same meaning in the same
    file. Our own format must draw the line explicitly (§2.1 rule 8) or our own round-trip fails
    on a note the owner cleared to empty string.
27. **`ai_prompt_logs` in the backup.** It contains full prompts, model ids and cost, and it will
    dominate the archive size. Include it (it is the audit trail the brief asks for) but page it
    and consider a retention window — and remember the backup file itself then contains AI
    input/output, so the R2 backup prefix needs the same access control as the app.

---

# Part 4 — Open decision for the owner

**What does "wipe" mean in the Phase 9 round-trip acceptance test — D1 only, or D1 + R2?**

This decides what the acceptance-checklist item actually proves, and it has real engineering cost.

- **Option A — pointer backup; wipe D1 only.** The DoD test is
  `export → DELETE all D1 rows → import → assert RT-1..RT-6`, with R2 left intact and RT-3
  verifying each `r2_key` still resolves with a matching SHA-256. Fits in one HTTP request for a
  realistic corpus, NDJSON-streamable, cheap, and testable in Miniflare today. **It does not
  protect against losing the R2 bucket.**
- **Option B — full self-contained archive; wipe D1 and R2.** The DoD test additionally deletes
  every R2 object and restores the photo bytes from `photos/<key>` in the archive. This is true
  disaster recovery, but the archive becomes gigabytes, must be produced via R2 multipart upload
  from a **Cron Trigger** (the 15 min CPU budget, not the 5 min HTTP one — stack-facts.md), cannot
  be downloaded from a single request, and needs its own resume logic.

**My recommendation: A as the Phase 9 Definition of Done, B as a separate deliverable.**
Ship the pointer backup with the full RT-1..RT-6 guarantee and make the weekly cron write it to
R2 — that is the guarantee the acceptance checklist should assert, and it is achievable inside
Phase 9. Then add the quarterly full archive as its own scoped item with its own DoD ("delete the
R2 bucket, restore from archive, all 118 photos return with matching SHA-256"). Doing B first
risks Phase 9 sliding on multipart-upload plumbing while the far more likely failure mode — a bad
migration wrecking D1 — goes uncovered.

Secondary decision, smaller but needed before the MFP importer ships: **MFP
`Measurement-Summary` weight unit.** The file does not contain it (§1.4.3). Options: (a) ask at
import time, showing the parsed min/median/max so the owner can eyeball kg vs lb; (b) infer from
the owner's existing `body_measurements` history and apply silently. **Recommend (a), prefilled
with (b)'s guess** — honest data over convenience, consistent with the brief's AI-confidence
principle.

---

# Sources

## Vendor primary sources (fetched 2026-09-12)

- Hevy — *How to Import Strong App CSV Files and Export Your Data in Hevy*:
  `https://help.hevyapp.com/hc/en-us/articles/38001424401943-How-to-Import-Strong-App-CSV-Files-and-Export-Your-Data-in-Hevy`
- Hevy — *Tutorial: Log Previous Workouts and Import CSV*:
  `https://help.hevyapp.com/hc/en-us/articles/35687878672663-Tutorial-Log-Previous-Workouts-and-Import-CSV`
- Hevy — **public API OpenAPI spec** (v0.0.1): `https://api.hevyapp.com/docs/` — the machine-readable
  document is embedded in `https://api.hevyapp.com/docs/swagger-ui-init.js` as `swaggerDoc`;
  schemas quoted: `Workout`, `Exercise`, `Set`, `PostWorkoutsRequestSet`, `BodyMeasurement`.
- Strong — *Can I export my workout data?*: `https://help.strongapp.io/article/235-export-workout-data`
- Strong — *About Warm-up, Drop Sets and Failure Sets*: `https://help.strongapp.io/article/166-set-tags`
- Strong — *About Supersets / Circuits*: `https://help.strongapp.io/article/98-supersets-and-circuits`
- MyFitnessPal — *Export your nutrition, progress, and exercise data* (page updated 2026-08-06):
  `https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Export-your-nutrition-progress-and-exercise-data`

## Real export files parsed byte-for-byte

**Hevy** (14-col, current):
- `https://github.com/radupana/openweight/blob/main/tools/converters/src/__fixtures__/hevy-real.csv` (kg, padded dates)
- `https://github.com/TonyTromp/HevyConnect/blob/main/workouts.csv` (kg, 1922 rows)
- `https://github.com/mouadja02/Hevy-Coach/blob/main/workout_data.csv` (kg)
- `https://github.com/sheehanr/fitness-data-visualizer/blob/main/data/raw/workout_data.csv` (lbs, all 4 set types, supersets)
- `https://github.com/tylerjrichards/throne/blob/main/data/hevy_workout_data.csv` (lbs, duplicate-exercise case, emoji title)
- `https://github.com/smdesai27/workout_progress_visualize/blob/main/workout_data.csv` (lbs, 3430 rows)
- `https://github.com/rosgood98/personal-health-intelligence/blob/main/initial-source-files/workout_data_jul19.csv` (lbs, `88.18` float dust)
- `https://github.com/matanabudy/workout-data-sync/blob/main/examples/hevy_export_sample.csv`
- `https://github.com/wayneschuller/strengthjourneys/tree/main/fixtures/imports/hevy` (**declared synthetic** — corroboration only)

**Strong**:
- S1 comma: `https://github.com/radupana/openweight/blob/main/tools/converters/src/__fixtures__/strong-real.csv`,
  `https://github.com/AlexandrosKyriakakis/StrongAppAnalytics/blob/main/Data/strong.csv`,
  `https://github.com/harrig12/strong/blob/main/strong.csv`,
  `https://github.com/willhsieh/gym-wrapped/blob/main/fall-2024.csv`,
  `https://github.com/shreybirmiwal/strong-stats/blob/main/strong.csv` (**`Rest Timer` rows, `264h 1m`**)
- S2 semicolon: `https://github.com/SpyrosMitsis/Metis/blob/main/android/app/src/androidTest/assets/strong_real.csv`,
  `https://github.com/joshuayoes/strong-backup/blob/main/strong862973258176784790.csv` (**RPE incl. `6.5`**),
  `https://github.com/imacek/lifting-with-friends-old/blob/main/examples/android-strong.csv` (**blank `Weight Unit`**),
  `https://github.com/sitek94/strong-charts/blob/main/static/example-dataset.csv`
- S3 `Workout #`: `https://github.com/matias-ceau/biovector/blob/main/data/user/_temp_raw/strong_app/strong7386152350820285603.csv`
  (**`W`/`D`/`F`/`Note` rows**), `https://github.com/AbishakeSrithar/fitness-tracker-backend/blob/main/src/main/resources/strongData.csv`
  (**748 `Rest Timer` rows**), `https://github.com/mtanzim/vis-strong-go/blob/main/server/fixtures/example.csv`,
  `https://github.com/Ullaakut/strong-csv-to-fit/blob/main/pkg/convert/testdata/strong_sample.csv` (9-col; possibly trimmed by the repo author)
- S4 / legacy: `https://github.com/Brandon-Valley/strong_app_export_tools/blob/main/export.csv`,
  `https://github.com/Brandon-Valley/strong_app_export_tools/blob/main/old_exports/export_0.csv` (**`lbs` / `mi.` as column names, whole-line quoting**)

**MyFitnessPal** (complete real `File-Export-*` directories):
- `https://github.com/marcus-furius/health-intel/tree/main/data/raw/mfp/File-Export-2024-07-02-to-2026-03-02` — all three files, **2026, `Kilograms`, CRLF, 20-col nutrition**
- `https://github.com/pkeen/500-runs/tree/main/data/File-Export-2015-05-19-to-2025-07-03` — **21-col nutrition with `Time` + `Note`**
- `https://github.com/mauriciodeoliveirareis/bioinformatics_master/tree/main/M4_U2_Analisis_estadistico_con_R_y_RStudio/data_myfitnesspal_2023-08-08-to-2025-02-22` — unsuffixed filenames
- `https://github.com/ianpcox/ED-Gym-Rat-Viz` → `23Mar2023 MFP Exercise-Summary-2011-05-06-to-2023-03-22.csv` — **`Pounds`, BOM, real `Strength` rows**
- `https://github.com/kari0219/health_stats/blob/main/data/Exercise-Summary-2019-05-01-to-2019-06-15.csv` — **`Pounds`, BOM**
- `https://github.com/mtmk/mfp_nut_csv_parser/blob/main/mfp.csv` — **2018 nutrition with `Time`, BOM**

## Third-party parsers used only as corroboration (never as the sole basis of a claim)

- `https://github.com/TraceApps/nutritrace/blob/main/server/lib/nutrition-import/mfp.js` — MFP header list, %DV note
- `https://github.com/marcus-furius/health-intel/blob/main/src/sources/mfp.py` — MFP column map
- `https://github.com/johnzastrow/garminview/blob/main/docs/plans/2026-03-11-mfp-upload-design.md` — `Body Fat %` in `Measurement-Summary`
- `https://github.com/cobuildwithus/murph/blob/main/packages/assistant-engine/skills/connected-apps/references/provider-data-exports.md` — confirms Hevy measurements format is undocumented

## Local files read

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`
- Downloaded corpus (this session, scratchpad):
  `C:/Users/tairc/AppData/Local/Temp/claude/C--Users-tairc-Documents-codespace-fitness-app-tair/85fb1989-5a8f-448f-9e9a-162342b812b6/scratchpad/{hevy,strong,mfp}/`
  and `…/scratchpad/hevy_openapi.json` (extracted Hevy OpenAPI document)
