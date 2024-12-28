import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {},
    },
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session recording - sampling', () => {
    const sampleZeroStartOptions = {
        ...startOptions,
        decideResponseOverrides: {
            ...startOptions.decideResponseOverrides,
            sessionRecording: {
                ...startOptions.decideResponseOverrides.sessionRecording,
                sampleRate: '0',
            },
        },
    }
    test.beforeEach(async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.waitForResponse('**/recorder.js*')
        const capturedEvents = await page.evaluate(() => (window as WindowWithPostHog).capturedEvents || [])
        expect(capturedEvents.map((x) => x.event)).toEqual(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('does not capture events when sampling is set to 0', async ({ page }) => {
        await page.locator('[data-cy-input]').fill('hello posthog!')
        // because it doesn't make sense to wait for a snapshot event that won't happen
        await page.waitForTimeout(250)

        const capturedEvents = await page.capturedEvents()
        expect(capturedEvents).toEqual([])
    })

    test('can override sampling when starting session recording', async ({ page, context }) => {
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ sampling: true })
            ph?.capture('test_registered_property')
        })
        const capturedEvents = await page.capturedEvents()
        expect(capturedEvents.map((x) => x.event)).toEqual(['test_registered_property'])
        expect(capturedEvents[0]['properties']['$session_recording_start_reason']).toEqual('sampling_overridden')

        // sampling override survives a page refresh
        await page.resetCapturedEvents()
        await page.reload()

        await start(
            {
                ...sampleZeroStartOptions,
                type: 'reload',
            },
            page,
            context
        )
        await page.waitForResponse('**/recorder.js*')
        const responsePromise = page.waitForResponse('**/ses/*')
        await page.locator('[data-cy-input]').fill('hello posthog!')
        await responsePromise

        const afterReloadCapturedEvents = await page.capturedEvents()
        const lastCaptured = afterReloadCapturedEvents[afterReloadCapturedEvents.length - 1]
        expect(lastCaptured['event']).toEqual('$snapshot')
    })
})
