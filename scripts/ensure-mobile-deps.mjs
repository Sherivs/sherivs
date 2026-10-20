#!/usr/bin/env node
// tests/unit/mobile-*.test.ts load mobile/tsconfig.json, which extends
// expo/tsconfig.base. Install mobile's locked dependencies when they are absent
// (fresh CI checkout); a no-op when they are already installed.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!existsSync("mobile/node_modules/expo/tsconfig.base.json")) {
  console.log("mobile dependencies missing: npm ci --prefix mobile");
  const r = spawnSync("npm", ["ci", "--prefix", "mobile", "--no-audit", "--no-fund"], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
