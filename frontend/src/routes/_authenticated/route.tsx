import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { refreshPushTokenIfGranted } from "@/lib/push-client";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { PortalSidebar } from "@/components/portal-sidebar";
import { PortalPageSkeleton, RouteErrorBoundary } from "@/components/portal-shell";
import { MobileSwipeToOpen } from "@/components/mobile-swipe-to-open";
import { CommandCenterMount } from "@/components/command-center";
import { ShellHeaderActions } from "@/components/shell/shell-header-actions";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { PLATFORM_NAME } from "@/lib/platform";
import { INSTALLED_RUNTIME_NAME as SCHOLAR_RUNTIME_NAME } from "@/lib/runtime/installed-runtimes";
import { WorkspaceBottomNav } from "@/components/mobile-bottom-nav";
import { OfflineBanner } from "@/components/offline-banner";
import { AppFramePreview } from "@/components/app-frame-preview";
import {
  ALL_NAV_CONTRIBUTIONS,
  scholarCapabilitiesForPortal,
  scholarCapabilitiesForRole,
  scholarWorkspaceHome,
  scholarWorkspaceLabelForRole,
  // The runtime layer names its own portal kinds; the shell speaks of them generically.
  type ScholarPortalKind as RuntimePortalKind,
} from "@/lib/runtime/nav-registry";
import { hasNavDestinations, resolveWorkspaceNav } from "@/lib/workspace-engine/navigation";
import { resolveMemberWorkspaceExperience } from "@/lib/experience/workspace-experience";
import { scholarWorkspaceLabelForMember } from "@/lib/runtime/scholar-workforce-nav";
import { getMyPrimaryWorkforcePosition } from "@/lib/runtime/scholar/workforce-positions.functions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { authUser: data.user };
  },
  component: AuthenticatedLayout,
  pendingComponent: () => <PortalPageSkeleton />,
  errorComponent: AuthenticatedRouteErrorComponent,
});

function AuthenticatedRouteErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <RouteErrorBoundary
      error={error}
      reset={() => {
        reset();
        router.invalidate();
      }}
    />
  );
}

function AuthenticatedLayout() {
  const { profile, superAdmin, school, role, loading, signOut, authUser } = useApp();
  const navigate = useNavigate();
  const getMyPrimaryPosition = useServerFn(getMyPrimaryWorkforcePosition);

  const myPosition = useQuery({
    queryKey: ["my-primary-position", profile?.id, role],
    enabled: !!profile?.id && !!role && role !== "parent" && role !== "student",
    queryFn: async () => {
      return getMyPrimaryPosition({ data: {} });
    },
  });

  // Keep the stored push subscription fresh for users who already opted in.
  useEffect(() => {
    if (!profile?.id) return;
    void refreshPushTokenIfGranted(profile.id);
  }, [profile?.id]);

  if (loading) {
    return <div className="min-h-dvh grid place-items-center text-muted-foreground">Loading…</div>;
  }

  if (!profile && !superAdmin) {
    return (
      <div className="min-h-dvh grid place-items-center px-4">
        <div className="max-w-md uos-card p-8 text-center">
          <h1 className="font-display text-xl font-bold">Account not yet linked</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your sign-in is valid, but your account has not been linked to a school yet. A school
            administrator (or a CoreGrid platform super admin) needs to assign you a role before you
            can open a portal.
          </p>
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth", replace: true });
            }}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const displayName = profile?.full_name ?? superAdmin?.full_name ?? "User";
  const dashHref = role ? scholarWorkspaceHome(role) : "/";
  const memberLabel = role
    ? scholarWorkspaceLabelForMember(
        myPosition.data?.kind_code ?? null,
        scholarWorkspaceLabelForRole(role),
      )
    : "Workspace";
  const experience = resolveMemberWorkspaceExperience({
    hour: new Date().getHours(),
    memberLabel,
  });

  // Workspace-dynamic chrome: the mobile quick-nav is derived from the active
  // runtime's contribution data + the viewer's authorized capabilities — no
  // fixed portal bars, one per installed runtime that declares a portal chrome.
  const scholarPortalKind: RuntimePortalKind | null =
    role === "parent" ? "parent" : role === "student" ? "student" : null;
  const bottomNavSections = scholarPortalKind
    ? resolveWorkspaceNav(ALL_NAV_CONTRIBUTIONS, scholarCapabilitiesForPortal(scholarPortalKind))
    : [];
  const hasBottomNav = hasNavDestinations(bottomNavSections);

  // Sidebar chrome is resolved the same way: installed runtime contributions x the
  // viewer's authorized capabilities (org_admin collapsible groups, flat member workspaces).
  const sidebarSections = role
    ? resolveWorkspaceNav(ALL_NAV_CONTRIBUTIONS, scholarCapabilitiesForRole(role))
    : [];

  return (
    <SidebarProvider>
      <div className="min-h-dvh flex w-full">
        {role && <PortalSidebar sections={sidebarSections} />}
        <MobileSwipeToOpen />
        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden portal-content">
          <AppFramePreview />
          <OfflineBanner />
          <header className="border-b border-border">
            <div className="flex items-center justify-between px-4 py-2 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {role && <SidebarTrigger />}
                <Link to={dashHref} className="flex items-center gap-2 min-w-0">
                  <div className="size-8 rounded-lg uos-tenant-bg grid place-items-center font-bold shrink-0">
                    {(school?.name?.[0] ?? "U") as string}
                  </div>
                  <div className="leading-tight min-w-0">
                    <div className="font-display font-bold text-sm truncate">
                      {school?.name ?? `${PLATFORM_NAME} · ${SCHOLAR_RUNTIME_NAME}`}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {experience.roleTitle}
                    </div>
                  </div>
                </Link>
                <WorkspaceSwitcher
                  options={school ? [{ id: school.id, label: school.name ?? "Workspace" }] : []}
                  currentId={school?.id ?? null}
                />
              </div>
              <div className="flex items-center gap-2 text-sm sm:gap-3">
                <ShellHeaderActions
                  displayName={displayName}
                  roleTitle={experience.roleTitle}
                  greeting={experience.greeting}
                  workspaceName={school?.name ?? null}
                  notificationViewer={
                    school && authUser
                      ? { tenantId: school.id, recipientId: authUser.id }
                      : null
                  }
                  onSignOut={async () => {
                    await signOut();
                    navigate({ to: "/auth", replace: true });
                  }}
                />
              </div>
            </div>
          </header>
          <main
            id="main-content"
            className={`flex-1 min-w-0 overflow-x-hidden ${hasBottomNav ? "pb-20 lg:pb-0" : ""}`}
          >
            <Outlet />
          </main>
        </div>
        {hasBottomNav && <WorkspaceBottomNav sections={bottomNavSections} />}

        <CommandCenterMount />
      </div>
    </SidebarProvider>
  );
}
