import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const IFRAME_ORIGIN = 'https://iframe.example.com'
const SERVER_TIMING_HEADER = 'db;dur=12;desc="database", cache;desc="hit"'
const EXPECTED_SERVER_TIMING = [
    { name: 'db', duration: 12, description: 'database' },
    { name: 'cache', duration: 0, description: 'hit' },
]

const iframePage = `<!doctype html>
<html>
<body>
<script src="https://localhost:1234/static/array.js"></script>
<script>
    posthog.init('test token', {
        api_host: 'https://localhost:1234',
        ip: false,
        opt_out_useragent_filter: true,
        strict_script_versioning: false,
        session_recording: { recordCrossOriginIframes: true },
    })
</script>
</body>
</html>`

// a recorder inside a cross-origin iframe sends its events to the parent with postMessage,
// so browser objects in the network payload would make the structured clone throw
test('records network timings with server timing from a cross-origin iframe', async ({
    page,
    context,
    browserName,
}) => {
    await context.route(`${IFRAME_ORIGIN}/child.html`, (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            headers: { 'Server-Timing': SERVER_TIMING_HEADER },
            body: iframePage,
        })
    )
    await context.route(`${IFRAME_ORIGIN}/api/data`, (route) =>
        route.fulfill({
            status: 200,
            json: { ok: true },
            headers: { 'Server-Timing': SERVER_TIMING_HEADER },
        })
    )

    await start(
        {
            url: '/playground/cypress/index.html',
            options: { session_recording: { compress_events: false, recordCrossOriginIframes: true } },
            flagsResponseOverrides: {
                sessionRecording: {
                    endpoint: '/ses/',
                    networkPayloadCapture: { recordHeaders: true },
                },
                capturePerformance: true,
                autocapture_opt_out: true,
            },
        },
        page,
        context
    )
    await waitForSessionRecordingToStart(page)

    await page.evaluate((src) => {
        const iframe = document.createElement('iframe')
        iframe.src = src
        document.body.appendChild(iframe)
    }, `${IFRAME_ORIGIN}/child.html`)

    const iframe = (await (await page.waitForSelector('iframe')).contentFrame())!
    // fetch is only wrapped once the recorder has started in the iframe
    await iframe.waitForFunction(() => (window as any).posthog?.sessionRecording?.started === true)
    await iframe.evaluate((url) => fetch(url), `${IFRAME_ORIGIN}/api/data`)
    // the parent recorder only flushes snapshots once the session has user activity
    await page.locator('[data-cy-input]').fill('activity')

    const iframeNetworkRequests = async () =>
        (await page.capturedEvents())
            .filter((event) => event.event === '$snapshot')
            .flatMap((event) => event.properties.$snapshot_data)
            .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
            .flatMap((event) => event.data.payload.requests)
            // the parent records its own resource entry for the iframe document, without server timing
            .filter(
                (request) =>
                    request.name === `${IFRAME_ORIGIN}/api/data` ||
                    (request.name === `${IFRAME_ORIGIN}/child.html` && request.entryType === 'navigation')
            )

    const iframeRequestNames = [`${IFRAME_ORIGIN}/api/data`, `${IFRAME_ORIGIN}/child.html`]
    await expect
        .poll(async () => (await iframeNetworkRequests()).map((request) => request.name), { timeout: 10000 })
        .toEqual(expect.arrayContaining(iframeRequestNames))

    const serverTimingInIframe: Record<string, unknown> = await iframe.evaluate(
        (names) =>
            Object.fromEntries(
                names.map((name) => [
                    name,
                    (performance.getEntriesByName(name)[0] as PerformanceResourceTiming).serverTiming.map(
                        ({ name, duration, description }) => ({ name, duration, description })
                    ),
                ])
            ),
        iframeRequestNames
    )
    // Chromium keeps PerformanceServerTiming objects in toJSON(), which is what broke postMessage
    if (browserName === 'chromium') {
        expect(serverTimingInIframe[`${IFRAME_ORIGIN}/child.html`]).toEqual(EXPECTED_SERVER_TIMING)
    }
    for (const request of await iframeNetworkRequests()) {
        expect(request.serverTiming).toEqual(serverTimingInIframe[request.name])
    }
})
