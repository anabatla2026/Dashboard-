import { secondaryApi } from "../lib/secondaryApi";
import { useData } from "../context/DataContext";
import { useServerQuery } from "./useServerQuery";

export function useSecondaryKpis({ year, month, appUser }) {
  const { refreshKey } = useData();
  const appUserArr = appUser ? [...appUser] : undefined;
  const key = `${year}|${month}|${appUserArr ? [...appUserArr].sort().join(",") : ""}|${refreshKey}`;
  const { data, loading, error } = useServerQuery(
    () => secondaryApi.kpis({ year, month, appUser: appUserArr }),
    [key],
    null
  );
  return { kpis: data, loading, error };
}
