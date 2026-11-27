import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("PUSH-02 fanout insert RLS safety", () => {
  it("does not chain select() after insert(rows) in notifications fanout", () => {
    const source = readFileSync(
      "frontend/src/lib/runtime/scholar/notifications-fanout.functions.ts",
      "utf8",
    );
    expect(source).not.toMatch(/\.insert\(rows\)\s*\.select\(/g);
  });
});
