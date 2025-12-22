import * as fc from 'fast-check'
import {
    URLTriggerMatching,
    TRIGGER_ACTIVATED,
    TRIGGER_PENDING,
} from '../../../extensions/replay/external/triggerMatching'
import { createMockPostHog } from '../../helpers/posthog-instance'
import { SDKPolicyConfigUrlTrigger } from '../../../types'
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

    const configureTriggers = (triggers: SDKPolicyConfigUrlTrigger[], blocklist: SDKPolicyConfigUrlTrigger[] = []) => {
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
})
