import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { secondaryApi } from "../lib/secondaryApi";
import { primaryApi } from "../lib/primaryApi";
import { fetchFilterOptions } from "../lib/filterOptionsApi";

const DataContext = createContext(null);

// Every widget fetches its own pre-aggregated slice from /api/primary/* or
// /api/secondary/* (see hooks/useServerAggregate.js etc.); this context only
// carries the small dimension-option lists and summary totals, plus
// `refreshKey` — each widget's own fetch keys off it so the header's
// Refresh button forces every chart to re-query.
export function DataProvider({ children }) {
  const [primaryMeta, setPrimaryMeta] = useState(null);
  const [primaryDims, setPrimaryDims] = useState(null);
  const [secondaryMeta, setSecondaryMeta] = useState(null);
  const [secondaryDims, setSecondaryDims] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error | refreshing
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? "refreshing" : "loading"));
    setError(null);
    try {
      const [priDims, priMeta, secDims, secMeta, options] = await Promise.all([
        primaryApi.dims(),
        primaryApi.meta(),
        secondaryApi.dims(),
        secondaryApi.meta(),
        fetchFilterOptions(),
      ]);
      setPrimaryDims(priDims);
      setPrimaryMeta(priMeta);
      setSecondaryDims(secDims);
      setSecondaryMeta(secMeta);
      setFilterOptions(options);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshKey((k) => k + 1);
    await load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DataContext.Provider
      value={{ primaryMeta, primaryDims, secondaryMeta, secondaryDims, filterOptions, status, error, refresh, refreshKey }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
