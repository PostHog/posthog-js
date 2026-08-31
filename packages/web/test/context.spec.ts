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
