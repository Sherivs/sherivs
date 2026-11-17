/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-memory`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { conductorMemoryScopeId as hermesMemoryScopeId } from "../conductor/conductor-memory";
export { declareConductorMemoryScope as declareHermesMemoryScope } from "../conductor/conductor-memory";
export { conductorDecisionRecordId as hermesDecisionRecordId } from "../conductor/conductor-memory";
export { writeConductorDecisionMemory as writeHermesDecisionMemory } from "../conductor/conductor-memory";
export { retrieveConductorDecisionMemory as retrieveHermesDecisionMemory } from "../conductor/conductor-memory";
