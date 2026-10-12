/**
 * Sherivs — platform shell: profile menu (ADR-003 Option 1).
 *
 * Identity and destinations come from the profile menu contract
 * (`buildProfileMenu`) over server-resolved session data. Sign-out is an
 * action handed in by the shell route; the menu owns no session logic.
 */
import { LogOut, Settings, UserRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildProfileMenu, profileInitials } from "@/lib/shell-profile";

export interface ProfileMenuProps {
  readonly displayName: string;
  readonly roleTitle: string;
  readonly workspaceName: string | null;
  readonly greeting: string;
  readonly onSignOut: () => void | Promise<void>;
}

export function ProfileMenu({
  displayName,
  roleTitle,
  workspaceName,
  greeting,
  onSignOut,
}: ProfileMenuProps) {
  const menu = buildProfileMenu({ displayName, roleTitle, workspaceName });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1.5 hover:bg-accent"
        title="Profile"
      >
        <span className="hidden sm:inline text-xs text-muted-foreground">{greeting},</span>
        <span className="hidden sm:inline max-w-32 truncate text-xs font-medium text-foreground">
          {menu.identity.displayName}
        </span>
        <span className="grid size-6 place-items-center rounded-full uos-tenant-bg text-[10px] font-bold">
          {profileInitials(menu.identity.displayName)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="flex items-center gap-2">
            <UserRound className="size-3.5" />
            <span className="truncate">{menu.identity.displayName}</span>
          </span>
          <span className="mt-0.5 block text-[10px] font-normal uppercase tracking-widest text-muted-foreground">
            {menu.identity.roleTitle}
            {menu.identity.workspaceName ? ` · ${menu.identity.workspaceName}` : ""}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {menu.destinations.map((destination) => (
          <DropdownMenuItem key={destination.key} asChild>
            <Link to={destination.url}>
              {destination.key === "settings" ? (
                <Settings className="size-3.5" />
              ) : (
                <UserRound className="size-3.5" />
              )}
              {destination.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void onSignOut();
          }}
        >
          <LogOut className="size-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
