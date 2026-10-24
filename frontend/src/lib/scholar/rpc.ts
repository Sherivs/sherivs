/** Loose-typed Supabase access for Scholar wave RPCs (types regenerate after prod apply). */
import { supabase } from "@/integrations/supabase/client";
type R = { data: unknown; error: { message: string } | null };
type Q = PromiseLike<R> & { eq: (k: string, v: unknown) => Q; order: (c: string, o?: { ascending?: boolean }) => Q; limit: (n: number) => Q };
type Loose = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<R>; from: (t: string) => { select: (c: string) => Q } };
export const sdb = supabase as unknown as Loose;
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sdb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function rows<T = Record<string, unknown>>(q: PromiseLike<R>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
export const naira = (v: unknown) => "₦" + Number(v ?? 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });
