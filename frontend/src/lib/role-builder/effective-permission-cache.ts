/**
 * Session cache of a person's effective permissions (M2c, ADR-161).
 *
 * `effective_permissions` joins assignments, templates, pack items and approved overrides, so reading it on every request is
 * wasteful. This cache keeps the answer for a short time and drops it the moment the organization's override epoch moves
 * (an override was proposed, approved or ended). It is pure: the clock and the data source are injected, so it is tested
 * without a database.
 *
 * What the epoch does NOT cover, and what covers it instead:
 * - A role assignment that is granted, ended or delegated moves no epoch. The time limit (`ttlMs`, 30 seconds by default)
 *   bounds how long a revoked person can keep stale rows here. Callers that need an immediate answer after changing an
 *   assignment call `invalidateUser` or `invalidateOrg`.
 * - An override window that runs out on the clock moves no epoch. The same time limit covers it.
 * Fail closed: when the epoch cannot be read, the cache reloads; when the reload fails, the error is thrown and nothing
 * stale is served.
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface EffectivePermission {
  permissionCode: string;
  kind: string;
  roleCodes: string[];
  scopes: JsonValue;
}

export interface PermissionSource {
  /** A cheap opaque marker that moves when overrides change. */
  epoch(): Promise<string>;
  /** The full read. */
  load(): Promise<EffectivePermission[]>;
}

export interface CacheResult {
  permissions: readonly EffectivePermission[];
  fromCache: boolean;
  epoch: string;
}

interface Entry {
  permissions: readonly EffectivePermission[];
  epoch: string;
  loadedAt: number;
}

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export const DEFAULT_PERMISSION_TTL_MS = 30_000;
export const DEFAULT_PERMISSION_CACHE_ENTRIES = 500;

const keyOf = (orgId: string, userId: string) => `${orgId}:${userId}`;

export class EffectivePermissionCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<CacheResult>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PERMISSION_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_PERMISSION_CACHE_ENTRIES;
    this.now = options.now ?? Date.now;
    if (!(this.ttlMs > 0) || !(this.maxEntries > 0)) throw new Error("invalid cache options");
  }

  get size(): number {
    return this.entries.size;
  }

  async get(orgId: string, userId: string, source: PermissionSource): Promise<CacheResult> {
    if (!orgId || !userId) throw new Error("an organization and a user are required");
    const key = keyOf(orgId, userId);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const run = this.resolve(key, source).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async resolve(key: string, source: PermissionSource): Promise<CacheResult> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.loadedAt < this.ttlMs) {
      let current: string | null = null;
      try {
        current = await source.epoch();
      } catch {
        current = null;
      }
      if (current !== null && current === hit.epoch) {
        // Refresh recency for the least-recently-used rule.
        this.entries.delete(key);
        this.entries.set(key, hit);
        return { permissions: hit.permissions, fromCache: true, epoch: hit.epoch };
      }
    }
    // Read the epoch first: if an override lands between the two reads the next call sees a newer epoch and reloads.
    const epoch = await source.epoch();
    const loaded = await source.load();
    const permissions = Object.freeze(loaded.map((p) => Object.freeze({ ...p })));
    this.entries.delete(key);
    this.entries.set(key, { permissions, epoch, loadedAt: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return { permissions, fromCache: false, epoch };
  }

  invalidateUser(orgId: string, userId: string): void {
    this.entries.delete(keyOf(orgId, userId));
  }

  invalidateOrg(orgId: string): void {
    const prefix = `${orgId}:`;
    for (const key of [...this.entries.keys()])
      if (key.startsWith(prefix)) this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
