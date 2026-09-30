import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, readThemeMode, setThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{
  mode: ThemeMode;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
  { mode: "system", label: "System", Icon: Monitor },
];

/** Segmented light / dark / system colour-mode switcher. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const stored = readThemeMode();
    setMode(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  return (
    <div
      role="group"
      aria-label="Colour mode"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={mode === m}
          onClick={() => {
            setMode(m);
            setThemeMode(m);
          }}
          className={cn(
            "grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
            mode === m && "bg-accent text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
