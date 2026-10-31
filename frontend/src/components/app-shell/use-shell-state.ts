import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { fromServer, type ServerManifest } from "@/lib/sherivs-ws/server-adapter";
import type { CardData, WidgetDataResponse } from "@/lib/sherivs-ws/live";
import type { WorkspaceManifest, WorkspacePrefs } from "@/components/workspaces/_contract-shim";
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

interface WorkspacePrefsQuery {
  select(columns: string): WorkspacePrefsQuery;
  eq(column: string, value: string): WorkspacePrefsQuery;
  maybeSingle(): Promise<{ data: { prefs: WorkspacePrefs } | null; error: unknown }>;
}

export function useShellState() {
  const app = useApp();
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [cards, setCards] = useState<Record<string, CardData>>({});
  const [affiliations, setAffiliations] = useState<ShellAffiliation[]>([]);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState(false);
  const [widgetsLoading, setWidgetsLoading] = useState(false);
  const [widgetsError, setWidgetsError] = useState(false);
  const [prefs, setPrefs] = useState<WorkspacePrefs>({});
  const [prefsReady, setPrefsReady] = useState(false);
  const [prefsError, setPrefsError] = useState(false);

  const load = useCallback(async () => {
    const profile = app.profile;
    const school = app.school;
    setManifestLoading(true);
    setManifestError(false);
    setWidgetsError(false);
    if (!profile || !school) {
      setManifest(null);
      setAffiliations([]);
      setManifestLoading(false);
      return;
    }
    try {
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
      setAffiliations(
        mergeAffiliations(
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
        ),
      );

      const { data: remote, error: remoteError } = await supabase.rpc(
        "workspace_manifest" as never,
        { p_org: school.id } as never,
      );
      if (remoteError || !remote) {
        setManifest(null);
        setCards({});
        setPrefsReady(false);
        setManifestError(true);
        return;
      }

      const next = fromServer(remote as unknown as ServerManifest, {
        name: school.name,
        plan: "growth",
      });
      setManifest(next);

      const prefsTable = supabase.from("user_workspace_prefs" as never) as unknown as WorkspacePrefsQuery;
      const { data: preferenceRow, error: preferenceError } = await prefsTable
        .select("prefs")
        .eq("user_id", profile.id)
        .eq("org_id", school.id)
        .maybeSingle();
      setPrefsReady(!preferenceError);
      setPrefsError(Boolean(preferenceError));
      setPrefs((preferenceRow?.prefs as WorkspacePrefs | undefined) ?? {});

      const keys = next.widgets.map((item) => item.key);
      if (!keys.length) {
        setCards({});
        setWidgetsLoading(false);
      } else {
        setWidgetsLoading(true);
        const { data: live, error: liveError } = await supabase.rpc(
          "workspace_widget_data" as never,
          { p_org: school.id, p_keys: keys } as never,
        );
        setCards(liveError ? {} : ((live as unknown as WidgetDataResponse | null)?.cards ?? {}));
        setWidgetsError(Boolean(liveError));
        setWidgetsLoading(false);
      }
    } catch {
      setManifest(null);
      setCards({});
      setPrefsReady(false);
      setManifestError(true);
    } finally {
      setManifestLoading(false);
    }
  }, [app.profile, app.school]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const savePrefs = useCallback(
    async (nextPrefs: WorkspacePrefs): Promise<boolean> => {
      if (!app.school || !manifest?.canPersonalise || !prefsReady) return false;
      setPrefsError(false);
      const { data, error } = await supabase.rpc(
        "workspace_prefs_save" as never,
        { p_org: app.school.id, p_prefs: nextPrefs } as never,
      );
      if (error) {
        setPrefsError(true);
        return false;
      }
      setPrefs((data as unknown as WorkspacePrefs | null) ?? nextPrefs);
      await load();
      return true;
    },
    [app.school, load, manifest?.canPersonalise, prefsReady],
  );

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
    manifestLoading,
    manifestError,
    widgetsLoading,
    widgetsError,
    prefs,
    prefsReady,
    prefsError,
    savePrefs,
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
