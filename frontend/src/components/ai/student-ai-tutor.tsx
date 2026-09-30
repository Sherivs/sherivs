import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { AIAssistantShell, type QuickPrompt } from "@/components/ai/ai-assistant-shell";

export const STUDENT_QUICK_PROMPTS: QuickPrompt[] = [
  { label: "Explain a concept", prompt: "Explain [topic] in simple terms" },
  { label: "Practice quiz", prompt: "Give me 5 practice questions on [subject]" },
  { label: "Revision plan", prompt: "Help me create a revision plan for my exams" },
  { label: "Homework help", prompt: "I need help with my homework on [topic]" },
  { label: "Past questions", prompt: "Show me practice questions for [exam type]" },
];

export function StudentAITutor({
  studentId,
  subject,
  initialPrompt,
}: {
  studentId: string | null;
  subject?: string | null;
  initialPrompt?: string;
}) {
  const { profile, school } = useApp();
  const userId = profile?.id;
  const schoolId = school?.id ?? profile?.school_id;

  if (!userId || !schoolId) return null;

  const focus = subject ? ` Right now the student wants to focus on ${subject}.` : "";

  return (
    <AIAssistantShell
      portalName={subject ? `student-${subject.toLowerCase().replace(/\s+/g, "-")}` : "student"}
      assistantName="AI Tutor"
      systemContext={`I'm your personal tutor. I use your own grade history, attendance record and enrolled subjects to help you study.${focus}`}
      quickPrompts={STUDENT_QUICK_PROMPTS}
      userId={userId}
      schoolId={schoolId}
      initialPrompt={initialPrompt}
      isLoadingScope={!studentId}
      scope={{
        studentIds: studentId ? [studentId] : [],
        subjectLabel: "your studies",
      }}
    />
  );
}

/** Subjects this student is enrolled in — derived from grades + timetable. */
export function useStudentSubjects(studentId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["student-subjects", studentId, classId],
    enabled: !!studentId || !!classId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const subjects = new Set<string>();

      if (studentId) {
        const { data } = await supabase
          .from("grades")
          .select("subject")
          .eq("student_id", studentId);
        (data ?? []).forEach((r) => r.subject && subjects.add(r.subject as string));
      }

      if (classId) {
        const { data: tts } = await supabase
          .from("timetables")
          .select("id")
          .eq("class_id", classId)
          .limit(1);
        const ttId = tts?.[0]?.id as string | undefined;
        if (ttId) {
          const { data } = await supabase
            .from("timetable_slots")
            .select("subject, is_break")
            .eq("timetable_id", ttId);
          (data ?? []).forEach((r) => {
            if (!r.is_break && r.subject) subjects.add(r.subject as string);
          });
        }
      }

      return Array.from(subjects).sort((a, b) => a.localeCompare(b));
    },
  });
}

export default StudentAITutor;
