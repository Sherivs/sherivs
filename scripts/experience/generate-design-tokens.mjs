#!/usr/bin/env node
/**
 * Generates frontend/src/design/sherivs-tokens.css from sherivs.tokens.json.
 *
 *   node scripts/experience/generate-design-tokens.mjs           # write
 *   node scripts/experience/generate-design-tokens.mjs --check   # fail if stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(ROOT, "frontend/src/design/sherivs.tokens.json");
const OUT = join(ROOT, "frontend/src/design/sherivs-tokens.css");

const decl = (name, value, indent = "  ") => `${indent}--sv-${name}: ${value};`;
const block = (selectors, entries) =>
  `${selectors.join(",\n")} {\n${entries.join("\n")}\n}\n`;

export function buildCss(tokens) {
  const out = [];
  out.push(
    "/*",
    " * Sherivs design tokens — GENERATED. Do not edit by hand.",
    " * Source: frontend/src/design/sherivs.tokens.json",
    " * Generator: scripts/experience/generate-design-tokens.mjs",
    ` * Version: ${tokens.version}`,
    " */",
    "",
  );

  const rampEntries = [];
  for (const [ramp, steps] of Object.entries(tokens.ramps)) {
    for (const [step, value] of Object.entries(steps)) {
      rampEntries.push(decl(`ramp-${ramp}-${step}`, value));
    }
  }

  const scalarEntries = [];
  for (const [group, values] of Object.entries(tokens.scalars)) {
    for (const [key, value] of Object.entries(values)) {
      scalarEntries.push(decl(`${group}-${key}`, value));
    }
  }
  for (const [key, value] of Object.entries(tokens.densities.comfortable)) {
    scalarEntries.push(decl(`density-${key}`, value));
  }

  const themeEntries = (name) =>
    Object.entries(tokens.themes[name]).map(([key, value]) => decl(key, value));

  out.push(
    "/* Scalars, ramps and the light theme (default) */",
    block(
      [":root", ".light", '[data-sv-theme="light"]'],
      [...rampEntries, ...scalarEntries, ...themeEntries("light")],
    ),
    "/* Dark theme — must follow light so equal-specificity selectors resolve to dark */",
    block([".dark", '[data-sv-theme="dark"]'], themeEntries("dark")),
    "/* System-following scope (opt-in per subtree) */",
    `@media (prefers-color-scheme: dark) {\n${block(
      ['[data-sv-theme="system"]'],
      themeEntries("dark"),
    )}}\n`,
    "/* Density */",
    block(
      ['[data-sv-density="compact"]'],
      Object.entries(tokens.densities.compact).map(([k, v]) => decl(`density-${k}`, v)),
    ),
    "/* High contrast (user preference, explicit attribute) */",
    block(
      [
        ':root:not(.dark)[data-sv-contrast="high"]',
        '.light[data-sv-contrast="high"]',
        '[data-sv-theme="light"][data-sv-contrast="high"]',
      ],
      themeEntries("high-contrast-light"),
    ),
    block(
      ['.dark[data-sv-contrast="high"]', '[data-sv-theme="dark"][data-sv-contrast="high"]'],
      themeEntries("high-contrast-dark"),
    ),
  );

  const colorKeys = Object.keys(tokens.themes.light).filter((k) => !k.startsWith("shadow-"));
  const themeMap = [];
  for (const key of colorKeys) themeMap.push(`  --color-sv-${key}: var(--sv-${key});`);
  for (const key of Object.keys(tokens.themes.light).filter((k) => k.startsWith("shadow-"))) {
    themeMap.push(`  --shadow-sv-${key.replace("shadow-", "")}: var(--sv-${key});`);
  }
  themeMap.push(`  --font-sv-sans: var(--sv-font-sans);`, `  --font-sv-mono: var(--sv-font-mono);`);
  for (const key of Object.keys(tokens.scalars.type)) {
    themeMap.push(`  --text-sv-${key}: var(--sv-type-${key});`);
  }
  for (const key of Object.keys(tokens.scalars.ease)) {
    themeMap.push(`  --ease-sv-${key}: var(--sv-ease-${key});`);
  }
  out.push("/* Tailwind utility bridge: bg-sv-*, text-sv-*, border-sv-*, font-sv-*, shadow-sv-* */");
  out.push(`@theme inline {\n${themeMap.join("\n")}\n}\n`);

  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tokens = JSON.parse(readFileSync(SRC, "utf8"));
  const css = buildCss(tokens);
  if (process.argv.includes("--check")) {
    const current = readFileSync(OUT, "utf8");
    if (current !== css) {
      console.error("sherivs-tokens.css is stale. Run: node scripts/experience/generate-design-tokens.mjs");
      process.exit(1);
    }
    console.log("sherivs-tokens.css is current.");
  } else {
    writeFileSync(OUT, css);
    console.log(`Wrote ${OUT.replace(ROOT, "")}`);
  }
}
