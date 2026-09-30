// ─── Phase 25 — Institutional Onboarding, Administration & Workforce Identity ───
import { describe, it, expect } from "vitest";
import {
  createInstitution,
  markInstitutionSetupComplete,
  createCampus,
  createRoom,
  validateLanguageConfig,
  validateTimezoneConfig,
  addInstitutionToGroup,
  institutionId,
  campusId,
  roomId,
  floorId,
  premisesId,
  buildingId,
  shiftId,
  languageConfigId,
  timezoneConfigId,
} from "@/lib/institution-core";
import {
  createWorkforceRole,
  resolveRoleInheritance,
  detectRoleConflicts,
  createWorkforceContext,
  isContextEffective,
  createWorkforceAssignment,
  grantJustInTimeAccess,
  isJustInTimeAccessActive,
  revokeJustInTimeAccess,
  transitionStaffLifecycle,
  canTransitionStaffLifecycle,
  createStaffTransfer,
  completeStaffTransferRecalculation,
  isStaffProfileActive,
  workforceRoleId,
  workforceContextId,
  workforceAssignmentId,
  reportingRelationshipImpliesPermission,
} from "@/lib/workforce-core";
import {
  createStaffInvitation,
  redeemInvitation,
  revokeInvitation,
  expireInvitation,
  createOnboardingJourney,
  isOnboardingStepPermitted,
  startOnboarding,
  updateOnboardingStep,
  isOnboardingComplete,
  selectFirstTasks,
  acknowledgePolicy,
  hasAcknowledgedPolicyVersion,
  staffInvitationId,
  onboardingJourneyId,
  onboardingProgressId,
  policyAcknowledgementId,
  onboardingStepId,
} from "@/lib/onboarding-core";
import {
  createAttendanceQRSession,
  redeemQRSession,
  enrollBiometric,
  revokeBiometricEnrollment,
  evaluateBiometricVerification,
  biometricVerificationCreatesAuthorization,
  rejectIfSpoofingSignal,
  authorizeAttendance,
  assessAttendanceRisk,
  isBiometricAttendanceAllowed,
  attendanceQRSessionId,
  biometricEnrollmentId,
  attendanceRiskAssessmentId,
} from "@/lib/attendance-identity";
import {
  createAdminDelegation,
  revokeAdminDelegation,
  isAdminDelegationActive,
  createBreakGlassAccess,
  recordBreakGlassReview,
  createImpersonationSession,
  endImpersonationSession,
  isImpersonationActive,
  explainPermissionDenial,
  resolveVisibleFeatures,
  recomposeWorkspace,
  simulatePolicyChange,
  buildAccessPreview,
  isSelfServiceActionForbidden,
  createAdminSuccession,
  isEmergencyRecoveryPermitted,
  adminDelegationId,
  breakGlassAccessId,
  impersonationSessionId,
  policySimulationId,
  accessPreviewId,
} from "@/lib/institution-admin";
import type { TenantId } from "@/lib/tenant-core";

const TENANT = "tenant-a" as TenantId;
const INST = institutionId("inst-1");

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    legalName: "Greenfield International School",
    displayName: "Greenfield",
    institutionType: "secondary" as const,
    ownershipType: "private" as const,
    registrationRefs: ["RC-12345"],
    accreditationRefs: [],
    country: "Nigeria",
    region: "Lagos",
    stateProvince: "Lagos",
    localGovernmentArea: "Ikeja",
    officialEmailDomains: ["greenfield.sch.ng"],
    website: "https://greenfield.sch.ng",
    currency: "NGN",
    operatingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    operatingHours: "07:30-15:30",
    ...overrides,
  };
}

