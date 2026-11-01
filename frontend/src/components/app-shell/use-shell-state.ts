import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { fromServer, type ServerManifest } from "@/lib/sherivs-ws/server-adapter";
import { parseScopeParam, type CardData, type WidgetDataResponse } from "@/lib/sherivs-ws/live";
import { focusScope, scopeFocusOptions } from "@/lib/sherivs-ws/engine";
import type { WorkspaceManifest, WorkspacePrefs } from "@/components/workspaces/_contract-shim";
import {
  mergeAffiliations,
  shouldShowContextSwitcher,
  type ShellAffiliation,
} from "@/lib/shell/membership-policy";
import {
  composeBottomSlots,
  composeHomeSections,
  composeSidePanel,
  toShellNavItem,
} from "@/lib/shell/chrome";
import { primarySections } from "@/components/workspaces/workspace-shell";
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
  const location = useLocation();
  const requestedScopeFocus = useMemo(
    () => parseScopeParam(new URLSearchParams(location.searchStr).get("scope")),
    [location.searchStr],
  );
  const [manifest, setManifest] = useState<WorkspaceManifest | null>(null);
  const [cards, setCards] = useState<Record<string, CardData>>({});
  const [scopeLabels, setScopeLabels] = useState<WidgetDataResponse["labels"]>({});
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
  const scopeFocus = useMemo(() => {
    if (
      !manifest ||
      !requestedScopeFocus ||
      !manifest.scopeOptions[requestedScopeFocus.dim]?.includes(requestedScopeFocus.ref)
    ) {
      return null;
    }
    return requestedScopeFocus;
  }, [manifest, requestedScopeFocus]);

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
        setScopeLabels({});
        setWidgetsLoading(false);
        setPrefsReady(false);
        setManifestError(true);
        return;
      }

      const next = fromServer(remote as unknown as ServerManifest, {
        name: school.name,
        plan: "growth",
      });
      setManifest(next);

      const prefsTable = supabase.from(
        "user_workspace_prefs" as never,
      ) as unknown as WorkspacePrefsQuery;
      const { data: preferenceRow, error: preferenceError } = await prefsTable
        .select("prefs")
        .eq("user_id", profile.id)
        .eq("org_id", school.id)
        .maybeSingle();
      setPrefsReady(!preferenceError);
      setPrefsError(Boolean(preferenceError));
      setPrefs((preferenceRow?.prefs as WorkspacePrefs | undefined) ?? {});
    } catch {
      setManifest(null);
      setCards({});
      setScopeLabels({});
      setWidgetsLoading(false);
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
    const schoolId = app.school?.id;
    if (!manifest || !schoolId) {
      setCards({});
      setScopeLabels({});
      setWidgetsLoading(false);
      return;
    }

    const keys = manifest.widgets.map((item) => item.key);
    if (!keys.length) {
      setCards({});
      setScopeLabels({});
      setWidgetsLoading(false);
      return;
    }

    let active = true;
    setWidgetsLoading(true);
    setWidgetsError(false);
    const loadCards = async () => {
      try {
        const { data: live, error: liveError } = await supabase.rpc(
          "workspace_widget_data" as never,
          {
            p_org: schoolId,
            p_keys: keys,
            p_scope: scopeFocus,
          } as never,
        );
        if (!active) return;
        setCards(liveError ? {} : ((live as unknown as WidgetDataResponse | null)?.cards ?? {}));
        setScopeLabels(
          liveError ? {} : ((live as unknown as WidgetDataResponse | null)?.labels ?? {}),
        );
        setWidgetsError(Boolean(liveError));
      } catch {
        if (!active) return;
        setCards({});
        setScopeLabels({});
        setWidgetsError(true);
      } finally {
        if (active) setWidgetsLoading(false);
      }
    };
    void loadCards();
    return () => {
      active = false;
    };
  }, [app.school?.id, manifest, scopeFocus]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const savePrefs = useCallback(
    async (nextPrefs: WorkspacePrefs): Promise<boolean> => {
      if (!app.school || !manifest?.canPersonalise || !prefsReady) return false;
      setPrefsError(false);
      try {
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
      } catch {
        setPrefsError(true);
        return false;
      }
    },
    [app.school, load, manifest?.canPersonalise, prefsReady],
  );

  const at = new Date(now);
  const hour = hourInTimeZone(at, SHELL_TIME_ZONE);
  const name = compactPersonName(app.profile?.full_name ?? app.authUser?.user_metadata?.full_name);
  const focusedManifest = useMemo(
    () => (manifest ? focusScope(manifest, scopeFocus) : null),
    [manifest, scopeFocus],
  );
  const nav = useMemo(() => (focusedManifest?.nav ?? []).map(toShellNavItem), [focusedManifest]);
  const primaryNav = useMemo(
    () => (focusedManifest ? primarySections(focusedManifest).map(toShellNavItem) : []),
    [focusedManifest],
  );
  const home = useMemo(
    () =>
      composeHomeSections({
        widgets: focusedManifest?.widgets,
        actions: focusedManifest?.actions,
        inbox: focusedManifest?.inbox,
        nav: focusedManifest?.nav,
      }),
    [focusedManifest],
  );
  const drawer = useMemo(
    () =>
      composeSidePanel({
        nav: focusedManifest?.nav,
        widgets: focusedManifest?.widgets,
        actions: focusedManifest?.actions,
        inbox: focusedManifest?.inbox,
      }),
    [focusedManifest],
  );
  const bottom = useMemo(
    () =>
      composeBottomSlots({
        widgets: focusedManifest?.widgets,
        nav: focusedManifest?.nav,
        actions: focusedManifest?.actions,
        inbox: focusedManifest?.inbox,
      }),
    [focusedManifest],
  );
  const filteredDrawer = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return drawer;
    return drawer.filter((item) => `${item.label} ${item.key}`.toLowerCase().includes(needle));
  }, [drawer, query]);

  return {
    app,
    manifest,
    scopeFocus,
    availableScopes: manifest ? scopeFocusOptions(manifest) : [],
    cards,
    scopeLabels,
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
    primaryNav,
    home,
    drawer: filteredDrawer,
    bottom,
    query,
    setQuery,
    reload: load,
  };
}
