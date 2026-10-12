/**
 * Sherivs — Phase 06 Workspace Engine: workspace-dynamic sidebar.
 *
 * This component contains NO hard-coded portals, role maps, or labels. It
 * renders whatever chrome the workspace resolution produced (contributions ×
 * authorized capabilities). Section grouping/collapsing and icons are driven
 * by data: `collapsible`, `iconKey`, `label` come from the resolution.
 *
 * Laws:
 * - Cosmetic filtering already happened upstream; rendering here never grants.
 * - Icon components are mapped from registry KEYS; data never imports UI.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ElementType } from "react";
import {
  Activity,
  Award,
  Bell,
  BookOpen,
  Brain,
  Building2,
  Bus,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  FileText,
  Globe,
  GraduationCap,
  HeartPulse,
  Home,
  KeyRound,
  Layers,
  LayoutDashboard,
  Link2,
  MapPin,
  Megaphone,
  MessageSquare,
  Newspaper,
  Receipt,
  ScanFace,
  ScrollText,
  Search as SearchIcon,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { openCommandCenter } from "@/components/command-center";
import { ThemeToggle } from "@/components/theme-toggle";
import { useModKeyLabel } from "@/lib/kbd";
import { useUnreadNewsCount } from "@/lib/news-reads";
import { useUnreadMessagesCount } from "@/lib/messages-unread";
import { ROUTE_PROGRESS_EVENT } from "@/components/route-progress-bar";
import { cn } from "@/lib/utils";
import type { WorkspaceNavItem, WorkspaceNavSection } from "@/lib/workspace-engine/navigation";

/** Icon registry: data uses keys; this is the ONLY place keys meet components. */
const ICON_REGISTRY: Record<string, ElementType> = {
  dashboard: LayoutDashboard,
  users: Users,
  teachers: GraduationCap,
  children: Users,
  grades: Award,
  fees: Wallet,
  report: FileText,
  lessons: FileText,
  attendance: CalendarCheck,
  timetable: CalendarDays,
  calendar: CalendarDays,
  news: Newspaper,
  messages: MessageSquare,
  notifications: Bell,
  settings: Settings,
  ai: Sparkles,
  bus: Bus,
  signin: MapPin,
  biometric: ScanFace,
  broadcast: Megaphone,
  receipts: Receipt,
  reports: ScrollText,
  shield: ShieldCheck,
  activity: Activity,
  tiers: Layers,
  config: Sliders,
  schools: Building2,
  security: KeyRound,
  home: Home,
  globe: Globe,
  intelligence: Brain,
  academic: BookOpen,
  finance: Wallet,
  services: HeartPulse,
  communication: MessageSquare,
  administration: UserCog,
  platform: Globe,
  group: Layers,
};

function iconFor(key: string): ElementType {
  return ICON_REGISTRY[key] ?? Link2;
}

function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/u, "") : path;
}

function getActiveScore(item: WorkspaceNavItem, pathname: string): number {
  const current = normalizePath(pathname);
  const paths = [item.url, ...(item.activeUrls ?? [])].map(normalizePath);
  let score = 0;
  for (const path of paths) {
    if (current === path) score = Math.max(score, 10_000 + path.length);
    else if (current.startsWith(`${path}/`)) score = Math.max(score, path.length);
  }
  for (const prefix of item.activePrefixes ?? []) {
    const p = normalizePath(prefix);
    if (current.startsWith(p)) score = Math.max(score, p.length);
  }
  return score;
}

interface ItemRenderProps {
  item: WorkspaceNavItem;
  active: boolean;
  collapsed: boolean;
  onNavClick: () => void;
  unreadNews: number;
  unreadMessages: number;
}

