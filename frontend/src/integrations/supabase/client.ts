import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { resolvePublicSupabaseConfig } from "./public-config";
import { createAuthStorage } from "@/lib/auth/remember-session";

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

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function createSupabaseClient() {
  let resolved;
  try {
    resolved = resolvePublicSupabaseConfig({
      viteUrl: import.meta.env.VITE_SUPABASE_URL,
      viteKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      serverUrl: typeof window === "undefined" ? process.env.SUPABASE_URL : undefined,
      serverKey: typeof window === "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined,
      isBrowser: typeof window !== "undefined",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(resolved.url, resolved.publishableKey, {
    global: {
      fetch: createSupabaseFetch(resolved.publishableKey),
    },
    auth: {
      storage:
        typeof window !== "undefined"
          ? createAuthStorage({ local: window.localStorage, session: window.sessionStorage })
          : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
