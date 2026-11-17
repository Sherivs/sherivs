/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-event-source`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { CONDUCTOR_EVENT_SOURCE_ORIGIN as HERMES_EVENT_SOURCE_ORIGIN } from "../conductor/conductor-event-source";
export { conductorEventObservationId as hermesEventObservationId } from "../conductor/conductor-event-source";
export { conductorEventRef as hermesEventRef } from "../conductor/conductor-event-source";
export { observationFromEvent } from "../conductor/conductor-event-source";
export { ingestEventsAsObservations } from "../conductor/conductor-event-source";
export type { ConductorEventObservationMapping as HermesEventObservationMapping } from "../conductor/conductor-event-source";
export type { ConductorEventIngestion as HermesEventIngestion } from "../conductor/conductor-event-source";
export type { ConductorEventIngestResult as HermesEventIngestResult } from "../conductor/conductor-event-source";
