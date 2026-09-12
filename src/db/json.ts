/**
 * The only place a JSON column is read or written.
 *
 * Rule 6, in full. JSON columns are plain `text(n)`; `mode: "json"` is **banned**, because
 * `SQLiteTextJson.mapFromDriverValue` calls `JSON.parse` inside drizzle's result mapping — one
 * malformed row therefore throws and takes the *entire* `SELECT` with it, and by the time app code
 * is reached the raw text is unreachable. The rows that would crash are exactly the ones rule 6
 * exists for: rows from an import, a restore, or an older `schema_version`. So the parse boundary
 * has to be here, above drizzle, where a bad row can degrade to a visible placeholder instead of
 * blanking a list.
 *
 * Hence the two readers:
 *  - `parseJson`   — for a value this app wrote and whose shape is an invariant. Throws.
 *  - `tryParseJson` — for anything that may have come from outside. Never throws; hands back the
 *    raw text so the UI can show the row and the user can fix or delete it.
 *
 * ## The byte cap counts BYTES, and that is the whole point
 *
 * `MAX_JSON_BYTES` is enforced in UTF-8 bytes here and as
 * `CHECK (length(CAST(col AS BLOB)) <= 65536)` in SQL. **`length()` counts characters, not
 * bytes**: on SQLite 3.50.4 a 6-character Cyrillic string gives `length() = 6` but
 * `length(CAST(x AS BLOB)) = 12`. This app defaults to `locale='ru'`, so notes and AI output run
 * ~2 bytes/character and the naive `length(col) <= 65536` would really cap at ~128 KB. D1's row
 * limit is 2 MB, so the cap is a deliberate budget, not the hard ceiling — anything genuinely
 * larger (a full AI response) belongs in R2 with only the key stored here.
 *
 * `toJson` applies the same cap before the write, so a writer never has to be truncated into a
 * row the SQL CHECK would reject.
 */
import type { z } from "zod";

/** Per-column JSON budget, in UTF-8 **bytes**. Mirrored by the SQL `CAST(col AS BLOB)` CHECK. */
export const MAX_JSON_BYTES = 65_536;

const encoder = new TextEncoder();

/** UTF-8 byte length. Exported because every caller that reports a cap breach needs the number. */
export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Read a JSON column whose shape is an invariant of this app's own writes.
 *
 * `null` is passed to the schema as the JSON value `null`, so a nullable column is declared
 * `.nullable()` once in its codec and needs no guard at the call site. Anything the schema
 * rejects — and any malformed text — throws.
 */
export function parseJson<T extends z.ZodType>(schema: T, raw: string | null): z.infer<T> {
  if (raw === null) return schema.parse(null) as z.infer<T>;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw new SyntaxError(`db/json: column is not valid JSON (${raw.length} chars)`, { cause });
  }
  return schema.parse(decoded) as z.infer<T>;
}

/**
 * Read a JSON column that may have come from an import, a restore or an older schema version.
 *
 * Never throws. On failure the raw text comes back with the error so the caller can render the
 * row in a degraded state — which is the entire reason `mode: "json"` is banned.
 */
export function tryParseJson<T extends z.ZodType>(
  schema: T,
  raw: string | null,
): { ok: true; value: z.infer<T> } | { ok: false; error: string; raw: string } {
  try {
    return { ok: true, value: parseJson(schema, raw) };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      raw: raw ?? "",
    };
  }
}

/**
 * Write a JSON column: validate, serialise, then enforce the byte cap.
 *
 * The cap is checked on the serialised bytes rather than on the input value because that is what
 * the SQL CHECK will measure; validating first means a cap breach is always reported against a
 * payload that was otherwise well-formed.
 */
export function toJson<T extends z.ZodType>(schema: T, value: z.infer<T>): string {
  // `JSON.stringify` is typed as returning `string` but genuinely returns `undefined` for
  // `undefined`, a function, or a symbol — the annotation is what lets the guard below compile.
  const serialised: string | undefined = JSON.stringify(schema.parse(value));
  if (serialised === undefined) {
    throw new TypeError("db/json: value is not serialisable to JSON");
  }
  const bytes = utf8ByteLength(serialised);
  if (bytes > MAX_JSON_BYTES) {
    throw new RangeError(
      `db/json: payload is ${bytes} UTF-8 bytes, cap is ${MAX_JSON_BYTES}. ` +
        `Store the payload in R2 and keep only its key in D1.`,
    );
  }
  return serialised;
}
