"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  adjustRestTimer,
  isElapsed,
  overrunMs,
  progress,
  remainingMs,
  startRestTimer,
  type RestTimer,
} from "@/lib/rest-timer";

/**
 * Drives a rest timer in the UI.
 *
 * The interval here exists ONLY to repaint. Every displayed value is recomputed from
 * `Date.now()` against the stored deadline, so a throttled or frozen interval — which is what
 * happens the moment the phone locks — cannot make the timer drift. On `visibilitychange` the
 * clock is re-read immediately so returning to the app shows the truth in the same frame
 * rather than after the next tick.
 */

const REPAINT_MS = 200;

export type UseRestTimer = {
  timer: RestTimer | null;
  remainingMs: number;
  overrunMs: number;
  progress: number;
  isElapsed: boolean;
  start: (durationSec: number) => void;
  adjust: (deltaSec: number) => void;
  stop: () => void;
};

export function useRestTimer(onElapsed?: () => void): UseRestTimer {
  const [timer, setTimer] = useState<RestTimer | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Ref rather than state: firing the completion effect must not depend on render order, and
  // it must fire exactly once per timer.
  const firedRef = useRef(false);
  // The "latest callback" ref must be updated in an effect, never during render: writing to a
  // ref while rendering is unsafe under concurrent rendering, where a render can be discarded
  // or replayed.
  const onElapsedRef = useRef(onElapsed);
  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);

  const start = useCallback((durationSec: number) => {
    firedRef.current = false;
    setTimer(startRestTimer(Date.now(), durationSec));
    setNowMs(Date.now());
  }, []);

  const adjust = useCallback((deltaSec: number) => {
    setTimer((current) => {
      if (!current) return current;
      const next = adjustRestTimer(current, deltaSec);
      // Extending a finished timer re-arms the completion signal.
      if (deltaSec > 0 && Date.now() < next.deadlineAtMs) firedRef.current = false;
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    firedRef.current = true;
    setTimer(null);
  }, []);

  useEffect(() => {
    if (!timer) return;

    const tick = () => setNowMs(Date.now());
    const id = window.setInterval(tick, REPAINT_MS);

    // Coming back from a locked screen: read the clock now, not on the next tick.
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tick);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tick);
    };
  }, [timer]);

  const elapsed = timer ? isElapsed(timer, nowMs) : false;

  useEffect(() => {
    if (!timer || !elapsed || firedRef.current) return;
    firedRef.current = true;
    onElapsedRef.current?.();
  }, [timer, elapsed]);

  return {
    timer,
    remainingMs: timer ? remainingMs(timer, nowMs) : 0,
    overrunMs: timer ? overrunMs(timer, nowMs) : 0,
    progress: timer ? progress(timer, nowMs) : 0,
    isElapsed: elapsed,
    start,
    adjust,
    stop,
  };
}

/**
 * Keeps the screen awake while a workout is in progress.
 *
 * Screen Wake Lock is unsupported in some browsers (notably older iOS Safari), so every call is
 * guarded and failure is silent — a phone that dims mid-set is a papercut, not a reason to show
 * an error. The lock is re-acquired on `visibilitychange` because the browser releases it
 * automatically whenever the page is hidden.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Denied, or the tab is not visible. Not worth surfacing.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}
