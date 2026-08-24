import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DIMS, applyFilters, emptyFilters, activeFilterCount } from "../lib/dims";
import { useData } from "./DataContext";

const FilterContext = createContext(null);

export function FilterProvider({ children }) {
  const { rows } = useData();
  const [filters, setFilters] = useState(emptyFilters);

  const setFilter = useCallback((key, set) => {
    setFilters((f) => ({ ...f, [key]: set }));
  }, []);

  const resetAll = useCallback(() => {
    setFilters(emptyFilters());
  }, []);

  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const count = activeFilterCount(filters);

  const value = { dims: DIMS, filters, setFilter, resetAll, filteredRows, activeCount: count, totalRows: rows.length };

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within a FilterProvider");
  return ctx;
}
