import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronRight, RefreshCw, Search, Users } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { supabase } from "@/integrations/supabase/client";
import {
  hasMultiplePlacementDimensions,
  mobilityActionsFor,
  type StudentMovementType,
} from "@/lib/scholar/mobility-workflow";
import { useAppShell } from "./shell-context";
import "./student-mobility-screen.css";

type DbError = { message: string };
type DbRow = Record<string, unknown>;
type DbResult<T> = { data: T[] | null; error: DbError | null };
type DbQuery<T extends DbRow> = PromiseLike<DbResult<T>> & {
  eq(column: string, value: string | number | boolean): DbQuery<T>;
  in(column: string, values: string[]): DbQuery<T>;
  order(column: string, options: { ascending: boolean }): DbQuery<T>;
  limit(count: number): DbQuery<T>;
};
type MobilityClient = {
  from(table: string): { select(columns: string): DbQuery<DbRow> };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: DbError | null }>;
};

type Student = {
  id: string;
  admission_number: string | null;
  class_id: string | null;
  user_id: string | null;
  is_active: boolean | null;
  full_name: string;
};
type ClassRow = {
  id: string;
  name: string;
  grade_level: string | null;
  academic_year: string | null;
  capacity: number | null;
  campus_id: string | null;
  section_id: string | null;
  shift_id: string | null;
  arm: string | null;
};
type NamedRow = { id: string; name: string; campus_id?: string | null };
type Placement = {
  id: string;
  student_id: string;
  class_id: string | null;
  campus_id: string | null;
  section_id: string | null;
  shift: string | null;
  arm: string | null;
  session: string | null;
  effective_from: string;
  effective_to: string | null;
  movement_type: string;
  reason: string;
};
type MobilityRequest = {
  id: string;
  student_id: string;
  movement_type: string;
  target_class_id: string | null;
  target_session: string | null;
  target_shift: string | null;
  effective_at: string;
  reason: string;
  status: string;
  requested_by: string;
  policy_snapshot: Record<string, unknown>;
};
type Approval = {
  id: string;
  request_id: string;
  step: number;
  approver_id: string;
  approver_role: string | null;
  decision: string;
  reason: string | null;
  created_at: string;
};
type MobilityEvent = {
  id: string;
  student_id: string;
  from_placement_id: string | null;
  to_placement_id: string | null;
  movement_type: string;
  reason: string;
  effective_at: string;
  actor_id: string | null;
  approved_by: string | null;
};
type FeeRow = {
  student_id: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
};
type MobilityPolicy = {
  required_approvals: number;
  approval_roles: string[];
  fee_clearance: "block" | "warn" | "allow";
  updated_at: string;
};
type Eligibility = {
  student_id: string;
  eligible: boolean;
  unmet: string[];
  warnings: string[];
  average_pct: number | null;
  attendance_pct: number | null;
  outstanding_balance: number;
  occupied_seats: number | null;
  target_capacity: number | null;
  required_approvals: number;
  approval_roles: string[];
  fee_clearance: string;
};
type BulkOverride = { targetClassId: string; movementType: StudentMovementType };

const client = supabase as unknown as MobilityClient;
const MOVEMENT_LABELS: Record<string, string> = {
  enrollment: "Enrolled",
  promote: "Promoted",
  repeat: "Repeated / retained",
  double_promote: "Double promotion",
  conditional_promote: "Conditional promotion",
  demote: "Demoted",
  internal_transfer: "Placement transfer",
  withdraw: "Withdrawn",
  graduate: "Graduated",
  readmit: "Readmitted",
  transfer_in: "Transferred in",
  transfer_out: "Transferred out",
  legacy_change: "Placement updated",
};

function displayDate(value: string | null | undefined): string {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date not recorded"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function currency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value);
}

function responseRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function activeStudent(row: Student): boolean {
  return row.is_active !== false;
}

