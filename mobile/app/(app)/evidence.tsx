import { FlatList, StyleSheet } from "react-native";
import { listMissionEvidence } from "@/api/missions.client";
import type { EvidenceRow } from "@/api/contracts/mission-contracts";
import { errorHeadline } from "@/api/errors";
import { useQueryData } from "@/lib/use-query";
import { kernelSupabase } from "@/lib/app-runtime";
import { useSession } from "@/providers/session-provider";
import { ScreenShell, EmptyState, ErrorState, LoadingState, RefreshControl, StatusBadge, Text, View } from "@/ui/components";
import { palette, spacing, statusColor, typography } from "@/ui/theme";

function EvidenceCard({ record }: { record: EvidenceRow }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={typography.subtitle} numberOfLines={1}>
          {record.producer}
        </Text>
        <StatusBadge label={record.lifecycle} tone={statusColor(record.lifecycle)} />
      </View>
      <Text style={typography.muted}>Provenance: {record.provenance}</Text>
      <Text style={typography.muted}>Integrity: {record.integrity}</Text>
      <Text style={typography.muted}>Recorded {new Date(record.recorded_at).toLocaleString()}</Text>
    </View>
  );
}

export default function EvidenceScreen() {
  const { status } = useSession();

  const query = useQueryData<readonly EvidenceRow[]>(
    async () => {
      if (status !== "signedIn") return [];
      return listMissionEvidence(kernelSupabase, { limit: 100 });
    },
    [status],
  );

  return (
    <ScreenShell>
      <FlatList
        contentContainerStyle={styles.list}
        data={query.data ?? []}
        keyExtractor={(item) => item.evidence_id}
        refreshControl={
          <RefreshControl refreshing={query.loading} onRefresh={query.reload} tintColor={palette.textMuted} />
        }
        renderItem={({ item }) => <EvidenceCard record={item} />}
        ListHeaderComponent={
          query.error ? (
            <ErrorState headline={errorHeadline(query.error.kind)} detail={query.error.message} onRetry={query.reload} />
          ) : null
        }
        ListFooterComponent={query.loading ? <LoadingState message="Loading evidence records…" /> : null}
        ListEmptyComponent={
          !query.loading && !query.error ? (
            <EmptyState message="No evidence records are visible to your identity. Evidence is only shown with its provenance and integrity binding — nothing is inferred or cached." />
          ) : null
        }
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.xs + 2,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
});