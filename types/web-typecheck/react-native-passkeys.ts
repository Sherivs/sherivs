/**
 * Type boundary for the root `tsc` program. See react-native.ts.
 * Matches the calls in mobile/src/lib/native-passkey.ts. The Expo job
 * typechecks those calls against the real package.
 */
export function isSupported(): boolean {
  return false;
}

export function get(_request: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(null);
}

export function create(_request: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(null);
}
