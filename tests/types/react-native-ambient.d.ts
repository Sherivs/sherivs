/**
 * Web TypeScript project shims.
 *
 * Root `tsc --noEmit` typechecks tests that import Expo modules. Those
 * packages are real dependencies of `mobile/`, not of the web app. These
 * declarations do not change runtime passkey behavior.
 */
declare module "react-native" {
  export const Platform: { OS: string };
}

declare module "react-native-passkeys" {
  export function isSupported(): boolean;
  export function get(options: unknown): Promise<unknown>;
  export function create(options: unknown): Promise<unknown>;
}
