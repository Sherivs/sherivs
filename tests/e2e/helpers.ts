import { type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

/**
 * Legacy e2e credential law (team R1 remediation — V1-008 Known Risk 2).
 *
 * Credentials come from exactly two places, never a source constant:
 *
 * (a) PER-RUN FIXTURE — a throwaway tenant provisioned through the REAL
 *     auth-admin API (service-role createUser with email_confirm, the same
 *     path the onboarding engine uses; see tests/e2e/v1-vertical-slice.spec.ts
 *     beforeAll) plus the same schools/users rows the engine writes. Every
 *     email/password is run-generated, held in process memory, never printed.
 *     `cleanupLegacyFixture` removes every row/auth user the run created.
 *
 * (b) ENV-VAR IDENTITY — for identities e2e must never fabricate (super
 *     admins) or a genuinely pinned pre-existing tenant: `E2E_<PREFIX>_EMAIL`
 *     / `E2E_<PREFIX>_PASSWORD` (e.g. E2E_SUPER_ADMIN_EMAIL…, or
 *     E2E_DEMO_ADMIN_EMAIL… if a spec ever truly needs the demo tenant).
 *     Absent env vars ⇒ the case SKIPs with a typed reason naming the missing
 *     external dependency. A skip is PASS-grade; a faked pass is not.
 *
 * The "sign in as enterprise demo" button is BANNED from e2e: every invocation
 * rotates the demo tenant's account credentials and rewrites the demo school
 * row (frontend/src/lib/runtime/scholar/demo-provision.functions.ts) — tests
 * must never mutate the demo tenant. No password may ever be hard-coded again.
 */

/* ── Environment (names read; values never printed/logged) ────────────── */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const fixtureCapable = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SERVICE_ROLE_KEY);

export const FIXTURE_SKIP_NO_BACKEND =
  "SKIP: the per-run tenant fixture requires SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) + SUPABASE_SERVICE_ROLE_KEY in the environment so the tenant can be created through the REAL auth-admin API (service-role createUser) and fully removed afterwards; with no configured backend the journey cannot run against a fake backend.";

const FIXTURE_SKIP_UNREACHABLE =
  "SKIP: the configured Supabase auth backend is unreachable from this environment (auth/v1/health probe failed); the per-run fixture cannot be provisioned.";

const FIXTURE_SKIP_PROVISION_FAILED =
  "SKIP: per-run fixture provisioning through the real auth-admin API failed (details in the run log above) — an external backend problem, reported rather than faked.";

/* ── Run-scoped identity generation (memory only; never logged) ───────── */

const RUN_TAG = "r1legacy";
const runId = randomBytes(5).toString("hex");

function uniqueEmail(localPart: string): string {
  return `${RUN_TAG}-${runId}-${localPart}@${RUN_TAG}.dev`;
}

function uniquePassword(): string {
  return randomBytes(18).toString("base64url") + "aA1!";
}

/* ── Per-run fixture tenant (real auth-admin provisioning) ────────────── */

export const LEGACY_ROLES = [
  "admin",
  "principal",
  "teacher",
  "parent",
  "student",
  "bursar",
  "hq",
  "driver",
] as const;

export type LegacyRole = (typeof LEGACY_ROLES)[number];

export interface FixtureCredentials {
  email: string;
  password: string;
}

export interface FixtureTenant {
  schoolId: string;
  schoolName: string;
  slug: string;
  credentials: Record<LegacyRole, FixtureCredentials>;
  authUserIds: string[];
}

function serviceRoleClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function backendReachable(): Promise<boolean> {
  if (!fixtureCapable) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: PUBLISHABLE_KEY },
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

let fixturePromise: Promise<FixtureTenant | null> | null = null;

/**
 * Provisions (once per worker) a throwaway tenant through the REAL auth-admin
 * API and resolves to it, or to null when the external backend dependency is
 * missing/unwilling (callers then SKIP with a typed reason). Provisioning
 * failures are logged loudly, never swallowed silently.
 */
export function provisionLegacyFixture(): Promise<FixtureTenant | null> {
  fixturePromise ??= provisionLegacyTenant();
  return fixturePromise;
}

async function provisionLegacyTenant(): Promise<FixtureTenant | null> {
  if (!fixtureCapable) return null;
  if (!(await backendReachable())) {
    console.log(FIXTURE_SKIP_UNREACHABLE);
    return null;
  }

  try {
    const admin = serviceRoleClient();
    const schoolName = `R1 Legacy Fixture School ${runId}`;
    const slug = `${RUN_TAG}-fixture-${runId}`;

    const school = await admin
      .from("schools")
      .insert({ name: schoolName, slug, subscription_tier: "enterprise" })
      .select("id")
      .single();
    if (school.error || !school.data) {
      throw new Error(`fixture school insert failed: ${school.error?.message ?? "no id"}`);
    }
    const schoolId = String(school.data.id);

    const credentials = {} as Record<LegacyRole, FixtureCredentials>;
    const authUserIds: string[] = [];
    for (const role of LEGACY_ROLES) {
      const email = uniqueEmail(role);
      const password = uniquePassword();
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(
          `fixture auth user (${role}) creation failed: ${created.error?.message ?? "no id"}`,
        );
      }
      const userId = created.data.user.id;
      authUserIds.push(userId);
      const user = await admin.from("users").insert({
        id: userId,
        school_id: schoolId,
        full_name: `R1 E2E ${role}`,
        email,
        role,
      });
      if (user.error) {
        throw new Error(`fixture users row (${role}) insert failed: ${user.error.message}`);
      }
      credentials[role] = { email, password };
    }

    return { schoolId, schoolName, slug, credentials, authUserIds };
  } catch (e) {
    console.log(`legacy fixture provisioning failed: ${e instanceof Error ? e.message : e}`);
    console.log(FIXTURE_SKIP_PROVISION_FAILED);
    return null;
  }
}

