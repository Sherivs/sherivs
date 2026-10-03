import { ScrollView, StyleSheet, View } from "react-native";
import { listSelectableOrganizations } from "@/api/auth.client";
import type { Organization } from "@/api/contracts/profile-contracts";
import { errorHeadline } from "@/api/errors";
import { useQueryData } from "@/lib/use-query";
import { useSession } from "@/providers/session-provider";
import { ScreenShell, EmptyState, ErrorState, LoadingState, PressableRow, StatusBadge } from "@/ui/components";
import { palette, spacing } from "@/ui/theme";

export default function OrganizationScreen() {
  const { status, actor, activeOrganization, client, setActiveOrganization } = useSession();
  const userId = actor?.kind === "user" ? actor.profile.id : actor?.kind === "super_admin" ? actor.profile.id : null;

  const query = useQueryData<readonly Organization[]>(
    async () => {
      if (status !== "signedIn" || actor === null || actor.kind === "unprovisioned") return [];
      return listSelectableOrganizations(client, actor);
    },
    [status, userId],
  );

  if (status !== "signedIn" || actor === null || actor.kind === "unprovisioned") {
    return (
      <ScreenShell>
        <View style={styles.container}>
          <ErrorState headline="No actor context" detail="Sign in with a provisioned CoreGrid identity." />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.container}>
        {query.loading ? <LoadingState message="Querying organizations visible to you…" /> : null}
        {query.error ? (
          <ErrorState headline={errorHeadline(query.error.kind)} detail={query.error.message} onRetry={query.reload} />
        ) : null}
        {!query.loading && !query.error && query.data && query.data.length === 0 ? (
          <EmptyState message="No organizations are visible to your identity. Access is decided by the server." />
        ) : null}
        {query.data
          ? query.data.map((organization) => (
              <PressableRow
                key={organization.id}
                title={organization.name}
                subtitle={
                  organization.is_active === true
                    ? `Active · ${organization.slug}`
                    : `Inactive · ${organization.slug}`
                }
                onPress={() => setActiveOrganization(organization)}
              />
            ))
          : null}
        {activeOrganization ? (
          <View style={{ marginTop: spacing.md }}>
            <StatusBadge label={`Selected: ${activeOrganization.name}`} tone={palette.primary} />
          </View>
        ) : null}
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
});