import { Secret, TOTP } from "otpauth/slim";
import { describe, expect, it } from "vitest";

import {
  generateSalt,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  safeEqual,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/auth/password";
import {
  clearedSessionCookieHeader,
  issueSession,
  readSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieHeader,
} from "@/lib/auth/session";
import { generateTotpSecret, totpStep, totpUri, verifyTotp } from "@/lib/auth/totp";

/**
 * Mints a real TOTP code the way an authenticator app would, so the verify path is tested
 * against genuine input rather than a hand-written constant that would rot.
 */
function generate(secret: string, atMs: number): string {
  return new TOTP({
    issuer: "Форма",
    label: "tair",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: atMs });
}

const SECRET = "a".repeat(32);
const NOW = 1_789_221_376_000;
// Fewer iterations than production purely so the suite stays fast; the algorithm is identical.
const TEST_ITERATIONS = 1_000;

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("correct horse battery staple", salt, TEST_ITERATIONS);
    await expect(
      verifyPassword("correct horse battery staple", hash, salt, TEST_ITERATIONS),
    ).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const salt = generateSalt();
    const hash = await hashPassword("correct horse battery staple", salt, TEST_ITERATIONS);
    await expect(
      verifyPassword("wrong horse battery staple", hash, salt, TEST_ITERATIONS),
    ).resolves.toBe(false);
  });

  it("produces different hashes for the same password under different salts", async () => {
    const a = await hashPassword("same password", generateSalt(), TEST_ITERATIONS);
    const b = await hashPassword("same password", generateSalt(), TEST_ITERATIONS);
    expect(a).not.toBe(b);
  });

  it("is deterministic for a fixed salt and iteration count", async () => {
    const salt = generateSalt();
    const a = await hashPassword("same password", salt, TEST_ITERATIONS);
    const b = await hashPassword("same password", salt, TEST_ITERATIONS);
    expect(a).toBe(b);
  });

  it("changes the hash when the iteration count changes", async () => {
    // Guarantees stored iterations are actually load-bearing, so the cost can be raised later.
    const salt = generateSalt();
    const a = await hashPassword("same password", salt, TEST_ITERATIONS);
    const b = await hashPassword("same password", salt, TEST_ITERATIONS * 2);
    expect(a).not.toBe(b);
  });

  it("emits url-safe base64 with no padding", async () => {
    const hash = await hashPassword("x".repeat(20), generateSalt(), TEST_ITERATIONS);
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("handles non-ASCII passwords", async () => {
    const salt = generateSalt();
    const password = "пароль-с-кириллицей-и-emoji-🏋";
    const hash = await hashPassword(password, salt, TEST_ITERATIONS);
    await expect(verifyPassword(password, hash, salt, TEST_ITERATIONS)).resolves.toBe(true);
  });
});

