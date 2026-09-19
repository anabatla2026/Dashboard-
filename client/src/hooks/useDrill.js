import { useFilters } from "../context/FilterContext";
import { useData } from "../context/DataContext";
import { DRILLABLE } from "../lib/dims";
import { makeDimResolver } from "../lib/filterValueResolver";

// Lets a chart's marks act as click-to-filter drill targets: clicking a bar
// or slice scopes the whole dashboard to that value; clicking the same,
// already-sole-selected value again clears it.
//
// Charts display a friendly NAME (e.g. "Baby Diapers") for cat/dist, but
// the global filter tracks the mapping table's CODE — a mark's clicked
// label is resolved to that code before it's compared/written; only the
// drill-chip's displayed text is resolved back to the friendly name.
export function useDrill(dim) {
  const { filters, setFilter } = useFilters();
  const { filterOptions } = useData();
  const { toValue, toLabel } = makeDimResolver(filterOptions, dim);
  const drillable = DRILLABLE.has(dim);
  const activeSet = drillable ? filters[dim] : null;
  const hasActive = !!activeSet && activeSet.size > 0;
  const activeValue = hasActive && activeSet.size === 1 ? toLabel([...activeSet][0]) : null;

  function onDrill(label) {
    if (!drillable) return;
    const value = toValue(label);
    const current = filters[dim];
    if (current.size === 1 && current.has(value)) {
      setFilter(dim, new Set());
    } else {
      setFilter(dim, new Set([value]));
    }
  }

  function isActive(label) {
    return !!activeSet && activeSet.has(toValue(label));
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
