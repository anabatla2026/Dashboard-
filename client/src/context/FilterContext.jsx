import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DIMS, applyFilters, emptyFilters, activeFilterCount } from "../lib/dims";
import { useData } from "./DataContext";

const FilterContext = createContext(null);

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dimensions that exist in primary data — filters for other dims are skipped
// when filtering primary rows so they don't accidentally exclude everything.
const PRIMARY_DIMS = new Set(["year", "month", "cat", "town", "brand"]);

function applyPrimaryFilters(rows, filters) {
  const active = DIMS.filter(
    (d) => PRIMARY_DIMS.has(d.key) && filters[d.key] && filters[d.key].size > 0
  );
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every((d) => filters[d.key].has(r[d.key])));
}

export function FilterProvider({ children }) {
  const { rows, primaryRows } = useData();
  const [filters, setFilters] = useState(emptyFilters);
  const defaultsApplied = useRef(false);

  const setFilter = useCallback((key, set) => {
    setFilters((f) => ({ ...f, [key]: set }));
  }, []);

  const resetAll = useCallback(() => {
    setFilters(emptyFilters());
  }, []);

  // Default the MTD view to the previous month (M-1).  Applied once per session
  // using secondary rows (which are the denser dataset).  Primary rows follow
  // the same filter automatically since they share the same year/month keys.
  useEffect(() => {
    if (defaultsApplied.current || rows.length === 0) return;
    defaultsApplied.current = true;

    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYear = prevMonthDate.getFullYear();
    const prevMonthName = MONTH_SHORT[prevMonthDate.getMonth()];

    const hasData = rows.some((r) => r.year === prevYear && r.month === prevMonthName);
    if (hasData) {
      setFilters((f) => ({ ...f, year: new Set([prevYear]), month: new Set([prevMonthName]) }));
    }
  }, [rows]);

  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const filteredPrimaryRows = useMemo(
    () => applyPrimaryFilters(primaryRows, filters),
    [primaryRows, filters]
  );
  const count = activeFilterCount(filters);

  const value = {
    dims: DIMS,
    filters,
    setFilter,
    resetAll,
    filteredRows,
    filteredPrimaryRows,
    activeCount: count,
    totalRows: rows.length,
    totalPrimaryRows: primaryRows.length,
  };

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within a FilterProvider");
  return ctx;
}
