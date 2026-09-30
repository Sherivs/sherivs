// ─── CoreGrid Phase 23 — Web Platform ───────────────────────────────
// web-storage.ts — Browser storage, IndexedDB, service worker, PWA,
//                  offline web, sync, conflict management, files
// ──────────────────────────────────────────────────────────────────────

// ─── X–Z. Browser Storage, IndexedDB & Service Worker ──────────────
export type WebStorageType =
  "local_storage" | "session_storage" | "indexeddb" | "cookies" | "cache_api" | "opfs";

export interface WebStorageConfig {
  readonly storageType: WebStorageType;
  readonly maxSizeBytes: number;
  readonly encrypted: boolean;
  readonly persistent: boolean;
  readonly crossTabSync: boolean;
}

export interface IndexedDBConfig {
  readonly dbName: string;
  readonly version: number;
  readonly objectStores: { name: string; keyPath: string; indexes: string[] }[];
  readonly migrationPolicy: "auto" | "manual" | "blocking";
}

export interface ServiceWorkerConfig {
  readonly scope: string;
  readonly cacheName: string;
  readonly precacheUrls: string[];
  readonly runtimeCachePatterns: {
    pattern: string;
    strategy: "cache_first" | "network_first" | "stale_while_revalidate" | "network_only";
  }[];
  readonly backgroundSync: boolean;
  readonly pushManager: boolean;
  readonly skipWaiting: boolean;
  readonly clientsClaim: boolean;
}

// ─── AA–AB. PWA & Offline Web ────────────────────────────────────────
export interface PWAWebManifest {
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly startUrl: string;
  readonly display: "fullscreen" | "standalone" | "minimal_ui" | "browser";
  readonly orientation: "any" | "natural" | "portrait" | "landscape";
  readonly icons: { src: string; sizes: string; type: string }[];
  readonly themeColor: string;
  readonly backgroundColor: string;
  readonly categories: string[];
  readonly iarcRatingId: string | null;
}

export interface OfflineWebConfig {
  readonly enabled: boolean;
  readonly offlinePage: string;
  readonly fallbackNetworkTimeout: number;
  readonly syncOnReconnect: boolean;
  readonly queueUserActions: boolean;
  readonly maxOfflineQueueSize: number;
}

// ─── AC–AD. Offline Sync & Conflict Management ──────────────────────
export interface OfflineSyncQueue {
  readonly id: string;
  readonly actions: OfflineSyncAction[];
  readonly createdAt: string;
  readonly status: "pending" | "syncing" | "completed" | "failed";
}

export interface OfflineSyncAction {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: "create" | "update" | "delete";
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly retryCount: number;
}

export interface ConflictResolution {
  readonly entityId: string;
  readonly localVersion: number;
  readonly serverVersion: number;
  readonly localData: Record<string, unknown>;
  readonly serverData: Record<string, unknown>;
  readonly resolution: "local_wins" | "server_wins" | "merge" | "manual";
  readonly resolvedAt: string | null;
}

// ─── AE–AJ. Networking, Streaming, Files ─────────────────────────────
export interface WebNetworkInfo {
  readonly online: boolean;
  readonly effectiveType: "slow-2g" | "2g" | "3g" | "4g" | undefined;
  readonly downlink: number | undefined;
  readonly rtt: number | undefined;
  readonly saveData: boolean;
}

export interface FileUploadConfig {
  readonly maxFileSize: number;
  readonly allowedMimeTypes: string[];
  readonly chunkSize: number;
  readonly parallelUploads: number;
  readonly resumeSupported: boolean;
  readonly clientSideEncryption: boolean;
}

// ─── AL–AM. Browser Permissions & Notifications ─────────────────────
export type WebPermissionName =
  | "notifications"
  | "geolocation"
  | "camera"
  | "microphone"
  | "clipboard_read"
  | "clipboard_write"
  | "storage"
  | "persistent_storage"
  | "background_sync"
  | "push"
  | "file_system"
  | "window_management";

export interface WebPermissionStatus {
  readonly permission: WebPermissionName;
  readonly status: "granted" | "denied" | "prompt" | "not_supported";
}
// ─── Functions ────────────────────────────────────────────────────────
export function createServiceWorkerConfig(params: {
  scope: string;
  cacheName: string;
  precacheUrls: string[];
  runtimeCachePatterns?: ServiceWorkerConfig["runtimeCachePatterns"];
  backgroundSync?: boolean;
  pushManager?: boolean;
}): ServiceWorkerConfig {
  if (!params.scope || !params.cacheName) throw new Error("SW requires scope and cache name");
  return {
    scope: params.scope,
    cacheName: params.cacheName,
    precacheUrls: params.precacheUrls,
    runtimeCachePatterns: params.runtimeCachePatterns ?? [],
    backgroundSync: params.backgroundSync ?? false,
    pushManager: params.pushManager ?? true,
    skipWaiting: true,
    clientsClaim: true,
  };
}

export function createPWAWebManifest(params: {
  name: string;
  shortName: string;
  description: string;
  startUrl: string;
  icons: { src: string; sizes: string; type: string }[];
  themeColor: string;
  backgroundColor: string;
  display?: PWAWebManifest["display"];
}): PWAWebManifest {
  if (!params.name || !params.shortName) throw new Error("Manifest requires name and short name");
  return {
    name: params.name,
    shortName: params.shortName,
    description: params.description,
    startUrl: params.startUrl,
    display: params.display ?? "standalone",
    orientation: "any",
    icons: params.icons,
    themeColor: params.themeColor,
    backgroundColor: params.backgroundColor,
    categories: [],
    iarcRatingId: null,
  };
}

export function queueOfflineAction(params: {
  entityType: string;
  entityId: string;
  operation: OfflineSyncAction["operation"];
  payload: Record<string, unknown>;
}): OfflineSyncAction {
  if (!params.entityType || !params.entityId) throw new Error("Action requires entity type and id");
  return {
    id: `off-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entityType: params.entityType,
    entityId: params.entityId,
    operation: params.operation,
    payload: params.payload,
    timestamp: new Date().toISOString(),
    retryCount: 0,
  };
}

export function resolveConflict(params: {
  entityId: string;
  localVersion: number;
  serverVersion: number;
  localData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  resolution: ConflictResolution["resolution"];
}): ConflictResolution {
  return { ...params, resolvedAt: new Date().toISOString() };
}

export function checkFileUpload(
  file: { size: number; type: string },
  config: FileUploadConfig,
): { valid: boolean; reason: string | null } {
  if (file.size > config.maxFileSize)
    return { valid: false, reason: `File exceeds max size of ${config.maxFileSize} bytes` };
  if (config.allowedMimeTypes.length > 0 && !config.allowedMimeTypes.includes(file.type))
    return { valid: false, reason: `File type ${file.type} not allowed` };
  return { valid: true, reason: null };
}

export function checkWebPermission(name: WebPermissionName, status: string): WebPermissionStatus {
  const valid =
    status === "granted" ||
    status === "denied" ||
    status === "prompt" ||
    status === "not_supported";
  return {
    permission: name,
    status: valid ? (status as WebPermissionStatus["status"]) : "not_supported",
  };
}
