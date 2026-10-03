import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import {
  cleanupLegacyFixture,
  provisionLegacyFixture,
  schoolMediaBucketExists,
  signIn,
  FIXTURE_SKIP_NO_BACKEND,
  type FixtureTenant,
} from "./helpers";

// 1x1 red PNG
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Gallery upload → public site", () => {
  let fixture: FixtureTenant | null = null;

  test.beforeAll(async () => {
    fixture = await provisionLegacyFixture();
  });
  test.afterAll(async () => {
    await cleanupLegacyFixture(fixture);
    fixture = null;
  });

  test("uploads image, stores in school-media bucket, renders on public gallery", async ({
    page,
    context,
  }) => {
    test.skip(!fixture, FIXTURE_SKIP_NO_BACKEND);
    // External infrastructure dependency (probed, not assumed): the upload
    // journey requires the school-media storage bucket to exist on the
    // configured backend. e2e may not create infrastructure (bucket creation
    // is operator work, not a test-fixture write), so an absent bucket is a
    // typed skip, never a faked pass.
    const bucketReady = await schoolMediaBucketExists();
    test.skip(
      bucketReady === false,
      "SKIP: the school-media storage bucket is not provisioned on the configured Supabase backend (storage.listBuckets() has no 'school-media'); the gallery upload journey cannot run and e2e must not create the bucket itself. Remediation: apply the declarative provisioning migration database/supabase/migrations/20261003000040_coregrid_school_media_bucket.sql (coordinator canonical apply).",
    );
    test.skip(
      bucketReady === null,
      "SKIP: the storage bucket probe could not run (backend not configured or storage.listBuckets failed) — the gallery upload journey is skipped rather than faked.",
    );
    const tmpFile = path.join(test.info().outputDir, `gallery-${Date.now()}.png`);
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    fs.writeFileSync(tmpFile, PNG_1x1);

    await signIn(page, fixture!.credentials.admin);

    // Watch the storage upload request to verify the correct bucket.
    const uploadReq = page.waitForRequest(
      (r) => r.url().includes("/storage/v1/object/school-media/") && r.method() === "POST",
      { timeout: 30_000 },
    );

    await page.goto("/admin/cms");
    // The CMS renders a tab strip on desktop and a <select> on mobile (the
    // mobile-chromium project); drive whichever surface is present.
    const galleryTab = page.getByRole("tab", { name: /gallery/i });
    const cmsSelect = page.locator("select:has(option:has-text('Gallery'))").first();
    if (await galleryTab.isVisible().catch(() => false)) {
      await galleryTab.click();
    } else {
      await cmsSelect.selectOption({ label: "Gallery" });
    }
    await page
      .getByRole("button", { name: /add|new/i })
      .first()
      .click();

    // File input is hidden inside the "Upload image" label.
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles(tmpFile);

    const req = await uploadReq;
    expect(req.url()).toContain("/storage/v1/object/school-media/");

    // Preview img appears with the signed URL.
    const preview = dialog.locator('img[alt="preview"]');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    const previewSrc = await preview.getAttribute("src");
    expect(previewSrc).toBeTruthy();
    expect(previewSrc!).toContain("school-media");

    // Verify the signed URL actually returns an image.
    const head = await page.request.get(previewSrc!);
    expect(head.ok(), `signed url status ${head.status()}`).toBe(true);
    expect(head.headers()["content-type"] || "").toMatch(/^image\//);

    const title = `E2E Gallery ${Date.now()}`;
    await dialog.getByLabel(/^title$/i).fill(title);
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Row visible in the admin table.
    await expect(page.getByText(title)).toBeVisible();

    // Visit public site and confirm the image is rendered in the gallery grid.
    const pub = await context.newPage();
    await pub.goto(`/?school=${fixture!.slug}#gallery`);
    const galleryImg = pub
      .locator("section#gallery img[alt]")
      .filter({ has: pub.locator("xpath=.") })
      .first();
    await galleryImg.scrollIntoViewIfNeeded();
    await expect(galleryImg).toBeVisible({ timeout: 15_000 });
    const natural = await galleryImg.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(natural, "gallery image loaded").toBeGreaterThan(0);

    // "Detail view" = click the image; ensure no error boundary appears.
    await galleryImg.click().catch(() => {});
    await expect(pub.locator("text=/something went wrong/i")).toHaveCount(0);
    await pub.close();
  });
});