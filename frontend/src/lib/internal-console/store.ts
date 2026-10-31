import type { ConsoleRuntimeContract } from "./runtime-contract";
import { CONSOLE_PATHS } from "./paths";
import type { InternalWorkspace } from "./workspaces";

export type StoreError = { message: string; code?: string } | null;

export type StoreFilter = {
  select: (cols: string) => StoreFilter;
  eq: (column: string, value: string) => StoreFilter;
  in: (column: string, values: string[]) => StoreFilter;
  order: (column: string, opts: { ascending: boolean }) => StoreFilter;
  limit: (n: number) => StoreFilter;
  maybeSingle: () => Promise<{ data: unknown; error: StoreError }>;
  single: () => Promise<{ data: unknown; error: StoreError }>;
  then: Promise<{ data: unknown; error: StoreError }>["then"];
};

export type StoreTable = {
  select: (cols: string) => StoreFilter;
  insert: (row: Record<string, unknown> | Record<string, unknown>[]) => StoreFilter;
  update: (row: Record<string, unknown>) => StoreFilter;
  delete: () => StoreFilter;
  upsert: (row: Record<string, unknown>, opts?: { onConflict: string }) => StoreFilter;
};

export type StoreClient = {
  from: (name: string) => StoreTable;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: StoreError }>;
};

/** Overlay for tables that exist in SHERIVS-030 but not yet in generated Database types. */
export function store(db: unknown): StoreClient {
  return db as StoreClient;
}

export function isMissingRelation(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    /does not exist/i.test(message) ||
    /could not find the table/i.test(message) ||
    /could not find the function/i.test(message)
  );
}

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

export type PlatformWorkspaceRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: "personal" | "shared" | "role";
  status: "active" | "archived";
  owner_id: string;
};

export type PlatformMemberRecord = {
  workspace_id: string;
  user_id: string;
  access: "owner" | "member";
};

export function mapWorkspaceRecord(
  row: PlatformWorkspaceRecord,
  access: "owner" | "member",
  team: string,
  members: readonly { userId: string; access: "owner" | "member" }[],
): InternalWorkspace {
  return {
    id: row.kind === "personal" ? "me" : row.id,
    recordId: row.id,
    name: row.name,
    description: row.description,
    type: row.kind === "role" ? "role" : row.kind,
    access,
    team,
    href: row.kind === "personal" ? CONSOLE_PATHS.myWorkspace : CONSOLE_PATHS.workspace(row.id),
    status: row.status,
    source: "database",
    slug: row.slug,
    members,
  };
}

export function mapRuntimeRecord(row: {
  id: string;
  name: string;
  description: string;
  entry_origin: string;
  entry_path: string;
  help_href: string;
  status: string;
}): ConsoleRuntimeContract {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    entryOrigin: row.entry_origin,
    entryPath: row.entry_path,
    entryUrl: `${row.entry_origin}${row.entry_path}`,
    helpHref: row.help_href,
    status: row.status === "operational_product" ? "operational_product" : "not_registered",
    permission: null,
  };
}

export function slugifyWorkspaceName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return slug.length >= 2 ? slug : "shared-workspace";
}
