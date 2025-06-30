import { RemoteConfig } from '../../src/types'
import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {},
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: 'http://localhost:8082/playground/cypress/index.html',
}

test.describe('Session recording - trigger match types 30% sampling + event trigger', () => {
    const sampleThirtyWithTriggerOptions = {
        ...startOptions,
        flagsResponseOverrides: {
            ...startOptions.flagsResponseOverrides,
            sessionRecording: {
                ...startOptions.flagsResponseOverrides.sessionRecording,
                sampleRate: '0.3',
                eventTriggers: ['example'],
            } satisfies RemoteConfig['sessionRecording'],
        },
    }

    test.describe('ANY match type', () => {
        const anyMatchOptions = {
            ...sampleThirtyWithTriggerOptions,
            flagsResponseOverrides: {
                ...sampleThirtyWithTriggerOptions.flagsResponseOverrides,
                sessionRecording: {
                    ...sampleThirtyWithTriggerOptions.flagsResponseOverrides.sessionRecording,
                    triggerMatchType: 'any',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, context }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await start(anyMatchOptions, page, context)
                },
            })
            await page.expectCapturedEventsToBe(['$pageview'])
            await page.resetCapturedEvents()
        })

        test('starts recording when example event is captured regardless of sampling', async ({ page }) => {
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('example')
            })

            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').fill('hello posthog!')
                },
            })

            const events = await page.capturedEvents()
            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
            expect(events.find((e) => e.event === 'example')).toBeTruthy()
        })
    })

    test.describe('ALL match type', () => {
        const allMatchOptions = {
            ...sampleThirtyWithTriggerOptions,
            flagsResponseOverrides: {
                ...sampleThirtyWithTriggerOptions.flagsResponseOverrides,
                sessionRecording: {
                    ...sampleThirtyWithTriggerOptions.flagsResponseOverrides.sessionRecording,
                    triggerMatchType: 'all',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, context }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await start(allMatchOptions, page, context)
                },
            })
            await page.expectCapturedEventsToBe(['$pageview'])
            await page.resetCapturedEvents()
        })

        test('only starts recording for sampled sessions that see the example event', async ({ page }) => {
            // First, capture the example event
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('example')
            })

            // Try to trigger a recording by interacting
            await page.locator('[data-cy-input]').fill('hello posthog!')

            await page.waitForTimeout(1000)

            // Get all events
            const events = await page.capturedEvents()

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
            ...startOptions.flagsResponseOverrides,
            sessionRecording: {
                ...startOptions.flagsResponseOverrides.sessionRecording,
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

    test.describe('ANY match type', () => {
        const anyMatchOptions = {
            ...sampleZeroWithTriggerOptions,
            flagsResponseOverrides: {
                ...sampleZeroWithTriggerOptions.flagsResponseOverrides,
                sessionRecording: {
                    ...sampleZeroWithTriggerOptions.flagsResponseOverrides.sessionRecording,
                    triggerMatchType: 'any',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, context }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await start(anyMatchOptions, page, context)
                },
            })
            await page.expectCapturedEventsToBe(['$pageview'])
            await page.resetCapturedEvents()
        })

        test('starts recording when example event is captured regardless of other triggers', async ({ page }) => {
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('example')
            })

            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').fill('hello posthog!')
                },
            })

            const events = await page.capturedEvents()
            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
            expect(events.find((e) => e.event === 'example')).toBeTruthy()
        })

        test('starts recording when URL triggers regardless of other triggers', async ({ page }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    // change  the URL without navigating
                    await page.evaluate(() => {
                        window.history.pushState({}, '', '/example-path')
                    })
                    await page.locator('[data-cy-input]').fill('hello posthog!')
                },
            })

            const events = await page.capturedEvents()
            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
        })
    })

    test.describe('ALL match type', () => {
        const allMatchOptions = {
            ...sampleZeroWithTriggerOptions,
            flagsResponseOverrides: {
                ...sampleZeroWithTriggerOptions.flagsResponseOverrides,
                sessionRecording: {
                    ...sampleZeroWithTriggerOptions.flagsResponseOverrides.sessionRecording,
                    triggerMatchType: 'all',
                } satisfies RemoteConfig['sessionRecording'],
            },
        }

        test.beforeEach(async ({ page, context }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await start(allMatchOptions, page, context)
                },
            })
            await page.expectCapturedEventsToBe(['$pageview'])
            await page.resetCapturedEvents()
        })

        test('will not start recording regardless of triggers', async ({ page }) => {
            await page.evaluate(async () => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('example')
                // change  the URL without navigating
                window.history.pushState({}, '', '/example-path')
            })

            await page.locator('[data-cy-input]').fill('hello posthog!')
            await page.waitForTimeout(1000)

            // Get all events
            const events = await page.capturedEvents()

            // Note: We can't deterministically test the 30% sampling here,
            // but we can verify that after a delay there was an event but no snapshot
            const snapshotEvent = events.find((e) => e.event === '$snapshot')
            expect(events.find((e) => e.event === 'example')).toBeTruthy()
            expect(snapshotEvent).toBeFalsy()
        })
    })
})
