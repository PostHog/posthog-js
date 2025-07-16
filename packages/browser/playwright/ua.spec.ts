import { expect, test } from './fixtures'

test.describe('User Agent Blocking', () => {
    test.use({
        flagsOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
            },
            capturePerformance: true,
        },
        posthogOptions: {
            session_recording: {},
        },
        url: '/playground/cypress-full/index.html',
    })

    test('should pick up that our automated playwright tests are indeed bot traffic', async ({ posthog }) => {
        await posthog.init()

        // _is_bot is not defined when posthog is not loaded
        await posthog.waitForLoaded()

        const isLikelyBot = await posthog.evaluate((ph) => {
            return ph._is_bot()
        })
        expect(isLikelyBot).toEqual(true)
    })
})
