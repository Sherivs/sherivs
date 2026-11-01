import { useEffect, useRef, useState } from "react";
import { runAuditedBulkAction, type AuditedBulkAction } from "./bulk-action";

export interface BulkActionItem {
  id: string;
  label: string;
}

export function BulkActionFramework({
  items,
  actions,
}: {
  items: readonly BulkActionItem[];
  actions: readonly AuditedBulkAction[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState<AuditedBulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedIds = items.filter((item) => selected.has(item.id)).map((item) => item.id);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (confirming && dialog && !dialog.open) dialog.showModal();
    if (!confirming && dialog?.open) dialog.close();
  }, [confirming]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmAction() {
    if (!confirming) return;
    setBusy(true);
    setMessage(null);
    try {
      const receipt = await runAuditedBulkAction(confirming, selectedIds, true);
      if (receipt) {
        setSelected(new Set());
        setMessage("Action completed and audit recorded.");
      }
    } catch {
      setMessage("Action failed. Your selection is unchanged.");
    }
    setBusy(false);
    setConfirming(null);
  }

  return (
    <section className="app-shell-bulk-actions" aria-label="Bulk actions">
      <div role="group" aria-label="Select items">
        {items.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id)}
            />
            {item.label}
          </label>
        ))}
      </div>
      {selectedIds.length ? (
        <div className="app-shell-bulk-action-buttons">
          <span>{selectedIds.length} selected</span>
          {actions.map((action) => (
            <button
              type="button"
              key={action.id}
              disabled={busy}
              onClick={() => setConfirming(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {confirming ? (
        <dialog
          ref={dialogRef}
          className="app-shell-bulk-confirm"
          aria-labelledby="bulk-confirm-heading"
          onCancel={(event) => {
            event.preventDefault();
            setConfirming(null);
          }}
        >
          <h2 id="bulk-confirm-heading">Confirm {confirming.label}</h2>
          <p>This action affects {selectedIds.length} selected items.</p>
          <button type="button" disabled={busy} onClick={() => void confirmAction()}>
            {busy ? "Working…" : "Confirm"}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </dialog>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
