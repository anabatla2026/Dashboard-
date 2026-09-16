import { secondaryApi, filtersToParam } from "../lib/secondaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

// `enabled` lets a caller that only sometimes needs this data (e.g.
// ChartCard, shared across many chart types but only one of them is the
// dual-trend chart) skip the network call entirely rather than fetching and
// discarding it — the hook itself must still always run (rules of hooks).
export function useSecondaryTrend(filters, enabled = true) {
  const { refreshKey } = useData();
  const filtersParam = filtersToParam(filters);
  const key = enabled ? `${JSON.stringify(filtersParam)}|${refreshKey}` : "disabled";
  const { data, loading, error } = useServerQuery(
    () => (enabled ? secondaryApi.trend(filtersParam) : Promise.resolve([])),
    [key],
    []
  );
  return { trend: data || [], loading, error };
}
