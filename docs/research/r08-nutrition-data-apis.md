# R08 — Nutrition data sources & barcode scanning

**Researched:** 2026-09-12 · **Phase:** 5 (Nutrition + Food AI)

Authority order for this note: [`docs/research/stack-facts.md`](./stack-facts.md) > [`specs/00-brief.md`](../../specs/00-brief.md) > this note.
Nothing here contradicts stack-facts.md. One *refinement* of a stack-facts line is flagged in §5.3/§G24.

Every factual claim below was verified on 2026-09-12 either by (a) a live HTTP call whose response is
reproduced here, (b) reading the package's own `.d.ts` / published tarball, or (c) quoting the primary
spec/doc. Anything I could not verify carries the literal token **UNVERIFIED**.

---

## Question

For a single-user, offline-first fitness PWA on Cloudflare Workers + D1 + KV:

1. **Open Food Facts** — current API version, exact product-by-barcode endpoint, the required custom
   User-Agent policy, documented rate limits, the `fields` parameter, which nutriment keys carry
   kcal/protein/carbs/fat per 100 g vs per serving, the licence and the attribution we owe, and the
   real data-quality situation.
2. **USDA FoodData Central** — base URL, search + detail endpoints, how the key is passed, rate limit,
   the data types and which to prefer for generic foods, and the nutrient numbers/ids for
   energy(kcal), protein, total fat, carbs.
3. **Nutritionix** natural-language endpoint — endpoint, required headers, and the *actual* free-tier
   limit (and whether it is too low to rely on).
4. **Barcode scanning in the browser** — `BarcodeDetector` support matrix in 2026 (notably iOS Safari),
   the recommended wasm fallback with current version and bundle size, and the `getUserMedia`
   constraints for a rear camera plus torch/zoom track capabilities.
5. A **lookup-precedence rule**: barcode → OFF → USDA → AI/NL estimate, with caching in KV/D1.

---

## Verified answer

### 1. Open Food Facts (OFF)

#### 1.1 Current version and status

Quoted verbatim from the OFF docs source (`docs/api/index.md`, fetched from `raw.githubusercontent.com`
on 2026-09-12):

```text
| API version | Status | Notes |
|-------------|--------|-------|
| **v3** (latest: **v3.6**) | ✅ **Current** — recommended for all new integrations | v3.6 introduces a new tags schema (`tags_sources`); see the [change log](ref-api-and-product-schema-change-log.md) |
| **v2** | ⚠️ **Deprecated** — still supported for backward compatibility | Migrate to v3 for new integrations |
| v1 / v0 | Legacy — not recommended | |
```

But v3 **cannot search**. Also verbatim from the same file:

```text
| Feature | API v2 | API v3 | Notes |
|---------|--------|--------|-------|
| Read product | ✅ | ✅ | |
| Write product | ✅ | ✅ | |
| Structured search | ✅ `/api/v2/search` | ❌ Not available | |
| Full-text search | ⚠️ Legacy `/cgi/search.pl` only | ❌ Not available | Use [Search-a-licious](https://search.openfoodfacts.org/) |
```

#### 1.2 Product-by-barcode endpoint

From the OpenAPI source `docs/api/ref/api-v3.yaml` (verbatim):

```yaml
  "/api/v3/product/{code}":
    get:
      tags:
        - Products
      summary: Get Product Data
```

with `servers: - url: "https://world.openfoodfacts.org"`, and the documented responses:

```yaml
        "302":
          description: Redirect to the correct server for the product type of the requested product
        "404":
          description: Product not found
```

Both of these work (no `.json` suffix needed; the suffix is also accepted):

```
GET https://world.openfoodfacts.org/api/v2/product/{barcode}
GET https://world.openfoodfacts.org/api/v3/product/{barcode}
```

Live check (v2, `3017624010701` = Nutella 400 g), response reproduced verbatim and trimmed:

```json
{"code":"3017624010701","product":{"brands":"Ferrero","code":"3017624010701","nutriments":{
 "carbohydrates":57.5,"carbohydrates_100g":57.5,"carbohydrates_unit":"g","carbohydrates_value":57.5,
 "energy":2227.9,"energy-kcal":539,"energy-kcal_100g":539,"energy-kcal_unit":"kcal","energy-kcal_value":539,
 "energy-kj":2227.9,"energy-kj_100g":2227.9,"energy_100g":2227.9,"energy_unit":"kJ",
 "fat":30.9,"fat_100g":30.9,"proteins":6.3,"proteins_100g":6.3,
 "salt_100g":0.1075,"saturated-fat_100g":10.6,"sodium_100g":0.043,"sugars_100g":56.3},
 "nutriscore_grade":"e","nutrition_data":"on","nutrition_data_per":"100g",
 "nutrition_data_prepared_per":"100g","product_name":"Nutella","product_quantity":400,
 "product_quantity_unit":"g","quantity":"400.0 g"},"status":1,"status_verbose":"product found"}
```

**Product-type routing.** `product_type` is a real query parameter. From
`docs/api/ref/parameters/requested_product_type.yaml` (verbatim):

```yaml
      description: >
        Used for READ queries for one product. Expected product type of the requested product. Defaults to the product type of the server the query is sent to
        (e.g. 'food' for Open Food Facts, 'beauty' for Open Beauty Facts, etc.). 'all' matches all product types.
        If the product exists on a different server that matches the requested product type, the API will return a 302 redirect to the correct server.
        Otherwise, the API will return a 404 error.
      schema:
        enum: ["all", "beauty", "food", "petfood", "product"]
```

Verified live with a cosmetics barcode — **and note the HTTP status**:

```
$ curl -i ".../api/v2/product/8710447445990?product_type=food&fields=code,product_name"
HTTP/1.1 404 Not Found
{"code":"8710447445990","status":0,"status_verbose":"product found with a different product type: beauty"}
```

#### 1.3 Required custom User-Agent

Verbatim from `docs/api/index.md`:

> We ask you to **always use a custom User-Agent to identify your app** (to not risk being identified
> as a bot). The User-Agent should be in the form of `AppName/Version (ContactEmail)`. For example,
> `MyApp/1.0 (myapp@example.com)`.
>
> - READ operations (getting info about a product, etc...) do not require authentication other than
>   the custom User-Agent.
> - WRITE operations (Editing an Existing Product, Uploading images…) **require authentication**.

So for us: `User-Agent: TairFitness/1.0 (tairkaldybayev@gmail.com)` on every OFF request. Reads need
nothing else — no key, no account.

OFF also asks you to fill in an API-usage form before going live (verbatim from the same file):

