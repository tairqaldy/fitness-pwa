import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { credentials } from "@/db/schema";
import { getOptionalSession } from "@/lib/auth/require-session";
import { getDb } from "@/server/db";

import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Login");
  return { title: t("submit") };
}

/** Reads D1 to decide between login and first-run setup, so it must not be prerendered. */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const db = getDb();
  const credential = await db
    .select({ confirmedAt: credentials.totpConfirmedAt })
    .from(credentials)
    .limit(1)
    .get();

  // Nothing configured yet: send the owner to setup instead of showing a login form no
  // password can satisfy.
  if (!credential?.confirmedAt) redirect("/setup");

  if (await getOptionalSession()) redirect("/");

  const t = await getTranslations("Login");
  const { next } = await searchParams;
  // Only ever redirect to a same-origin path — never echo an attacker-supplied absolute URL.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("intro")}</p>
      </header>
      <LoginForm next={target} />
    </main>
  );
}
