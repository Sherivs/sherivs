/**
 * CoreGrid — single-source cross-surface contracts (Constitution §23).
 *
 * Consumed as TypeScript source by BOTH surfaces through plain node_modules
 * resolution (npm `file:` dependency; see packages/contracts/README.md):
 * - web: frontend/ (Vite/TanStack Start, repo-root tsc + vitest)
 * - mobile: mobile/ (Expo/Metro — Metro follows the npm symlink natively)
 */
export * from "./vocabulary";
export * from "./foundation-rows";
export * from "./identity";
export * from "./database";
import type { Database } from "./database";

/** Convenience alias (formerly mobile's `contracts/database.ts` re-export). */
export type CoreGridDatabase = Database;
