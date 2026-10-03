/**
 * CoreGrid Mobile — environment contract (Phase 22 CC/CD: environment
 * separation, fail-closed configuration loading).
 *
 * Pure module: reads nothing itself; `parseMobileEnv` consumes an injected
 * record so the app passes `process.env` and unit tests pass fixtures.
 * Every variable is an EXPO_PUBLIC_* build-time inlined, non-secret value.
 */
import { z } from "zod";

export const MOBILE_APP_ENVIRONMENTS = ["development", "preview", "production"] as const;
export type MobileAppEnvironment = (typeof MOBILE_APP_ENVIRONMENTS)[number];

export interface MobileEnv {
  readonly appEnv: MobileAppEnvironment;
  /** Supabase project URL (same project as the web app). */
  readonly supabaseUrl: string;
  /** Publishable (anon) key — public by design; authorization stays server-side (RLS). */
  readonly supabasePublishableKey: string;
  /** Base URL of the deployed CoreGrid web app hosting the server functions. */
  readonly coregridWebBaseUrl: string;
  /**
   * TanStack Start server-function ids are build-generated content hashes of
   * the deployed web build. An id may legitimately be absent for an
   * environment; callers fail closed with an explicit configuration error
   * instead of guessing a URL.
   */
  readonly serverFnIds: {
    readonly recordFoundationLoop: string | null;
    readonly listIdentities: string | null;
  };
}

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
    message: "must be an absolute http(s) URL",
  });

const publishableKey = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith("sb_publishable_") || value.startsWith("eyJ"),
    {
      message: "must be a publishable key (sb_publishable_… or legacy anon JWT)",
    },
  );

const serverFnId = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || /^[0-9a-f]{64}$/.test(value), {
    message: "must be empty or a 64-character hex server-function id",
  });

export class MobileEnvError extends Error {
  constructor(message: string) {
    super(`mobile environment contract rejected: ${message}`);
    this.name = "MobileEnvError";
  }
}

type FieldResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

function field<T>(result: z.ZodSafeParseResult<T>): FieldResult<T> {
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues[0]?.message ?? "invalid" };
}

function unwrap<T>(result: FieldResult<T>): T {
  if (!result.ok) throw new MobileEnvError(result.message);
  return result.value;
}

/**
 * Fail-closed environment parsing. A missing or malformed variable throws
 * with the full list of violations — the app never boots half-configured
 * against an unknown backend (§26: never trust unvalidated configuration).
 */
export function parseMobileEnv(source: Record<string, string | undefined>): MobileEnv {
  const failures: string[] = [];

  const rawEnv = source.EXPO_PUBLIC_APP_ENV?.trim();
  const appEnv = MOBILE_APP_ENVIRONMENTS.find((value) => value === rawEnv);
  if (!appEnv) {
    failures.push(`EXPO_PUBLIC_APP_ENV must be one of ${MOBILE_APP_ENVIRONMENTS.join(", ")}`);
  }

  const supabaseUrlField = field(httpUrl.safeParse(source.EXPO_PUBLIC_SUPABASE_URL ?? ""));
  if (!supabaseUrlField.ok) failures.push(`EXPO_PUBLIC_SUPABASE_URL: ${supabaseUrlField.message}`);

  const publishableField = field(publishableKey.safeParse(source.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""));
  if (!publishableField.ok) failures.push(`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${publishableField.message}`);

  const webBaseField = field(httpUrl.safeParse(source.EXPO_PUBLIC_COREGRID_WEB_BASE_URL ?? ""));
  if (!webBaseField.ok) failures.push(`EXPO_PUBLIC_COREGRID_WEB_BASE_URL: ${webBaseField.message}`);

  const fnRecordField = field(serverFnId.safeParse(source.EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP ?? ""));
  if (!fnRecordField.ok) failures.push(`EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP: ${fnRecordField.message}`);

  const fnIdentitiesField = field(serverFnId.safeParse(source.EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES ?? ""));
  if (!fnIdentitiesField.ok) failures.push(`EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES: ${fnIdentitiesField.message}`);

  if (failures.length > 0) throw new MobileEnvError(failures.join("; "));

  return {
    appEnv: appEnv as MobileAppEnvironment,
    supabaseUrl: unwrap(supabaseUrlField),
    supabasePublishableKey: unwrap(publishableField),
    coregridWebBaseUrl: unwrap(webBaseField).replace(/\/+$/, ""),
    serverFnIds: {
      recordFoundationLoop: unwrap(fnRecordField).length > 0 ? unwrap(fnRecordField) : null,
      listIdentities: unwrap(fnIdentitiesField).length > 0 ? unwrap(fnIdentitiesField) : null,
    },
  };
}