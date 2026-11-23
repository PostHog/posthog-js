import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

test('recovers the failed full snapshot after a same-tab reload', async ({ page, context }) => {
    await page.goto('/')
    test.skip(!(await page.evaluate(() => 'onpageswap' in window)), 'Browser does not signal same-tab reloads')
    const origin = new URL(page.url()).origin
    await page.addInitScript(() => {
        // Mobile browsers can reload without notifying beforeunload listeners.
        window.onbeforeunload = (event) => {
            event.stopImmediatePropagation()
        }
    })

    let documentNumber = 0
    await page.route('**/replay-fixture', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: `<button>document-${++documentNumber}</button><script src="/dist/array.full.js"></script>`,
        })
    )

    let originalUuid: string | undefined
    const recovered: string[] = []
    let sawSecondPage = false
    let unavailable = true
    await page.route('**/replay-upload/**', async (route) => {
        const events = route.request().postDataJSON() as {
            uuid: string
            properties: { $snapshot_data: { type: number; data: unknown }[] }
        }[]
        for (const event of events) {
            for (const snapshot of event.properties.$snapshot_data) {
                if (snapshot.type !== 2) continue
                const dom = JSON.stringify(snapshot.data)
                if (dom.includes('document-1')) {
                    if (unavailable) originalUuid ??= event.uuid
                    else recovered.push(event.uuid)
                }
                if (!unavailable && dom.includes('document-2')) sawSecondPage = true
            }
        }
        await route.fulfill({ status: unavailable ? 503 : 200, json: {} })
    })

    const options = {
        url: origin + '/replay-fixture',
        waitForFlags: false,
        options: {
            api_host: origin,
            before_send: undefined,
            disable_compression: true,
            session_recording: { compress_events: false },
        },
        flagsResponseOverrides: { sessionRecording: { endpoint: '/replay-upload/' } },
    }

    await start(options, page, context)
    await waitForSessionRecordingToStart(page)
    const rejected = page.waitForResponse(
        (response) => response.url().includes('/replay-upload/') && response.status() === 503 && !!originalUuid
    )
    await page.getByRole('button').click()
    await (await rejected).finished()
    await start({ ...options, type: 'reload' }, page, context)
    unavailable = false
    await waitForSessionRecordingToStart(page)
    await page.getByRole('button').click()
    await expect.poll(() => sawSecondPage, { timeout: 15000 }).toBe(true)
    await expect.poll(() => recovered, { timeout: 15000 }).toEqual([originalUuid])
})
