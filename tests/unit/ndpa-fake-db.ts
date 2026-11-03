/** Minimal in-memory postgrest-like fake for NDPA unit tests. */
export type Row = Record<string, unknown>;

export function createFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const log: { op: string; table: string; filters: [string, unknown][]; patch?: Row }[] = [];
  let seq = 0;

  function from(table: string) {
    tables[table] ??= [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let patch: Row | Row[] | undefined;
    const filters: [string, unknown][] = [];
    let inFilter: [string, unknown[]] | null = null;

    const match = (r: Row) =>
      filters.every(([c, v]) => r[c] === v) && (!inFilter || inFilter[1].includes(r[inFilter[0]]));

    function exec(single: boolean) {
      let data: Row[] = [];
      if (op === "insert") {
        const rows = (Array.isArray(patch) ? patch : [patch as Row]).map((r) => ({
          id: `gen-${++seq}`,
          ...r,
        }));
        tables[table].push(...rows);
        log.push({ op, table, filters: [], patch: rows[0] });
        data = rows;
      } else if (op === "update") {
        data = tables[table].filter(match);
        for (const r of data) Object.assign(r, patch as Row);
        log.push({ op, table, filters: [...filters], patch: patch as Row });
      } else if (op === "delete") {
        data = tables[table].filter(match);
        tables[table] = tables[table].filter((r) => !match(r));
        log.push({ op, table, filters: [...filters] });
      } else {
        data = tables[table].filter(match).map((r) => ({ ...r }));
      }
      if (single) return { data: data[0] ?? null, error: null };
      return { data, error: null };
    }

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row | Row[]) => ((op = "insert"), (patch = p), b),
      update: (p: Row) => ((op = "update"), (patch = p), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      in: (c: string, v: unknown[]) => ((inFilter = [c, v]), b),
      maybeSingle: async () => exec(true),
      single: async () => exec(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(exec(false)).then(res, rej),
    };
    return b;
  }
  async function rpc(name: string, args: Row = {}) {
    if (name !== "consent_set_for_actor") return { data: null, error: { message: "Unknown RPC" } };
    const student = tables.students?.find((row) => row.id === args.p_student_id);
    if (!student) return { data: null, error: { message: "Student not found" } };
    const records = (tables.consent_records ??= []);
    const now = new Date().toISOString();
    let record = records.find(
      (row) =>
        row.school_id === student.school_id &&
        row.student_id === args.p_student_id &&
        row.purpose === args.p_purpose,
    );
    if (!record) {
      record = {
        id: `gen-${++seq}`,
        school_id: student.school_id,
        student_id: args.p_student_id,
        purpose: args.p_purpose,
      };
      records.push(record);
    }
    const granted = args.p_grant === true;
    Object.assign(record, {
      status: granted ? "granted" : "withdrawn",
      policy_version: "2026-10-v1",
      capture_method: args.p_method,
      captured_by: args.p_actor_id,
      guardian_user_id:
        student.user_id === args.p_granted_by
          ? null
          : (args.p_granted_by ?? record.guardian_user_id ?? null),
      notes: args.p_note ?? null,
      lawful_basis: args.p_lawful_basis ?? record.lawful_basis ?? "consent",
      granted_by: granted ? args.p_granted_by : (record.granted_by ?? null),
      granted_at: granted ? now : (record.granted_at ?? null),
      withdrawn_at: granted ? null : now,
      updated_at: now,
    });
    (tables.consent_events ??= []).push({
      id: `gen-${++seq}`,
      school_id: student.school_id,
      consent_id: record.id,
      student_id: args.p_student_id,
      purpose: args.p_purpose,
      action: granted ? "grant" : "withdraw",
      policy_version: "2026-10-v1",
      actor_id: args.p_actor_id,
      granted_by: granted ? args.p_granted_by : (record.granted_by ?? null),
      lawful_basis: record.lawful_basis,
      capture_method: args.p_method,
      at: now,
    });
    (tables.audit_logs ??= []).push({
      school_id: student.school_id,
      user_id: args.p_actor_id,
      action: `consent.${granted ? "grant" : "withdraw"}`,
    });
    return {
      data: { consent_id: record.id, status: granted ? "granted" : "withdrawn" },
      error: null,
    };
  }
  return { from, rpc, tables, log } as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(t: string): any;
    rpc(name: string, args?: Row): Promise<{ data: unknown; error: { message: string } | null }>;
    tables: Record<string, Row[]>;
    log: { op: string; table: string; filters: [string, unknown][]; patch?: Row }[];
  };
}
