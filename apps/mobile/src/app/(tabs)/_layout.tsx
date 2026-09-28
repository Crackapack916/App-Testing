import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import { DESKTOP, TabBar } from "../../components/TabBar";

/** Five tabs: Drops, Search, Packs (center, default), Vault, Account. A top bar on desktop widths. */
export default function TabsLayout() {
  const { width } = useWindowDimensions();
  return (
    <Tabs initialRouteName="packs" backBehavior="initialRoute" tabBar={(p) => <TabBar {...p} />}
      screenOptions={{ headerShown: false, tabBarPosition: width >= DESKTOP ? "top" : "bottom" }}>
      <Tabs.Screen name="drops" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="packs" />
      <Tabs.Screen name="vault" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
