/**
 * TOTP second factor.
 *
 * `otpauth/slim` is imported rather than `otpauth` because the package's main entry uses a
 * `node:` conditional export that does not resolve on workerd
 * (docs/research/r04-auth-for-single-user-on-workers.md §3.1).
 */
import { Secret, TOTP } from "otpauth/slim";

const DIGITS = 6;
const PERIOD_SECONDS = 30;
const ALGORITHM = "SHA1"; // What every authenticator app actually implements.

/**
 * How many 30s steps either side of "now" are accepted, to tolerate clock skew between the
 * phone and Cloudflare's clock. 1 means a code stays usable for ~90s total.
 */
const WINDOW_STEPS = 1;

const ISSUER = "Форма";

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totpFor(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  });
}

/** The `otpauth://` URI to render as a QR code during setup. */
export function totpUri(secret: string, label: string): string {
  return totpFor(secret, label).toString();
}

/** The 30-second step counter a timestamp falls into. Used for replay prevention. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS);
}

export type TotpResult =
  { ok: true; step: number } | { ok: false; reason: "malformed" | "invalid" | "replayed" };

/**
 * Verify a TOTP code.
 *
 * `lastAcceptedStep` prevents replay: a code is valid for a whole 30s window, so without this
 * a code shoulder-surfed or captured from a log could be used again inside its own window.
 * Callers MUST persist the returned `step`.
 */
export function verifyTotp(
  code: string,
  secret: string,
  nowMs: number,
  lastAcceptedStep: number | null,
): TotpResult {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return { ok: false, reason: "malformed" };

  const delta = totpFor(secret, "verify").validate({
    token: normalized,
    timestamp: nowMs,
    window: WINDOW_STEPS,
  });
  if (delta === null) return { ok: false, reason: "invalid" };

  const step = totpStep(nowMs) + delta;
  if (lastAcceptedStep !== null && step <= lastAcceptedStep) {
    return { ok: false, reason: "replayed" };
  }
  return { ok: true, step };
}
