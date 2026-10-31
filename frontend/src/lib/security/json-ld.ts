/** JSON-LD safe to place in a script tag. `<` would close the tag. */
export function jsonLdJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
