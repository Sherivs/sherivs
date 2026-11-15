/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-observation-db.server`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { CONDUCTOR_OBSERVATION_SUBSTRATE_GAP as HERMES_OBSERVATION_SUBSTRATE_GAP } from "../conductor/conductor-observation-db.server";
export { createConductorObservationPortDb as createHermesObservationPortDb } from "../conductor/conductor-observation-db.server";
export { CONDUCTOR_OBSERVATION_BACKENDS as HERMES_OBSERVATION_BACKENDS } from "../conductor/conductor-observation-db.server";
export { resolveConductorObservationBackend as resolveHermesObservationBackend } from "../conductor/conductor-observation-db.server";
export { createConductorObservationPort as createHermesObservationPort } from "../conductor/conductor-observation-db.server";
export type { ConductorObservationDbClient as HermesObservationDbClient } from "../conductor/conductor-observation-db.server";
export type { ConductorObservationPortDb as HermesObservationPortDb } from "../conductor/conductor-observation-db.server";
export type { ConductorObservationBackend as HermesObservationBackend } from "../conductor/conductor-observation-db.server";
