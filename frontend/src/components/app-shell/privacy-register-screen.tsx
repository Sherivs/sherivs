import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useApp } from "@/contexts/app-context";
import {
  exportPrivacyRegister,
  loadPrivacyRegister,
  reviewPlatformRopa,
  saveDpia,
  saveRopaActivity,
  signOffDpia,
  type DpiaRecord,
  type PrivacyRegisterSnapshot,
  type RopaActivity,
} from "@/lib/compliance/privacy-register.functions";

const emptyRopa = {
  id: null as string | null,
  activityKey: "",
  title: "",
  purpose: "",
  subjectCategories: "",
  dataCategories: "",
  recipients: "",
  transferDetails: "",
  retentionReference: "",
  securityMeasures: "",
};

const emptyDpia = {
  id: null as string | null,
  title: "",
  activity: "",
  categories: "",
  riskLevel: "medium" as "low" | "medium" | "high",
  risks: "",
  mitigations: "",
};

function asLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function snapshotFrom(value: unknown): PrivacyRegisterSnapshot {
  if (!value || typeof value !== "object") {
    return { ropa: [], dpia: [], can_sign_off: false };
  }
  const candidate = value as Partial<PrivacyRegisterSnapshot>;
  return {
    ropa: Array.isArray(candidate.ropa) ? candidate.ropa : [],
    dpia: Array.isArray(candidate.dpia) ? candidate.dpia : [],
    can_sign_off: candidate.can_sign_off === true,
  };
}

function arrayText(value: string[] | null | undefined): string {
  return value?.join("\n") ?? "";
}

