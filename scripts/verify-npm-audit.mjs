#!/usr/bin/env node
// CI npm audit gate: `npm audit --omit=dev` with dated, approved exceptions from
// config/npm-audit-exceptions.json. Any other high or critical advisory fails.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { evaluateAudit } from "./lib/npm-audit-gate.mjs";

const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
let report = null;
try {
  report = JSON.parse(run.stdout);
} catch {
  report = null;
}
const config = JSON.parse(
  readFileSync(new URL("../config/npm-audit-exceptions.json", import.meta.url), "utf8"),
);
const result = evaluateAudit(report, config);
for (const id of result.excepted)
  console.log(`npm-audit: EXCEPTED ${id} (see config/npm-audit-exceptions.json)`);
for (const b of result.blocking) console.error(`npm-audit: BLOCKING ${b}`);
for (const p of result.problems) console.error(`npm-audit: PROBLEM ${p}`);
console.log(`npm-audit: STATUS=${result.ok ? "PASS" : "FAIL"}`);
process.exit(result.ok ? 0 : 1);
