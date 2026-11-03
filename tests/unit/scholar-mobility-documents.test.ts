import { describe, expect, it } from "vitest";
import { mobilityDocumentLines } from "../../frontend/src/lib/scholar/mobility-documents";

describe("student mobility documents", () => {
  it("builds a transfer certificate from recorded placements without finance or approval data", () => {
    const lines = mobilityDocumentLines(
      "transfer-certificate",
      { fullName: "Ada Okafor", admissionNumber: "UA-1001" },
      [
        {
          className: "JSS 1 · Central Campus",
          movementType: "promote",
          reason: "Completed the academic year",
          effectiveFrom: "2025-09-01T00:00:00.000Z",
          effectiveTo: "2026-08-31T23:59:59.000Z",
          session: "2025/2026",
        },
      ],
    );
    expect(lines[0]).toBe("Transfer certificate");
    expect(lines[1]).toContain("Ada Okafor");
    expect(lines.join("\n")).toContain("2025-09-01 to 2026-08-31");
    expect(lines.at(-1)).toContain("Review and complete");
    expect(lines.join("\n")).not.toContain("fee");
    expect(lines.join("\n")).not.toContain("approver");
  });

  it("labels movement record output and safely handles missing records", () => {
    expect(
      mobilityDocumentLines(
        "movement-record",
        { fullName: "Ada Okafor", admissionNumber: null },
        [],
      ),
    ).toEqual([
      "Student movement record",
      "Student: Ada Okafor",
      "Admission number: Not recorded",
      "Recorded placement history:",
      "Institution-generated record. Review and complete any required institutional authorization before issue.",
    ]);
  });
});
