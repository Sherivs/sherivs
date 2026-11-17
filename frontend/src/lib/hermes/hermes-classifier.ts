/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-classifier`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { classifyConductorAction as classifyHermesAction } from "../conductor/conductor-classifier";
export type { ConductorClassificationInput as HermesClassificationInput } from "../conductor/conductor-classifier";
