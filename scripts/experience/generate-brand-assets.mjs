#!/usr/bin/env node
/**
 * Generates Sherivs raster brand assets (PWA icons, favicon, Open Graph image)
 * from the symbol geometry in frontend/src/components/sherivs/brand-mark.tsx and
 * the dark-theme tokens in frontend/src/lib/sherivs/tokens.ts, by rendering SVG
 * through headless Chrome. Deterministic inputs; no network.
 *
 *   node scripts/experience/generate-brand-assets.mjs
 *
 * Requires a Chrome/Chromium binary (CHROME_BIN, google-chrome or chromium).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INK = "#07090c";
const PAPER = "#eef1f4";
const SIGNAL = "#4cc2ff";

const symbol = (stroke, bar) => `
  <path d="M25 6.5H7.5V16" stroke="${stroke}" stroke-width="3" stroke-linecap="square" fill="none"/>
  <path d="M24.5 16V25.5H7" stroke="${stroke}" stroke-width="3" stroke-linecap="square" fill="none"/>
  <path d="M7.5 16H24.5" stroke="${bar}" stroke-width="3" stroke-linecap="square" fill="none"/>`;

const iconSvg = (size, scale) => {
  const s = (32 * scale) / 1;
  const off = (32 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${INK}"/>
  <g transform="translate(${off} ${off}) scale(${scale})">${symbol(PAPER, SIGNAL)}</g></svg>`;
};

const ogHtml = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;background:${INK};color:${PAPER};font-family:"Geist","Helvetica Neue",Arial,sans-serif}
.wrap{position:relative;width:1200px;height:630px;box-sizing:border-box;padding:72px;display:flex;flex-direction:column;justify-content:space-between;
background-image:linear-gradient(to right,rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.05) 1px,transparent 1px);background-size:64px 64px}
.row{display:flex;align-items:center;gap:20px}
.word{font-weight:600;letter-spacing:.24em;font-size:30px}
h1{margin:0;font-size:84px;line-height:1.02;letter-spacing:-.04em;font-weight:600;max-width:900px}
.cat{font-family:"Geist Mono",ui-monospace,monospace;font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#9aa6b2}
.line{height:2px;width:240px;background:${SIGNAL}}
</style><div class="wrap">
<div class="row"><svg width="56" height="56" viewBox="0 0 32 32">${symbol(PAPER, SIGNAL)}</svg><span class="word">SHERIVS</span></div>
<div><div class="line"></div><h1 style="margin-top:28px">The infrastructure an institution thinks and acts on.</h1></div>
<div class="cat">Institutional Intelligence Infrastructure</div></div>`;

function chrome() {
  for (const bin of [process.env.CHROME_BIN, "google-chrome-stable", "chromium", "chromium-browser", "google-chrome"]) {
    if (!bin) continue;
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      /* try next */
    }
  }
  throw new Error("No Chrome/Chromium binary found; set CHROME_BIN.");
}

function shoot(bin, html, out, w, h) {
  const dir = mkdtempSync(join(tmpdir(), "sherivs-assets-"));
  const file = join(dir, "page.html");
  writeFileSync(file, html);
  execFileSync(
    bin,
    ["--headless=new", `--user-data-dir=${dir}/profile`, "--no-sandbox", "--disable-gpu", "--hide-scrollbars", `--window-size=${w},${h}`, `--screenshot=${out}`, "--default-background-color=00000000", `file://${file}`],
    { stdio: "ignore", timeout: 30_000 },
  );
  rmSync(dir, { recursive: true, force: true });
}

const bin = chrome();
mkdirSync(join(ROOT, "public/icons"), { recursive: true });
const wrap = (svg) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${INK}}svg{display:block}</style>${svg}`;

shoot(bin, wrap(iconSvg(192, 0.62)), join(ROOT, "public/icons/icon-192.png"), 192, 192);
shoot(bin, wrap(iconSvg(512, 0.62)), join(ROOT, "public/icons/icon-512.png"), 512, 512);
// Maskable: the mark stays inside the central 80% safe zone.
shoot(bin, wrap(iconSvg(512, 0.5)), join(ROOT, "public/icons/maskable-512.png"), 512, 512);
shoot(bin, ogHtml, join(ROOT, "public/og-image.png"), 1200, 630);

writeFileSync(
  join(ROOT, "public/favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.a{stroke:#111}.b{stroke:#0b6fa4}@media (prefers-color-scheme:dark){.a{stroke:${PAPER}}.b{stroke:${SIGNAL}}}</style>
<path class="a" d="M25 6.5H7.5V16" stroke-width="3" stroke-linecap="square" fill="none"/>
<path class="a" d="M24.5 16V25.5H7" stroke-width="3" stroke-linecap="square" fill="none"/>
<path class="b" d="M7.5 16H24.5" stroke-width="3" stroke-linecap="square" fill="none"/></svg>\n`,
);
console.log("Sherivs brand assets written to public/.");
