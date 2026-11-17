/**
 * Sherivs Entity Engine — Role Pack registry operations (ENGINE-01, ADR-078).
 *
 * Server-only (service role). Publishing validates the full pack first and the
 * database guard re-checks the hard invariants, so an invalid pack can reach
 * neither the table nor any twin. Publishing automatically binds every context
 * that was waiting for that role (database trigger); `reconcileTwins` repairs
 * any gap left by a failed provisioning trigger.
 */
import { parseRolePack, type RolePack } from "./role-pack";

export interface RegistryClient {
  from(table: "cg_role_pack"): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
  rpc(name: "cg_twin_reconcile"): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type PublishResult =
  | { readonly ok: true; readonly pack: RolePack }
  | {
      readonly ok: false;
      readonly stage: "validation" | "database";
      readonly findings: readonly string[];
    };

export async function publishRolePack(
  client: RegistryClient,
  candidate: unknown,
): Promise<PublishResult> {
  const parsed = parseRolePack(candidate);
  if (!parsed.ok) return { ok: false, stage: "validation", findings: parsed.findings };
  const pack = parsed.pack;
  const { error } = await client.from("cg_role_pack").insert({
    code: pack.code,
    version: pack.version,
    kind: pack.kind,
    applies_to: pack.appliesTo,
    status: "published",
    definition: pack,
  });
  if (error) return { ok: false, stage: "database", findings: [error.message] };
  return { ok: true, pack };
}

export interface ReconcileSummary {
  readonly contextsEnsured: number;
  readonly contextsBound: number;
}

export async function reconcileTwins(
  client: Pick<RegistryClient, "rpc">,
): Promise<ReconcileSummary> {
  const { data, error } = await client.rpc("cg_twin_reconcile");
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as { contexts_ensured?: unknown; contexts_bound?: unknown };
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { contextsEnsured: n(row.contexts_ensured), contextsBound: n(row.contexts_bound) };
}
