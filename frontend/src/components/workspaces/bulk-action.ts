export interface BulkActionReceipt {
  auditRef: string;
}

export interface AuditedBulkAction {
  id: string;
  label: string;
  execute(ids: readonly string[]): Promise<BulkActionReceipt>;
}

export async function runAuditedBulkAction(
  action: AuditedBulkAction,
  ids: readonly string[],
  confirmed: boolean,
): Promise<BulkActionReceipt | null> {
  if (!confirmed || ids.length === 0) return null;
  const receipt = await action.execute(ids);
  if (!receipt.auditRef.trim()) throw new Error("Bulk action returned no audit reference");
  return receipt;
}
