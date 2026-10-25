import { Redirect, Tabs } from "expo-router";
import { Text } from "react-native";
import { useSession } from "@/providers/session-provider";
import { TAB_SPECS, type SchoolTab } from "@/workspace/manifest";
import { useSchool } from "@/workspace/use-school";

/** Role-based tabs from the workspace manifest: one account, tabs filtered by role (hidden tabs get href: null). */
export default function SchoolTabsLayout() {
  const { status } = useSession();
  const { manifest } = useSchool();
  if (status === "signedOut") return <Redirect href="/sign-in" />;
  const visible = new Set<SchoolTab>(manifest.tabs.map((t) => t.id));
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: "#122B4E" }, headerTintColor: "#E9F0FA", tabBarStyle: { backgroundColor: "#0B1F3A", borderTopColor: "#284B78" }, tabBarActiveTintColor: "#F5C451", tabBarInactiveTintColor: "#9DB2CE" }}>
      {(Object.keys(TAB_SPECS) as SchoolTab[]).map((id) => (
        <Tabs.Screen
          key={id}
          name={id}
          options={{
            title: TAB_SPECS[id].title,
            href: visible.has(id) ? undefined : null,
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{TAB_SPECS[id].icon}</Text>,
          }}
        />
      ))}
    </Tabs>
  );
}
