import { Linking, Text } from "react-native";
import { useI18n } from "@/i18n/hook";
import { Card, PrimaryButton, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { fees, naira } from "@/api/school.client";
import { useCachedQuery } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { QueryScreen, Row } from "@/workspace/screen-kit";
import { palette } from "@/ui/theme";

/** Fees & wallet. Payment itself happens on the web checkout (Paystack); settlement is webhook-driven server-side. */
export default function FeesScreen() {
  const { t } = useI18n();
  const { client, env } = useSession();
  const { students, key } = useSchool();
  const ids = (students.data ?? []).map((s) => s.id);
  const q = useCachedQuery(students.data ? key("fees") : null, () => fees(client, ids), [
    ids.join(),
  ]);
  return (
    <ScreenShell>
      <QueryScreen q={q} empty={t("school.fees.empty")}>
        {(rows) => {
          const owed = rows.reduce(
            (total, fee) => total + Math.max(0, Number(fee.amount) - Number(fee.paid_amount ?? 0)),
            0,
          );
          return (
            <>
              <Card>
                <Text style={{ color: palette.text, fontSize: 14 }}>
                  {t("school.fees.outstanding")}
                </Text>
                <Text style={{ color: palette.text, fontSize: 28, fontWeight: "700" }}>
                  {naira(owed)}
                </Text>
              </Card>
              {rows.map((fee) => (
                <Row
                  key={fee.id}
                  title={fee.fee_type}
                  sub={[fee.term, fee.due_date && t("school.fees.due", { date: fee.due_date })]
                    .filter(Boolean)
                    .join(" · ")}
                  right={`${naira(fee.paid_amount)} / ${naira(fee.amount)}`}
                />
              ))}
              {owed > 0 && !q.cachedAt ? (
                <PrimaryButton
                  label={t("school.fees.payOnWeb")}
                  onPress={() => Linking.openURL(`${env.sherivsWebBaseUrl}/fees`)}
                />
              ) : null}
            </>
          );
        }}
      </QueryScreen>
    </ScreenShell>
  );
}
