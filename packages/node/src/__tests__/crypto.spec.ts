import * as crypto from '@/extensions/feature-flags/crypto'

describe('crypto', () => {
  describe('hashSHA1', () => {
    const testString = 'some-flag.some_distinct_id'
    const expectedHash = 'e4ce124e800a818c63099f95fa085dc2b620e173'

    it('should hash correctly', async () => {
      const hash = await crypto.hashSHA1(testString)
      expect(hash).toBe(expectedHash)
    })
  })
})
