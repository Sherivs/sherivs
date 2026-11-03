import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");
const WORKFLOW_FILES = readdirSync(WORKFLOW_DIR).filter((file) => file.endsWith(".yml"));

describe("workflow action pinning", () => {
  it("pins every non-local action to a full commit SHA", () => {
    const unpinned: string[] = [];

    for (const file of WORKFLOW_FILES) {
      const source = readFileSync(join(WORKFLOW_DIR, file), "utf8");
      for (const [index, line] of source.split(/\r?\n/).entries()) {
        const match = line.match(/^\s*uses:\s*(?:"([^"]+)"|'([^']+)'|([^#\s]+))/);
        const reference = match?.[1] ?? match?.[2] ?? match?.[3];
        if (!reference || reference.startsWith("./")) continue;
        if (!/^[^@\s]+@[0-9a-f]{40}$/i.test(reference)) {
          unpinned.push(`${file}:${index + 1}: ${reference}`);
        }
      }
    }

    expect(WORKFLOW_FILES.length).toBeGreaterThan(0);
    expect(unpinned).toEqual([]);
  });
});
