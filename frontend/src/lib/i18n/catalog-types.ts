import type { CatalogueKey } from "./catalogues/en";

/** A non-English catalogue: every English key present; an empty string means "not translated yet". */
export type LocaleCatalogue = Record<CatalogueKey, string>;
