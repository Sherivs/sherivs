import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { fromServer, type ServerManifest } from "@/lib/sherivs-ws/server-adapter";
import type { CardData, WidgetDataResponse } from "@/lib/sherivs-ws/live";
import type { WorkspaceManifest } from "@/lib/sherivs-ws/engine";
import { fallbackManifest } from "@/lib/shell/fallback-manifest";
import {
  mergeAffiliations,
  shouldShowContextSwitcher,
  type ShellAffiliation,
} from "@/lib/shell/membership-policy";
import { composeBottomSlots, composeHomeSections, composeSidePanel, toShellNavItem } from "@/lib/shell/chrome";
import { compactPersonName } from "@/lib/shell/display-name";
import {
  clockInTimeZone,
  greetingForHour,
  hourInTimeZone,
  SHELL_TIME_ZONE,
} from "@/lib/experience/workspace-experience";
import { scholarWorkspaceLabelForRole } from "@/lib/runtime/nav-registry";
import type { AppRole } from "@/lib/roles";

async function rpcJson<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) return null;
  return (data as T) ?? null;
}

export function useShellState() {
  const app = useApp();
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [cards, setCards] = useState<Record<string, CardData>>({});
  const [affiliations, setAffiliations] = useState<ShellAffiliation[]>([]);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const profile = app.profile;
    const school = app.school;
    if (!profile || !school) {
      setManifest(null);
      setAffiliations([]);
      return;
    }
    const { data: memberships } = await supabase
      .from("organization_memberships")
      .select("school_id, role, is_active")
      .eq("user_id", profile.id)
      .eq("is_active", true);
    const orgIds = [...new Set((memberships ?? []).map((row) => row.school_id).filter(Boolean))];
    const { data: orgs } = orgIds.length
      ? await supabase.from("schools").select("id, name").in("id", orgIds)
      : { data: [] as { id: string; name: string | null }[] };
    const orgNameById = new Map((orgs ?? []).map((row) => [row.id, row.name ?? school.name]));

    const fromMemberships: ShellAffiliation[] = (memberships ?? []).map((row) => ({
      organizationId: row.school_id,
      organizationName: orgNameById.get(row.school_id) ?? school.name,
      role: row.role as AppRole,
      active: row.school_id === school.id && row.role === profile.role,
    }));
    const nextAffiliations = mergeAffiliations(
      fromMemberships.length
        ? fromMemberships
        : [
            {
              organizationId: school.id,
              organizationName: school.name,
              role: profile.role,
              active: true,
            },
          ],
    );
    setAffiliations(nextAffiliations);

    const remote = await rpcJson<ServerManifest>("workspace_manifest", { p_org: school.id });
    const next = remote
      ? fromServer(remote, { name: school.name, plan: "growth" })
      : fallbackManifest({
          organizationId: school.id,
          organizationName: school.name,
          role: profile.role,
        });
    setManifest(next);
    const keys = next.widgets.map((item) => item.key);
    if (keys.length) {
      const live = await rpcJson<WidgetDataResponse>("workspace_widget_data", {
        p_org: school.id,
        p_keys: keys,
      });
      setCards(live?.cards ?? {});
    } else {
      setCards({});
    }
  }, [app.profile, app.school]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const at = new Date(now);
  const hour = hourInTimeZone(at, SHELL_TIME_ZONE);
  const name = compactPersonName(app.profile?.full_name ?? app.authUser?.user_metadata?.full_name);
  const nav = useMemo(() => (manifest?.nav ?? []).map(toShellNavItem), [manifest]);
  const home = useMemo(
    () =>
      composeHomeSections({
        widgets: manifest?.widgets,
        actions: manifest?.actions,
        inbox: manifest?.inbox,
        nav: manifest?.nav,
      }),
    [manifest],
  );
  const drawer = useMemo(
    () =>
      composeSidePanel({
        nav: manifest?.nav,
        widgets: manifest?.widgets,
        actions: manifest?.actions,
        inbox: manifest?.inbox,
      }),
    [manifest],
  );
  const bottom = useMemo(
    () => composeBottomSlots({ widgets: manifest?.widgets, nav: manifest?.nav }),
    [manifest],
  );
  const filteredDrawer = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return drawer;
    return drawer.filter((item) => `${item.label} ${item.key}`.toLowerCase().includes(needle));
  }, [drawer, query]);

  return {
    app,
    manifest,
    cards,
    affiliations,
    showSwitcher: shouldShowContextSwitcher(affiliations),
    greeting: greetingForHour(hour),
    clock: clockInTimeZone(at, SHELL_TIME_ZONE),
    name,
    roleTitle: app.role ? scholarWorkspaceLabelForRole(app.role) : "Member",
    orgName: app.school?.name ?? "Your organization",
    nav,
    home,
    drawer: filteredDrawer,
    bottom,
    query,
    setQuery,
    reload: load,
  };
}
