import { test, expect } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

for (const patchTiming of ['none', 'before-start', 'after-start'] as const) {
    test(`records connected additions with connectivity getter patching: ${patchTiming}`, async ({ page, context }) => {
        if (patchTiming === 'before-start') {
            await page.addInitScript(() => {
                // Leave the clean same-origin iframe realm used by rrweb untouched.
                if (window !== window.top) return
                Object.defineProperty(Node.prototype, 'isConnected', {
                    configurable: true,
                    get: () => false,
                })
            })
        }
        await start(
            {
                options: { session_recording: { compress_events: false } },
                flagsResponseOverrides: {
                    sessionRecording: { endpoint: '/ses/', masking: { maskAllInputs: true } },
                    capturePerformance: false,
                },
                url: './playground/cypress/index.html',
            },
            page,
            context
        )
        await waitForSessionRecordingToStart(page)
        const observedConnected = await page.evaluate((patchTiming) => {
            if (patchTiming === 'after-start') {
                Object.defineProperty(Node.prototype, 'isConnected', {
                    configurable: true,
                    get: () => false,
                })
            }
            // Avoid Playwright's own isConnected checks while the page prototype is patched.
            ;(document.querySelector('[data-cy-input]') as HTMLInputElement).click()
            const root = document.createElement('div')
            root.attachShadow({ mode: 'open' }).textContent = 'CONNECTED_INCREMENTAL_MARKER'
            document.body.append(root)
            return root.isConnected
        }, patchTiming)
        expect(observedConnected).toBe(patchTiming === 'none')
        await expect
            .poll(async () =>
                (await page.capturedEvents())
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) => event.properties['$snapshot_data'])
                    .some(
                        (event) =>
                            event.type === 3 &&
                            event.data.source === 0 &&
                            event.data.adds.some((add) => add.node.textContent === 'CONNECTED_INCREMENTAL_MARKER')
                    )
            )
            .toBe(true)
    })
}
