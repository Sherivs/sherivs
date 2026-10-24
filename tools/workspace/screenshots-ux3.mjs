// UX3 mobile screens: two differently-scoped sim teachers, rendered from real server output via /ux-lab?replay=.
// Usage: node tools/workspace/screenshots-ux3.mjs [baseUrl] [outDir]
import { chromium } from "@playwright/test";
import fs from "node:fs";
const BASE = process.argv[2] ?? "http://127.0.0.1:5191";
const OUT = process.argv[3] ?? "docs/design/ux3-screens";
fs.mkdirSync(OUT, { recursive: true });
const shots = [
  { name: "m-teacher-x-level-scope", q: "replay=X" },
  { name: "m-teacher-y-campus-shift-scope", q: "replay=Y" },
  { name: "m-teacher-y-focus-afternoon", q: "replay=Y&focus=1" },
  { name: "m-teacher-y-dark", q: "replay=Y&theme=dark" },
];
const b = await chromium.launch();
for (const s of shots) {
  const pg = await b.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await pg.goto(`${BASE}/ux-lab?${s.q}`, { waitUntil: "load", timeout: 90000 });
  await pg.waitForSelector(".sds-main h1", { timeout: 90000 });
  await pg.addStyleTag({
    content:
      "html,body{height:auto!important;overflow:visible!important} .sds-bottom{position:static!important}",
  });
  await pg.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: true });
  await pg.close();
  console.log("shot", `${OUT}/${s.name}.png`);
}
await b.close();
