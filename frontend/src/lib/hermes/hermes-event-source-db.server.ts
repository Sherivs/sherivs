/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-event-source-db.server`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { CONDUCTOR_EVENT_SOURCE_BATCH_LIMIT as HERMES_EVENT_SOURCE_BATCH_LIMIT } from "../conductor/conductor-event-source-db.server";
export { CONDUCTOR_EVENT_SUBSTRATE_GAP as HERMES_EVENT_SUBSTRATE_GAP } from "../conductor/conductor-event-source-db.server";
export { createConductorEventObservationSource as createHermesEventObservationSource } from "../conductor/conductor-event-source-db.server";
export type { ConductorEventSourceDbClient as HermesEventSourceDbClient } from "../conductor/conductor-event-source-db.server";
export type { ConductorEventObservationSource as HermesEventObservationSource } from "../conductor/conductor-event-source-db.server";