> 2. **Tell us how you'll use it** by filling out this short form:
>    👉 [Fill out the API usage form](https://docs.google.com/forms/d/e/1FAIpQLSdIE3D8qvjC_zRJw1W8OmuHhsWJ_NSckiiniAHlfaVwUZCziQ/viewform)

#### 1.4 Rate limits (verbatim, `docs/api/index.md` → "Rate limits")

> - 15 req/min/IP address for all read product queries (`GET /api/v*/product` requests or product
>   page). There is no limit on product write queries.
> - 10 req/min/IP address for all search queries (`GET /api/v*/search` or `GET /cgi/search.pl`
>   requests); don't use it for a search-as-you-type feature, you would be blocked very quickly.
>
> If these limits are reached, we reserve the right to deny you access to the website and the API
> through IP address ban. If your IP has been banned, feel free to email us to explain why you
> reached the limits: reverting the ban is possible.
>
> If your requests come from your users directly (ex: mobile app), the rate limits apply per user.
>
> If you need to fetch more than a few hundred products, we ask you to download the data as a CSV or
> JSONL file directly.
>
> To protect our infrastructure from abusive crawl, we also added global rate-limits on the website
> and API endpoints, irrespective of the IP address. A HTTP 503 response (Service Not Available) will
> be returned if these limits are exceeded.

Measured: the responses expose **no** `X-RateLimit-*` and no `Retry-After`. Actual response headers
observed on a 200 (verbatim):

```http
HTTP/1.1 200 OK
Server: nginx
Content-Type: application/json; charset=utf-8
X-Request-ID: BfJPKKIoSjjSkggN
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: HEAD, GET, PATCH, POST, PUT, OPTIONS
Access-Control-Allow-Headers: DNT,User-Agent,X-User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,If-None-Match,Authorization
X-Cache-Status: EXPIRED
```

Two consequences: (a) CORS is wide open, so a browser *could* call OFF directly; (b) the
`Access-Control-Allow-Headers` list includes `X-User-Agent`, which is how a browser would supply the
required identifier (browsers refuse to let `fetch` set `User-Agent`). **UNVERIFIED**: I could not find
code in `openfoodfacts-server` that actually reads `X-User-Agent`, so I cannot promise that header
satisfies the policy. The recommendation in §5 avoids relying on it.

#### 1.5 The `fields` parameter

Verbatim from `docs/api/ref/api-v3.yaml`:

```yaml
          name: fields
          description: |-
            Comma separated list of fields requested in the response.

            Special values:
            * "none": returns no fields
            * "raw": returns all fields as stored internally in the database
            * "all": returns all fields except generated fields that need to be explicitly requested such as "knowledge_panels".

            Defaults to "all" for READ requests. The "all" value can also be combined with fields like "attribute_groups" and "knowledge_panels".
```

and from `docs/api/ref/parameters/product_available_fields.yaml`:

```yaml
    ProductAvailableFields:
      name: fields
      in: query
      description: Specific fields to return. Use 'knowledge_panels' for Knowledge Panels only.
      schema:
        type: string
        pattern: "^[a-zA-Z0-9_.-]+(,[a-zA-Z0-9_.-]+)*$"
```

The default (`all`) is **251 top-level product keys** — measured on `3017624010701`. Always send
`fields`. Bulk lookup of several barcodes in one request is also possible via v2 search (verbatim from
the OFF cheatsheet):

```text
https://world.openfoodfacts.org/api/v2/search?code=3263859883713,8437011606013,6111069000451&fields=code,product_name
```

Our field list:

```ts
const OFF_FIELDS = [
  "code", "product_name", "product_name_ru", "generic_name", "brands", "quantity",
  "serving_size", "serving_quantity", "serving_quantity_unit",
  "nutrition_data_per", "nutrition_data_prepared_per", "nutrition_data",
  "nutriments", "nutriscore_grade", "categories_tags", "last_modified_t",
].join(",");
```

#### 1.6 Which nutriment keys carry kcal / protein / carbs / fat

This is the crux. Measured on `0013764027053` ("Organic Bread 21 Whole Grains and Seeds", a US product
that **does** have serving data). Product-level fields:

```
serving_size          = '1 slice (45 g)'
serving_quantity      = 45
serving_quantity_unit = 'g'
nutrition_data_per    = '100g'
quantity              = '765 g'
```

`nutriments` values, verbatim:

```
energy-kcal          = 244
energy-kcal_100g     = 244               <-- kcal per 100 g   USE THIS
energy-kcal_serving  = 110               <-- kcal per serving USE THIS
energy-kcal_unit     = kcal
energy-kcal_value    = 244
energy               = 1252.09888888889
energy_100g          = 1252.09888888889  <-- WARNING: kJ, NOT kcal
energy_serving       = 563               <-- WARNING: kJ
energy_unit          = kJ
proteins             = 13.3333333333333
proteins_100g        = 13.3333333333333
proteins_serving     = 6
proteins_unit        = g
carbohydrates_100g   = 48.8888888888889
carbohydrates_serving= 22
fat_100g             = 3.33
fat_serving          = 1.5
fiber_100g           = 8.88888888888889
sugars_100g          = 8.88888888888889
sodium_100g          = 0.37778           (grams — see sodium_unit)
salt_100g            = 0.94445           (grams of SALT, not sodium)
```

Full key list for that product (measured) — note the four suffix families and the non-nutrient noise:

```
added-sugars{,_100g,_serving,_unit,_value}   calcium{...}   carbohydrates{...}
energy{,_100g,_serving,_unit,_value,_modifier}
energy-kcal{,_100g,_serving,_unit,_value}
energy-kj{,_100g,_serving,_unit,_value,_modifier}
fat{...}  fiber{...}  iron{...}  polyunsaturated-fat{...}  potassium{...}
proteins{...}  salt{...}  saturated-fat{...}  sodium{...}  sugars{...}
nova-group{,_100g,_serving,_unit,_value}                       <-- NOT a nutrient
fruits-vegetables-legumes-estimate-from-ingredients_100g       <-- NOT a nutrient
fruits-vegetables-nuts-estimate-from-ingredients_100g          <-- NOT a nutrient
```

**Canonical mapping rule (per 100 g):**

| Our field | OFF key | Fallbacks |
|---|---|---|
| `kcal_100g` | `nutriments["energy-kcal_100g"]` | `energy_100g` **only if** `energy_unit === "kcal"`; else `energy-kj_100g / 4.184` |
| `protein_100g` | `nutriments.proteins_100g` | — |
| `carb_100g` | `nutriments.carbohydrates_100g` | `nutriments["carbohydrates-total_100g"]` (seen on some US products) |
| `fat_100g` | `nutriments.fat_100g` | — |
| `fiber_100g` | `nutriments.fiber_100g` | — |
| `sodium_mg_100g` | `nutriments.sodium_100g * 1000` (unit is g — check `sodium_unit`) | `salt_100g * 400` (Na ≈ salt / 2.5) |
| serving grams | `product.serving_quantity` **when** `product.serving_quantity_unit === "g"` | parse `serving_size` |

```ts
type Basis = "100g" | "100ml";

export function mapOff(p: any) {
  const n = p?.nutriments ?? {};
  const kcal =
    num(n["energy-kcal_100g"]) ??
    (n.energy_unit === "kcal" ? num(n.energy_100g) : undefined) ??
    (num(n["energy-kj_100g"]) !== undefined ? num(n["energy-kj_100g"])! / 4.184 : undefined) ??
    null;

  return {
    name: p.product_name_ru || p.product_name || p.generic_name || null,
    brand: p.brands ?? null,
    basis: (p.nutrition_data_per === "100ml" ? "100ml" : "100g") as Basis,
    kcal_100g:    round1(kcal),
    protein_100g: round1(num(n.proteins_100g) ?? null),
    carb_100g:    round1(num(n.carbohydrates_100g) ?? num(n["carbohydrates-total_100g"]) ?? null),
    fat_100g:     round1(num(n.fat_100g) ?? null),
    fiber_100g:   round1(num(n.fiber_100g) ?? null),
    sugar_100g:   round1(num(n.sugars_100g) ?? null),
    sat_fat_100g: round1(num(n["saturated-fat_100g"]) ?? null),
    // sodium_unit is 'g' on OFF (observed 0.043 with sodium_unit:"g")
    sodium_mg_100g: num(n.sodium_100g) !== undefined ? round1(num(n.sodium_100g)! * 1000) : null,
    serving_grams: p.serving_quantity_unit === "g" ? num(p.serving_quantity) ?? null : null,
    serving_label: p.serving_size ?? null,
  };
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
```

Per-serving keys (`*_serving`) exist **only when `serving_size` is set** — Nutella (400 g jar) has
`serving_size: null` and therefore no `*_serving` keys at all (measured). Do not assume they exist.

`nutrition_data_per` is the label's own basis and can be `"100g"` or `"100ml"` (both observed in a
5-product sample). When it is `"100ml"`, the `_100g` keys are per 100 **ml**.

There is also a parallel "as prepared" family. Verbatim from the OFF cheatsheet:

```text
### Adding nutrition facts for the prepared product
You can send prepared nutritional values
* nutriment_energy-kj (regular)
* nutriment_energy-kj_prepared (prepared)
```

so `*_prepared_100g` / `nutrition_data_prepared_per` exist for dry/concentrate products.

#### 1.7 Licence and the attribution we owe

Verbatim from `docs/api/index.md`:

