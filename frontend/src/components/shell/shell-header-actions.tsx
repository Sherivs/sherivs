/**
 * CoreGrid — platform shell header actions (ADR-003 Option 1, GAP-008).
 *
 * The composed right-hand chrome of the platform-owned shell: search trigger,
 * colour-mode toggle, notifications bell, profile menu. All surfaces render
 * from platform contracts (`buildNotificationSurface`, `buildProfileMenu`)
 * over server-resolved session data — the shell imports no domain module.
 */
import { Search as SearchIcon, Brain } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/shell/notification-bell";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { openCommandCenter } from "@/components/command-center";
import { openJarvisConsole } from "@/components/jarvis/jarvis-sheet";
import { useModKeyLabel } from "@/lib/kbd";
import { EXECUTIVE_INTELLIGENCE_NAME } from "@/lib/platform";
import type { ShellNotificationViewer } from "@/lib/shell-notifications";

export interface ShellHeaderActionsProps {
  readonly displayName: string;
  readonly roleTitle: string;
  readonly greeting: string;
  readonly workspaceName: string | null;
  /** Server-resolved viewer context for the bell; null keeps the bell quiet. */
  readonly notificationViewer: ShellNotificationViewer | null;
  readonly onSignOut: () => void | Promise<void>;
}

export function ShellHeaderActions({
  displayName,
  roleTitle,
  greeting,
  workspaceName,
  notificationViewer,
  onSignOut,
}: ShellHeaderActionsProps) {
  const modKey = useModKeyLabel();

  return (
    <div className="flex items-center gap-2 text-sm sm:gap-3">
      <button
        onClick={openJarvisConsole}
        className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/20 transition-colors"
        title={`Open ${EXECUTIVE_INTELLIGENCE_NAME} Executive Console`}
      >
        <Brain className="size-3.5" />
        <span className="hidden md:inline">{EXECUTIVE_INTELLIGENCE_NAME}</span>
      </button>
      <button
        onClick={openCommandCenter}
        className="hidden sm:inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        title={`Command palette (${modKey}K)`}
      >
        <SearchIcon className="size-3.5" />
        <span>Search</span>
        <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{modKey}K</kbd>
      </button>
      <button
        onClick={openCommandCenter}
        className="inline-flex sm:hidden items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent"
        aria-label={`Search (${modKey}+K)`}
      >
        <SearchIcon className="size-4" />
      </button>
      <ThemeToggle className="hidden xs:inline-flex" />
      <NotificationBell viewer={notificationViewer} />
      <ProfileMenu
        displayName={displayName}
        roleTitle={roleTitle}
        workspaceName={workspaceName}
        greeting={greeting}
        onSignOut={onSignOut}
      />
    </div>
  );
}
