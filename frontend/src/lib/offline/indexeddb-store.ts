import { isNetworkError } from "./save-or-queue";

export type OfflineDomain = "timetable" | "results" | "attendance" | "messages";
export type OfflineMutationKind = "attendance" | "score";
export type OfflineMutationState = "pending" | "conflict";

export interface OfflineScope {
  tenantId: string;
  userId: string;
  role: string;
}

export interface OfflineMutation<T = unknown> {
  id: string;
  scopeKey: string;
  kind: OfflineMutationKind;
  entityId: string;
  payload: T;
  queuedAt: string;
  state: OfflineMutationState;
  conflict?: string;
}

export interface OfflineDatabase {
  readRecord<T>(id: string): Promise<{ scopeKey: string; value: T } | undefined>;
  writeRecord<T>(id: string, scopeKey: string, value: T): Promise<void>;
  readMutations(scopeKey: string): Promise<OfflineMutation[]>;
  writeMutation(mutation: OfflineMutation): Promise<void>;
  deleteMutation(id: string): Promise<void>;
  deleteScope(scopeKey: string): Promise<void>;
  clear(): Promise<void>;
}

export interface OfflineSyncResult {
  applied: number;
  conflicts: OfflineMutation[];
  remaining: number;
  error?: string;
}

export interface OfflineStore {
  read<T>(domain: OfflineDomain, key: string): Promise<T | undefined>;
  write<T>(domain: OfflineDomain, key: string, value: T): Promise<void>;
  readThrough<T>(domain: OfflineDomain, key: string, load: () => Promise<T>): Promise<{ data: T; source: "network" | "offline" }>;
  enqueue<T>(kind: OfflineMutationKind, entityId: string, payload: T): Promise<OfflineMutation<T>>;
  pending(kind?: OfflineMutationKind): Promise<OfflineMutation[]>;
  discard(id: string): Promise<void>;
  sync(
    send: (mutation: OfflineMutation) => Promise<{ outcome: "applied" | "conflict"; reason?: string }>,
    kind?: OfflineMutationKind,
  ): Promise<OfflineSyncResult>;
  clear(): Promise<void>;
}

const DB_NAME = "sherivs-offline-v1";
const DB_VERSION = 1;
const RECORDS = "records";
const OUTBOX = "outbox";
const SCOPES = "scopeKey";

export function offlineScopeKey(scope: OfflineScope): string {
  if (!scope.tenantId.trim() || !scope.userId.trim() || !scope.role.trim()) {
    throw new Error("Offline data requires tenant, user, and role scope");
  }
  return JSON.stringify([scope.tenantId, scope.userId, scope.role]);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction aborted"));
  });
}

function createBrowserDatabase(): OfflineDatabase {
  let opening: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable"));
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(RECORDS)) {
            const records = db.createObjectStore(RECORDS, { keyPath: "id" });
            records.createIndex(SCOPES, "scopeKey", { unique: false });
          }
          if (!db.objectStoreNames.contains(OUTBOX)) {
            const outbox = db.createObjectStore(OUTBOX, { keyPath: "id" });
            outbox.createIndex(SCOPES, "scopeKey", { unique: false });
          }
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error ?? new Error("Could not open offline storage"));
        request.onblocked = () => reject(new Error("Offline storage upgrade is blocked"));
      }).catch((error: unknown) => {
        opening = undefined;
        throw error;
      });
    }
    return opening;
  };

  return {
    async readRecord<T>(id: string): Promise<{ scopeKey: string; value: T } | undefined> {
      const db = await open();
      const tx = db.transaction(RECORDS, "readonly");
      const result = await requestResult(tx.objectStore(RECORDS).get(id));
      await transactionDone(tx);
      return result as { scopeKey: string; value: T } | undefined;
    },
    async writeRecord<T>(id: string, scopeKey: string, value: T): Promise<void> {
      const db = await open();
      const tx = db.transaction(RECORDS, "readwrite");
      tx.objectStore(RECORDS).put({ id, scopeKey, value });
      await transactionDone(tx);
    },
    async readMutations(scopeKey: string): Promise<OfflineMutation[]> {
      const db = await open();
      const tx = db.transaction(OUTBOX, "readonly");
      const result = await requestResult(tx.objectStore(OUTBOX).index(SCOPES).getAll(scopeKey));
      await transactionDone(tx);
      return result as OfflineMutation[];
    },
    async writeMutation(mutation: OfflineMutation): Promise<void> {
      const db = await open();
      const tx = db.transaction(OUTBOX, "readwrite");
      tx.objectStore(OUTBOX).put(mutation);
      await transactionDone(tx);
    },
    async deleteMutation(id: string): Promise<void> {
      const db = await open();
      const tx = db.transaction(OUTBOX, "readwrite");
      tx.objectStore(OUTBOX).delete(id);
      await transactionDone(tx);
    },
    async deleteScope(scopeKey: string): Promise<void> {
      const db = await open();
      const tx = db.transaction([RECORDS, OUTBOX], "readwrite");
      for (const name of [RECORDS, OUTBOX]) {
        const store = tx.objectStore(name);
        const keys = await requestResult(store.index(SCOPES).getAllKeys(scopeKey));
        for (const key of keys) store.delete(key);
      }
      await transactionDone(tx);
    },
    async clear(): Promise<void> {
      const db = await open();
      const tx = db.transaction([RECORDS, OUTBOX], "readwrite");
      tx.objectStore(RECORDS).clear();
      tx.objectStore(OUTBOX).clear();
      await transactionDone(tx);
    },
  };
}

