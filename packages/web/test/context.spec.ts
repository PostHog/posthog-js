import { getContext } from '../src/context'

const windowWithUserAgent = (userAgent: string): Window =>
  ({
    navigator: { userAgent, vendor: '' },
    document: { referrer: '' },
    location: { href: 'https://example.com/', host: 'example.com', pathname: '/' },
    screen: { height: 900, width: 1440 },
    devicePixelRatio: 2,
  }) as Window

describe('getContext', () => {
  const chromeUA =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36'

  test.each([
    ['LinkedInApp/2.295.106', 'LinkedIn', '2.295.106'],
    ['musical_ly_2022803040 app_version/28.3.4', 'TikTok', '28.3.4'],
    ['WA4A/2.26.30.97', 'WhatsApp', '2.26.30.97'],
    ['[FBAN/Orca-Android;FBAV/440.0.0;]', 'Messenger', '440.0.0'],
  ])('adds host app and full app version without replacing the browser: %s', (marker, app, version) => {
    expect(getContext(windowWithUserAgent(chromeUA + ' ' + marker))).toEqual(
      expect.objectContaining({
        $browser: 'Chrome',
        $browser_version: 120,
        $webview_app: app,
        $webview_app_version: version,
      })
    )
  })

  test('omits an unknown app version rather than using the browser version', () => {
    const context = getContext(windowWithUserAgent(chromeUA + ' [LinkedInApp]'))
    expect(context.$webview_app).toBe('LinkedIn')
    expect(context).not.toHaveProperty('$webview_app_version')
  })

  test.each([chromeUA, chromeUA.replace('; wv', ''), ''])('omits unknown app properties for %s', (ua) => {
    const context = getContext(windowWithUserAgent(ua))
    expect(context).not.toHaveProperty('$webview_app')
    expect(context).not.toHaveProperty('$webview_app_version')
  })

  test('does not require a browser environment', () => {
    const context = getContext(undefined)
    expect(context).not.toHaveProperty('$webview_app')
    expect(context).not.toHaveProperty('$webview_app_version')
  })

  test.each([
    {
      name: 'Claude desktop browser',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.2.3 Chrome/140.0.0.0 Safari/537.36',
      expectedBrowser: 'Claude',
      expectedVersion: 1.2,
    },
    {
      name: 'Codex desktop browser',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Codex/2.3.4 Chrome/140.0.0.0 Safari/537.36',
      expectedBrowser: 'Codex',
      expectedVersion: 2.3,
    },
    {
      name: 'ChatGPT desktop browser',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/537.36 (KHTML, like Gecko) ChatGPT/3.4.5 Chrome/140.0.0.0 Safari/537.36',
      expectedBrowser: 'ChatGPT',
      expectedVersion: 3.4,
    },
    {
      // detected by the shared @posthog/core detector; the old local detector reported Chrome
      name: 'Vivaldi',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Vivaldi/6.8.3381.48',
      expectedBrowser: 'Vivaldi',
      expectedVersion: 6.8,
    },
  ])('detects $name', ({ userAgent, expectedBrowser, expectedVersion }) => {
    expect(getContext(windowWithUserAgent(userAgent), false)).toEqual(
      expect.objectContaining({
        $browser: expectedBrowser,
        $browser_version: expectedVersion,
      })
    )
  })
})
