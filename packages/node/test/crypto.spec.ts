import * as crypto from '../src/extensions/feature-flags/crypto'
import * as cryptoHelpers from '../src/extensions/feature-flags/crypto-helpers'

describe('crypto', () => {
  describe('hashSHA1', () => {
    const testString = 'some-flag.some_distinct_id'
    const expectedHash = 'e4ce124e800a818c63099f95fa085dc2b620e173'

    afterEach(() => {
      jest.restoreAllMocks() // <- Reset all mocks after each test
    })

    it('should hash correctly using Node.js crypto', async () => {
      jest.spyOn(cryptoHelpers, 'getWebCrypto').mockResolvedValue(undefined)

      const hash = await crypto.hashSHA1(testString)
      expect(hash).toBe(expectedHash)
    })

    it('should hash correctly using Web Crypto API', async () => {
      jest.spyOn(cryptoHelpers, 'getNodeCrypto').mockResolvedValue(undefined)

      const hash = await crypto.hashSHA1(testString)
      expect(hash).toBe(expectedHash)
    })

    it('should throw if no crypto implementation is available', async () => {
      jest.spyOn(cryptoHelpers, 'getNodeCrypto').mockResolvedValue(undefined)
      jest.spyOn(cryptoHelpers, 'getWebCrypto').mockResolvedValue(undefined)

      await expect(crypto.hashSHA1(testString)).rejects.toThrow(
        'No crypto implementation available. Tried Node Crypto API and Web SubtleCrypto API'
      )
    })
  })
})
