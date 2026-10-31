import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { signInWithPassword } from "@/api/auth.client";
import { signInWithPasskey } from "@/api/passkeys.client";
import { ApiError, errorHeadline } from "@/api/errors";
import { useSession } from "@/providers/session-provider";
import { useConnectivity } from "@/providers/connectivity-provider";
import { Card, ErrorState, Field, PrimaryButton, SecondaryButton, Text as UIText } from "@/ui/components";
import { palette, spacing, typography } from "@/ui/theme";

export default function SignInScreen() {
  const router = useRouter();
  const { client, env } = useSession();
  const { snapshot } = useConnectivity();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const offline = snapshot.state !== "online";
  const nativePasskey = Platform.OS === "ios" || Platform.OS === "android";

  const submitPassword = async () => {
    setError(null);
    setBusy("password");
    try {
      await signInWithPassword(client, email.trim(), password);
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError("unknown", "sign-in failed"));
    } finally {
      setBusy(null);
    }
  };

  const submitPasskey = async () => {
    setError(null);
    setBusy("passkey");
    try {
      await signInWithPasskey(client, env);
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError("unknown", "passkey sign-in failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <Text style={typography.title}>Sherivs</Text>
          <Text style={typography.muted}>
            Sign in with your Sherivs account. Authentication is handled by the shared Supabase identity
            service — the same one the web application uses.
          </Text>
        </View>

        <Card>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@organization.example"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
          />
          <PrimaryButton
            label="Sign in"
            onPress={() => void submitPassword()}
            busy={busy === "password"}
            disabled={offline || busy !== null}
          />
          {nativePasskey ? (
            <SecondaryButton
              label="Sign in with a passkey"
              onPress={() => void submitPasskey()}
              busy={busy === "passkey"}
              disabled={offline || busy !== null}
            />
          ) : null}
          {offline ? (
            <UIText>You are offline — sign-in requires a connection to Sherivs.</UIText>
          ) : null}
        </Card>

        {error ? (
          <ErrorState headline={errorHeadline(error.kind)} detail={error.message} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  content: { padding: spacing.xl, gap: spacing.lg },
  heading: { gap: spacing.sm, marginBottom: spacing.sm },
});
