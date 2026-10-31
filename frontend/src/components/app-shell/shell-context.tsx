import { createContext, useContext, type ReactNode } from "react";
import { useShellState } from "./use-shell-state";

type ShellState = ReturnType<typeof useShellState>;

const ShellCtx = createContext<ShellState | null>(null);

export function AppShellStateProvider({ children }: { children: ReactNode }) {
  const value = useShellState();
  return <ShellCtx.Provider value={value}>{children}</ShellCtx.Provider>;
}

export function useAppShell() {
  const value = useContext(ShellCtx);
  if (!value) throw new Error("useAppShell must be used inside AppShellStateProvider");
  return value;
}
