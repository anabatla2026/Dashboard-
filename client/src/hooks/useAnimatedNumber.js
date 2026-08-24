import { useEffect, useRef, useState } from "react";

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function useAnimatedNumber(target, duration = 650) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = typeof target === "number" && !Number.isNaN(target) ? target : 0;

    if (prefersReducedMotion || from === to) {
      fromRef.current = to;
      setValue(to);
      return;
    }

    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      setValue(from + (to - from) * easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}
