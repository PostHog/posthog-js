import { URLTriggerMatching } from '../../../extensions/replay/external/triggerMatching'
import { createMockPostHog } from '../../helpers/posthog-instance'
import { SessionRecordingUrlTrigger, PostHogConfig } from '../../../types'

// The browser URL is meaningless for Electron/desktop apps served from a generated host.
// `get_current_url` lets those apps point URL targeting at the logical URL instead.
describe('get_current_url override for replay URL targeting', () => {
    const setWindowLocation = (url: string) => {
        Object.defineProperty(window, 'location', {
            value: { href: url },
            writable: true,
            configurable: true,
        })
    }

    const createMatcher = (getCurrentUrl?: (defaultUrl: string) => string) => {
        const instance = createMockPostHog({
            register_for_session: jest.fn(),
            get_property: jest.fn(() => undefined),
            config: {
                token: 'test-token',
                api_host: 'https://test.com',
                get_current_url: getCurrentUrl,
            } as PostHogConfig,
        })
        return new URLTriggerMatching(instance)
    }

    const configure = (
        matcher: URLTriggerMatching,
        triggers: SessionRecordingUrlTrigger[],
        blocklist: SessionRecordingUrlTrigger[] = []
    ) => {
        matcher.onConfig({ urlTriggers: triggers, urlBlocklist: blocklist } as any)
    }

    it('activates URL trigger against the overridden URL, not window.location.href', () => {
        // browser URL is a generated host that the regex can never match
        setWindowLocation('https://juf2aw2wzzympiaxrjfi57phz3m4ftcr.skin/game/osrs')

        const matcher = createMatcher(() => 'https://app/Jagex Launcher')
        configure(matcher, [{ url: '.*Jagex Launcher.*$', matching: 'regex' }])

        const onActivate = jest.fn()
        matcher.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'session-1')

        expect(onActivate).toHaveBeenCalledTimes(1)
        expect(onActivate).toHaveBeenCalledWith('url', 'https://app/Jagex Launcher')
    })

    it('does not activate when only the raw browser URL matches the trigger', () => {
        setWindowLocation('https://app/Jagex Launcher')

        // override rewrites away from the matching URL
        const matcher = createMatcher(() => 'https://generated-host.skin/game')
        configure(matcher, [{ url: '.*Jagex Launcher.*$', matching: 'regex' }])

        const onActivate = jest.fn()
        matcher.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'session-1')

        expect(onActivate).not.toHaveBeenCalled()
    })

    it('falls back to window.location.href when no override is configured', () => {
        setWindowLocation('https://app/Jagex Launcher')

        const matcher = createMatcher()
        configure(matcher, [{ url: '.*Jagex Launcher.*$', matching: 'regex' }])

        const onActivate = jest.fn()
        matcher.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'session-1')

        expect(onActivate).toHaveBeenCalledTimes(1)
    })

    it('applies the override to the URL blocklist', () => {
        setWindowLocation('https://generated-host.skin/internal-admin')

        const matcher = createMatcher(() => 'https://app/internal-admin')
        configure(matcher, [], [{ url: '.*internal-admin.*$', matching: 'regex' }])

        const onPause = jest.fn(() => {
            matcher.urlBlocked = true
        })
        matcher.checkUrlBlocklist(onPause, jest.fn())

        expect(onPause).toHaveBeenCalledTimes(1)
    })

    it('falls back to window.location.href when the override returns an empty string', () => {
        setWindowLocation('https://app/Jagex Launcher')

        const matcher = createMatcher(() => '')
        configure(matcher, [{ url: '.*Jagex Launcher.*$', matching: 'regex' }])

        const onActivate = jest.fn()
        matcher.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'session-1')

        expect(onActivate).toHaveBeenCalledTimes(1)
        expect(onActivate).toHaveBeenCalledWith('url', 'https://app/Jagex Launcher')
    })

    it('falls back to window.location.href when the override throws', () => {
        setWindowLocation('https://app/Jagex Launcher')

        const matcher = createMatcher(() => {
            throw new Error('boom')
        })
        configure(matcher, [{ url: '.*Jagex Launcher.*$', matching: 'regex' }])

        const onActivate = jest.fn()
        expect(() => matcher.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'session-1')).not.toThrow()
        expect(onActivate).toHaveBeenCalledTimes(1)
    })
})
