import { ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { getMissionStatusView } from "@/api/missions.client";
import { errorHeadline } from "@/api/errors";
import { useQueryData } from "@/lib/use-query";
import { kernelSupabase } from "@/lib/app-runtime";
import { useSession } from "@/providers/session-provider";
import { ScreenShell, Card, EmptyState, ErrorState, KeyValue, LoadingState, StatusBadge, Text } from "@/ui/components";
import { palette, spacing } from "@/ui/theme";

export default function MissionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useSession();

  const query = useQueryData(
    async () => {
      if (typeof id !== "string" || id.length === 0) return null;
      if (status !== "signedIn") return null;
      return getMissionStatusView(kernelSupabase, id);
    },
    [id, status],
  );

  if (query.loading) {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <LoadingState message="Loading mission execution…" />
        </View>
      </ScreenShell>
    );
  }

  if (query.error) {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <ErrorState headline={errorHeadline(query.error.kind)} detail={query.error.message} onRetry={query.reload} />
        </View>
      </ScreenShell>
    );
  }

  const view = query.data;
  if (!view) {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <EmptyState message="This mission execution does not exist or is not visible to your identity. Another tenant's record is indistinguishable from an unknown one." />
        </View>
      </ScreenShell>
    );
  }

  const { execution, verification } = view;
  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <StatusBadge
              label={execution.status}
              tone={execution.status === "admitted" ? palette.success : execution.status === "denied" ? palette.danger : palette.warning}
            />
          </View>
          <KeyValue label="Mission" value={execution.mission_id} />
          <KeyValue label="Version" value={execution.mission_version} />
          <KeyValue label="Action" value={execution.action} />
          <KeyValue label="Status" value={execution.status} />
          <KeyValue label="Reason" value={execution.reason} />
          <KeyValue label="External effect" value={execution.external_effect} />
          <KeyValue label="Reality ref" value={execution.reality_ref} />
          <KeyValue label="Requested at" value={new Date(execution.requested_at).toLocaleString()} />
          <KeyValue label="Started at" value={new Date(execution.started_at).toLocaleString()} />
        </Card>

        <Card>
          <KeyValue label="Independent verification" value={verification ? verification.decision : null} />
          {verification ? (
            <>
              <KeyValue label="Decision reason" value={verification.reason} />
              <KeyValue label="Evidence referenced" value={String(verification.evidence_ids.length)} />
              <StatusBadge
                label={verification.decision}
                tone={verification.decision === "verified" ? palette.success : verification.decision === "failed" ? palette.danger : palette.warning}
              />
            </>
          ) : (
            <Text style={{ color: palette.textMuted, fontSize: 13 }}>
              No independent verification has been recorded. Worker completion is not verification.
            </Text>
          )}
        </Card>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
});