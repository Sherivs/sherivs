export interface AuditGateResult {
  ok: boolean;
  blocking: string[];
  excepted: string[];
  problems: string[];
}
export function advisoryId(via: unknown): string | null;
export function validateExceptions(config: unknown): { list: unknown[]; problems: string[] };
export function evaluateAudit(report: unknown, config: unknown, now?: Date): AuditGateResult;
