import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Card, KeyValue, PressableRow, PrimaryButton, ScreenShell } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { clearCache } from "@/lib/offline-cache";
import { useSchool } from "@/workspace/use-school";
import { palette, spacing } from "@/ui/theme";

export default function SchoolHome() {
  const router = useRouter();
  const { activeOrganization, signOut } = useSession();
  const { fullName, role, manifest, students } = useSchool();
  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.c}>
        <Text style={styles.h}>Welcome{fullName ? `, ${fullName.split(" ")[0]}` : ""}</Text>
        <Card>
          <KeyValue label="School" value={activeOrganization?.name ?? "—"} />
          <KeyValue label="Role" value={role ?? "—"} />
          <KeyValue label="Workspace" value={manifest.kind} />
          {students.data?.length ? <KeyValue label={students.data.length > 1 ? "Children" : "Admission no."} value={students.data.map((s) => s.admission_number ?? s.id.slice(0, 8)).join(", ")} /> : null}
        </Card>
        {manifest.tabs.filter((t) => t.id !== "home").map((t) => (
          <PressableRow key={t.id} title={`${t.icon}  ${t.title}`} onPress={() => router.push(`/(school)/${t.id}`)} />
        ))}
        {manifest.kind === "leadership" ? <PressableRow title="Platform console" subtitle="Organization, missions, evidence" onPress={() => router.push("/(app)")} /> : null}
        <PrimaryButton label="Sign out" onPress={async () => { await clearCache(); await signOut(); router.replace("/sign-in"); }} />
      </ScrollView>
    </ScreenShell>
  );
}
const styles = StyleSheet.create({ c: { padding: spacing.lg, gap: spacing.md }, h: { color: palette.text, fontSize: 24, fontWeight: "700" } });
