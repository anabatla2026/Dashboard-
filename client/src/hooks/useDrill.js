import { useFilters } from "../context/FilterContext";
import { DRILLABLE } from "../lib/dims";

// Lets a chart's marks act as click-to-filter drill targets: clicking a bar
// or slice scopes the whole dashboard to exactly that value (same
// FilterContext the global filter bar writes to); clicking the same,
// already-sole-selected value again clears it — drilling back out.
export function useDrill(dim) {
  const { filters, setFilter } = useFilters();
  const drillable = DRILLABLE.has(dim);
  const activeSet = drillable ? filters[dim] : null;
  const hasActive = !!activeSet && activeSet.size > 0;
  const activeValue = hasActive && activeSet.size === 1 ? [...activeSet][0] : null;

  function onDrill(label) {
    if (!drillable) return;
    const current = filters[dim];
    if (current.size === 1 && current.has(label)) {
      setFilter(dim, new Set());
    } else {
      setFilter(dim, new Set([label]));
    }
  }

  function isActive(label) {
    return !!activeSet && activeSet.has(label);
  }

  function clear() {
    if (drillable) setFilter(dim, new Set());
  }

  return {
    drillable,
    onDrill: drillable ? onDrill : null,
    isActive,
    hasActive,
    activeValue,
    clear,
  };
}
