import { getTranslations } from "next-intl/server";

import { PhasePlaceholder } from "@/components/phase-placeholder";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const t = await getTranslations("Nav");
  return <PhasePlaceholder title={t("stats")} phase={6} />;
}
