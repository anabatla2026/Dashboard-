import { secondaryApi } from "../lib/secondaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";
import { filtersToParam } from "../lib/filtersToParam";

// KPI cards now apply the full global filter set (Region/Category/Brand/
// Channel Type/Town/Distributor/App User Tag, plus multi-select Year/Month)
// — see shared/secondaryQueries.js's getSecondaryKpis for the DE-matching
// MTD/FYTD cross-filter logic this used to skip.
export function useSecondaryKpis(filters) {
  const { refreshKey } = useData();
  const param = filtersToParam(filters);
  const key = `${JSON.stringify(param)}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(() => secondaryApi.kpis(param), [key], null);
  return { kpis: data, loading, error };
}
