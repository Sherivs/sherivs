import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440] as const;
const SHOTS = new Set([320, 390, 768, 1024, 1440]);

test.use({ deviceScaleFactor: 1, isMobile: false, hasTouch: false });

async function gotoMap(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  const map = page.getByTestId("school-reality-map");
  await map.scrollIntoViewIfNeeded();
  await expect(
    map.getByText("SCHOOL REALITY", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  const nucleus = map.locator(".sherivs-map-nucleus");
  if (await nucleus.isVisible()) await expect(nucleus).toHaveCSS("opacity", "1");
  if ((await map.getAttribute("data-motion")) === "on") await page.waitForTimeout(1300);
  return map;
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function assertLabelsDoNotOverlap(page: Page) {
  const overlaps = await page.evaluate(() => {
    const root = document.querySelector("[data-testid='school-reality-map']");
    if (!root) return ["missing map"];
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-sri-label]")];
    const boxes = nodes
      .map((node) => {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return null;
        if (Number(style.opacity) === 0) return null;
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;
        let parent: HTMLElement | null = node.parentElement;
        while (parent) {
          if (parent.hidden || parent.classList.contains("sr-only")) return null;
          parent = parent.parentElement;
        }
        return { text: (node.textContent ?? "").trim().slice(0, 48), rect };
      })
      .filter((box): box is { text: string; rect: DOMRect } => box !== null);
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (width > 1 && height > 1) hits.push(`${a.text} ∩ ${b.text}`);
      }
    }
    return hits;
  });
  expect(overlaps).toEqual([]);
}

async function assertStrokesAvoidLabels(page: Page) {
  const hits = await page.evaluate(() => {
    const root = document.querySelector("[data-testid='school-reality-map']");
    const svg = root?.querySelector(".sherivs-map-svg");
    if (!root || !svg) return ["missing organism"];
    const labels = [...root.querySelectorAll<SVGTextElement | HTMLElement>("[data-sri-label]")]
      .map((node) => {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return null;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return null;
        return rect;
      })
      .filter((rect): rect is DOMRect => rect !== null);
    const paths = [...svg.querySelectorAll<SVGPathElement>("[data-sri-stroke]")];
    const found: string[] = [];
    for (const path of paths) {
      const length = path.getTotalLength();
      const ctm = path.getScreenCTM();
      if (!ctm || length === 0) continue;
      const step = Math.max(4, length / 40);
      for (let distance = 0; distance <= length; distance += step) {
        const point = path.getPointAtLength(distance);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
        for (const rect of labels) {
          if (
            screen.x > rect.left + 1 &&
            screen.x < rect.right - 1 &&
            screen.y > rect.top + 1 &&
            screen.y < rect.bottom - 1
          ) {
            found.push(
              `${path.getAttribute("data-sri-stroke")} ${path.getAttribute("data-path") ?? ""}`,
            );
            distance = length + 1;
            break;
          }
        }
      }
    }
    return found;
  });
  expect(hits).toEqual([]);
}

test.describe("School Reality Intelligence Map", () => {
  for (const width of WIDTHS) {
    test(`fits at ${width}px without overflow or overlapping labels`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const map = await gotoMap(page, width);
      await assertNoHorizontalOverflow(page);
      await assertLabelsDoNotOverlap(page);
      if (width >= 1024) await assertStrokesAvoidLabels(page);
      await expect(
        page.getByRole("heading", { name: "A school is more than a database." }),
      ).toBeVisible();
      expect(errors, errors.join("\n")).toEqual([]);
      if (SHOTS.has(width)) {
        await page.locator("#school-reality").screenshot({
          path: `/opt/cursor/artifacts/reality-map-v2-${width}.png`,
          style: "header { visibility: hidden !important; }",
        });
      }
    });
  }

  test("expands and collapses a branch from the keyboard", async ({ page }) => {
    await gotoMap(page, 1280);
    const people = page.getByRole("button", { name: /01\s+PEOPLE & RELATIONSHIPS/ });
    await people.focus();
    await expect(people).toBeFocused();
    const outline = await people.evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(people).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: /PEOPLE & RELATIONSHIPS/ })).toBeVisible();
    await expect(
      page.locator("#reality-desktop-detail").getByText("School leadership", { exact: true }),
    ).toBeVisible();
    await assertLabelsDoNotOverlap(page);
    await page.keyboard.press("Enter");
    await expect(people).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: /PEOPLE & RELATIONSHIPS/ })).toBeHidden();
  });

  test("screenshots a highlighted path and the full section", async ({ page }) => {
    await gotoMap(page, 1440);
    const progression = page.getByText(
      "From recording what happened to helping coordinate what happens next.",
    );
    await expect(progression).toBeVisible();
    const clipped = await progression.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      let parent = node.parentElement;
      while (parent) {
        const style = getComputedStyle(parent);
        if (style.overflowY === "hidden" || style.overflow === "hidden") {
          const bounds = parent.getBoundingClientRect();
          if (rect.bottom > bounds.bottom + 1 || rect.right > bounds.right + 1)
            return parent.className;
        }
        parent = parent.parentElement;
      }
      return "";
    });
    expect(clipped).toBe("");
    await page.locator("#school-reality").screenshot({
      path: "/opt/cursor/artifacts/reality-map-v2-1440-full.png",
      style: "header { visibility: hidden !important; }",
    });

    await page.getByRole("button", { name: "Examination", exact: true }).click();
    await expect(page.getByRole("button", { name: "Examination", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await assertStrokesAvoidLabels(page);
    await assertLabelsDoNotOverlap(page);
    await page.locator("#school-reality").screenshot({
      path: "/opt/cursor/artifacts/reality-map-v2-1440-path.png",
      style: "header { visibility: hidden !important; }",
    });

    await gotoMap(page, 390);
    await page.getByRole("button", { name: /02\s+TEACHING & LEARNING/ }).click();
    await expect(
      page.locator("#reality-panel-teaching").getByText("Lesson planning", { exact: true }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertLabelsDoNotOverlap(page);
  });

  test("stays fully visible when the user prefers reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const map = page.getByTestId("school-reality-map");
    await map.scrollIntoViewIfNeeded();
    await expect(
      map.getByText("SCHOOL REALITY", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(map).not.toHaveAttribute("data-motion", "on");
    const motion = await map.locator(".sherivs-map-nucleus").evaluate((node) => {
      const style = getComputedStyle(node);
      return { opacity: style.opacity, animationName: style.animationName };
    });
    expect(motion.opacity).toBe("1");
    expect(motion.animationName).toBe("none");
    await expect(
      page.getByRole("button", { name: /08\s+GOVERNANCE, RECORDS & DECISIONS/ }),
    ).toBeVisible();
  });
});
