import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiUrl } from "../lib/api";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [primaryRows, setPrimaryRows] = useState([]);
  const [secondaryRows, setSecondaryRows] = useState([]);
  const [primaryMeta, setPrimaryMeta] = useState(null);
  const [secondaryMeta, setSecondaryMeta] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error | refreshing
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? "refreshing" : "loading"));
    setError(null);
    try {
      const [metaRes, recordsRes] = await Promise.all([
        fetch(apiUrl("/api/meta")),
        fetch(apiUrl("/api/records")),
      ]);
      if (!metaRes.ok) throw new Error((await metaRes.json()).error || "Failed to load metadata");
      if (!recordsRes.ok) throw new Error((await recordsRes.json()).error || "Failed to load records");
      const [metaJson, recordsJson] = await Promise.all([metaRes.json(), recordsRes.json()]);

      setPrimaryMeta(metaJson.primary || null);
      setSecondaryMeta(metaJson.secondary || null);
      setPrimaryRows(recordsJson.primary || []);
      setSecondaryRows(recordsJson.secondary || []);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await fetch(apiUrl("/api/refresh"), { method: "POST" });
    } catch {
      // ignore — the GET calls below will surface any real problem
    }
    await load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  // rows / meta kept as aliases for the secondary source for backward compat
  // with components that haven't been updated yet.
  const rows = secondaryRows;
  const meta = secondaryMeta;

  return (
    <DataContext.Provider
      value={{ rows, meta, primaryRows, secondaryRows, primaryMeta, secondaryMeta, status, error, refresh }}
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
