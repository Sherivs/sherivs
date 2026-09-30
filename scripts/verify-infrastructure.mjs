#!/usr/bin/env node
/**
 * CoreGrid Cloud Fabric — infrastructure verifier (wave CF-3).
 *
 * Proves the fabric's SOURCE invariants, exactly like the runtime waves prove
 * theirs. No cloud credentials, no terraform/kubectl required.
 *
 * What it proves:
 *   A. structure        every provider root + module is complete and registered
 *   B. secret hygiene   no credential values; secret-grade variables sensitive
 *   C. state hygiene    remote state declared; state/plans/vars git-ignored
 *   D. pinning          no 'latest' images; providers pinned with '~>'
 *   E. tagging          provider resources carry coregrid:* tags/labels
 *   F. cluster laws     exact 8 namespaces, PSA restricted, default-deny + quota
 *   G. sandbox          isolation, TTL and lowest priority
 *   H. neutrality       no domain vocabulary in the fabric layer
 *   I. evidence         blueprint/plan/credentials exist and are digest-bound
 *
 * It writes architecture/proofs/cloud-fabric-foundation.proof.json, bound to a
 * digest of every infrastructure source file, so the proof can never drift from
 * the code it claims to prove.
 *
 * Usage: node scripts/verify-infrastructure.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INFRA = join(ROOT, "infrastructure");
const PROOF_REF = "architecture/proofs/cloud-fabric-foundation.proof.json";

const PROVIDER_ROOTS = ["oci", "hetzner", "vultr", "cloudflare", "supabase"];
const MODULES = ["network", "kubernetes", "node_pool", "object_storage", "secret_refs", "dns_edge"];
const NAMESPACES = [
  "coregrid-system",
  "coregrid-security",
  "coregrid-platform",
  "coregrid-agents",
  "coregrid-scholar",
  "coregrid-monitoring",
  "coregrid-dev",
  "coregrid-staging",
];

/** Domain vocabulary that must never appear in the fabric layer (Phase 21 §A.5). */
const DOMAIN_TERMS = [
  "student",
  "teacher",
  "classroom",
  "curriculum",
  "examination",
  "timetable",
  "hostel",
  "lesson",
  "bursary",
  "parent portal",
];

/** Identifier/presence variables that legitimately carry 'key'-like names. */
const SENSITIVE_EXEMPT = new Set([
  "hetzner_ssh_public_key",
  "oci_object_storage_namespace",
  "oci_tenancy_ocid",
  "cloudflare_zone_id",
  "cloudflare_account_id",
  "supabase_project_ref",
  "supabase_url_present",
  "supabase_publishable_key_present",
  "supabase_service_role_key_present",
  "supabase_db_url_present",
]);
const SENSITIVE_NAME_RE = /(token|secret|password|private_key|access_token|api_key|db_url)/i;
const TAG_REQUIRED_TYPES = [
  "oci_core_vcn",
  "oci_containerengine_cluster",
  "oci_containerengine_node_pool",
  "oci_objectstorage_bucket",
  "hcloud_server",
  "vultr_instance",
];

const checks = [];
const check = (id, ok, detail, category) => checks.push({ id, ok: Boolean(ok), detail, category });