export function createOfflineStore(
  scope: OfflineScope,
  options: { database?: OfflineDatabase; now?: () => Date; newId?: () => string } = {},
): OfflineStore {
  const scopeKey = offlineScopeKey(scope);
  const database = options.database ?? createBrowserDatabase();
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const recordId = (domain: OfflineDomain, key: string) => `${scopeKey}\u001f${domain}\u001f${key}`;

  return {
    async read<T>(domain, key) {
      const record = await database.readRecord<{ scopeKey: string; value: T }>(recordId(domain, key));
      return record?.scopeKey === scopeKey ? record.value : undefined;
    },
    async write<T>(domain, key, value) {
      await database.writeRecord(recordId(domain, key), scopeKey, value);
    },
    async readThrough<T>(domain, key, load) {
      let data: T;
      try {
        data = await load();
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        const data = await this.read<T>(domain, key);
        if (data === undefined) throw error;
        return { data, source: "offline" };
      }
      try {
        await database.writeRecord(recordId(domain, key), scopeKey, data);
      } catch {
        /* A successful authorized read stays usable when local storage is unavailable. */
      }
      return { data, source: "network" };
    },
    async enqueue<T>(kind, entityId, payload) {
      if (!entityId.trim()) throw new Error("Offline mutation requires an entity id");
      const mutation: OfflineMutation<T> = {
        id: newId(),
        scopeKey,
        kind,
        entityId,
        payload,
        queuedAt: now().toISOString(),
        state: "pending",
      };
      await database.writeMutation(mutation);
      return mutation;
    },
    async pending(kind) {
      const mutations = await database.readMutations(scopeKey);
      return mutations.filter((mutation) => mutation.state === "pending" && (!kind || mutation.kind === kind));
    },
    discard: (id) => database.deleteMutation(id),
    async sync(send, kind) {
      const queue = await database.readMutations(scopeKey);
      let applied = 0;
      let error: string | undefined;
      const conflicts: OfflineMutation[] = [];
      for (const mutation of queue) {
        if (mutation.state !== "pending" || (kind && mutation.kind !== kind)) continue;
        try {
          const result = await send(mutation);
          if (result.outcome === "conflict") {
            const conflict = { ...mutation, state: "conflict" as const, conflict: result.reason ?? "manual_review_required" };
            await database.writeMutation(conflict);
            conflicts.push(conflict);
          } else {
            await database.deleteMutation(mutation.id);
            applied += 1;
          }
        } catch (syncError) {
          error = syncError instanceof Error ? syncError.message : "Offline sync failed";
          break;
        }
      }
      return {
        applied,
        conflicts,
        remaining: (await database.readMutations(scopeKey)).filter((mutation) => mutation.state === "pending").length,
        ...(error ? { error } : {}),
      };
    },
    clear: () => database.deleteScope(scopeKey),
  };
}

export function clearOfflineData(scope?: OfflineScope): Promise<void> {
  const database = createBrowserDatabase();
  return scope ? database.deleteScope(offlineScopeKey(scope)) : database.clear();
}

export function clearLegacyOfflineStorage(
  storage?: Pick<Storage, "length" | "key" | "removeItem">,
): void {
  try {
    storage ??= typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return;
  }
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith("sherivs.offline.") || key?.startsWith("sherivs.cbt.")) keys.push(key);
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      return;
    }
  }
}
