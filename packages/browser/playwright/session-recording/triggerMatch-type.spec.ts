import { RemoteConfig } from '../../src/types'
import { expect, StartOptions, test } from '../fixtures'

const startOptions: StartOptions = {
    posthogOptions: {
        session_recording: {},
        autocapture: false,
    },
    flagsOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
}

const url = '/playground/cypress/index.html'

test.describe('Session recording - trigger match types 30% sampling + event trigger', () => {
    test.use({ url })

    const sampleThirtyWithTriggerOptions = {
        ...startOptions,
        flagsOverrides: {
            ...startOptions.flagsOverrides,
            sessionRecording: {
                ...startOptions.flagsOverrides!.sessionRecording,
                sampleRate: '0.3',
                eventTriggers: ['example'],
            } satisfies RemoteConfig['sessionRecording'],
        },
    }

    test.describe('ANY match type', () => {
        const anyMatchOptions = {
            ...sampleThirtyWithTriggerOptions,
            flagsOverrides: {
                ...sampleThirtyWithTriggerOptions.flagsOverrides,
                sessionRecording: {
                    ...sampleThirtyWithTriggerOptions.flagsOverrides.sessionRecording,
                    triggerMatchType: 'any',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, posthog, events, network }) => {
            await network.mockFlags(anyMatchOptions.flagsOverrides)
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await posthog.init(anyMatchOptions.posthogOptions)
                },
            })
            events.expectMatchList(['$pageview'])
            events.clear()
        })

        test('starts recording when example event is captured regardless of sampling', async ({
            page,
            events,
            posthog,
        }) => {
            await posthog.capture('example')

            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
                },
            })

            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
            expect(events.find((e) => e.event === 'example')).toBeTruthy()
        })
    })

    // There is a 30% chance that the test will fail due to the sampling rate.
    // 99% chance of success with 4 retries
    test.describe.configure({ retries: 4 })

    test.describe('ALL match type', () => {
        const allMatchOptions = {
            ...sampleThirtyWithTriggerOptions,
            flagsOverrides: {
                ...sampleThirtyWithTriggerOptions.flagsOverrides,
                sessionRecording: {
                    ...sampleThirtyWithTriggerOptions.flagsOverrides.sessionRecording,
                    triggerMatchType: 'all',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, posthog, events, network }) => {
            await network.mockFlags(allMatchOptions.flagsOverrides)
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await posthog.init(allMatchOptions.posthogOptions)
                },
            })
            await events.waitForEvent('$pageview')
            events.expectMatchList(['$pageview'])
            events.clear()
        })

        test('only starts recording for sampled sessions that see the example event', async ({
            page,
            posthog,
            events,
        }) => {
            // First, capture the example event
            await posthog.capture('example')

            // Try to trigger a recording by interacting
            await page.locator('[data-cy-input]').pressSequentially('hello posthog!')

            await page.waitForTimeout(1000)

            // Note: We can't deterministically test the 30% sampling here,
            // but we can verify that after a delay there was an event but no snapshot
            const snapshotEvent = events.find((e) => e.event === '$snapshot')
            expect(events.find((e) => e.event === 'example')).toBeTruthy()
            expect(snapshotEvent).toBeFalsy()
        })
    })
})

test.describe('Session recording - trigger match types 0% sampling + event trigger + URL trigger', () => {
    const sampleZeroWithTriggerOptions = {
        ...startOptions,
        flagsResponseOverrides: {
            ...startOptions.flagsOverrides,
            sessionRecording: {
                ...startOptions.flagsOverrides!.sessionRecording,
                sampleRate: '0',
                eventTriggers: ['example'],
                urlTriggers: [
                    {
                        url: '/example-path',
                        matching: 'regex',
                    },
                ],
            } satisfies RemoteConfig['sessionRecording'],
        },
    }
    test.use({ url })

    test.describe('ANY match type', () => {
        const anyMatchOptions = {
            ...sampleZeroWithTriggerOptions,
            flagsOverrides: {
                ...sampleZeroWithTriggerOptions.flagsOverrides,
                sessionRecording: {
                    ...sampleZeroWithTriggerOptions.flagsOverrides!.sessionRecording,
                    triggerMatchType: 'any',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, posthog, events, network }) => {
            await network.mockFlags(anyMatchOptions.flagsOverrides)
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await posthog.init(anyMatchOptions.posthogOptions)
                },
            })
            await events.waitForEvent('$pageview')
            events.expectMatchList(['$pageview'])
            events.clear()
        })

        test('starts recording when example event is captured regardless of other triggers', async ({
            page,
            posthog,
            events,
        }) => {
            await posthog.capture('example')

            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
                },
            })

            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
            expect(events.find((e) => e.event === 'example')).toBeTruthy()
        })

        test('starts recording when URL triggers regardless of other triggers', async ({ page, events }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    // change  the URL without navigating
                    await page.evaluate(() => {
                        window.history.pushState({}, '', '/example-path')
                    })
                    await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
                },
            })

            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
        })
    })

    test.describe('ALL match type', () => {
        const allMatchOptions = {
            ...sampleZeroWithTriggerOptions,
            flagsOverrides: {
                ...sampleZeroWithTriggerOptions.flagsOverrides,
                sessionRecording: {
                    ...sampleZeroWithTriggerOptions.flagsOverrides!.sessionRecording,
                    triggerMatchType: 'all',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, posthog, network, events }) => {
            await network.mockFlags(allMatchOptions.flagsOverrides)
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await posthog.init(allMatchOptions.posthogOptions)
                },
            })
            events.expectMatchList(['$pageview'])
            events.clear()
        })

        test('will not start recording regardless of triggers', async ({ page, posthog, events }) => {
            await posthog.evaluate(async (ph) => {
                ph.capture('example')
                // change  the URL without navigating
                window.history.pushState({}, '', '/example-path')
            })

            await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
            await page.waitForTimeout(1000)

            // Note: We can't deterministically test the 30% sampling here,
            // but we can verify that after a delay there was an event but no snapshot
            const snapshotEvent = events.find((e) => e.event === '$snapshot')
            expect(events.find((e) => e.event === 'example')).toBeTruthy()
            expect(snapshotEvent).toBeFalsy()
        })
    })
})
