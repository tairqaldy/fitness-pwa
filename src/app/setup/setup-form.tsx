"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BeginResponse = { ok: true; otpauthUri: string; secret: string };

/**
 * First-run setup, in two steps.
 *
 * The two steps exist so the owner cannot lock themselves out: a TOTP secret is only stored as
 * confirmed after they have proved their authenticator produces a valid code from it.
 *
 * The password is chosen here by the owner. It is sent once over HTTPS, hashed with PBKDF2 on
 * the server, and never stored, logged or echoed anywhere.
 */
export function SetupForm() {
  const t = useTranslations("Setup");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [enrolment, setEnrolment] = useState<BeginResponse | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "begin", password }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<BeginResponse> & {
        error?: string;
        reason?: string;
      };
      if (!response.ok || !data.otpauthUri || !data.secret) {
        setError(data.reason ?? t("saveFailed"));
        return;
      }
      setEnrolment({ ok: true, otpauthUri: data.otpauthUri, secret: data.secret });
      setStep("totp");
      // The password is no longer needed in memory once it has been accepted.
      setPassword("");
      setConfirm("");
    } catch {
      setError(tCommon("networkError"));
    } finally {
      setPending(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "confirm", code }),
      });
      if (response.ok) {
        router.replace("/");
        return;
      }
      setError(t("badCode"));
    } catch {
      setError(tCommon("networkError"));
    } finally {
      setPending(false);
    }
  }

  if (step === "password") {
    return (
      <form onSubmit={submitPassword} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t("passwordLabel")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-tap text-base"
          />
          <p className="text-muted-foreground text-xs">{t("passwordHint")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm">{t("confirmLabel")}</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="min-h-tap text-base"
          />
        </div>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={pending}
          className="min-h-tap w-full text-base font-semibold"
        >
          {pending ? t("saving") : t("next")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t("scanIntro")}</p>
        {enrolment ? (
          <div className="flex justify-center rounded-xl bg-white p-3">
            <QrCode value={enrolment.otpauthUri} label={t("qrLabel")} />
          </div>
        ) : null}
        <details className="text-muted-foreground text-xs">
          <summary className="min-h-tap flex cursor-pointer items-center">
            {t("cannotScan")}
          </summary>
          <p className="mt-2 break-all">
            {t("manualKey")} <code className="text-foreground font-mono">{enrolment?.secret}</code>
          </p>
        </details>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">{t("codeLabel")}</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="min-h-tap font-mono text-xl tracking-[0.3em]"
        />
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="min-h-tap w-full text-base font-semibold">
        {pending ? t("checking") : t("finish")}
      </Button>
      <p className="text-muted-foreground text-xs">{t("saveKeyWarning")}</p>
    </form>
  );
}
