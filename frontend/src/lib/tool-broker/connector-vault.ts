/**
 * Sherivs Connector Vault contract (ENGINE-03, ADR-081).
 *
 * The platform stores REFERENCES to secrets, never secrets. A binding links a
 * connector to an opaque `vault://` reference in the secret manager the owner
 * operates. This module validates references and rejects anything that looks
 * like a credential value, so a secret can never be written to the database,
 * a ledger row, a log line or a pull request body through this seam.
 *
 * Pure module. It does not read or resolve secrets.
 */
import { z } from "zod";

export const SECRET_REF_PATTERN =
  /^vault:\/\/[a-z][a-z0-9-]{1,39}\/[a-z][a-z0-9_-]{1,63}#v[1-9][0-9]{0,3}$/;

export const BINDING_SCOPES = ["platform", "tenant"] as const;
export type BindingScope = (typeof BINDING_SCOPES)[number];

export const BINDING_STATUSES = ["active", "revoked", "rotating"] as const;
export type BindingStatus = (typeof BINDING_STATUSES)[number];

export const connectorBindingSchema = z
  .object({
    connector: z.string().regex(/^[a-z][a-z0-9_.:-]{1,63}$/),
    scope: z.enum(BINDING_SCOPES),
    tenantRef: z.string().min(1).max(128).optional(),
    secretRef: z.string().regex(SECRET_REF_PATTERN),
    status: z.enum(BINDING_STATUSES),
  })
  .strict();

export type ConnectorBinding = z.infer<typeof connectorBindingSchema>;

/** Shapes that indicate a credential value rather than a reference. */
const SECRET_VALUE_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[A-Fa-f0-9]{40,}\b/,
];

/** Key names that must never appear in a ledger payload. */
export const SECRET_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|api[-_]?key|authorization|credential|private[-_]?key|cookie|session[-_]?id)/i;

export function looksLikeSecretValue(text: string): boolean {
  return SECRET_VALUE_SHAPES.some((re) => re.test(text));
}

/** Findings for a binding. Empty means it is a reference to a bound scope. */
export function validateConnectorBinding(candidate: unknown): readonly string[] {
  const parsed = connectorBindingSchema.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `schema: ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const b = parsed.data;
  const findings: string[] = [];
  if (b.scope === "platform" && b.tenantRef !== undefined) {
    findings.push("a platform binding must not name a tenant");
  }
  if (b.scope === "tenant" && b.tenantRef === undefined) {
    findings.push("a tenant binding must name its tenant");
  }
  if (looksLikeSecretValue(b.secretRef)) findings.push("secretRef looks like a credential value");
  const ref = b.secretRef.slice("vault://".length).split("/")[0];
  if (ref !== b.connector.split(/[.:]/)[0]) {
    findings.push("secretRef namespace must match the connector family");
  }
  return findings;
}

/** A binding as it may be shown to a person or written to a log. */
export function describeBinding(b: ConnectorBinding): Readonly<Record<string, string>> {
  return {
    connector: b.connector,
    scope: b.scope,
    tenant: b.tenantRef ?? "platform",
    status: b.status,
    secret: "vault://…redacted",
  };
}
