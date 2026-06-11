import './helpers/mock-logger'

import { PostHog } from '../posthog-core'
import { defaultPostHog } from './helpers/posthog-instance'
import { uuidv7 } from '../uuidv7'
import { PostHogConfig } from '../types'
import { navigator } from '../utils/globals'

describe('bot detection and pageview collection', () => {
    let posthog: PostHog
    let beforeSendMock: jest.Mock
    let originalUserAgent: string

    const createPostHog = async (config: Partial<PostHogConfig> = {}) => {
        beforeSendMock = jest.fn().mockImplementation((e) => e)
        const posthog = await new Promise<PostHog>(
            (resolve) =>
                defaultPostHog().init(
                    'testtoken',
                    {
                        capturePageview: false, // Disable auto-capture to avoid race conditions
                        internalOrTestUserHostname: null, // jsdom hostname (localhost) matches the default pattern
                        beforeSend: beforeSendMock,
                        ...config,
                        loaded: (posthog) => resolve(posthog),
                    },
                    uuidv7()
                )!
        )
        posthog.debug()
        return posthog
    }

    beforeEach(async () => {
        // Store original user agent
        originalUserAgent = navigator!.userAgent
    })

    afterEach(() => {
        // Restore original user agent
        Object.defineProperty(navigator, 'userAgent', {
            value: originalUserAgent,
            configurable: true,
        })
        Object.defineProperty(navigator, 'webdriver', {
            value: undefined,
            configurable: true,
        })
    })

    const setBotUserAgent = (botUA: string) => {
        Object.defineProperty(navigator, 'userAgent', {
            value: botUA,
            configurable: true,
        })
    }

    const setWebdriver = (value: boolean) => {
        Object.defineProperty(navigator, 'webdriver', {
            value: value,
            configurable: true,
        })
    }

    describe('default behavior', () => {
        it('should drop pageview events from bots', async () => {
            setBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
            posthog = await createPostHog()

            posthog.capture('$pageview')

            expect(beforeSendMock).not.toHaveBeenCalled()
        })

        it('should drop all events from bots, not just pageviews', async () => {
            setBotUserAgent('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')
            posthog = await createPostHog()

            posthog.capture('custom_event')

            expect(beforeSendMock).not.toHaveBeenCalled()
        })

        it('should drop events from webdriver-detected bots', async () => {
            setWebdriver(true)
            posthog = await createPostHog()

            posthog.capture('$pageview')

            expect(beforeSendMock).not.toHaveBeenCalled()
        })

        it('should allow events from normal browsers', async () => {
            setBotUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
            posthog = await createPostHog()

            posthog.capture('$pageview')

            expect(beforeSendMock).toHaveBeenCalled()
            expect(beforeSendMock.mock.calls[0][0].event).toBe('$pageview')
            const properties = beforeSendMock.mock.calls[0][0].properties
            expect(properties.$browser_type).toBeUndefined()
        })
    })

    describe('with optOutUseragentFilter enabled', () => {
        it('should allow all events from bots when optOutUseragentFilter is true', async () => {
            setBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
            posthog = await createPostHog({ optOutUseragentFilter: true })

            posthog.capture('$pageview')

            expect(beforeSendMock).toHaveBeenCalled()
            expect(beforeSendMock.mock.calls[0][0].event).toBe('$pageview')
        })

        it('should add $browser_type property when optOutUseragentFilter is true', async () => {
            setBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')
            posthog = await createPostHog({ optOutUseragentFilter: true })

            posthog.capture('$pageview')

            expect(beforeSendMock).toHaveBeenCalled()
            const properties = beforeSendMock.mock.calls[0][0].properties
            expect(properties.$browser_type).toBe('bot')
        })

        it('should set $browser_type to "browser" for non-bots when optOutUseragentFilter is true', async () => {
            setBotUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
            posthog = await createPostHog({ optOutUseragentFilter: true })

            posthog.capture('$pageview')

            expect(beforeSendMock).toHaveBeenCalled()
            const properties = beforeSendMock.mock.calls[0][0].properties
            expect(properties.$browser_type).toBe('browser')
        })
    })

    describe('edge cases', () => {
        it('should handle missing navigator gracefully', async () => {
            const originalNav = (global as any).navigator
            ;(global as any).navigator = undefined

            posthog = await createPostHog()

            posthog.capture('$pageview')

            expect(beforeSendMock).toHaveBeenCalled()
            expect(beforeSendMock.mock.calls[0][0].event).toBe('$pageview')
            ;(global as any).navigator = originalNav
        })

        it('should drop events from custom blocked user agents', async () => {
            setBotUserAgent('MyCustomBot/1.0')
            posthog = await createPostHog({
                customBlockedUseragents: ['MyCustomBot'],
            })

            posthog.capture('$pageview')

            expect(beforeSendMock).not.toHaveBeenCalled()
        })
    })
})
