/**
 * Sherivs — Phase 06 Workspace Engine: workspace-dynamic mobile bottom nav.
 *
 * This component has NO hard-coded portals, roles, or labels. It renders
 * whatever chrome resolution the workspace produced (see
 * `workspace-engine/navigation.ts` + runtime nav data seeds). If the active
 * workspace has no mobile destinations, render nothing.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  CalendarDays,
  CreditCard,
  GraduationCap,
  Home,
  Link2,
  MapPin,
  Users,
} from "lucide-react";
import {
  flattenQuickNav,
  hasNavDestinations,
  type WorkspaceNavItem,
  type WorkspaceNavSection,
} from "@/lib/workspace-engine/navigation";

type IconComponent = React.ElementType;

/** Icon registry: keys come from data, components never live in data. */
const ICON_REGISTRY: Record<string, IconComponent> = {
  home: Home,
  children: Users,
  fees: CreditCard,
  bus: MapPin,
  ai: Bot,
  timetable: CalendarDays,
  grades: GraduationCap,
};

function iconFor(item: WorkspaceNavItem): IconComponent {
  return ICON_REGISTRY[item.iconKey] ?? Link2;
}

function BottomNav({ items, label }: { items: readonly WorkspaceNavItem[]; label: string }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <nav
      aria-label={label}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#0a0f1e]/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-16 items-center justify-around px-2">
        {items.map((item) => {
          const active = pathname.startsWith(item.url);
          const Icon = iconFor(item);
          return (
            <Link
              key={item.key}
              to={item.url}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={`flex min-w-[48px] flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-colors duration-150 ${
                active ? "text-teal-400" : "text-white/40"
              }`}
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * WorkspaceBottomNav — renders the resolved workspace's quick navigation.
 * Pass the RESOLVED sections (already capability-filtered) for this viewer.
 */
export function WorkspaceBottomNav({
  sections,
  ariaLabel = "Workspace quick navigation",
}: {
  sections: readonly WorkspaceNavSection[];
  ariaLabel?: string;
}) {
  if (!hasNavDestinations(sections)) return null;
  const items = flattenQuickNav(sections, 5);
  if (items.length === 0) return null;
  return <BottomNav items={items} label={ariaLabel} />;
}
