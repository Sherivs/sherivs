/**
 * Sherivs Mobile — school read models + CBT RPCs (Track E). Every call is a plain PostgREST/RPC request with the
 * user's own JWT, so the same RLS policies as the web app decide what comes back. Queries always pass an explicit
 * student_id filter: that is what lets Postgres use the (student_id, …) indexes instead of filtering a whole school.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SherivsSupabaseClient } from "./client";

// The generated web Database type predates some school tables (cbt_*, messages), so use the untyped surface here.
const db = (client: SherivsSupabaseClient): SupabaseClient => client as unknown as SupabaseClient;

export interface LinkedStudent { readonly id: string; readonly admission_number: string | null; readonly class_id: string | null; readonly school_id: string }
export interface GradeRow { readonly student_id: string; readonly subject: string; readonly total_score: number | null; readonly grade: string | null; readonly term: string | null; readonly academic_year: string | null }
export interface AttendanceRow { readonly student_id: string; readonly date: string; readonly status: string }
export interface FeeRow { readonly id: string; readonly student_id: string; readonly fee_type: string; readonly amount: number; readonly paid_amount: number | null; readonly status: string | null; readonly due_date: string | null; readonly term: string | null }
export interface MessageRow { readonly id: string; readonly subject: string | null; readonly body: string; readonly sender_id: string; readonly is_read: boolean | null; readonly created_at: string }
export interface CbtTestRow { readonly id: string; readonly title: string; readonly duration_minutes: number; readonly opens_at: string; readonly closes_at: string; readonly class_id: string }
export interface CbtQuestion { readonly id: string; readonly stem: string; readonly options: readonly (string | number)[]; readonly marks: number | null }
export interface CbtAttempt { readonly attempt_id: string; readonly deadline: string; readonly status: string; readonly answers: Record<string, number> | null; readonly client_seq: number | null; readonly questions: readonly CbtQuestion[] | null }

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

/** The student record(s) the caller is (student) or is guardian of (parent). */
export async function linkedStudents(client: SherivsSupabaseClient, userId: string): Promise<LinkedStudent[]> {
  return unwrap(await db(client).from("students").select("id,admission_number,class_id,school_id").or(`user_id.eq.${userId},parent_id.eq.${userId}`).limit(20));
}

export async function results(client: SherivsSupabaseClient, studentIds: readonly string[]): Promise<GradeRow[]> {
  if (!studentIds.length) return [];
  return unwrap(await db(client).from("grades").select("student_id,subject,total_score,grade,term,academic_year").in("student_id", [...studentIds]).eq("is_published", true).order("academic_year", { ascending: false }).limit(500));
}

export async function attendance(client: SherivsSupabaseClient, studentIds: readonly string[], days = 60): Promise<AttendanceRow[]> {
  if (!studentIds.length) return [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return unwrap(await db(client).from("attendance").select("student_id,date,status").in("student_id", [...studentIds]).gte("date", since).order("date", { ascending: false }).limit(500));
}

export async function fees(client: SherivsSupabaseClient, studentIds: readonly string[]): Promise<FeeRow[]> {
  if (!studentIds.length) return [];
  return unwrap(await db(client).from("fees").select("id,student_id,fee_type,amount,paid_amount,status,due_date,term").in("student_id", [...studentIds]).order("due_date", { ascending: false }).limit(200));
}

export async function inbox(client: SherivsSupabaseClient, userId: string): Promise<MessageRow[]> {
  return unwrap(await db(client).from("messages").select("id,subject,body,sender_id,is_read,created_at").eq("recipient_id", userId).order("created_at", { ascending: false }).limit(100));
}

export async function cbtTests(client: SherivsSupabaseClient, classIds: readonly string[]): Promise<CbtTestRow[]> {
  if (!classIds.length) return [];
  return unwrap(await db(client).from("cbt_tests").select("id,title,duration_minutes,opens_at,closes_at,class_id").in("class_id", [...classIds]).gte("closes_at", new Date().toISOString()).order("opens_at").limit(50));
}

export async function cbtStart(client: SherivsSupabaseClient, testId: string): Promise<CbtAttempt> {
  return unwrap(await db(client).rpc("cbt_start", { p_test: testId })) as CbtAttempt;
}

/** Autosave and submit share the server's monotonic client_seq guard, so a stale offline replay can never overwrite newer answers. */
export async function cbtSave(client: SherivsSupabaseClient, attemptId: string, answers: Record<string, number>, seq: number, submit: boolean): Promise<unknown> {
  return unwrap(await db(client).rpc(submit ? "cbt_submit" : "cbt_sync", { p_attempt: attemptId, p_answers: answers, p_seq: seq, p_captured_at: new Date().toISOString() }));
}

export function naira(amount: number | null | undefined): string {
  return `₦${Number(amount ?? 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}
