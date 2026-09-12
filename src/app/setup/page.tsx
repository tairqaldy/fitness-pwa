import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { credentials } from "@/db/schema";
import { getDb } from "@/server/db";

import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Настройка" };

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const db = getDb();
  const credential = await db
    .select({ confirmedAt: credentials.totpConfirmedAt })
    .from(credentials)
    .limit(1)
    .get();

  // Setup is a one-time door. Once it is done it stays shut, so that reaching this URL can
  // never reset the owner's password.
  if (credential?.confirmedAt) redirect("/login");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium tracking-widest uppercase">
          Первый запуск
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Настройка входа</h1>
        <p className="text-muted-foreground text-sm">
          Пароль и код из приложения. Дальше приложение не будет спрашивать вход целый год — чтобы в
          зале открывалось мгновенно и работало без интернета.
        </p>
      </header>
      <SetupForm />
    </main>
  );
}
