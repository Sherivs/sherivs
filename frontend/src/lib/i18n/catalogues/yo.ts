/**
 * Yoruba catalogue (mission M23 scaffolding).
 * TRANSLATION REQUIRED: every value is empty on purpose. A human Yoruba translator must supply
 * them; they are not machine- or agent-written. Empty values fall back to English.
 */
import type { LocaleCatalogue } from "../catalog-types";

export const TRANSLATION_STATUS = "TRANSLATOR_REQUIRED" as const;

export const yo: LocaleCatalogue = {
  "common.home": "",
  "common.search": "",
  "common.back": "",
  "common.loading": "",
  "common.retry": "",
  "common.offline": "",
  "common.sign_in": "",
  "common.sign_out": "",
  "common.save": "",
  "common.cancel": "",
};
