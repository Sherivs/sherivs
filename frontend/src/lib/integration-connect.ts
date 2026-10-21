/**
 * Sherivs Integration Fabric — provider integration, protocol translation,
 * integration AI, and testing domain.
 *
 * Implements `architecture/phase-29-coregrid-integration.md`:
 * - Provider integration domains (AR-BO): database, file, legacy African
 *   institutional systems, education systems, government, financial (Phase 13
 *   remains financial authority), mobile money, banks, communication (Phase 10
 *   remains communication runtime), identity (Phase 02 authority), device
 *   (Phase 15), digital twin (Phase 16), cloud (Phase 21), AI providers (Phase 26),
 *   hardware, IoT, ERP, productivity, directory, calendar (Phase 12 authority),
 *   file storage, search, notifications, API gateway.
 * - Webhook security (BQ): signatures, timestamps, replay prevention,
 *   authentication, authorization. Network security (BR): TLS, certificate
 *   validation, network restrictions, IP allowlists, private connectivity.
 * - Protocol translation (BU-BV): SOAP → Sherivs API; XML ⇄ JSON, CSV ⇄ JSON,
 *   external schema ⇄ canonical schema.
 * - Integration workflows (BW-BX): complex integrations use Phase 17 automation
 *   contracts rather than a second automation engine.
 * - Integration AI (BY-BZ): AI may suggest mappings, detect schema differences,
 *   explain errors, propose transformations, detect anomalies — AI must not
 *   silently alter production mappings; human or authorized policy approves.
 * - Integration testing (CA-CE): connector/schema/auth/contract/transformation/
 *   synchronization/failure/security tests; mock providers; sandbox providers;
 *   production certification gates.
 */

import type { TenantId } from "./tenant-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type ProtocolAdapterId = string & { readonly __brand: "ProtocolAdapterId" };
export type IntegrationTestId = string & { readonly __brand: "IntegrationTestId" };
export type MockProviderId = string & { readonly __brand: "MockProviderId" };
export type IntegrationCertificationId = string & {
  readonly __brand: "IntegrationCertificationId";
};

export function protocolAdapterId(raw: string): ProtocolAdapterId {
  return raw as ProtocolAdapterId;
}
export function integrationTestId(raw: string): IntegrationTestId {
  return raw as IntegrationTestId;
}
export function mockProviderId(raw: string): MockProviderId {
  return raw as MockProviderId;
}
export function integrationCertificationId(raw: string): IntegrationCertificationId {
  return raw as IntegrationCertificationId;
}

/* ─────────────────────────────────────────────────────────────
 * Protocol translation (Sections BU, BV)
 * ────────────────────────────────────────────────────────────*/

export type ProtocolKind =
  "soap" | "rest" | "graphql" | "rpc" | "xml" | "json" | "csv" | "yaml" | "binary";

export const PROTOCOL_KINDS: readonly ProtocolKind[] = [
  "soap",
  "rest",
  "graphql",
  "rpc",
  "xml",
  "json",
  "csv",
  "yaml",
  "binary",
] as const;

export interface ProtocolAdapter {
  id: ProtocolAdapterId;
  name: string;
  from: ProtocolKind;
  to: ProtocolKind;
  /** Whether translation preserves semantic fidelity (Section BU). */
  lossless: boolean;
  isActive: boolean;
}

export function createProtocolAdapter(input: {
  id: ProtocolAdapterId;
  name: string;
  from: ProtocolKind;
  to: ProtocolKind;
  lossless?: boolean;
  isActive?: boolean;
}): ProtocolAdapter {
  return {
    id: input.id,
    name: input.name,
    from: input.from,
    to: input.to,
    lossless: input.lossless ?? false,
    isActive: input.isActive ?? false,
  };
}

/**
 * Format translation (BV): XML ⇄ JSON, CSV ⇄ JSON, external schema ⇄ canonical
 * schema. A lossy translation is flagged for review.
 */
export function canTranslateLosslessly(from: ProtocolKind, to: ProtocolKind): boolean {
  // JSON ⇄ XML preserves structure; CSV loses nesting — flagged.
  return (from === "json" && to === "xml") || (from === "xml" && to === "json");
}

