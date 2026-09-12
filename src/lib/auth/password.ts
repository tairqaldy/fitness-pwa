/**
 * Password hashing on Cloudflare Workers.
 *
 * PBKDF2-SHA256 via WebCrypto is used because it is the only credible option on workerd:
 * `scrypt` throws `NotSupportedError` there, and bcrypt/argon2 are native modules that cannot
 * run at all (verified in docs/research/r04-auth-for-single-user-on-workers.md §3.1).
 *
 * The iteration count is stored alongside each hash so it can be raised later without
 * invalidating existing passwords.
 */

/**
 * OWASP's current PBKDF2-SHA256 recommendation. WebCrypto's implementation is native, so this
 * costs single-digit milliseconds of CPU — comfortably inside the Worker request budget, and
 * only ever paid on an explicit login, never on a session check.
 */
export const PBKDF2_ITERATIONS = 600_000;

const KEY_BITS = 256;
const SALT_BYTES = 16;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Returns `Uint8Array<ArrayBuffer>` rather than the default `Uint8Array<ArrayBufferLike>`,
 * because WebCrypto's `BufferSource` will not accept a view that might be backed by a
 * `SharedArrayBuffer`. Allocating the buffer explicitly pins the type.
 */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function generateSalt(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** Derive the PBKDF2 hash of `password`, returned base64url. */
export async function hashPassword(
  password: string,
  salt: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations },
    key,
    KEY_BITS,
  );
  return toBase64Url(new Uint8Array(bits));
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * `crypto.subtle.timingSafeEqual` is a Cloudflare extension and is not present in every
 * runtime (notably not in plain Node used by the unit tests), so there is a constant-time
 * fallback. The fallback compares hashes of equal, fixed length — not raw user input — so the
 * early length check cannot leak anything useful.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;

  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(left, right);
  }

  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** Verify a password against a stored hash. */
export async function verifyPassword(
  password: string,
  storedHash: string,
  salt: string,
  iterations: number,
): Promise<boolean> {
  return safeEqual(await hashPassword(password, salt, iterations), storedHash);
}

/**
 * Minimum password policy. Deliberately length-first: for a single-user app protected by a
 * second factor, a long passphrase beats character-class rules the owner will resent.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function validatePasswordStrength(
  password: string,
): { ok: true } | { ok: false; reason: string } {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.` };
  }
  if (/^\s|\s$/.test(password)) {
    return { ok: false, reason: "Пароль не должен начинаться или заканчиваться пробелом." };
  }
  return { ok: true };
}
