"use client";

import { Apple, BarChart3, Dumbbell, House, Plus, Ruler } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Bottom tab navigation with a central quick-add action.
 *
 * Bottom rather than top because the app is used one-handed mid-set: the top of a modern phone
 * is unreachable with a thumb, and the user is often holding a bar or a bottle with the other
 * hand. The central action is the largest target because starting a workout is the single most
 * common thing the app is opened for.
 *
 * `env(safe-area-inset-bottom)` keeps the row clear of the home indicator when installed as a
 * PWA — without it the last few pixels of every tab are unclickable on an iPhone.
 */
const TABS = [
  { href: "/", key: "home", Icon: House },
  { href: "/workout", key: "workout", Icon: Dumbbell },
  { href: "/food", key: "food", Icon: Apple },
  { href: "/body", key: "body", Icon: Ruler },
  { href: "/stats", key: "stats", Icon: BarChart3 },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function TabBar() {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("home")}
      className="bg-background/85 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch justify-around px-2">
        {TABS.map(({ href, key, Icon }, index) => {
          const active = isActive(pathname, href);
          // The quick-add button sits in the middle of the row rather than at the end, so it
          // falls under the thumb's natural arc.
          const showFab = index === 2;
          return (
            <Fragment key={href}>
              {showFab ? (
                <li className="flex items-center px-1">
                  <Link
                    href="/workout/new"
                    aria-label={t("quickAdd")}
                    className={cn(
                      "bg-primary text-primary-foreground shadow-glow flex size-14 items-center",
                      "justify-center rounded-2xl transition-transform active:scale-95",
                      "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
                      "focus-visible:ring-offset-background focus-visible:outline-none",
                    )}
                  >
                    <Plus className="size-7" strokeWidth={2.5} aria-hidden />
                  </Link>
                </li>
              ) : null}
              <li className="flex flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // min-h-tap is the 56px floor the brief requires for gym use.
                    "min-h-tap flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2",
                    "focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  <span className="text-[0.6875rem] leading-none font-medium">{t(key)}</span>
                </Link>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
