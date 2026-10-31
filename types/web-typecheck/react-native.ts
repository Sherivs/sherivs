/**
 * Type boundary for the root `tsc` program.
 *
 * Tests import mobile passkey code, which imports `react-native`. Loading the
 * real package also loads its global DOM replacements, including a `FormData`
 * class that has no `get`. The web program must keep the DOM `FormData`.
 * The Expo typecheck job resolves the real module with `mobile/tsconfig.json`,
 * which does not use this path.
 */
export const Platform: { readonly OS: string } = { OS: "web" };
