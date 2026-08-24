import { useEffect, useState } from "react";

export default function AppBar({ children }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 4);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return <div className={"appbar" + (scrolled ? " scrolled" : "")}>{children}</div>;
}
