import { getTranslations } from "next-intl/server";

import { PhasePlaceholder } from "@/components/phase-placeholder";

export const dynamic = "force-dynamic";

export default async function BodyPage() {
  const t = await getTranslations("Nav");
  return <PhasePlaceholder title={t("body")} phase={4} />;
}
