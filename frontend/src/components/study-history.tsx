import { BookOpen, Clock, Flame } from "lucide-react";
import { GlassCard, EmptyState, SkeletonBlock } from "@/components/portal-shell";
import { formatMinutes, useStudyHistory } from "@/hooks/use-study-sessions";

/** Study log for the student portal — fed by the AI tutor session timer. */
export function StudyHistory({
  studentId,
  compact = false,
  limit = 20,
}: {
  studentId: string | null;
  compact?: boolean;
  limit?: number;
}) {
  const history = useStudyHistory(studentId, limit);

  if (history.isLoading) {
    return (
      <GlassCard className="p-5">
        <SkeletonBlock className="h-32 w-full" />
      </GlassCard>
    );
  }

  if (history.isError) {
    return (
      <GlassCard className="p-5 text-center">
        <p className="text-sm text-muted-foreground">Your study history could not be loaded.</p>
        <button
          type="button"
          onClick={() => void history.refetch()}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted/30"
        >
          Retry
        </button>
      </GlassCard>
    );
  }

  const data = history.data;
  const sessions = data?.sessions ?? [];

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
          <Clock className="size-4 text-primary" /> Study history
        </h3>
        <span className="text-xs text-muted-foreground">
          {formatMinutes(data?.weekMinutes ?? 0)} this week
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Today" value={formatMinutes(data?.todayMinutes ?? 0)} />
        <Stat label="Last 7 days" value={formatMinutes(data?.weekMinutes ?? 0)} />
        <Stat label="Sessions" value={String(sessions.length)} />
      </div>

      {!compact && (data?.topSubjects.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data!.topSubjects.map(([subject, minutes]) => (
            <span
              key={subject}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/20 px-3 py-1 text-xs"
            >
              <BookOpen className="size-3" /> {subject} · {formatMinutes(minutes)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4">
        {sessions.length === 0 ? (
          <EmptyState
            icon={<Flame className="size-5" />}
            title="No study sessions yet"
            description="Start the timer on the AI Tutor page and your sessions will show up here."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {sessions.slice(0, compact ? 4 : limit).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">{s.subject ?? "General study"}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {s.session_date ?? "—"} · {formatMinutes(s.duration_minutes ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-2 py-3">
      <div className="font-display text-base font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export default StudyHistory;
