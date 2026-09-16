import { secondaryApi } from "../lib/secondaryApi";
import { primaryApi } from "../lib/primaryApi";
import { filtersToParam } from "../lib/filtersToParam";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

// Region is intentionally not passed to either source — disabled on both
// Primary and Secondary's MoM per the DE (2026-09-16): region data has
// issues pending a proper mapping.
export function useSecondaryMonthOverMonth({ fiscalYearStart, filters }) {
  const { refreshKey } = useData();
  const filtersParam = filtersToParam(filters);
  const key = `${fiscalYearStart}|${JSON.stringify(filtersParam)}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(
    () => (fiscalYearStart ? secondaryApi.mom({ fiscalYearStart, filters: filtersParam }) : Promise.resolve([])),
    [key],
    []
  );
  return { mom: data || [], loading, error };
}

export function usePrimaryMonthOverMonth({ fiscalYearStart, filters }) {
  const { refreshKey } = useData();
  const filtersParam = filtersToParam(filters);
  const key = `${fiscalYearStart}|${JSON.stringify(filtersParam)}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(
    () => (fiscalYearStart ? primaryApi.mom({ fiscalYearStart, filters: filtersParam }) : Promise.resolve([])),
    [key],
    []
  );
  return { mom: data || [], loading, error };
}