function SidebarItemLink({
  item,
  active,
  collapsed,
  onNavClick,
  unreadNews,
  unreadMessages,
}: ItemRenderProps) {
  const Icon = iconFor(item.iconKey);
  const isNews = item.url.endsWith("/news");
  const isMessages = item.url === "/messages";
  const badge =
    isNews && unreadNews > 0
      ? unreadNews
      : isMessages && unreadMessages > 0
        ? unreadMessages
        : null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        className={
          active
            ? "!bg-primary/15 !text-primary font-semibold border-l-[3px] border-primary rounded-l-none hover:!bg-primary/20 hover:!text-primary"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        }
      >
        <Link
          to={item.url}
          onClick={onNavClick}
          aria-label={item.label}
          className="flex items-center gap-2"
        >
          <Icon className="size-4" />
          {!collapsed && <span className="flex-1">{item.label}</span>}
          {badge !== null && !collapsed && (
            <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {badge}
            </span>
          )}
          {badge !== null && collapsed && (
            <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function FlatSection({
  section,
  collapsed,
  activeUrl,
  onNavClick,
  unreadNews,
  unreadMessages,
}: {
  section: WorkspaceNavSection;
  collapsed: boolean;
  activeUrl: string;
  onNavClick: () => void;
  unreadNews: number;
  unreadMessages: number;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{section.sectionLabel}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {section.items.map((item) => (
            <SidebarItemLink
              key={item.key}
              item={item}
              active={activeUrl === item.url}
              collapsed={collapsed}
              onNavClick={onNavClick}
              unreadNews={unreadNews}
              unreadMessages={unreadMessages}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function CollapsibleSection({
  section,
  collapsed,
  activeUrl,
  onNavClick,
  unreadNews,
  unreadMessages,
}: {
  section: WorkspaceNavSection;
  collapsed: boolean;
  activeUrl: string;
  onNavClick: () => void;
  unreadNews: number;
  unreadMessages: number;
}) {
  const SectionIcon = iconFor(section.iconKey);
  const hasActive = section.items.some((item) => item.url === activeUrl);
  const [open, setOpen] = useState(hasActive || collapsed);
  const showOpen = collapsed ? true : open;

  return (
    <SidebarGroup>
      {!collapsed && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <SectionIcon className="size-3.5" />
          <span className="flex-1 text-left">{section.sectionLabel}</span>
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-200",
              showOpen ? "" : "-rotate-90",
            )}
          />
        </button>
      )}
      {showOpen && (
        <SidebarGroupContent>
          <SidebarMenu>
            {section.items.map((item) => (
              <SidebarItemLink
                key={item.key}
                item={item}
                active={activeUrl === item.url}
                collapsed={collapsed}
                onNavClick={onNavClick}
                unreadNews={unreadNews}
                unreadMessages={unreadMessages}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

export function PortalSidebar({ sections }: { sections: readonly WorkspaceNavSection[] }) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const modKey = useModKeyLabel();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const unreadNews = useUnreadNewsCount();
  const unreadMessages = useUnreadMessagesCount();

  const handleNavClick = () => {
    window.dispatchEvent(new CustomEvent(ROUTE_PROGRESS_EVENT, { detail: { source: "sidebar" } }));
    if (isMobile) setOpenMobile(false);
  };

  const items = sections.flatMap((section) => section.items);
  const activeUrl = items.reduce(
    (best, item) => {
      const score = getActiveScore(item, pathname);
      return score > best.score ? { url: item.url, score } : best;
    },
    { url: "", score: 0 },
  ).url;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {sections.map((section) =>
          section.collapsible ? (
            <CollapsibleSection
              key={section.sectionKey}
              section={section}
              collapsed={collapsed}
              activeUrl={activeUrl}
              onNavClick={handleNavClick}
              unreadNews={unreadNews}
              unreadMessages={unreadMessages}
            />
          ) : (
            <FlatSection
              key={section.sectionKey}
              section={section}
              collapsed={collapsed}
              activeUrl={activeUrl}
              onNavClick={handleNavClick}
              unreadNews={unreadNews}
              unreadMessages={unreadMessages}
            />
          ),
        )}
      </SidebarContent>
      <SidebarFooter>
        <button
          onClick={openCommandCenter}
          className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          title={`Open command palette (${modKey}K)`}
        >
          <SearchIcon className="size-3.5 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search</span>
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{modKey}K</kbd>
            </>
          )}
        </button>
        {!collapsed && (
          <div className="mt-auto border-t border-border/60 px-3 pt-3 pb-1">
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground/40">
                Press {modKey}+K to search
              </span>
              <ThemeToggle />
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
