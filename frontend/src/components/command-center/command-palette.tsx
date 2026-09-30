/**
 * CommandPalette — enterprise-grade global ⌘K / Ctrl+K command palette.
 *
 * Fullscreen backdrop-blurred overlay with a centered panel. Sections:
 *   - Recent pages (localStorage, last 5) — shown when the query is empty
 *   - Pages (role-filtered navigation)
 *   - Quick actions (role-filtered)
 *   - Students (admin / principal / teacher only, live school-scoped search)
 *
 * Keyboard: ↑/↓ move, Enter execute, Esc close, Tab jump to next section.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowRight,
  Clock,
  GraduationCap,
  Megaphone,
  Users,
  Wallet,
  CalendarDays,
  BookOpen,
  Bus,
  Activity,
  ClipboardCheck,
  Sparkles,
  Settings,
  LayoutDashboard,
  Building2,
  Newspaper,
  MessageSquare,
  Search,
  CornerDownLeft,
} from "lucide-react";
import type { AppRole } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

export const COMMAND_CENTER_EVENT = "open-command-center";

const RECENT_KEY = "uos:cc:recent";
const RECENT_MAX = 5;

type IconType = React.ComponentType<{ className?: string }>;

type Row = {
  id: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon?: IconType;
  initials?: string;
  onSelect: () => void;
};

type Section = { key: string; heading: string; rows: Row[] };

function pushRecent(path: string, label: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const arr: Array<{ path: string; label: string }> = raw ? JSON.parse(raw) : [];
    const next = [{ path, label }, ...arr.filter((r) => r.path !== path)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function readRecent(): Array<{ path: string; label: string }> {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Record a pathname in the recent-pages ring buffer. */
export function useTrackRecentPage(pathname: string, label: string) {
  useEffect(() => {
    if (!pathname || pathname === "/") return;
    pushRecent(pathname, label);
  }, [pathname, label]);
}

type NavEntry = {
  path: string;
  label: string;
  description?: string;
  icon: IconType;
  shortcut?: string;
};

