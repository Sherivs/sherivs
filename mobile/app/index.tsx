import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/providers/session-provider";
import { palette } from "@/ui/theme";

export default function EntryRoute() {
  const { status } = useSession();
  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.primary} />
      </View>
    );
  }
  if (status === "signedOut") return <Redirect href="/sign-in" />;
  return <Redirect href="/(app)" />;
}