/**
 * CoreGrid Mobile — application runtime composition root.
 *
 * Owns the single instances of: the parsed environment contract, the
 * session-secure storage adapter (expo-secure-store → iOS Keychain /
 * Android Keystore, Phase 22 §O), and the two Supabase clients (typed +
 * kernel substrate). App-only module: never imported by unit-tested pure
 * layers.
 */
import * as SecureStore from "expo-secure-store";
import {
  createCoreGridSupabaseClient,
  createKernelSupabaseClient,
  type CoreGridSupabaseClient,
  type KernelSupabaseClient,
  type SessionStorageAdapter,
} from "@/api/client";
import { parseMobileEnv, type MobileEnv } from "@/api/contracts/env";

export const mobileEnv: MobileEnv = parseMobileEnv(process.env as Record<string, string | undefined>);

const secureStorage: SessionStorageAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const supabase: CoreGridSupabaseClient = createCoreGridSupabaseClient(mobileEnv, secureStorage);
export const kernelSupabase: KernelSupabaseClient = createKernelSupabaseClient(mobileEnv, secureStorage);