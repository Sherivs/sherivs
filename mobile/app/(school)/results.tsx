import { useI18n } from "@/i18n/hook";
import { results } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSession } from "@/providers/session-provider";
import { Card, ScreenShell } from "@/ui/components";
import { QueryScreen, Row } from "@/workspace/screen-kit";
import { useSchool } from "@/workspace/use-school";

export default function ResultsScreen() {
  const { t } = useI18n();
  const { client } = useSession();
  const { students, key } = useSchool();
  const ids = (students.data ?? []).map((s) => s.id);
  const q = useCachedQuery(students.data ? key("results") : null, () => results(client, ids), [
    ids.join(),
  ]);
  return (
    <ScreenShell>
      <QueryScreen q={q} empty={t("school.results.empty")}>
        {(rows) =>
          rows.map((g, i) => (
            <Row
              key={`${g.student_id}-${g.subject}-${g.term}-${i}`}
              title={g.subject}
              sub={[g.term, g.academic_year].filter(Boolean).join(" · ")}
              right={`${g.total_score ?? "–"} ${g.grade ?? ""}`.trim()}
            />
          ))
        }
      </QueryScreen>
    </ScreenShell>
  );
}
