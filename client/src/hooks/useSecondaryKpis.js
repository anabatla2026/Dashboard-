import { secondaryApi } from "../lib/secondaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";
import { filtersToParam } from "../lib/filtersToParam";

// KPI cards apply the full global filter set (Region/Category/Brand/
// Channel Type/Town/Distributor/App User Tag, plus multi-select Year/Month).
export function useSecondaryKpis(filters) {
  const { refreshKey } = useData();
  const param = filtersToParam(filters);
  const key = `${JSON.stringify(param)}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(() => secondaryApi.kpis(param), [key], null);
  return { kpis: data, loading, error };
}
