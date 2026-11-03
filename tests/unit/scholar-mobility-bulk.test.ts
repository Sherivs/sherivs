import { describe, expect, it } from "vitest";
import {
  bulkMobilityFingerprint,
  bulkMobilityPreviewIsCurrent,
  type BulkMobilityItem,
} from "../../frontend/src/lib/scholar/mobility-bulk";

const items: BulkMobilityItem[] = [
  {
    student_id: "student-1",
    target_class_id: "class-2",
    movement_type: "promote",
    reason: "End-of-session promotion",
  },
  {
    student_id: "student-2",
    target_class_id: "class-2",
    movement_type: "repeat",
    reason: "End-of-session promotion",
  },
];

describe("bulk mobility preview confirmation", () => {
  it("binds the dry-run to its date and every request item", () => {
    const preview = bulkMobilityFingerprint(items, "2027-01-01");
    expect(preview).not.toBe(bulkMobilityFingerprint(items, "2027-01-02"));
    expect(preview).not.toBe(
      bulkMobilityFingerprint(
        [{ ...items[0], target_class_id: "class-3" }, items[1]],
        "2027-01-01",
      ),
    );
  });

  it("requires the preview to match the current selected students in order", () => {
    const fingerprint = bulkMobilityFingerprint(items, "2027-01-01");
    expect(
      bulkMobilityPreviewIsCurrent(
        ["student-1", "student-2"],
        ["student-1", "student-2"],
        fingerprint,
        fingerprint,
      ),
    ).toBe(true);
    expect(
      bulkMobilityPreviewIsCurrent(
        ["student-1", "student-2"],
        ["student-2", "student-1"],
        fingerprint,
        fingerprint,
      ),
    ).toBe(false);
    expect(
      bulkMobilityPreviewIsCurrent(
        ["student-1", "student-2"],
        ["student-1", "student-1"],
        fingerprint,
        fingerprint,
      ),
    ).toBe(false);
    expect(
      bulkMobilityPreviewIsCurrent(
        ["student-1", "student-2"],
        ["student-1", "student-2"],
        fingerprint,
        `${fingerprint} changed`,
      ),
    ).toBe(false);
  });
});
