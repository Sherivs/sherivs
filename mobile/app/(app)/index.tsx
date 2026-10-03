import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ScreenShell, Card, ErrorState, KeyValue, LoadingState, PressableRow, StatusBadge } from "@/ui/components";
import { useSession } from "@/providers/session-provider";
import { palette, spacing } from "@/ui/theme";

export default function HomeScreen() {
  const router = useRouter();
  const { status, actor, activeOrganization } = useSession();

  if (status === "loading") {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <LoadingState message="Restoring your CoreGrid session…" />
        </View>
      </ScreenShell>
    );
  }

  if (status === "signedOut" || actor === null) {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <ErrorState headline="No active session" detail="Return to sign-in to continue." />
        </View>
      </ScreenShell>
    );
  }

  if (actor.kind === "unprovisioned") {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <ErrorState
            headline="Identity not yet provisioned"
            detail="Your account is authenticated but no CoreGrid actor record is visible to you yet. Contact your organization administrator."
          />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <KeyValue label="Signed in as" value={actor.profile.full_name} />
          <KeyValue
            label="Actor kind"
            value={actor.kind === "user" ? `user (${actor.profile.role})` : "platform super admin"}
          />
        </Card>

        <Card>
          <KeyValue label="Organization" value={activeOrganization ? activeOrganization.name : "Not selected"} />
          {activeOrganization ? <KeyValue label="Slug" value={activeOrganization.slug} /> : null}
          {activeOrganization ? (
            <StatusBadge
              label={activeOrganization.is_active === true ? "active" : "inactive"}
              tone={activeOrganization.is_active === true ? palette.success : palette.warning}
            />
          ) : null}
          <PressableRow
            title="Select organization"
            subtitle="Choose the organization context for this session"
            onPress={() => router.push("/(app)/organization")}
          />
        </Card>

        <View style={{ gap: spacing.md }}>
          <PressableRow title="Missions" subtitle="Foundation-loop execution records" onPress={() => router.push("/(app)/missions")} />
          <PressableRow title="Workers & agents" subtitle="Registered identities (read-only)" onPress={() => router.push("/(app)/agents")} />
          <PressableRow title="Evidence" subtitle="Foundation-loop evidence records" onPress={() => router.push("/(app)/evidence")} />
          <PressableRow title="Settings" subtitle="Session, environment, sign out" onPress={() => router.push("/(app)/settings")} />
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
});