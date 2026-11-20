"use client";

import { useEffect, useRef, useState } from "react";

/** User-input events that reset the idle timer. */
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

export type IdleState = "active" | "warning" | "idle";

export interface IdleTimerResult {
  /** Current idle state. */
  state: IdleState;
  /** Milliseconds remaining until the idle callback fires. */
  remainingMs: number;
  /** Restart the warn/idle timers and return to the "active" state. */
  reset: () => void;
}

/**
 * Tracks user inactivity and calls onIdle after `timeoutMs`.
 * Fires onWarn `warnBeforeMs` before the timeout so a warning banner can be shown.
 * Returns the current idle state, the remaining time, and a `reset` function so
 * callers can render a live countdown and let the user extend the session.
 */
export function useIdleTimer({
  timeoutMs,
  warnBeforeMs,
  onWarn,
  onIdle,
  enabled = true,
}: {
  timeoutMs: number;
  warnBeforeMs: number;
  onWarn: () => void;
  onIdle: () => void;
  enabled?: boolean;
}): IdleTimerResult {
  const [state, setState] = useState<IdleState>("active");
  const [remainingMs, setRemainingMs] = useState(timeoutMs);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number>(0);
  const lastActivityAtRef = useRef<number>(Date.now());
  // Keep latest callbacks in refs — updated inside effects to avoid stale closures in timers.
  const onWarnRef = useRef(onWarn);
  const onIdleRef = useRef(onIdle);
  // Exposed reset function, kept in a ref so the effect can install it.
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    onWarnRef.current = onWarn;
  }, [onWarn]);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;

    function clearTimers() {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (warnTimer.current) clearTimeout(warnTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      idleTimer.current = null;
      warnTimer.current = null;
      countdownTimer.current = null;
    }

    function resetTimers() {
      clearTimers();
      setState("active");
      lastActivityAtRef.current = Date.now();
      deadlineRef.current = Date.now() + timeoutMs;
      setRemainingMs(timeoutMs);
      warnTimer.current = setTimeout(() => {
        setState("warning");
        onWarnRef.current();
        // Tick roughly once per second while warning is visible.
        countdownTimer.current = setInterval(() => {
          setRemainingMs(Math.max(0, deadlineRef.current - Date.now()));
        }, 1000);
      }, timeoutMs - warnBeforeMs);
      idleTimer.current = setTimeout(() => {
        clearTimers();
        setState("idle");
        setRemainingMs(0);
        onIdleRef.current();
      }, timeoutMs);
    }

    // Timers are throttled/suspended in background tabs and while the machine
    // sleeps, so on resume we reconcile against wall-clock time.
    function checkElapsed() {
      const elapsed = Date.now() - lastActivityAtRef.current;
      if (elapsed >= timeoutMs) {
        clearTimers();
        setState("idle");
        setRemainingMs(0);
        onIdleRef.current();
      } else if (elapsed >= timeoutMs - warnBeforeMs) {
        clearTimers();
        setState("warning");
        onWarnRef.current();
        countdownTimer.current = setInterval(() => {
          setRemainingMs(Math.max(0, deadlineRef.current - Date.now()));
        }, 1000);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") checkElapsed();
    }

    resetRef.current = resetTimers;
    resetTimers();
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, resetTimers, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", checkElapsed);
    window.addEventListener("pageshow", checkElapsed);

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, resetTimers));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", checkElapsed);
      window.removeEventListener("pageshow", checkElapsed);
    };
  }, [enabled, timeoutMs, warnBeforeMs]);

  return {
    state,
    remainingMs,
    reset: () => resetRef.current(),
  };
}
