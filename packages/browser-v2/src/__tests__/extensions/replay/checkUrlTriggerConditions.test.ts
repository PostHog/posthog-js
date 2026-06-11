import * as fc from 'fast-check'
import {
    URLTriggerMatching,
    TRIGGER_ACTIVATED,
    TRIGGER_PENDING,
} from '../../../extensions/replay/external/triggerMatching'
import { createMockPostHog } from '../../helpers/posthog-instance'
import { SessionRecordingUrlTrigger } from '../../../types'
import { SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION } from '../../../constants'

describe('checkUrlTriggerConditions - activation loop detection', () => {
    let urlTriggerMatching: URLTriggerMatching
    let mockPostHog: any
    let onPauseCalls: number
    let onResumeCalls: number
    let onActivateCalls: number
    let persistedSession: string | null

    const setWindowLocation = (url: string) => {
        Object.defineProperty(window, 'location', {
            value: { href: url },
            writable: true,
            configurable: true,
        })
    }

    const configureTriggers = (
        triggers: SessionRecordingUrlTrigger[],
        blocklist: SessionRecordingUrlTrigger[] = []
    ) => {
        urlTriggerMatching.onConfig({
            urlTriggers: triggers,
            urlBlocklist: blocklist,
        } as any)
    }

    const createActivateCallback = (sessionId: string) => () => {
        onActivateCalls++
        if (onActivateCalls === 1) {
            persistedSession = sessionId
        }
    }

    const checkTriggers = (sessionId: string, onActivate = createActivateCallback(sessionId)) => {
        urlTriggerMatching.checkUrlTriggerConditions(
            () => onPauseCalls++,
            () => onResumeCalls++,
            onActivate,
            sessionId
        )
    }

    const assertPendingToActivated = (sessionId: string) => {
        expect(urlTriggerMatching.triggerStatus(sessionId)).toBe(TRIGGER_PENDING)
        checkTriggers(sessionId)
        expect(urlTriggerMatching.triggerStatus(sessionId)).toBe(TRIGGER_ACTIVATED)
    }

    const assertStaysActivated = (sessionId: string) => {
        const beforeStatus = urlTriggerMatching.triggerStatus(sessionId)
        checkTriggers(sessionId)
        const afterStatus = urlTriggerMatching.triggerStatus(sessionId)
        expect(beforeStatus).toBe(TRIGGER_ACTIVATED)
        expect(afterStatus).toBe(TRIGGER_ACTIVATED)
    }

    beforeEach(() => {
        onPauseCalls = 0
        onResumeCalls = 0
        onActivateCalls = 0
        persistedSession = null

        mockPostHog = createMockPostHog({
            register_for_session: jest.fn(),
            get_property: jest.fn((key: string) => {
                if (key === SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION) {
                    return persistedSession
                }
                return undefined
            }),
        })

        urlTriggerMatching = new URLTriggerMatching(mockPostHog)
        // Reset URL tracking state for each test
        ;(urlTriggerMatching as any)._lastCheckedUrl = ''
    })

    describe('property-based tests for activation loop', () => {
        it('onActivate called once regardless of number of checks', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        urlPath: fc.stringOf(
                            fc.char().filter((c) => /[a-z]/.test(c)),
                            {
                                minLength: 1,
                                maxLength: 10,
                            }
                        ),
                        numberOfCalls: fc.integer({ min: 2, max: 100 }),
                    }),
                    ({ urlPath, numberOfCalls }) => {
                        onPauseCalls = 0
                        onResumeCalls = 0
                        onActivateCalls = 0
                        persistedSession = null
                        // Reset URL tracking state for each property test run
                        ;(urlTriggerMatching as any)._lastCheckedUrl = ''

                        const url = `https://example.com/${urlPath}`
                        configureTriggers([{ url, matching: 'regex' }])
                        setWindowLocation(url)

                        const sessionId = 'test-session'

                        for (let i = 0; i < numberOfCalls; i++) {
                            const beforeStatus = urlTriggerMatching.triggerStatus(sessionId)
                            checkTriggers(sessionId)
                            const afterStatus = urlTriggerMatching.triggerStatus(sessionId)

                            const isFirstCall = i === 0
                            const expectedBeforeStatus = isFirstCall ? TRIGGER_PENDING : TRIGGER_ACTIVATED
                            const expectedAfterStatus = TRIGGER_ACTIVATED

                            if (beforeStatus !== expectedBeforeStatus) return false
                            if (afterStatus !== expectedAfterStatus) return false
                        }

                        return onActivateCalls === 1
                    }
                ),
                { numRuns: 100, verbose: true }
            )
        })

        it('onActivate called at most once with URL triggers and blocklists', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        triggerUrls: fc.array(
                            fc.record({
                                url: fc
                                    .stringOf(
                                        fc.char().filter((c) => /[a-z]/.test(c)),
                                        {
                                            minLength: 3,
                                            maxLength: 8,
                                        }
                                    )
                                    .map((s) => `https://${s}.com/.*`),
                                matching: fc.constant('regex' as const),
                            }),
                            { minLength: 1, maxLength: 5 }
                        ),
                        blocklistUrls: fc.array(
                            fc.record({
                                url: fc
                                    .stringOf(
                                        fc.char().filter((c) => /[a-z]/.test(c)),
                                        {
                                            minLength: 3,
                                            maxLength: 8,
                                        }
                                    )
                                    .map((s) => `https://blocked${s}.com/.*`),
                                matching: fc.constant('regex' as const),
                            }),
                            { maxLength: 3 }
                        ),
                        currentUrl: fc
                            .tuple(
                                fc.stringOf(
                                    fc.char().filter((c) => /[a-z]/.test(c)),
                                    {
                                        minLength: 3,
                                        maxLength: 8,
                                    }
                                ),
                                fc.stringOf(
                                    fc.char().filter((c) => /[a-z]/.test(c)),
                                    { maxLength: 8 }
                                )
                            )
                            .map(([domain, path]) => `https://${domain}.com/${path}`),
                        callCount: fc.integer({ min: 2, max: 50 }),
                    }),
                    ({ triggerUrls, blocklistUrls, currentUrl, callCount }) => {
                        onPauseCalls = 0
                        onResumeCalls = 0
                        onActivateCalls = 0
                        persistedSession = null
                        urlTriggerMatching.urlBlocked = false
                        // Reset URL tracking state for each property test run
                        ;(urlTriggerMatching as any)._lastCheckedUrl = ''

                        configureTriggers(triggerUrls, blocklistUrls)
                        setWindowLocation(currentUrl)

                        const sessionId = 'session-' + currentUrl

                        const urlMatchesTrigger = triggerUrls.some((t) => new RegExp(t.url).test(currentUrl))
                        const urlMatchesBlocklist = blocklistUrls.some((b) => new RegExp(b.url).test(currentUrl))

                        for (let i = 0; i < callCount; i++) {
                            urlTriggerMatching.checkUrlTriggerConditions(
                                () => {
                                    onPauseCalls++
                                    urlTriggerMatching.urlBlocked = true
                                },
                                () => {
                                    onResumeCalls++
                                    urlTriggerMatching.urlBlocked = false
                                },
                                createActivateCallback(sessionId),
                                sessionId
                            )
                        }

                        if (urlMatchesTrigger && !urlMatchesBlocklist) {
                            return onActivateCalls === 1
                        } else if (urlMatchesBlocklist) {
                            return onPauseCalls >= 1
                        }
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('URL transitions between blocked and unblocked states', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        blockedUrl: fc.constant('https://blocked.com/page'),
                        unblockedUrl: fc.constant('https://example.com/page'),
                        transitions: fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
                    }),
                    ({ blockedUrl, unblockedUrl, transitions }) => {
                        onPauseCalls = 0
                        onResumeCalls = 0
                        onActivateCalls = 0
                        urlTriggerMatching.urlBlocked = false

                        configureTriggers([{ url: '.*', matching: 'regex' }], [{ url: blockedUrl, matching: 'regex' }])

                        const sessionId = 'test-session-transitions'

                        for (const shouldBlock of transitions) {
                            const url = shouldBlock ? blockedUrl : unblockedUrl
                            setWindowLocation(url)

                            // Reset lastCheckedUrl to force the check (simulating actual URL changes)
                            ;(urlTriggerMatching as any)._lastCheckedUrl = ''

                            urlTriggerMatching.checkUrlTriggerConditions(
                                () => {
                                    onPauseCalls++
                                    urlTriggerMatching.urlBlocked = true
                                },
                                () => {
                                    onResumeCalls++
                                    urlTriggerMatching.urlBlocked = false
                                },
                                () => {
                                    onActivateCalls++
                                },
                                sessionId
                            )
                        }

                        return onPauseCalls > 0 || onResumeCalls > 0 || onActivateCalls > 0
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('state transitions', () => {
        it.each([
            [3, 'few'],
            [10, 'multiple'],
            [1000, 'many'],
        ])('transitions PENDING to ACTIVATED after first of %i checks', (callCount) => {
            const url = 'https://example.com/test'
            configureTriggers([{ url, matching: 'regex' }])
            setWindowLocation(url)

            const sessionId = 'test-session'

            assertPendingToActivated(sessionId)

            for (let i = 1; i < callCount; i++) {
                assertStaysActivated(sessionId)
            }

            expect(urlTriggerMatching.triggerStatus(sessionId)).toBe(TRIGGER_ACTIVATED)
            expect(onActivateCalls).toBe(1)
        })

        it('does not call onPause or onResume when URL remains blocked', () => {
            const blockedUrl = 'https://blocked.com/page'

            configureTriggers([], [{ url: blockedUrl, matching: 'regex' }])
            setWindowLocation(blockedUrl)

            urlTriggerMatching.urlBlocked = false

            const sessionId = 'test-session-blocked'

            urlTriggerMatching.checkUrlTriggerConditions(
                () => {
                    onPauseCalls++
                    urlTriggerMatching.urlBlocked = true
                },
                () => onResumeCalls++,
                () => onActivateCalls++,
                sessionId
            )

            expect(onPauseCalls).toBe(1)
            expect(onResumeCalls).toBe(0)

            urlTriggerMatching.checkUrlTriggerConditions(
                () => onPauseCalls++,
                () => onResumeCalls++,
                () => onActivateCalls++,
                sessionId
            )

            expect(onPauseCalls).toBe(1)
            expect(onResumeCalls).toBe(0)
        })
    })

    describe('regex cache', () => {
        it('compiles regex patterns when config is set', () => {
            const triggers: SessionRecordingUrlTrigger[] = [
                { url: 'https://example\\.com/.*', matching: 'regex' },
                { url: 'https://test\\.com/page', matching: 'regex' },
            ]

            configureTriggers(triggers)

            const cache = (urlTriggerMatching as any)._compiledTriggerRegexes as Map<string, RegExp>
            expect(cache.size).toBe(2)
            expect(cache.has('https://example\\.com/.*')).toBe(true)
            expect(cache.has('https://test\\.com/page')).toBe(true)
        })

        it('compiles blocklist regex patterns', () => {
            const blocklist: SessionRecordingUrlTrigger[] = [{ url: 'https://blocked\\.com/.*', matching: 'regex' }]

            configureTriggers([], blocklist)

            const cache = (urlTriggerMatching as any)._compiledBlocklistRegexes as Map<string, RegExp>
            expect(cache.size).toBe(1)
            expect(cache.has('https://blocked\\.com/.*')).toBe(true)
        })

        it('clears and rebuilds cache when config changes', () => {
            configureTriggers([{ url: 'pattern1', matching: 'regex' }])

            let cache = (urlTriggerMatching as any)._compiledTriggerRegexes as Map<string, RegExp>
            expect(cache.size).toBe(1)
            expect(cache.has('pattern1')).toBe(true)

            configureTriggers([
                { url: 'pattern2', matching: 'regex' },
                { url: 'pattern3', matching: 'regex' },
            ])

            cache = (urlTriggerMatching as any)._compiledTriggerRegexes as Map<string, RegExp>
            expect(cache.size).toBe(2)
            expect(cache.has('pattern1')).toBe(false)
            expect(cache.has('pattern2')).toBe(true)
            expect(cache.has('pattern3')).toBe(true)
        })

        it('uses cached regex for matching instead of creating new ones', () => {
            const pattern = 'https://example\\.com/page'
            configureTriggers([{ url: pattern, matching: 'regex' }])

            const cache = (urlTriggerMatching as any)._compiledTriggerRegexes as Map<string, RegExp>
            const cachedRegex = cache.get(pattern)
            expect(cachedRegex).toBeDefined()

            const regexConstructorSpy = jest.spyOn(global, 'RegExp')

            setWindowLocation('https://example.com/page')
            checkTriggers('test-session')

            expect(regexConstructorSpy).not.toHaveBeenCalled()

            regexConstructorSpy.mockRestore()
        })

        it('does not cache duplicate patterns', () => {
            const triggers: SessionRecordingUrlTrigger[] = [
                { url: 'pattern', matching: 'regex' },
                { url: 'pattern', matching: 'regex' },
                { url: 'pattern', matching: 'regex' },
            ]

            configureTriggers(triggers)

            const cache = (urlTriggerMatching as any)._compiledTriggerRegexes as Map<string, RegExp>
            expect(cache.size).toBe(1)
        })

        it('handles invalid regex patterns gracefully', () => {
            const triggers: SessionRecordingUrlTrigger[] = [
                { url: '[invalid(regex', matching: 'regex' },
                { url: 'valid\\.pattern', matching: 'regex' },
            ]

            configureTriggers(triggers)

            const cache = (urlTriggerMatching as any)._compiledTriggerRegexes as Map<string, RegExp>
            expect(cache.has('valid\\.pattern')).toBe(true)
            expect(cache.has('[invalid(regex')).toBe(false)
        })

        it('handles invalid blocklist regex patterns gracefully', () => {
            const blocklist: SessionRecordingUrlTrigger[] = [{ url: '*invalid*', matching: 'regex' }]

            configureTriggers([], blocklist)

            const cache = (urlTriggerMatching as any)._compiledBlocklistRegexes as Map<string, RegExp>
            expect(cache.has('*invalid*')).toBe(false)
        })
    })

    describe('URL change detection optimization', () => {
        beforeEach(() => {
            configureTriggers([{ url: '.*', matching: 'regex' }])
        })

        it('checks trigger conditions on first call for a URL', () => {
            const onActivate = jest.fn()
            setWindowLocation('https://example.com/page1')

            urlTriggerMatching.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'test-session')

            expect(onActivate).toHaveBeenCalledTimes(1)
        })

        it('skips checking when URL has not changed', () => {
            const onActivate = jest.fn()
            const url = 'https://example.com/page1'
            setWindowLocation(url)

            urlTriggerMatching.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'test-session')
            expect(onActivate).toHaveBeenCalledTimes(1)

            urlTriggerMatching.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'test-session')
            expect(onActivate).toHaveBeenCalledTimes(1)
        })

        it('checks again when URL changes', () => {
            const sessionId = 'test-session'

            // First URL
            setWindowLocation('https://example.com/page1')
            urlTriggerMatching.checkUrlTriggerConditions(
                jest.fn(),
                jest.fn(),
                createActivateCallback(sessionId),
                sessionId
            )
            expect(onActivateCalls).toBe(1)

            // Same URL - should skip, so onActivate not called again
            urlTriggerMatching.checkUrlTriggerConditions(
                jest.fn(),
                jest.fn(),
                createActivateCallback(sessionId),
                sessionId
            )
            expect(onActivateCalls).toBe(1)

            // Verify that _lastCheckedUrl was set to page1
            expect((urlTriggerMatching as any)._lastCheckedUrl).toBe('https://example.com/page1')

            // Different URL - should check again and update _lastCheckedUrl
            setWindowLocation('https://example.com/page2')
            urlTriggerMatching.checkUrlTriggerConditions(
                jest.fn(),
                jest.fn(),
                createActivateCallback(sessionId),
                sessionId
            )

            // Verify that _lastCheckedUrl was updated to page2
            expect((urlTriggerMatching as any)._lastCheckedUrl).toBe('https://example.com/page2')

            // onActivate still called only once because same session
            expect(onActivateCalls).toBe(1)
        })

        it('handles rapid same-URL checks efficiently', () => {
            const url = 'https://example.com/page'
            setWindowLocation(url)

            const onPause = jest.fn()
            const onResume = jest.fn()
            const onActivate = jest.fn()

            for (let i = 0; i < 1000; i++) {
                urlTriggerMatching.checkUrlTriggerConditions(onPause, onResume, onActivate, 'test-session')
            }

            expect(onActivate).toHaveBeenCalledTimes(1)
            expect(onPause).toHaveBeenCalledTimes(0)
            expect(onResume).toHaveBeenCalledTimes(0)
        })

        it('resets URL tracking on stop()', () => {
            const onActivate = jest.fn()
            const url = 'https://example.com/page'
            setWindowLocation(url)

            urlTriggerMatching.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'test-session-1')
            expect(onActivate).toHaveBeenCalledTimes(1)

            urlTriggerMatching.stop()

            urlTriggerMatching.checkUrlTriggerConditions(jest.fn(), jest.fn(), onActivate, 'test-session-2')
            expect(onActivate).toHaveBeenCalledTimes(2)
        })

        it('verifies lastCheckedUrl is reset on stop()', () => {
            const url = 'https://example.com/page'
            setWindowLocation(url)

            urlTriggerMatching.checkUrlTriggerConditions(jest.fn(), jest.fn(), jest.fn(), 'test-session')

            const lastCheckedUrl = (urlTriggerMatching as any)._lastCheckedUrl
            expect(lastCheckedUrl).toBe(url)

            urlTriggerMatching.stop()

            const resetUrl = (urlTriggerMatching as any)._lastCheckedUrl
            expect(resetUrl).toBe('')
        })

        it('skips blocklist checks when URL has not changed', () => {
            configureTriggers([], [{ url: 'blocked\\.com', matching: 'regex' }])

            const onPause = jest.fn(() => {
                urlTriggerMatching.urlBlocked = true
            })

            setWindowLocation('https://blocked.com/page')
            urlTriggerMatching.urlBlocked = false

            urlTriggerMatching.checkUrlTriggerConditions(onPause, jest.fn(), jest.fn(), 'test-session')
            expect(onPause).toHaveBeenCalledTimes(1)

            urlTriggerMatching.checkUrlTriggerConditions(onPause, jest.fn(), jest.fn(), 'test-session')
            expect(onPause).toHaveBeenCalledTimes(1)
        })
    })
})
