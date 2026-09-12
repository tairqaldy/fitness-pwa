/**
 * Sortable, offline-mintable identifiers.
 *
 * Every row in this app can be created on a phone with no network, so ids must be generated
 * on the client and survive unchanged when the row syncs. They must also sort by creation
 * time, because almost every query in the app is "most recent first" and a k-sortable id
 * lets the primary key index serve that directly.
 *
 * Format: 26-character Crockford-base32 ULID — 48-bit millisecond timestamp + 80 bits of
 * randomness. Lexicographic order matches chronological order.
 * Spec: https://github.com/ulid/spec
 *
 * `now` is always a parameter so callers in tests are deterministic.
 */

/** Crockford base32: no I, L, O or U, so an id can be read aloud without ambiguity. */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/** Largest timestamp a 10-character base32 field can hold: 2^48 - 1. */
export const MAX_ULID_TIME = 281_474_976_710_655;

function encodeTime(now: number): string {
  if (!Number.isInteger(now) || now < 0 || now > MAX_ULID_TIME) {
    throw new RangeError(`ulid: timestamp out of range: ${now}`);
  }
  let out = "";
  let rest = now;
  for (let i = 0; i < TIME_LEN; i++) {
    out = ENCODING[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeRandom(random: Uint8Array): string {
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    // Each byte yields one base32 char; we only need 5 of its 8 bits.
    out += ENCODING[random[i]! % 32];
  }
  return out;
}

/**
 * Generate a ULID.
 *
 * @param now  epoch milliseconds. Pass `Date.now()` in app code; pass a fixed value in tests.
 * @param randomBytes  injectable entropy, for deterministic tests. Defaults to `crypto`.
 */
export function ulid(now: number, randomBytes?: Uint8Array): string {
  const random = randomBytes ?? crypto.getRandomValues(new Uint8Array(RANDOM_LEN));
  if (random.length < RANDOM_LEN) {
    throw new RangeError(`ulid: need ${RANDOM_LEN} random bytes, got ${random.length}`);
  }
  return encodeTime(now) + encodeRandom(random);
}

/** Recover the creation instant from a ULID. Useful for debugging and for import dedupe. */
export function ulidTime(id: string): number {
  const time = id.slice(0, TIME_LEN);
  let out = 0;
  for (const char of time) {
    const value = ENCODING.indexOf(char);
    if (value === -1) throw new TypeError(`ulid: invalid character ${char in {} ? "?" : char}`);
    out = out * 32 + value;
  }
  return out;
}

const ULID_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

/** True for a syntactically valid ULID. Use at every trust boundary (Zod refinement). */
export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}
