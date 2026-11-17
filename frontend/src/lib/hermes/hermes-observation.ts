/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-observation`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { CONDUCTOR_OBSERVATION_SOURCES as HERMES_OBSERVATION_SOURCES } from "../conductor/conductor-observation";
export { CONDUCTOR_OBSERVATION_KINDS as HERMES_OBSERVATION_KINDS } from "../conductor/conductor-observation";
export { conductorObservationInputSchema as hermesObservationInputSchema } from "../conductor/conductor-observation";
export { conductorObservationSchema as hermesObservationSchema } from "../conductor/conductor-observation";
export { createInMemoryConductorObservationPort as createInMemoryHermesObservationPort } from "../conductor/conductor-observation";
export type { ConductorObservationSource as HermesObservationSource } from "../conductor/conductor-observation";
export type { ConductorObservationKind as HermesObservationKind } from "../conductor/conductor-observation";
export type { ConductorObservationInput as HermesObservationInput } from "../conductor/conductor-observation";
export type { ConductorObservation as HermesObservation } from "../conductor/conductor-observation";
export type { ConductorObservationRecordInput as HermesObservationRecordInput } from "../conductor/conductor-observation";
export type { ConductorObservationRecordResult as HermesObservationRecordResult } from "../conductor/conductor-observation";
export type { ConductorObservationListResult as HermesObservationListResult } from "../conductor/conductor-observation";
export type { ConductorObservationRecorder as HermesObservationRecorder } from "../conductor/conductor-observation";
