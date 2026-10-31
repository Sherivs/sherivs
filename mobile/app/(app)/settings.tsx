import { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { getAccessToken } from "@/api/auth.client";
import { ApiError } from "@/api/errors";
import {
  listPasskeys,
  registerPasskey,
  removePasskey,
  type PasskeyListItem,
} from "@/api/passkeys.client";
import { useSession } from "@/providers/session-provider";
import {
  ScreenShell,
  Card,
  ErrorState,
  KeyValue,
  LoadingState,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
  Text,
} from "@/ui/components";
import { palette, spacing, typography } from "@/ui/theme";

function PasskeySettings() {
  const { env, client } = useSession();
  const native = Platform.OS === "ios" || Platform.OS === "android";
  const [items, setItems] = useState<PasskeyListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const token = await getAccessToken(client);
    if (!token) return;
    setItems(await listPasskeys(env, token));
  }, [client, env]);

  useEffect(() => {
    if (!native) return;
    void reload().catch((cause) => {
      setError(cause instanceof ApiError ? cause.message : "Could not load passkeys.");
    });
  }, [native, reload]);

  if (!native) return null;

  const enroll = async () => {
    setError(null);
    setBusy(true);
    try {
      const token = await getAccessToken(client);
      if (!token) throw new ApiError("auth", "Sign in to manage passkeys.");
      await registerPasskey(env, token);
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "That passkey could not be registered.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (credentialId: string) => {
    setError(null);
    setBusy(true);
    try {
      const token = await getAccessToken(client);
      if (!token) throw new ApiError("auth", "Sign in to manage passkeys.");
      await removePasskey(env, token, credentialId);
      await reload();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The passkey could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={typography.subtitle}>Passkeys</Text>
      <Text style={typography.muted}>
        Register a passkey on this iOS or Android device. Sherivs never stores a fingerprint or face
        image. Browser sign-in stays password, Google, and Cloudflare Turnstile.
      </Text>
      {items.map((item) => (
        <View key={item.id} style={styles.passkeyRow}>
          <KeyValue label={item.label} value={item.lastUsedAt ?? item.createdAt} />
          <SecondaryButton
            label="Remove"
            onPress={() => void remove(item.id)}
            disabled={busy}
          />
        </View>
      ))}
      <PrimaryButton
        label="Register a passkey"
        onPress={() => void enroll()}
        busy={busy}
        disabled={busy}
      />
      {error ? <Text style={typography.muted}>{error}</Text> : null}
    </Card>
  );
}

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
          <KeyValue label="Web API base" value={env.sherivsWebBaseUrl} />
          <KeyValue
            label="Server fn: recordFoundationLoop"
            value={env.serverFnIds.recordFoundationLoop ? env.serverFnIds.recordFoundationLoop : "not configured"}
          />
          <KeyValue
            label="Server fn: listIdentities"
            value={env.serverFnIds.listIdentities ? env.serverFnIds.listIdentities : "not configured"}
          />
        </Card>

        <PasskeySettings />

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
  passkeyRow: { gap: spacing.sm },
});