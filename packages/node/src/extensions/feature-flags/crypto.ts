/// <reference lib="dom" />

import { getNodeCrypto, getWebCrypto } from './crypto-helpers'

export async function hashSHA1(text: string): Promise<string> {
  // Try Node.js crypto first
  const nodeCrypto = await getNodeCrypto()
  if (nodeCrypto) {
    return nodeCrypto.createHash('sha1').update(text).digest('hex')
  }

  const webCrypto = await getWebCrypto()

  // Fall back to Web Crypto API
  if (webCrypto) {
    const hashBuffer = await webCrypto.digest('SHA-1', new TextEncoder().encode(text))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  throw new Error('No crypto implementation available. Tried Node Crypto API and Web SubtleCrypto API')
}
