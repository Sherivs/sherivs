/**
 * CoreGrid Mobile — session + tenant context (Phase 22 §L: session and
 * tenant state are distinct domains and are never mixed with server-state
 * caches). Mirrors the web app's bootstrap: restore session, subscribe to
 * auth changes, resolve the actor (and the RLS-resolved organization) from
 * the authenticated identity.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { CoreGridSupabaseClient } from "@/api/client";
import { getAccessToken, getSession, resolveActor, signOut as signOutRequest, type CoreGridSession } from "@/api/auth.client";
import type { MobileEnv } from "@/api/contracts/env";
import type { Organization, ResolvedActor } from "@/api/contracts/profile-contracts";
import { mobileEnv, supabase } from "@/lib/app-runtime";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

export interface SessionContextValue {
  readonly status: SessionStatus;
  readonly session: CoreGridSession | null;
  readonly actor: ResolvedActor | null;
  readonly activeOrganization: Organization | null;
  readonly env: MobileEnv;
  readonly client: CoreGridSupabaseClient;
  setActiveOrganization(organization: Organization | null): void;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [actor, setActor] = useState<ResolvedActor | null>(null);
  const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const restored = await getSession(supabase);
      setSession(restored);
      if (restored) {
        const resolved = await resolveActor(supabase, restored.user.id);
        setActor(resolved);
        setActiveOrganization(resolved.kind === "user" ? resolved.organization : null);
        setStatus("signedIn");
      } else {
        setActor(null);
        setActiveOrganization(null);
        setStatus("signedOut");
      }
    } catch {
      setSession(null);
      setActor(null);
      setActiveOrganization(null);
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    void loadSession();
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        setActor(null);
        setActiveOrganization(null);
        setStatus("signedOut");
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setSession(nextSession);
        if (nextSession) {
          void resolveActor(supabase, nextSession.user.id)
            .then((resolved) => {
              setActor(resolved);
              setActiveOrganization(resolved.kind === "user" ? resolved.organization : null);
              setStatus("signedIn");
            })
            .catch(() => setStatus("signedOut"));
        }
      }
    });
    return () => data.subscription.unsubscribe();
  }, [loadSession]);

  const signOut = useCallback(async () => {
    await signOutRequest(supabase);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      actor,
      activeOrganization,
      env: mobileEnv,
      client: supabase,
      setActiveOrganization,
      refresh: loadSession,
      signOut,
    }),
    [status, session, actor, activeOrganization, loadSession, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

export async function currentAccessToken(client: CoreGridSupabaseClient): Promise<string | null> {
  return getAccessToken(client);
}