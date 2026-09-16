import { useEffect, useRef, useState } from "react";

// Runs `fetcher()` whenever `deps` change, keeping only the latest result —
// if filters/drill state change again before an in-flight request resolves,
// that stale response is dropped instead of flashing onto the chart.
export function useServerQuery(fetcher, deps, initial) {
  const [state, setState] = useState({ data: initial, loading: true, error: null });
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then((data) => {
        if (requestId.current === id) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (requestId.current === id) setState((s) => ({ ...s, loading: false, error: error.message }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
