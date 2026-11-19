/**
 * In-memory PostgREST double for the M22 dispatcher tests: honours eq/in/is/like/lt/limit/maybeSingle and has NO
 * update path (service_role has none on outbound_messages); writes go through the `rpc` handlers a test supplies,
 * which model the database functions proven in tests/sql/m22-comms-completion.sql and PR #351's SQL test.
 */
type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export type RpcHandler = (args: Record<string, unknown>) => {
  data: unknown;
  error: { message: string } | null;
};

export function fakeDb(tables: Tables, rpcs: Record<string, RpcHandler>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const h = rpcs[name];
      return h ? h(args) : { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let single = false;
      let cap = Infinity;
      const run = () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return {
          data: single
            ? rows[0]
              ? { ...rows[0] }
              : null
            : rows.slice(0, cap).map((r) => ({ ...r })),
          error: null,
        };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
        is: (k: string, v: null) => (filters.push((r) => (r[k] ?? null) === v), q),
        like: (k: string, p: string) => (
          filters.push(
            (r) => typeof r[k] === "string" && (r[k] as string).startsWith(p.replace(/%$/, "")),
          ),
          q
        ),
        lt: (k: string, v: string) => (
          filters.push((r) => typeof r[k] === "string" && (r[k] as string) < v),
          q
        ),
        limit: (n: number) => ((cap = n), q),
        maybeSingle: () => ((single = true), Promise.resolve(run())),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  };
}

/** Records evidence rows in memory (the DeliveryEvidenceSink port). */
export function memorySink() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    sink: { kind: "memory", record: async (r: Record<string, unknown>) => void rows.push(r) },
  };
}
