import { describe, expect, it } from "vitest";
import { jsonLdJson } from "@/lib/security/json-ld";

describe("JSON-LD script sink", () => {
  it("does not let a string close the surrounding script tag", () => {
    const encoded = jsonLdJson({ name: "</script><script>alert(1)</script>" });
    expect(encoded).not.toContain("<");
    expect(encoded).toContain("\\u003c/script");
    expect(JSON.parse(encoded).name).toBe("</script><script>alert(1)</script>");
  });
});