> - The Open Food Facts database is available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1.0/)
> - The individual contents of the database are available under the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1.0/).
> - Product images are available under the [Creative Commons Attribution ShareAlike](https://creativecommons.org/licenses/by-sa/3.0/deed.en) license. They may contain graphical elements subject to copyright or other rights that may, in some cases, be reproduced (quotation rights or fair use).

And verbatim from <https://world.openfoodfacts.org/terms-of-use>:

> The individuals and entities who reproduce or re-use information, data and/or photos from the Open
> Food Facts site or database have to mention the licence and to attribute the authorship to Open Food
> Facts with a link to https://openfoodfacts.org

Also verbatim, and worth putting in the UI:

> Data in the Open Food Facts database is provided voluntarily by users who want to support the
> program. As a result, there are no assurances that the data is accurate, complete, or reliable. The
> user assumes the entire risk of using the data.

**What we owe, concretely** (single-user app, no redistribution):

- A visible credit wherever OFF data is shown — Settings → About, plus a one-line source badge on the
  food-detail sheet: `Данные: Open Food Facts (ODbL)` linking to <https://openfoodfacts.org>.
- If we ever show an OFF product photo, credit CC-BY-SA 3.0 next to it. Simplest: **don't** — use only
  the barcode + text and our own R2 photo. (Recommended.)
- ODbL's share-alike bites on *publishing a derived database*. We store a private per-user cache and
  never publish it, so that clause is not triggered. Keeping `source='off'` on every cached row is what
  makes that defensible and lets us purge selectively if the position ever changes.

#### 1.8 Data-quality reality (measured, not anecdotal)

- **Missing nutriments is the normal case, not the exception.** Always treat all four macros as
  `number | null` end-to-end; never default a missing macro to `0`.
- **Per-serving vs per-100 g confusion is structural.** Two independent axes: `nutrition_data_per`
  (`100g` | `100ml`, the label basis) and the presence of `serving_size`/`serving_quantity`. In a
  5-product US sample, all five had `nutrition_data_per: "100g"` *and* populated `*_serving` keys, and
  one had `nutrition_data_per: "100ml"`.
- **`serving_quantity` can be a converted float.** Measured: `serving_size: '1 Bottle (16.9 fl oz)'` →
  `serving_quantity: 499.79215`. Round for display; never show raw.
- **Rounding drift.** For the bread: `energy-kcal_serving = 110` but `244 × 45/100 = 109.8`. OFF keeps
  the label value per serving and a derived value per 100 g. Pick one basis and derive the other, or the
  two disagree by ~1 %.
- **Cross-source disagreement on the same barcode.** GTIN `0013764027053`: OFF says **244 kcal/100 g**,
  USDA FDC (Branded, `fdcId 2674263`) says **267 kcal/100 g** — a 9 % gap on an identical product,
  because the two databases snapshotted different label revisions. There is no "correct" answer; we must
  record which source a logged entry came from.
- **Coverage for Kazakhstan / RU-market products is thin. UNVERIFIED** — I did not measure
  `countries_tags_en=kazakhstan` coverage. Plan for a high barcode-miss rate and make the AI/manual path
  first-class, not an afterthought.

#### 1.9 Full-text search (bonus, verified live)

v2 has no full-text search; OFF points at Search-a-licious. It is live today:

```
$ curl "https://search.openfoodfacts.org/search?q=nutella&page_size=2&fields=code,product_name"
{"hits":[{"code":"0009800800049","product_name":"Nutella & go! hazelnut spread + breadsticks"},
         {"code":"0098008952506","product_name":"Nutella"}],
 "page":1,"page_size":2,"page_count":316, ...}
```

Its own OpenAPI reports `title: search-a-licious API`, **`version: 0.1.0`**, paths
`/document/{identifier}`, `/search`, `/autocomplete`, `/`, `/off-test`, `/robots.txt`, `/health`.
Pre-1.0 → treat as unstable and wrap in try/catch. Its rate limits are **UNVERIFIED**.

---

### 2. USDA FoodData Central (FDC)

#### 2.1 Base URL, endpoints, key

From the FDC API guide (<https://fdc.nal.usda.gov/api-guide/>), confirmed by live calls:

```
Base URL:  https://api.nal.usda.gov/fdc/v1

GET  /food/{fdcId}          single food, full nutrient set
GET  /foods?fdcIds=..       several foods (repeat the param), full nutrient set
GET  /foods/list            paged, abridged
GET  /foods/search          keyword / UPC search
       (all four also accept POST with a JSON body)
```

**The key is a query parameter, not a header:** `?api_key=YOUR_KEY`. Keys are issued by api.data.gov.
`DEMO_KEY` works for development.

#### 2.2 Rate limit

Documented (verbatim from the API guide): *"FoodData Central currently limits the number of API requests
to a default rate of 1,000 requests per hour per IP address"*, and for the demo key *"Hourly Limit: 30
requests per IP address per hour"*, *"Daily Limit: 50 requests per IP address per day"*.

**Measured discrepancy.** Every `DEMO_KEY` response I received carried:

```http
X-Ratelimit-Limit: 10
X-Ratelimit-Remaining: 9
```

i.e. the demo key behaved as **10/hour**, not the documented 30/hour. Do not build anything on
`DEMO_KEY`; get a real key. The `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers *are* present on
FDC (unlike OFF) — log `X-Ratelimit-Remaining` so we see throttling coming.

#### 2.3 Data types, and which to prefer

Five types exist: **Foundation**, **SR Legacy**, **Survey (FNDDS)**, **Branded**, **Experimental**.
Measured `aggregations.dataType` for `query=chicken breast`:

```json
{"Branded": 20765, "Survey (FNDDS)": 448, "SR Legacy": 428, "Foundation": 10}
```

**Preference for generic foods: `SR Legacy` first, then `Survey (FNDDS)`, then `Foundation`; `Branded`
only for barcode/brand hits.** Reason (measured, not assumed): Foundation is a small set of
deeply-analysed specific samples and is frequently *missing macros entirely*. Foundation food
`fdcId 2759004` ("Lunchmeat, chicken breast, sliced") returns **75 nutrients and not one of
203/204/205/208** — its list is amino acids, fatty acids and minerals:

```
numbers: ['821','858','861','645','646','405','652','653','654','415','662', … ,'693','831','833']
```

`Branded` is also useful as a **second barcode source** — verified live:

```
$ curl ".../foods/search?api_key=DEMO_KEY&query=013764027053&dataType=Branded&pageSize=2"
totalHits 1
fdcId 2674263  Branded  DAVE'S KILLER BREAD, 21 WHOLE GRAINS AND SEEDS ORGANIC BREAD
   gtinUpc = '013764027053'
   brandOwner = 'Avb Corp.'
   servingSize = 45.0
   servingSizeUnit = 'GRM'
   householdServingFullText = '1 SLICE'
   packageWeight = '27 oz/765 g'
   marketCountry = 'United States'
```

Note `servingSizeUnit = 'GRM'` (UN/CEFACT code) — not `"g"`. `'MLT'` is millilitres.

#### 2.4 Nutrient numbers and ids (all measured)

| Nutrient | `nutrientNumber` | `nutrientId` | unit |
|---|---|---|---|
| Energy | `208` | `1008` | kcal |
| Energy | `268` | `1062` | kJ |
| Energy (Atwater General Factors) | `957` | `2047` | kcal |
| Energy (Atwater Specific Factors) | `958` | `2048` | kcal |
| Protein | `203` | `1003` | g |
| Total lipid (fat) | `204` | `1004` | g |
| Carbohydrate, by difference | `205` | `1005` | g |
| Fiber, total dietary | `291` | `1079` | g |
| Total Sugars | `269` | `2000` | g |
| Sodium, Na | `307` | `1093` | mg |

Verbatim from a detail (`GET /foods`) response for `fdcId 174608`:

```
{'id': 1008, 'number': '208', 'name': 'Energy',                     'unitName': 'kcal', 'amount': 134.0}
{'id': 1062, 'number': '268', 'name': 'Energy',                     'unitName': 'kJ',   'amount': 562.0}
{'id': 1003, 'number': '203', 'name': 'Protein',                    'unitName': 'g',    'amount': 14.59}
{'id': 1004, 'number': '204', 'name': 'Total lipid (fat)',          'unitName': 'g',    'amount': 7.65}
{'id': 1005, 'number': '205', 'name': 'Carbohydrate, by difference','unitName': 'g',    'amount': 1.79}
```

**Newer Foundation foods replace 208 with 957/958.** Verbatim from a search on `cheddar cheese`,
`dataType=Foundation`:

```
=== 328637 Cheese, cheddar
    205 1005 Carbohydrate, by difference G 2.44
    208 1008 Energy KCAL 408
    203 1003 Protein G 23.3
=== 2647443 Cheese, cotija, solid
    204 1004 Total lipid (fat) G 27.2
    203 1003 Protein G 23.8
    205 1005 Carbohydrate, by difference G 2.72
    957 2047 Energy (Atwater General Factors) KCAL 351
    958 2048 Energy (Atwater Specific Factors) KCAL 352
```

`fdcId 2647443` has **no 208 at all**. Energy resolution must therefore be a chain:

```ts
/** Works against BOTH response shapes. See §2.5 for why that matters. */
type AnyNutrient = { n: string; unit: string; v: number | null };

function flatten(foodNutrients: any[]): AnyNutrient[] {
  return (foodNutrients ?? []).map((x) =>
    x.nutrient
      ? { n: String(x.nutrient.number), unit: String(x.nutrient.unitName ?? "").toLowerCase(), v: num(x.amount) ?? null }  // /food/{id}
      : { n: String(x.nutrientNumber),  unit: String(x.unitName ?? "").toLowerCase(),          v: num(x.value)  ?? null }, // /foods/search
  );
}

const pick = (ns: AnyNutrient[], number: string) => ns.find((x) => x.n === number)?.v ?? null;

export function fdcMacros(foodNutrients: any[]) {
  const ns = flatten(foodNutrients);
  const protein = pick(ns, "203");
  const fat     = pick(ns, "204");
  const carb    = pick(ns, "205");
  const kj      = pick(ns, "268");
  const kcal =
    pick(ns, "208") ??                                    // classic Energy, kcal
    pick(ns, "958") ??                                    // Atwater Specific  (new Foundation)
    pick(ns, "957") ??                                    // Atwater General   (new Foundation)
    (kj != null ? kj / 4.184 : null) ??                    // from kJ
    (protein != null && carb != null && fat != null
      ? 4 * protein + 4 * carb + 9 * fat                   // last resort: compute
      : null);
  return {
    kcal_100g: kcal, protein_100g: protein, carb_100g: carb, fat_100g: fat,
    fiber_100g: pick(ns, "291"), sugar_100g: pick(ns, "269"),
    sodium_mg_100g: pick(ns, "307"),                       // FDC sodium is already mg
    energy_source: pick(ns, "208") != null ? "208"
      : pick(ns, "958") != null ? "958"
      : pick(ns, "957") != null ? "957"
      : kj != null ? "268" : "computed",                    // log this
  };
}
```

#### 2.5 Two different response shapes — the silent killer

Search results and detail results spell the same data differently, **and the unit case differs**:

```
/foods/search   →  foodNutrients[] = { nutrientId, nutrientNumber, nutrientName,
                                       unitName: "KCAL"|"G"|"MG", value, derivationCode }
/food/{id}      →  foodNutrients[] = { nutrient: { id, number, name,
                                       unitName: "kcal"|"g"|"mg" }, amount }
/foods?fdcIds=  →  same as /food/{id}
```

Also: search results' `foodNutrients` array is **not complete**. Measured counts for the same three
foods — 71, 105 and 86 entries in search vs 75 and 92 in detail — and the search entry for the
Foundation lunchmeat contained none of the macros. Treat search as "identity + a hint" and always
confirm from `/food/{fdcId}` before storing.

Household-measure grams come from `foodPortions` on detail responses (verbatim):

```json
[{"id": 94658, "gramWeight": 56.0, "sequenceNumber": 1, "amount": 1.0, "modifier": "serving 2 oz",
  "measureUnit": {"id": 9999, "name": "undetermined", "abbreviation": "undetermined"}}]
```

`foodPortions` was **absent** on the Foundation food (empty list) — another nullable.

#### 2.6 Licence

Verbatim from <https://fdc.nal.usda.gov/>:

> USDA FoodData Central data are in the public domain and they are not copyrighted. They are published
> under CC0 1.0 Universal (CC0 1.0)

Suggested citation, verbatim:

> U.S. Department of Agriculture, Agricultural Research Service, Beltsville Human Nutrition Research
> Center. FoodData Central. [Internet]. [cited (enter date)]. Available from https://fdc.nal.usda.gov/.

No attribution is legally required; USDA asks that we acknowledge the source. One line in Settings →
About covers it. **This is strictly easier than ODbL**, which is a reason to prefer FDC where both
databases have the food.

---

### 3. Nutritionix — do not build on it

#### 3.1 The endpoint (current, verified)

```
POST https://trackapi.nutritionix.com/v2/natural/nutrients

Content-Type: application/json
x-app-id:  <APP_ID>
x-app-key: <APP_KEY>

{"query": "2 eggs and toast"}
```

Key response fields: `nf_calories`, `nf_protein`, `nf_total_carbohydrate`, `nf_total_fat`,
`serving_weight_grams`, `full_nutrients[]` (with USDA `attr_id`s), `alt_measures[]`.
`x-remote-user-id` is an optional per-end-user header — **UNVERIFIED** whether it is required on current
plans.

⚠️ The `nutritionix/api-documentation` GitHub repo is **stale**: it documents
`POST https://apibeta.nutritionix.com/v2/natural` with `Content-Type: text/plain`, `X-APP-ID` /
`X-APP-KEY` and a newline-separated plain-text body. That is not the current API. Do not follow it.

#### 3.2 The actual free tier: there isn't one any more

Verbatim from <https://developer.nutritionix.com/> (fetched 2026-09-12; typographic apostrophes
normalised to ASCII):

> We've recently updated how access to the Nutritionix API is managed. For over a decade, we've proudly
> offered an open, no-cost trial for developers, students, and hobbyists. Unfortunately, due to
> increased misuse of free trial accounts, we are no longer able to maintain a public free-access tier.
> If you're exploring ways to integrate Nutritionix data into a commercial, research, or enterprise
> application, our team would be happy to provide a limited trial account tailored to your use case.
> Please contact us and share a few details about your project in the linked form.

The historic figure was 200 calls/day with attribution required (**UNVERIFIED** — secondary sources
only, and moot now). `https://www.nutritionix.com/api` returns **HTTP 402** to non-browser clients.

**Verdict: Nutritionix is unavailable to us without a sales conversation, and 200/day would in any case
have been below what an iterative "correction loop" UI burns.** The brief already marks it "(optional)".
Drop it. Natural-language logging goes through the AI abstraction we already have (`getTextModel()` +
`generateObject`, stack-facts §"AI SDK v7"), which is strictly better here: already budgeted, already
logged to `ai_prompt_logs`, already RU/EN capable, and it returns our own Zod shape instead of `nf_*`
fields we would have to remap anyway.

---

### 4. Barcode scanning in the browser

#### 4.1 `BarcodeDetector` support matrix, 2026

Read from MDN `browser-compat-data`, `api/BarcodeDetector.json` on `main`, fetched 2026-09-12 — the raw
entries, verbatim:

```json
chrome:          [{"version_added":"88","partial_implementation":true,
                   "notes":["Supported on ChromeOS and macOS only.",
                            "Before Chrome 113, on macOS Ventura (13) and above, this interface silently failed."]},
                  {"version_added":"83","version_removed":"88","partial_implementation":true,
                   "notes":"Supported on macOS only."}]
chrome_android:  {"version_added":"83"}
edge:            {"version_added":"83","partial_implementation":true,"notes":["Supported on macOS only.", …]}
opera:           {"version_added":"69","partial_implementation":true,"notes":["Supported on macOS only.", …]}
firefox:         {"version_added": false, "impl_url":"https://bugzil.la/1553738"}
safari:          {"version_added":"17","flags":[{"type":"preference","name":"Shape Detection API","value_to_set":"true"}]}
safari_ios:      "mirror"
samsunginternet_android / webview_android / webview_ios / firefox_android / opera_android: "mirror"
status:          {"experimental": true, "standard_track": true, "deprecated": false}
```

Decoded for our mobile-first PWA:

| Target | `BarcodeDetector`? |
|---|---|
| **Chrome / Android (primary target)** | ✅ native, since 83 |
| Samsung Internet, Android WebView | ✅ (mirrors Chrome Android) |
| **iOS Safari / any iOS browser** | ❌ — mirrors desktop Safari 17+, which is behind the **"Shape Detection API"** preference, off by default |
| Chrome / Edge / Opera **desktop** | ⚠️ only on **ChromeOS and macOS** — not Windows, not Linux |
| Firefox (all) | ❌ |

MDN labels the API *"Limited availability"* and *"not Baseline because it does not work in some of the
most widely-used browsers"*, `experimental: true`, and `SecureContext` + `Exposed=(Window,Worker)`.

Spec IDL, verbatim from <https://wicg.github.io/shape-detection-api/>:

```webidl
[Exposed=(Window,Worker), SecureContext]
interface BarcodeDetector {
  constructor(optional BarcodeDetectorOptions barcodeDetectorOptions = {});
  static Promise<sequence<BarcodeFormat>> getSupportedFormats();
  Promise<sequence<DetectedBarcode>> detect(ImageBitmapSource image);
};

dictionary BarcodeDetectorOptions { sequence<BarcodeFormat> formats; };

dictionary DetectedBarcode {
  required DOMRectReadOnly boundingBox;
  required DOMString rawValue;
  required BarcodeFormat format;
  required sequence<Point2D> cornerPoints;
};
```

`BarcodeFormat` values include `"ean_13"`, `"ean_8"`, `"upc_a"`, `"upc_e"`, `"code_128"`, `"code_39"`,
`"code_93"`, `"codabar"`, `"itf"`, `"aztec"`, `"data_matrix"`, `"pdf417"`, `"qr_code"`, `"unknown"`.

**Conclusion: a wasm fallback is mandatory, not optional.** iOS is a first-class target for this app and
`BarcodeDetector` does not exist there.

#### 4.2 The wasm fallback: `zxing-wasm`

**Recommended: `zxing-wasm@3.1.4`** (npm registry, published `2026-09-10T15:01:01.511Z`, MIT, deps
`type-fest ^5.9.0` + `@types/emscripten`). It ships a proper `exports` map with a **reader-only entry
point**, which is what makes the size acceptable.

Sizes — **measured** by unpacking the published tarball, not quoted from a badge:

| File | raw | gzip -9 |
|---|---|---|
| `dist/reader/zxing_reader.wasm` | 953,527 B (931 KiB) | **412,114 B (402 KiB)** |
| `dist/es/reader/index.js` (JS glue) | 40,496 B | **11,766 B (11.5 KiB)** |
| `dist/full/zxing_full.wasm` (reader+writer) | 1,533,338 B | 733,638 B |
| `dist/writer/zxing_writer.wasm` | 648,153 B | — |

→ **import `zxing-wasm/reader`, never `zxing-wasm` or `zxing-wasm/full`.** ~414 KiB gzip total, and it
must be **lazy**. `.wasm` is not JS so it does not literally count against the brief's "per-route client
JS < 200 KB gzipped" budget, but the network cost is real — load it only when `BarcodeDetector` turns out
to be unusable.

Rejected alternative: **`@zxing/library@0.23.0`** (npm, `2026-04-29`, Apache-2.0, unpacked
11,863,492 B across 1,892 files, **no `exports` map**) plus `@zxing/browser@0.2.1` (MIT, peer
`@zxing/library ^0.23.0`). Pure JS so no wasm/CSP concerns, but an order of magnitude more bytes to
tree-shake through and a slower decoder. Keep it in reserve only if wasm is blocked.

The reader API, read from `zxing-wasm@3.1.4`'s own `dist/es/reader/index.d.ts`:

```ts
export declare function prepareZXingModule(options?: PrepareZXingModuleOptions): void | Promise<ZXingReaderModule>;
export declare function purgeZXingModule(): void;
export declare function readBarcodes(
  input: Blob | ArrayBuffer | Uint8Array | ImageData,
  readerOptions?: ReaderOptions,
): Promise<ReadResult[]>;
export { ZXING_CPP_COMMIT, ZXING_WASM_VERSION };
export declare const ZXING_WASM_SHA256: string;
```

`ReaderOptions` (from `dist/es/bindings/readerOptions.d.ts`) — defaults per the doc comments:
`tryHarder: true`, `tryRotate: true`, `tryInvert: true`, `tryDownscale: true`, `tryDenoise: false`,
`isPure: false`, `downscaleThreshold: 500`, `downscaleFactor: 3`, `minLineCount: 2`,
`maxNumberOfSymbols: 255`, `binarizer: "LocalAverage"`, `eanAddOnSymbol: "Ignore"`, `textMode: "HRI"`,
`formats: []` (empty = all).

Retail format names (from `dist/es/bindings/barcodeFormat.d.ts`): `"EAN13"`, `"EAN8"`, `"UPCA"`,
`"UPCE"`, `"EANUPC"`, plus the meta-format `"AllRetail"`. `ReadResult` carries `text`, `format`,
`symbology`, `bytes`, `isValid`, `error`, `rotation`, `position`.

**The default `.wasm` URL is a CDN — this must be overridden.** Verbatim from
`PrepareZXingModuleOptions` in `dist/es/share.d.ts`:

> The Emscripten module overrides to be passed to the factory function.
> The `locateFile` function is overridden by default to load the WASM file from the jsDelivr CDN.

and from the package README:

> When using this package, a `.wasm` binary file needs to be served somewhere, so the runtime can fetch,
> compile and instantiate the WASM module. To provide a smooth development experience, the serve path is
> automatically assigned a jsDelivr CDN URL upon build.

For an offline-first PWA behind a CSP that default is fatal — see **G17**.

#### 4.3 `getUserMedia` constraints for a rear camera, and torch/zoom

`VideoFacingModeEnum`, verbatim from <https://w3c.github.io/mediacapture-main/>:

```webidl
enum VideoFacingModeEnum {
  "user",
  "environment",
  "left",
  "right"
};
```

and, verbatim: *"If the source cannot meet an `exact` constraint, the system throws an
**OverconstrainedError**"*, whereas `ideal` *"represent preferences — the source attempts to satisfy them
but may deviate if necessary"*.

Torch and zoom come from the MediaStream Image Capture spec. Verbatim IDL from
<https://w3c.github.io/mediacapture-image/>:

```webidl
partial dictionary MediaTrackSupportedConstraints {
  boolean focusMode = true;
  boolean zoom = true;
  boolean torch = true;
};

partial dictionary MediaTrackCapabilities {
  sequence<DOMString> focusMode;
  MediaSettingsRange  zoom;
  sequence<boolean>   torch;
};

partial dictionary MediaTrackConstraintSet {
  ConstrainDOMString           focusMode;
  (boolean or ConstrainDouble) zoom;
  ConstrainBoolean             torch;
};

partial dictionary MediaTrackSettings {
  DOMString focusMode;
  double    zoom;
  boolean   torch;
};
```

Note the capability shapes: `torch` is a **`sequence<boolean>`** (e.g. `[false, true]`), `zoom` is a
`MediaSettingsRange` (`{min, max, step}`) — not a boolean and not a number. Spec note, verbatim:
*"Torch describes the setting of the source's fill light as continuously connected, staying on as long
as `track` is active."*

**Per-browser support for `torch` / `zoom` is UNVERIFIED** — MDN `browser-compat-data` does not track
these dictionary members (checked: `api/MediaTrackSettings*.json`,
`api/MediaTrackSupportedConstraints*.json`, `api/MediaTrackCapabilities*.json` all 404; and
`api/MediaStreamTrack.json` exposes only `applyConstraints` / `getCapabilities` / `getSettings` /
`getConstraints`). Feature-detect at runtime; never assume.

What *is* verified (MDN BCD, `api/MediaStreamTrack.json`):

```
getCapabilities   chrome 59, chrome_android mirror, safari 11, safari_ios mirror, firefox 132
applyConstraints  chrome 59, chrome_android mirror, safari 11, safari_ios mirror, firefox 43
getSettings       chrome 59, chrome_android mirror, safari 11, safari_ios mirror, firefox 50
getConstraints    chrome 53, chrome_android 52,     safari 11, safari_ios mirror, firefox 50
```

and `ImageCapture` (`api/ImageCapture.json`): `chrome 59`, `safari 18.4`, `safari_ios` mirror, `firefox`
flagged (`dom.imagecapture.enabled`) or false. So on iOS, `ImageCapture` only arrived in Safari 18.4 —
don't depend on it; `canvas.drawImage(video, …)` works everywhere.

Working constraint set:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: false,
  video: {
    facingMode: { ideal: "environment" },   // NOT `exact` — see G20
    width:  { ideal: 1280 },                // 1280×720: enough pixels for EAN-13,
    height: { ideal: 720 },                 // cheap enough to decode at ~10 fps
    frameRate: { ideal: 30, max: 30 },
  },
});

