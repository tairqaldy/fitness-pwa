"use client";

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
      setError("Пароли не совпадают.");
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
        setError(data.reason ?? "Не удалось сохранить пароль.");
        return;
      }
      setEnrolment({ ok: true, otpauthUri: data.otpauthUri, secret: data.secret });
      setStep("totp");
      // The password is no longer needed in memory once it has been accepted.
      setPassword("");
      setConfirm("");
    } catch {
      setError("Нет связи с сервером.");
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
      setError("Код не подошёл. Проверьте время на телефоне и попробуйте снова.");
    } catch {
      setError("Нет связи с сервером.");
    } finally {
      setPending(false);
    }
  }

  if (step === "password") {
    return (
      <form onSubmit={submitPassword} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Придумайте пароль</Label>
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
          <p className="text-muted-foreground text-xs">
            Не короче 12 символов. Лучше длинная фраза, чем короткий набор символов.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm">Повторите пароль</Label>
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
          {pending ? "Сохраняем…" : "Далее"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Отсканируйте код в приложении-аутентификаторе (Google Authenticator, Aegis, 1Password),
          затем введите шестизначный код.
        </p>
        {enrolment ? (
          <div className="flex justify-center rounded-xl bg-white p-3">
            <QrCode value={enrolment.otpauthUri} label="QR-код для приложения-аутентификатора" />
          </div>
        ) : null}
        <details className="text-muted-foreground text-xs">
          <summary className="min-h-tap flex cursor-pointer items-center">
            Не получается отсканировать?
          </summary>
          <p className="mt-2 break-all">
            Введите этот ключ вручную:{" "}
            <code className="text-foreground font-mono">{enrolment?.secret}</code>
          </p>
        </details>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Код из приложения</Label>
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
        {pending ? "Проверяем…" : "Завершить настройку"}
      </Button>
      <p className="text-muted-foreground text-xs">
        Сохраните ключ в менеджере паролей. Без него и без пароля восстановить доступ можно только
        через консоль базы данных.
      </p>
    </form>
  );
}
