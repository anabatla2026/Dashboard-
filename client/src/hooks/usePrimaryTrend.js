import { primaryApi } from "../lib/primaryApi";
import { filtersToParam, pickPrimaryFilters } from "../lib/filtersToParam";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

// Same `enabled` pattern as useSecondaryTrend — ChartCard is generic across
// many chart types and only the dual-trend chart needs this fetched.
// `granularity` ("day" | "week" | "month") buckets the trend query —
// ChartCard offers week/month once multiple months are selected, since a
// daily series across several months is a lot of points.
export function usePrimaryTrend(filters, enabled = true, granularity = "day") {
  const { refreshKey } = useData();
  const filtersParam = filtersToParam(pickPrimaryFilters(filters));
  const key = enabled ? `${JSON.stringify(filtersParam)}|${granularity}|${refreshKey}` : "disabled";
  const { data, loading, error } = useServerQuery(
    () => (enabled ? primaryApi.trend(filtersParam, granularity) : Promise.resolve([])),
    [key],
    []
  );
  return { trend: data || [], loading, error };
}
