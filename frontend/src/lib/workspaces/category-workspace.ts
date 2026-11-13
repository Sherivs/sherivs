import { formatWidgetMetric } from "@/lib/shell/metrics";
import type { CardData } from "@/lib/sherivs-ws/live";
import type {
  WorkspaceManifest,
  WorkspaceManifestItem,
} from "@/components/workspaces/_contract-shim";

/**
 * Category workspaces (M009 Stage B-2 onwards).
 *
 * A category workspace is a presentation of items the caller's manifest ALREADY
 * permits. It never widens access: every card and action comes from the
 * manifest (which the database computed from assignments, responsibilities and
 * verified authority links), and a spec can only narrow further.
 */

export interface CategoryWorkspaceSpec {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Families (workspace_family_layouts) whose holders may see this section. */
  readonly families: readonly string[];
  /** Widget keys shown as queues, in display order. */
  readonly queueKeys: readonly string[];
  /** Action keys shown as daily actions, in display order. */
  readonly actionKeys: readonly string[];
  /** Item key -> permission that must be among the item's granting permissions. */
  readonly restricted?: Readonly<Record<string, string>>;
  /**
   * Separation of duties, defence in depth. If one manifest holds BOTH keys of a
   * pair, neither is shown (fail closed). The database remains the enforcer.
   */
  readonly exclusivePairs?: readonly (readonly [string, string])[];
  /** Aggregate-only: drop identifiable payload (lists, notes) and forbid keys. */
  readonly aggregateOnly?: boolean;
  readonly forbiddenKeys?: readonly string[];
  /** Capabilities the category names but which have no data source yet. */
  readonly notConfigured?: readonly { readonly label: string; readonly reason: string }[];
}

export interface CategoryQueueCard {
  key: string;
  label: string;
  value: string;
  source: string;
  href: string;
}

export interface CategoryDailyAction {
  key: string;
  label: string;
  href: string;
}

export interface CategoryWorkspaceView {
  id: string;
  title: string;
  summary: string;
  queues: CategoryQueueCard[];
  actions: CategoryDailyAction[];
  notConfigured: { label: string; reason: string }[];
}

function holdsFamily(
  manifest: Pick<WorkspaceManifest, "families"> | null,
  spec: CategoryWorkspaceSpec,
): boolean {
  return Boolean(manifest?.families.some((family) => spec.families.includes(family)));
}

function conflictedKeys(
  spec: CategoryWorkspaceSpec,
  manifest: WorkspaceManifest,
): ReadonlySet<string> {
  const present = new Set(
    [...manifest.widgets, ...manifest.actions, ...manifest.nav, ...manifest.inbox].map(
      (item) => item.key,
    ),
  );
  const blocked = new Set<string>();
  for (const [left, right] of spec.exclusivePairs ?? []) {
    if (present.has(left) && present.has(right)) {
      blocked.add(left);
      blocked.add(right);
    }
  }
  return blocked;
}

function itemAllowed(
  spec: CategoryWorkspaceSpec,
  item: WorkspaceManifestItem,
  blocked: ReadonlySet<string>,
): boolean {
  if (blocked.has(item.key)) return false;
  if (spec.forbiddenKeys?.includes(item.key)) return false;
  const required = spec.restricted?.[item.key];
  return required === undefined || item.via.includes(required);
}

function queueValue(
  spec: CategoryWorkspaceSpec,
  data: CardData | undefined,
  loading: boolean,
  failed: boolean,
): string {
  if (loading) return "Loading…";
  if (failed) return "Unavailable";
  if (!data || data.unavailable || data.metric == null) return "Not configured";
  // Aggregate-only specs show the metric and nothing else from the payload.
  return formatWidgetMetric(spec.aggregateOnly ? { metric: data.metric, money: data.money } : data)
    .text;
}

export function buildCategoryWorkspace(
  spec: CategoryWorkspaceSpec,
  manifest: WorkspaceManifest | null,
  cards: Readonly<Record<string, CardData>>,
  loading = false,
  failed = false,
): CategoryWorkspaceView | null {
  if (!manifest || !holdsFamily(manifest, spec)) return null;

  const blocked = conflictedKeys(spec, manifest);
  const widgetsByKey = new Map(manifest.widgets.map((item) => [item.key, item]));
  const queues: CategoryQueueCard[] = [];
  for (const key of spec.queueKeys) {
    const item = widgetsByKey.get(key);
    if (!item || !itemAllowed(spec, item, blocked)) continue;
    const value = queueValue(spec, cards[key], loading, failed);
    queues.push({
      key,
      label: item.label,
      value,
      source:
        value === "Not configured" ? "No widget data returned" : "Authorized workspace widget",
      href: item.to,
    });
  }

  const actionsByKey = new Map(manifest.actions.map((item) => [item.key, item]));
  const actions: CategoryDailyAction[] = [];
  for (const key of spec.actionKeys) {
    const item = actionsByKey.get(key);
    if (!item || !itemAllowed(spec, item, blocked)) continue;
    actions.push({ key, label: item.label, href: item.to });
  }

  // A category with nothing permitted shows nothing: no empty shells, no hints
  // about capabilities the caller does not hold.
  if (queues.length === 0 && actions.length === 0) return null;
  return {
    id: spec.id,
    title: spec.title,
    summary: spec.summary,
    queues,
    actions,
    notConfigured: [...(spec.notConfigured ?? [])],
  };
}
