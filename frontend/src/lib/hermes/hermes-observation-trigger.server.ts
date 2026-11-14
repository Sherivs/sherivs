/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-observation-trigger.server`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { CONDUCTOR_EVENT_TRIGGER_MEMORY_SKIP_REASON as HERMES_EVENT_TRIGGER_MEMORY_SKIP_REASON } from "../conductor/conductor-observation-trigger.server";
export { CONDUCTOR_EVENT_TRIGGER_DELIVERY_REJECTION as HERMES_EVENT_TRIGGER_DELIVERY_REJECTION } from "../conductor/conductor-observation-trigger.server";
export { runConductorEventObservationStep as runHermesEventObservationStep } from "../conductor/conductor-observation-trigger.server";
export type { ConductorEventObservationStepInput as HermesEventObservationStepInput } from "../conductor/conductor-observation-trigger.server";
export type { ConductorEventObservationStepDeps as HermesEventObservationStepDeps } from "../conductor/conductor-observation-trigger.server";
export type { ConductorEventObservationStepResult as HermesEventObservationStepResult } from "../conductor/conductor-observation-trigger.server";