/**
 * Removes EVERY row/auth user the fixture run created (service-role deletes —
 * the same cleanup pattern as v1-vertical-slice.spec.ts afterAll). Best-effort
 * per statement; every failure is logged, and a leftover summary is printed.
 */
export async function cleanupLegacyFixture(fixture: FixtureTenant | null): Promise<void> {
  if (!fixture) return;
  fixturePromise = null;

  const failures: string[] = [];
  const step = async (
    label: string,
    run: () => PromiseLike<{ error: { message: string } | null }>,
  ) => {
    const res = await run();
    if (res?.error) failures.push(`${label}: ${res.error.message}`);
  };

  try {
    const admin = serviceRoleClient();

    // Storage objects uploaded under this tenant's school-media prefix.
    const objs = await admin.storage.from("school-media").list(fixture.schoolId, { limit: 1000 });
    if (objs.data && objs.data.length > 0) {
      const paths = objs.data.map((o) => `${fixture.schoolId}/${o.name}`);
      const removed = await admin.storage.from("school-media").remove(paths);
      if (removed.error) failures.push(`storage objects: ${removed.error.message}`);
    } else if (objs.error) {
      failures.push(`storage list: ${objs.error.message}`);
    }

    await step("school_gallery rows", () =>
      admin.from("school_gallery").delete().eq("school_id", fixture.schoolId),
    );
    await step("audit_logs rows", () =>
      admin.from("audit_logs").delete().eq("school_id", fixture.schoolId),
    );
    await step("schools row", () => admin.from("schools").delete().eq("id", fixture.schoolId));

    for (const id of fixture.authUserIds) {
      const del = await admin.auth.admin.deleteUser(id);
      if (del.error) failures.push(`auth user ${id}: ${del.error.message}`);
    }

    // Post-cleanup verification (honesty law: report leftovers, never hide).
    const [{ count: schoolsLeft }, { count: usersLeft }] = await Promise.all([
      admin.from("schools").select("id", { count: "exact", head: true }).eq("id", fixture.schoolId),
      admin
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("school_id", fixture.schoolId),
    ]);
    console.log(
      JSON.stringify({
        cleanup: "r1-legacy-fixture",
        schoolId: fixture.schoolId,
        schoolsLeftover: schoolsLeft ?? "unknown",
        usersLeftover: usersLeft ?? "unknown",
        statementFailures: failures.length,
      }),
    );
    for (const f of failures) console.log(`cleanup failure: ${f}`);
  } catch (e) {
    console.log(`legacy fixture cleanup failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Probes whether the `school-media` storage bucket exists on the configured
 * backend. Returns false when the bucket is absent (an infrastructure gap e2e
 * must NOT fix itself — bucket creation is operator work), and null when the
 * probe itself could not run (no backend configured / listBuckets failed).
 */
export async function schoolMediaBucketExists(): Promise<boolean | null> {
  if (!fixtureCapable) return null;
  try {
    const { data, error } = await serviceRoleClient().storage.listBuckets();
    if (error) return null;
    return data.some((b) => b.name === "school-media");
  } catch {
    return null;
  }
}

/* ── Env-var identities (never hard-coded; skip when absent) ──────────── */

/**
 * Reads `E2E_<PREFIX>_EMAIL` / `E2E_<PREFIX>_PASSWORD` for an identity e2e
 * cannot provision itself (super admins — never fabricated) or a pinned
 * pre-existing tenant (e.g. prefix "DEMO_ADMIN"). Returns null when absent;
 * callers must then SKIP with a typed reason.
 */
export function envCredentials(prefix: string): FixtureCredentials | null {
  const email = process.env[`E2E_${prefix}_EMAIL`] ?? "";
  const password = process.env[`E2E_${prefix}_PASSWORD`] ?? "";
  return email && password ? { email, password } : null;
}

/* ── UI helpers ────────────────────────────────────────────────────────── */

/**
 * Navigates to /auth tolerating a benign race where the client router's own
 * navigation to the same URL interrupts ours (dev-server hydration timing).
 */
async function gotoAuth(page: Page) {
  try {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
  } catch (e) {
    if (!/interrupt/i.test(String(e))) throw e;
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
  }
}

/**
 * Real password sign-in through the /auth surface with EXPLICIT credentials
 * (fixture or env identity). Waits for the role dashboard redirect.
 */
export async function signIn(page: Page, credentials: FixtureCredentials) {
  await gotoAuth(page);
  const signOut = page.getByRole("button", { name: /sign out/i });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await gotoAuth(page);
  }
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Simulate an edge-swipe from the left to open the sidebar. */
export async function edgeSwipeOpen(page: Page) {
  const box = page.viewportSize() ?? { width: 400, height: 800 };
  const y = Math.floor(box.height / 2);
  // The app's gesture hook (use-swipe-sidebar) listens on `document`, so the
  // synthetic TouchEvents must be dispatched there — events dispatched on
  // `window` never reach document-level listeners.
  await page.evaluate(
    ({ y }) => {
      const fire = (type: string, x: number) => {
        const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
        const ev = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === "touchend" ? [] : [t],
          targetTouches: type === "touchend" ? [] : [t],
          changedTouches: [t],
        });
        document.dispatchEvent(ev);
      };
      fire("touchstart", 5);
      fire("touchend", 120);
    },
    { y },
  );
}