const track = stream.getVideoTracks()[0];
const caps  = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
  torch?: boolean[];
  zoom?: { min: number; max: number; step: number };
};

// torch: capability is sequence<boolean>, so `if (caps.torch)` is truthy even for [false]
const canTorch = Array.isArray(caps.torch) && caps.torch.includes(true);
if (canTorch) {
  try { await track.applyConstraints({ advanced: [{ torch: true } as any] }); }
  catch { /* some UAs advertise and still reject — never let this kill the scan */ }
}

// zoom: capability is MediaSettingsRange {min,max,step}
if (caps.zoom && caps.zoom.max > caps.zoom.min) {
  const { min, max } = caps.zoom;
  const target = Math.min(max, min + (max - min) * 0.3); // a slight zoom helps small EAN-13
  try { await track.applyConstraints({ advanced: [{ zoom: target } as any] }); } catch {}
}

// Verify what we actually got — `ideal` can silently give us the front camera.
const got = track.getSettings().facingMode; // 'environment' | 'user' | undefined
```

`torch` / `zoom` are not in TypeScript's `lib.dom` `MediaTrackConstraintSet`; declare them once in
`src/types/media.d.ts` rather than sprinkling `as any` through the scanner.

#### 4.4 Scanner: unified detector with fallback

```ts
// src/lib/barcode/detector.ts  (design sketch — no app code is committed in this session)
export type Scan = { value: string; format: string };

