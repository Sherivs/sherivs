import { describe, expect, it } from "vitest";
import {
  CURRENT_CONSENT_POLICY_VERSION as V,
  CONSENT_PURPOSES,
  OPTIONAL_PURPOSES,
  decideConsent,
} from "@/lib/compliance/consent";
import {
  filterConsentedStudents,
  hasConsent,
  performConsentChange,
} from "@/lib/compliance/consent.functions";
import { createFakeDb } from "./ndpa-fake-db";

const rec = (purpose: string, status: string, policy_version = V, student_id = "s1") => ({
  student_id,
  purpose,
  status,
  policy_version,
  lawful_basis: "consent",
  granted_by: "guardian",
  granted_at: "2026-11-01T00:00:00.000Z",
  withdrawn_at: status === "withdrawn" ? "2026-11-02T00:00:00.000Z" : null,
  updated_at: status === "withdrawn" ? "2026-11-02T00:00:00.000Z" : "2026-11-01T00:00:00.000Z",
});

describe("decideConsent", () => {
  it("every purpose defaults to denied and withdrawal supersedes an earlier grant", () => {
    for (const purpose of CONSENT_PURPOSES) expect(decideConsent([], "s1", purpose)).toBe(false);
    expect(decideConsent([rec("core_education", "withdrawn")], "s1", "core_education")).toBe(false);
    expect(
      decideConsent([rec("core_education", "withdrawn", V, "s2")], "s1", "core_education"),
    ).toBe(false);
    expect(
      decideConsent(
        [
          rec("ai_processing", "granted"),
          { ...rec("ai_processing", "withdrawn"), withdrawn_at: "2026-11-02T00:00:00.000Z" },
        ],
        "s1",
        "ai_processing",
      ),
    ).toBe(false);
  });
  it("optional purposes default DENY", () => {
    expect(OPTIONAL_PURPOSES).not.toContain("core_education");
    for (const p of OPTIONAL_PURPOSES) expect(decideConsent([], "s1", p)).toBe(false);
  });
  it("requires granted + current policy version", () => {
    expect(decideConsent([rec("ai_processing", "granted")], "s1", "ai_processing")).toBe(true);
    expect(decideConsent([rec("ai_processing", "granted", "old")], "s1", "ai_processing")).toBe(
      false,
    );
    expect(decideConsent([rec("ai_processing", "withdrawn")], "s1", "ai_processing")).toBe(false);
    expect(decideConsent([rec("photos_media", "granted")], "s1", "ai_processing")).toBe(false);
    expect(decideConsent([rec("ai_processing", "granted", V, "s2")], "s1", "ai_processing")).toBe(
      false,
    );
    expect(
      decideConsent(
        [{ ...rec("ai_processing", "granted"), lawful_basis: null }],
        "s1",
        "ai_processing",
      ),
    ).toBe(false);
  });
});

const seed = () => ({
  users: [
    { id: "g1", school_id: "A", role: "parent", is_active: true },
    { id: "g2", school_id: "A", role: "parent", is_active: true },
    { id: "payer", school_id: "A", role: "parent", is_active: true },
    { id: "caregiver", school_id: "A", role: "parent", is_active: true },
    { id: "adminA", school_id: "A", role: "admin", is_active: true },
    { id: "adminB", school_id: "B", role: "admin", is_active: true },
    { id: "t1", school_id: "A", role: "teacher", is_active: true },
  ],
  students: [
    { id: "s1", school_id: "A", user_id: null, date_of_birth: "2015-01-01" },
    { id: "s2", school_id: "A", user_id: null, date_of_birth: "2014-01-01" },
  ],
  student_guardian_relationships: [
    {
      id: "m1",
      related_user_id: "g1",
      student_id: "s1",
      school_id: "A",
      relationship_type: "legal_guardian",
      effective_from: "2026-01-01",
      effective_until: null,
    },
    {
      id: "m2",
      related_user_id: "g2",
      student_id: "s2",
      school_id: "A",
      relationship_type: "parent",
      effective_from: "2026-01-01",
      effective_until: null,
    },
  ],
});

const input = (studentId: string, action: "grant" | "withdraw" = "grant") => ({
  studentId,
  purpose: "ai_processing" as const,
  action,
  lawfulBasis: "consent" as const,
});

