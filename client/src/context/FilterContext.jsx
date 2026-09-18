import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { DIMS, emptyFilters, activeFilterCount } from "../lib/dims";
import { useData } from "./DataContext";

const FilterContext = createContext(null);

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The "SD" app-user tag: its secondary sales rows overstate real sales, so
// it's excluded by default. Per the DE's rule (confirmed 2026-09-18,
// matching the mandatory server-side STANDING_FILTER in
// shared/secondaryQueries.js) only the bare "SD" value is excluded — "SD -
// OB", "MDSD", and "OB" are all real tags that stay checked/included by
// default. Kept out of emptyFilters()'s blank slate — see resetAll.
const APP_USER_DEFAULT_EXCLUDE = new Set(["SD"]);

export function FilterProvider({ children }) {
  const { secondaryDims, secondaryMeta } = useData();
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

  // One-time defaults applied once secondary dims/meta are loaded: MTD view
  // starts on the previous month (M-1), and the SD app-user tag starts
  // excluded. Both Primary and Secondary are Snowflake-backed now (see
  // DataContext) — there's no raw row array to inspect any more, so "does
  // last month have data" is approximated from Secondary's known date range
  // instead of an exact per-(year,month) check.
  useEffect(() => {
    if (defaultsApplied.current || !secondaryDims || !secondaryMeta) return;
    defaultsApplied.current = true;

    const now = new Date();
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthIdx = prevMonthDate.getMonth();
    // The Year filter is a fiscal-year-END label now (Sep 2026 -> "2027"),
    // not the calendar year — see shared/secondaryQueries.js's
    // FISCAL_YEAR_EXPR. Jul-Dec rows belong to the fiscal year ending the
    // FOLLOWING calendar year; Jan-Jun rows belong to the one ending that
    // same calendar year.
    const prevYear = prevMonthIdx >= 6 ? prevMonthDate.getFullYear() + 1 : prevMonthDate.getFullYear();
    const prevMonthName = MONTH_SHORT[prevMonthIdx];
    const maxDate = secondaryMeta.dateRange?.max ? new Date(`${secondaryMeta.dateRange.max}T00:00:00`) : null;
    const minDate = secondaryMeta.dateRange?.min ? new Date(`${secondaryMeta.dateRange.min}T00:00:00`) : null;
    const hasData = !!maxDate && !!minDate && prevMonthDate >= minDate && prevMonthDate <= maxDate;

    const allAppUsers = new Set((secondaryDims.appUser || []).filter((v) => v != null && v !== ""));
    const appUserDefault = new Set([...allAppUsers].filter((v) => !APP_USER_DEFAULT_EXCLUDE.has(v)));
    defaultAppUsers.current = appUserDefault;

    setFilters((f) => ({
      ...f,
      ...(hasData ? { year: new Set([prevYear]), month: new Set([prevMonthName]) } : {}),
      ...(appUserDefault.size > 0 ? { appUser: appUserDefault } : {}),
    }));
  }, [secondaryDims, secondaryMeta]);

  const count = activeFilterCount(filters);

  const value = {
    dims: DIMS,
    filters,
    setFilter,
    resetAll,
    activeCount: count,
  };

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within a FilterProvider");
  return ctx;
}
