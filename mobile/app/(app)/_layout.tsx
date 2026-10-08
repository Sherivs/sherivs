import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#122B4E" },
        headerTintColor: "#E9F0FA",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#0B1F3A" },
        headerTitleAlign: "left",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Sherivs" }} />
      <Stack.Screen name="organization" options={{ title: "Organization" }} />
      <Stack.Screen name="missions/index" options={{ title: "Missions" }} />
      <Stack.Screen name="missions/[id]" options={{ title: "Mission" }} />
      <Stack.Screen name="agents" options={{ title: "Workers & agents" }} />
      <Stack.Screen name="evidence" options={{ title: "Evidence" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}