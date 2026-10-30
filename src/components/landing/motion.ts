import { useEffect, useRef, useState, type RefObject } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True while the element is at least partly on screen and the tab is visible. */
export function useOnScreen<T extends Element>(ref: RefObject<T | null>, threshold = 0.25): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onChange = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return onScreen && tabVisible;
}

/**
 * Steps through `durations` (ms per step) in a loop while `playing`, and
 * returns the current step. With reduced motion it stays on `stillStep`.
 */
export function useLoop(durations: number[], playing: boolean, stillStep = durations.length - 1): number {
  const reduced = useRef(prefersReducedMotion());
  const [step, setStep] = useState(reduced.current ? stillStep : 0);
  useEffect(() => {
    if (reduced.current || !playing) return;
    const timer = window.setTimeout(() => setStep((s) => (s + 1) % durations.length), durations[step]);
    return () => window.clearTimeout(timer);
  }, [step, playing, durations]);
  return step;
}

/**
 * Marks each `[data-reveal]` element inside `root` with `data-revealed` the
 * first time it scrolls into view; the CSS fades it in. Reduced motion skips
 * the wait and reveals everything at once.
 */
export function useReveal<T extends Element>(root: RefObject<T | null>): void {
  useEffect(() => {
    const targets = Array.from(root.current?.querySelectorAll("[data-reveal]") ?? []);
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => el.setAttribute("data-revealed", ""));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [root]);
}
