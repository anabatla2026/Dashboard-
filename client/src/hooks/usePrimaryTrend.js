import { primaryApi } from "../lib/primaryApi";
import { filtersToParam, pickPrimaryFilters } from "../lib/filtersToParam";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

// Same `enabled` pattern as useSecondaryTrend — ChartCard is generic across
// many chart types and only the dual-trend chart needs this fetched.
export function usePrimaryTrend(filters, enabled = true) {
  const { refreshKey } = useData();
  const filtersParam = filtersToParam(pickPrimaryFilters(filters));
  const key = enabled ? `${JSON.stringify(filtersParam)}|${refreshKey}` : "disabled";
  const { data, loading, error } = useServerQuery(
    () => (enabled ? primaryApi.trend(filtersParam) : Promise.resolve([])),
    [key],
    []
  );
  return { trend: data || [], loading, error };
}
