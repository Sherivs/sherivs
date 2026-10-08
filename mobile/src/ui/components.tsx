/**
 * CoreGrid Mobile — shared UI primitives (Phase 22 §J). React Native core
 * components only; the mobile foundation introduces no new UI framework.
 */
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { useConnectivity } from "@/providers/connectivity-provider";
import { palette, radius, spacing, typography } from "./theme";

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { borderColor: tone }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{label}</Text>
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.keyValueRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value === null || value === undefined || value === "" ? "—" : value}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        (disabled || busy) && styles.buttonDisabled,
        pressed && !disabled && !busy && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

export function PressableRow({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={{ flex: 1 }}>
        <Text style={typography.subtitle}>{title}</Text>
        {subtitle ? <Text style={typography.muted}>{subtitle}</Text> : null}
      </View>
      <Text style={[typography.body, { color: palette.textMuted }]}>›</Text>
    </Pressable>
  );
}

export function LoadingState({ message }: { message: string }) {
  return (
    <Card>
      <Text style={typography.muted}>{message}</Text>
    </Card>
  );
}

export function ErrorState({ headline, detail, onRetry }: { headline: string; detail?: string; onRetry?: () => void }) {
  return (
    <Card style={styles.errorCard}>
      <Text style={styles.errorTitle}>{headline}</Text>
      {detail ? <Text style={typography.muted}>{detail}</Text> : null}
      {onRetry ? (
        <PrimaryButton label="Try again" onPress={onRetry} />
      ) : null}
    </Card>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <Text style={typography.muted}>{message}</Text>
    </Card>
  );
}

export function ScreenShell({ children }: { children: React.ReactNode }) {
  const { snapshot, retry } = useConnectivity();
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner visible={snapshot.state !== "online"} onRetry={retry} />
      {children}
    </View>
  );
}

export function OfflineBanner({ visible, onRetry }: { visible: boolean; onRetry: () => void }) {
  if (!visible) return null;
  return (
    <View style={styles.offlineBanner}>
      <Text style={styles.offlineText}>Offline — Sherivs cannot be reached. Data is not shown from cache.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
        <Text style={[styles.offlineText, { textDecorationLine: "underline" }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...input } = props;
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        placeholderTextColor={palette.textMuted}
        style={[styles.input, input.style]}
      />
    </View>
  );
}

export function List({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: spacing.md }}>{children}</View>;
}

export { RefreshControl, Text, View };

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  keyValueRow: { gap: 2 },
  label: { ...typography.label },
  body: { ...typography.body },
  button: {
    backgroundColor: palette.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonPressed: { backgroundColor: palette.primaryPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  row: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowPressed: { backgroundColor: palette.surfaceAlt },
  errorCard: { borderColor: palette.danger },
  errorTitle: { ...typography.subtitle, color: palette.danger },
  offlineBanner: {
    backgroundColor: palette.warning,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  offlineText: { color: "#FFFFFF", fontWeight: "600", fontSize: 13, flexShrink: 1 },
  input: {
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
  },
});