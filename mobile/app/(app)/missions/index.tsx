import { FlatList, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { listMissionExecutions } from "@/api/missions.client";
import type { MissionExecutionRow } from "@/api/contracts/mission-contracts";
import { errorHeadline } from "@/api/errors";
import { useQueryData } from "@/lib/use-query";
import { kernelSupabase } from "@/lib/app-runtime";
import { useSession } from "@/providers/session-provider";
import { ScreenShell, EmptyState, ErrorState, LoadingState, RefreshControl, StatusBadge, Text, View } from "@/ui/components";
import { palette, spacing, typography } from "@/ui/theme";

function toneFor(status: string): string {
  if (status === "admitted") return palette.success;
  if (status === "denied") return palette.danger;
  if (status === "rolled_back") return palette.warning;
  return palette.neutral;
}

function ExecutionRow({ execution, onPress }: { execution: MissionExecutionRow; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}>
      <View style={styles.rowHeader}>
        <Text style={typography.subtitle} numberOfLines={1}>
          {execution.mission_id}
        </Text>
        <StatusBadge label={execution.status} tone={toneFor(execution.status)} />
      </View>
      <Text style={typography.muted}>
        v{execution.mission_version} · {execution.action} · started {new Date(execution.started_at).toLocaleString()}
      </Text>
    </Pressable>
  );
}

export default function MissionsScreen() {
  const router = useRouter();
  const { status } = useSession();

  const query = useQueryData<readonly MissionExecutionRow[]>(
    async () => {
      if (status !== "signedIn") return [];
      return listMissionExecutions(kernelSupabase, { limit: 50 });
    },
    [status],
  );

  return (
    <ScreenShell>
      <FlatList
        contentContainerStyle={styles.list}
        data={query.data ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={query.loading}
            onRefresh={query.reload}
            tintColor={palette.textMuted}
          />
        }
        renderItem={({ item }) => (
          <ExecutionRow execution={item} onPress={() => router.push(`/(app)/missions/${item.id}`)} />
        )}
        ListHeaderComponent={
          query.error ? (
            <ErrorState headline={errorHeadline(query.error.kind)} detail={query.error.message} onRetry={query.reload} />
          ) : null
        }
        ListFooterComponent={query.loading ? <LoadingState message="Loading mission executions…" /> : null}
        ListEmptyComponent={
          !query.loading && !query.error ? (
            <EmptyState message="No mission executions are visible to your identity. This list is served live from the governed mission substrate — nothing is cached." />
          ) : null
        }
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  rowCard: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.xs + 2,
  },
  rowPressed: { backgroundColor: palette.surfaceAlt },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
});