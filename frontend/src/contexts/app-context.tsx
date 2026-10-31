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
import { ORGANIZATION_ACCESS_DENIED } from "@/lib/auth/organization-access";
import { currentEffectiveHostKind } from "@/lib/experience/console-host-routing";
import {
  consoleVisualFixtureActive,
  consoleVisualFixtureEnabled,
  deactivateConsoleVisualFixture,
  readSelectedFixturePersona,
  type ConsoleFixturePersona,
} from "@/lib/internal-console/visual-fixture";

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
function fixtureSession(persona: ConsoleFixturePersona): Session {
  const user = {
    id: persona.id,
    email: persona.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: persona.name },
    created_at: "2026-10-27T00:00:00.000Z",
  } as User;
  return {
    access_token: "local-fixture",
    refresh_token: "local-fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4102444800,
    user,
  };
}

function fixtureWorkforce(persona: ConsoleFixturePersona): {
  superAdmin: SuperAdminProfile | null;
  platformStaff: PlatformStaffProfile | null;
} {
  if (persona.isSuperAdmin) {
    return {
      superAdmin: { id: persona.id, full_name: persona.name, email: persona.email },
      platformStaff: null,
    };
  }
  return {
    superAdmin: null,
    platformStaff: {
      id: persona.id,
      full_name: persona.name,
      email: persona.email,
      status: "active",
      roles: [...persona.roles],
    },
  };
}

const IDENTITY_LOAD_MS = 12_000;
const SESSION_LOAD_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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

async function loadWorkforce(userId: string): Promise<{
  superAdmin: SuperAdminProfile | null;
  platformStaff: PlatformStaffProfile | null;
}> {
  const [{ data: sa }, platformStaff] = await Promise.all([
    supabase
      .from("super_admins")
      .select("id, full_name, email, is_active")
      .eq("id", userId)
      .maybeSingle(),
    loadPlatformStaff(userId),
  ]);
  const row = sa as (SuperAdminProfile & { is_active?: boolean | null }) | null;
  const superAdmin =
    row && row.is_active !== false
      ? { id: row.id, full_name: row.full_name, email: row.email }
      : null;
  return { superAdmin, platformStaff };
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
    if (consoleVisualFixtureActive()) {
      const persona = readSelectedFixturePersona();
      const workforce = fixtureWorkforce(persona);
      setSession(fixtureSession(persona));
      setProfile(null);
      setSuperAdmin(workforce.superAdmin);
      setPlatformStaff(workforce.platformStaff);
      setSchool(null);
      setTenantSlug(null);
      setLoading(false);
      return;
    }
    const consoleHost = currentEffectiveHostKind() === "internal";
    const slug = consoleHost ? null : resolveTenantSlug();
    setTenantSlug(slug);

    let nextProfile: UserProfile | null = null;
    let nextSuperAdmin: SuperAdminProfile | null = null;
    let nextPlatformStaff: PlatformStaffProfile | null = null;
    let nextSchool: SchoolRow | null = null;

    try {
      if (currentSession?.user) {
        const userId = currentSession.user.id;
        // Workforce identity is independent of a tenant membership row. A
        // platform owner who also has an organization profile must still
        // resolve as a console operator.
        const [profRow, workforce] = await withTimeout(
          Promise.all([
            supabase.from("users").select(USER_SAFE_COLUMNS).eq("id", userId).maybeSingle(),
            loadWorkforce(userId),
          ]),
          IDENTITY_LOAD_MS,
          "identity",
        );
        const prof = profRow.data as unknown as UserProfile | null;
        nextSuperAdmin = workforce.superAdmin;
        nextPlatformStaff = workforce.platformStaff;

        if (prof) {
          const activeMember = (prof as UserProfile & { is_active?: boolean }).is_active !== false;
          if (!activeMember) {
            persistOAuthError(ORGANIZATION_ACCESS_DENIED);
            await supabase.auth.signOut();
            setSession(null);
          } else {
            nextProfile = prof;
            const { data: sch } = await supabase
              .from("schools")
              .select(SCHOOL_CLIENT_COLUMNS)
              .eq("id", prof.school_id)
              .eq("is_active", true)
              .maybeSingle();
            if (sch) nextSchool = sch as unknown as SchoolRow;
            else {
              persistOAuthError(ORGANIZATION_ACCESS_DENIED);
              await supabase.auth.signOut();
              setSession(null);
              nextProfile = null;
            }
          }
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
          nextSchool = null;
        }
      }

      // Console host is not a tenant site — skip school lookups that can stall sign-in.
      if (!consoleHost) {
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
      }
    } catch {
      /* Fail closed on identity errors, but never leave the console on a blank loading gradient. */
    } finally {
      setProfile(nextProfile);
      setSuperAdmin(nextSuperAdmin);
      setPlatformStaff(nextPlatformStaff);
      setSchool(nextSchool);
      applyBrandColors(nextSchool);
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function boot() {
      try {
        if (consoleVisualFixtureActive()) {
          if (!cancelled) await load(null);
          return;
        }
        // Local role simulation: do not wait on Supabase before the operator
        // picks a persona. Production builds never enable this flag.
        if (consoleVisualFixtureEnabled()) {
          if (!cancelled) setLoading(false);
          return;
        }
        const { data } = await withTimeout(supabase.auth.getSession(), SESSION_LOAD_MS, "session");
        if (cancelled) return;
        setSession(data.session);
        await load(data.session);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    try {
      const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
        setSession(sess);
        void load(sess);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    } catch {
      /* Fail closed: identity still resolves from getSession(). */
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
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
      if (consoleVisualFixtureActive()) {
        await load(null);
        return;
      }
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      await load(data.session);
    },
    signOut: async () => {
      const localFixture = consoleVisualFixtureActive();
      deactivateConsoleVisualFixture();
      if (!localFixture) {
        await supabase.auth.signOut();
      }
      setSession(null);
      setProfile(null);
      setSuperAdmin(null);
      setPlatformStaff(null);
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
