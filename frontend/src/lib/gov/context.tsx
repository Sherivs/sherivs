import { createContext, useContext } from "react";
import type { GovJurisdiction } from "./portal";

export const GovJurisdictionContext = createContext<{ jurisdiction: GovJurisdiction | null }>({ jurisdiction: null });
export const useGovJurisdiction = () => useContext(GovJurisdictionContext).jurisdiction;
