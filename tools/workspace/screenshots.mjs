// Capture UX-lab screens with headless Chromium. Usage: node tools/workspace/screenshots.mjs [baseUrl] [outDir]
import { chromium } from "@playwright/test";
const BASE = process.argv[2] ?? "http://127.0.0.1:5191"; const OUT = process.argv[3] ?? "/tmp/ux-shots";
import fs from "node:fs"; fs.mkdirSync(OUT, { recursive: true });
const shots = [
  ...["proprietor","principal","bursar","registrar","hod","teacher-a","teacher-b","form-teacher","exams","hr","nurse","librarian","hostel","transport","security","parent","student","gov"].map((p) => ({ name: `m-${p}`, q: `p=${p}`, vw: 390, vh: 844 })),
  { name: "d-teacher-a", q: "p=teacher-a", vw: 1366, vh: 900 }, { name: "d-teacher-b", q: "p=teacher-b", vw: 1366, vh: 900 },
  { name: "d-principal", q: "p=principal", vw: 1366, vh: 1000 }, { name: "d-bursar-dark", q: "p=bursar&theme=dark", vw: 1366, vh: 900 },
  { name: "m-parent-ha", q: "p=parent&lang=ha", vw: 390, vh: 844 }, { name: "m-student-yo", q: "p=student&lang=yo", vw: 390, vh: 844 },
  { name: "m-teacher-b-pcm", q: "p=teacher-b&lang=pcm", vw: 390, vh: 844 }, { name: "m-nurse-ig-dark", q: "p=nurse&lang=ig&theme=dark", vw: 390, vh: 844 },
];
const b = await chromium.launch();
for (const s of shots) {
  const pg = await b.newPage({ viewport: { width: s.vw, height: s.vh }, deviceScaleFactor: s.vw < 500 ? 2 : 1 });
  await pg.goto(`${BASE}/ux-lab?${s.q}`, { waitUntil: "load", timeout: 90000 });
  await pg.waitForSelector(".sds-main h1", { timeout: 90000 });
  // the global shell scrolls <body>; let the document grow so fullPage captures the whole screen
  await pg.addStyleTag({ content: "html,body{height:auto!important;overflow:visible!important}" });
  await pg.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: s.vw < 500 });
  await pg.close(); console.log("shot", s.name);
}
// customise mode
const pg = await b.newPage({ viewport: { width: 390, height: 1500 }, deviceScaleFactor: 2 });
await pg.goto(`${BASE}/ux-lab?p=teacher-b`, { waitUntil: "load", timeout: 90000 }); await pg.waitForSelector(".sds-main h1", { timeout: 90000 }); await pg.addStyleTag({ content: "html,body{height:auto!important;overflow:visible!important}" }); await pg.getByRole("button", { name: "Customise" }).click();
await pg.screenshot({ path: `${OUT}/m-teacher-b-customise.png`, fullPage: true }); console.log("shot customise");
await b.close();
