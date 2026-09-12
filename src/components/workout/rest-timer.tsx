"use client";

import { Minus, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useRestTimer } from "@/hooks/use-rest-timer";
import { HAPTIC_REST_DONE, vibrate } from "@/lib/haptics";
import { formatCountdown, REST_PRESETS_SEC } from "@/lib/rest-timer";
import { cn } from "@/lib/utils";

/**
 * The rest timer, front and centre in gym mode.
 *
 * Design constraints that drove this: it must be readable at arm's length on a bench, every
 * control must clear the 56px tap floor, and the numbers must not jitter as digits change —
 * hence tabular figures. The ring is an SVG stroke-dashoffset rather than an animated element
 * so it stays exact when the tab has been throttled.
 */

const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function RestTimerPanel({
  defaultRestSec,
  onDismiss,
}: {
  defaultRestSec: number;
  onDismiss?: () => void;
}) {
  const t = useTranslations("Rest");

  const handleElapsed = useCallback(() => {
    vibrate(HAPTIC_REST_DONE);
  }, []);

  const { timer, remainingMs, overrunMs, progress, isElapsed, start, adjust, stop } =
    useRestTimer(handleElapsed);

  if (!timer) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          {t("title")}
        </p>
        <div className="flex flex-wrap gap-2">
          {REST_PRESETS_SEC.map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => start(seconds)}
              className={cn(
                "min-h-tap bg-surface-2 hover:bg-surface-3 flex-1 rounded-xl px-4 font-mono",
                "text-base font-semibold tabular-nums transition-colors",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                seconds === defaultRestSec && "ring-primary/40 ring-2",
              )}
            >
              {formatCountdown(seconds * 1000)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label={t("title")}
      className="bg-card shadow-card rounded-card flex flex-col items-center gap-4 border p-5"
    >
      <div className="relative flex items-center justify-center">
        <svg viewBox="0 0 120 120" className="size-40 -rotate-90" aria-hidden>
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth="8"
          />
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke={isElapsed ? "var(--success)" : "var(--primary)"}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * progress}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          {/*
            aria-live="polite" with a coarse update: announcing every 200ms repaint would make a
            screen reader unusable, so only the elapsed transition is announced.
          */}
          <span className="readout tabular-nums" aria-hidden>
            {isElapsed ? `+${formatCountdown(overrunMs)}` : formatCountdown(remainingMs)}
          </span>
          <span className="sr-only" aria-live="polite">
            {isElapsed ? t("done") : t("remaining", { time: formatCountdown(remainingMs) })}
          </span>
        </div>
      </div>

      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => adjust(-15)}
          aria-label={t("minus15")}
          className="min-h-tap bg-surface-2 hover:bg-surface-3 focus-visible:ring-ring flex flex-1 items-center justify-center gap-1 rounded-xl font-mono text-sm font-semibold tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Minus className="size-4" aria-hidden />
          15
        </button>
        <button
          type="button"
          onClick={() => adjust(15)}
          aria-label={t("plus15")}
          className="min-h-tap bg-surface-2 hover:bg-surface-3 focus-visible:ring-ring flex flex-1 items-center justify-center gap-1 rounded-xl font-mono text-sm font-semibold tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Plus className="size-4" aria-hidden />
          15
        </button>
        <button
          type="button"
          onClick={() => {
            stop();
            onDismiss?.();
          }}
          aria-label={t("skip")}
          className="min-h-tap bg-surface-2 hover:bg-surface-3 focus-visible:ring-ring flex size-14 items-center justify-center rounded-xl transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </section>
  );
}