const RETAIL_NATIVE = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

export async function createScanner(): Promise<(src: HTMLVideoElement) => Promise<Scan | null>> {
  // Presence of the constructor is NOT support: Chrome on Windows/Linux exposes nothing,
  // and a UA can expose the class while supporting none of the formats we need (G19).
  if ("BarcodeDetector" in globalThis) {
    try {
      const supported: string[] = await (globalThis as any).BarcodeDetector.getSupportedFormats();
      const formats = RETAIL_NATIVE.filter((f) => supported.includes(f));
      if (formats.length) {
        const det = new (globalThis as any).BarcodeDetector({ formats });
        return async (video) => {
          const hits = await det.detect(video);
          return hits[0] ? { value: hits[0].rawValue, format: hits[0].format } : null;
        };
      }
    } catch { /* fall through to wasm */ }
  }

  // Lazy: ~402 KiB gzip wasm + ~11.5 KiB gzip glue, fetched only on this path.
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
  prepareZXingModule({
    overrides: {
      // MANDATORY: the default locateFile points at jsDelivr (G17).
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? `/wasm/${path}` : prefix + path,
    },
    fireImmediately: false,
  });

  const canvas = new OffscreenCanvas(1280, 720);
  const ctx = canvas.getContext("2d")!;
  return async (video) => {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const results = await readBarcodes(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
      { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 },
    );
    const r = results.find((x) => x.isValid);
    return r ? { value: r.text, format: r.format } : null;
  };
}
```

Drive it from `requestVideoFrameCallback` where available (not `setInterval`), throttled to ~8–10
decodes/sec, and accept only a value that repeats twice in a row — a cheap confidence gate against a
single misread digit, which otherwise turns into a confident lookup of the wrong product.

#### 4.5 GTIN normalisation (required before any lookup)

Measured OFF behaviour: OFF normalises barcodes and **echoes the normalised form** in `code`. A US
12-digit UPC-A is stored as 13 digits with a leading zero — searching US products returned
`"0013764027053"`, and `/api/v2/product/0013764027053` resolves while `/api/v2/product/722252601704`
returned `{"code":"0722252601704","status":0,"status_verbose":"product not found"}` (OFF padded it in the
*response*, but you cannot rely on that for the lookup). 8-digit codes stay 8 digits: querying
`0000000000000` produced `{"code":"00000000","status":0,"status_verbose":"no code or invalid code"}` and,
on v3, a warning `different_normalized_product_code`.

```ts
/** OFF/GS1 normal form: 8 → EAN-8 as-is; 12 → zero-pad to 13; 13/14 → as-is. */
export function normalizeGtin(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 8 || d.length === 13 || d.length === 14) return d;
  if (d.length === 12) return "0" + d;            // UPC-A → GTIN-13
  if (d.length === 7)  { const a = upcEtoUpcA(d); return a ? "0" + a : null; }
  return null;
}
```

Always try **both** forms against FDC — it stores `gtinUpc: '013764027053'` (12 digits with one leading
zero), i.e. neither our 13-digit form nor the raw 12-digit scan.

---

### 5. Recommendation — the lookup precedence rule

#### 5.1 The chain

Run **server-side in the Worker** (`POST /api/nutrition/resolve`), never from the browser. Reasons: the
`User-Agent` header cannot be set by `fetch` in a browser (§1.4), the FDC `api_key` must not reach the
client bundle (brief NFR "no secrets in the client bundle"), and only the Worker can write KV.

```
scan → normalizeGtin()
  │
  ├─ 0. D1 `foods` WHERE barcode = ? AND source = 'user'   → HIT: return, confidence 1.0, STOP
  │     (a value the user has ever corrected wins forever)
  │
  ├─ 1. D1 `foods` WHERE barcode = ?                       → HIT: return + revalidate in background
  │     (durable; survives KV eviction; works when upstreams are down)
  │
  ├─ 2. KV  `off:p:v2:<gtin13>`                            → HIT: map, upsert D1, return
  │
  ├─ 3. OFF GET /api/v2/product/<gtin13>?product_type=food&fields=<OFF_FIELDS>
  │        accept only if kcal != null AND at least one of protein/carb/fat != null
  │        → KV (30 d) + D1, source='off', confidence 0.90
  │
  ├─ 4. FDC GET /foods/search?query=<gtin>&dataType=Branded&pageSize=5
  │        match on gtinUpc, then GET /food/{fdcId} for the COMPLETE nutrient set (§2.5)
  │        → KV (90 d) + D1, source='fdc', confidence 0.85
  │
  └─ 5. AI estimate — getTextModel() + generateObject(Zod). The prompt carries the scanned
         barcode, any OFF/FDC partial (brand/name even when macros were missing), and the
         food photo if one exists.
         → source='ai', confidence = the model's own 0..1, MUST be user-confirmed before save,
           logged to ai_prompt_logs (model, prompt_version, input_ref, output_json, cost)
