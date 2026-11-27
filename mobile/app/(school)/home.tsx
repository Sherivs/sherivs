import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useI18n } from "@/i18n/hook";
import { Card, KeyValue, PressableRow, PrimaryButton, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { clearCache } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { palette, spacing } from "@/ui/theme";

export default function SchoolHome() {
  const router = useRouter();
  const { t } = useI18n();
  const { activeOrganization, signOut } = useSession();
  const { fullName, role, manifest, students } = useSchool();

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.c}>
        <Text style={styles.h}>
          {t("school.home.welcome")}
          {fullName ? `, ${fullName.split(" ")[0]}` : ""}
        </Text>
        <Card>
          <KeyValue
            label={t("school.home.labels.school")}
            value={activeOrganization?.name ?? "—"}
          />
          <KeyValue label={t("school.home.labels.role")} value={role ?? "—"} />
          <KeyValue label={t("school.home.labels.workspace")} value={manifest.kind} />
          {students.data?.length ? (
            <KeyValue
              label={
                students.data.length > 1
                  ? t("school.home.labels.children")
                  : t("school.home.labels.admissionNumber")
              }
              value={students.data.map((s) => s.admission_number ?? s.id.slice(0, 8)).join(", ")}
            />
          ) : null}
        </Card>
        {manifest.tabs
          .filter((tab) => tab.id !== "home")
          .map((tab) => (
            <PressableRow
              key={tab.id}
              title={`${tab.icon}  ${t(`school.tabs.${tab.id}`)}`}
              onPress={() => router.push(`/(school)/${tab.id}`)}
            />
          ))}
        {manifest.kind === "leadership" ? (
          <PressableRow
            title={t("school.home.platformConsoleTitle")}
            subtitle={t("school.home.platformConsoleSubtitle")}
            onPress={() => router.push("/(app)")}
          />
        ) : null}
        <PrimaryButton
          label={t("school.home.signOut")}
          onPress={async () => {
            await clearCache();
            await signOut();
            router.replace("/sign-in");
          }}
        />
      </ScrollView>
    </ScreenShell>
  );
}
const styles = StyleSheet.create({
  c: { padding: spacing.lg, gap: spacing.md },
  h: { color: palette.text, fontSize: 24, fontWeight: "700" },
});
