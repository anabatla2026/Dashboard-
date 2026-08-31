import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DIMS, applyFilters, emptyFilters, activeFilterCount } from "../lib/dims";
import { useData } from "./DataContext";

const FilterContext = createContext(null);

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Dimensions that exist in primary data — filters for other dims are skipped
// when filtering primary rows so they don't accidentally exclude everything.
const PRIMARY_DIMS = new Set(["year", "month", "cat", "town"]);

// The "SD" app-user tag (2026-08-31 requirement): its secondary sales rows
// overstate real sales, so it's excluded by default everywhere. The raw
// data's actual value is "SD - OB" — there's no bare "SD" value in the
// export, so this is the closest match; flagged to the client for
// confirmation. Kept out of emptyFilters()'s blank slate — see resetAll.
const APP_USER_DEFAULT_EXCLUDE = new Set(["SD - OB"]);

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
  const defaultAppUsers = useRef(null); // every appUser value except the SD tag, computed once

  const setFilter = useCallback((key, set) => {
    setFilters((f) => ({ ...f, [key]: set }));
  }, []);

  // "Clear all" resets every filter the user could have touched, but the SD
  // exclusion is a data-correctness rule, not a convenience default — losing
  // it on reset would silently let SD's inflated rows back into the totals.
  const resetAll = useCallback(() => {
    const next = emptyFilters();
    if (defaultAppUsers.current) next.appUser = new Set(defaultAppUsers.current);
    setFilters(next);
  }, []);

  // One-time defaults applied once secondary data is loaded: MTD view starts
  // on the previous month (M-1), and the SD app-user tag starts excluded.
  useEffect(() => {
    if (defaultsApplied.current || rows.length === 0) return;
    defaultsApplied.current = true;

    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYear = prevMonthDate.getFullYear();
    const prevMonthName = MONTH_SHORT[prevMonthDate.getMonth()];
    const hasData = rows.some((r) => r.year === prevYear && r.month === prevMonthName);

    const allAppUsers = new Set(rows.map((r) => r.appUser).filter((v) => v != null && v !== ""));
    const appUserDefault = new Set([...allAppUsers].filter((v) => !APP_USER_DEFAULT_EXCLUDE.has(v)));
    defaultAppUsers.current = appUserDefault;

    setFilters((f) => ({
      ...f,
      ...(hasData ? { year: new Set([prevYear]), month: new Set([prevMonthName]) } : {}),
      ...(appUserDefault.size > 0 ? { appUser: appUserDefault } : {}),
    }));
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
