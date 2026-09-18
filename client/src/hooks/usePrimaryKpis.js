import { primaryApi } from "../lib/primaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";
import { filtersToParam, pickPrimaryFilters } from "../lib/filtersToParam";

// KPI cards now apply the same global filters (Region/Category/Brand/
// Distributor, plus multi-select Year/Month) as every other Primary widget
// — see shared/primaryQueries.js's getPrimaryKpis for the DE-matching MTD/
// FYTD cross-filter logic this used to skip.
export function usePrimaryKpis(filters) {
  const { refreshKey } = useData();
  const param = filtersToParam(pickPrimaryFilters(filters));
  const key = `${JSON.stringify(param)}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(() => primaryApi.kpis(param), [key], null);
  return { kpis: data, loading, error };
}
