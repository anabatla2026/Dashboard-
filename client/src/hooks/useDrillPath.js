import { useCallback, useEffect, useMemo, useState } from "react";
import { useFilters } from "../context/FilterContext";
import { useData } from "../context/DataContext";
import { DRILLABLE } from "../lib/dims";
import { levelsFor } from "../lib/hierarchies";
import { makeDimResolver } from "../lib/filterValueResolver";

// Drives a chart's in-place hierarchy navigation (e.g. Category -> Brand ->
// SKU): clicking a mark advances the chart to the next level, scoped to
// that value, with a breadcrumb to go back. Where a level is also a global
// filter dimension, drilling into it cross-filters the rest of the
// dashboard too, and the two stay in sync in both directions.
//
// Each path step keeps both `value` (written to/compared against
// filters[dim]) and `label` (what the breadcrumb shows) — see
// lib/filterValueResolver.js.
export function useDrillPath(rootDim) {
  const { filters, setFilter } = useFilters();
  const { filterOptions } = useData();
  const levels = useMemo(() => levelsFor(rootDim), [rootDim]);
  const [path, setPath] = useState([]); // [{ dim, value, label }, ...]

  // Self-heal: if a global filter this path depends on was cleared or
  // changed elsewhere (dropdown, "Clear all"), collapse the local path to
  // match instead of showing a breadcrumb that no longer reflects reality.
  useEffect(() => {
    let validLen = path.length;
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      if (!DRILLABLE.has(step.dim)) continue;
      const gf = filters[step.dim];
      if (!gf || gf.size !== 1 || !gf.has(step.value)) {
        validLen = i;
        break;
      }
    }
    if (validLen < path.length) setPath((p) => p.slice(0, validLen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // If the chart's own root dim changes (shouldn't happen in practice —
  // defs are static — but keeps this safe), reset.
  useEffect(() => {
    setPath([]);
  }, [rootDim]);

  const depth = path.length;
  const atLeaf = depth >= levels.length - 1;
  const currentDim = levels[Math.min(depth, levels.length - 1)];
  const currentActiveSet = DRILLABLE.has(currentDim) ? filters[currentDim] : null;
  const { toValue } = makeDimResolver(filterOptions, currentDim);

  const onDrill = useCallback(
    (label) => {
      const value = toValue(label);
      // Re-clicking the sole active value at this level clears it (drill back out one step).
      if (currentActiveSet && currentActiveSet.size === 1 && currentActiveSet.has(value)) {
        if (DRILLABLE.has(currentDim)) setFilter(currentDim, new Set());
        return;
      }
      if (DRILLABLE.has(currentDim)) setFilter(currentDim, new Set([value]));
      if (!atLeaf) setPath((p) => [...p, { dim: currentDim, value, label }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentDim, currentActiveSet, atLeaf, setFilter, toValue],
  );

  const goTo = useCallback(
    (index) => {
      // index -1 = back to the root level entirely.
      const removed = path.slice(index + 1);
      removed.forEach((step) => {
        if (DRILLABLE.has(step.dim)) setFilter(step.dim, new Set());
      });
      setPath(path.slice(0, index + 1));
    },
    [path, setFilter],
  );

  function isActive(label) {
    return !!currentActiveSet && currentActiveSet.has(toValue(label));
  }

  return {
    levels,
    path,
    currentDim,
    hasHierarchy: levels.length > 1,
    onDrill: DRILLABLE.has(currentDim) || !atLeaf ? onDrill : null,
    isActive,
    hasActive: !!currentActiveSet && currentActiveSet.size > 0,
    goTo,
  };
}