function navFor(role: AppRole | null): NavEntry[] {
  switch (role) {
    case "admin":
    case "principal":
      return [
        {
          path: "/admin/dashboard",
          label: "Dashboard",
          description: "Executive command center",
          icon: LayoutDashboard,
          shortcut: "G D",
        },
        {
          path: "/admin/student-intelligence",
          label: "Student Intelligence",
          description: "Risk and performance signals",
          icon: Sparkles,
        },
        {
          path: "/admin/teacher-intelligence",
          label: "Teacher Intelligence",
          description: "Staff performance signals",
          icon: Sparkles,
        },
        {
          path: "/admin/students",
          label: "Students",
          description: "Enrollment records",
          icon: GraduationCap,
          shortcut: "G S",
        },
        { path: "/admin/teachers", label: "Teachers", description: "Staff directory", icon: Users },
        {
          path: "/admin/fees",
          label: "Fees",
          description: "Invoices and payments",
          icon: Wallet,
          shortcut: "G F",
        },
        {
          path: "/admin/attendance",
          label: "Attendance",
          description: "Daily attendance registers",
          icon: ClipboardCheck,
        },
        {
          path: "/admin/calendar",
          label: "Calendar",
          description: "School calendar & events",
          icon: CalendarDays,
        },
        {
          path: "/admin/news",
          label: "News",
          description: "Announcements and posts",
          icon: Newspaper,
        },
        {
          path: "/admin/operations",
          label: "Operations",
          description: "Day-to-day operations",
          icon: Activity,
        },
        {
          path: "/admin/cms",
          label: "Public site CMS",
          description: "Website content",
          icon: Building2,
        },
        {
          path: "/admin/settings",
          label: "Settings",
          description: "School configuration",
          icon: Settings,
        },
      ];
    case "teacher":
      return [
        {
          path: "/teacher/dashboard",
          label: "Dashboard",
          description: "Your teaching overview",
          icon: LayoutDashboard,
        },
        {
          path: "/teacher/attendance",
          label: "Mark Attendance",
          description: "Register for your classes",
          icon: ClipboardCheck,
        },
        {
          path: "/teacher/grades",
          label: "Enter Grades",
          description: "Score entry",
          icon: GraduationCap,
        },
        {
          path: "/teacher/gradebook",
          label: "Gradebook",
          description: "Full class gradebook",
          icon: BookOpen,
        },
        {
          path: "/teacher/lesson-plans",
          label: "Lesson Plans",
          description: "Plan and submit lessons",
          icon: BookOpen,
        },
        {
          path: "/teacher/class-intelligence",
          label: "Class Intelligence",
          description: "Class analytics",
          icon: Sparkles,
        },
        {
          path: "/teacher/ai-assistant",
          label: "AI Assistant",
          description: "Ask about your classes",
          icon: Sparkles,
        },
        {
          path: "/teacher/calendar",
          label: "Calendar",
          description: "Your schedule",
          icon: CalendarDays,
        },
      ];
    case "parent":
      return [
        {
          path: "/parent/dashboard",
          label: "Dashboard",
          description: "Family overview",
          icon: LayoutDashboard,
        },
        {
          path: "/parent/children",
          label: "My Children",
          description: "Child profiles",
          icon: Users,
        },
        {
          path: "/parent/grades",
          label: "Grades",
          description: "Academic results",
          icon: GraduationCap,
        },
        {
          path: "/parent/attendance",
          label: "Attendance",
          description: "Presence history",
          icon: ClipboardCheck,
        },
        {
          path: "/parent/fees",
          label: "Pay Fees",
          description: "Outstanding invoices",
          icon: Wallet,
        },
        {
          path: "/parent/bus-tracking",
          label: "Bus Tracking",
          description: "Live transport status",
          icon: Bus,
        },
        {
          path: "/parent/ai-assistant",
          label: "AI Assistant",
          description: "Ask about your child",
          icon: Sparkles,
        },
      ];
    case "student":
      return [
        {
          path: "/student/dashboard",
          label: "Dashboard",
          description: "Your overview",
          icon: LayoutDashboard,
        },
        {
          path: "/student/grades",
          label: "Grades",
          description: "Your results",
          icon: GraduationCap,
        },
        {
          path: "/student/attendance",
          label: "Attendance",
          description: "Your attendance",
          icon: ClipboardCheck,
        },
        {
          path: "/student/timetable",
          label: "Timetable",
          description: "Your weekly schedule",
          icon: CalendarDays,
        },
        {
          path: "/student/report-card",
          label: "Report card",
          description: "Term report",
          icon: BookOpen,
        },
      ];
    case "bursar":
      return [
        {
          path: "/bursar/dashboard",
          label: "Dashboard",
          description: "Finance overview",
          icon: LayoutDashboard,
        },
        {
          path: "/bursar/receipts",
          label: "Receipts",
          description: "Issue and view receipts",
          icon: Wallet,
        },
        {
          path: "/bursar/reconciliation",
          label: "Reconciliation",
          description: "Match payments",
          icon: Activity,
        },
        {
          path: "/bursar/reports",
          label: "Reports",
          description: "Financial reports",
          icon: BookOpen,
        },
      ];
    case "driver":
      return [
        {
          path: "/driver/dashboard",
          label: "Dashboard",
          description: "Route overview",
          icon: LayoutDashboard,
        },
        {
          path: "/driver/students",
          label: "My Students",
          description: "Riders on your route",
          icon: Users,
        },
      ];
    case "hq":
      return [
        {
          path: "/hq/dashboard",
          label: "Dashboard",
          description: "Group overview",
          icon: LayoutDashboard,
        },
        { path: "/hq/finance", label: "Finance", description: "Group finance", icon: Wallet },
        { path: "/hq/reports", label: "Reports", description: "Group reports", icon: BookOpen },
      ];
    case "super_admin":
      return [
        {
          path: "/super-admin/dashboard",
          label: "Dashboard",
          description: "Platform overview",
          icon: LayoutDashboard,
        },
        {
          path: "/super-admin/schools",
          label: "Schools",
          description: "Tenant management",
          icon: Building2,
        },
        {
          path: "/super-admin/billing",
          label: "Billing",
          description: "Subscriptions & invoices",
          icon: Wallet,
        },
        {
          path: "/super-admin/support",
          label: "Support",
          description: "Complaints & tickets",
          icon: MessageSquare,
        },
      ];
    default:
      return [];
  }
}

