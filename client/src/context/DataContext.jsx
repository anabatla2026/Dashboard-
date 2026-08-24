import { createContext, useCallback, useContext, useEffect, useState } from "react";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setStatus((s) => (s === "ready" ? "refreshing" : "loading"));
    setError(null);
    try {
      const [metaRes, recordsRes] = await Promise.all([fetch("/api/meta"), fetch("/api/records")]);
      if (!metaRes.ok) throw new Error((await metaRes.json()).error || "Failed to load metadata");
      if (!recordsRes.ok) throw new Error((await recordsRes.json()).error || "Failed to load records");
      const [metaJson, recordsJson] = await Promise.all([metaRes.json(), recordsRes.json()]);
      setMeta(metaJson);
      setRows(recordsJson);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await fetch("/api/refresh", { method: "POST" });
    } catch {
      // ignore — the GET calls below will surface any real problem
    }
    await load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DataContext.Provider value={{ rows, meta, status, error, refresh }}>{children}</DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
