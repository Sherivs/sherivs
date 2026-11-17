/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-contract`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { CONDUCTOR_ACTOR_REF as HERMES_ACTOR_REF } from "../conductor/conductor-contract";
export { CONDUCTOR_REPAIR_MISSION_PREFIX as HERMES_REPAIR_MISSION_PREFIX } from "../conductor/conductor-contract";
export { CONDUCTOR_MEMORY_DOMAIN as HERMES_MEMORY_DOMAIN } from "../conductor/conductor-contract";
export { CONDUCTOR_CYCLE_PHASES as HERMES_CYCLE_PHASES } from "../conductor/conductor-contract";
export { CONDUCTOR_FINDING_KINDS as HERMES_FINDING_KINDS } from "../conductor/conductor-contract";
export { CONDUCTOR_ACTION_CLASSES as HERMES_ACTION_CLASSES } from "../conductor/conductor-contract";
export { conductorClaim as hermesClaim } from "../conductor/conductor-contract";
export { conductorWorkerPostureSchema as hermesWorkerPostureSchema } from "../conductor/conductor-contract";
export { conductorVerificationRecordSchema as hermesVerificationRecordSchema } from "../conductor/conductor-contract";
export { conductorCycleConfigSchema as hermesCycleConfigSchema } from "../conductor/conductor-contract";
export { conductorCycleInputSchema as hermesCycleInputSchema } from "../conductor/conductor-contract";
export { STUCK_CANDIDATE_STAGES } from "../conductor/conductor-contract";
export { CRITICAL_ACTION_PATTERNS } from "../conductor/conductor-contract";
export { isCriticalMissionAction } from "../conductor/conductor-contract";
export type { ConductorCyclePhase as HermesCyclePhase } from "../conductor/conductor-contract";
export type { ConductorFindingKind as HermesFindingKind } from "../conductor/conductor-contract";
export type { ConductorActionClass as HermesActionClass } from "../conductor/conductor-contract";
export type { ConductorDenyCode as HermesDenyCode } from "../conductor/conductor-contract";
export type { ConductorClaimSource as HermesClaimSource } from "../conductor/conductor-contract";
export type { ConductorClaim as HermesClaim } from "../conductor/conductor-contract";
export type { ConductorWorkerPosture as HermesWorkerPosture } from "../conductor/conductor-contract";
export type { ConductorVerificationRecord as HermesVerificationRecord } from "../conductor/conductor-contract";
export type { ConductorObservationPort as HermesObservationPort } from "../conductor/conductor-contract";
export type { ConductorFinding as HermesFinding } from "../conductor/conductor-contract";
export type { ConductorAssessment as HermesAssessment } from "../conductor/conductor-contract";
export type { ConductorClassifierVerdict as HermesClassifierVerdict } from "../conductor/conductor-contract";
export type { ConductorDecision as HermesDecision } from "../conductor/conductor-contract";
export type { ConductorApprovalRequest as HermesApprovalRequest } from "../conductor/conductor-contract";
export type { ConductorDelegationOutcome as HermesDelegationOutcome } from "../conductor/conductor-contract";
export type { ConductorCycleReport as HermesCycleReport } from "../conductor/conductor-contract";
export type { ConductorCycleConfig as HermesCycleConfig } from "../conductor/conductor-contract";
export type { ConductorCycleInput as HermesCycleInput } from "../conductor/conductor-contract";
