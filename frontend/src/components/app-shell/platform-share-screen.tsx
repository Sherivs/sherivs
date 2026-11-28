/**
 * PSA-01 operator screen (ADR-162): which schools owe the Sherivs platform share, which students
 * paid at the school without the share being taken, and what each school's wallet can cover.
 * Opened at /home/s/platform-share.
 *
 * Read-only on purpose. Accrual, settlement and waiver stay as database functions run by an
 * operator or a schedule; this screen only asks and shows. The database refuses anyone who is
 * not a platform operator, so a non-operator sees a plain refusal and no data.
 */
import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import {
  attentionOrder,
  buildCollectionsView,
  buildStudentListView,
  checkScope,
  collectedCount,
  describeRpcError,
  formatNaira,
  formatPercent,
  type CollectionsView,
  type StudentListView,
} from "@/lib/platform-share/operator-view";

type Result = { data: unknown; error: { message: string } | null };
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> };
const db = supabase as unknown as Rpc;

const STUDENT_LIMIT = 1000;
const CHANNEL_LABEL: Record<string, string> = {
  online: "Paid online",
  wallet_cash: "Taken from wallet (cash)",
  wallet_auto: "Taken from wallet (automatic)",
  waived: "Waived",
  pending: "Not yet taken",
  other: "Other",
};

export function PlatformShareScreen() {
  const [year, setYear] = useState("");
  const [term, setTerm] = useState("");
  const [view, setView] = useState<CollectionsView | null>(null);
  const [school, setSchool] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentListView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const scope = checkScope(year, term);
    if (!scope.ok) {
      setError(scope.reason);
      return;
    }
    setBusy(true);
    setError("");
    setSchool(null);
    setStudents(null);
    const { data, error: err } = await db.rpc("platform_share_collections", {
      p_school: null,
      p_year: scope.year,
      p_term: scope.term,
    });
    setBusy(false);
    if (err) {
      setView(null);
      setError(describeRpcError(err.message));
      return;
    }
    setView(buildCollectionsView(data));
  }, [year, term]);

  const openSchool = useCallback(
    async (schoolId: string) => {
      const scope = checkScope(year, term);
      if (!scope.ok) return;
      setSchool(schoolId);
      setStudents(null);
      const { data, error: err } = await db.rpc("platform_share_student_list", {
        p_school: schoolId,
        p_year: scope.year,
        p_term: scope.term,
        p_limit: STUDENT_LIMIT,
      });
      if (err) {
        setError(describeRpcError(err.message));
        return;
      }
      setStudents(buildStudentListView(data, STUDENT_LIMIT));
    },
    [year, term],
  );

  const t = view?.totals;
  return (
    <section className="wf-inbox" aria-labelledby="ps-heading">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <p className="wf-inbox-eyebrow">Sherivs operator</p>
      <h1 id="ps-heading" className="wf-inbox-heading">
        Platform share collections
      </h1>
      <p className="wf-inbox-subtitle">
        Per school and term: what has accrued, how it was collected, and the students who paid at
        the school without the share being taken. Read only.
      </p>

      <form
        className="wf-inbox-field"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          Academic year
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026/2027" />
        </label>
        <label>
          Term
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="First" />
        </label>
        <button type="submit" className="wf-inbox-button" disabled={busy}>
          <RefreshCw size={14} aria-hidden="true" /> {busy ? "Loading" : "Load report"}
        </button>
      </form>

      {error ? (
        <p className="wf-inbox-error" role="alert">
          {error}
        </p>
      ) : null}

      {view && t ? (
        <>
          <p className="wf-inbox-live" aria-live="polite">
            {view.schools.length} school{view.schools.length === 1 ? "" : "s"} · accrued{" "}
            {formatNaira(t.accruedAmount)} · overdue {formatNaira(t.overdueAmount)} · collected{" "}
            {formatPercent(view.collectionRate)} of students
          </p>
          {view.dropped > 0 ? (
            <p className="wf-inbox-notice">
              {view.dropped} row{view.dropped === 1 ? "" : "s"} could not be read and{" "}
              {view.dropped === 1 ? "is" : "are"} not shown.
            </p>
          ) : null}
          {view.schools.length === 0 ? (
            <p className="wf-inbox-empty">Nothing has accrued for this term yet.</p>
          ) : (
            <table className="wf-inbox-detail">
              <thead>
                <tr>
                  <th>School</th>
                  <th>Accrued</th>
                  <th>Collected</th>
                  <th>Overdue</th>
                  <th>Paid, share not taken</th>
                  <th>Wallet</th>
                  <th>Wallet short by</th>
                </tr>
              </thead>
              <tbody>
                {attentionOrder(view.schools).map((s) => (
                  <tr key={s.schoolId}>
                    <td>
                      <button
                        type="button"
                        className="wf-inbox-button"
                        onClick={() => void openSchool(s.schoolId)}
                      >
                        {s.schoolId.slice(0, 8)}
                      </button>
                    </td>
                    <td>
                      {s.accrued} · {formatNaira(s.accruedAmount)}
                    </td>
                    <td>
                      {collectedCount(s)} of {s.accrued}
                    </td>
                    <td>
                      {s.overdue} · {formatNaira(s.overdueAmount)}
                    </td>
                    <td>{s.paidShareNotTaken}</td>
                    <td>{formatNaira(s.walletBalance)}</td>
                    <td>{formatNaira(s.walletCoverGap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}

      {school && students ? (
        <div className="wf-inbox-detail">
          <h2>Students, school {school.slice(0, 8)}</h2>
          <p className="wf-inbox-subtitle">
            Student ids only; no names are shown here.
            {students.truncated ? ` Showing the first ${STUDENT_LIMIT}.` : ""}
          </p>
          <p>
            {students.paidShareNotTaken.length} paid at the school with the share not yet taken.
          </p>
          <ul>
            {students.rows.map((r) => (
              <li key={r.studentId}>
                {r.studentId.slice(0, 8)} · {CHANNEL_LABEL[r.channel]} · {formatNaira(r.amount)}
                {r.overdue ? " · overdue" : ""}
                {r.hasRecordedPayment ? " · payment recorded" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
