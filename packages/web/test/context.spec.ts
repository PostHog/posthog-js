import { getContext } from '../src/context'

describe('getContext browser detection', () => {
  function contextFor(userAgent: string, vendor = ''): Record<string, any> {
    const window = {
      navigator: { userAgent, vendor },
      document: { referrer: '' },
      location: { href: 'https://example.com/', host: 'example.com', pathname: '/' },
      screen: { height: 800, width: 400 },
      devicePixelRatio: 2,
    } as unknown as Window
    return getContext(window)
  }

  const facebookAndroidUA =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]'
  const facebookIosUA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/000000000]'
  const instagramAndroidUA =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 309.0.0.0.0 Android'
  const instagramIosUA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 309.0.0.0.0 (iPhone; iOS 17_0; en_US)'
  const chromeAndroidUA =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

  it.each([
    ['Android Facebook', facebookAndroidUA, '', 'Facebook Mobile'],
    ['iOS Facebook', facebookIosUA, 'Apple Computer, Inc.', 'Facebook Mobile'],
    ['Android Instagram', instagramAndroidUA, '', 'Instagram'],
    ['iOS Instagram', instagramIosUA, 'Apple Computer, Inc.', 'Instagram'],
    ['plain Chrome untouched', chromeAndroidUA, '', 'Chrome'],
  ])('detects %s', (_name, userAgent, vendor, expected) => {
    expect(contextFor(userAgent, vendor).$browser).toBe(expected)
  })
})
