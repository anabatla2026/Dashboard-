import { useLayoutEffect, useRef, useState } from "react";

// Tracks an element's actual content-box width so a chart's SVG viewBox can
// match its real rendered size instead of guessing a fixed default — with
// preserveAspectRatio="none", a mismatched guess doesn't just distort the
// chart, it makes the whole card balloon (CSS falls back to the viewBox's
// intrinsic aspect ratio when it can't resolve a percentage height).
export function useElementWidth(defaultWidth) {
  const ref = useRef(null);
  const [width, setWidth] = useState(defaultWidth);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure synchronously before paint so the first frame is already
    // correctly sized instead of flashing the default width.
    if (el.clientWidth) setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