describe("safeEqual", () => {
  it("is true for identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });
  it.each([
    ["different content", "abc", "abd"],
    ["different length", "abc", "abcd"],
    ["empty vs non-empty", "", "a"],
  ])("is false for %s", (_label, a, b) => {
    expect(safeEqual(a, b)).toBe(false);
  });
});

describe("validatePasswordStrength", () => {
  it("accepts a long passphrase", () => {
    expect(validatePasswordStrength("a-reasonably-long-passphrase").ok).toBe(true);
  });
  it("rejects one shorter than the minimum", () => {
    expect(validatePasswordStrength("x".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
  });
  it("accepts exactly the minimum length", () => {
    expect(validatePasswordStrength("x".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });
  it("rejects surrounding whitespace, which is almost always a paste accident", () => {
    expect(validatePasswordStrength(" a-long-enough-passphrase ").ok).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips claims", async () => {
    const token = await issueSession({ sub: "user-1", v: 3 }, SECRET, NOW);
    await expect(readSession(token, SECRET, NOW)).resolves.toEqual({ sub: "user-1", v: 3 });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueSession({ sub: "user-1", v: 1 }, SECRET, NOW);
    await expect(readSession(token, "b".repeat(32), NOW)).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await issueSession({ sub: "user-1", v: 1 }, SECRET, NOW);
    const parts = token.split(".");
    const forged = `${parts[0]}.${btoa('{"sub":"user-1","v":999}')}.${parts[2]}`;
    await expect(readSession(forged, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await issueSession({ sub: "user-1", v: 1 }, SECRET, NOW);
    const afterExpiry = NOW + (SESSION_MAX_AGE_SECONDS + 60) * 1000;
    await expect(readSession(token, SECRET, afterExpiry)).resolves.toBeNull();
  });

  it("still accepts a token just before expiry", async () => {
    const token = await issueSession({ sub: "user-1", v: 1 }, SECRET, NOW);
    const justBefore = NOW + (SESSION_MAX_AGE_SECONDS - 60) * 1000;
    await expect(readSession(token, SECRET, justBefore)).resolves.not.toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["empty string", ""],
    ["garbage", "not-a-jwt"],
    ["two segments", "aaa.bbb"],
  ])("rejects %s", async (_label, token) => {
    await expect(readSession(token, SECRET, NOW)).resolves.toBeNull();
  });

  it("refuses to sign with a short secret rather than producing a weak signature", async () => {
    await expect(issueSession({ sub: "u", v: 1 }, "too-short", NOW)).rejects.toThrow(/at least 32/);
  });
});

describe("session cookie attributes", () => {
  it("sets every attribute the offline requirement depends on", () => {
    const header = sessionCookieHeader("token-value");
    expect(header).toContain(`${SESSION_COOKIE}=token-value`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    // An explicit Max-Age is what stops the OS killing the PWA from logging the user out;
    // without it the cookie is a session cookie and the app is unusable offline.
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  });

  it("uses the __Host- prefix, which the browser ties to this exact host", () => {
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    // The prefix is only honoured with no Domain attribute.
    expect(sessionCookieHeader("t")).not.toContain("Domain");
  });

  it("expires the cookie on logout", () => {
    expect(clearedSessionCookieHeader()).toContain("Max-Age=0");
  });
});

describe("TOTP", () => {
  it("exposes an otpauth URI every authenticator app understands", () => {
    const uri = totpUri(generateTotpSecret(), "tair");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("accepts a genuine code for the current step", () => {
    const secret = generateTotpSecret();
    const code = generate(secret, NOW);
    expect(verifyTotp(code, secret, NOW, null)).toEqual({ ok: true, step: totpStep(NOW) });
  });

  it("rejects a replay of a code already accepted in the same window", () => {
    // Without this guard a code shoulder-surfed mid-window could be used a second time.
    const secret = generateTotpSecret();
    const code = generate(secret, NOW);
    const first = verifyTotp(code, secret, NOW, null);
    expect(first.ok).toBe(true);
    const replay = verifyTotp(code, secret, NOW, first.ok ? first.step : null);
    expect(replay).toEqual({ ok: false, reason: "replayed" });
  });

  it("tolerates one step of clock skew in each direction", () => {
    const secret = generateTotpSecret();
    // A code minted by a phone whose clock is 30s behind must still work.
    const past = generate(secret, NOW - 30_000);
    expect(verifyTotp(past, secret, NOW, null).ok).toBe(true);
    const future = generate(secret, NOW + 30_000);
    expect(verifyTotp(future, secret, NOW, null).ok).toBe(true);
  });

  it("rejects skew beyond the accepted window", () => {
    const secret = generateTotpSecret();
    const wayOff = generate(secret, NOW + 5 * 30_000);
    expect(verifyTotp(wayOff, secret, NOW, null)).toEqual({ ok: false, reason: "invalid" });
  });

  it.each([
    ["too short", "12345"],
    ["non-numeric", "12a456"],
    ["empty", ""],
  ])("rejects a %s code as malformed", (_label, code) => {
    const result = verifyTotp(code, generateTotpSecret(), NOW, null);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a well-formed but wrong code", () => {
    const result = verifyTotp("000000", generateTotpSecret(), NOW, null);
    // Astronomically unlikely to be the real code; if it ever is, reason would be "ok".
    expect(result.ok).toBe(false);
  });

  it("derives a monotonically increasing step from time", () => {
    // Must start from a step boundary: NOW itself is mid-step, so NOW+29s would legitimately
    // land in the next window and the "same step" assertion would be meaningless.
    const aligned = Math.floor(NOW / 30_000) * 30_000;
    expect(totpStep(aligned + 29_999)).toBe(totpStep(aligned));
    expect(totpStep(aligned + 30_000)).toBe(totpStep(aligned) + 1);
  });

  it("generates a 32-character base32 secret", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});
