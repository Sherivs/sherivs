#!/usr/bin/env node
/**
 * Sherivs — generate brand assets from the Stratum symbol.
 *
 * Writes public/favicon.svg, public/icons/{icon-192,icon-512,maskable-512}.png
 * and public/og-image.png. The symbol geometry mirrors
 * frontend/src/components/sherivs/brand.tsx (four offset plane bars).
 * PNGs are rasterized with Playwright's Chromium; no image dependency is added.
 *
 * Usage: node scripts/experience/generate-brand-assets.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PUBLIC = join(ROOT, "public");
const INK = "#0b1118";
const PLANES = { evidence: "#7fd69a", action: "#e3b04b", intelligence: "#5fd4c4", reality: "#8fa6ba" };
const BARS = [
  { x: 9, y: 3, w: 20, plane: "evidence" },
  { x: 3, y: 10.5, w: 14, plane: "action" },
  { x: 15, y: 18, w: 14, plane: "intelligence" },
  { x: 3, y: 25.5, w: 20, plane: "reality" },
];

const bars = (fills) =>
  BARS.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="3.5" rx="1.25" fill="${fills(b)}"/>`).join("");

const symbolSvg = (fills, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${bg ? `<rect width="32" height="32" rx="7" fill="${bg}"/>` : ""}${bars(fills)}</svg>\n`;

mkdirSync(join(PUBLIC, "icons"), { recursive: true });
writeFileSync(join(PUBLIC, "favicon.svg"), symbolSvg((b) => PLANES[b.plane], INK));

const iconHtml = (size, scale) => `<html><body style="margin:0;background:${INK};width:${size}px;height:${size}px;display:grid;place-items:center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size * scale}" height="${size * scale}">${bars((b) => PLANES[b.plane])}</svg></body></html>`;

const geist = readFileSync(
  join(ROOT, "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
).toString("base64");
const fontFace = `<style>@font-face{font-family:'Geist Variable';font-weight:100 900;src:url(data:font/woff2;base64,${geist}) format('woff2')}</style>`;

const ogHtml = `${fontFace}<html><body style="margin:0;width:1200px;height:630px;background:${INK};color:#e8eef3;font-family:'Geist Variable',system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box">
<div style="display:flex;align-items:center;gap:28px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="120" height="120">${bars((b) => PLANES[b.plane])}</svg><span style="font-size:96px;font-weight:600;letter-spacing:-0.03em">Sherivs</span></div>
<p style="font-size:40px;margin:48px 0 0;color:#9fb0bf;letter-spacing:0.01em">Institutional Intelligence Infrastructure</p></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
async function shot(html, w, h, file) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } });
}
await shot(iconHtml(192, 0.62), 192, 192, join(PUBLIC, "icons", "icon-192.png"));
await shot(iconHtml(512, 0.62), 512, 512, join(PUBLIC, "icons", "icon-512.png"));
await shot(iconHtml(512, 0.46), 512, 512, join(PUBLIC, "icons", "maskable-512.png"));
await shot(ogHtml, 1200, 630, join(PUBLIC, "og-image.png"));
await browser.close();
console.log("brand assets written to public/");