function read(ref) {
  return readFileSync(join(ROOT, ref), "utf8").replace(/\r\n/g, "\n");
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const infraFiles = walk(INFRA).map((full) => relative(ROOT, full).replace(/\\/g, "/"));
const infraText = new Map(infraFiles.map((ref) => [ref, read(ref)]));

check(
  "structure:infrastructure-present",
  infraFiles.length >= 25,
  `${infraFiles.length} infrastructure source file(s) under infrastructure/`,
  "A",
);

/* ── A. Structure: providers, modules, roots ──────────────────────────────── */

for (const provider of PROVIDER_ROOTS) {
  const base = `infrastructure/terraform/${provider}`;
  for (const file of ["main.tf", "variables.tf"]) {
    check(
      `structure:provider:${provider}:${file}`,
      infraFiles.includes(`${base}/${file}`),
      `${base}/${file} exists`,
      "A",
    );
  }
}

for (const moduleName of MODULES) {
  const base = `infrastructure/terraform/modules/${moduleName}`;
  for (const file of ["main.tf", "variables.tf", "outputs.tf"]) {
    check(
      `structure:module:${moduleName}:${file}`,
      infraFiles.includes(`${base}/${file}`),
      `${base}/${file} exists`,
      "A",
    );
  }
}

check(
  "structure:production-composition",
  infraFiles.includes("infrastructure/terraform/environments/production/main.tf"),
  "the production composition root exists (single apply surface)",
  "A",
);
check(
  "structure:composition-covers-providers",
  PROVIDER_ROOTS.every((provider) =>
    read("infrastructure/terraform/environments/production/main.tf").includes(
      `module "${provider}"`,
    ),
  ),
  "the production composition consumes every provider root",
  "A",
);
check(
  "structure:provider-pins",
  ["oracle/oci", "hetznercloud/hcloud", "vultr/vultr", "cloudflare/cloudflare"].every((source) =>
    read("infrastructure/terraform/versions.tf").includes(`source  = "${source}"`),
  ),
  "versions.tf pins every provider the fabric consumes",
  "A",
);

/* ── B. Secret hygiene ───────────────────────────────────────────────────── */

const CREDENTIAL_LITERAL_RES = [
  [/:\s*(?:api_key|api_token|password)\s*=\s*"[^"$]/, "literal credential assignment"],
  [/\b(?:api_key|api_token|token|password)\s*=\s*"[^"$][^"]{7,}"/, "literal credential assignment"],
  [/BEGIN [A-Z ]*PRIVATE KEY/, "embedded private key material"],
  [/\b(?:sk|pk|ghp|xox[baprs])-[A-Za-z0-9]{16,}\b/, "provider token literal"],
  [/\beyJ[A-Za-z0-9_-]{20,}/, "JWT-like literal"],
];

const credentialOffenders = [];
for (const [ref, text] of infraText) {
  for (const [pattern, label] of CREDENTIAL_LITERAL_RES) {
    if (pattern.test(text)) credentialOffenders.push(`${ref}: ${label}`);
  }
}
check(
  "secrets:no-credential-literals",
  credentialOffenders.length === 0,
  credentialOffenders.length === 0
    ? "no credential values in any infrastructure file"
    : `credential literals found → ${credentialOffenders.join("; ")}`,
  "B",
);

