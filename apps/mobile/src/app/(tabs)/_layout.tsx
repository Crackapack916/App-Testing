import { Tabs } from "expo-router";
import { TabBar } from "../../components/TabBar";

/** Four tabs. Packs is the default landing tab and sits raised in the center. */
export default function TabsLayout() {
  return (
    <Tabs initialRouteName="packs" backBehavior="initialRoute" screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="vault" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="packs" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
