const UUID_BYTES = 16;
const TIMESTAMP_BYTES = 6;
const VERSION_7 = 0x70;
const VARIANT_RFC4122 = 0x80;

/**
 * Returns a UUIDv7 (RFC 9562): 48-bit Unix milliseconds followed by random bits.
 * React Native needs a crypto.getRandomValues polyfill such as react-native-get-random-values.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(UUID_BYTES);
  crypto.getRandomValues(bytes);

  let timestamp = now;
  for (let index = TIMESTAMP_BYTES - 1; index >= 0; index--) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | VERSION_7;
  bytes[8] = (bytes[8] & 0x3f) | VARIANT_RFC4122;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
