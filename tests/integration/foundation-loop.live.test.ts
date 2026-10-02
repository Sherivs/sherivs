import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  executeRecordFoundationLoop,
  rollbackFoundationExecution,
} from "@/lib/foundation-loop.functions";
import { executeScholarFoundationLoop } from "@/lib/runtime/scholar/scholar-foundation-loop.functions";

const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const email = process.env.FOUNDATION_LOOP_EMAIL ?? "";
const password = process.env.FOUNDATION_LOOP_PASSWORD ?? "";
const entityId = process.env.FOUNDATION_LOOP_ENTITY_ID ?? "";
const schoolId = process.env.FOUNDATION_LOOP_SCHOOL_ID ?? "";
const userId = process.env.FOUNDATION_LOOP_USER_ID ?? "";

const enabled = Boolean(url && anonKey && email && password && entityId && schoolId && userId);

describe.skipIf(!enabled)("foundation loop live session", () => {
  it("verifies a same-tenant reality reference and replays the same execution", async () => {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();
    expect(signedIn.data.user?.id).toBe(userId);

    const data = {
      realityRef: entityId,
      missionId: "COREGRID-FOUNDATION-MISSION-001",
      version: "live-1",
      purpose: "bounded-reality-loop",
      authorityRef: "CONTROL-PLANE-06",
      contextRef: "foundation-live-context",
      ownerRef: "MISSIONS.md",
      action: "record-observation" as const,
      idempotencyKey: "foundation-live-idem-001",
    };
    const first = await executeRecordFoundationLoop({ supabase, userId, data });
    expect(first.replayed).toBe(false);
    expect(first.executionStatus).toBe("admitted");
    expect(first.verification?.decision).toBe("verified");

    const second = await executeRecordFoundationLoop({ supabase, userId, data });
    expect(second.replayed).toBe(true);
    expect(second.executionId).toBe(first.executionId);
    expect(second.verification?.decision).toBe("verified");
  }, 90000);

  it("records a Scholar entity through the universal substrate and verifies it", async () => {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();

    const result = await executeScholarFoundationLoop({
      supabase,
      userId,
      data: {
        entityType: "learner",
        state: "enrolled-probe",
        attributes: { probe: true },
        idempotencyKey: "scholar-live-idem-001",
      },
    });
    expect(result.replayed).toBe(false);
    expect(result.scholarEntityType).toBe("learner");
    expect(result.executionStatus).toBe("admitted");
    expect(result.verificationDecision).toBe("verified");
  }, 90000);

  it("binds the Scholar entity into the reality graph with a relationship and event", async () => {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();

    // The learning group is itself created through the same governed loop, so
    // the enrollment edge always targets an in-scope, ontology-valid entity.
    const group = await executeScholarFoundationLoop({
      supabase,
      userId,
      data: {
        entityType: "learning_group",
        state: "formed-probe",
        attributes: { probe: true },
        idempotencyKey: "scholar-live-group-idem-001",
      },
    });
    expect(group.replayed).toBe(false);
    expect(group.scholarEntityType).toBe("learning_group");

    const enrolled = await executeScholarFoundationLoop({
      supabase,
      userId,
      data: {
        entityType: "learner",
        state: "enrolled-probe",
        attributes: { probe: true },
        idempotencyKey: "scholar-live-enroll-idem-001",
        relationships: [{ relationType: "enrolls", targetEntityId: group.realityRef }],
        event: { eventType: "learner.enrolled" },
      },
    });
    expect(enrolled.replayed).toBe(false);
    expect(enrolled.relationshipCount).toBe(1);
    expect(enrolled.recordedEvent).toBe("learner.enrolled");
    expect(enrolled.executionStatus).toBe("admitted");
    expect(enrolled.verificationDecision).toBe("verified");

    // Replay returns the recorded execution and creates no new reality rows.
    const replay = await executeScholarFoundationLoop({
      supabase,
      userId,
      data: {
        entityType: "learner",
        state: "enrolled-probe",
        attributes: { probe: true },
        idempotencyKey: "scholar-live-enroll-idem-001",
        relationships: [{ relationType: "enrolls", targetEntityId: group.realityRef }],
        event: { eventType: "learner.enrolled" },
      },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.executionId).toBe(enrolled.executionId);
    expect(replay.realityRef).toBe(enrolled.realityRef);
  }, 90000);

  it("rejects a relationship target outside the actor's tenant scope", async () => {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();

    await expect(
      executeScholarFoundationLoop({
        supabase,
        userId,
        data: {
          entityType: "learner",
          idempotencyKey: "scholar-live-cross-tenant-01",
          relationships: [
            {
              relationType: "enrolls",
              targetEntityId: "00000000-0000-0000-0000-000000000000",
            },
          ],
        },
      }),
    ).rejects.toThrow(/does not exist in the actor's tenant scope/);
  }, 90000);

  it("rolls back an admitted execution and preserves both history entries", async () => {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    expect(signedIn.error).toBeNull();

    const admitted = await executeRecordFoundationLoop({
      supabase,
      userId,
      data: {
        realityRef: entityId,
        missionId: "COREGRID-FOUNDATION-MISSION-001",
        version: "live-1",
        purpose: "bounded-reality-loop",
        authorityRef: "CONTROL-PLANE-06",
        contextRef: "foundation-live-context",
        ownerRef: "MISSIONS.md",
        action: "record-observation" as const,
        idempotencyKey: "foundation-live-rollback-001",
      },
    });
    expect(admitted.replayed).toBe(false);
    expect(admitted.executionStatus).toBe("admitted");

    const rolled = await rollbackFoundationExecution({
      supabase,
      userId,
      executionId: admitted.executionId,
    });
    expect(rolled.status).toBe("rolled_back");
    expect(rolled.externalEffect).toBe("compensation_required");
    expect(rolled.historyCount).toBeGreaterThanOrEqual(2);

    // Idempotent replay after rollback returns the rolled-back state, never a new effect.
    const replay = await executeRecordFoundationLoop({
      supabase,
      userId,
      data: {
        realityRef: entityId,
        missionId: "COREGRID-FOUNDATION-MISSION-001",
        version: "live-1",
        purpose: "bounded-reality-loop",
        authorityRef: "CONTROL-PLANE-06",
        contextRef: "foundation-live-context",
        ownerRef: "MISSIONS.md",
        action: "record-observation" as const,
        idempotencyKey: "foundation-live-rollback-001",
      },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.executionId).toBe(admitted.executionId);
    expect(replay.executionStatus).toBe("rolled_back");
    // The recorded verification of the original admitted attempt is preserved history.
    expect(replay.verification?.decision).toBe("verified");
  }, 90000);
});
