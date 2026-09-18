import { secondaryApi, filtersToParam } from "../lib/secondaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

// `enabled` lets a caller that only sometimes needs this data (e.g.
// ChartCard, shared across many chart types but only one of them is the
// dual-trend chart) skip the network call entirely rather than fetching and
// discarding it — the hook itself must still always run (rules of hooks).
// `granularity` ("day" | "week" | "month") buckets the trend query — see
// usePrimaryTrend for why.
export function useSecondaryTrend(filters, enabled = true, granularity = "day") {
  const { refreshKey } = useData();
  const filtersParam = filtersToParam(filters);
  const key = enabled ? `${JSON.stringify(filtersParam)}|${granularity}|${refreshKey}` : "disabled";
  const { data, loading, error } = useServerQuery(
    () => (enabled ? secondaryApi.trend(filtersParam, granularity) : Promise.resolve([])),
    [key],
    []
  );
  return { trend: data || [], loading, error };
}
