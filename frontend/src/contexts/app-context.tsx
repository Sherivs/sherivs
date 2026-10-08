import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { resolveTenantDomain, resolveTenantSlug } from "@/lib/tenant";
import { type AppRole } from "@/lib/roles";
import { runtimeWorkspaceHome } from "@/lib/runtime/nav-registry";

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

type AppState = {
  loading: boolean;
  session: Session | null;
  authUser: User | null;
  profile: UserProfile | null;
  superAdmin: SuperAdminProfile | null;
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
  if (school?.primary_color) root.style.setProperty("--tenant-primary", school.primary_color);
  else root.style.removeProperty("--tenant-primary");
  if (school?.secondary_color) root.style.setProperty("--tenant-secondary", school.secondary_color);
  else root.style.removeProperty("--tenant-secondary");
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [superAdmin, setSuperAdmin] = useState<SuperAdminProfile | null>(null);
  const [school, setSchool] = useState<SchoolRow | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(currentSession: Session | null) {
    setLoading(true);
    const slug = resolveTenantSlug();
    setTenantSlug(slug);

    let nextProfile: UserProfile | null = null;
    let nextSuperAdmin: SuperAdminProfile | null = null;
    let nextSchool: SchoolRow | null = null;

    if (currentSession?.user) {
      // Try tenant profile first
      const { data: prof } = await supabase
        .from("users")
        .select("*")
        .eq("id", currentSession.user.id)
        .maybeSingle();

      if (prof) {
        nextProfile = prof as UserProfile;
        const { data: sch } = await supabase
          .from("schools")
          .select("*")
          .eq("id", prof.school_id)
          .maybeSingle();
        if (sch) nextSchool = sch as SchoolRow;
      } else {
        const { data: sa } = await supabase
          .from("super_admins")
          .select("id, full_name, email")
          .eq("id", currentSession.user.id)
          .maybeSingle();
        if (sa) nextSuperAdmin = sa as SuperAdminProfile;
      }
    }

    // Public-site lookup by slug (anyone, signed in or not)
    if (!nextSchool && slug) {
      const { data: sch } = await supabase
        .from("schools")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();
      if (sch) nextSchool = sch as SchoolRow;
    }

    // Plane B: custom-domain lookup — an organization's own registered
    // domain (schools.domain) serves its public site when the visitor
    // lands on it. Subdomain and platform hosts never reach this branch.
    const tenantDomain = resolveTenantDomain();
    if (!nextSchool && !slug && tenantDomain) {
      const { data: sch } = await supabase
        .from("schools")
        .select("*")
        .eq("domain", tenantDomain)
        .eq("is_active", true)
        .maybeSingle();
      if (sch) nextSchool = sch as SchoolRow;
    }

    setProfile(nextProfile);
    setSuperAdmin(nextSuperAdmin);
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