describe("institution-core — Institution Creation (D, E, AE)", () => {
  it("creates institution with pending setup", () => {
    const r = createInstitution({
      id: INST,
      tenantId: TENANT,
      profile: baseProfile(),
      identityRef: "id-org-1",
      defaultPolicySetRef: "pol-admin-1",
      initialAdministratorRef: "id-admin-1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.institution.setupComplete).toBe(false);
      expect(r.institution.initialAdministratorRef).toBe("id-admin-1");
      expect(r.profile.officialEmailDomains).toContain("greenfield.sch.ng");
    }
  });
  it("rejects missing legal name", () => {
    const r = createInstitution({
      id: INST,
      tenantId: TENANT,
      profile: baseProfile({ legalName: "" }),
      identityRef: "id-1",
      defaultPolicySetRef: "pol-1",
      initialAdministratorRef: "id-admin-1",
    });
    expect(r.ok).toBe(false);
  });
  it("rejects missing official email domain", () => {
    const r = createInstitution({
      id: INST,
      tenantId: TENANT,
      profile: baseProfile({ officialEmailDomains: [] }),
      identityRef: "id-1",
      defaultPolicySetRef: "pol-1",
      initialAdministratorRef: "id-admin-1",
    });
    expect(r.ok).toBe(false);
  });
  it("rejects missing initial administrator", () => {
    const r = createInstitution({
      id: INST,
      tenantId: TENANT,
      profile: baseProfile(),
      identityRef: "id-1",
      defaultPolicySetRef: "pol-1",
      initialAdministratorRef: "",
    });
    expect(r.ok).toBe(false);
  });
  it("marks setup complete", () => {
    const r = createInstitution({
      id: INST,
      tenantId: TENANT,
      profile: baseProfile(),
      identityRef: "id-1",
      defaultPolicySetRef: "pol-1",
      initialAdministratorRef: "id-admin-1",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(markInstitutionSetupComplete(r.institution).setupComplete).toBe(true);
  });
});

describe("institution-core — Locations (J, K, L)", () => {
  it("creates campus", () => {
    const c = createCampus({
      id: campusId("campus-1"),
      institutionId: INST,
      tenantId: TENANT,
      name: "Main Campus",
      location: "Ikeja",
    });
    expect(c.isActive).toBe(true);
  });
  it("rejects empty campus name", () => {
    expect(() =>
      createCampus({
        id: campusId("campus-2"),
        institutionId: INST,
        tenantId: TENANT,
        name: "",
        location: "X",
      }),
    ).toThrow();
  });
  it("rejects non-positive room capacity", () => {
    expect(() =>
      createRoom({
        id: roomId("room-1"),
        floorId: floorId("fl-1"),
        tenantId: TENANT,
        name: "Lab 1",
        kind: "laboratory",
        capacity: 0,
      }),
    ).toThrow();
  });
  it("builds location chain ids", () => {
    expect(`${premisesId("p")}${buildingId("b")}${floorId("f")}`).toBe("pbf");
  });
});

describe("institution-core — Language & Timezone (O, N)", () => {
  it("validates single default language", () => {
    const langs = [
      {
        id: languageConfigId("l1"),
        tenantId: TENANT,
        code: "en",
        label: "English",
        roles: ["default" as const],
        isActive: true,
      },
      {
        id: languageConfigId("l2"),
        tenantId: TENANT,
        code: "ig",
        label: "Igbo",
        roles: ["instructional" as const],
        isActive: true,
      },
    ];
    expect(validateLanguageConfig(langs).ok).toBe(true);
  });
  it("rejects duplicate default languages", () => {
    const langs = [
      {
        id: languageConfigId("l1"),
        tenantId: TENANT,
        code: "en",
        label: "English",
        roles: ["default" as const],
        isActive: true,
      },
      {
        id: languageConfigId("l2"),
        tenantId: TENANT,
        code: "fr",
        label: "French",
        roles: ["default" as const],
        isActive: true,
      },
    ];
    expect(validateLanguageConfig(langs).ok).toBe(false);
  });
  it("rejects duplicate timezones", () => {
    const tzs = [
      {
        id: timezoneConfigId("t1"),
        tenantId: TENANT,
        ianaName: "Africa/Lagos",
        canonicalOffset: "+01:00",
        isDefault: true,
        isActive: true,
      },
      {
        id: timezoneConfigId("t2"),
        tenantId: TENANT,
        ianaName: "Africa/Lagos",
        canonicalOffset: "+01:00",
        isDefault: false,
        isActive: true,
      },
    ];
    expect(validateTimezoneConfig(tzs).ok).toBe(false);
  });
});

describe("institution-core — School Group (I)", () => {
  it("adds institution to group", () => {
    const g = {
      id: "g1" as never,
      tenantId: TENANT,
      name: "Group",
      institutionIds: [INST],
      isActive: true,
    };
    const r = addInstitutionToGroup(g, institutionId("inst-2"));
    expect(r.ok).toBe(true);
  });
  it("rejects duplicate group membership", () => {
    const g = {
      id: "g1" as never,
      tenantId: TENANT,
      name: "Group",
      institutionIds: [INST],
      isActive: true,
    };
    expect(addInstitutionToGroup(g, INST).ok).toBe(false);
  });
});

describe("workforce-core — Roles (P, T, U)", () => {
  it("creates base role", () => {
    const r = createWorkforceRole({
      id: workforceRoleId("r1"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "base",
      key: "staff",
      name: "Staff",
      permissions: ["attendance.record"],
    });
    expect(r.ok).toBe(true);
  });
  it("rejects derived role without parent", () => {
    const r = createWorkforceRole({
      id: workforceRoleId("r2"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "derived",
      key: "teacher",
      name: "Teacher",
    });
    expect(r.ok).toBe(false);
  });
  it("resolves role inheritance", () => {
    const base = createWorkforceRole({
      id: workforceRoleId("rb"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "base",
      key: "staff",
      name: "Staff",
      permissions: ["attendance.record"],
      capabilities: ["read_staff_directory"],
    });
    const derived = createWorkforceRole({
      id: workforceRoleId("rd"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "derived",
      parentRoleId: workforceRoleId("rb"),
      key: "department_head",
      name: "Department Head",
      permissions: ["attendance.correct"],
    });
    if (!base.ok || !derived.ok) throw new Error("expected ok");
    const map = new Map([
      [workforceRoleId("rb"), base.role],
      [workforceRoleId("rd"), derived.role],
    ]);
    const eff = resolveRoleInheritance(derived.role, map);
    expect(eff.permissions).toContain("attendance.record");
    expect(eff.permissions).toContain("attendance.correct");
    expect(eff.capabilities).toContain("read_staff_directory");
  });
  it("detects conflicting permissions", () => {
    const a = createWorkforceRole({
      id: workforceRoleId("ra"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "base",
      key: "a",
      name: "A",
      permissions: ["student.read"],
    });
    const b = createWorkforceRole({
      id: workforceRoleId("rb"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "base",
      key: "b",
      name: "B",
      permissions: ["!student.read"],
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    const conflicts = detectRoleConflicts([a.role, b.role]);
    expect(conflicts.some((c) => c.type === "conflicting_permissions")).toBe(true);
  });
  it("detects separation of duty violations", () => {
    const req = createWorkforceRole({
      id: workforceRoleId("rq"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "base",
      key: "requester",
      name: "Requester",
    });
    const app = createWorkforceRole({
      id: workforceRoleId("rp"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "base",
      key: "approver",
      name: "Approver",
    });
    if (!req.ok || !app.ok) throw new Error("expected ok");
    const conflicts = detectRoleConflicts([req.role, app.role], {
      separationOfDutyPairs: [["requester", "approver"]],
    });
    expect(conflicts.some((c) => c.type === "separation_of_duty")).toBe(true);
  });
  it("detects excessive privilege", () => {
    const perms = Array.from({ length: 45 }, (_, i) => `resource${i}.read`);
    const r = createWorkforceRole({
      id: workforceRoleId("rp"),
      tenantId: TENANT,
      institutionId: INST,
      kind: "base",
      key: "broad",
      name: "Broad",
      permissions: perms,
    });
    if (!r.ok) throw new Error("expected ok");
    expect(detectRoleConflicts([r.role]).some((c) => c.type === "excessive_privilege")).toBe(true);
  });
});

describe("workforce-core — Context & Assignment (V, W, S)", () => {
  it("creates context and evaluates effectiveness", () => {
    const ctx = createWorkforceContext({
      id: workforceContextId("c1"),
      tenantId: TENANT,
      institutionId: INST,
      campusId: campusId("campus-1"),
      classRefs: ["class-1"],
      subjectRefs: ["subject-1"],
      shiftId: shiftId("shift-1"),
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    expect(isContextEffective(ctx, "2026-01-01T00:00:00.000Z")).toBe(true);
  });
  it("context is not effective after end date", () => {
    const ctx = createWorkforceContext({
      id: workforceContextId("c2"),
      tenantId: TENANT,
      institutionId: INST,
      effectiveFrom: "2025-01-01T00:00:00.000Z",
      effectiveTo: "2025-12-31T00:00:00.000Z",
    });
    expect(isContextEffective(ctx, "2026-06-01T00:00:00.000Z")).toBe(false);
  });
  it("rejects assignment with past expiry", () => {
    const r = createWorkforceAssignment({
      id: workforceAssignmentId("a1"),
      tenantId: TENANT,
      institutionId: INST,
      identityRef: "id-1",
      roleId: workforceRoleId("r1"),
      contextId: workforceContextId("c1"),
      expiresAt: "2020-01-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(false);
  });
  it("reporting relationships never imply permissions", () => {
    expect(reportingRelationshipImpliesPermission()).toBe(false);
  });
});

describe("workforce-core — JIT Access (AD)", () => {
  it("grants scoped temporary access", () => {
    const r = grantJustInTimeAccess({
      id: "jit-1" as never,
      tenantId: TENANT,
      institutionId: INST,
      subjectRef: "id-1",
      issuerRef: "id-admin-1",
      reason: "Coverage during sick leave",
      scope: ["attendance.record"],
      durationMinutes: 120,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(true);
  });

  describe("workforce-core — Staff Lifecycle (BD, BE, BH)", () => {
    it("validates lifecycle transitions", () => {
      expect(canTransitionStaffLifecycle("INVITED", "ACTIVATING")).toBe(true);
      expect(canTransitionStaffLifecycle("INVITED", "ARCHIVED")).toBe(false);
    });
    it("transitions staff lifecycle", () => {
      const rec = {
        identityRef: "id-1",
        tenantId: TENANT,
        institutionId: INST,
        state: "INVITED" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const r = transitionStaffLifecycle(rec, "ACTIVATING", "id-admin-1", "Invitation accepted");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.record.state).toBe("ACTIVATING");
    });
    it("deactivation requires a reason", () => {
      const rec = {
        identityRef: "id-1",
        tenantId: TENANT,
        institutionId: INST,
        state: "ACTIVE" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      expect(transitionStaffLifecycle(rec, "DEACTIVATED", "id-admin-1", "").ok).toBe(false);
    });
    it("transfer triggers recalculation", () => {
      const t = createStaffTransfer({
        id: workforceAssignmentId("t1"),
        tenantId: TENANT,
        identityRef: "id-1",
        kind: "department",
        fromRef: "dept-a",
        toRef: "dept-b",
        performedBy: "id-admin-1",
      });
      expect(t.recalculationRequired).toBe(true);
      expect(t.recalculationStatus).toBe("pending");
      expect(completeStaffTransferRecalculation(t).recalculationStatus).toBe("completed");
    });
  });

  describe("workforce-core — Employment & Temporary Staff (DJ, DK, DL)", () => {
    it("active profile is active", () => {
      const p = {
        identityRef: "id-1",
        tenantId: TENANT,
        institutionId: INST,
        employmentStatus: "active" as const,
        qualificationRefs: [],
        temporaryCategory: null,
        contractExpiresAt: null,
        onboardingRef: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      };
      expect(isStaffProfileActive(p)).toBe(true);
    });
    it("expired contract deactivates temporary staff", () => {
      const p = {
        identityRef: "id-1",
        tenantId: TENANT,
        institutionId: INST,
        employmentStatus: "active" as const,
        qualificationRefs: [],
        temporaryCategory: "contractor" as const,
        contractExpiresAt: "2025-12-31T00:00:00.000Z",
        onboardingRef: null,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
      };
      expect(isStaffProfileActive(p, "2026-06-01T00:00:00.000Z")).toBe(false);
    });
  });

  describe("onboarding-core — Invitations (AN, AP, AQ)", () => {
    const base = {
      id: staffInvitationId("inv-1"),
      tenantId: TENANT,
      institutionId: INST,
      inviterRef: "id-admin-1",
      email: "teacher@greenfield.sch.ng",
      roleId: workforceRoleId("r1"),
      tokenFingerprint: "fp-abc123",
      expiresAt: "2027-01-01T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z",
    };
    it("creates invitation", () => {
      expect(createStaffInvitation(base).ok).toBe(true);
    });
    it("rejects invalid email", () => {
      expect(createStaffInvitation({ ...base, email: "not-an-email" }).ok).toBe(false);
    });
    it("rejects past expiry", () => {
      expect(createStaffInvitation({ ...base, expiresAt: "2020-01-01T00:00:00.000Z" }).ok).toBe(
        false,
      );
    });
    it("redeems single-use invitation", () => {
      const r = createStaffInvitation(base);
      if (!r.ok) throw new Error("expected ok");
      const redeemed = redeemInvitation(r.invitation, "fp-abc123", "2026-06-01T00:00:00.000Z");
      expect(redeemed.ok).toBe(true);
      if (redeemed.ok) expect(redeemed.invitation.status).toBe("accepted");
    });
    it("rejects wrong token", () => {
      const r = createStaffInvitation(base);
      if (!r.ok) throw new Error("expected ok");
      expect(redeemInvitation(r.invitation, "fp-wrong", "2026-06-01T00:00:00.000Z").ok).toBe(false);
    });
    it("rejects replay after acceptance", () => {
      const r = createStaffInvitation(base);
      if (!r.ok) throw new Error("expected ok");
      const redeemed = redeemInvitation(r.invitation, "fp-abc123", "2026-06-01T00:00:00.000Z");

      describe("onboarding-core — Journeys (AS, AT, AY, AZ)", () => {
        it("creates journey with steps", () => {
          const r = createOnboardingJourney({
            id: onboardingJourneyId("j1"),
            tenantId: TENANT,
            institutionId: INST,
            name: "Teacher Journey",
            roleKeys: ["teacher"],
            steps: [
              {
                key: "welcome",
                requiredCapability: null,
                forbiddenPolicy: null,
                minExperienceLevel: "beginner",
              },
              {
                key: "role",
                requiredCapability: null,
                forbiddenPolicy: null,
                minExperienceLevel: "beginner",
              },
            ],
          });
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.journey.steps).toHaveLength(2);
        });
        it("policy-aware step is permitted only for authorized users", () => {
          const step = {
            id: onboardingStepId("s1"),
            journeyId: onboardingJourneyId("j1"),
            key: "first_task" as const,
            requiredCapability: "attendance.record",
            forbiddenPolicy: "pol-no-attendance",
            minExperienceLevel: "beginner" as const,
          };
          expect(isOnboardingStepPermitted(step, ["attendance.record"], ["pol-a"])).toBe(true);
          expect(
            isOnboardingStepPermitted(step, ["attendance.record"], ["pol-no-attendance"]),
          ).toBe(false);
          expect(isOnboardingStepPermitted(step, [], ["pol-a"])).toBe(false);
        });
        it("first tasks respect capabilities", () => {
          const tasks = [
            {
              key: "record-attendance",
              label: "Record attendance",
              requiredCapability: "attendance.record",
              autoExecutable: false,
            },
            {
              key: "review-finance",
              label: "Review finance",
              requiredCapability: "finance.read",
              autoExecutable: false,
            },
          ];
          expect(selectFirstTasks(tasks, ["attendance.record"])).toHaveLength(1);
        });
      });

      describe("onboarding-core — Progress & Acknowledgement (BA, BB, DZ, ED)", () => {
        it("tracks onboarding progress to completion", () => {
          const steps = [
            {
              key: "welcome",
              requiredCapability: null,
              forbiddenPolicy: null,
              minExperienceLevel: "beginner",
            },
            {
              key: "identity",
              requiredCapability: null,
              forbiddenPolicy: null,
              minExperienceLevel: "beginner",
            },
          ];
          let p = startOnboarding({
            id: onboardingProgressId("p1"),
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            journeyId: onboardingJourneyId("j1"),
            journeyVersion: 1,
            steps: steps as never,
            now: "2026-01-01T00:00:00.000Z",
          });
          expect(isOnboardingComplete(p)).toBe(false);
          p = updateOnboardingStep(p, "welcome", "completed");
          p = updateOnboardingStep(p, "identity", "completed");
          expect(isOnboardingComplete(p)).toBe(true);
        });
        it("acknowledgement is version-specific", () => {
          const a = acknowledgePolicy({
            id: policyAcknowledgementId("a1"),
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            policyRef: "pol-aup",
            policyVersion: 3,
          });
          expect(hasAcknowledgedPolicyVersion([a], "pol-aup", 3)).toBe(true);
          expect(hasAcknowledgedPolicyVersion([a], "pol-aup", 4)).toBe(false);
        });
      });

      describe("attendance-identity — QR Sessions (BO, BP)", () => {
        it("creates short-lived QR session", () => {
          const r = createAttendanceQRSession({
            id: attendanceQRSessionId("q1"),
            tenantId: TENANT,
            institutionId: INST,
            attendanceSessionRef: "session-1",
            ttlMinutes: 15,
            validatorFingerprint: "vp-1",
            now: "2026-01-01T00:00:00.000Z",
          });
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.session.expiresAt > "2026-01-01T00:00:00.000Z").toBe(true);
        });
        it("rejects TTL over 60 minutes", () => {
          const r = createAttendanceQRSession({
            id: attendanceQRSessionId("q2"),
            tenantId: TENANT,
            institutionId: INST,
            attendanceSessionRef: "session-1",
            ttlMinutes: 120,
            validatorFingerprint: "vp-1",
          });
          expect(r.ok).toBe(false);
        });
        it("prevents QR replay", () => {
          const r = createAttendanceQRSession({
            id: attendanceQRSessionId("q3"),
            tenantId: TENANT,
            institutionId: INST,
            attendanceSessionRef: "session-1",
            ttlMinutes: 15,
            validatorFingerprint: "vp-1",
            now: "2026-01-01T00:00:00.000Z",
          });
          if (!r.ok) throw new Error("expected ok");
          const first = redeemQRSession(r.session, "vp-1", "2026-01-01T00:05:00.000Z");
          expect(first.ok).toBe(true);
          if (first.ok)
            expect(redeemQRSession(first.session, "vp-1", "2026-01-01T00:06:00.000Z").ok).toBe(
              false,
            );
        });
        it("rejects expired QR", () => {
          const r = createAttendanceQRSession({
            id: attendanceQRSessionId("q4"),
            tenantId: TENANT,
            institutionId: INST,
            attendanceSessionRef: "session-1",
            ttlMinutes: 5,
            validatorFingerprint: "vp-1",
            now: "2026-01-01T00:00:00.000Z",
          });
          if (!r.ok) throw new Error("expected ok");
          expect(redeemQRSession(r.session, "vp-1", "2026-01-01T01:00:00.000Z").ok).toBe(false);
        });
      });

      if (!redeemed.ok) throw new Error("expected ok");
      expect(
        redeemInvitation(redeemed.invitation, "fp-abc123", "2026-06-01T00:00:00.000Z").ok,
      ).toBe(false);
    });
    it("revoked invitation cannot be redeemed", () => {
      const r = createStaffInvitation(base);
      if (!r.ok) throw new Error("expected ok");
      expect(
        redeemInvitation(revokeInvitation(r.invitation), "fp-abc123", "2026-06-01T00:00:00.000Z")
          .ok,
      ).toBe(false);

      describe("attendance-identity — Biometrics (BQ, BS, BV, BZ, FH)", () => {
        it("enrolls biometric with consent/purpose/retention", () => {
          const r = enrollBiometric({
            id: biometricEnrollmentId("be-1"),
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            method: "face",
            deviceLocalRef: "dev-local-1",
            consentRef: "consent-1",
            purposeRef: "purpose-1",
            retentionRef: "retention-1",
          });
          expect(r.ok).toBe(true);
        });
        it("rejects enrollment without consent", () => {
          const r = enrollBiometric({
            id: biometricEnrollmentId("be-2"),
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            method: "face",
            deviceLocalRef: "dev-1",
            consentRef: "",
            purposeRef: "purpose-1",
            retentionRef: "retention-1",
          });
          expect(r.ok).toBe(false);
        });
        it("revocation prevents future authentication", () => {
          const r = enrollBiometric({
            id: biometricEnrollmentId("be-3"),
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            method: "fingerprint",
            deviceLocalRef: "dev-1",
            consentRef: "consent-1",
            purposeRef: "purpose-1",
            retentionRef: "retention-1",
          });
          if (!r.ok) throw new Error("expected ok");
          expect(revokeBiometricEnrollment(r.enrollment).state).toBe("revoked");
        });
        it("high confidence verifies", () => {
          expect(evaluateBiometricVerification(95, 90, 70).verified).toBe(true);
        });
        it("low confidence does not silently authenticate", () => {
          const r = evaluateBiometricVerification(75, 90, 70);
          expect(r.verified).toBe(false);
          expect(r.lowConfidenceDeclined).toBe(true);
        });
        it("biometric match never creates authorization", () => {
          expect(biometricVerificationCreatesAuthorization()).toBe(false);
        });
        it("rejects spoofing signals", () => {
          expect(rejectIfSpoofingSignal(["deepfake"])).toBe(true);
        });
      });

      describe("attendance-identity — Authorization & Risk (BZ, CB, CC, CD)", () => {
        it("authorizes attendance for valid identity/role/context/policy", () => {
          const r = authorizeAttendance({
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            roleRef: "role-1",
            contextRef: "ctx-1",
            policyRefs: ["attendance.standard"],
            identityVerified: true,
            livenessPassed: true,
            locationAuthorized: true,
            requiredCapability: "attendance.record",
          });
          expect(r.decision).toBe("ALLOW");
        });
        it("denies when identity not verified", () => {
          const r = authorizeAttendance({
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            roleRef: "role-1",
            contextRef: "ctx-1",
            policyRefs: ["attendance.standard"],
            identityVerified: false,
            livenessPassed: true,
            locationAuthorized: true,
            requiredCapability: "attendance.record",
          });
          expect(r.decision).toBe("DENY");
        });
        it("denies when location unauthorized", () => {
          const r = authorizeAttendance({
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            roleRef: "role-1",
            contextRef: "ctx-1",
            policyRefs: ["attendance.standard"],
            identityVerified: true,
            livenessPassed: true,
            locationAuthorized: false,
            requiredCapability: "attendance.record",
          });
          expect(r.decision).toBe("DENY");
        });
        it("assesses risk with review recommendation", () => {
          const r = assessAttendanceRisk({
            id: attendanceRiskAssessmentId("risk-1"),
            tenantId: TENANT,
            institutionId: INST,
            identityRef: "id-1",
            signals: ["duplicate_attendance", "simultaneous_presence_anomaly"],
          });
          expect(r.riskScore).toBeGreaterThanOrEqual(40);
          expect(r.reviewRecommended).toBe(true);
        });
        it("enforces admin biometric controls", () => {
          const policy = {
            tenantId: TENANT,
            institutionId: INST,
            enabled: true,
            eligibleStaffRefs: ["id-1"],
            permittedLocationRefs: ["loc-main"],
            fallbackMethods: ["pin" as const],
            retentionPolicyRef: "ret-1",
          };
          expect(isBiometricAttendanceAllowed(policy, "id-1", "loc-main")).toBe(true);
          expect(isBiometricAttendanceAllowed(policy, "id-2", "loc-main")).toBe(false);
          expect(
            isBiometricAttendanceAllowed({ ...policy, enabled: false }, "id-1", "loc-main"),
          ).toBe(false);
        });
      });
    });
    it("expires after expiry date", () => {
      const r = createStaffInvitation({ ...base, expiresAt: "2026-06-01T00:00:00.000Z" });
      if (!r.ok) throw new Error("expected ok");
      expect(expireInvitation(r.invitation, "2026-07-01T00:00:00.000Z").status).toBe("expired");
    });
  });

  describe("institution-admin — Delegation & Break-Glass (CK, CM)", () => {
    it("creates delegation with duration", () => {
      const r = createAdminDelegation({
        id: adminDelegationId("d1"),
        tenantId: TENANT,
        institutionId: INST,
        delegatorRef: "id-admin-1",
        delegateRef: "id-admin-2",
        roleRef: "role-hr",
        durationHours: 24,
        now: "2026-01-01T00:00:00.000Z",
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.delegation.expiresAt > "2026-01-01T00:00:00.000Z").toBe(true);
    });
    it("rejects self-delegation", () => {
      const r = createAdminDelegation({
        id: adminDelegationId("d2"),
        tenantId: TENANT,
        institutionId: INST,
        delegatorRef: "id-admin-1",
        delegateRef: "id-admin-1",
        roleRef: "role-hr",
        durationHours: 24,
      });
      expect(r.ok).toBe(false);
    });
    it("revokes delegation", () => {
      const r = createAdminDelegation({
        id: adminDelegationId("d3"),
        tenantId: TENANT,
        institutionId: INST,
        delegatorRef: "id-admin-1",
        delegateRef: "id-admin-2",
        roleRef: "role-hr",
        durationHours: 24,
        now: "2026-01-01T00:00:00.000Z",
      });
      if (!r.ok) throw new Error("expected ok");
      expect(
        isAdminDelegationActive(
          revokeAdminDelegation(r.delegation, "2026-01-02T00:00:00.000Z"),
          "2026-01-02T00:00:00.000Z",
        ),
      ).toBe(false);
    });
    it("creates break-glass with reason and scope", () => {
      const r = createBreakGlassAccess({
        id: breakGlassAccessId("bg-1"),
        tenantId: TENANT,
        institutionId: INST,
        requesterRef: "id-admin-1",
        reason: "Primary admin unreachable during exam incident",
        scope: ["exam.override"],
        durationMinutes: 60,
      });
      expect(r.ok).toBe(true);
    });
    it("rejects break-glass without reason", () => {
      const r = createBreakGlassAccess({
        id: breakGlassAccessId("bg-2"),
        tenantId: TENANT,
        institutionId: INST,
        requesterRef: "id-admin-1",
        reason: "",
        scope: ["x"],
        durationMinutes: 60,
      });
      expect(r.ok).toBe(false);
    });
    it("records post-event review", () => {
      const r = createBreakGlassAccess({
        id: breakGlassAccessId("bg-3"),
        tenantId: TENANT,
        institutionId: INST,
        requesterRef: "id-admin-1",
        reason: "Incident",
        scope: ["x"],
        durationMinutes: 30,
      });
      if (!r.ok) throw new Error("expected ok");
      expect(recordBreakGlassReview(r.access, "review-1").reviewRef).toBe("review-1");
    });
  });

  describe("institution-admin — Impersonation (CZ)", () => {
    it("requires explicit authorization and time limit", () => {
      const r = createImpersonationSession({
        id: impersonationSessionId("im-1"),
        tenantId: TENANT,
        institutionId: INST,
        actorRef: "id-support-1",
        targetRef: "id-admin-1",
        authorizationRef: "authz-1",
        durationMinutes: 30,
      });
      expect(r.ok).toBe(true);
    });
    it("rejects impersonation without authorization", () => {
      const r = createImpersonationSession({
        id: impersonationSessionId("im-2"),
        tenantId: TENANT,
        institutionId: INST,
        actorRef: "id-support-1",
        targetRef: "id-admin-1",
        authorizationRef: "",
        durationMinutes: 30,
      });
      expect(r.ok).toBe(false);
    });
    it("shows visible indicator", () => {
      const r = createImpersonationSession({
        id: impersonationSessionId("im-3"),
        tenantId: TENANT,
        institutionId: INST,
        actorRef: "id-support-1",
        targetRef: "id-admin-1",
        authorizationRef: "authz-1",
        durationMinutes: 30,
        now: "2026-01-01T00:00:00.000Z",
      });
      if (!r.ok) throw new Error("expected ok");
      expect(r.session.visibleIndicator).toBe(true);
      expect(
        isImpersonationActive(endImpersonationSession(r.session), "2026-01-01T00:01:00.000Z"),
      ).toBe(false);
    });
  });

  describe("institution-admin — Permissions, Features, Recomposition (CP, CQ, CS, CT)", () => {
    it("explains permission denial", () => {
      const e = explainPermissionDenial({
        action: "student.read",
        resource: "student:456",
        reason: "Not assigned to this student",
        controllingAuthority: "Institution policy",
        accessRequestPath: "/support/access-request",
      });
      expect(e.accessRequestPath).toBe("/support/access-request");
    });
    it("resolves visible features from capabilities", () => {
      const registry = [
        { key: "attendance.record", featureKeys: ["attendance"], requiredPlatform: null },
        { key: "finance.read", featureKeys: ["finance"], requiredPlatform: null },
      ];
      expect(resolveVisibleFeatures(["attendance.record"], registry)).toEqual(["attendance"]);
    });
    it("recomposes workspace deterministically", () => {
      const registry = [
        { key: "attendance.record", featureKeys: ["attendance"], requiredPlatform: null },
      ];
      const a = recomposeWorkspace(
        {
          rolePermissions: ["student.read", "attendance.record"],
          roleCapabilities: ["attendance.record"],
          policyRefs: ["pol-1"],
          contextRef: "ctx-1",
          platform: "web",
        },
        registry,
        "2026-01-01T00:00:00.000Z",
      );
      const b = recomposeWorkspace(
        {
          rolePermissions: ["attendance.record", "student.read"],
          roleCapabilities: ["attendance.record"],
          policyRefs: ["pol-1"],
          contextRef: "ctx-1",
          platform: "web",
        },
        registry,
        "2026-01-01T00:00:00.000Z",
      );
      expect(a).toEqual(b);
      expect(a.featureKeys).toContain("attendance");
    });
  });

  it("requires a reason", () => {
    describe("institution-admin — Simulation, Preview, Self-Service, Recovery (CW, CY, DA, EZ, FB)", () => {
      it("simulates policy change gains and losses", () => {
        const r = simulatePolicyChange({
          id: policySimulationId("ps-1"),
          tenantId: TENANT,
          institutionId: INST,
          affectedRefs: ["id-1", "id-2", "id-3"],
          permissionAfter: new Map([
            ["id-1", true],
            ["id-2", false],
          ]),
          now: "2026-01-01T00:00:00.000Z",
        });
        expect(r.gainedAccessRefs).toEqual(["id-1"]);
        expect(r.lostAccessRefs).toEqual(["id-2"]);
      });
      it("builds access preview", () => {
        const p = buildAccessPreview({
          id: accessPreviewId("ap-1"),
          tenantId: TENANT,
          institutionId: INST,
          effectivePermissions: ["b", "a"],
          effectivePolicyRefs: ["pol-1"],
          effectiveContextRef: "ctx-1",
          availableCapabilities: ["cap-1"],
        });
        expect(p.effectivePermissions).toEqual(["a", "b"]);
      });
      it("staff cannot self-grant privileges", () => {
        expect(isSelfServiceActionForbidden("role.assign")).toBe(true);
        expect(isSelfServiceActionForbidden("profile.update")).toBe(false);
      });
      it("succession requires platform safeguard", () => {
        const r = createAdminSuccession({
          tenantId: TENANT,
          institutionId: INST,
          outgoingAdministratorRef: "id-admin-1",
          incomingAdministratorRef: "id-admin-2",
          platformSafeguardRef: "safeguard-1",
        });
        expect(r.ok).toBe(true);
      });
      it("rejects succession to same administrator", () => {
        const r = createAdminSuccession({
          tenantId: TENANT,
          institutionId: INST,
          outgoingAdministratorRef: "id-admin-1",
          incomingAdministratorRef: "id-admin-1",
          platformSafeguardRef: "safeguard-1",
        });
        expect(r.ok).toBe(false);
      });
      it("emergency recovery requires all four safeguards", () => {
        expect(
          isEmergencyRecoveryPermitted({
            verifiedAuthority: true,
            strongAuthentication: true,
            auditRecorded: true,
            platformSafeguard: true,
          }),
        ).toBe(true);
        expect(
          isEmergencyRecoveryPermitted({
            verifiedAuthority: true,
            strongAuthentication: true,
            auditRecorded: true,
            platformSafeguard: false,
          }),
        ).toBe(false);
      });
    });

    const r = grantJustInTimeAccess({
      id: "jit-2" as never,
      tenantId: TENANT,
      institutionId: INST,
      subjectRef: "id-1",
      issuerRef: "id-admin-1",
      reason: "",
      scope: ["x"],
      durationMinutes: 30,
    });
    expect(r.ok).toBe(false);
  });
  it("expires after duration", () => {
    const r = grantJustInTimeAccess({
      id: "jit-3" as never,
      tenantId: TENANT,
      institutionId: INST,
      subjectRef: "id-1",
      issuerRef: "id-admin-1",
      reason: "Temporary",
      scope: ["x"],
      durationMinutes: 60,
      now: "2026-01-01T00:00:00.000Z",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(isJustInTimeAccessActive(r.access, "2026-01-01T02:00:00.000Z")).toBe(false);
    expect(
      isJustInTimeAccessActive(
        revokeJustInTimeAccess(r.access, "2026-01-01T00:30:00.000Z"),
        "2026-01-01T00:31:00.000Z",
      ),
    ).toBe(false);
  });
});