export function StudentMobilityScreen() {
  const app = useApp();
  const shell = useAppShell();
  const schoolId = app.profile?.school_id ?? "";
  const userId = app.profile?.id ?? "";
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [campuses, setCampuses] = useState<NamedRow[]>([]);
  const [sections, setSections] = useState<NamedRow[]>([]);
  const [shifts, setShifts] = useState<NamedRow[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [requests, setRequests] = useState<MobilityRequest[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<MobilityEvent[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [policy, setPolicy] = useState<MobilityPolicy | null>(null);
  const [permissions, setPermissions] = useState(new Set<string>());
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<"profile" | "movement">("profile");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [movementType, setMovementType] = useState<StudentMovementType>("promote");
  const [targetClassId, setTargetClassId] = useState("");
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSourceClass, setBulkSourceClass] = useState("");
  const [bulkTargetClass, setBulkTargetClass] = useState("");
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkOverrides, setBulkOverrides] = useState<Record<string, BulkOverride>>({});
  const [bulkPreview, setBulkPreview] = useState<Eligibility[]>([]);

  const refresh = useCallback(async () => {
    if (!schoolId || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [studentPermission, transferPermission, feePermission] = await Promise.all([
        client.rpc("scholar_can", { p_org: schoolId, p_perm: "students.view" }),
        client.rpc("scholar_can", { p_org: schoolId, p_perm: "students.transfer" }),
        client.rpc("scholar_can", { p_org: schoolId, p_perm: "fees.view" }),
      ]);
      if (studentPermission.error || transferPermission.error || feePermission.error) {
        throw new Error(
          "Permission checks are unavailable. Try again before viewing student records.",
        );
      }
      const nextPermissions = new Set<string>();
      if (studentPermission.data === true) nextPermissions.add("students.view");
      if (transferPermission.data === true) nextPermissions.add("students.transfer");
      if (feePermission.data === true) nextPermissions.add("fees.view");
      setPermissions(nextPermissions);
      if (!nextPermissions.has("students.view")) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const [
        studentResult,
        classResult,
        campusResult,
        sectionResult,
        shiftResult,
        feeResult,
        placementResult,
        requestResult,
        approvalResult,
        eventResult,
        ruleResult,
      ] = await Promise.all([
        client
          .from("students")
          .select("id,admission_number,class_id,user_id,is_active")
          .eq("school_id", schoolId)
          .order("admission_number", { ascending: true })
          .limit(1000),
        client
          .from("classes")
          .select("id,name,grade_level,academic_year,capacity,campus_id,section_id,shift_id,arm")
          .eq("school_id", schoolId)
          .order("name", { ascending: true })
          .limit(500),
        client
          .from("campuses")
          .select("id,name")
          .eq("school_id", schoolId)
          .order("name", { ascending: true })
          .limit(100),
        client
          .from("school_sections")
          .select("id,name,campus_id")
          .eq("school_id", schoolId)
          .order("name", { ascending: true })
          .limit(100),
        client
          .from("school_shifts")
          .select("id,name,campus_id")
          .eq("school_id", schoolId)
          .order("name", { ascending: true })
          .limit(100),
        nextPermissions.has("fees.view")
          ? client
              .from("fees")
              .select("student_id,amount,paid_amount,status")
              .eq("school_id", schoolId)
              .limit(5000)
          : Promise.resolve({ data: [], error: null }),
        client
          .from("student_placements")
          .select(
            "id,student_id,class_id,campus_id,section_id,shift,arm,session,effective_from,effective_to,movement_type,reason",
          )
          .eq("school_id", schoolId)
          .order("effective_from", { ascending: false })
          .limit(5000),
        nextPermissions.has("students.transfer")
          ? client
              .from("student_mobility_requests")
              .select(
                "id,student_id,movement_type,target_class_id,target_session,target_shift,effective_at,reason,status,requested_by,policy_snapshot",
              )
              .eq("school_id", schoolId)
              .order("created_at", { ascending: false })
              .limit(1000)
          : Promise.resolve({ data: [], error: null }),
        nextPermissions.has("students.transfer")
          ? client
              .from("student_mobility_approvals")
              .select("id,request_id,step,approver_id,approver_role,decision,reason,created_at")
              .eq("school_id", schoolId)
              .order("step", { ascending: true })
              .limit(2000)
          : Promise.resolve({ data: [], error: null }),
        nextPermissions.has("students.transfer")
          ? client
              .from("student_mobility_events")
              .select(
                "id,student_id,from_placement_id,to_placement_id,movement_type,reason,effective_at,actor_id,approved_by",
              )
              .eq("school_id", schoolId)
              .order("effective_at", { ascending: false })
              .limit(5000)
          : Promise.resolve({ data: [], error: null }),
        client
          .from("student_mobility_rules")
          .select("required_approvals,approval_roles,fee_clearance,updated_at")
          .eq("school_id", schoolId)
          .limit(1),
      ]);

      if (studentResult.error || classResult.error) {
        throw new Error(
          studentResult.error?.message ??
            classResult.error?.message ??
            "Student records unavailable.",
        );
      }
      const nextStudents = (studentResult.data ?? []) as unknown as Student[];
      const userIds = [
        ...new Set(nextStudents.map((student) => student.user_id).filter(Boolean)),
      ] as string[];
      const userResult = userIds.length
        ? await client.from("users").select("id,full_name").in("id", userIds).limit(1000)
        : { data: [], error: null };
      const names = new Map(
        (userResult.data ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]),
      );
      setStudents(
        nextStudents.map((student) => ({
          ...student,
          full_name:
            (student.user_id && names.get(student.user_id)) ||
            `Student ${student.admission_number ?? student.id.slice(0, 8)}`,
        })),
      );
      setClasses((classResult.data ?? []) as unknown as ClassRow[]);
      setCampuses((campusResult.data ?? []) as unknown as NamedRow[]);
      setSections((sectionResult.data ?? []) as unknown as NamedRow[]);
      setShifts((shiftResult.data ?? []) as unknown as NamedRow[]);
      setFees((feeResult.data ?? []) as unknown as FeeRow[]);
      setPlacements((placementResult.data ?? []) as unknown as Placement[]);
      setRequests((requestResult.data ?? []) as unknown as MobilityRequest[]);
      setApprovals((approvalResult.data ?? []) as unknown as Approval[]);
      setEvents((eventResult.data ?? []) as unknown as MobilityEvent[]);
      const rule = ruleResult.data?.[0] as unknown as MobilityPolicy | undefined;
      setPolicy(rule ?? null);
      setSelectedId((current) =>
        nextStudents.some((student) => student.id === current)
          ? current
          : (nextStudents[0]?.id ?? ""),
      );
      setBulkSourceClass(
        (current) => current || (classResult.data?.[0]?.id as string | undefined) || "",
      );
      setBulkTargetClass(
        (current) => current || (classResult.data?.[1]?.id as string | undefined) || "",
      );
      if (
        placementResult.error ||
        (nextPermissions.has("students.transfer") && requestResult.error)
      ) {
        setNotice(
          "Mobility history is unavailable until the V1 mobility migrations are installed.",
        );
      }
      if (feeResult.error && nextPermissions.has("fees.view")) {
        setNotice(
          "Fee balance is unavailable; your fees.view permission is required for balances.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Student mobility could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedStudent = students.find((student) => student.id === selectedId) ?? null;
  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const campusById = useMemo(
    () => new Map(campuses.map((item) => [item.id, item.name])),
    [campuses],
  );
  const sectionById = useMemo(
    () => new Map(sections.map((item) => [item.id, item.name])),
    [sections],
  );
  const shiftById = useMemo(() => new Map(shifts.map((item) => [item.id, item.name])), [shifts]);
  const studentById = useMemo(() => new Map(students.map((item) => [item.id, item])), [students]);
  const multiplePlacementDimensions = hasMultiplePlacementDimensions(
    classes.map((item) => item.campus_id).filter(Boolean) as string[],
    classes.map((item) => item.section_id).filter(Boolean) as string[],
    classes.map((item) => item.shift_id).filter(Boolean) as string[],
    classes.map((item) => item.arm).filter(Boolean) as string[],
  );
  const visibleStudents = students.filter((student) => {
    const text = `${student.full_name} ${student.admission_number ?? ""}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const selectedBalance = selectedStudent
    ? fees
        .filter((fee) => fee.student_id === selectedStudent.id && fee.status !== "paid")
        .reduce(
          (sum, fee) => sum + Math.max(Number(fee.amount) - Number(fee.paid_amount ?? 0), 0),
          0,
        )
    : 0;
  const availableActions = useMemo(
    () =>
      selectedStudent
        ? mobilityActionsFor(
            permissions,
            multiplePlacementDimensions,
            activeStudent(selectedStudent),
          )
        : [],
    [multiplePlacementDimensions, permissions, selectedStudent],
  );
  const action = availableActions.find((item) => item.type === movementType);
  const selectedRequests = requests.filter((request) => request.student_id === selectedId);
  const selectedPlacements = placements.filter((placement) => placement.student_id === selectedId);
  const selectedEvents = events.filter((event) => event.student_id === selectedId);
  const selectedApprovals = approvals.filter((approval) =>
    selectedRequests.some((request) => request.id === approval.request_id),
  );
  const classOptions = classes.filter((item) => item.id !== selectedStudent?.class_id);

  useEffect(() => {
    if (!selectedStudent || !permissions.has("students.transfer")) {
      setEligibility(null);
      return;
    }
    const needsClass = action?.requiresDestination ?? false;
    if (needsClass && !targetClassId) {
      setEligibility(null);
      return;
    }
    let active = true;
    const loadPreview = async () => {
      const result = await client.rpc("student_mobility_preview", {
        p_student: selectedStudent.id,
        p_target_class: action?.requiresDestination ? targetClassId || null : null,
        p_movement_type: movementType,
        p_additional_students: 0,
      });
      if (!active) return;
      if (result.error) {
        setEligibility(null);
        return;
      }
      setEligibility(result.data as Eligibility);
    };
    void loadPreview();
    return () => {
      active = false;
    };
  }, [action?.requiresDestination, movementType, permissions, selectedStudent, targetClassId]);

  useEffect(() => {
    if (!availableActions.some((item) => item.type === movementType)) {
      setMovementType(availableActions[0]?.type ?? "promote");
    }
    const fallbackClass = classes.find((item) => item.id !== selectedStudent?.class_id)?.id ?? "";
    if (targetClassId && targetClassId === selectedStudent?.class_id)
      setTargetClassId(fallbackClass);
    if (!targetClassId && fallbackClass) setTargetClassId(fallbackClass);
  }, [availableActions, classes, movementType, selectedStudent?.class_id, targetClassId]);

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStudent || !action || !eligibility || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const destination = classById.get(targetClassId);
    const effectiveAt = new Date(`${effectiveDate}T00:00:00`).toISOString();
    const result = await client.rpc("student_mobility_request", {
      p_student: selectedStudent.id,
      p_target_class: action.requiresDestination ? targetClassId : null,
      p_movement_type: movementType,
      p_reason: reason,
      p_target_session: destination?.academic_year ?? null,
      p_target_shift: destination?.shift_id ? (shiftById.get(destination.shift_id) ?? null) : null,
      p_effective_at: effectiveAt,
    });
    if (result.error) setError(result.error.message);
    else {
      setNotice("Movement request submitted for the configured approval chain.");
      setReason("");
      await refresh();
    }
    setBusy(false);
  }

  async function runRequestAction(
    name: "student_mobility_approve" | "student_mobility_cancel" | "student_mobility_commit",
    requestId: string,
  ) {
    setBusy(true);
    setError("");
    const args =
      name === "student_mobility_approve"
        ? { p_request: requestId, p_decision: "approved", p_reason: null }
        : { p_request: requestId };
    const result = await client.rpc(name, args);
    if (result.error) setError(result.error.message);
    else {
      setNotice(
        name === "student_mobility_approve"
          ? "Approval recorded."
          : name === "student_mobility_cancel"
            ? "Movement cancelled before its effective date."
            : "Approved movement committed; the placement timeline has been updated.",
      );
      await refresh();
    }
    setBusy(false);
  }

  function bulkItems() {
    return bulkSelected.map((studentId) => {
      const override = bulkOverrides[studentId];
      return {
        student_id: studentId,
        target_class_id: override?.targetClassId || bulkTargetClass,
        movement_type: override?.movementType || "promote",
        reason: "End-of-session promotion",
      };
    });
  }

  async function previewBulk() {
    if (!bulkSelected.length || !bulkTargetClass) return;
    setBusy(true);
    setError("");
    const result = await client.rpc("student_mobility_bulk_preview", { p_items: bulkItems() });
    if (result.error) {
      setError(result.error.message);
      setBulkPreview([]);
    } else {
      setBulkPreview(responseRows<Eligibility>(result.data));
      setNotice("Dry-run complete. Review every student result before submitting the batch.");
    }
    setBusy(false);
  }

  async function submitBulk() {
    if (!bulkSelected.length || bulkPreview.length !== bulkSelected.length) return;
    setBusy(true);
    setError("");
    const result = await client.rpc("student_mobility_bulk_request", {
      p_items: bulkItems(),
      p_effective_at: new Date(`${effectiveDate}T00:00:00`).toISOString(),
    });
    if (result.error) setError(result.error.message);
    else {
      setNotice(`${responseRows(result.data).length} promotion requests submitted atomically.`);
      setBulkSelected([]);
      setBulkPreview([]);
      await refresh();
    }
    setBusy(false);
  }

  const sourceStudents = students.filter(
    (student) => student.class_id === bulkSourceClass && activeStudent(student),
  );
  const openRequestPending = selectedRequests.find((request) =>
    ["pending", "approved"].includes(request.status),
  );
  const canApprove = Boolean(
    openRequestPending &&
    permissions.has("students.transfer") &&
    openRequestPending.requested_by !== userId &&
    openRequestPending.status === "pending",
  );

  if (!permissions.has("students.view") && !loading) {
    return (
      <section className="app-shell-section student-mobility" data-testid="student-mobility">
        <h1>Students</h1>
        <p role="status">Your current permissions do not include students.view.</p>
      </section>
    );
  }

  return (
    <section className="app-shell-section student-mobility" data-testid="student-mobility">
      <header className="mobility-heading">
        <div>
          <span className="mobility-eyebrow">{shell.orgName}</span>
          <h1>Student records</h1>
          <p>One student identity, with placement history and balances kept in context.</p>
        </div>
        <div className="mobility-header-actions">
          {permissions.has("students.transfer") ? (
            <button
              type="button"
              className="mobility-secondary"
              onClick={() => setBulkOpen((open) => !open)}
            >
              <Users size={16} /> {bulkOpen ? "Close bulk wizard" : "Bulk promotion"}
            </button>
          ) : null}
          <button
            type="button"
            className="mobility-icon-button"
            aria-label="Refresh student records"
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      {error ? (
        <p className="mobility-alert" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mobility-notice" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? <p className="mobility-loading">Loading tenant-scoped student records…</p> : null}

      {!loading && bulkOpen && permissions.has("students.transfer") ? (
        <section className="mobility-bulk" aria-labelledby="mobility-bulk-title">
          <div className="mobility-panel-heading">
            <div>
              <span className="mobility-eyebrow">End of session</span>
              <h2 id="mobility-bulk-title">Promotion wizard</h2>
            </div>
            <span className="mobility-count">{bulkSelected.length} selected</span>
          </div>
          <div className="mobility-bulk-controls">
            <label>
              Source class / arm
              <select
                value={bulkSourceClass}
                onChange={(event) => {
                  setBulkSourceClass(event.target.value);
                  setBulkSelected([]);
                  setBulkPreview([]);
                }}
              >
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {classLabel(item, campusById, sectionById, shiftById)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Default destination
              <select
                value={bulkTargetClass}
                onChange={(event) => {
                  setBulkTargetClass(event.target.value);
                  setBulkPreview([]);
                }}
              >
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {classLabel(item, campusById, sectionById, shiftById)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effective date
              <input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </label>
          </div>
          <div className="mobility-bulk-list">
            <div className="mobility-bulk-row mobility-bulk-header">
              <span>Student</span>
              <span>Action override</span>
              <span>Destination override</span>
            </div>
            {sourceStudents.map((student) => {
              const checked = bulkSelected.includes(student.id);
              const override = bulkOverrides[student.id] ?? {
                targetClassId: bulkTargetClass,
                movementType: "promote" as StudentMovementType,
              };
              return (
                <div className="mobility-bulk-row" key={student.id}>
                  <label className="mobility-student-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setBulkSelected((current) =>
                          event.target.checked
                            ? [...current, student.id]
                            : current.filter((id) => id !== student.id),
                        );
                        setBulkPreview([]);
                      }}
                    />
                    <span>{student.full_name}</span>
                    <small>{student.admission_number ?? "No admission number"}</small>
                  </label>
                  <select
                    aria-label={`Movement override for ${student.full_name}`}
                    value={override.movementType}
                    onChange={(event) => {
                      setBulkOverrides((current) => ({
                        ...current,
                        [student.id]: {
                          ...override,
                          movementType: event.target.value as StudentMovementType,
                        },
                      }));
                      setBulkPreview([]);
                    }}
                  >
                    <option value="promote">Promote</option>
                    <option value="repeat">Repeat / retain</option>
                    <option value="conditional_promote">Conditional promotion</option>
                    <option value="double_promote">Double promotion</option>
                  </select>
                  <select
                    aria-label={`Destination override for ${student.full_name}`}
                    value={override.targetClassId}
                    onChange={(event) => {
                      setBulkOverrides((current) => ({
                        ...current,
                        [student.id]: { ...override, targetClassId: event.target.value },
                      }));
                      setBulkPreview([]);
                    }}
                  >
                    {classes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {classLabel(item, campusById, sectionById, shiftById)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            {!sourceStudents.length ? (
              <p className="mobility-empty">No active students are assigned to this class.</p>
            ) : null}
          </div>
          <div className="mobility-bulk-footer">
            <button
              type="button"
              className="mobility-secondary"
              disabled={!bulkSelected.length || busy}
              onClick={() => void previewBulk()}
            >
              Run dry-run
            </button>
            <button
              type="button"
              className="mobility-primary"
              disabled={
                !bulkPreview.length ||
                bulkPreview.length !== bulkSelected.length ||
                bulkPreview.some((item) => !item.eligible) ||
                busy
              }
              onClick={() => void submitBulk()}
            >
              Submit promotion requests
            </button>
          </div>
          {bulkPreview.length ? (
            <div className="mobility-preview-list" aria-live="polite">
              {bulkPreview.map((result) => (
                <div className="mobility-preview-row" key={result.student_id}>
                  <strong>{studentById.get(result.student_id)?.full_name ?? "Student"}</strong>
                  <span className={result.eligible ? "mobility-good" : "mobility-blocked"}>
                    {result.eligible ? "Eligible" : "Needs review"}
                  </span>
                  <p>
                    {result.unmet?.join("; ") ||
                      result.warnings?.join("; ") ||
                      "Configured rules and capacity checks passed."}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="mobility-workspace">
        <aside className="mobility-student-list" aria-label="Students">
          <label className="mobility-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search students"
              aria-label="Search students"
            />
          </label>
          <div className="mobility-student-list-body">
            {visibleStudents.map((student) => (
              <button
                type="button"
                key={student.id}
                className={`mobility-student-item${student.id === selectedId ? " is-active" : ""}`}
                onClick={() => {
                  setSelectedId(student.id);
                  setActiveTab("profile");
                  setEligibility(null);
                }}
              >
                <span className="mobility-avatar">{initials(student.full_name)}</span>
                <span className="mobility-student-item-copy">
                  <strong>{student.full_name}</strong>
                  <small>
                    {student.admission_number ?? "No admission number"} ·{" "}
                    {classById.get(student.class_id ?? "")?.name ?? "Unassigned"}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!visibleStudents.length && !loading ? (
              <p className="mobility-empty">No students match this search.</p>
            ) : null}
          </div>
        </aside>

        <main className="mobility-profile">
          {selectedStudent ? (
            <>
              <div className="mobility-profile-header">
                <div className="mobility-profile-title">
                  <span className="mobility-avatar mobility-avatar-large">
                    {initials(selectedStudent.full_name)}
                  </span>
                  <div>
                    <span className="mobility-eyebrow">Student passport</span>
                    <h2>{selectedStudent.full_name}</h2>
                    <p>
                      {selectedStudent.admission_number ?? "No admission number"} ·{" "}
                      {classLabel(
                        classById.get(selectedStudent.class_id ?? ""),
                        campusById,
                        sectionById,
                        shiftById,
                      )}
                    </p>
                  </div>
                </div>
                <span
                  className={`mobility-status${activeStudent(selectedStudent) ? " is-active" : ""}`}
                >
                  {activeStudent(selectedStudent) ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="mobility-balance-card">
                <div>
                  <span className="mobility-eyebrow">Consolidated outstanding balance</span>
                  <strong>
                    {permissions.has("fees.view") ? currency(selectedBalance) : "Restricted"}
                  </strong>
                  <small>
                    {permissions.has("fees.view")
                      ? "Open fee records across this organization; invoices remain in their originating ledger."
                      : "Your current permissions do not include fees.view."}
                  </small>
                </div>
                <span className="mobility-balance-icon">₦</span>
              </div>
              <div className="mobility-tabs" role="tablist" aria-label="Student profile">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "profile"}
                  onClick={() => setActiveTab("profile")}
                >
                  Overview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "movement"}
                  onClick={() => setActiveTab("movement")}
                >
                  Movement
                </button>
              </div>

              {activeTab === "profile" ? (
                <section className="mobility-profile-grid" aria-label="Student overview">
                  <article className="mobility-card">
                    <span className="mobility-eyebrow">Current placement</span>
                    <strong>
                      {classLabel(
                        classById.get(selectedStudent.class_id ?? ""),
                        campusById,
                        sectionById,
                        shiftById,
                      )}
                    </strong>
                    <small>
                      Session{" "}
                      {classById.get(selectedStudent.class_id ?? "")?.academic_year ??
                        "not recorded"}
                    </small>
                  </article>
                  <article className="mobility-card">
                    <span className="mobility-eyebrow">Placement history</span>
                    <strong>{selectedPlacements.length} recorded placements</strong>
                    <small>
                      Previous campus, section, shift, class and arm stay in the timeline.
                    </small>
                  </article>
                  {permissions.has("students.transfer") ? (
                    <button
                      type="button"
                      className="mobility-link-card"
                      onClick={() => setActiveTab("movement")}
                    >
                      <span>
                        <strong>Movement and approvals</strong>
                        <small>Review placement history and submit a human-approved change.</small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ) : null}
                  {requests
                    .filter((request) => request.student_id === selectedId)
                    .map((request) => (
                      <RequestCard
                        key={request.id}
                        request={request}
                        approvals={approvals.filter((item) => item.request_id === request.id)}
                        rules={policy}
                        currentUserId={userId}
                        canMove={permissions.has("students.transfer")}
                        busy={busy}
                        onApprove={() =>
                          void runRequestAction("student_mobility_approve", request.id)
                        }
                        onCancel={() =>
                          void runRequestAction("student_mobility_cancel", request.id)
                        }
                        onCommit={() =>
                          void runRequestAction("student_mobility_commit", request.id)
                        }
                      />
                    ))}
                </section>
              ) : (
                <section
                  className="mobility-movement-panel"
                  aria-label="Movement history and actions"
                >
                  {permissions.has("students.transfer") ? (
                    <form
                      className="mobility-movement-form"
                      onSubmit={(event) => void submitMovement(event)}
                    >
                      <div className="mobility-panel-heading">
                        <div>
                          <span className="mobility-eyebrow">Human approval required</span>
                          <h3>Request a movement</h3>
                        </div>
                        {policy ? (
                          <span className="mobility-count">
                            {policy.required_approvals} approval(s)
                          </span>
                        ) : null}
                      </div>
                      <div className="mobility-form-grid">
                        <label>
                          Movement
                          <select
                            value={movementType}
                            onChange={(event) => {
                              const nextType = event.target.value as StudentMovementType;
                              setMovementType(nextType);
                              if (nextType === "repeat")
                                setTargetClassId(selectedStudent.class_id ?? "");
                              else if (targetClassId === selectedStudent.class_id) {
                                setTargetClassId(
                                  classes.find((item) => item.id !== selectedStudent.class_id)
                                    ?.id ?? "",
                                );
                              }
                              setEligibility(null);
                            }}
                          >
                            {availableActions.map((item) => (
                              <option key={item.type} value={item.type}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {action?.requiresDestination ? (
                          <label>
                            Destination placement
                            <select
                              value={targetClassId}
                              onChange={(event) => setTargetClassId(event.target.value)}
                            >
                              <option value="">Select class, arm, campus, section and shift</option>
                              {(movementType === "repeat"
                                ? classes.filter((item) => item.id === selectedStudent.class_id)
                                : classes.filter((item) => item.id !== selectedStudent.class_id)
                              ).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {classLabel(item, campusById, sectionById, shiftById)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        <label>
                          Effective date
                          <input
                            type="date"
                            value={effectiveDate}
                            onChange={(event) => setEffectiveDate(event.target.value)}
                          />
                        </label>
                        <label className="mobility-reason">
                          Reason for review
                          <textarea
                            required
                            minLength={5}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="Record the institutional reason for this movement"
                          />
                        </label>
                      </div>
                      {eligibility ? <EligibilityCard result={eligibility} /> : null}
                      <div className="mobility-approval-chain">
                        <strong>Approval chain</strong>
                        <span>
                          {policy?.approval_roles?.length
                            ? policy.approval_roles.join(" → ")
                            : `${policy?.required_approvals ?? 2} distinct authorized approvers`}
                        </span>
                      </div>
                      <button
                        className="mobility-primary"
                        type="submit"
                        disabled={
                          busy ||
                          !reason.trim() ||
                          !eligibility ||
                          !eligibility.eligible ||
                          (action?.requiresDestination && !targetClassId)
                        }
                      >
                        {busy ? "Submitting…" : "Submit for approval"}
                      </button>
                    </form>
                  ) : (
                    <p className="mobility-empty">
                      Your current permissions do not include students.transfer.
                    </p>
                  )}

                  <div className="mobility-panel-heading mobility-timeline-heading">
                    <div>
                      <span className="mobility-eyebrow">Cross-campus record</span>
                      <h3>Placement timeline</h3>
                    </div>
                    <span className="mobility-count">
                      {selectedEvents.length || selectedPlacements.length} events
                    </span>
                  </div>
                  <div className="mobility-timeline">
                    {selectedPlacements.map((placement) => {
                      const itemClass = classById.get(placement.class_id ?? "");
                      const campusId = placement.campus_id ?? itemClass?.campus_id ?? null;
                      const sectionId = placement.section_id ?? itemClass?.section_id ?? null;
                      return (
                        <article className="mobility-timeline-item" key={placement.id}>
                          <span className="mobility-timeline-dot" />
                          <div>
                            <div className="mobility-timeline-meta">
                              <strong>
                                {MOVEMENT_LABELS[placement.movement_type] ??
                                  placement.movement_type}
                              </strong>
                              <time>{displayDate(placement.effective_from)}</time>
                            </div>
                            <p>
                              {classLabel(itemClass, campusById, sectionById, shiftById, {
                                campusId,
                                sectionId,
                                shift: placement.shift,
                                arm: placement.arm,
                              })}
                            </p>
                            <small>
                              {placement.reason} · Session {placement.session ?? "not recorded"}
                            </small>
                            {placement.effective_to ? (
                              <small>Ended {displayDate(placement.effective_to)}</small>
                            ) : (
                              <span className="mobility-current-tag">Current placement</span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {!selectedPlacements.length && !selectedEvents.length ? (
                      <p className="mobility-empty">No placement timeline has been recorded yet.</p>
                    ) : null}
                  </div>
                  {selectedEvents.length ? (
                    <details className="mobility-event-log">
                      <summary>Audit events ({selectedEvents.length})</summary>
                      {selectedEvents.map((event) => (
                        <p key={event.id}>
                          {MOVEMENT_LABELS[event.movement_type] ?? event.movement_type} ·{" "}
                          {displayDate(event.effective_at)} · {event.reason}
                        </p>
                      ))}
                    </details>
                  ) : null}
                  {selectedRequests.length ? (
                    <div className="mobility-requests">
                      <h3>Review queue</h3>
                      {selectedRequests.map((request) => (
                        <RequestCard
                          key={request.id}
                          request={request}
                          approvals={selectedApprovals.filter(
                            (item) => item.request_id === request.id,
                          )}
                          rules={policy}
                          currentUserId={userId}
                          canMove={permissions.has("students.transfer")}
                          busy={busy}
                          onApprove={() =>
                            void runRequestAction("student_mobility_approve", request.id)
                          }
                          onCancel={() =>
                            void runRequestAction("student_mobility_cancel", request.id)
                          }
                          onCommit={() =>
                            void runRequestAction("student_mobility_commit", request.id)
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                  {!canApprove && openRequestPending?.status === "pending" ? (
                    <p className="mobility-hint">
                      The requester cannot approve their own movement.
                    </p>
                  ) : null}
                </section>
              )}
            </>
          ) : (
            <div className="mobility-empty-state">
              <span className="mobility-empty-icon">
                <Users size={22} />
              </span>
              <h2>{loading ? "Loading student records" : "Select a student"}</h2>
              <p>
                Student profiles, placement history, and balances remain scoped to the current
                organization.
              </p>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function classLabel(
  item: ClassRow | undefined,
  campusById: Map<string, string>,
  sectionById: Map<string, string>,
  shiftById: Map<string, string>,
  override?: {
    campusId: string | null;
    sectionId: string | null;
    shift: string | null;
    arm: string | null;
  },
): string {
  if (!item) return "No class placement";
  const campusId = override?.campusId ?? item.campus_id;
  const sectionId = override?.sectionId ?? item.section_id;
  const shiftName = override?.shift ?? (item.shift_id ? shiftById.get(item.shift_id) : null);
  const arm = override?.arm ?? item.arm;
  return [
    item.name,
    arm ? `Arm ${arm}` : null,
    sectionId ? sectionById.get(sectionId) : null,
    shiftName,
    campusId ? campusById.get(campusId) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function EligibilityCard({ result }: { result: Eligibility }) {
  return (
    <div
      className={`mobility-eligibility${result.eligible ? " is-eligible" : " is-blocked"}`}
      aria-live="polite"
    >
      <div>
        <strong>
          {result.eligible ? "Eligibility checks passed" : "Reviewer attention required"}
        </strong>
        <span>
          Average: {result.average_pct == null ? "—" : `${Number(result.average_pct).toFixed(1)}%`}{" "}
          · Attendance:{" "}
          {result.attendance_pct == null ? "—" : `${Number(result.attendance_pct).toFixed(1)}%`} ·
          Balance: {currency(Number(result.outstanding_balance ?? 0))}
        </span>
      </div>
      {result.unmet?.length ? (
        <ul>
          {result.unmet.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {result.warnings?.length ? (
        <ul className="mobility-warning-list">
          {result.warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RequestCard({
  request,
  approvals,
  rules,
  currentUserId,
  canMove,
  busy,
  onApprove,
  onCancel,
  onCommit,
}: {
  request: MobilityRequest;
  approvals: Approval[];
  rules: MobilityPolicy | null;
  currentUserId: string;
  canMove: boolean;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const [reviewEligibility, setReviewEligibility] = useState<Eligibility | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const approvalCount = approvals.filter((approval) => approval.decision === "approved").length;
  const canApprove =
    canMove && request.status === "pending" && request.requested_by !== currentUserId;
  const canCancel =
    canMove &&
    ["pending", "approved"].includes(request.status) &&
    Date.parse(request.effective_at) > Date.now();
  const canCommit =
    canMove && request.status === "approved" && Date.parse(request.effective_at) <= Date.now();
  const target = request.policy_snapshot ?? {};

  useEffect(() => {
    if (!canMove) return;
    let active = true;
    void client
      .rpc("student_mobility_preview", {
        p_student: request.student_id,
        p_target_class: request.target_class_id,
        p_movement_type: request.movement_type,
        p_additional_students: 0,
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setPreviewUnavailable(true);
        else setReviewEligibility(data as Eligibility);
      })
      .catch(() => {
        if (active) setPreviewUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [canMove, request.movement_type, request.student_id, request.target_class_id]);

  return (
    <article className="mobility-request-card">
      <div className="mobility-request-title">
        <div>
          <strong>{MOVEMENT_LABELS[request.movement_type] ?? request.movement_type}</strong>
          <small>
            {request.reason} · Effective {displayDate(request.effective_at)}
          </small>
        </div>
        <span className={`mobility-request-status status-${request.status}`}>
          {request.status.replaceAll("_", " ")}
        </span>
      </div>
      <div className="mobility-request-progress">
        <span>
          {approvalCount} of {rules?.required_approvals ?? 2} approvals
        </span>
        <div className="mobility-progress-track">
          <span
            style={{
              width: `${Math.min(100, (approvalCount / Math.max(1, rules?.required_approvals ?? 2)) * 100)}%`,
            }}
          />
        </div>
      </div>
      {approvals.length ? (
        <ol className="mobility-approval-list">
          {approvals.map((approval) => (
            <li key={approval.id}>
              <Check size={14} /> Step {approval.step}:{" "}
              {approval.approver_role ?? "Authorized reviewer"} · {approval.decision}
            </li>
          ))}
        </ol>
      ) : null}
      {reviewEligibility ? (
        <EligibilityCard result={reviewEligibility} />
      ) : previewUnavailable ? (
        <p className="mobility-hint">
          Eligibility preview is unavailable; ask an authorized reviewer to refresh the record.
        </p>
      ) : canMove ? (
        <p className="mobility-hint">Checking current eligibility…</p>
      ) : null}
      {Object.keys(target).length ? <small>Policy snapshot: {JSON.stringify(target)}</small> : null}
      <div className="mobility-request-actions">
        {canApprove ? (
          <button type="button" className="mobility-secondary" disabled={busy} onClick={onApprove}>
            Approve
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" className="mobility-secondary" disabled={busy} onClick={onCancel}>
            Cancel before effective date
          </button>
        ) : null}
        {canCommit ? (
          <button type="button" className="mobility-primary" disabled={busy} onClick={onCommit}>
            Commit approved movement
          </button>
        ) : null}
        {request.status === "pending" && request.requested_by === currentUserId ? (
          <span className="mobility-hint">Awaiting another authorized reviewer.</span>
        ) : null}
      </div>
    </article>
  );
}
