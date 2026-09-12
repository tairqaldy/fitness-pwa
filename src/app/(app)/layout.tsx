import { redirect } from "next/navigation";

import { TabBar } from "@/components/nav/tab-bar";
import { getOptionalSession } from "@/lib/auth/require-session";

/**
 * Shell for every authenticated screen.
 *
 * The session check here is the real boundary for these pages — `src/proxy.ts` only improves
 * the redirect UX and is explicitly not trusted (its OpenNext support is experimental, and a
 * matcher typo would silently expose a route).
 *
 * `pb-24` reserves room for the fixed tab bar so the last item in any scrolling list stays
 * reachable rather than sitting permanently under the nav.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  if (!(await getOptionalSession())) redirect("/login");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pt-8 pb-24">{children}</div>
      <TabBar />
    </div>
  );
}
