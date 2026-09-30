/**
 * Searchable student picker. Stores the student UUID, displays
 * "Full name · admission number".
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type StudentRow = {
  id: string;
  admission_number: string | null;
  user_id: string | null;
  full_name: string | null;
};

export function StudentSelect({
  value,
  onChange,
  placeholder = "Select a student",
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const { school } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery<StudentRow[]>({
    queryKey: ["students-picker", school?.id],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data: students, error } = await supabase
        .from("students")
        .select("id, admission_number, user_id")
        .eq("school_id", school!.id)
        .eq("is_active", true)
        .limit(500);
      if (error) throw new Error(error.message);
      const userIds = (students ?? []).map((s) => s.user_id).filter(Boolean) as string[];
      const nameById = new Map<string, string>();
      if (userIds.length) {
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", userIds);
        (users ?? []).forEach((u) => nameById.set(u.id as string, (u.full_name as string) ?? ""));
      }
      return (students ?? []).map((s) => ({
        id: s.id as string,
        admission_number: (s.admission_number as string) ?? null,
        user_id: (s.user_id as string) ?? null,
        full_name: s.user_id ? (nameById.get(s.user_id as string) ?? null) : null,
      }));
    },
  });

  const selected = useMemo(() => (data ?? []).find((s) => s.id === value) ?? null, [data, value]);

  const filtered = useMemo(() => {
    const list = data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (s) =>
        (s.full_name ?? "").toLowerCase().includes(needle) ||
        (s.admission_number ?? "").toLowerCase().includes(needle),
    );
  }, [data, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="truncate">
              {selected.full_name ?? "Unnamed"}
              <span className="text-muted-foreground"> · {selected.admission_number ?? "—"}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or admission no…"
            className="h-8 border-0 bg-transparent p-0 focus-visible:ring-0"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {isLoading ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {(data?.length ?? 0) === 0
                ? "No students yet. Add students first."
                : "No students match this search."}
            </p>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">
                  <span className="font-medium">{s.full_name ?? "Unnamed"}</span>
                  <span className="text-muted-foreground"> · {s.admission_number ?? "—"}</span>
                </span>
                {s.id === value && <Check className="size-4 text-primary" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
