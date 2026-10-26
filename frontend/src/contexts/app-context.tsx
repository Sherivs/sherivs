import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { USER_SAFE_COLUMNS } from "@/lib/identity/user-private-fields";
import { SCHOOL_CLIENT_COLUMNS } from "@/lib/runtime/scholar/school-columns";
import { resolveTenantDomain, resolveTenantSlug } from "@/lib/tenant";
import { resolveSchoolByHost, schoolDomainLoginAllowed } from "@/lib/domains/school-domains";
import { type AppRole } from "@/lib/roles";
import { runtimeWorkspaceHome } from "@/lib/runtime/nav-registry";
import { customTenantColors } from "@/lib/brand/tenant-colors";
import {
  GOOGLE_UNINVITED_ERROR,
  persistOAuthError,
  shouldRejectUninvitedGooglePrincipal,
} from "@/lib/auth/google-sign-in";

/**
 * UserProfile = row from public.users (tenant member).
 * SuperAdminProfile = row from public.super_admins.
 * A given auth user is one or the other, never both.
 */
export type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  // section toggles + everything else come back as `any` extras
  [k: string]: unknown;
};

export type UserProfile = {
  id: string;
  school_id: string;
  full_name: string;
  email: string | null;
  role: AppRole;
  avatar_url: string | null;
  [k: string]: unknown;
};

export type SuperAdminProfile = {
  id: string;
  full_name: string;
  email: string;
};

/** Active internal Sherivs staff member (public.platform_staff, SHERIVS-008). */
export type PlatformStaffProfile = {
  id: string;
  full_name: string;
  email: string;
  status: string;
  roles: string[];
};

