/**
 * Sherivs brand migration — CoreGrid reference classifier.
 *
 * "CoreGrid" is no longer the customer-facing brand (Sherivs is). A blind
 * global replace would corrupt persisted contract values (database enum
 * values, storage buckets, credential references, plan ids, package names,
 * environment variables). Every line mentioning CoreGrid is therefore
 * classified first, and ONLY lines classified CUSTOMER_FACING are migrated.
 *
 * Classes
 *   CUSTOMER_FACING      brand name visible to a person (UI copy, titles,
 *                        error messages, notification text)      → MIGRATE
 *   AI_PROMPT            model-facing prompt text; changing it changes model
 *                        input, so it needs a reviewed prompt change → REVIEW
 *   TECHNICAL_IDENTIFIER type/function/variable/package/env names  → PRESERVE
 *   PERSISTED_VALUE      enum values, ids, buckets, secret refs     → PRESERVE
 *   REGISTRY_BOUND       names mirrored in governed registries / phase
 *                        contracts verified by drift checks         → PRESERVE
 *   PACKAGE_METADATA     package.json metadata                      → PRESERVE
 *   COMMENT              source comments (not customer visible)     → DEFER
 *   INFRASTRUCTURE_OR_DB migrations, terraform, kubernetes          → PRESERVE
 *   TOOLING              repository scripts                         → PRESERVE
 *   TEST                 test sources (follow the code they test)   → FOLLOW
 *   GOVERNANCE_DOC       constitution / architecture documents      → PRESERVE
 */

const TECHNICAL_FORMS = [
  /@coregrid\/[\w.-]+/g, // package scope
  /\bCoreGrid[A-Z][A-Za-z0-9]*/g, // CoreGridTenant, CoreGridIdentity
  /\b[A-Za-z0-9]+CoreGrid\b/g, // requiredCoreGridVersion
  /\bCOREGRID[_-][A-Z0-9_]+/g, // COREGRID_ROLES, COREGRID_INTERNAL
  /\bEXPO_PUBLIC_COREGRID[A-Z_]*/g,
  /\bcoregrid[A-Z][A-Za-z0-9]*/g, // coregridField
  /[A-Za-z0-9]coregrid\b/gi, // missingInCoregrid, org-coregrid
  /\bcoregrid[_.:/-][A-Za-z0-9_.:/-]*/g, // coregrid_owner, coregrid.plan.x
  /[A-Za-z0-9_]+[_.:/-]coregrid\b/gi, // internal_coregrid, tenant:coregrid-demo
  /\bcoregrid\.(yaml|json)\b/g,
  /github\.com\/coregrid\/coregrid/g,
];

const COMMENT_START = /^\s*(\*|\/\/|\/\*|#|--|<!--|\{\/\*)/;

/** @returns {string} one of the class names documented above */
export function classifyBrandLine(line, filePath) {
  if (/^(database|infrastructure)\//.test(filePath)) return "INFRASTRUCTURE_OR_DB";
  if (/^scripts\//.test(filePath)) return "TOOLING";
  if (/^tests\//.test(filePath)) return "TEST";
  if (/^architecture\//.test(filePath)) return "GOVERNANCE_DOC";
  if (COMMENT_START.test(line)) return "COMMENT";
  if (/(^|\/)package\.json$/.test(filePath)) return "PACKAGE_METADATA";
  if (/^frontend\/src\/lib\/(kernel\/|phase-catalog\.ts)/.test(filePath)) return "REGISTRY_BOUND";

  let remainder = line;
  for (const pattern of TECHNICAL_FORMS) remainder = remainder.replace(pattern, " ");

  const standaloneBrand = /\bCoreGrid\b/.test(remainder);
  if (!standaloneBrand) {
    return /coregrid/i.test(remainder) ? "PERSISTED_VALUE" : "TECHNICAL_IDENTIFIER";
  }
  if (/worker-launch-runtime\.server\.ts$/.test(filePath)) return "AI_PROMPT";
  return "CUSTOMER_FACING";
}
