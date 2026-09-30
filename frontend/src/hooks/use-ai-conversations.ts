/**
 * Database-backed AI chat persistence.
 * Each portal's assistant upserts its conversation into `ai_conversations`
 * (school-scoped, user-owned) and writes one row per exchange into
 * `ai_interaction_log` for analytics.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StoredAIMessage = { role: "user" | "assistant"; content: string; timestamp: number };

export type ConversationSummary = {
  id: string;
  title: string | null;
  message_count: number | null;
  last_message_at: string | null;
  messages: StoredAIMessage[];
};

function deriveTitle(messages: StoredAIMessage[]) {
  const first = messages.find((m) => m.role === "user")?.content?.trim();
  if (!first) return "New conversation";
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

/** Save + log helpers for one portal's assistant. */
export function useAIConversationStore(opts: {
  userId: string | null;
  schoolId: string | null;
  portal: string;
}) {
  const { userId, schoolId, portal } = opts;
  const qc = useQueryClient();

  const saveConversation = useCallback(
    async (conversationId: string, messages: StoredAIMessage[]) => {
      if (!userId || !schoolId || !conversationId || messages.length === 0) return;
      const { error } = await supabase.from("ai_conversations").upsert(
        {
          id: conversationId,
          school_id: schoolId,
          user_id: userId,
          portal,
          title: deriveTitle(messages),
          messages: messages as unknown as never,
          message_count: messages.length,
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) throw error;
      void qc.invalidateQueries({ queryKey: ["ai-conversations", schoolId, userId, portal] });
    },
    [portal, qc, schoolId, userId],
  );

  const logInteraction = useCallback(
    async (entry: { prompt: string; response: string; latencyMs: number; success: boolean }) => {
      if (!userId || !schoolId) return;
      await supabase.from("ai_interaction_log").insert({
        school_id: schoolId,
        user_id: userId,
        portal,
        prompt_text: entry.prompt,
        response_text: entry.response,
        model_used: "vibeora-school-data",
        latency_ms: Math.round(entry.latencyMs),
        success: entry.success,
      });
    },
    [portal, schoolId, userId],
  );

  return { saveConversation, logInteraction };
}

/** Past conversations for the signed-in user in one portal. */
export function useAIConversationHistory(opts: {
  userId: string | null;
  schoolId: string | null;
  portal: string;
  limit?: number;
}) {
  const { userId, schoolId, portal, limit = 20 } = opts;
  return useQuery({
    queryKey: ["ai-conversations", schoolId, userId, portal, limit],
    enabled: !!userId && !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_conversations")
        .select("id, title, message_count, last_message_at, messages")
        .eq("school_id", schoolId!)
        .eq("user_id", userId!)
        .eq("portal", portal)
        .order("last_message_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        messages: Array.isArray(row.messages) ? (row.messages as unknown as StoredAIMessage[]) : [],
      })) as ConversationSummary[];
    },
  });
}

export async function deleteAIConversation(id: string) {
  const { error } = await supabase.from("ai_conversations").delete().eq("id", id);
  if (error) throw error;
}