type AppState = {
  loading: boolean;
  session: Session | null;
  authUser: User | null;
  profile: UserProfile | null;
  superAdmin: SuperAdminProfile | null;
  /** Active internal staff (non-super-admin Sherivs workforce), else null. */
  platformStaff: PlatformStaffProfile | null;
  /** The school in scope:
   *   - signed-in tenant user: their own school
   *   - public visitor on a tenant subdomain / ?school=slug: that school
   *   - otherwise: null (platform context)
   */
  school: SchoolRow | null;
  /** True when the URL points at a tenant site (regardless of auth). */
  tenantSlug: string | null;
  role: AppRole | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AppCtx = createContext<AppState | undefined>(undefined);

function applyBrandColors(school: SchoolRow | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const colors = customTenantColors(school?.primary_color, school?.secondary_color);
  if (colors.primary) root.style.setProperty("--tenant-primary", colors.primary);
  else root.style.removeProperty("--tenant-primary");
  if (colors.secondary) root.style.setProperty("--tenant-secondary", colors.secondary);
  else root.style.removeProperty("--tenant-secondary");
}

/**
 * Internal staff: activate an accepted invite (own row only, invited → active;
 * grants nothing), then read the caller's own staff row + roles via RLS.
 * Only ACTIVE staff resolve; any failure resolves to "not staff".
 */
async function loadPlatformStaff(userId: string): Promise<PlatformStaffProfile | null> {
  try {
    await supabase.rpc("claim_platform_staff_invite");
    const { data } = await supabase
      .from("platform_staff")
      .select("id, full_name, email, status, platform_staff_roles(role_code)")
      .eq("id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      full_name: data.full_name,
      email: data.email,
      status: data.status,
      roles: ((data.platform_staff_roles ?? []) as Array<{ role_code: string }>).map(
        (r) => r.role_code,
      ),
    };
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [superAdmin, setSuperAdmin] = useState<SuperAdminProfile | null>(null);
  const [platformStaff, setPlatformStaff] = useState<PlatformStaffProfile | null>(null);
  const [school, setSchool] = useState<SchoolRow | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(currentSession: Session | null) {
    setLoading(true);
    const slug = resolveTenantSlug();
    setTenantSlug(slug);

    let nextProfile: UserProfile | null = null;
    let nextSuperAdmin: SuperAdminProfile | null = null;
    let nextPlatformStaff: PlatformStaffProfile | null = null;
    let nextSchool: SchoolRow | null = null;

    if (currentSession?.user) {
      // Try tenant profile first
      const { data: profRow } = await supabase
        .from("users")
        .select(USER_SAFE_COLUMNS)
        .eq("id", currentSession.user.id)
        .maybeSingle();
      const prof = profRow as unknown as UserProfile | null;

      if (prof) {
        nextProfile = prof;
        const { data: sch } = await supabase
          .from("schools")
          .select(SCHOOL_CLIENT_COLUMNS)
          .eq("id", prof.school_id)
          .maybeSingle();
        if (sch) nextSchool = sch as unknown as SchoolRow;
      } else {
        const { data: sa } = await supabase
          .from("super_admins")
          .select("id, full_name, email")
          .eq("id", currentSession.user.id)
          .maybeSingle();
        if (sa) nextSuperAdmin = sa as SuperAdminProfile;
        else nextPlatformStaff = await loadPlatformStaff(currentSession.user.id);
      }

      // Google OAuth can create an Auth user with no membership. Sign that
      // session out — access is by admin invite, never self-registration.
      if (
        shouldRejectUninvitedGooglePrincipal({
          hasMembership: Boolean(nextProfile || nextSuperAdmin || nextPlatformStaff),
          user: currentSession.user,
        })
      ) {
        persistOAuthError(GOOGLE_UNINVITED_ERROR);
        await supabase.auth.signOut();
        setSession(null);
        nextProfile = null;
        nextSuperAdmin = null;
        nextPlatformStaff = null;
      }
    }

    // Public-site lookup by slug (anyone, signed in or not)
    if (!nextSchool && slug) {
      const { data: sch } = await supabase
        .from("schools")
        .select(SCHOOL_CLIENT_COLUMNS)
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();
      if (sch) nextSchool = sch as unknown as SchoolRow;
    }

    // Plane B: custom-domain lookup — an organization's own registered
    // domain (schools.domain) serves its public site when the visitor
    // lands on it. Subdomain and platform hosts never reach this branch.
    // SHERIVS-029: verified rows in school_domains win; legacy schools.domain is the fallback.
    const tenantDomain = resolveTenantDomain();
    if (tenantDomain && !slug) {
      const resolved = await resolveSchoolByHost(tenantDomain);
      // A session that does not belong to this school's domain is ended here (host-scoped login).
      if (currentSession && resolved && !(await schoolDomainLoginAllowed(tenantDomain))) {
        await supabase.auth.signOut();
        nextProfile = null;
        nextSuperAdmin = null;
        nextPlatformStaff = null;
        nextSchool = null;
      }
      if (resolved && (!nextSchool || nextSchool.id !== resolved.school_id)) {
        const { data: sch } = await supabase
          .from("schools")
          .select(SCHOOL_CLIENT_COLUMNS)
          .eq("id", resolved.school_id)
          .eq("is_active", true)
          .maybeSingle();
        nextSchool = sch ? (sch as unknown as SchoolRow) : null;
      }
    }
    if (!nextSchool && !slug && tenantDomain) {
      const { data: sch } = await supabase
        .from("schools")
        .select(SCHOOL_CLIENT_COLUMNS)
        .eq("domain", tenantDomain)
        .eq("is_active", true)
        .maybeSingle();
      if (sch) nextSchool = sch as unknown as SchoolRow;
    }

    setProfile(nextProfile);
    setSuperAdmin(nextSuperAdmin);
    setPlatformStaff(nextPlatformStaff);
    setSchool(nextSchool);
    applyBrandColors(nextSchool);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      void load(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      setSession(sess);
      void load(sess);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Safe role-change handling: if an admin (or super-admin) changes the
  // signed-in user's role / school / active flag, re-load the profile
  // automatically. The portal-sidebar + RoleGuard re-render against the new
  // role, and the _authenticated/index redirector routes them to the new
  // dashboard on the next navigation.
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`profile-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "users",
          filter: `id=eq.${profile.id}`,
        },
        (payload) => {
          const next = payload.new as Partial<UserProfile> & { is_active?: boolean };
          // Forced sign-out if the account was deactivated
          if (next.is_active === false) {
            void supabase.auth.signOut();
            return;
          }
          // Role or school changed → reload profile and bounce to the right dashboard
          if (next.role !== profile.role || next.school_id !== profile.school_id) {
            void load(session).then(() => {
              if (typeof window !== "undefined" && next.role) {
                window.location.assign(runtimeWorkspaceHome(next.role as AppRole));
              }
            });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role, profile?.school_id]);

  const role: AppRole | null = superAdmin ? "super_admin" : (profile?.role ?? null);

  const value: AppState = {
    loading,
    session,
    authUser: session?.user ?? null,
    profile,
    superAdmin,
    platformStaff,
    school,
    tenantSlug,
    role,
    refresh: async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      await load(data.session);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function useSchool(): SchoolRow | null {
  return useApp().school;
}
