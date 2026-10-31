/**
 * Organization Lifecycle API used by console screens.
 * Local visual fixture uses sessionStorage; live requests use server functions.
 */
import {
  activateOrganization,
  assignOrganizationStaff,
  deactivateOrganization,
  getOrganization,
  listOrganizations,
  provisionOrganizationCase,
  releaseOrganizationAssignment,
  restoreOrganization,
  saveOrganizationDraft,
  submitOrganization,
  suspendOrganization,
  transitionOrganization,
} from "@/lib/internal-console/organization.functions";
import {
  ORGANIZATION_ACCESS_EFFECTS,
  canTransitionOrganization,
  currentOnboardingStep,
  isOrganizationLifecycleState,
  questionnaireReady,
  slugifyOrganizationName,
  type OrganizationAssignmentType,
  type OrganizationDetail,
  type OrganizationDirectoryRow,
  type OrganizationDraft,
  type OrganizationLifecycleState,
} from "@/lib/internal-console/organization-lifecycle";
import {
  CONSOLE_FIXTURE_OPERATOR,
  CONSOLE_FIXTURE_ORGS_KEY,
  consoleVisualFixtureActive,
} from "@/lib/internal-console/visual-fixture";

const FIXTURE_KEY = CONSOLE_FIXTURE_ORGS_KEY;

