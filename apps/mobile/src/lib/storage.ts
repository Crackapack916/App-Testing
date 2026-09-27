import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/** Token storage: Keychain / Keystore on devices, localStorage on web. */
export const storage = {
  async get(key: string) {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === "web") return void globalThis.localStorage?.setItem(key, value);
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string) {
    if (Platform.OS === "web") return void globalThis.localStorage?.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
};
