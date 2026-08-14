"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Toggle theme"
    >
      <Sun className="h-3.5 w-3.5 hidden dark:block" strokeWidth={1.75} />
      <Moon className="h-3.5 w-3.5 block dark:hidden" strokeWidth={1.75} />
    </button>
  );
}
