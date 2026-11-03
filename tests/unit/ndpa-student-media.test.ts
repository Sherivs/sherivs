import { describe, expect, it } from "vitest";
import { CURRENT_CONSENT_POLICY_VERSION as V } from "@/lib/compliance/consent";
import { isStudentMediaPath, studentMediaPath } from "@/lib/compliance/student-media";
import { performStudentMediaUpload } from "@/lib/compliance/student-media.functions";
import { createFakeDb } from "./ndpa-fake-db";

const PNG = Buffer.from("fakepng").toString("base64");

function setup(consent: "granted" | "withdrawn" | null) {
  const db = createFakeDb({
    users: [
      { id: "t1", school_id: "A", role: "teacher", is_active: true },
      { id: "p1", school_id: "A", role: "parent", is_active: true },
      { id: "tB", school_id: "B", role: "teacher", is_active: true },
      { id: "t0", school_id: "A", role: "teacher", is_active: false },
    ],
    students: [{ id: "s1", school_id: "A" }],
    consent_records: consent
      ? [
          {
            id: "c",
            school_id: "A",
            student_id: "s1",
            purpose: "photos_media",
            status: consent,
            policy_version: V,
            lawful_basis: "consent",
            granted_by: "p1",
            granted_at: "2026-11-01T00:00:00.000Z",
            withdrawn_at: consent === "withdrawn" ? "2026-11-02T00:00:00.000Z" : null,
          },
        ]
      : [],
  });
  const uploads: { bucket: string; path: string }[] = [];
  const client = Object.assign(db, {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => (uploads.push({ bucket, path }), { error: null }),
      }),
    },
  });
  return { db, client, uploads };
}
const input = { studentId: "s1", contentType: "image/png", base64: PNG };

describe("student media upload (photos_media consent)", () => {
  it("denied without consent (and audited)", async () => {
    const { db, client, uploads } = setup(null);
    await expect(
      performStudentMediaUpload({ adminClient: client, actorId: "t1", input }),
    ).rejects.toThrow(/Consent required/);
    expect(uploads).toHaveLength(0);
    expect(
      db.tables.audit_logs.some((a) => (a.new_value as { outcome: string }).outcome === "denied"),
    ).toBe(true);
  });
  it("denied after withdrawal", async () => {
    const { client, uploads } = setup("withdrawn");
    await expect(
      performStudentMediaUpload({ adminClient: client, actorId: "t1", input }),
    ).rejects.toThrow(/Consent/);
    expect(uploads).toHaveLength(0);
  });
  it("allowed with consent: stored under the school's student prefix and audited", async () => {
    const { db, client, uploads } = setup("granted");
    const out = await performStudentMediaUpload({ adminClient: client, actorId: "t1", input });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe("school-media");
    expect(uploads[0].path).toMatch(/^A\/students\/s1\/[0-9a-f-]+\.png$/);
    expect(isStudentMediaPath(out.path)).toBe(true);
    expect(
      db.tables.audit_logs.some(
        (a) => (a.new_value as { outcome: string }).outcome === "succeeded",
      ),
    ).toBe(true);
  });
  it("rejects parents, other-school staff, inactive staff and bad types", async () => {
    for (const actorId of ["p1", "tB", "t0"]) {
      const { client, uploads } = setup("granted");
      await expect(
        performStudentMediaUpload({ adminClient: client, actorId, input }),
      ).rejects.toThrow(/Forbidden/);
      expect(uploads).toHaveLength(0);
    }
    const { client } = setup("granted");
    await expect(
      performStudentMediaUpload({
        adminClient: client,
        actorId: "t1",
        input: { ...input, contentType: "text/html" },
      }),
    ).rejects.toThrow(/Unsupported/);
  });
  it("website and staff media paths are not student media paths", () => {
    expect(isStudentMediaPath("A/1700-abc.jpg")).toBe(false);
    expect(isStudentMediaPath("A/staff/u1/portrait.jpg")).toBe(false);
    expect(isStudentMediaPath("A/gallery/students.jpg")).toBe(false);
    expect(isStudentMediaPath(studentMediaPath("A", "s1", "x.png"))).toBe(true);
  });
});
