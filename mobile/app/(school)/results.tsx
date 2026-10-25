import { ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { results } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen, Row } from "@/workspace/screen-kit";

export default function ResultsScreen() {
  const { client } = useSession();
  const { students, key } = useSchool();
  const ids = (students.data ?? []).map((s) => s.id);
  const q = useCachedQuery(students.data ? key("results") : null, () => results(client, ids), [ids.join()]);
  return (
    <ScreenShell>
      <QueryScreen q={q} empty="No published results yet.">
        {(rows) => rows.map((g, i) => <Row key={`${g.student_id}-${g.subject}-${g.term}-${i}`} title={g.subject} sub={[g.term, g.academic_year].filter(Boolean).join(" · ")} right={`${g.total_score ?? "–"} ${g.grade ?? ""}`.trim()} />)}
      </QueryScreen>
    </ScreenShell>
  );
}
