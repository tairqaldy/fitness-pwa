"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Login: password + 6-digit TOTP.
 *
 * Deliberately boring. This screen is seen once per year (the session cookie lasts that long),
 * so it optimises for "works on the first try on a phone" over polish: real labels, an
 * autocomplete contract password managers understand, and a numeric keypad for the code.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, code }),
      });
      if (response.ok) {
        router.replace(next);
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === "setup_required"
          ? "Приложение ещё не настроено. Откройте /setup."
          : "Неверный пароль или код. Попробуйте ещё раз.",
      );
    } catch {
      // The login screen is reachable offline (it is precached), but logging in is not.
      setError("Нет связи с сервером. Для входа нужен интернет.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Пароль</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-tap text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Код из приложения</Label>
        <Input
          id="code"
          name="code"
          // `inputMode` gives a phone the numeric keypad; `one-time-code` lets iOS and
          // Android offer the code from the authenticator directly.
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
        // role=alert so a screen reader announces the failure without moving focus.
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="min-h-tap w-full text-base font-semibold">
        {pending ? "Проверяем…" : "Войти"}
      </Button>
    </form>
  );
}
