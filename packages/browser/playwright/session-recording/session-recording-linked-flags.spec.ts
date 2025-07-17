import { test, PosthogPage, EventsPage, NetworkPage } from '../fixtures'
import { PostHogConfig } from '../../src/types'

const startOptions = {
    posthogOptions: {
        session_recording: {},
        opt_out_capturing_by_default: true,
    },
    flagsOverrides: {
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
    test.use(startOptions)

    const startWithFlags = async (
        posthog: PosthogPage,
        events: EventsPage,
        network: NetworkPage,
        optionsOverrides: Partial<{
            posthogOptions: Partial<PostHogConfig>
            flagsOverrides: any
        }> = {},
        expectedStartingEvents: string[] = ['$pageview']
    ) => {
        await network.mockFlags(optionsOverrides.flagsOverrides)
        const waitForFlags = network.waitForFlags()
        await posthog.init(optionsOverrides.posthogOptions)
        await waitForFlags
        await Promise.all(expectedStartingEvents.map((evt) => events.waitForEvent(evt)))
        events.expectMatchList(expectedStartingEvents)
        events.clear()
    }

    test('does not start when boolean linked flag is false', async ({ page, posthog, events, network }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')
        await startWithFlags(posthog, events, network, {
            posthogOptions: {
                opt_out_capturing_by_default: false,
            },
            flagsOverrides: {
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
        await page.locator('[data-cy-input]').fill('hello posthog!')
        // short delay since there's no snapshot to wait for
        await page.waitForTimeout(250)

        events.expectMatchList([])
    })

    test('starts when boolean linked flag is true', async ({ page, posthog, events, network }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(posthog, events, network, {
            posthogOptions: {
                opt_out_capturing_by_default: false,
            },
            flagsOverrides: {
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

        await page.locator('[data-cy-input]').fill('hello posthog!')
        await events.waitForEvent('$snapshot')
        events.expectRecordingStarted()
    })

    test('starts when multi-variant linked flag is "any"', async ({ page, posthog, events, network }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(posthog, events, network, {
            posthogOptions: {
                opt_out_capturing_by_default: false,
            },
            flagsOverrides: {
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

        await page.locator('[data-cy-input]').fill('hello posthog!')
        await events.waitForEvent('$snapshot')
        events.expectRecordingStarted()
    })

    test('starts when multi-variant linked flag is matching variant', async ({ page, posthog, events, network }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(posthog, events, network, {
            posthogOptions: {
                opt_out_capturing_by_default: false,
            },
            flagsOverrides: {
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

        await page.locator('[data-cy-input]').fill('hello posthog!')
        await events.waitForEvent('$snapshot')
        events.expectRecordingStarted()
    })

    test('does not start when multi-variant linked flag is not matching variant', async ({
        page,
        posthog,
        events,
        network,
    }) => {
        const recorderPromise = page.waitForResponse('**/recorder.js*')

        await startWithFlags(posthog, events, network, {
            posthogOptions: {
                opt_out_capturing_by_default: false,
            },
            flagsOverrides: {
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
        await page.locator('[data-cy-input]').fill('hello posthog!')
        // short delay since there's no snapshot to wait for
        await page.waitForTimeout(250)
        events.expectMatchList([])
    })

    test('can opt in and override linked flag', async ({ page, posthog, events, network }) => {
        await startWithFlags(
            posthog,
            events,
            network,
            {
                posthogOptions: {
                    // we start opted out, so we can test the opt-in and override
                    opt_out_capturing_by_default: true,
                },
                flagsOverrides: {
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
                await posthog.evaluate((ph) => {
                    ph.opt_in_capturing()
                    // starting does not begin recording because of the linked flag
                    ph.startSessionRecording()
                })
            },
        })

        events.expectMatchList(['$opt_in', '$pageview'])
        events.clear()

        await posthog.evaluate((ph) => {
            ph.startSessionRecording({ linked_flag: true })
        })
        await page.locator('[data-cy-input]').fill('hello posthog!')
        await events.waitForEvent('$snapshot')
        events.expectRecordingStarted()
    })
})