type FixtureStore = {
  organizations: OrganizationDetail[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): FixtureStore {
  return { organizations: [] };
}

function readStore(): FixtureStore {
  try {
    const raw = window.sessionStorage.getItem(FIXTURE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as FixtureStore;
    return Array.isArray(parsed.organizations) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store: FixtureStore): void {
  window.sessionStorage.setItem(FIXTURE_KEY, JSON.stringify(store));
}

function directoryFrom(detail: OrganizationDetail): OrganizationDirectoryRow {
  const { questionnaire: _q, contact: _c, assignments, transitions: _t, accessEffects: _a, ...row } =
    detail;
  return {
    ...row,
    assignmentCount: assignments.filter((item) => item.status === "active").length,
    onboardingOwnerName:
      assignments.find((item) => item.assignmentType === "onboarding_owner" && item.status === "active")
        ?.staffName ?? null,
  };
}

function applyFixtureState(
  detail: OrganizationDetail,
  toState: OrganizationLifecycleState,
  reason: string,
): OrganizationDetail {
  const from = detail.lifecycleState;
  if (!canTransitionOrganization(from, toState)) {
    throw new Error(`Cannot change organization state from ${from} to ${toState}.`);
  }
  const at = nowIso();
  return {
    ...detail,
    lifecycleState: toState,
    updatedAt: at,
    submittedAt: toState === "submitted" ? at : detail.submittedAt,
    provisionedAt: toState === "ready_for_activation" ? at : detail.provisionedAt,
    activatedAt: toState === "active" ? at : detail.activatedAt,
    schoolId:
      toState === "ready_for_activation" || toState === "active"
        ? (detail.schoolId ?? `fixture-school-${detail.id.slice(0, 8)}`)
        : detail.schoolId,
    enabledRuntime:
      toState === "deactivated" ? null : toState === "ready_for_activation" || toState === "active"
        ? "scholar"
        : detail.enabledRuntime,
    outstandingRequirements:
      toState === "ready_for_activation" ? ["invite_organization_administrator"] : detail.outstandingRequirements,
    accessEffects:
      toState === "suspended"
        ? ORGANIZATION_ACCESS_EFFECTS.suspend
        : toState === "deactivated"
          ? ORGANIZATION_ACCESS_EFFECTS.deactivate
          : toState === "active"
            ? ORGANIZATION_ACCESS_EFFECTS.activate
            : ORGANIZATION_ACCESS_EFFECTS.provision,
    transitions: [
      {
        id: crypto.randomUUID(),
        fromState: from,
        toState,
        actorId: CONSOLE_FIXTURE_OPERATOR.id,
        reason,
        at,
      },
      ...detail.transitions,
    ],
  };
}

export async function apiListOrganizations(input: { query?: string; state?: string } = {}): Promise<{
  organizations: OrganizationDirectoryRow[];
  store: "database" | "fixture";
}> {
  if (consoleVisualFixtureActive()) {
    const query = (input.query ?? "").trim().toLowerCase();
    const organizations = readStore()
      .organizations.filter((row) => (input.state ? row.lifecycleState === input.state : true))
      .filter((row) =>
        query ? `${row.displayName} ${row.country ?? ""} ${row.lifecycleState}`.toLowerCase().includes(query) : true,
      )
      .map(directoryFrom);
    return { organizations, store: "fixture" };
  }
  const result = await listOrganizations({ data: input });
  return { organizations: result.organizations, store: "database" };
}

export async function apiGetOrganization(id: string): Promise<OrganizationDetail> {
  if (consoleVisualFixtureActive()) {
    const found = readStore().organizations.find((row) => row.id === id);
    if (!found) throw new Error("Organization not found.");
    return found;
  }
  return getOrganization({ data: { id } });
}

export async function apiSaveDraft(input: {
  id?: string;
  draft: OrganizationDraft;
}): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    const store = readStore();
    const at = nowIso();
    if (input.id) {
      const index = store.organizations.findIndex((row) => row.id === input.id);
      if (index < 0) throw new Error("Organization not found.");
      const current = store.organizations[index];
      if (current.lifecycleState !== "draft" && current.lifecycleState !== "submitted") {
        throw new Error("Only draft or returned submissions can be edited.");
      }
      store.organizations[index] = {
        ...current,
        displayName: input.draft.displayName?.trim() || current.displayName,
        legalName: input.draft.legalName ?? current.legalName,
        country: input.draft.country ?? current.country,
        region: input.draft.region ?? current.region,
        city: input.draft.city ?? current.city,
        questionnaire: { ...current.questionnaire, ...input.draft },
        questionnaireStep: currentOnboardingStep({ ...current.questionnaire, ...input.draft }),
        updatedAt: at,
        contact: {
          name: input.draft.contactName ?? current.contact?.name ?? null,
          email: input.draft.contactEmail ?? current.contact?.email ?? null,
          phone: input.draft.contactPhone ?? current.contact?.phone ?? null,
          title: input.draft.contactTitle ?? current.contact?.title ?? null,
          method: input.draft.contactMethod ?? current.contact?.method ?? null,
        },
      };
      writeStore(store);
      return { id: input.id };
    }
    const id = crypto.randomUUID();
    const draft: OrganizationDetail = {
      id,
      displayName: input.draft.displayName?.trim() || "Untitled organization",
      orgType: "school",
      lifecycleState: "draft",
      country: input.draft.country ?? null,
      region: input.draft.region ?? null,
      city: input.draft.city ?? null,
      intendedRuntime: "scholar",
      enabledRuntime: null,
      schoolId: null,
      slug: slugifyOrganizationName(input.draft.displayName ?? "organization"),
      createdAt: at,
      updatedAt: at,
      submittedAt: null,
      provisionedAt: null,
      activatedAt: null,
      onboardingOwnerName: CONSOLE_FIXTURE_OPERATOR.name,
      assignmentCount: 1,
      legalName: input.draft.legalName ?? null,
      questionnaire: input.draft,
      questionnaireStep: currentOnboardingStep(input.draft),
      provisioningError: null,
      outstandingRequirements: [],
      createdBy: CONSOLE_FIXTURE_OPERATOR.id,
      submittedBy: null,
      reviewedBy: null,
      activatedBy: null,
      contact: {
        name: input.draft.contactName ?? null,
        email: input.draft.contactEmail ?? null,
        phone: input.draft.contactPhone ?? null,
        title: input.draft.contactTitle ?? null,
        method: input.draft.contactMethod ?? null,
      },
      assignments: [
        {
          id: crypto.randomUUID(),
          organizationId: id,
          staffId: CONSOLE_FIXTURE_OPERATOR.id,
          staffName: CONSOLE_FIXTURE_OPERATOR.name,
          assignmentType: "onboarding_owner",
          status: "active",
          assignedBy: CONSOLE_FIXTURE_OPERATOR.id,
          assignedAt: at,
          releasedAt: null,
        },
      ],
      transitions: [
        {
          id: crypto.randomUUID(),
          fromState: null,
          toState: "draft",
          actorId: CONSOLE_FIXTURE_OPERATOR.id,
          reason: "created",
          at,
        },
      ],
      accessEffects: null,
    };
    store.organizations.unshift(draft);
    writeStore(store);
    return { id };
  }
  return saveOrganizationDraft({ data: input });
}

function replaceFixture(id: string, mutate: (row: OrganizationDetail) => OrganizationDetail) {
  const store = readStore();
  const index = store.organizations.findIndex((row) => row.id === id);
  if (index < 0) throw new Error("Organization not found.");
  store.organizations[index] = mutate(store.organizations[index]);
  writeStore(store);
}

export async function apiSubmit(id: string): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    replaceFixture(id, (row) => {
      if (!questionnaireReady(row.questionnaire)) {
        throw new Error("Complete the required onboarding steps before submitting.");
      }
      return applyFixtureState(row, "submitted", "submitted");
    });
    return { id };
  }
  return submitOrganization({ data: { id } });
}

