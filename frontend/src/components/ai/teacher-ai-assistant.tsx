import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { AIAssistantShell, type QuickPrompt } from "@/components/ai/ai-assistant-shell";

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    label: "How is my class performing?",
    prompt: "Give me a performance summary of my classes this term",
  },
  {
    label: "Which students need help?",
    prompt: "Which students in my classes have declining grades?",
  },
  { label: "Lesson plan ideas", prompt: "Help me plan a lesson on [topic]" },
  { label: "Mark attendance", prompt: "Show me today's attendance for my classes" },
  { label: "Generate quiz", prompt: "Generate 5 quiz questions on [subject]" },
];

export function TeacherAIAssistant() {
  const { profile, school } = useApp();
  const teacherId = profile?.id;
  const schoolId = school?.id ?? profile?.school_id;

  const classes = useQuery({
    queryKey: ["teacher-ai-classes", teacherId, schoolId],
    enabled: !!teacherId && !!schoolId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!);
      if (error) throw error;
      return (data ?? []).map((c) => c.id as string);
    },
  });

  if (!teacherId || !schoolId) return null;

  return (
    <AIAssistantShell
      portalName="teacher"
      assistantName="Teacher Assistant"
      systemContext="I read live data from your own classes only — attendance, grades, timetable and students you teach."
      quickPrompts={QUICK_PROMPTS}
      userId={teacherId}
      schoolId={schoolId}
      isLoadingScope={classes.isLoading}
      scope={{
        classIds: classes.data ?? [],
        teacherId,
        subjectLabel: "your classes",
      }}
    />
  );
}

export default TeacherAIAssistant;
