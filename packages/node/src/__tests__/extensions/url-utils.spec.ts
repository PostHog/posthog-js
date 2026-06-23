import { normalizeRequestCurrentUrl, normalizeRequestPath } from '@/extensions/url-utils'

describe('url-utils', () => {
  describe('normalizeRequestCurrentUrl', () => {
    it('preserves search and hash by default', () => {
      expect(normalizeRequestCurrentUrl('/api/items?token=secret#details', false)).toBe(
        '/api/items?token=secret#details'
      )
    })

    it('preserves search but strips hash when disable_capture_url_hashes is enabled', () => {
      expect(normalizeRequestCurrentUrl('/api/items?token=secret#details', true)).toBe('/api/items?token=secret')
    })

    it('passes through undefined', () => {
      expect(normalizeRequestCurrentUrl(undefined, true)).toBeUndefined()
    })
  })

  describe('normalizeRequestPath', () => {
    it('always strips search and preserves hash by default', () => {
      expect(normalizeRequestPath('/api/items?token=secret#details', false)).toBe('/api/items#details')
    })

    it('always strips search and strips hash when disable_capture_url_hashes is enabled', () => {
      expect(normalizeRequestPath('/api/items?token=secret#details', true)).toBe('/api/items')
    })

    it('does not treat hashes before question marks as search params', () => {
      expect(normalizeRequestPath('/api/items#details?token=secret', false)).toBe('/api/items#details?token=secret')
      expect(normalizeRequestPath('/api/items#details?token=secret', true)).toBe('/api/items')
    })

    it('passes through undefined', () => {
      expect(normalizeRequestPath(undefined, false)).toBeUndefined()
    })
  })
})
