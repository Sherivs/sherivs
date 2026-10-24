import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/ui/components";
import { palette, spacing } from "@/ui/theme";
import type { CachedQuery } from "@/lib/offline-cache";

/** Standard loading / error / labelled-offline-cache / empty rendering for a cached query. */
export function QueryScreen<T>({ q, empty, isEmpty, children }: { q: CachedQuery<T>; empty: string; isEmpty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.c} refreshControl={<RefreshControl refreshing={q.loading} onRefresh={q.reload} tintColor={palette.text} />}>
      {q.cachedAt ? <Text style={styles.cached}>Offline copy from {new Date(q.cachedAt).toLocaleString("en-NG")} — pull to refresh.</Text> : null}
      {q.loading && q.data === null ? <LoadingState message="Loading…" /> : null}
      {!q.loading && q.data === null && q.error ? <ErrorState headline="Couldn't load" detail={q.error} onRetry={q.reload} /> : null}
      {q.data !== null && (isEmpty ? isEmpty(q.data) : Array.isArray(q.data) && q.data.length === 0) ? <EmptyState message={empty} /> : null}
      {q.data !== null ? children(q.data) : null}
    </ScrollView>
  );
}

export function Row({ title, right, sub }: { title: string; right?: string; sub?: string }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {right ? <Text style={styles.right}>{right}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  c: { padding: spacing.lg, gap: spacing.sm },
  cached: { color: "#F5C451", fontSize: 13, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#284B78" },
  title: { color: palette.text, fontSize: 16 },
  sub: { color: "#9FB3CF", fontSize: 13, marginTop: 2 },
  right: { color: palette.text, fontSize: 16, fontWeight: "600", marginLeft: spacing.md },
});
