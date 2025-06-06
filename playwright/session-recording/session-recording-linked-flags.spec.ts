import { test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, StartOptions } from '../utils/setup'
import { assertThatRecordingStarted, pollUntilEventCaptured } from '../utils/event-capture-utils'
import { BrowserContext, Page } from '@playwright/test'

const startOptions: StartOptions = {
    options: {
        session_recording: {},
        opt_out_capturing_by_default: true,
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
            // a flag which doesn't exist can never be recorded
            linkedFlag: 'i am a flag that does not exist',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session recording - linked flags', () => {
    const startWithFlags = async (
        page: Page,
        context: BrowserContext,
        startOptionsOverrides: Partial<StartOptions> = {},
        expectedStartingEvents: string[] = ['$pageview']
    ) => {
        await start(
            {
                ...startOptions,
                ...startOptionsOverrides,
                flagsResponseOverrides: {
                    ...startOptions.flagsResponseOverrides,
                    ...startOptionsOverrides.flagsResponseOverrides,
                },
            },
            page,
            context
        )
        await page.expectCapturedEventsToBe(expectedStartingEvents)
        await page.resetCapturedEvents()
    }

    test('does not start when boolean linked flag is false', async ({ page, context }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')
        await startWithFlags(page, context, {
            options: {
                opt_out_capturing_by_default: false,
            },
            flagsResponseOverrides: {
                sessionRecording: { linkedFlag: 'my-linked-flag' },
                flags: {
                    'my-linked-flag': {
                        enabled: false,
                        key: 'my-linked-flag',
                        variant: undefined,
                        metadata: undefined,
                        reason: undefined,
                    },
                },
            },
        })
        await recorderPromise

        // even activity won't trigger a snapshot, we're buffering
        await page.locator('[data-cy-input]').type('hello posthog!')
        // short delay since there's no snapshot to wait for
        await page.waitForTimeout(250)

        await page.expectCapturedEventsToBe([])
    })

    test('starts when boolean linked flag is true', async ({ page, context }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(page, context, {
            options: {
                opt_out_capturing_by_default: false,
            },
            flagsResponseOverrides: {
                sessionRecording: { linkedFlag: 'my-linked-flag' },
                flags: {
                    'my-linked-flag': {
                        enabled: true,
                        key: 'my-linked-flag',
                        variant: undefined,
                        metadata: undefined,
                        reason: undefined,
                    },
                },
            },
        })

        await recorderPromise

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('starts when multi-variant linked flag is "any"', async ({ page, context }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(page, context, {
            options: {
                opt_out_capturing_by_default: false,
            },
            flagsResponseOverrides: {
                sessionRecording: { linkedFlag: 'replay-filtering-conversion' },
                flags: {
                    'replay-filtering-conversion': {
                        key: 'replay-filtering-conversion',
                        enabled: true,
                        variant: 'templates-heatmap',
                        reason: {
                            code: 'condition_match',
                            condition_index: 0,
                            description: 'Matched condition set 1',
                        },
                        metadata: {
                            id: 129,
                            version: 2,
                            description: undefined,
                            payload: null,
                        },
                    },
                },
            },
        })

        await recorderPromise

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('starts when multi-variant linked flag is matching variant', async ({ page, context }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(page, context, {
            options: {
                opt_out_capturing_by_default: false,
            },
            flagsResponseOverrides: {
                sessionRecording: {
                    linkedFlag: {
                        flag: 'replay-filtering-conversion',
                        variant: 'templates-heatmap',
                    },
                },
                flags: {
                    'replay-filtering-conversion': {
                        key: 'replay-filtering-conversion',
                        enabled: true,
                        variant: 'templates-heatmap',
                        reason: {
                            code: 'condition_match',
                            condition_index: 0,
                            description: 'Matched condition set 1',
                        },
                        metadata: {
                            id: 129,
                            version: 2,
                            description: undefined,
                            payload: null,
                        },
                    },
                },
            },
        })

        await recorderPromise

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('does not start when multi-variant linked flag is not matching variant', async ({ page, context }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(page, context, {
            options: {
                opt_out_capturing_by_default: false,
            },
            flagsResponseOverrides: {
                sessionRecording: {
                    linkedFlag: {
                        flag: 'replay-filtering-conversion',
                        variant: 'not-the-variant-at-all',
                    },
                },
                flags: {
                    'replay-filtering-conversion': {
                        key: 'replay-filtering-conversion',
                        enabled: true,
                        variant: 'templates-heatmap',
                        reason: {
                            code: 'condition_match',
                            condition_index: 0,
                            description: 'Matched condition set 1',
                        },
                        metadata: {
                            id: 129,
                            version: 2,
                            description: undefined,
                            payload: null,
                        },
                    },
                },
            },
        })

        await recorderPromise

        // even activity won't trigger a snapshot, we're buffering
        await page.locator('[data-cy-input]').type('hello posthog!')
        // short delay since there's no snapshot to wait for
        await page.waitForTimeout(250)

        await page.expectCapturedEventsToBe([])
    })

    test('can opt in and override linked flag', async ({ page, context }) => {
        await startWithFlags(
            page,
            context,
            {
                options: {
                    // we start opted out, so we can test the opt-in and override
                    opt_out_capturing_by_default: true,
                },
                flagsResponseOverrides: {
                    sessionRecording: { linkedFlag: 'my-linked-flag' },
                    flags: {
                        'not-my-linked-flag': {
                            enabled: true,
                            key: 'not-my-linked-flag',
                            variant: undefined,
                            metadata: undefined,
                            reason: undefined,
                        },
                    },
                },
            },
            []
        )

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                    // starting does not begin recording because of the linked flag
                    ph?.startSessionRecording()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ linked_flag: true })
        })
        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })
})
