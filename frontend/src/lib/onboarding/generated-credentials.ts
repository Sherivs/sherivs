/**
 * CoreGrid — generated-once credentials for provisioned accounts
 * (V1-008; AGENTS.md §29 OBSERVABILITY, §30 SECRETS).
 *
 * A provisioned account's initial password is created AT PROVISIONING TIME
 * from platform entropy, returned to the caller exactly once, and never
 * stored as a constant, logged, or audited. There is no fixed demo or default
 * credential anywhere in a production-reachable path — any fixture that needs
 * an account must go through this generator.
 *
 * Isomorphic (Web Crypto only): safe to import from the isomorphic engine and
 * from server functions without leaking a Node built-in into a client bundle.
 */

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const MIN_LENGTH = 20;

function randomInt(maxExclusive: number): number {
  // Rejection sampling over an unsigned 32-bit draw: unbiased, no modulo bias.
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
    throw new Error("credential generation requires Web Crypto entropy (crypto.getRandomValues)");
  }
  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  for (;;) {
    cryptoObject.getRandomValues(buffer);
    if (buffer[0]! < limit) return buffer[0]! % maxExclusive;
  }
}

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/**
 * Generate a strong initial password: >= 20 characters, guaranteed to carry
 * at least one lower-case, upper-case, digit and symbol character, shuffled
 * so the guaranteed categories do not sit in predictable positions.
 */
export function generateInitialPassword(length = MIN_LENGTH): string {
  if (!Number.isInteger(length) || length < MIN_LENGTH) {
    throw new Error(`initial password length must be an integer >= ${MIN_LENGTH}`);
  }
  const chars: string[] = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}