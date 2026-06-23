import { normalizeRequestCurrentUrl, normalizeRequestPath } from '@/extensions/url-utils'

describe('url-utils', () => {
  describe('normalizeRequestCurrentUrl', () => {
    it.each([
      {
        name: 'preserves search and hash by default',
        input: '/api/items?token=secret#details',
        disableCaptureUrlHashes: false,
        expected: '/api/items?token=secret#details',
      },
      {
        name: 'preserves search but strips hash when disable_capture_url_hashes is enabled',
        input: '/api/items?token=secret#details',
        disableCaptureUrlHashes: true,
        expected: '/api/items?token=secret',
      },
      {
        name: 'passes through undefined when hash stripping is disabled',
        input: undefined,
        disableCaptureUrlHashes: false,
        expected: undefined,
      },
      {
        name: 'passes through undefined when hash stripping is enabled',
        input: undefined,
        disableCaptureUrlHashes: true,
        expected: undefined,
      },
    ])('$name', ({ input, disableCaptureUrlHashes, expected }) => {
      expect(normalizeRequestCurrentUrl(input, disableCaptureUrlHashes)).toBe(expected)
    })
  })

  describe('normalizeRequestPath', () => {
    it.each([
      {
        name: 'always strips search and preserves hash by default',
        input: '/api/items?token=secret#details',
        disableCaptureUrlHashes: false,
        expected: '/api/items#details',
      },
      {
        name: 'always strips search and strips hash when disable_capture_url_hashes is enabled',
        input: '/api/items?token=secret#details',
        disableCaptureUrlHashes: true,
        expected: '/api/items',
      },
      {
        name: 'does not treat hashes before question marks as search params by default',
        input: '/api/items#details?token=secret',
        disableCaptureUrlHashes: false,
        expected: '/api/items#details?token=secret',
      },
      {
        name: 'strips hash before question marks when disable_capture_url_hashes is enabled',
        input: '/api/items#details?token=secret',
        disableCaptureUrlHashes: true,
        expected: '/api/items',
      },
      {
        name: 'passes through undefined when hash stripping is disabled',
        input: undefined,
        disableCaptureUrlHashes: false,
        expected: undefined,
      },
      {
        name: 'passes through undefined when hash stripping is enabled',
        input: undefined,
        disableCaptureUrlHashes: true,
        expected: undefined,
      },
    ])('$name', ({ input, disableCaptureUrlHashes, expected }) => {
      expect(normalizeRequestPath(input, disableCaptureUrlHashes)).toBe(expected)
    })
  })
})
