import { createContext, useCallback, useContext, useRef, useState } from "react";

const TooltipContext = createContext(null);

export function TooltipProvider({ children }) {
  const [state, setState] = useState(null); // { x, y, color, label, value, extra }
  const frame = useRef(null);

  const show = useCallback((evt, { color, label, value, extra }) => {
    const pad = 14;
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + 240 > window.innerWidth) x = evt.clientX - 240 - pad;
    if (y + 76 > window.innerHeight) y = evt.clientY - 76 - pad;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setState({ x, y, color, label, value, extra }));
  }, []);

  const hide = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    setState(null);
  }, []);

  return (
    <TooltipContext.Provider value={{ show, hide }}>
      {children}
      {state && (
        <div className="tooltip show" style={{ left: state.x, top: state.y }} role="tooltip">
          <div className="tt-cat">
            <span className="key" style={{ background: state.color }} />
            <span>{state.label}</span>
          </div>
          <div className="tt-val">
            {state.value}
            {state.extra ? <span className="tt-pct">{state.extra}</span> : null}
          </div>
        </div>
      )}
    </TooltipContext.Provider>
  );
}

export function useTooltip() {
  const ctx = useContext(TooltipContext);
  if (!ctx) throw new Error("useTooltip must be used within a TooltipProvider");
  return ctx;
}
