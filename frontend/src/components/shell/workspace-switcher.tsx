/**
 * Sherivs — platform shell: workspace switcher (ADR-003 Option 1).
 *
 * The switcher is presentation only (AGENTS §34): it renders server-derived
 * directory options and SUBMITS a choice — a workspace reference and nothing
 * else. Tenant context is never accepted from client storage; the receiving
 * side re-resolves the context server-side via the
 * `resolveWorkspaceSwitchChoice` contract.
 *
 * With zero or one option it renders an honest current-context display — no
 * invented destinations.
 */
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceSwitcherOption } from "@/lib/shell-org-switcher";

export interface WorkspaceSwitcherProps {
  /** Server-derived options the viewer may access (never client storage). */
  readonly options: readonly WorkspaceSwitcherOption[];
  /** Current context id, as resolved by the session. */
  readonly currentId: string | null;
  /**
   * Submit a choice for server re-resolution. Required once more than one
   * option exists; with a single option the switcher stays informational.
   */
  readonly onSwitch?: (choice: { workspaceId: string }) => void;
}

export function WorkspaceSwitcher({ options, currentId, onSwitch }: WorkspaceSwitcherProps) {
  const current = options.find((option) => option.id === currentId) ?? options[0] ?? null;

  if (options.length <= 1) {
    return (
      <div
        className="hidden md:flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground"
        title="Active workspace"
      >
        <Building2 className="size-3.5 shrink-0" />
        <span className="max-w-40 truncate">{current ? current.label : "No workspace"}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Switch workspace"
      >
        <Building2 className="size-3.5 shrink-0" />
        <span className="max-w-40 truncate">{current ? current.label : "No workspace"}</span>
        <ChevronsUpDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            disabled={!onSwitch}
            aria-disabled={!onSwitch}
            onSelect={() => onSwitch?.({ workspaceId: option.id })}
          >
            <span className="flex-1 truncate">{option.label}</span>
            {option.id === current?.id && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
