import { Text } from "react-native";
import { Card, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { attendance } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen, Row } from "@/workspace/screen-kit";
import { palette } from "@/ui/theme";

export default function AttendanceScreen() {
  const { client } = useSession();
  const { students, key } = useSchool();
  const ids = (students.data ?? []).map((s) => s.id);
  const q = useCachedQuery(students.data ? key("attendance") : null, () => attendance(client, ids), [ids.join()]);
  return (
    <ScreenShell>
      <QueryScreen q={q} empty="No attendance recorded in the last 60 days.">
        {(rows) => {
          const present = rows.filter((r) => r.status === "present" || r.status === "late").length;
          return (
            <>
              <Card><Text style={{ color: palette.text, fontSize: 18 }}>{rows.length ? Math.round((present / rows.length) * 100) : 0}% present · {rows.length} school days</Text></Card>
              {rows.map((r) => <Row key={`${r.student_id}-${r.date}`} title={new Date(r.date).toDateString()} right={r.status} />)}
            </>
          );
        }}
      </QueryScreen>
    </ScreenShell>
  );
}
