import { getTranslations } from "next-intl/server";

/**
 * Honest placeholder for a screen whose phase has not shipped yet.
 *
 * Deliberately says which phase owns it rather than showing a fake empty state: a convincing
 * but non-functional screen is worse than an obviously unfinished one, because it hides
 * progress and invites bug reports for features that were never built.
 */
export async function PhasePlaceholder({ title, phase }: { title: string; phase: number }) {
  const t = await getTranslations("Placeholder");
  return (
    <main className="flex flex-1 flex-col justify-center gap-3 text-center">
      <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
        {t("phase", { phase })}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm text-balance">{t("body")}</p>
    </main>
  );
}