type ActionEntry = { id: string; label: string; description: string; icon: IconType; path: string };

function quickActionsFor(role: AppRole | null): ActionEntry[] {
  switch (role) {
    case "admin":
    case "principal":
      return [
        {
          id: "qa-add-student",
          label: "Add Student",
          description: "Enroll a new student record",
          icon: GraduationCap,
          path: "/admin/students",
        },
        {
          id: "qa-record-fee",
          label: "Record Payment",
          description: "Log a fee payment",
          icon: Wallet,
          path: "/admin/fees",
        },
        {
          id: "qa-attendance",
          label: "Mark Attendance",
          description: "Open the attendance register",
          icon: ClipboardCheck,
          path: "/admin/attendance",
        },
        {
          id: "qa-announcement",
          label: "Send Announcement",
          description: "Broadcast to the school",
          icon: Megaphone,
          path: "/admin/broadcast",
        },
      ];
    case "teacher":
      return [
        {
          id: "qa-start-class",
          label: "Start Class",
          description: "Open today's class register",
          icon: ClipboardCheck,
          path: "/teacher/attendance",
        },
        {
          id: "qa-enter-grades",
          label: "Enter Grades",
          description: "Record assessment scores",
          icon: GraduationCap,
          path: "/teacher/grades",
        },
        {
          id: "qa-lesson-plan",
          label: "Submit Lesson Plan",
          description: "Create or submit a plan",
          icon: BookOpen,
          path: "/teacher/lesson-plans",
        },
      ];
    case "parent":
      return [
        {
          id: "qa-pay-fees",
          label: "Pay Fees",
          description: "Settle outstanding invoices",
          icon: Wallet,
          path: "/parent/fees",
        },
        {
          id: "qa-report-card",
          label: "View Report Card",
          description: "Latest term results",
          icon: BookOpen,
          path: "/parent/grades",
        },
      ];
    case "bursar":
      return [
        {
          id: "qa-receipts",
          label: "New Receipt",
          description: "Issue a payment receipt",
          icon: Wallet,
          path: "/bursar/receipts",
        },
        {
          id: "qa-reconcile",
          label: "Reconcile",
          description: "Match bank payments",
          icon: Activity,
          path: "/bursar/reconciliation",
        },
      ];
    case "super_admin":
      return [
        {
          id: "qa-onboard",
          label: "Onboard School",
          description: "Create a new tenant",
          icon: Building2,
          path: "/super-admin/schools",
        },
      ];
    default:
      return [];
  }
}

