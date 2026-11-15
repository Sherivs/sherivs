/**
 * @deprecated Compatibility shim (ENGINE-02, ADR-080). Hermes is now the Sherivs Conductor;
 * import from `../conductor/conductor-cycle`. Re-exports the legacy names so stacked work
 * that still imports `lib/hermes` keeps compiling. No logic lives here. NOTE: persisted wire
 * values were renamed with the Conductor (actor ref, mission prefix, idempotency/scope keys);
 * the observation table was empty in production (ADR-080), so no data migration is needed.
 */
export { assessExecutions } from "../conductor/conductor-cycle";
export { assessWorkers } from "../conductor/conductor-cycle";
export { prioritizeFindings } from "../conductor/conductor-cycle";
export { runConductorCycle as runHermesCycle } from "../conductor/conductor-cycle";
export type { ConductorGovernedIdentity as HermesGovernedIdentity } from "../conductor/conductor-cycle";
export type { ConductorCycleDeps as HermesCycleDeps } from "../conductor/conductor-cycle";
export type { ConductorCyclePhaseTrace as HermesCyclePhaseTrace } from "../conductor/conductor-cycle";
export type { ConductorCycleResult as HermesCycleResult } from "../conductor/conductor-cycle";