export function PrivacyRegisterScreen() {
  const app = useApp();
  const schoolId = app.profile ? (app.school?.id ?? null) : app.superAdmin ? null : undefined;
  const [snapshot, setSnapshot] = useState<PrivacyRegisterSnapshot>({
    ropa: [],
    dpia: [],
    can_sign_off: false,
  });
  const [ropaForm, setRopaForm] = useState(emptyRopa);
  const [dpiaForm, setDpiaForm] = useState(emptyDpia);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (schoolId === undefined) {
      setLoading(false);
      setError("Privacy register access is unavailable for this account.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await loadPrivacyRegister({ data: { schoolId } });
      setSnapshot(snapshotFrom(result));
    } catch {
      setError("You do not have permission to access this privacy register.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function editRopa(row: RopaActivity) {
    setRopaForm({
      id: row.id,
      activityKey: row.activity_key,
      title: row.title,
      purpose: row.purpose,
      subjectCategories: arrayText(row.data_subject_categories),
      dataCategories: arrayText(row.data_categories),
      recipients: arrayText(row.recipients),
      transferDetails: arrayText(row.transfer_details),
      retentionReference: row.retention_reference,
      securityMeasures: row.security_measures,
    });
  }

  function editDpia(row: DpiaRecord) {
    setDpiaForm({
      id: row.id,
      title: row.title,
      activity: row.processing_activity,
      categories: arrayText(row.data_categories),
      riskLevel: row.risk_level,
      risks: arrayText(row.risks),
      mitigations: row.mitigations ?? "",
    });
  }

  async function submitRopa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (schoolId === undefined) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveRopaActivity({
        data: {
          schoolId,
          id: ropaForm.id,
          activityKey: ropaForm.activityKey,
          title: ropaForm.title,
          purpose: ropaForm.purpose,
          subjectCategories: asLines(ropaForm.subjectCategories),
          dataCategories: asLines(ropaForm.dataCategories),
          recipients: asLines(ropaForm.recipients),
          transferDetails: asLines(ropaForm.transferDetails),
          retentionReference: ropaForm.retentionReference,
          securityMeasures: ropaForm.securityMeasures,
        },
      });
      setRopaForm(emptyRopa);
      setNotice("Processing activity saved.");
      await reload();
    } catch {
      setError("Could not save this processing activity. Check the fields and access.");
    } finally {
      setBusy(false);
    }
  }

  async function submitDpia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!schoolId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveDpia({
        data: {
          schoolId,
          id: dpiaForm.id,
          title: dpiaForm.title,
          activity: dpiaForm.activity,
          categories: asLines(dpiaForm.categories),
          riskLevel: dpiaForm.riskLevel,
          risks: asLines(dpiaForm.risks),
          mitigations: dpiaForm.mitigations,
        },
      });
      setDpiaForm(emptyDpia);
      setNotice("DPIA draft saved.");
      await reload();
    } catch {
      setError("Could not save this DPIA draft. Check the fields and access.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRopa(row: RopaActivity, confirmedRealValues: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await reviewPlatformRopa({
        data: { ropaId: row.id, confirmedRealValues },
      });
      setNotice(
        confirmedRealValues
          ? "Platform activity reviewed and confirmed as accurate."
          : "Platform activity marked reviewed; it remains a synthetic placeholder.",
      );
      await reload();
    } catch {
      setError("Platform owner review was denied or could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function approveDpia(row: DpiaRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signOffDpia({ data: { dpiaId: row.id } });
      setNotice("DPIA signed off and recorded in the audit history.");
      await reload();
    } catch {
      setError("DPIA sign-off was denied or could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function exportRegister() {
    if (schoolId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const result = await exportPrivacyRegister({ data: { schoolId } });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "privacy-register.json";
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Privacy register export downloaded and audited.");
    } catch {
      setError("The privacy register export could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-shell-section" data-testid="privacy-register">
      <h1>Privacy registers</h1>
      <p className="app-shell-empty">
        Review processing activities and DPIA records for the active organization. Platform
        placeholders are synthetic and require owner review.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <button
        type="button"
        className="app-shell-secondary"
        onClick={() => void exportRegister()}
        disabled={busy || loading}
      >
        Export JSON
      </button>
      {loading ? <p role="status">Loading privacy registers…</p> : null}

      <section aria-labelledby="ropa-heading">
        <h2 id="ropa-heading">Records of Processing Activities</h2>
        <ul>
          {snapshot.ropa.map((row) => (
            <li key={row.id}>
              <h3>{row.title}</h3>
              <p>{row.purpose}</p>
              {row.is_synthetic || row.owner_review_status === "owner_review_required" ? (
                <p> Synthetic placeholder — owner review required.</p>
              ) : null}
              {row.owner_review_status === "owner_reviewed" ? (
                <p>Owner reviewed{row.is_synthetic ? "; still a synthetic placeholder." : "."}</p>
              ) : null}
              <button type="button" onClick={() => editRopa(row)} disabled={busy}>
                Edit
              </button>
              {schoolId === null && row.is_synthetic ? (
                <>
                  {row.owner_review_status === "owner_review_required" ? (
                    <button
                      type="button"
                      onClick={() => void reviewRopa(row, false)}
                      disabled={busy}
                    >
                      Mark reviewed; keep synthetic
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void reviewRopa(row, true)} disabled={busy}>
                    {row.owner_review_status === "owner_reviewed"
                      ? "Confirm real values and clear synthetic marker"
                      : "Confirm values accurate and complete review"}
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
        <form onSubmit={submitRopa}>
          <h3>{ropaForm.id ? "Edit processing activity" : "Add processing activity"}</h3>
          <label>
            Activity key
            <input
              required
              pattern="[a-z][a-z0-9_.-]{1,95}"
              value={ropaForm.activityKey}
              onChange={(event) => setRopaForm({ ...ropaForm, activityKey: event.target.value })}
            />
          </label>
          <label>
            Title
            <input
              required
              maxLength={160}
              value={ropaForm.title}
              onChange={(event) => setRopaForm({ ...ropaForm, title: event.target.value })}
            />
          </label>
          <label>
            Purpose
            <textarea
              required
              maxLength={2000}
              value={ropaForm.purpose}
              onChange={(event) => setRopaForm({ ...ropaForm, purpose: event.target.value })}
            />
          </label>
          <label>
            Data subject categories (one per line)
            <textarea
              value={ropaForm.subjectCategories}
              onChange={(event) =>
                setRopaForm({ ...ropaForm, subjectCategories: event.target.value })
              }
            />
          </label>
          <label>
            Data categories (one per line)
            <textarea
              value={ropaForm.dataCategories}
              onChange={(event) => setRopaForm({ ...ropaForm, dataCategories: event.target.value })}
            />
          </label>
          <label>
            Recipients (one per line)
            <textarea
              value={ropaForm.recipients}
              onChange={(event) => setRopaForm({ ...ropaForm, recipients: event.target.value })}
            />
          </label>
          <label>
            Transfers and safeguards (one per line)
            <textarea
              value={ropaForm.transferDetails}
              onChange={(event) =>
                setRopaForm({ ...ropaForm, transferDetails: event.target.value })
              }
            />
          </label>
          <label>
            Retention reference
            <textarea
              required
              maxLength={1000}
              value={ropaForm.retentionReference}
              onChange={(event) =>
                setRopaForm({ ...ropaForm, retentionReference: event.target.value })
              }
            />
          </label>
          <label>
            Security measures
            <textarea
              required
              maxLength={2000}
              value={ropaForm.securityMeasures}
              onChange={(event) =>
                setRopaForm({ ...ropaForm, securityMeasures: event.target.value })
              }
            />
          </label>
          <button type="submit" disabled={busy}>
            {ropaForm.id ? "Save activity" : "Add activity"}
          </button>
          {ropaForm.id ? (
            <button type="button" onClick={() => setRopaForm(emptyRopa)} disabled={busy}>
              Cancel edit
            </button>
          ) : null}
        </form>
      </section>

      {schoolId ? (
        <section aria-labelledby="dpia-heading">
          <h2 id="dpia-heading">DPIA register</h2>
          <ul>
            {snapshot.dpia.map((row) => (
              <li key={row.id}>
                <h3>{row.title}</h3>
                <p>{row.processing_activity}</p>
                <p>
                  Risk: {row.risk_level}; status: {row.status}
                </p>
                <p>Risks: {row.risks.join("; ") || "Not recorded"}</p>
                <p>Mitigations: {row.mitigations || "Not recorded"}</p>
                {row.status === "draft" ? (
                  <button type="button" onClick={() => editDpia(row)} disabled={busy}>
                    Edit draft
                  </button>
                ) : null}
                {snapshot.can_sign_off &&
                row.status === "draft" &&
                row.prepared_by !== app.authUser?.id ? (
                  <button type="button" onClick={() => void approveDpia(row)} disabled={busy}>
                    Sign off as DPO
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <form onSubmit={submitDpia}>
            <h3>{dpiaForm.id ? "Edit DPIA draft" : "Create DPIA draft"}</h3>
            <label>
              Title
              <input
                required
                maxLength={160}
                value={dpiaForm.title}
                onChange={(event) => setDpiaForm({ ...dpiaForm, title: event.target.value })}
              />
            </label>
            <label>
              Processing activity
              <textarea
                required
                maxLength={2000}
                value={dpiaForm.activity}
                onChange={(event) => setDpiaForm({ ...dpiaForm, activity: event.target.value })}
              />
            </label>
            <label>
              Data categories (one per line)
              <textarea
                value={dpiaForm.categories}
                onChange={(event) => setDpiaForm({ ...dpiaForm, categories: event.target.value })}
              />
            </label>
            <label>
              Risk level
              <select
                value={dpiaForm.riskLevel}
                onChange={(event) =>
                  setDpiaForm({
                    ...dpiaForm,
                    riskLevel: event.target.value as typeof dpiaForm.riskLevel,
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Risks (one per line)
              <textarea
                value={dpiaForm.risks}
                onChange={(event) => setDpiaForm({ ...dpiaForm, risks: event.target.value })}
              />
            </label>
            <label>
              Mitigations
              <textarea
                maxLength={4000}
                value={dpiaForm.mitigations}
                onChange={(event) => setDpiaForm({ ...dpiaForm, mitigations: event.target.value })}
              />
            </label>
            <button type="submit" disabled={busy}>
              {dpiaForm.id ? "Save DPIA draft" : "Create DPIA draft"}
            </button>
            {dpiaForm.id ? (
              <button type="button" onClick={() => setDpiaForm(emptyDpia)} disabled={busy}>
                Cancel edit
              </button>
            ) : null}
          </form>
        </section>
      ) : null}
    </section>
  );
}
