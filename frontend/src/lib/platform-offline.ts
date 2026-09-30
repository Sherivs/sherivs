// ─── CoreGrid Phase 22 — Mobile Platform ─────────────────────────────
// platform-offline.ts — Offline-first capability, sync engine,
//                       cache management, low-bandwidth mode
// ──────────────────────────────────────────────────────────────────────
// Sections: M, N, BR, BS, BT, BU, BV, BG

// ─── M. Data Synchronization ─────────────────────────────────────────
export type SyncDirection = "upload" | "download" | "bidirectional";

export interface SyncConfig {
  readonly enabled: boolean;
  readonly intervalSeconds: number;
  readonly onlyOnWifi: boolean;
  readonly onlyWhileCharging: boolean;
  readonly maxBatchSize: number;
  readonly conflictResolution: "server_wins" | "client_wins" | "last_write_wins" | "manual";
  readonly backgroundSync: boolean;
  readonly retryOnFailure: boolean;
}

export interface SyncOperation {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: "create" | "update" | "delete";
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly retryCount: number;
  readonly status: "pending" | "in_progress" | "completed" | "failed" | "conflicted";
  readonly error: string | null;
}

// ─── N. Offline-First Capability ──────────────────────────────────────
export interface OfflineState {
  readonly online: boolean;
  readonly syncQueueSize: number;
  readonly lastSyncTimestamp: string | null;
  readonly pendingUploads: number;
  readonly pendingDownloads: number;
  readonly cachedEntities: Record<string, number>;
}

export interface OfflineCapableModule {
  readonly moduleId: string;
  readonly cacheableEntities: string[];
  readonly maxStalenessMs: number;
  readonly criticalData: boolean;
  readonly optimisticUI: boolean;
  readonly syncPriority: "high" | "medium" | "low";
}

export interface OfflineCacheEntry<T = unknown> {
  readonly id: string;
  readonly data: T;
  readonly cachedAt: string;
  readonly expiresAt: string;
  readonly version: number;
  readonly stale: boolean;
}

// ─── BU–BV. Client Cache & Cache Safety ──────────────────────────────
export interface CacheConfig {
  readonly maxSizeBytes: number;
  readonly defaultTtlMs: number;
  readonly enablePersistence: boolean;
  readonly encryptionEnabled: boolean;
  readonly autoEviction: boolean;
  readonly evictionPolicy: "lru" | "lfu" | "fifo" | "ttl";
}

export interface CacheEvictionResult {
  readonly evictedCount: number;
  readonly freedBytes: number;
  readonly totalBytes: number;
  readonly evictedKeys: string[];
}

// ─── BR. Low-Bandwidth Mode ──────────────────────────────────────────
export interface LowBandwidthConfig {
  readonly enabled: boolean;
  readonly maxKbps: number;
  readonly imageQuality: "original" | "high" | "medium" | "low" | "thumbnail";
  readonly disableAnimations: boolean;
  readonly disablePreload: boolean;
  readonly batchRequests: boolean;
  readonly compressPayloads: boolean;
  readonly maxPayloadBytes: number;
}

// ─── BS. Power Efficiency ────────────────────────────────────────────
export interface PowerEfficiencyConfig {
  readonly reduceAnimations: boolean;
  readonly throttleBackgroundSync: boolean;
  readonly disableLocationOnBattery: boolean;
  readonly reducePollingInterval: boolean;
  readonly pausePushOnLowBattery: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function createSyncOperation(params: {
  entityType: string;
  entityId: string;
  operation: SyncOperation["operation"];
  payload: Record<string, unknown>;
}): SyncOperation {
  if (!params.entityType || !params.entityId) {
    throw new Error("Sync operation requires entity type and id");
  }
  return {
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entityType: params.entityType,
    entityId: params.entityId,
    operation: params.operation,
    payload: params.payload,
    timestamp: new Date().toISOString(),
    retryCount: 0,
    status: "pending" as const,
    error: null,
  };
}

export function createCacheEntry<T>(params: {
  id: string;
  data: T;
  ttlMs: number;
}): OfflineCacheEntry<T> {
  const now = new Date();
  return {
    id: params.id,
    data: params.data,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + params.ttlMs).toISOString(),
    version: 1,
    stale: false,
  };
}

export function isCacheExpired(entry: OfflineCacheEntry): boolean {
  return new Date(entry.expiresAt) < new Date();
}

export function markAsStale<T>(entry: OfflineCacheEntry<T>): OfflineCacheEntry<T> {
  return { ...entry, stale: true };
}

export function computeEviction(
  currentBytes: number,
  maxBytes: number,
  policy: CacheConfig["evictionPolicy"],
): { needsEviction: boolean; bytesToFree: number } {
  if (currentBytes <= maxBytes) return { needsEviction: false, bytesToFree: 0 };
  return { needsEviction: true, bytesToFree: currentBytes - maxBytes };
}

export function shouldUseLowBandwidth(network: { type: string; strength: number | null }): boolean {
  return (network.type === "cellular" && (network.strength ?? 0) < 3) || network.type === "none";
}

export function shouldThrottleSync(powerMode: boolean, batteryLevel: number | null): boolean {
  return powerMode || (batteryLevel !== null && batteryLevel < 0.2);
}
