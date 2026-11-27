import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/ui/components";
import { palette, spacing, typography } from "@/ui/theme";
import { useVersionGate } from "@/lib/version/gate";

function openStore(url: string | null) {
  if (!url) return;
  void Linking.openURL(url);
}

function BlockingUpdateScreen({ storeUrl }: { storeUrl: string | null }) {
  return (
    <View style={styles.blockingRoot}>
      <Text style={styles.blockingTitle}>Update required</Text>
      <Text style={typography.body}>
        This app version is no longer supported. Please update to continue.
      </Text>
      {storeUrl ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openStore(storeUrl)}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Update now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SoftUpdateBanner({
  storeUrl,
  onDismiss,
}: {
  storeUrl: string | null;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>A newer version of this app is available.</Text>
      <View style={styles.bannerActions}>
        {storeUrl ? (
          <Pressable accessibilityRole="button" onPress={() => openStore(storeUrl)}>
            <Text style={styles.bannerActionText}>Update</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onDismiss}>
          <Text style={styles.bannerActionText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function VersionUpdateGate({ children }: { children: React.ReactNode }) {
  const { decision, showSoftBanner, dismissSoftBanner } = useVersionGate();

  if (decision.kind === "block") {
    return <BlockingUpdateScreen storeUrl={decision.storeUrl} />;
  }

  return (
    <>
      {showSoftBanner && decision.kind === "soft" ? (
        <SoftUpdateBanner storeUrl={decision.storeUrl} onDismiss={dismissSoftBanner} />
      ) : null}
      {children}
    </>
  );
}

const styles = StyleSheet.create({
  blockingRoot: {
    flex: 1,
    backgroundColor: palette.background,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    gap: spacing.md,
  },
  blockingTitle: {
    ...typography.title,
  },
  primaryButton: {
    marginTop: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: palette.primary,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  banner: {
    backgroundColor: palette.warning,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  bannerText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 13,
  },
  bannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  bannerActionText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
    textDecorationLine: "underline",
  },
});
