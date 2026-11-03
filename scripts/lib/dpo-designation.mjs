import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = new URL("../../", import.meta.url);
const designationPath = new URL("../../config/dpo-designation.json", import.meta.url);
const startMarker = "<!-- DPO DESIGNATION START -->";
const endMarker = "<!-- DPO DESIGNATION END -->";

export function renderDpoDesignation(designation, asOf = new Date()) {
  const isExpired = asOf.toISOString().slice(0, 10) > designation.effective_until;
  const appointmentType = designation.is_interim ? "Interim appointment" : "Appointment";
  const status = isExpired
    ? "**Status: EXPIRED — appointment update required.**"
    : "**Status: Active.**";

  return `**${designation.name}** — ${designation.title}, ${designation.organisation}. ${appointmentType} effective ${designation.effective_from} through ${designation.effective_until}. ${status} Contact routing is supplied at runtime and is not stored in this repository.`;
}

export function renderDpoOverview(document, designation, asOf = new Date()) {
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);
  if (start < 0 || end < start) {
    throw new Error("DPO designation markers are missing or out of order.");
  }

  return `${document.slice(0, start + startMarker.length)}\n${renderDpoDesignation(
    designation,
    asOf,
  )}\n${document.slice(end)}`;
}

export function updateDpoOverview({ cwd = repositoryRoot, asOf = new Date() } = {}) {
  const designation = JSON.parse(readFileSync(designationPath, "utf8"));
  const overviewPath = new URL("docs/compliance/ndpa-overview.md", cwd);
  const document = readFileSync(overviewPath, "utf8");
  writeFileSync(overviewPath, renderDpoOverview(document, designation, asOf));
}

if (process.argv[1] === scriptPath) {
  updateDpoOverview();
}
