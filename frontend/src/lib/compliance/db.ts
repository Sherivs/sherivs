import type { WriteAuditClient } from "@/lib/server/write-audit";

/**
 * Structural postgrest-compatible client used by the compliance server paths.
 * Deliberately loose so tests can inject an in-memory fake; callers pass the
 * service-role client only after their own authorization gate.
 */

export type ComplianceQueryResult = {
  data: unknown;
  error: DbError;
};

export type ComplianceQuery = PromiseLike<ComplianceQueryResult> & {
  select(columns?: string): ComplianceQuery;
  insert(payload: Record<string, unknown> | Record<string, unknown>[]): ComplianceQuery;
  update(payload: Record<string, unknown>): ComplianceQuery;
  delete(): ComplianceQuery;
  eq(column: string, value: unknown): ComplianceQuery;
  in(column: string, values: readonly unknown[]): ComplianceQuery;
  maybeSingle(): PromiseLike<ComplianceQueryResult>;
  single(): PromiseLike<ComplianceQueryResult>;
};

export type ComplianceDb = {
  from(table: string): ComplianceQuery;
  rpc?(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
} & WriteAuditClient;

export type DbError = { message: string } | null | undefined;

export type ActorRow = {
  id: string;
  school_id: string | null;
  role: string | null;
  is_active: boolean | null;
};

export function isSchoolAdminOf(actor: ActorRow | null, schoolId: string): boolean {
  return (
    !!actor &&
    actor.is_active !== false &&
    (actor.role === "admin" || actor.role === "principal") &&
    actor.school_id === schoolId
  );
}

export async function loadActor(db: ComplianceDb, id: string): Promise<ActorRow | null> {
  const res = await db
    .from("users")
    .select("id, school_id, role, is_active")
    .eq("id", id)
    .maybeSingle();
  if (res?.error) throw new Error(`Failed to load actor: ${res.error.message}`);
  return (res?.data as ActorRow | null) ?? null;
}

export function throwIfError(res: { error?: DbError } | null | undefined, what: string): void {
  if (res?.error) throw new Error(`${what}: ${res.error.message}`);
}
