import { test, expect, PosthogPage, EventsPage, NetworkPage } from '../fixtures'
import { Page } from '@playwright/test'
import { CaptureResult } from '../../src/types'

// Local config not set
// flags comes back - says we shouldn't mask

const remoteMaskingTextSelector = '*'

async function startWith(posthog: PosthogPage, network: NetworkPage, masking: Record<string, any>) {
    await network.mockFlags({
        sessionRecording: {
            endpoint: '/ses/',
            masking,
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    })
    const flagsPromise = network.waitForFlags()
    await posthog.init()
    await flagsPromise
}

async function interactWithThePage(page: Page, events: EventsPage) {
    await page.locator('[data-cy-input]').fill('hello posthog!')

    await expect(page.locator(remoteMaskingTextSelector).first()).toBeVisible()
    // there's nothing to wait for... so, just wait a bit
    await page.waitForTimeout(2500)
    // no new events
    const snapshotEvents = events.filter((e) => e.event === '$snapshot')
    expect(snapshotEvents.length).toBeGreaterThan(0)
    return snapshotEvents
}

function assertTheConfigIsAsExpected(snapshotEvents: CaptureResult[], expectedMasking: Record<string, any>) {
    // first we can check that remote config is received and used as expected
    const allRRWebSnapshots = snapshotEvents.flatMap((e) => e.properties['$snapshot_data'])
    const customSnapshots = allRRWebSnapshots.filter((s) => s.type === 5)

    const remoteConfigReceived = customSnapshots.filter((s) => s.data.tag === '$remote_config_received')[0].data.payload
    const sessionOptions = customSnapshots.filter((s) => s.data.tag === '$session_options')[0].data.payload

    expect(remoteConfigReceived.sessionRecording.masking.maskAllInputs).toBe(expectedMasking.maskAllInputs)
    expect(remoteConfigReceived.sessionRecording.masking.maskTextSelector).toBe(expectedMasking.maskTextSelector)

    expect(sessionOptions.sessionRecordingOptions.maskAllInputs).toBe(expectedMasking.maskAllInputs)
    expect(sessionOptions.sessionRecordingOptions.maskTextSelector).toBe(expectedMasking.maskTextSelector)
}

test.describe('Session recording - masking', () => {
    test.use({
        url: './playground/cypress/index.html',
        posthogOptions: {
            session_recording: {
                compress_events: false,
            },
        },
    })

    test('masks text', async ({ page, posthog, events, network }) => {
        await startWith(posthog, network, {
            maskAllInputs: true,
            maskTextSelector: remoteMaskingTextSelector,
        })

        const snapshotEvents = await interactWithThePage(page, events)

        assertTheConfigIsAsExpected(snapshotEvents, {
            maskAllInputs: true,
            maskTextSelector: remoteMaskingTextSelector,
        })

        const snapshotData = snapshotEvents.map((e: any) => JSON.stringify(e.properties?.['$snapshot_data']))

        const snapshotsThatIncludeMaskedContent = snapshotData.filter((data: any) => {
            const includesMaskedInput = !!data?.includes('hello posthog!')

            const includesMaskedText = !!data?.includes('just some text')

            return includesMaskedInput || includesMaskedText
        })

        expect(snapshotsThatIncludeMaskedContent.length).toBe(0)
    })

    test('unmasks inputs', async ({ page, posthog, events, network }) => {
        await startWith(posthog, network, {
            maskAllInputs: false,
            maskTextSelector: remoteMaskingTextSelector,
        })

        const snapshotEvents = await interactWithThePage(page, events)

        assertTheConfigIsAsExpected(snapshotEvents, {
            maskAllInputs: false,
            maskTextSelector: remoteMaskingTextSelector,
        })

        const snapshotData = snapshotEvents.map((e: any) => JSON.stringify(e.properties?.['$snapshot_data']))

        const snapshotsThatIncludeMaskedContent = snapshotData.filter((data: any) => {
            const includesMaskedInput = !!data?.includes('hello posthog!')
            const includesMaskedText = !!data?.includes('just some text')
            return includesMaskedInput || includesMaskedText
        })

        expect(snapshotsThatIncludeMaskedContent.length).toBe(1)
    })
})
