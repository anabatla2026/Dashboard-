import { filtersToParam } from "../lib/secondaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

// Backs every drillable, server-aggregated chart (channel type, category,
// brand, region, and Primary's category/brand). `fetchFn` is one of the
// secondaryApi/primaryApi group-by calls; `extra` carries level-specific
// params (e.g. channel-type's `channel` parent-value narrowing once drilled
// past chType — see shared/secondaryQueries.js's groupByOne for why only
// that one level needs it explicitly).
export function useServerAggregate(fetchFn, filters, level, extra = {}) {
  const { refreshKey } = useData();
  const filtersParam = filtersToParam(filters);
  const key = `${JSON.stringify(filtersParam)}|${level}|${JSON.stringify(extra)}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(
    () => fetchFn({ filters: filtersParam, level, ...extra }),
    [key],
    []
  );
  return { data: data || [], loading, error };
}
