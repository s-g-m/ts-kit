import Storage from "expo-sqlite/kv-store";
import type { StorageAdapter } from "./storage.ts";

/** StorageAdapter over the expo-sqlite key-value store, for small preferences kept on the device. */
export function sqliteStorageAdapter(): StorageAdapter {
  return {
    getItem: (key) => Storage.getItemSync(key),
    setItem: (key, value) => Storage.setItemSync(key, value),
    removeItem: (key) => {
      Storage.removeItemSync(key);
    },
    clear: () => {
      Storage.clearSync();
    },
  };
}
