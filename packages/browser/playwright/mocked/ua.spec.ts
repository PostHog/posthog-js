import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

const startOptions = {
    options: {
        session_recording: {},
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: '/playground/cypress-full/index.html',
}

test.describe('User Agent Blocking', () => {
    test('should pick up that our automated playwright tests are indeed bot traffic', async ({ page, context }) => {
        await start(startOptions, page, context)

        const isLikelyBot = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?._is_bot()
        })
        expect(isLikelyBot).toEqual(true)
    })
})