describe("performConsentChange", () => {
  it("guardian of the student can grant; consent row, event and audit written", async () => {
    const db = createFakeDb(seed());
    const r = await performConsentChange({ adminClient: db, actorId: "g1", input: input("s1") });
    expect(r.status).toBe("granted");
    expect(db.tables.consent_records).toHaveLength(1);
    expect(db.tables.consent_records[0]).toMatchObject({
      school_id: "A",
      student_id: "s1",
      capture_method: "web_form",
      guardian_user_id: "g1",
    });
    expect(db.tables.consent_events).toHaveLength(1);
    expect(db.tables.audit_logs).toHaveLength(1);
    expect(db.tables.audit_logs[0]).toMatchObject({ action: "consent.grant", school_id: "A" });
    expect(await hasConsent(db, "s1", "ai_processing", "A")).toBe(true);
    expect(await hasConsent(db, "s2", "ai_processing", "A")).toBe(false);
  });

  it("withdrawal updates the single row and appends an event", async () => {
    const db = createFakeDb(seed());
    await performConsentChange({ adminClient: db, actorId: "g1", input: input("s1") });
    await performConsentChange({ adminClient: db, actorId: "g1", input: input("s1", "withdraw") });
    expect(db.tables.consent_records).toHaveLength(1);
    expect(db.tables.consent_records[0].status).toBe("withdrawn");
    expect(db.tables.consent_events.map((e) => e.action)).toEqual(["grant", "withdraw"]);
    expect(await hasConsent(db, "s1", "ai_processing", "A")).toBe(false);
  });

  it("guardian of another student is denied and nothing is written but a denial audit", async () => {
    const db = createFakeDb(seed());
    await expect(
      performConsentChange({ adminClient: db, actorId: "g2", input: input("s1") }),
    ).rejects.toThrow(/Forbidden/);
    expect(db.tables.consent_records ?? []).toHaveLength(0);
    expect(db.tables.consent_events ?? []).toHaveLength(0);
    expect(db.tables.audit_logs[0].new_value).toMatchObject({ outcome: "denied" });
  });

  it("other-school admin and teacher are denied", async () => {
    const db = createFakeDb(seed());
    await expect(
      performConsentChange({ adminClient: db, actorId: "adminB", input: input("s1") }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      performConsentChange({ adminClient: db, actorId: "t1", input: input("s1") }),
    ).rejects.toThrow(/Forbidden/);
    expect(db.tables.consent_records ?? []).toHaveLength(0);
  });

  it("same-school admin may record evidenced paper consent for a verified guardian; guardian cannot pick paper_signed", async () => {
    const db = createFakeDb(seed());
    await performConsentChange({
      adminClient: db,
      actorId: "adminA",
      input: {
        ...input("s1"),
        captureMethod: "paper_signed",
        grantedByUserId: "g1",
        notes: "Form A-14",
      },
    });
    expect(db.tables.consent_records[0]).toMatchObject({
      capture_method: "paper_signed",
      guardian_user_id: "g1",
      granted_by: "g1",
      lawful_basis: "consent",
    });
    const db2 = createFakeDb(seed());
    await performConsentChange({
      adminClient: db2,
      actorId: "g1",
      input: { ...input("s1"), captureMethod: "paper_signed" },
    });
    expect(db2.tables.consent_records[0].capture_method).toBe("web_form");
  });

  it("an adult learner may consent for themself, but a fee payer or caregiver may not", async () => {
    const adultDb = createFakeDb({
      ...seed(),
      users: [...seed().users, { id: "adult", school_id: "A", role: "student", is_active: true }],
      students: [
        ...seed().students,
        { id: "adultStudent", school_id: "A", user_id: "adult", date_of_birth: "2000-01-01" },
      ],
    });
    await performConsentChange({
      adminClient: adultDb,
      actorId: "adult",
      input: { ...input("adultStudent"), lawfulBasis: "consent" },
    });
    expect(adultDb.tables.consent_records[0].granted_by).toBe("adult");

    const minorSelfDb = createFakeDb({
      ...seed(),
      users: [...seed().users, { id: "minor", school_id: "A", role: "student", is_active: true }],
      students: [
        ...seed().students,
        { id: "minorStudent", school_id: "A", user_id: "minor", date_of_birth: "2014-01-01" },
      ],
    });
    await expect(
      performConsentChange({
        adminClient: minorSelfDb,
        actorId: "minor",
        input: { ...input("minorStudent"), lawfulBasis: "consent" },
      }),
    ).rejects.toThrow(/Forbidden/);

    for (const relationship_type of ["fee_payer", "caregiver"]) {
      const db = createFakeDb({
        ...seed(),
        student_guardian_relationships: [
          ...seed().student_guardian_relationships,
          {
            id: `m-${relationship_type}`,
            related_user_id: relationship_type === "fee_payer" ? "payer" : "caregiver",
            student_id: "s1",
            school_id: "A",
            relationship_type,
            records_access: relationship_type === "caregiver",
            effective_from: "2026-01-01",
            effective_until: null,
          },
        ],
      });
      await expect(
        performConsentChange({
          adminClient: db,
          actorId: relationship_type === "fee_payer" ? "payer" : "caregiver",
          input: input("s1"),
        }),
      ).rejects.toThrow(/Forbidden/);
      expect(db.tables.consent_records ?? []).toHaveLength(0);
    }
  });

  it("filterConsentedStudents returns only students with current grants", async () => {
    const db = createFakeDb(seed());
    await performConsentChange({ adminClient: db, actorId: "g1", input: input("s1") });
    const ok = await filterConsentedStudents(db, ["s1", "s2"], "ai_processing", "A");
    expect([...ok]).toEqual(["s1"]);
  });
});
