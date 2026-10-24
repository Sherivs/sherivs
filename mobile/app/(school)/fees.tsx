import { Linking, Text } from "react-native";
import { Card, PrimaryButton, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { fees, naira } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen, Row } from "@/workspace/screen-kit";
import { palette } from "@/ui/theme";

/** Fees & wallet. Payment itself happens on the web checkout (Paystack); settlement is webhook-driven server-side. */
export default function FeesScreen() {
  const { client, env } = useSession();
  const { students, key } = useSchool();
  const ids = (students.data ?? []).map((s) => s.id);
  const q = useCachedQuery(students.data ? key("fees") : null, () => fees(client, ids), [ids.join()]);
  return (
    <ScreenShell>
      <QueryScreen q={q} empty="No fees on record.">
        {(rows) => {
          const owed = rows.reduce((t, f) => t + Math.max(0, Number(f.amount) - Number(f.paid_amount ?? 0)), 0);
          return (
            <>
              <Card>
                <Text style={{ color: palette.text, fontSize: 14 }}>Outstanding</Text>
                <Text style={{ color: palette.text, fontSize: 28, fontWeight: "700" }}>{naira(owed)}</Text>
              </Card>
              {rows.map((f) => <Row key={f.id} title={f.fee_type} sub={[f.term, f.due_date && `due ${f.due_date}`].filter(Boolean).join(" · ")} right={`${naira(f.paid_amount)} / ${naira(f.amount)}`} />)}
              {owed > 0 && !q.cachedAt ? <PrimaryButton label="Pay securely on the web" onPress={() => Linking.openURL(`${env.sherivsWebBaseUrl}/fees`)} /> : null}
            </>
          );
        }}
      </QueryScreen>
    </ScreenShell>
  );
}
