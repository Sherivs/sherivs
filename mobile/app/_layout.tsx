import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { palette } from "@/ui/theme";
import { ConnectivityProvider } from "@/providers/connectivity-provider";
import { SessionProvider } from "@/providers/session-provider";
import { MobileI18nProvider } from "@/i18n/provider";

export default function RootLayout() {
  return (
    <MobileI18nProvider>
      <SessionProvider>
        <ConnectivityProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: palette.background },
              headerTintColor: palette.text,
              contentStyle: { backgroundColor: palette.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ title: "Sign in", headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
          </Stack>
        </ConnectivityProvider>
      </SessionProvider>
    </MobileI18nProvider>
  );
}
