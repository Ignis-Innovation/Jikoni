import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Light/dark toggle. Persists to localStorage and toggles the `dark` class on
 * <html> (the initial class is set by the inline script in index.html). */
export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("jikoni-theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("jikoni-theme", "light");
    }
  }, [dark]);

  return (
    <button
      onClick={() => setDark((v) => !v)}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Toggle theme"
      title={dark ? "Switch to light" : "Switch to dark"}
    >
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}