export async function apiTransition(
  id: string,
  toState: OrganizationLifecycleState,
  reason?: string,
): Promise<{ id: string; state: OrganizationLifecycleState }> {
  if (!isOrganizationLifecycleState(toState)) throw new Error("Unknown organization state.");
  if (consoleVisualFixtureActive()) {
    replaceFixture(id, (row) => applyFixtureState(row, toState, reason ?? toState));
    return { id, state: toState };
  }
  return transitionOrganization({ data: { id, toState, reason } });
}

export async function apiProvision(id: string): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    replaceFixture(id, (row) => {
      const provisioning =
        row.lifecycleState === "provisioning" ? row : applyFixtureState(row, "provisioning", "provision");
      return applyFixtureState(provisioning, "ready_for_activation", "provisioned");
    });
    return { id };
  }
  await provisionOrganizationCase({ data: { id } });
  return { id };
}

export async function apiActivate(id: string): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    replaceFixture(id, (row) => applyFixtureState(row, "active", "activated"));
    return { id };
  }
  return activateOrganization({ data: { id } });
}

export async function apiSuspend(id: string): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    replaceFixture(id, (row) => applyFixtureState(row, "suspended", "suspended"));
    return { id };
  }
  return suspendOrganization({ data: { id } });
}

export async function apiRestore(id: string): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    replaceFixture(id, (row) => applyFixtureState(row, "active", "restored"));
    return { id };
  }
  return restoreOrganization({ data: { id } });
}

export async function apiDeactivate(id: string): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    replaceFixture(id, (row) => applyFixtureState(row, "deactivated", "deactivated"));
    return { id };
  }
  return deactivateOrganization({ data: { id } });
}

export async function apiAssign(input: {
  organizationId: string;
  staffId: string;
  assignmentType: OrganizationAssignmentType;
}): Promise<{ id: string }> {
  if (consoleVisualFixtureActive()) {
    const assignmentId = crypto.randomUUID();
    replaceFixture(input.organizationId, (row) => ({
      ...row,
      assignments: [
        {
          id: assignmentId,
          organizationId: input.organizationId,
          staffId: input.staffId,
          staffName: CONSOLE_FIXTURE_OPERATOR.name,
          assignmentType: input.assignmentType,
          status: "active",
          assignedBy: CONSOLE_FIXTURE_OPERATOR.id,
          assignedAt: nowIso(),
          releasedAt: null,
        },
        ...row.assignments.map((item) =>
          item.assignmentType === "onboarding_owner" &&
          input.assignmentType === "onboarding_owner" &&
          item.status === "active"
            ? { ...item, status: "released" as const, releasedAt: nowIso() }
            : item,
        ),
      ],
    }));
    return { id: assignmentId };
  }
  return assignOrganizationStaff({ data: input });
}

export async function apiRelease(assignmentId: string): Promise<{ ok: true }> {
  if (consoleVisualFixtureActive()) {
    const store = readStore();
    for (const org of store.organizations) {
      const item = org.assignments.find((row) => row.id === assignmentId);
      if (item) {
        item.status = "released";
        item.releasedAt = nowIso();
        writeStore(store);
        return { ok: true };
      }
    }
    throw new Error("Assignment not found.");
  }
  return releaseOrganizationAssignment({ data: { assignmentId } });
}
