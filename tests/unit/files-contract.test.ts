/**
 * CoreGrid — file-contract tests (fail-closed validation, hostile filenames).
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_SIZE_BYTES,
  FILE_PURPOSES,
  sanitizeFilename,
  validateFileDescriptor,
  type FileValidationDecision,
} from "../../frontend/src/lib/files/file-contract";

function denyCodeOf(outcome: FileValidationDecision): string | null {
  return outcome.decision === "deny" ? outcome.code : null;
}

const validDescriptor = {
  tenantId: "tenant-a",
  ownerRef: "user-1",
  fileId: "file-0001",
  purpose: "document",
  contentType: "application/pdf",
  sizeBytes: 1024,
  filename: "report-card.pdf",
  sharing: { visibility: "private" },
};

describe("validateFileDescriptor (allow path)", () => {
  it("accepts a well-formed descriptor and normalizes the content type", () => {
    const outcome = validateFileDescriptor({
      ...validDescriptor,
      contentType: "  Application/PDF ",
    });
    expect(outcome.decision).toBe("allow");
    if (outcome.decision === "allow") {
      expect(outcome.descriptor.contentType).toBe("application/pdf");
      expect(outcome.descriptor.filename).toBe("report-card.pdf");
    }
  });

  it("requires grantRefs for explicit sharing", () => {
    const outcome = validateFileDescriptor({
      ...validDescriptor,
      sharing: { visibility: "explicit", grantRefs: ["grant-1"] },
    });
    expect(outcome.decision).toBe("allow");
  });
});

describe("validateFileDescriptor (fail closed on every deny path)", () => {
  it("denies non-object and malformed input", () => {
    expect(denyCodeOf(validateFileDescriptor(null))).toBe("malformed");
    expect(denyCodeOf(validateFileDescriptor("report.pdf"))).toBe("malformed");
    expect(denyCodeOf(validateFileDescriptor({ ...validDescriptor, tenantId: "" }))).toBe(
      "malformed",
    );
    expect(denyCodeOf(validateFileDescriptor({ ...validDescriptor, ownerRef: "  " }))).toBe(
      "malformed",
    );
    expect(denyCodeOf(validateFileDescriptor({ ...validDescriptor, fileId: null }))).toBe(
      "malformed",
    );
    expect(denyCodeOf(validateFileDescriptor({ ...validDescriptor, sizeBytes: 1.5 }))).toBe(
      "malformed",
    );
  });

  it("denies unknown purposes", () => {
    expect(
      denyCodeOf(validateFileDescriptor({ ...validDescriptor, purpose: "backup" })),
    ).toBe("unknown_purpose");
    expect(FILE_PURPOSES).toEqual(["attachment", "evidence", "document", "avatar"]);
  });

  it("denies non-allowlisted content types per purpose (security-negative)", () => {
    expect(
      denyCodeOf(
        validateFileDescriptor({ ...validDescriptor, contentType: "application/x-msdownload" }),
      ),
    ).toBe("content_type_not_allowed");
    // .exe-style and html smuggling types are never allowlisted anywhere.
    for (const types of Object.values(ALLOWED_CONTENT_TYPES)) {
      expect(types).not.toContain("text/html");
      expect(types).not.toContain("application/javascript");
    }
    expect(
      denyCodeOf(validateFileDescriptor({ ...validDescriptor, purpose: "avatar" })),
    ).toBe("content_type_not_allowed");
  });

  it("denies oversized payloads per purpose", () => {
    expect(
      denyCodeOf(
        validateFileDescriptor({
          ...validDescriptor,
          purpose: "avatar",
          contentType: "image/png",
          sizeBytes: MAX_SIZE_BYTES.avatar + 1,
        }),
      ),
    ).toBe("size_exceeded");
    expect(
      denyCodeOf(
        validateFileDescriptor({
          ...validDescriptor,
          sizeBytes: MAX_SIZE_BYTES.document + 1,
        }),
      ),
    ).toBe("size_exceeded");
  });

  it("denies invalid sharing shapes", () => {
    expect(
      denyCodeOf(validateFileDescriptor({ ...validDescriptor, sharing: null })),
    ).toBe("invalid_sharing");
    expect(
      denyCodeOf(
        validateFileDescriptor({ ...validDescriptor, sharing: { visibility: "public" } }),
      ),
    ).toBe("invalid_sharing");
    expect(
      denyCodeOf(
        validateFileDescriptor({ ...validDescriptor, sharing: { visibility: "explicit" } }),
      ),
    ).toBe("invalid_sharing");
    expect(
      denyCodeOf(
        validateFileDescriptor({
          ...validDescriptor,
          sharing: { visibility: "explicit", grantRefs: [] },
        }),
      ),
    ).toBe("invalid_sharing");
  });
});

describe("sanitizeFilename (hostile inputs)", () => {
  it("strips path traversal and directory components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toEqual({
      ok: true,
      filename: "passwd",
      changed: true,
    });
    expect(sanitizeFilename("C:\\Users\\victim\\secret.pdf")).toEqual({
      ok: true,
      filename: "secret.pdf",
      changed: true,
    });
    expect(sanitizeFilename("..\\..\\flag.txt")).toEqual({
      ok: true,
      filename: "flag.txt",
      changed: true,
    });
  });

  it("neutralizes control characters and hostile symbols", () => {
    const outcome = sanitizeFilename("re\u0000port;.pdf");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.filename).not.toContain("\u0000");
      expect(outcome.filename).not.toContain(";");
    }
  });

  it("fails closed when nothing safe remains", () => {
    expect(sanitizeFilename("")).toEqual({ ok: false, reason: "empty" });
    expect(sanitizeFilename("...")).toEqual({ ok: false, reason: "empty" });
    expect(sanitizeFilename("..")).toEqual({ ok: false, reason: "empty" });
    expect(sanitizeFilename("///")).toEqual({ ok: false, reason: "empty" });
  });

  it("caps length and keeps benign names unchanged", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const outcome = sanitizeFilename(long);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.filename.length).toBeLessThanOrEqual(180);
    expect(sanitizeFilename("report.pdf")).toEqual({
      ok: true,
      filename: "report.pdf",
      changed: false,
    });
  });

  it("rejects hostile filenames through the descriptor contract", () => {
    expect(
      denyCodeOf(
        validateFileDescriptor({ ...validDescriptor, filename: "../../etc/shadow" }),
      ),
    ).toBeNull(); // sanitized to a safe basename, not denied
    const outcome = validateFileDescriptor({ ...validDescriptor, filename: "..\\..\\x.sh" });
    if (outcome.decision === "allow") {
      expect(outcome.descriptor.filename).toBe("x.sh");
      expect(outcome.descriptor.filename).not.toContain("..");
    }
    expect(denyCodeOf(validateFileDescriptor({ ...validDescriptor, filename: "..." }))).toBe(
      "invalid_filename",
    );
  });
});
