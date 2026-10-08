import { ScrollView, StyleSheet, View } from "react-native";
import { listWorkerAgents } from "@/api/identity.client";
import { errorHeadline } from "@/api/errors";
import { useQueryData } from "@/lib/use-query";
import { getAccessToken } from "@/api/auth.client";
import type { ListIdentitiesResponse } from "@/api/contracts/identity-contracts";
import { mobileEnv } from "@/lib/app-runtime";
import { useSession } from "@/providers/session-provider";
import { ScreenShell, Card, EmptyState, ErrorState, KeyValue, LoadingState, StatusBadge, Text } from "@/ui/components";
import { palette, spacing, statusColor, typography } from "@/ui/theme";

export default function AgentsScreen() {
  const { status, actor, activeOrganization, client } = useSession();
  const userId = actor?.kind === "user" ? actor.profile.id : null;
  const organizationId = activeOrganization?.id ?? null;

  const query = useQueryData<ListIdentitiesResponse | null>(
    async () => {
      if (status !== "signedIn" || actor === null || actor.kind !== "user" || !activeOrganization) {
        return null;
      }
      const accessToken = await getAccessToken(client);
      return listWorkerAgents({ env: mobileEnv, accessToken }, activeOrganization.id, { limit: 50 });
    },
    [status, userId, organizationId],
  );

  if (status !== "signedIn" || actor === null) {
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
          <ErrorState headline="Identity not yet provisioned" detail="No Sherivs actor record is visible to this account." />
        </View>
      </ScreenShell>
    );
  }

  if (actor.kind === "super_admin" || !activeOrganization) {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <ErrorState
            headline="Organization context required"
            detail="Worker and agent status is scoped to an organization. Select an organization you are authorized for first."
          />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.container}>
        {query.loading ? <LoadingState message="Requesting identity registry…" /> : null}
        {query.error ? (
          <ErrorState headline={errorHeadline(query.error.kind)} detail={query.error.message} onRetry={query.reload} />
        ) : null}
        {query.data && query.data.identities.length === 0 ? (
          <EmptyState message="No registered identities are visible in this organization yet." />
        ) : null}
        {query.data
          ? query.data.identities.map((identity) => (
              <Card key={identity.id}>
                <KeyValue label="Display name" value={identity.display_name} />
                <KeyValue label="Kind" value={identity.kind} />
                <KeyValue label="State" value={identity.state} />
                <KeyValue label="Verified" value={identity.verified ? "yes" : "no"} />
                <StatusBadge label={identity.state} tone={statusColor(identity.state)} />
              </Card>
            ))
          : null}
        {query.data ? (
          <Text style={typography.muted}>
            Read-only view of the governed identity registry (cg_identity), served through the same
            tenant-scoped server function the web application uses.
          </Text>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
});