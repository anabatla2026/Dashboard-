import { primaryApi } from "../lib/primaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

export function usePrimaryKpis({ year, month }) {
  const { refreshKey } = useData();
  const key = `${year}|${month}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(() => primaryApi.kpis({ year, month }), [key], null);
  return { kpis: data, loading, error };
}
