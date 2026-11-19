/** English source catalogue (mission M23 scaffolding). English is the fallback for every locale. */
export const en = {
  "common.home": "Home",
  "common.search": "Search",
  "common.back": "Back",
  "common.loading": "Loading",
  "common.retry": "Try again",
  "common.offline": "You are offline. Showing saved data.",
  "common.sign_in": "Sign in",
  "common.sign_out": "Sign out",
  "common.save": "Save",
  "common.cancel": "Cancel",
} as const satisfies Record<string, string>;

export type CatalogueKey = keyof typeof en;
