import { Text } from "react-native";
import { useI18n } from "@/i18n/hook";
import { Card, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { attendance } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen, Row } from "@/workspace/screen-kit";
import { palette } from "@/ui/theme";

export default function AttendanceScreen() {
  const { t } = useI18n();
  const { client } = useSession();
  const { students, key } = useSchool();
  const ids = (students.data ?? []).map((s) => s.id);
  const q = useCachedQuery(
    students.data ? key("attendance") : null,
    () => attendance(client, ids),
    [ids.join()],
  );
  return (
    <ScreenShell>
      <QueryScreen q={q} empty={t("school.attendance.empty")}>
        {(rows) => {
          const present = rows.filter(
            (row) => row.status === "present" || row.status === "late",
          ).length;
          const percent = rows.length ? Math.round((present / rows.length) * 100) : 0;
          return (
            <>
              <Card>
                <Text style={{ color: palette.text, fontSize: 18 }}>
                  {t("school.attendance.summary", { percent, days: rows.length })}
                </Text>
              </Card>
              {rows.map((row) => (
                <Row
                  key={`${row.student_id}-${row.date}`}
                  title={new Date(row.date).toDateString()}
                  right={row.status}
                />
              ))}
            </>
          );
        }}
      </QueryScreen>
    </ScreenShell>
  );
}
