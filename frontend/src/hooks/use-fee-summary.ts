import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

export type FeeSummary = {
  billed: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
};

/** Billed / collected / outstanding totals for the current school. */
export function useFeeSummary() {
  const { profile } = useApp();
  const schoolId = profile?.school_id;

  return useQuery<FeeSummary>({
    queryKey: ["fee-summary", schoolId],
    enabled: !!schoolId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select("amount, paid_amount")
        .eq("school_id", schoolId!)
        .limit(5000);
      if (error) throw error;
      const rows = data ?? [];
      const billed = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);
      const collected = rows.reduce((a, r) => a + Number(r.paid_amount ?? 0), 0);
      return {
        billed,
        collected,
        outstanding: Math.max(0, billed - collected),
        collectionRate: billed ? Math.round((collected / billed) * 100) : 0,
      };
    },
  });
}
