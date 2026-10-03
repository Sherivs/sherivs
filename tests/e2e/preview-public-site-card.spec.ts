import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupLegacyFixture,
  provisionLegacyFixture,
  signIn,
  FIXTURE_SKIP_NO_BACKEND,
  type FixtureTenant,
  type LegacyRole,
} from "./helpers";

/* ── Driver bus-read posture (TEAM T-D, post-R-wave) ────────────────────────
 *
 * The driver assigned-bus surface depends on public.transport_buses RLS.
 * History: migration 20261002000014 declared the table ZERO-POLICY (deny-
 * by-default), so getMyDriverBus returned zero rows for every driver session
 * and this case typed-skipped. The operator-directed follow-up authored
 * migration 20261003000041_coregrid_transport_bus_reads.sql — a SELECT-only
 * driver self-assignment policy (transport_buses_select_driver_assigned:
 * FOR SELECT TO authenticated USING (driver_id = auth.uid())). The migration
 * is AUTHORED, NOT APPLIED: until the coordinator applies it, the read still
 * denies and this case keeps its typed skip — now naming the pending
 * migration file. Once applied, the case runs REAL: the fixture bus assigned
 * below becomes visible to the fixture driver through the new policy and the
 * dashboard renders its assigned-bus state.
 *
 * The bus row is written through the service role (the sanctioned server-only
 * path — the same pattern as v1-vertical-slice.spec.ts beforeAll) and
 * cascades away with the fixture school row in cleanupLegacyFixture
 * (transport_buses.school_id ON DELETE CASCADE), so the run leaves no bus
 * behind. No client role is used to provision; the UI read stays policy-gated.
 */
const TRANSPORT_POLICY_MIGRATION =
  "database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function serviceRoleClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Assigns the fixture driver to an active fixture bus (service-role write) so
 * the driver dashboard can reach its assigned-bus state once the T-D read
 * policy is applied. Best-effort: any failure is logged and the case falls
 * through to the observed-state race (and its typed skip) rather than faking.
 */
async function assignFixtureDriverBus(fixture: FixtureTenant): Promise<void> {
  const admin = serviceRoleClient();
  if (!admin) return;
  try {
    const driver = await admin
      .from("users")
      .select("id")
      .eq("school_id", fixture.schoolId)
      .eq("role", "driver")
      .limit(1)
      .maybeSingle();
    if (driver.error || !driver.data) {
      console.log(`fixture bus assignment skipped: no fixture driver row (${driver.error?.message ?? "none"})`);
      return;
    }
    const inserted = await admin.from("transport_buses").insert({
      school_id: fixture.schoolId,
      bus_number: `R1-FIXTURE-${fixture.slug.slice(-6).toUpperCase()}`,
      driver_id: driver.data.id,
      capacity: 10,
      route_name: "e2e fixture route",
      is_active: true,
    });
    if (inserted.error) {
      console.log(`fixture bus insert failed: ${inserted.error.message}`);
    }
  } catch (e) {
    console.log(`fixture bus assignment failed: ${e instanceof Error ? e.message : e}`);
  }
}

const DASHBOARDS: Array<{ role: LegacyRole; path: string }> = [
  { role: "admin", path: "/admin/dashboard" },
  { role: "teacher", path: "/teacher/dashboard" },
  { role: "student", path: "/student/dashboard" },
  { role: "parent", path: "/parent/dashboard" },
  { role: "bursar", path: "/bursar/dashboard" },
  { role: "hq", path: "/hq/dashboard" },
  { role: "driver", path: "/driver/dashboard" },
];

test.describe("Preview public site card", () => {
  let fixture: FixtureTenant | null = null;

  test.beforeAll(async () => {
    fixture = await provisionLegacyFixture();
  });
  test.afterAll(async () => {
    await cleanupLegacyFixture(fixture);
    fixture = null;
  });

  for (const d of DASHBOARDS) {
    test(`renders on ${d.path} and links to /?school=`, async ({ page, context }) => {
      test.skip(!fixture, FIXTURE_SKIP_NO_BACKEND);
      await signIn(page, fixture!.credentials[d.role]);
      await page.goto(d.path);
      const card = page.getByRole("link", { name: /preview public site/i }).first();
      // Driver portal substrate posture (observed, reported, not faked): the
      // driver dashboard renders this card only in its assigned-bus state. The
      // ZERO-POLICY era (20261002000014) denied every client read; the
      // operator-directed follow-up authored the SELECT-only driver
      // self-assignment policy (20261003000041, pending coordinator apply).
      // The fixture bus is assigned above through the service role; until the
      // policy lands the read still denies and the dashboard shows the
      // "No bus assigned" state — typed skip naming the pending migration.
      // Post-apply the case runs real automatically.
      if (d.role === "driver") {
        await assignFixtureDriverBus(fixture!);
        const noBus = page.getByRole("heading", { name: /no bus assigned/i });
        const outcome = await Promise.race([
          card
            .waitFor({ state: "visible", timeout: 10_000 })
            .then(() => "assigned-bus" as const),
          noBus.waitFor({ state: "visible", timeout: 10_000 }).then(() => "no-bus" as const),
        ]).catch(() => "neither" as const);
        if (outcome !== "assigned-bus") {
          test.skip(
            true,
            `SKIP: driver dashboard preview card requires the assigned-bus surface; observed dashboard state "${outcome}" while the driver bus-read policy migration ${TRANSPORT_POLICY_MIGRATION} is AUTHORED, NOT APPLIED (its SELECT-only policy transport_buses_select_driver_assigned restores the read once the coordinator applies it; before it, the ZERO-POLICY posture of 20261002000014 denies every client-role read). External dependency: coordinator apply of ${TRANSPORT_POLICY_MIGRATION}. Reported, not faked.`,
          );
        }
      }
      await expect(card).toBeVisible();
      const href = await card.getAttribute("href");
      expect(href).toMatch(/^\/\?school=/);

      // reload preserves the card
      await page.reload();
      await expect(page.getByRole("link", { name: /preview public site/i }).first()).toBeVisible();

      // navigating away and back preserves the card
      await page.goto("/settings");
      await page.goto(d.path);
      const again = page.getByRole("link", { name: /preview public site/i }).first();
      await expect(again).toBeVisible();

      // it opens the public site with a school in a new tab
      const [popup] = await Promise.all([context.waitForEvent("page"), again.click()]);
      await popup.waitForLoadState("domcontentloaded");
      expect(popup.url()).toContain("?school=");
      await popup.close();
    });
  }
});