/* ─────────────────────────────────────────────────────────────
 * Integration AI (Sections BY, BZ)
 * ────────────────────────────────────────────────────────────*/

export interface AiMappingProposal {
  externalField: string;
  sherivsField: string;
  confidence: number;
}

/**
 * AI mapping assistant (BZ): AI may propose mappings; a human or authorized
 * policy must approve production mapping changes.
 */
export function isMappingProposalApplicable(input: {
  proposal: AiMappingProposal;
  production: boolean;
  humanApproved: boolean;
  policyApproved: boolean;
}): boolean {
  if (!input.production) return true;
  return input.humanApproved || input.policyApproved;
}

/** Section BY: AI must not silently alter production mappings. */
export function aiCanSilentlyAlterMappings(): boolean {
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Integration testing (Sections CA, CB, CC, CD, CE)
 * ────────────────────────────────────────────────────────────*/

export type IntegrationTestKind =
  | "connector"
  | "schema"
  | "authentication"
  | "contract"
  | "transformation"
  | "synchronization"
  | "failure"
  | "security";

export const INTEGRATION_TEST_KINDS: readonly IntegrationTestKind[] = [
  "connector",
  "schema",
  "authentication",
  "contract",
  "transformation",
  "synchronization",
  "failure",
  "security",
] as const;

export interface IntegrationTestResult {
  id: IntegrationTestId;
  integrationRef: string;
  kind: IntegrationTestKind;
  passed: boolean;
  testedAt: string;
}

export function runIntegrationTest(input: {
  id: IntegrationTestId;
  integrationRef: string;
  kind: IntegrationTestKind;
  passed: boolean;
  now?: string;
}): IntegrationTestResult {
  return {
    id: input.id,
    integrationRef: input.integrationRef,
    kind: input.kind,
    passed: input.passed,
    testedAt: input.now ?? timeAuthority.now().at,
  };
}

export interface MockProvider {
  id: MockProviderId;
  providerName: string;
  /** Simulated failure modes (Section CA failure tests). */
  failureModes: string[];
  isActive: boolean;
}

export function createMockProvider(input: {
  id: MockProviderId;
  providerName: string;
  failureModes?: string[];
  isActive?: boolean;
}): MockProvider {
  return {
    id: input.id,
    providerName: input.providerName,
    failureModes: input.failureModes ?? [],
    isActive: input.isActive ?? false,
  };
}

/**
 * Production certification (CE): production connectors must pass applicable
 * certification gates before going live.
 */
export function isProductionCertified(input: {
  connectorTestsPassed: boolean;
  securityTestsPassed: boolean;
  contractTestsPassed: boolean;
  approvalGranted: boolean;
}): boolean {
  return (
    input.connectorTestsPassed &&
    input.securityTestsPassed &&
    input.contractTestsPassed &&
    input.approvalGranted
  );
}

/* ─────────────────────────────────────────────────────────────
 * Webhook security (BQ) + network security (BR)
 * ────────────────────────────────────────────────────────────*/

export function isWebhookDeliverySecure(input: {
  signatureValid: boolean;
  timestampFresh: boolean;
  replayPrevented: boolean;
  authenticated: boolean;
  authorized: boolean;
}): boolean {
  return (
    input.signatureValid &&
    input.timestampFresh &&
    input.replayPrevented &&
    input.authenticated &&
    input.authorized
  );
}

export interface NetworkSecurityRequirement {
  tlsRequired: boolean;
  certificateValidationRequired: boolean;
  ipAllowlist: string[];
  privateConnectivityRequired: boolean;
}

export function isNetworkSecuritySatisfied(
  requirement: NetworkSecurityRequirement,
  input: {
    tls: boolean;
    certificateValid: boolean;
    sourceIp: string;
  },
): boolean {
  if (requirement.tlsRequired && !input.tls) return false;
  if (requirement.certificateValidationRequired && !input.certificateValid) return false;
  if (requirement.ipAllowlist.length > 0 && !requirement.ipAllowlist.includes(input.sourceIp))
    return false;
  return true;
}