type StudentHit = {
  id: string;
  full_name: string;
  admission_number: string | null;
  class_name: string | null;
};

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { role, profile } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [students, setStudents] = useState<StudentHit[]>([]);
  const [recent, setRecent] = useState<Array<{ path: string; label: string }>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  const schoolId = profile?.school_id ?? null;
  const canSearchStudents = role === "admin" || role === "principal" || role === "teacher";

  useEffect(() => {
    if (open) {
      setRecent(readRecent());
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const go = useCallback(
    (path: string) => {
      onClose();
      navigate({ to: path });
    },
    [navigate, onClose],
  );

  // Live student search (school-scoped).
  useEffect(() => {
    if (!open || !canSearchStudents || query.trim().length <= 2) {
      setStudents([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const term = query.trim();
      let uq = supabase
        .from("users")
        .select("id, full_name")
        .eq("role", "student")
        .ilike("full_name", `%${term}%`)
        .limit(5);
      if (schoolId) uq = uq.eq("school_id", schoolId);
      const { data: users } = await uq;
      const list = (users ?? []) as Array<{ id: string; full_name: string | null }>;
      if (list.length === 0) {
        setStudents([]);
        return;
      }
      let sq = supabase
        .from("students")
        .select("id, user_id, admission_number, class_id")
        .in(
          "user_id",
          list.map((u) => u.id),
        );
      if (schoolId) sq = sq.eq("school_id", schoolId);
      const { data: srows } = await sq;
      const rows = (srows ?? []) as Array<{
        id: string;
        user_id: string;
        admission_number: string | null;
        class_id: string | null;
      }>;
      const classIds = Array.from(new Set(rows.map((r) => r.class_id).filter(Boolean))) as string[];
      const classNames = new Map<string, string>();
      if (classIds.length > 0) {
        const { data: crows } = await supabase
          .from("classes")
          .select("id, name")
          .in("id", classIds);
        for (const c of (crows ?? []) as Array<{ id: string; name: string | null }>) {
          if (c.name) classNames.set(c.id, c.name);
        }
      }
      const byUser = new Map(rows.map((r) => [r.user_id, r]));
      setStudents(
        list.map((u) => {
          const s = byUser.get(u.id);
          return {
            id: s?.id ?? u.id,
            full_name: u.full_name ?? "(unnamed)",
            admission_number: s?.admission_number ?? null,
            class_name: s?.class_id ? (classNames.get(s.class_id) ?? null) : null,
          };
        }),
      );
    }, 180);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open, canSearchStudents, schoolId]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Section[] = [];

    if (!q) {
      const pages = navFor(role).slice(0, 6);
      const quick = pages.map((n) => ({
        id: `page-${n.path}`,
        label: n.label,
        hint: n.description,
        shortcut: n.shortcut,
        icon: n.icon,
        onSelect: () => go(n.path),
      }));

      if (quick.length > 0) {
        out.push({
          key: "quick-access",
          heading: "Quick access",
          rows: quick,
        });
      }
      return out;
    }

    const pages = navFor(role).filter(
      (n) => n.label.toLowerCase().includes(q) || (n.description ?? "").toLowerCase().includes(q),
    );
    if (pages.length > 0) {
      out.push({
        key: "pages",
        heading: "Pages",
        rows: pages.map((n) => ({
          id: `page-${n.path}`,
          label: n.label,
          hint: n.description,
          shortcut: n.shortcut,
          icon: n.icon,
          onSelect: () => go(n.path),
        })),
      });
    }

    const actions = quickActionsFor(role).filter(
      (a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    );
    if (actions.length > 0) {
      out.push({
        key: "actions",
        heading: "Quick Actions",
        rows: actions.map((a) => ({
          id: a.id,
          label: a.label,
          hint: a.description,
          icon: a.icon,
          onSelect: () => go(a.path),
        })),
      });
    }

    if (canSearchStudents && students.length > 0) {
      out.push({
        key: "students",
        heading: "Students",
        rows: students.map((s) => ({
          id: `student-${s.id}`,
          label: s.full_name,
          hint: [s.class_name, s.admission_number].filter(Boolean).join(" · ") || undefined,
          initials: initialsOf(s.full_name),
          onSelect: () =>
            go(role === "teacher" ? `/teacher/students?id=${s.id}` : `/admin/students?id=${s.id}`),
        })),
      });
    }

    return out;
  }, [query, recent, role, students, canSearchStudents, go]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  useEffect(() => {
    setActive(0);
  }, [query, sections.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open, sections]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      // Jump to the first row of the next section.
      let offset = 0;
      let next = 0;
      for (const s of sections) {
        if (active < offset + s.rows.length) {
          next = offset + s.rows.length;
          break;
        }
        offset += s.rows.length;
      }
      setActive(flat.length ? next % flat.length : 0);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.onSelect();
    }
  };

  let cursor = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh] backdrop-blur-xl"
      style={{ background: "rgba(4, 7, 16, 0.6)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-2xl overflow-hidden"
        style={{
          background: "rgba(10, 15, 30, 0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "var(--radius-2xl, 20px)",
          boxShadow: "var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.55))",
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search className="size-4 shrink-0 text-white/40" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, students, actions..."
            aria-label="Search pages, students and actions"
            className="w-full bg-transparent p-4 pl-0 text-lg text-white outline-none placeholder:text-white/35"
          />
          <kbd className="hidden shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60 sm:block">
            ESC
          </kbd>
        </div>

        <div className="flex items-center gap-4 border-b border-white/10 bg-white/[0.02] px-4 py-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary/30 via-primary/10 to-white/5 text-2xl font-black text-white shadow-lg shadow-primary/20">
            {query ? query.trim().charAt(0).toUpperCase() : "A"}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">
              Quick access
            </div>
            <div className="text-sm font-medium text-white/75">
              {query ? `Results for “${query}”` : "Start from a section"}
            </div>
          </div>
        </div>

        <div ref={listRef} className="max-h-96 overflow-y-auto overscroll-contain py-2">
          {flat.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-white/45">
              No results for “{query}”.
            </div>
          )}

          {sections.map((section) => (
            <div key={section.key} className="mb-1">
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/35">
                {section.heading}
              </div>
              {section.rows.map((row) => {
                cursor += 1;
                const index = cursor;
                const isActive = index === active;
                const Icon = row.icon;
                return (
                  <button
                    key={row.id}
                    type="button"
                    data-active={isActive}
                    onMouseEnter={() => setActive(index)}
                    onClick={row.onSelect}
                    className="flex h-12 w-full items-center gap-3 border-l-2 px-4 text-left transition-colors"
                    style={{
                      borderLeftColor: isActive ? "var(--tenant-primary, #0d9488)" : "transparent",
                      background: isActive ? "rgba(13,148,136,0.15)" : "transparent",
                    }}
                    onMouseOver={(e) => {
                      if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    }}
                    onMouseOut={(e) => {
                      if (!isActive) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {row.initials ? (
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white/80">
                        {row.initials}
                      </span>
                    ) : Icon ? (
                      <Icon className="size-4 shrink-0 text-white/60" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{row.label}</span>
                      {row.hint && (
                        <span className="block truncate text-[11px] text-white/40">{row.hint}</span>
                      )}
                    </span>
                    {row.shortcut ? (
                      <kbd className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
                        {row.shortcut}
                      </kbd>
                    ) : isActive ? (
                      <CornerDownLeft className="size-3.5 shrink-0 text-white/50" />
                    ) : (
                      <ArrowRight className="size-3.5 shrink-0 text-white/20" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2 text-[10px] text-white/40">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Tab next section</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

/** Backwards-compatible alias for the previous component name. */
export const CommandCenter = CommandPalette;

/**
 * Mount + shortcut wiring for the authenticated layout. Owns the open state,
 * listens for ⌘K / Ctrl+K and the `open-command-center` window event, and
 * records visited routes for the Recent Pages section.
 */
export function CommandCenterMount() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  useEffect(() => {
    if (!pathname || pathname === "/") return;
    const segs = pathname.split("/").filter(Boolean);
    const label = segs
      .slice(-2)
      .map((s) => s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()))
      .join(" · ");
    pushRecent(pathname, label || pathname);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_CENTER_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_CENTER_EVENT, onEvent);
    };
  }, []);

  return <CommandPalette open={open} onClose={() => setOpen(false)} />;
}

/** Fire from anywhere in the app to open the command palette. */
export function openCommandCenter() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COMMAND_CENTER_EVENT));
}
