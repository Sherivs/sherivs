/**
 * Small accessible building blocks shared by the M4 screens: labelled fields whose errors are
 * linked with aria-describedby, 44 px targets, and status badges that never rely on colour alone.
 */
import { useId, type ReactNode } from "react";
import { CheckCircle2, CircleDashed, Clock3, Archive, AlertTriangle } from "lucide-react";
import { parseRoleBuilderError } from "@/lib/role-builder/role-builder-core";

export const TARGET = "min-h-11 min-w-11";

export function FieldShell({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          Error: {error}
        </p>
      ) : null}
    </div>
  );
}

const STATUS: Record<string, { label: string; Icon: typeof CheckCircle2 }> = {
  draft: { label: "Draft", Icon: CircleDashed },
  pending_approval: { label: "Waiting for a second administrator", Icon: Clock3 },
  active: { label: "Approved", Icon: CheckCircle2 },
  retired: { label: "Retired", Icon: Archive },
  open: { label: "Open", Icon: Clock3 },
  completed: { label: "Completed", Icon: CheckCircle2 },
  pending: { label: "Pending", Icon: Clock3 },
  retained: { label: "Kept", Icon: CheckCircle2 },
  revoked: { label: "Revoked", Icon: Archive },
  already_ended: { label: "Already ended", Icon: Archive },
  blocked: { label: "Blocked", Icon: AlertTriangle },
  in_force: { label: "In force", Icon: CheckCircle2 },
};

/** Text + icon status; colour is decoration only. */
export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS[status] ?? { label: status, Icon: CircleDashed };
  const { Icon } = entry;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      data-status={status}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {entry.label}
    </span>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const parsed = parseRoleBuilderError(error);
  return (
    <p role="alert" className="text-sm text-destructive" data-error-code={parsed.code}>
      <AlertTriangle aria-hidden="true" className="mr-1 inline size-4" />
      {parsed.message}
    </p>
  );
}

export const inputClass = `w-full rounded-md border bg-background px-3 ${TARGET}`;
