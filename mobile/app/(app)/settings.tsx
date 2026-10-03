import { ScrollView, StyleSheet, View } from "react-native";
import { useSession } from "@/providers/session-provider";
import { ScreenShell, Card, ErrorState, KeyValue, LoadingState, PrimaryButton, StatusBadge, Text } from "@/ui/components";
import { palette, spacing, typography } from "@/ui/theme";

export default function SettingsScreen() {
  const { status, session, actor, env, signOut } = useSession();

  if (status === "loading") {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <LoadingState message="Loading session…" />
        </View>
      </ScreenShell>
    );
  }

  if (status === "signedOut" || session === null) {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <ErrorState headline="No active session" detail="Return to sign-in to continue." />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <KeyValue label="Auth user id" value={session.user.id} />
          <KeyValue label="Email" value={session.user.email ?? null} />
          {actor && actor.kind !== "unprovisioned" ? (
            <KeyValue
              label="Actor"
              value={actor.kind === "user" ? `${actor.profile.full_name} (${actor.profile.role})` : actor.profile.full_name}
            />
          ) : null}
          <StatusBadge label={`session active`} tone={palette.success} />
        </Card>

        <Card>
          <KeyValue label="Environment" value={env.appEnv} />
          <KeyValue label="Supabase project" value={env.supabaseUrl} />
          <KeyValue label="Web API base" value={env.coregridWebBaseUrl} />
          <KeyValue
            label="Server fn: recordFoundationLoop"
            value={env.serverFnIds.recordFoundationLoop ? env.serverFnIds.recordFoundationLoop : "not configured"}
          />
          <KeyValue
            label="Server fn: listIdentities"
            value={env.serverFnIds.listIdentities ? env.serverFnIds.listIdentities : "not configured"}
          />
        </Card>

        <Card>
          <Text style={typography.muted}>
            Sign out clears the session and its secure-storage tokens (iOS Keychain / Android Keystore).
            Server-side authorization remains the security boundary; the app stores no cached
            organization data.
          </Text>
          <PrimaryButton label="Sign out" onPress={() => void signOut()} />
        </Card>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
});