import { test, expect } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

// Local config not set
// decide comes back - says we shouldn't mask

const remoteMaskingTextSelector = '*'

const startOptions = {
    options: {
        session_recording: {
            compress_events: false,
        },
    },
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
            masking: {
                maskAllInputs: true,
                maskTextSelector: remoteMaskingTextSelector,
            },
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session recording - masking', () => {
    test.beforeEach(async ({ page, context }) => {
        await start(startOptions, page, context)
        // await page.resetCapturedEvents()
    })

    test('masks text', async ({ page }) => {
        await page.locator('[data-cy-input]').type('hello posthog!')

        await expect(page.locator(remoteMaskingTextSelector).first()).toBeVisible()
        // there's nothing to wait for... so, just wait a bit
        await page.waitForTimeout(2500)
        // no new events
        const events = await page.capturedEvents()
        const snapshotEvents = events.filter((e) => e.event === '$snapshot')
        expect(snapshotEvents.length).toBeGreaterThan(0)

        const snapshotsThatIncludeMaskedContent = snapshotEvents.filter((e) => {
            const data = e.properties?.['$snapshot_data']

            const includesMaskedInput = !!data?.find((d) => JSON.stringify(d).includes('hello posthog!'))

            const includesMaskedText = !!data?.find((d) => JSON.stringify(d).includes('just some text'))

            return includesMaskedInput || includesMaskedText
        })

        expect(snapshotsThatIncludeMaskedContent.length).toBe(0)
    })
})
