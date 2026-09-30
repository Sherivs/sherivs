import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { StudentAITutor, useStudentSubjects } from "@/components/ai/student-ai-tutor";
import { StudyHistory } from "@/components/study-history";
import { useStudySessionRecorder } from "@/hooks/use-study-sessions";
import { Button } from "@/components/ui/button";
import { BookOpen, Coffee, Play, Timer } from "lucide-react";

const searchSchema = z.object({
  prompt: z.string().optional(),
  subject: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/student/ai-tutor")({
  ssr: false,
  validateSearch: searchSchema,
  component: StudentAITutorPage,
});

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function StudySessionTimer({
  studentId,
  subject,
}: {
  studentId: string | null;
  subject: string | null;
}) {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);
  const { record, canRecord } = useStudySessionRecorder(studentId);

  // Latest values for the unmount save, without restarting the interval.
  const latest = useRef({ seconds, subject, record });
  latest.current = { seconds, subject, record };

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Persist whatever is on the clock when the student leaves the page.
  useEffect(
    () => () => {
      const { seconds: s, subject: sub, record: save } = latest.current;
      if (s >= 60) save(s, sub);
    },
    [],
  );

  const toggle = () => {
    if (running) {
      // Pausing closes out the run: save it and reset the clock.
      if (seconds >= 60) {
        record(seconds, subject);
        toast.success(`Saved ${Math.round(seconds / 60)} min of study time`);
        setSeconds(0);
      } else if (canRecord) {
        toast.message("Sessions under a minute aren't saved");
      }
      setRunning(false);
    } else {
      setRunning(true);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
        <Timer className={`size-4 ${running ? "text-primary" : "text-muted-foreground"}`} />
        <span className="font-mono text-sm tabular-nums">Session: {formatDuration(seconds)}</span>
      </div>
      <Button type="button" variant="outline" onClick={toggle} className="rounded-xl">
        {running ? (
          <>
            <Coffee className="mr-2 size-4" /> Take a Break
          </>
        ) : (
          <>
            <Play className="mr-2 size-4" /> Resume
          </>
        )}
      </Button>
    </div>
  );
}

function StudentAITutorPage() {
  const { prompt, subject: subjectParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { profile } = useApp();
  const userId = profile?.id;

  const [studentId, setStudentId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id, class_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled && data) {
        setStudentId(data.id as string);
        setClassId((data.class_id as string) ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const subjects = useStudentSubjects(studentId, classId);
  const activeSubject = subjectParam ?? null;

  const subjectList = useMemo(() => subjects.data ?? [], [subjects.data]);

  const setSubject = (next: string | null) =>
    navigate({
      search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, subject: next ?? undefined }),
    });

  return (
    <PortalPage
      title="AI Tutor"
      subtitle="Your personal study companion — ask anything, any subject"
      actions={<StudySessionTimer studentId={studentId} subject={activeSubject} />}
    >
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Subject selector — desktop only */}
        <aside className="enterprise-card hidden h-fit p-3 lg:block">
          <p className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <BookOpen className="size-3.5" /> My subjects
          </p>
          <ul className="flex flex-col gap-1">
            <li>
              <button
                type="button"
                onClick={() => setSubject(null)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                  !activeSubject ? "bg-primary/15 text-primary" : "hover:bg-muted/30"
                }`}
              >
                All subjects
              </button>
            </li>
            {subjects.isLoading && (
              <li className="px-3 py-2 text-xs text-muted-foreground">Loading subjects…</li>
            )}
            {!subjects.isLoading && subjectList.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No subjects found yet.</li>
            )}
            {subjectList.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setSubject(s)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    activeSubject === s ? "bg-primary/15 text-primary" : "hover:bg-muted/30"
                  }`}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="min-w-0 space-y-4">
          <StudentAITutor
            key={activeSubject ?? "all"}
            studentId={studentId}
            subject={activeSubject}
            initialPrompt={prompt}
          />
          <StudyHistory studentId={studentId} />
        </div>
      </div>
    </PortalPage>
  );
}