```

**Text / natural-language path** (no barcode — "2 eggs and toast", generic foods):

```
  0. D1 `foods` (the user's own rows + everything previously cached), LIKE/trigram match
  1. FDC /foods/search?query=<q>&dataType=SR%20Legacy,Survey%20(FNDDS)&pageSize=10
       then /food/{fdcId} for the chosen row      (generic foods — best quality, CC0)
  2. Search-a-licious /search?q=<q>                (branded / RU-market text; v0.1.0 → try/catch)
  3. AI: getTextModel() + generateObject           (multi-item parse, quantities, portions)
```

Step 5/3 is where **Nutritionix would have sat**. It does not exist for us (§3.2), and the AI
abstraction covers it better — it parses *multiple* items, quantities and RU text in one call and is
already instrumented. Prefer the hybrid: let the model do **quantity → grams**, then resolve the food
name through FDC `SR Legacy` for the actual per-100 g macros. That keeps the numbers auditable.

#### 5.2 Rate-limit budget — a non-issue, and why

One human scanning food. OFF allows 15 product reads/min; a person cannot scan 15 barcodes a minute and
confirm each one in a correction sheet. FDC allows 1,000/hour on a real key. **We will never approach
either.** The caching below is not for throughput — it is for **offline** and for **history stability**.

#### 5.3 KV: the volatile upstream-response cache

```ts
// wrangler.jsonc: kv_namespaces [{ binding: "NUTRITION_CACHE", id: "…" }]

const K = {
  offProduct: (g: string)  => `off:p:v2:${g}`,   // bump v2→v3 to invalidate the whole cache
  offMiss:    (g: string)  => `off:m:v2:${g}`,
  fdcFood:    (id: number) => `fdc:f:v1:${id}`,
  fdcQuery:   (h: string)  => `fdc:q:v1:${h}`,   // h = hex sha-256 of the normalised query
};

const TTL = {
  hit:  60 * 60 * 24 * 30,   // 30 d — product labels change slowly
  fdc:  60 * 60 * 24 * 90,   // 90 d — FDC releases are ~2×/year
  miss: 60 * 60 * 24,        //  1 d — a miss today may be a hit tomorrow (OFF is crowd-sourced)
};                            // NB: expirationTtl minimum is 60 s (G22)

await env.NUTRITION_CACHE.put(K.offProduct(g), JSON.stringify(raw), { expirationTtl: TTL.hit });
const cached = await env.NUTRITION_CACHE.get(K.offProduct(g), { type: "json", cacheTtl: 3600 });
```

Verified KV limits (<https://developers.cloudflare.com/kv/platform/limits/>): value **25 MiB**, key
**512 bytes**, metadata **1024 bytes**, *"Minimum cacheTtl: 30 seconds"*, free plan *"100,000 reads per
day"* / *"1,000 writes per day"* to different keys, and *"Writes to same key: 1 per second"* on **both**
plans. From the write API docs: for `expirationTtl`, *"The minimum value is 60"* seconds; and *"Writes
are immediately visible to other requests in the same global network location, but can take up to 60
seconds (or the value of the `cacheTtl` parameter …) to be visible in other parts of the world."*

Single-user traffic sits nowhere near these. Cache **raw upstream JSON**, not our mapped shape, so a
mapping bug is fixable by redeploy without re-fetching anything.

#### 5.4 D1: the durable food identity + the immutable log

Two tables, and the split matters more than anything else in this note.

```sql
-- Durable, mutable identity + current best nutrition, per 100 g. Survives KV eviction.
CREATE TABLE foods (
  id                TEXT PRIMARY KEY,          -- uuid
  barcode           TEXT,                      -- normalised GTIN-13 / EAN-8; NULL for generic foods
  fdc_id            INTEGER,
  name              TEXT NOT NULL,
  brand             TEXT,
  basis             TEXT NOT NULL DEFAULT '100g' CHECK (basis IN ('100g','100ml')),
  kcal_100g         REAL, protein_100g REAL, carb_100g REAL, fat_100g REAL,
  fiber_100g        REAL, sugar_100g   REAL,   sat_fat_100g REAL, sodium_mg_100g REAL,
  serving_grams     REAL,                      -- NULL when the product has no serving size
  serving_label     TEXT,                      -- e.g. '1 slice (45 g)'
  source            TEXT NOT NULL CHECK (source IN ('user','off','fdc','ai')),
  source_ref        TEXT,                      -- gtin | fdcId | ai_prompt_logs.id
  source_fetched_at INTEGER NOT NULL,
  confidence        REAL NOT NULL DEFAULT 1.0
);
CREATE UNIQUE INDEX foods_barcode_source ON foods(barcode, source) WHERE barcode IS NOT NULL;
CREATE INDEX        foods_fdc            ON foods(fdc_id)          WHERE fdc_id  IS NOT NULL;

-- The log. NEVER derive displayed history by joining back to `foods`.
-- These columns are a SNAPSHOT of what was true when the user pressed save.
-- (`calories, protein, carbs, fat` are already in the brief's food_entries — this is why.)
ALTER TABLE food_entries ADD COLUMN grams   REAL;            -- what was actually eaten
ALTER TABLE food_entries ADD COLUMN source  TEXT NOT NULL;   -- provenance of THIS entry
ALTER TABLE food_entries ADD COLUMN food_id TEXT REFERENCES foods(id);  -- reference only
```

**Adaptive TDEE back-calculates expenditure from bodyweight trend vs logged intake over a rolling
window.** If a 2026-01 entry's kcal silently changes because OFF corrected a label in 2027, the TDEE
model rewrites history and the user's calorie target moves for no visible reason. That is the single most
expensive bug available in this feature, and the snapshot columns are the whole defence.

#### 5.5 Offline behaviour

- Dexie mirrors `foods` (the user's own rows + everything ever looked up). A barcode scanned offline hits
  Dexie first; on a miss the scan is queued with the raw GTIN and resolved on reconnect, showing an
  "awaiting lookup" chip rather than blocking the log.
- Serwist must precache `/wasm/zxing_reader.wasm` so the iOS fallback scanner works in a shop with no
  signal. That is 402 KiB gzip of precache — deliberate, and worth it.

#### 5.6 Attribution, concretely

- Settings → About: `Данные о продуктах: Open Food Facts — ODbL 1.0 · USDA FoodData Central — CC0 1.0`,
  linking to <https://openfoodfacts.org> and <https://fdc.nal.usda.gov/>.
- Food-detail sheet: a small source chip per food — `OFF`, `USDA`, `AI`, `Вручную` — which doubles as the
  honesty signal the brief asks for ("show AI confidence, let the user correct").
- Do not display or cache OFF product **images** (CC-BY-SA 3.0, with per-image caveats). Text + barcode
  only; photos come from the user's own camera into R2.

---

## Gotchas that will silently break us

Ordered by how quietly they fail.

**G1 — FDC energy is not always nutrient 208.** `foodNutrients.find(n => n.nutrientNumber === "208")`
returns `undefined` on newer Foundation foods, which use `957`/`958`. `undefined?.value ?? 0` →
**0 kcal saved, no error, no warning**. Verified: `fdcId 2647443` has
`957 (2047) Energy (Atwater General Factors) KCAL 351` and `958 (2048) … 352` and **no 208**. Use the
chain `208 → 958 → 957 → 268/4.184 → 4P+4C+9F`, and persist which rung fired (`energy_source`).

**G2 — FDC search and detail responses have different shapes.** Search:
`{nutrientNumber, value, unitName: "KCAL"}`. Detail: `{nutrient: {number, unitName: "kcal"}, amount}`.
A mapper written against one returns all-`undefined` against the other. And the **unit case differs** —
a `unitName === "kcal"` check silently fails on search results.

**G3 — FDC search returns an incomplete nutrient list.** Measured: the Foundation lunchmeat's search
entry carried 71 nutrients, none of them macros. Saving straight from search results persists partial
foods. Always confirm from `/food/{fdcId}` (or `/foods?fdcIds=`) before writing to D1.

**G4 — OFF `energy_100g` is kilojoules.** `energy_100g: 1252.09` alongside `energy-kcal_100g: 244` and
`energy_unit: "kJ"`. Reading `energy_100g` as calories inflates everything ~4.18×, which looks like a
plausible "big meal" rather than a bug. Use `energy-kcal_100g`; trust `energy_100g` only when
`energy_unit === "kcal"`.

**G5 — OFF `nutrition_data_per` can be `"100ml"`.** Observed in a 5-product sample. The `_100g` keys are
then per 100 **millilitres**. For a drink logged by grams this is a few percent; for oil or syrup it is
not. Persist `basis` and refuse to silently convert ml↔g.

**G6 — OFF `*_serving` keys may not exist at all.** They are present only when `serving_size` is set.
Nutella has `serving_size: null` and zero `*_serving` keys. A UI that defaults to "1 serving" renders
`NaN`.

**G7 — OFF v2 returns HTTP 200 for a miss.** `{"status":0,"status_verbose":"product not found"}` with
**200 OK**. But a *wrong-product-type* hit returns **404** with
`{"status":0,"status_verbose":"product found with a different product type: beauty"}`. So
`if (!res.ok) return null` mis-handles the common miss and `if (res.ok) parse()` mis-handles the beauty
case. Branch on the JSON `status` field and handle 404 separately. v3 is cleaner
(`status: "success"|"failure"`, `result.id`, `errors[]`) — but has no search (G10).

**G8 — barcode form mismatch.** A US 12-digit UPC-A must be zero-padded to 13 for OFF; FDC stores it as
12 digits (`gtinUpc: '013764027053'`). Query the unpadded form against OFF and it misses; query the
padded form against FDC and it misses. Both misses look identical to "product not in database".

**G9 — do not pin an OFF minor version in the path.** Measured, reproducibly (5/5 attempts):
`/api/v3.6/product/3017624010701?fields=code,product_name,nutriments,serving_size` returned
`"nutriments":{}` while `/api/v3/product/…` with the identical query returned 49 nutriment keys. The call
*succeeds* — `status: "success"`, `result.id: "product_found"`, `product_name` populated — it just has no
nutrition. Use `/api/v2/` or `/api/v3/`, never `/api/v3.6/`.

**G10 — "migrate to v3" silently removes search.** v3 has no structured search and no full-text search.
If a future cleanup moves everything to v3, barcode lookup keeps working while brand/text lookup
disappears — a partial, confusing failure. Deliberately keep **v2 for `/api/v2/search`**, pick v2 or v3
for product reads, and write the choice into `DECISIONS.md`.

**G11 — `nutriments` contains non-nutrients.** `nova-group_100g`,
`fruits-vegetables-legumes-estimate-from-ingredients_100g`,
`fruits-vegetables-nuts-estimate-from-ingredients_100g`. Any "iterate the nutriments and render them"
micronutrient panel shows garbage rows. Use an explicit allow-list.

**G12 — `carbohydrates-total_*` exists on some US products** alongside `carbohydrates_*` (observed as
`carbohydrates-total_serving` in the US search sample). If one is null and the other isn't, a
single-key read loses the value.

**G13 — `*_prepared_*` is a second, parallel nutrition set.** For a powder or dry pasta the `_100g`
family is the dry product and `_prepared_100g` is as-consumed. Logging dry values for a prepared drink
overstates by an order of magnitude.

**G14 — salt vs sodium.** OFF gives **both** `salt_100g` and `sodium_100g` in **grams**
(`sodium_unit: "g"`, e.g. `0.043`). FDC gives `Sodium, Na` (307) in **mg**. Mixing them is a 1000× or
2.5× error that no unit test catches unless you assert units.

**G15 — the same barcode gives different calories from different sources.** GTIN `0013764027053`:
OFF 244 kcal/100 g, FDC 267 kcal/100 g. If the resolver is nondeterministic (OFF times out, FDC answers)
the "same" food logs differently on different days, and the adaptive-TDEE model sees noise it attributes
to metabolism. Record `source` per entry, keep a stable precedence order, never race the two.

**G16 — OFF gives no rate-limit feedback and punishes with bans, not 429s.** No `X-RateLimit-*`, no
`Retry-After` (verified on live 200s). Exceeding limits risks *"deny you access to the website and the
API through IP address ban"*, and a global limit returns **503**. Worse: **our Worker's egress IP is
Cloudflare's, shared with every other Worker** — a per-IP budget is neither ours to spend nor ours to be
banned for. Mitigation: D1/KV first; a self-imposed cap of ~1 req/2 s in the Worker; treat **both 429 and
503** as "serve stale from D1"; and put a real, reachable contact e-mail in the User-Agent so OFF mails
us instead of blocking us.

**G17 — `zxing-wasm`'s default `locateFile` fetches the `.wasm` from jsDelivr.** Verbatim from the
package: *"The `locateFile` function is overridden by default to load the WASM file from the jsDelivr
CDN."* Three ways this bites: (a) the PWA cannot scan offline — exactly when the phone is in a shop
basement; (b) a strict `Content-Security-Policy` blocks the cross-origin fetch; (c) a third-party CDN
becomes a runtime dependency of an app whose headline promise is "works offline". **Always pass
`overrides.locateFile`** pointing at a same-origin `/wasm/zxing_reader.wasm`, copy the file out of
`node_modules` in a build step, and precache it in Serwist. Also serve it as
`Content-Type: application/wasm` so streaming compilation works — **UNVERIFIED** whether Cloudflare
Workers static assets set that for `.wasm` by default; assert it in a smoke test.

**G18 — a strict CSP blocks WebAssembly entirely.** Verbatim from MDN: *"If a page has a CSP header and
`'wasm-unsafe-eval'` isn't specified in the `script-src` directive, WebAssembly is blocked from loading
and executing on the page."* The iOS scanner then fails with a console error nobody sees. If we ship a
CSP (we should), `script-src` needs `'wasm-unsafe-eval'`.

**G19 — `"BarcodeDetector" in window` is not a support check.** Chrome exposes it on ChromeOS and macOS
only, and *"Before Chrome 113, on macOS Ventura (13) and above, this interface silently failed"* — note
**silently**. Gate on `await BarcodeDetector.getSupportedFormats()` actually containing `ean_13`, inside
a `try/catch`, and fall through to wasm on any throw or empty intersection.

**G20 — `facingMode: { exact: "environment" }` throws.** Per spec, an unsatisfiable `exact` constraint
rejects with `OverconstrainedError`. On a laptop with only a front camera the whole scanner screen dies
instead of degrading. Use `{ ideal: "environment" }` and then verify with
`track.getSettings().facingMode`.

**G21 — torch/zoom capability shapes are not what they look like.** Per spec, `MediaTrackCapabilities`
has `sequence<boolean> torch` and `MediaSettingsRange zoom`. `if (caps.torch)` is truthy for `[false]` —
i.e. for a device that explicitly *cannot* do torch. Check `caps.torch.includes(true)`. Wrap every
`applyConstraints` in try/catch: browsers may advertise and still reject. Per-browser support for these
two is **UNVERIFIED** (MDN BCD does not track them).

**G22 — KV `expirationTtl` under 60 rejects the write.** *"The minimum value is 60"*. A tempting
30-second negative cache silently throws. Minimum `cacheTtl` is a separate 30 s.

**G23 — KV is eventually consistent.** *"can take up to 60 seconds … to be visible in other parts of the
world."* Irrelevant for one user on one phone; it becomes a phantom bug the moment anyone tests from two
locations and concludes the cache "doesn't work".

**G24 — Workers limits refine, but do not contradict, stack-facts.** Verified
(<https://developers.cloudflare.com/workers/platform/limits/>): subrequests **50/request free**,
**10,000/request paid**; *"Each Worker invocation can have up to six connections simultaneously waiting
for response headers"*; Cron CPU on paid is **30 s for intervals < 1 hour** and **15 min for ≥ 1 hour**
(stack-facts' "15 min per Cron Trigger" is the ≥ 1 h case). A resolver that fans out
OFF + FDC-search + FDC-detail for each of 6 items in a photo estimate is 18 subrequests and can stall on
the connection limit. Resolve sequentially with early exit — which the precedence rule already does.

**G25 — the Nutritionix docs you will find first are wrong.** The `nutritionix/api-documentation` GitHub
repo still documents `apibeta.nutritionix.com/v2/natural` with `Content-Type: text/plain` and a
newline-separated body. Following it produces requests that fail against the real
`trackapi.nutritionix.com/v2/natural/nutrients` JSON API — and it is moot anyway, because there is no
free tier to get a key from (§3.2).

**G26 — `DEMO_KEY` is tighter than documented.** Docs say 30/hour; measured `X-Ratelimit-Limit: 10`. Any
smoke test that "works on my machine" with a real key will 429 in CI on `DEMO_KEY`. Put the FDC key in
`.dev.vars` / Worker secrets from day one and skip FDC tests when it is absent.

**G27 — `servingSizeUnit` is a UN/CEFACT code.** FDC Branded returns `'GRM'`, not `'g'` (`'MLT'` for
ml). String-comparing to `"g"` silently drops every branded serving size.

---

## Open decision for the owner

### Decision 1 (needs the owner — money / an external conversation): Nutritionix

Nutritionix's public free tier no longer exists (their own words, §3.2). The brief lists it as
"optional", so this is a fork, not a blocker.

- **Option A — drop Nutritionix entirely.** Natural-language logging ("2 eggs and toast") goes through
  the existing AI abstraction: `getTextModel()` + `generateObject` + Zod, a pinned Gemini model id,
  logged to `ai_prompt_logs`. Cost: a few thousand tokens per parse on `gemini-2.5-flash-lite` at
  $0.10/$0.40 per 1M (stack-facts) — effectively free at one user's volume. No new vendor, no new key,
  no new attribution, one fewer failure mode. Downside: the model *estimates* portions rather than
  looking them up, so "1 medium banana" depends on the model. Mitigated by resolving the parsed food
  name through FDC `SR Legacy` for the per-100 g macros and using the model only for
  **quantity → grams**.
- **Option B — request a Syndigo/Nutritionix trial** through their sales form, for the curated
  `alt_measures` portion table and `nf_*` fields. Cost: a sales conversation, unknown commercial terms,
  a revocable per-use-case trial, plus an attribution obligation — for a capability Option A already
  delivers.

**Recommendation: Option A.** Record in `DECISIONS.md`: "Nutritionix rejected 2026-09-12 — no public
free tier (developer.nutritionix.com); natural-language logging served by the AI abstraction + FDC
SR Legacy for macros."

### Decision 2 (design; the owner may want a say): does the scanner's HTTP call go through our Worker?

- **Option A — Worker proxy** (`POST /api/nutrition/resolve`): real `User-Agent`, FDC key stays
  server-side, KV + D1 caching, one place to self-rate-limit. Cost: OFF sees a shared Cloudflare egress
  IP (G16), and a scan needs network even for a barcode the browser could have asked about itself.
- **Option B — browser calls OFF directly** (CORS is `Access-Control-Allow-Origin: *`, verified) so the
  per-IP limit lands on the user's own IP. Cost: cannot set `User-Agent` (the `X-User-Agent` workaround
  is **UNVERIFIED**), no KV cache, and FDC still needs a proxy for the key — so we end up building both
  paths anyway.

**Recommendation: Option A**, with the self-imposed ~1 req/2 s cap and stale-from-D1 on 429/503.

---

## Sources

**Local files read**

- `C:/Users/tairc/Documents/codespace/fitness-app-tair/specs/00-brief.md`
- `C:/Users/tairc/Documents/codespace/fitness-app-tair/docs/research/stack-facts.md`

**Open Food Facts**

- <https://openfoodfacts.github.io/openfoodfacts-server/api/> (docs index, rendered)
- <https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/docs/api/index.md> — versions table, rate limits, User-Agent policy, licences (quoted verbatim above)
- <https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/docs/api/ref-cheatsheet.md> — `fields`, bulk `?code=a,b,c`, `_prepared` nutriments
- <https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/docs/api/ref/api-v3.yaml> — `/api/v3/product/{code}`, `fields` semantics, 302/404
- <https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/docs/api/ref/parameters/product_available_fields.yaml>
- <https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/docs/api/ref/parameters/requested_product_type.yaml>
- <https://world.openfoodfacts.org/terms-of-use> — ODbL / DbCL / CC-BY-SA and the attribution sentence
- Live calls (2026-09-12, `User-Agent: FitnessAppTairResearch/0.1 (tairkaldybayev@gmail.com)`):
  `/api/v2/product/3017624010701`, `/api/v2/product/0013764027053`, `/api/v3/product/3017624010701`,
  `/api/v3.6/product/3017624010701`, `/api/v2/product/0000000000000`, `/api/v3/product/0000000000000`,
  `/api/v2/product/722252601704`, `/api/v2|v3/product/8710447445990`,
  `/api/v2/search?countries_tags_en=united-states&fields=…&page_size=5`
- <https://search.openfoodfacts.org/search?q=nutella&page_size=2&fields=code,product_name> and <https://search.openfoodfacts.org/openapi.json>

**USDA FoodData Central**

- <https://fdc.nal.usda.gov/api-guide/> — base URL, endpoints, `api_key` query param, rate limits, DEMO_KEY limits, data types, `X-RateLimit-*`
- <https://fdc.nal.usda.gov/> — CC0 statement and suggested citation
- Live calls (2026-09-12, `DEMO_KEY`): `/fdc/v1/foods/search?query=chicken breast&dataType=Foundation,SR Legacy`,
  `/fdc/v1/foods/search?query=cheddar cheese&dataType=Foundation`,
  `/fdc/v1/foods/search?query=013764027053&dataType=Branded`,
  `/fdc/v1/foods?fdcIds=2759004&fdcIds=174608&format=full`

**Nutritionix**

- <https://developer.nutritionix.com/> — the "no longer able to maintain a public free-access tier" notice (quoted verbatim)
- <https://docx.syndigo.com/developers/docs/natural-language-for-nutrients> — current endpoint, headers, body, `nf_*` fields
- <https://docx.syndigo.com/developers/docs/nutritionix-api-guide>
- <https://raw.githubusercontent.com/nutritionix/api-documentation/master/v2/natural.md> — the **stale** docs (cited as a hazard, not as truth)
- <https://www.nutritionix.com/api> — returns HTTP 402 to non-browser clients

**Barcode scanning**

- <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/BarcodeDetector.json> — full support matrix (quoted verbatim)
- <https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/MediaStreamTrack.json>, `…/api/ImageCapture.json`
- <https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector> — "Limited availability", SecureContext
- <https://wicg.github.io/shape-detection-api/> — BarcodeDetector IDL, `BarcodeFormat` enum
- <https://w3c.github.io/mediacapture-main/> — `VideoFacingModeEnum`, `exact` vs `ideal`, `OverconstrainedError`
- <https://w3c.github.io/mediacapture-image/> — `torch` / `zoom` / `focusMode` IDL in Constraints/Capabilities/Settings
- <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src> — `'wasm-unsafe-eval'`
- npm registry metadata: `zxing-wasm` 3.1.4, `@zxing/library` 0.23.0, `@zxing/browser` 0.2.1
- `zxing-wasm@3.1.4` published tarball, unpacked and measured in the scratchpad:
  `dist/es/reader/index.d.ts`, `dist/es/share.d.ts`, `dist/es/bindings/readerOptions.d.ts`,
  `dist/es/bindings/barcodeFormat.d.ts`, `dist/es/bindings/readResult.d.ts`, `README.md`, and
  byte/gzip sizes of `dist/reader/zxing_reader.wasm`, `dist/full/zxing_full.wasm`,
  `dist/writer/zxing_writer.wasm`, `dist/es/reader/index.js`

**Cloudflare**

- <https://developers.cloudflare.com/kv/platform/limits/> — value/key/metadata sizes, minimum `cacheTtl`, free-plan read/write limits, same-key write rate
- <https://developers.cloudflare.com/kv/api/write-key-value-pairs/> — `expirationTtl` minimum 60 s, eventual-consistency window
- <https://developers.cloudflare.com/workers/platform/limits/> — subrequests 50 (free) / 10,000 (paid), six simultaneous connections, Cron CPU 30 s (< 1 h interval) vs 15 min (≥ 1 h)
