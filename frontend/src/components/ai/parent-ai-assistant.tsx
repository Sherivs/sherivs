import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { AIAssistantShell, type QuickPrompt } from "@/components/ai/ai-assistant-shell";

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    label: "How is my child doing?",
    prompt: "Give me a summary of my child's academic performance",
  },
  { label: "Check attendance", prompt: "What is my child's attendance this term?" },
  { label: "Outstanding fees", prompt: "What fees are outstanding for my child?" },
  { label: "Recent grades", prompt: "Show my child's latest grades" },
  { label: "Bus status", prompt: "Where is my child's school bus right now?" },
];

export function ParentAIAssistant() {
  const { profile, school } = useApp();
  const parentId = profile?.id;
  const parentEmail = profile?.email ?? null;
  const schoolId = school?.id ?? profile?.school_id;

  const children = useQuery({
    queryKey: ["parent-ai-children-scope", parentId, parentEmail, schoolId],
    enabled: !!parentId && !!schoolId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ids = new Set<string>();

      const { data: links } = await supabase
        .from("parent_student_map")
        .select("student_id")
        .eq("parent_id", parentId!);
      (links ?? []).forEach((l) => l.student_id && ids.add(l.student_id as string));

      const { data: owned } = await supabase
        .from("students")
        .select("id")
        .eq("school_id", schoolId!)
        .eq("parent_id", parentId!);
      (owned ?? []).forEach((s) => ids.add(s.id as string));

      if (parentEmail) {
        const { data: byEmail } = await supabase
          .from("students")
          .select("id")
          .eq("school_id", schoolId!)
          .eq("parent_email", parentEmail);
        (byEmail ?? []).forEach((s) => ids.add(s.id as string));
      }

      return Array.from(ids);
    },
  });

  if (!parentId || !schoolId) return null;

  return (
    <AIAssistantShell
      portalName="parent"
      assistantName="School Hermes"
      systemContext="I answer using live records for your own children only — attendance, grades, fees and transport."
      quickPrompts={QUICK_PROMPTS}
      userId={parentId}
      schoolId={schoolId}
      isLoadingScope={children.isLoading}
      scope={{
        studentIds: children.data ?? [],
        subjectLabel: "your child",
      }}
    />
  );
}

export default ParentAIAssistant;
