import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { secondaryApi } from "../lib/secondaryApi";
import { primaryApi } from "../lib/primaryApi";

const DataContext = createContext(null);

// Both Primary (GOLD.ZFI_SCO_VW) and Secondary (GOLD.SALESFLO_DATADUMP_VW)
// now live in Snowflake — too large to ship as raw rows the way the
// original single-month Excel exports allowed. Every widget fetches its own
// pre-aggregated slice from /api/primary/* or /api/secondary/* instead (see
// hooks/useServerAggregate.js etc.); this context only carries the small
// dimension-option lists and summary totals for each, plus `refreshKey` —
// each widget's own fetch keys off it so the header's Refresh button still
// forces every chart to re-query instead of just refreshing this context's
// own dims/meta (Snowflake has no in-memory cache to invalidate the way the
// old Excel file-watcher did; a real re-query is the only way to "refresh").
export function DataProvider({ children }) {
  const [primaryMeta, setPrimaryMeta] = useState(null);
  const [primaryDims, setPrimaryDims] = useState(null);
  const [secondaryMeta, setSecondaryMeta] = useState(null);
  const [secondaryDims, setSecondaryDims] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error | refreshing
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? "refreshing" : "loading"));
    setError(null);
    try {
      const [priDims, priMeta, secDims, secMeta] = await Promise.all([
        primaryApi.dims(),
        primaryApi.meta(),
        secondaryApi.dims(),
        secondaryApi.meta(),
      ]);
      setPrimaryDims(priDims);
      setPrimaryMeta(priMeta);
      setSecondaryDims(secDims);
      setSecondaryMeta(secMeta);
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
      value={{ primaryMeta, primaryDims, secondaryMeta, secondaryDims, status, error, refresh, refreshKey }}
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
