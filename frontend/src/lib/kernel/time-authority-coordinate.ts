/**
 * Node-only issuance coordinate. Kept out of time-authority.ts so the clock
 * module can load in the browser. The root error boundary logs through
 * trace-context, which uses the clock, and must not pull `node:crypto`.
 */
import { createHash } from "node:crypto";
import type { IssuedTimestamp } from "./time-authority";

/**
 * Stable time-coordinate for minting time-ordered identifiers (UUIDv7's
 * embedded timestamp field): the issued `atMs` and `sequence` combined so
 * two issuances in the same millisecond never collide.
 */
export function issuanceCoordinate(issued: IssuedTimestamp): string {
  return createHash("sha256")
    .update([issued.atMs, issued.sequence, issued.issuer].join("|"))
    .digest("hex")
    .slice(0, 32);
}
