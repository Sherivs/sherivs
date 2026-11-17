/**
 * PostHog (EU cloud). posthog-js is loaded and initialised ONLY after
 * analyticsAllowed() — before consent nothing is fetched or sent.
 * No session recording; autocapture limited to clicks/submits on links,
 * buttons and forms, with all text and attributes masked. Users are
 * identified by internal id + role + tenant id only.
 */
import type { PostHog } from "posthog-js";
import {
  vendorTelemetryEnabled,
  type VendorTelemetryInput,
} from "@/lib/observability/vendor-telemetry";

export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

export function readClientVendorEnv(): VendorTelemetryInput {
  return {
    appEnv: import.meta.env.VITE_APP_ENV as string | undefined,
    viteAppEnv: import.meta.env.VITE_APP_ENV as string | undefined,
    vercelEnv: import.meta.env.VITE_VERCEL_ENV as string | undefined,
  };
}

export function posthogConfig(host: string | null | undefined) {
  return {
    api_host: (host ?? "").trim() || DEFAULT_POSTHOG_HOST,
    person_profiles: "identified_only" as const,
    disable_session_recording: true,
    capture_pageview: "history_change" as const,
    capture_pageleave: true,
    respect_dnt: true,
    autocapture: {
      dom_event_allowlist: ["click", "submit"] as ("click" | "submit")[],
      element_allowlist: ["a", "button", "form"] as ("a" | "button" | "form")[],
    },
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_surveys: true,
    enable_heatmaps: false,
    capture_dead_clicks: false,
    disable_web_experiments: true,
    advanced_disable_feature_flags: true,
    session_recording: { maskAllInputs: true },
    sanitize_properties: (props: Record<string, unknown>) => {
      // URLs can carry tokens or emails in the query; keep path only.
      for (const k of ["$current_url", "$referrer", "$pathname"]) {
        const v = props[k];
        if (typeof v === "string") props[k] = v.split("?")[0]?.split("#")[0];
      }
      return props;
    },
  };
}

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

type PosthogModule = { default: { init: (key: string, config: unknown) => void } };

/**
 * Loads posthog-js only when the explicit app environment is staging and a
 * project key is present. Production, development, and unset return null
 * before the SDK is imported.
 */
export async function startPosthog(
  key: string,
  host?: string | null,
  env: VendorTelemetryInput = readClientVendorEnv(),
  load?: () => Promise<PosthogModule>,
): Promise<PostHog | null> {
  if (!vendorTelemetryEnabled(env)) return null;
  if (!key.trim()) return null;
  if (client) {
    client.opt_in_capturing();
    return client;
  }
  if (!loading) {
    const importer = load ?? (() => import("posthog-js") as Promise<PosthogModule>);
    loading = importer()
      .then(({ default: posthog }) => {
        posthog.init(key, posthogConfig(host) as never);
        client = posthog as unknown as PostHog;
        return client;
      })
      .catch(() => null);
  }
  return loading;
}

export function stopPosthog(): void {
  if (!client) return;
  try {
    client.opt_out_capturing();
    client.reset();
  } catch {
    /* ignore */
  }
}

/** Identify by internal id + role + tenant only — never names, emails or phones. */
export function analyticsIdentity(input: {
  id?: string | null;
  role?: string | null;
  tenantId?: string | null;
}) {
  if (!input.id) return null;
  return {
    distinctId: input.id,
    properties: { role: input.role ?? null, tenant_id: input.tenantId ?? null },
  };
}

export function identifyPosthog(input: {
  id?: string | null;
  role?: string | null;
  tenantId?: string | null;
}) {
  const ident = analyticsIdentity(input);
  if (!client || !ident) return;
  client.identify(ident.distinctId, ident.properties);
}

export function capturePosthog(event: string, props?: Record<string, string | number | boolean>) {
  client?.capture(event, props);
}
