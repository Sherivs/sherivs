/**
 * CoreGrid Mobile — Supabase client factories (mirror the web app's
 * `frontend/src/integrations/supabase/client.ts` conventions, §23).
 *
 * Mirrored conventions:
 * - publishable (anon) key only; no service-role credential ever reaches
 *   the client (§30),
 * - a fetch wrapper that strips a stale `Authorization: Bearer <key>`
 *   header for opaque `sb_publishable_` keys (new-style keys are not JWTs),
 * - persisted session with automatic token refresh.
 *
 * Two clients, one set of conventions:
 * - `createCoreGridSupabaseClient` — typed against the generated web-app
 *   `Database` contract for public web-schema tables.
 * - `createKernelSupabaseClient` — untyped access to the governed `cg_*`
 *   kernel substrate tables, which are intentionally absent from the
 *   generated web schema. Reads through this client are RLS-governed and
 *   every row is Zod-validated fail-closed by the domain clients before a
 *   screen consumes it.
 *
 * Session persistence uses the platform secure store adapter passed by the
 * app layer (iOS Keychain / Android Keystore via expo-secure-store), never
 * ordinary application storage (Phase 22 §O).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CoreGridDatabase } from "@coregrid/contracts";
import type { MobileEnv } from "./contracts/env";

export type CoreGridSupabaseClient = SupabaseClient<CoreGridDatabase>;
export type KernelSupabaseClient = SupabaseClient;

export interface SessionStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

export function createCoreGridSupabaseClient(
  env: MobileEnv,
  storage: SessionStorageAdapter,
): CoreGridSupabaseClient {
  const key = env.supabasePublishableKey;
  return createClient<CoreGridDatabase>(env.supabaseUrl, key, {
    global: {
      fetch: createSupabaseFetch(key),
    },
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

export function createKernelSupabaseClient(
  env: MobileEnv,
  storage: SessionStorageAdapter,
): KernelSupabaseClient {
  const key = env.supabasePublishableKey;
  return createClient(env.supabaseUrl, key, {
    global: {
      fetch: createSupabaseFetch(key),
    },
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}