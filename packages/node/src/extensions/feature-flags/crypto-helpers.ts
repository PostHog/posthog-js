/// <reference lib="dom" />
import { Lazy } from './lazy'

const nodeCrypto = new Lazy(async () => {
  try {
    return await import('crypto')
  } catch {
    return undefined
  }
})

export async function getNodeCrypto(): Promise<typeof import('crypto') | undefined> {
  return await nodeCrypto.getValue()
}

const webCrypto = new Lazy(async (): Promise<SubtleCrypto | undefined> => {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    return globalThis.crypto.subtle
  }

  try {
    // Node.js: use built-in webcrypto and assign it if needed
    const crypto = await nodeCrypto.getValue()
    if (crypto?.webcrypto?.subtle) {
      return crypto.webcrypto.subtle as SubtleCrypto
    }
  } catch {
    // Ignore if not available
  }

  return undefined
})

export async function getWebCrypto(): Promise<SubtleCrypto | undefined> {
  return await webCrypto.getValue()
}