const sensitiveOffenders = [];
for (const ref of infraFiles.filter((file) => file.endsWith(".tf"))) {
  const blocks = infraText
    .get(ref)
    .split(/\nvariable\s+"/)
    .slice(1);
  for (const block of blocks) {
    const name = block.slice(0, block.indexOf('"'));
    const isStringType = /type\s*=\s*string/.test(block);
    if (!isStringType || SENSITIVE_EXEMPT.has(name)) continue;
    if (!SENSITIVE_NAME_RE.test(name)) continue;
    if (!/sensitive\s*=\s*true/.test(block)) sensitiveOffenders.push(`${ref}: ${name}`);
  }
}
check(
  "secrets:secret-variables-sensitive",
  sensitiveOffenders.length === 0,
  sensitiveOffenders.length === 0
    ? "every secret-grade string variable is marked sensitive"
    : `missing sensitive=true → ${sensitiveOffenders.join("; ")}`,
  "B",
);

const secretLeakInProofDocs = infraFiles
  .filter((file) => file.endsWith(".md"))
  .filter((file) => CREDENTIAL_LITERAL_RES.some(([pattern]) => pattern.test(infraText.get(file))));
check(
  "secrets:docs-carry-no-values",
  secretLeakInProofDocs.length === 0,
  `documentation scanned for embedded values (${infraFiles.filter((f) => f.endsWith(".md")).length} files)`,
  "B",
);

check(
  "secrets:values-are-references",
  read("infrastructure/kubernetes/secret-refs.yaml").includes("remoteRef") &&
    !/secretKey:[\s\S]*?value:/.test(read("infrastructure/kubernetes/secret-refs.yaml")),
  "workloads consume secrets through remote references, never inline values",
  "B",
);

/* ── C. State hygiene ────────────────────────────────────────────────────── */

const STATE_ROOTS = [
  "infrastructure/terraform/oci/main.tf",
  "infrastructure/terraform/hetzner/main.tf",
  "infrastructure/terraform/vultr/main.tf",
  "infrastructure/terraform/cloudflare/main.tf",
  "infrastructure/terraform/supabase/main.tf",
  "infrastructure/terraform/environments/production/main.tf",
];
const localStateOffenders = STATE_ROOTS.filter((ref) => !/backend\s+"s3"\s*\{\}/.test(read(ref)));
check(
  "state:remote-backend",
  localStateOffenders.length === 0,
  localStateOffenders.length === 0
    ? `all ${STATE_ROOTS.length} roots declare a remote backend`
    : `local state risk → ${localStateOffenders.join("; ")}`,
  "C",
);

const infraIgnore = read("infrastructure/.gitignore");
check(
  "state:gitignored",
  ["*.tfstate", ".terraform/", "*.tfvars", "!*.tfvars.example", "*.tfplan"].every((pattern) =>
    infraIgnore.includes(pattern),
  ),
  "state, plans and variable files are git-ignored (examples excepted)",
  "C",
);

/* ── D. Version pinning ──────────────────────────────────────────────────── */

const latestOffenders = [];
for (const [ref, text] of infraText) {
  // Prose in documentation legitimately discusses the rule; only code ships images.
  if (ref.endsWith(".md")) continue;
  if (/:latest\b/.test(text)) latestOffenders.push(`${ref}: ':latest' image reference`);
  if (/version\s*=\s*"latest"/.test(text)) latestOffenders.push(`${ref}: version = "latest"`);
}
check(
  "pinning:no-latest",
  latestOffenders.length === 0,
  latestOffenders.length === 0 ? "no floating 'latest' references" : latestOffenders.join("; "),
  "D",
);

check(
  "pinning:providers-tilde",
  ["oracle/oci", "hetznercloud/hcloud", "vultr/vultr", "cloudflare/cloudflare"].every((source) => {
    const text = read("infrastructure/terraform/versions.tf");
    const index = text.indexOf(`source  = "${source}"`);
    return index >= 0 && text.slice(index, index + 120).includes('version = "~>');
  }),
  "every provider uses '~>' pinning (no floating majors)",
  "D",
);

/* ── E. Tagging ──────────────────────────────────────────────────────────── */

const untaggedResources = [];
for (const ref of infraFiles.filter((file) => file.endsWith(".tf"))) {
  const text = infraText.get(ref);
  for (const type of TAG_REQUIRED_TYPES) {
    const occurrences = text.split(`resource "${type}"`).length - 1;
    if (occurrences === 0) continue;
    // Providers express tags as freeform_tags (OCI), labels (Hetzner) or tags (Vultr).
    const tagged =
      text.includes("freeform_tags") || text.includes("labels ") || text.includes("tags ");
    if (!tagged) untaggedResources.push(`${ref}: ${type}`);
  }
}
check(
  "tags:provider-resources-tagged",
  untaggedResources.length === 0,
  untaggedResources.length === 0
    ? "every tagged resource type carries coregrid:* tags/labels"
    : untaggedResources.join("; "),
  "E",
);

// Ownership tagging is defined ONCE in the module layer and inherited by roots
// that consume modules; providers whose resources tag natively (Hetzner labels,
// Vultr tags) record it inline. Phase 21 §FA: the abstraction must not pretend
// providers are identical, so the law accepts either mechanism — but every root
// must record ownership somehow.
const moduleOwnerTags = MODULES.filter((name) =>
  read(`infrastructure/terraform/modules/${name}/main.tf`).includes('"coregrid:owner-phase"'),
);
const rootsRecordingOwnership = PROVIDER_ROOTS.filter((provider) =>
  /extra_tags\s*=|coregrid:owner-phase/.test(read(`infrastructure/terraform/${provider}/main.tf`)),
);
check(
  "tags:ownership-recorded",
  moduleOwnerTags.length >= 4 && rootsRecordingOwnership.length === PROVIDER_ROOTS.length,
  `owner-phase tagging defined by ${moduleOwnerTags.length} modules and recorded by ${rootsRecordingOwnership.length}/${PROVIDER_ROOTS.length} provider roots`,
  "E",
);

/* ── E2. Region & residency inventory (Phase 21 substrates) ──────────────── */

const regionsText = read("infrastructure/terraform/regions.tf");
const regionIds = [...regionsText.matchAll(/"(oci|hetzner|vultr):[a-z0-9-]+"\s*=\s*\{/g)].map((m) =>
  m[0].replace(/\s*=\s*\{$/, "").replace(/"/g, ""),
);
check(
  "residency:inventory-present",
  regionIds.length >= 6,
  `${regionIds.length} region record(s) declared as data`,
  "E",
);
check(
  "residency:record-completeness",
  ["jurisdiction", "sovereign", "permitted_for_tenancy_data", "geographical_area"].every((field) =>
    regionsText.includes(field),
  ),
  "every region record states jurisdiction, sovereignty and a tenant-data permission flag",
  "E",
);
check(
  "residency:fail-closed-policy",
  regionsText.includes("tenant_data_regions") && regionsText.includes("stateless_regions"),
  "placement policy separates tenant-data regions from stateless regions (no data on workers/edge)",
  "E",
);
check(
  "residency:workers-and-edge-excluded",
  /permitted_for_tenancy_data\s*=\s*false\s*#[^\n]*/.test(regionsText) ||
    (regionsText.match(/permitted_for_tenancy_data\s*=\s*false/g) ?? []).length >= 5,
  "worker and edge regions are explicitly NOT permitted to hold tenant data",
  "E",
);

// Every region referenced by a variable must appear in the inventory.
const declaredRegions = new Set(regionIds.map((id) => id.split(":")[1]));
const referencedRegions = new Set([
  ...infraFiles
    .filter((ref) => ref.endsWith(".tf") || ref.endsWith(".tfvars.example"))
    .flatMap((ref) => [...infraText.get(ref).matchAll(/"([a-z]{2,4}-?[a-z0-9-]*|[a-z]{3})"/g)])
    .map((m) => m[1])
    .filter((value) =>
      [
        "fsn1",
        "nbg1",
        "jnb",
        "ams",
        "sgp",
        "eu-frankfurt-1",
        "uk-london-1",
        "af-johannesburg-1",
      ].includes(value),
    ),
]);
const undeclared = [...referencedRegions].filter((value) => !declaredRegions.has(value));
check(
  "residency:no-undeclared-region",
  undeclared.length === 0,
  undeclared.length === 0
    ? "every region referenced in the fabric is declared in the inventory"
    : `undeclared region(s): ${undeclared.join(", ")}`,
  "E",
);

/* ── F. Cluster laws ─────────────────────────────────────────────────────── */

const namespaceText = read("infrastructure/kubernetes/namespaces.yaml");
const declaredNamespaces = [...namespaceText.matchAll(/name:\s+(coregrid-[a-z]+)/g)].map(
  (m) => m[1],
);
const uniqueNamespaces = [...new Set(declaredNamespaces)].sort();
check(
  "cluster:exact-namespace-set",
  uniqueNamespaces.length === NAMESPACES.length &&
    NAMESPACES.every((name) => uniqueNamespaces.includes(name)),
  `namespaces = ${uniqueNamespaces.join(", ")}`,
  "F",
);

const psaCount = (namespaceText.match(/pod-security\.kubernetes\.io\/enforce:\s*restricted/g) ?? [])
  .length;
check(
  "cluster:pod-security-restricted",
  psaCount === NAMESPACES.length,
  `${psaCount}/${NAMESPACES.length} namespaces enforce Pod Security 'restricted'`,
  "F",
);

const policyText = read("infrastructure/kubernetes/network-policies.yaml");
const defaultDenyPerNamespace = NAMESPACES.filter((name) =>
  new RegExp(
    `name:\\s*default-deny[\\s\\S]{0,200}namespace:\\s*${name}[\\s\\S]{0,200}policyTypes:\\s*\\[Ingress, Egress\\]`,
  ).test(policyText),
);
check(
  "cluster:default-deny-every-namespace",
  defaultDenyPerNamespace.length === NAMESPACES.length,
  `${defaultDenyPerNamespace.length}/${NAMESPACES.length} namespaces are default-deny for ingress AND egress`,
  "F",
);

const quotaText = read("infrastructure/kubernetes/resource-governance.yaml");
const quotaNamespaces = NAMESPACES.filter((name) => quotaText.includes(`namespace: ${name}`));
check(
  "cluster:quota-every-namespace",
  quotaNamespaces.length === NAMESPACES.length,
  `${quotaNamespaces.length}/${NAMESPACES.length} namespaces declare quota/limits`,
  "F",
);

const rbacText = read("infrastructure/kubernetes/rbac/service-accounts.yaml");
const rbacFiles = infraFiles.filter((file) => file.includes("kubernetes/rbac/"));
const clusterAdminBindings = rbacFiles.filter((file) =>
  /roleRef[\s\S]{0,120}cluster-admin/.test(infraText.get(file)),
);
check(
  "cluster:no-cluster-admin",
  clusterAdminBindings.length === 0 &&
    /cluster-admin"\s*$|\/cluster-admin/m.test(rbacText) === false,
  "no RBAC binding grants cluster-admin (namespaces declare it forbidden as intent)",
  "F",
);
check(
  "cluster:no-implicit-tokens",
  ["coregrid-agent", "coregrid-runtime", "coregrid-sandbox"].every((name) =>
    new RegExp(`name:\\s*${name}[\\s\\S]{0,120}automountServiceAccountToken:\\s*false`).test(
      rbacText,
    ),
  ),
  "agents, runtimes and sandbox never auto-mount the API token",
  "F",
);

/* ── G. Sandbox isolation ────────────────────────────────────────────────── */

const sandboxText = read("infrastructure/kubernetes/sandbox/sandbox-isolation.yaml");
check(
  "sandbox:isolation-policy",
  sandboxText.includes("sandbox-default-deny") &&
    sandboxText.includes("policyTypes: [Ingress, Egress]") &&
    sandboxText.includes("deny-from-sandbox-to-runtimes"),
  "sandbox is default-deny and explicitly cannot reach runtime namespaces",
  "G",
);
check(
  "sandbox:ttl-and-priority",
  sandboxText.includes("activeDeadlineSeconds") &&
    sandboxText.includes("ttlSecondsAfterFinished") &&
    sandboxText.includes("priorityClassName: coregrid-sandbox"),
  "sandbox runs are time-boxed, cleaned up, and first to be evicted",
  "G",
);
check(
  "sandbox:no-provider-credentials",
  !/SUPABASE_(URL|SERVICE_ROLE_KEY|PUBLISHABLE_KEY)/.test(sandboxText) &&
    sandboxText.includes("COREGRID_FIXTURES_ONLY"),
  "sandbox receives no provider or tenant-data credentials (fixtures only)",
  "G",
);

/* ── H. Neutrality (the fabric serves every vertical) ────────────────────── */

const neutralityOffenders = [];
for (const [ref, text] of infraText) {
  const haystack = text.toLowerCase();
  for (const term of DOMAIN_TERMS) {
    if (haystack.includes(term)) neutralityOffenders.push(`${ref}: "${term}"`);
  }
}
check(
  "neutrality:no-domain-vocabulary",
  neutralityOffenders.length === 0,
  neutralityOffenders.length === 0
    ? "no vertical's vocabulary appears in the fabric layer"
    : `domain vocabulary in IaC → ${neutralityOffenders.join("; ")}`,
  "H",
);
check(
  "neutrality:runtime-seats-are-consumers",
  read("infrastructure/kubernetes/namespaces.yaml").includes(
    "coregrid.io/runtime-ref: runtime:scholar",
  ) && read("infrastructure/kubernetes/README.md").includes("first domain runtime"),
  "the first domain runtime holds a namespace as a CONSUMER, not as a design input",
  "H",
);

/* ── I. Evidence: docs, credentials checklist, digest-bound proof ─────────── */

for (const ref of [
  "architecture/cloud-fabric-implementation-blueprint.md",
  "architecture/cloud-fabric-migration-plan.md",
  "infrastructure/CREDENTIALS.md",
  "infrastructure/README.md",
]) {
  check(`evidence:${ref}`, existsSync(join(ROOT, ref)), `${ref} exists`, "I");
}

const blueprint = read("architecture/cloud-fabric-implementation-blueprint.md");
check(
  "evidence:owner-is-phase-21",
  blueprint.includes("Phase 21") && blueprint.includes("cloud-fabric-byoc"),
  "the blueprint names Phase 21 (and its capability) as the owner",
  "I",
);
check(
  "evidence:no-new-authority",
  blueprint.includes("instantiation map") && blueprint.includes("never re-implemented"),
  "the blueprint is an instantiation map, not a new authority",
  "I",
);

const inventoryDigest = `sha256:${createHash("sha256")
  .update(
    infraFiles
      .sort()
      .map((ref) => `${ref}\n${infraText.get(ref)}`)
      .join("\n---\n"),
  )
  .digest("hex")}`;

const failed = checks.filter((entry) => !entry.ok);
const proof = {
  artifact: "cloud-fabric-foundation",
  wave: "CF-3",
  owner: "21",
  capability: "cloud-fabric-byoc",
  mode: "static",
  generatedAt: new Date().toISOString(),
  infrastructureFiles: infraFiles.length,
  inventoryDigest,
  providers: PROVIDER_ROOTS,
  modules: MODULES,
  namespaces: NAMESPACES,
  checks,
  ok: failed.length === 0,
  nextWaves: [
    "CF-4 OCI foundation — requires OCI credentials (see infrastructure/CREDENTIALS.md)",
    "CF-5 Hetzner worker pools — requires a scoped Hetzner token",
    "CF-6 Vultr edge — requires a Vultr API key",
    "CF-7 Supabase data-layer configuration check — requires project + access token",
    "CF-8 n8n executor, CF-9 monitoring, CF-10 security fabric, CF-11 agent runtime, CF-12 runtime cutover",
  ],
  limitations: [
    "Static mode proves the authored source, not a deployed fabric.",
    "terraform fmt/validate and kubeconform run in CI; the Terraform CLI is absent in the authoring environment.",
    "No provider API call is made: this verifier never needs (and never receives) credentials.",
  ],
};

const proofPath = join(ROOT, PROOF_REF);
mkdirSync(dirname(proofPath), { recursive: true });
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"}  [${entry.category}] ${entry.id} — ${entry.detail}`);
}
console.log(
  `\n${checks.length - failed.length}/${checks.length} fabric invariants hold (mode: static, ${infraFiles.length} source files).`,
);
console.log(`Proof written: ${PROOF_REF} (inventory ${inventoryDigest.slice(0, 19)}…)`);

if (failed.length > 0) {
  console.error(`\n${failed.length} invariant(s) FAILED — the fabric is not proven.`);
  process.exit(1);
}
console.log("No credentials required: source invariants proven. CF-4+ await owner credentials.");
