import { describe, expect, it } from "vitest";
import {
  describeApprovalCategory,
  maskPreviewValue,
  renderApprovalPreview,
  shortDigest,
} from "@/lib/workflow/approval-preview";

describe("WF-07 approval preview", () => {
  it("fills the approved template with the drafted values", () => {
    const preview = renderApprovalPreview({
      templateBody: "Hello {{ name }}, fees of {{amount}} are due on {{date}}.",
      params: { name: "Ada", amount: 4500, date: "Friday" },
    });
    expect(preview.text).toBe("Hello Ada, fees of 4500 are due on Friday.");
    expect(preview.unfilled).toEqual([]);
    expect(preview.masked).toBe(0);
  });

  it("masks email addresses and long digit runs so the inbox holds no second copy of contact data", () => {
    expect(maskPreviewValue("parent@example.com").value).toBe("p***@example.com");
    expect(maskPreviewValue("call +234 803 123 4567").masked).toBe(true);
    expect(maskPreviewValue("call +234 803 123 4567").value).not.toMatch(/803/);
    expect(maskPreviewValue("Room 12").masked).toBe(false);
    expect(maskPreviewValue("1234").masked).toBe(false);
    const preview = renderApprovalPreview({
      templateBody: "Reach {{contact}}",
      params: { contact: "ada@example.org" },
    });
    expect(preview.text).toBe("Reach a***@example.org");
    expect(preview.masked).toBe(1);
  });

  it("reports placeholders that have no value and leaves them visible", () => {
    const preview = renderApprovalPreview({
      templateBody: "Dear {{guardian}}, {{child}} was absent.",
      params: { child: "Tobi" },
    });
    expect(preview.text).toBe("Dear {{guardian}}, Tobi was absent.");
    expect(preview.unfilled).toEqual(["guardian"]);
  });

  it("does not read inherited object keys or non-scalar values", () => {
    const preview = renderApprovalPreview({
      templateBody: "{{constructor}} {{nested}}",
      params: { nested: { a: 1 } },
    });
    expect(preview.text).toBe("{{constructor}} {{nested}}");
    expect([...preview.unfilled].sort()).toEqual(["constructor", "nested"]);
  });

  it("caps long values and long templates", () => {
    const long = "x".repeat(500);
    expect(maskPreviewValue(long).value.length).toBeLessThanOrEqual(120);
    const preview = renderApprovalPreview({ templateBody: "y".repeat(10_000), params: {} });
    expect(preview.text?.length).toBe(4_000);
  });

  it("returns no text when the template body is not held in the workflow store", () => {
    expect(renderApprovalPreview({ templateBody: null, params: { a: "b" } })).toEqual({
      text: null,
      unfilled: [],
      masked: 0,
    });
    expect(renderApprovalPreview({ templateBody: undefined, params: undefined }).text).toBeNull();
  });

  it("labels categories in plain language and falls back safely", () => {
    expect(describeApprovalCategory("money_movement")).toBe("Money movement");
    expect(describeApprovalCategory("safeguarding")).toBe("Safeguarding");
    expect(describeApprovalCategory("mass_message")).toBe("Mass message");
    expect(describeApprovalCategory("some_new_category")).toBe("Some new category");
    expect(describeApprovalCategory(null)).toBe("Approval");
  });

  it("shows a compact fingerprint", () => {
    const digest = "0123456789abcdef".repeat(4);
    expect(shortDigest(digest)).toBe("01234567…89abcdef");
    expect(shortDigest("")).toBe("");
    expect(shortDigest(null)).toBe("");
  });
});
