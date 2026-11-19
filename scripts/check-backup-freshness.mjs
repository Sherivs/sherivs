#!/usr/bin/env node
/**
 * Sherivs backup freshness check (mission M23, ADR-110).
 *
 * Asks the GitHub REST API for the newest SUCCESSFUL run of the `nightly-db-backup` workflow
 * (.github/workflows/nightly-db-backup.yml) and FAILS when:
 *   - there is no successful run at all;
 *   - the newest successful run finished more than 26 hours ago;
 *   - that run has no unexpired backup artifact (name starting `sherivs-prod-db-`).
 *
 * It reads run metadata and artifact metadata only. It never downloads an artifact, never reads
 * a secret value and never prints the token. The off-site R2 copy is not checked here (the
 * backup workflow verifies the R2 object size itself); this check proves the nightly job ran and
 * produced its artifact.
 *
 * Environment:
 *   GITHUB_TOKEN or GH_TOKEN  a token with `actions: read` on the repository (never printed).
 *   GITHUB_REPOSITORY         owner/repo (default Sherivs/sherivs).
 *   GITHUB_API_URL            API base (default https://api.github.com).
 * Without a token it prints STATUS=BLOCKED and exits 2: it never guesses freshness.
 *
 * Usage: node scripts/check-backup-freshness.mjs [--max-age-hours 26] [--json]
 * Exit codes: 0 PASS · 1 FAIL · 2 BLOCKED (no token, or the API could not be read).
 */
import { pathToFileURL } from "node:url";

export const BACKUP_WORKFLOW_FILE = "nightly-db-backup.yml";
export const BACKUP_ARTIFACT_PREFIX = "sherivs-prod-db-";
export const MAX_AGE_HOURS = 26;
const HOUR_MS = 3_600_000;

/**
 * Pure decision over the two API responses. `runs` is the body of
 * GET /repos/{repo}/actions/workflows/{file}/runs?status=success; `artifacts` is the body of
 * GET /repos/{repo}/actions/runs/{id}/artifacts for the newest run (or null when not fetched).
 */
export function newestSuccessfulRun(runs) {
  const list = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs : [];
  return (
    list
      .filter((run) => run && run.conclusion === "success" && run.status === "completed")
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] ?? null
  );
}

export function evaluateFreshness({ runs, artifacts, nowMs, maxAgeHours = MAX_AGE_HOURS }) {
  const newest = newestSuccessfulRun(runs);
  if (!newest) {
    return { ok: false, status: "FAIL", reason: "no successful nightly-db-backup run found" };
  }
  const finishedMs = Date.parse(newest.updated_at);
  if (!Number.isFinite(finishedMs)) {
    return {
      ok: false,
      status: "FAIL",
      reason: "newest successful run has no readable finish time",
      runId: newest.id,
    };
  }
  const ageHours = (nowMs - finishedMs) / HOUR_MS;
  const base = {
    runId: newest.id,
    runNumber: newest.run_number,
    finishedAt: newest.updated_at,
    ageHours: Math.round(ageHours * 10) / 10,
    maxAgeHours,
  };
  if (ageHours > maxAgeHours) {
    return {
      ...base,
      ok: false,
      status: "FAIL",
      reason: `newest successful backup is ${base.ageHours} h old (limit ${maxAgeHours} h)`,
    };
  }
  const artifactList = Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : [];
  const backupArtifacts = artifactList.filter(
    (artifact) =>
      artifact &&
      typeof artifact.name === "string" &&
      artifact.name.startsWith(BACKUP_ARTIFACT_PREFIX) &&
      artifact.expired !== true &&
      Number(artifact.size_in_bytes) > 0,
  );
  if (backupArtifacts.length === 0) {
    return {
      ...base,
      ok: false,
      status: "FAIL",
      reason: "newest successful backup run has no unexpired, non-empty backup artifact",
    };
  }
  return {
    ...base,
    ok: true,
    status: "PASS",
    reason: "fresh",
    artifact: {
      name: backupArtifacts[0].name,
      sizeBytes: Number(backupArtifacts[0].size_in_bytes),
    },
  };
}

/** Read the token from the environment; the value is returned to the caller and never printed. */
export function tokenFrom(env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || "";
  return token.trim().length > 0 ? token.trim() : null;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Fetch both API responses. `fetchImpl` is injectable so tests never touch the network. */
export async function fetchBackupState({
  fetchImpl,
  token,
  repo,
  apiUrl = "https://api.github.com",
}) {
  if (!REPO_PATTERN.test(repo)) throw new Error("GITHUB_REPOSITORY must look like owner/repo");
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sherivs-backup-freshness",
  };
  const get = async (path) => {
    const response = await fetchImpl(`${apiUrl}${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub API answered HTTP ${response.status} for ${path}`);
    return response.json();
  };
  const runs = await get(
    `/repos/${repo}/actions/workflows/${BACKUP_WORKFLOW_FILE}/runs?status=success&per_page=10`,
  );
  const newest = newestSuccessfulRun(runs);
  const runId = Number(newest?.id);
  const artifacts = Number.isSafeInteger(runId)
    ? await get(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`)
    : null;
  return { runs, artifacts };
}

export async function run({ env, argv, fetchImpl, nowMs, log }) {
  const token = tokenFrom(env);
  if (!token) {
    log(
      "STATUS=BLOCKED no GITHUB_TOKEN or GH_TOKEN in the environment; backup freshness was not checked",
    );
    return 2;
  }
  const index = argv.indexOf("--max-age-hours");
  const maxAgeHours = index >= 0 ? Number(argv[index + 1]) : MAX_AGE_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    log("STATUS=BLOCKED --max-age-hours must be a positive number");
    return 2;
  }
  const repo = env.GITHUB_REPOSITORY || "Sherivs/sherivs";
  let state;
  try {
    state = await fetchBackupState({
      fetchImpl,
      token,
      repo,
      apiUrl: env.GITHUB_API_URL || undefined,
    });
  } catch (err) {
    // The message names only the API path and HTTP status; the token is never part of it.
    log(
      `STATUS=BLOCKED could not read the GitHub API: ${err instanceof Error ? err.message : "unknown error"}`,
    );
    return 2;
  }
  const result = evaluateFreshness({ ...state, nowMs, maxAgeHours });
  if (argv.includes("--json")) {
    log(JSON.stringify(result));
  } else {
    log(`backup freshness: ${result.reason}`);
    if (result.runId !== undefined)
      log(
        `newest successful run: #${result.runNumber} (id ${result.runId}) finished ${result.finishedAt}`,
      );
    if (result.artifact)
      log(`artifact: ${result.artifact.name} (${result.artifact.sizeBytes} bytes)`);
    log(`STATUS=${result.status}`);
  }
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run({
    env: process.env,
    argv: process.argv.slice(2),
    fetchImpl: globalThis.fetch,
    nowMs: Date.now(),
    log: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
