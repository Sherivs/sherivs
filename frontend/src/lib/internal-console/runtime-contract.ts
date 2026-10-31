/**
 * V1 runtime registration contract for the Internal Console.
 *
 * Runtimes are declared here as data, not executable plugins. Arbitrary code
 * injection through registration is not supported. Future runtimes must not
 * appear as operational products until they exist.
 */
import { SCHOLAR_APP_ORIGIN, SCHOLAR_ENTRY_PATH, SCHOLAR_ENTRY_URL } from "./paths";

export type ConsoleRuntimeStatus = "operational_product" | "not_registered";

export interface ConsoleRuntimeContract {
  id: string;
  name: string;
  description: string;
  entryOrigin: string;
  entryPath: string;
  entryUrl: string;
  helpHref: string;
  status: ConsoleRuntimeStatus;
  permission: string | null;
}

export const SCHOLAR_RUNTIME_CONTRACT: ConsoleRuntimeContract = {
  id: "runtime:scholar",
  name: "Sherivs Scholar",
  description:
    "The first operational runtime. Scholar serves schools and academic workflows. It is not the Sherivs Internal Console.",
  entryOrigin: SCHOLAR_APP_ORIGIN,
  entryPath: SCHOLAR_ENTRY_PATH,
  entryUrl: SCHOLAR_ENTRY_URL,
  helpHref: "/console/runtimes/scholar",
  status: "operational_product",
  permission: null,
};

export const REGISTERED_RUNTIMES: readonly ConsoleRuntimeContract[] = [SCHOLAR_RUNTIME_CONTRACT];

export function runtimeById(id: string): ConsoleRuntimeContract | null {
  return REGISTERED_RUNTIMES.find((runtime) => runtime.id === id) ?? null;
}
