import { useCallback, useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Animated number for KPI cards; respects reduced-motion preferences. */
export function useCountUp(target, duration = 850) {
  const [display, setDisplay] = useState(0);
  const previous = useRef(0);
  const numeric = Number(target);

  useEffect(() => {
    if (!Number.isFinite(numeric)) {
      setDisplay(numeric);
      return undefined;
    }
    if (prefersReducedMotion()) {
      previous.current = numeric;
      setDisplay(numeric);
      return undefined;
    }

    const from = previous.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (numeric - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previous.current = numeric;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [numeric, duration]);

  return display;
}

/** Reveal elements with `data-reveal` when they scroll into view. */
export function useReveal(key) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll("[data-reveal]"));
    if (!nodes.length) return undefined;

    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -30px 0px" },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [key]);
}

/** Poll a loader while the tab is visible. */
export function usePolling(load, intervalMs) {
  const saved = useRef(load);
  useEffect(() => {
    saved.current = load;
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") saved.current?.();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
}

/** Re-render periodically so "2 min ago" labels stay honest. */
export function useTicker(intervalMs = 60000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
}

/** Tiny toast helper. */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(0);

  const notify = useCallback((message, tone = "success") => {
    window.clearTimeout(timer.current);
    setToast({ message, tone, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, notify };
}

/** Countdown to the next scheduled cycle, refreshed every second. */
export function useCountdown(nextRun) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!nextRun) return null;
  const target = new Date(nextRun).getTime();
  if (Number.isNaN(target)) return null;
  const remainingMs = Math.max(0, target - now);
  const minutes = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");
  return { remainingMs, label: `${minutes}:${seconds}` };
}

/** Highlight the nav link for the section currently in view. */
export function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  const key = ids.join("|");

  useEffect(() => {
    const sections = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (!sections.length || !("IntersectionObserver" in window)) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.2, 0.5, 1] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [key]);

  return active;
}
