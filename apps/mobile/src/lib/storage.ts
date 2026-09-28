/** Token storage. The customer app is a website, so this is localStorage. */
export const storage = {
  async get(key: string) { return globalThis.localStorage?.getItem(key) ?? null; },
  async set(key: string, value: string) { globalThis.localStorage?.setItem(key, value); },
  async remove(key: string) { globalThis.localStorage?.removeItem(key); },
};
