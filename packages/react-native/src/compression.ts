import { webCompressor, type CaptureCodec } from '@posthog/core/capture-v1'

import { OptionalReactNativePlugin } from './optional/OptionalPlugin'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = new Uint8Array(128)
for (let i = 0; i < BASE64_ALPHABET.length; i++) {
  BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(i)] = i
}

/** Decodes padded, unwrapped base64, as the plugin's `gzip` returns it. */
export function base64ToBytes(base64: string): Uint8Array {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((base64.length / 4) * 3 - padding)
  const at = (index: number): number => BASE64_LOOKUP[base64.charCodeAt(index) & 127]
  for (let i = 0, j = 0; i < base64.length; i += 4) {
    const n = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3)
    bytes[j++] = n >> 16
    if (j < bytes.length) bytes[j++] = (n >> 8) & 255
    if (j < bytes.length) bytes[j++] = n & 255
  }
  return bytes
}

/**
 * Compresses a capture request body with `CompressionStream` where the runtime has one (react-native-web),
 * and otherwise gzips it natively with `@posthog/react-native-plugin`. Resolves to null, and the body is sent
 * uncompressed, when neither is available.
 */
export async function compressCaptureBody(payload: string, codec: CaptureCodec): Promise<Uint8Array | null> {
  if (webCompressor.supports(codec)) {
    return webCompressor.compress(payload, codec)
  }
  const gzip = OptionalReactNativePlugin?.gzip
  if (codec !== 'gzip' || typeof gzip !== 'function') {
    return null
  }
  const base64 = await gzip(payload)
  return base64 ? base64ToBytes(base64) : null
}
