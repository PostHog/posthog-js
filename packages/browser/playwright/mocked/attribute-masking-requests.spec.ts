import { Page, Request } from '@playwright/test'
import { isArray, isUndefined } from '@posthog/core'
import { writeFile } from 'node:fs/promises'
import { decompressSync, strFromU8 } from 'fflate'
import { test, expect, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from './utils/setup'

type WireRequest = { url: string; body: string; events: any[] }

// Read the actual transport body, not before_send or recorder callbacks.
function decodeRequest(request: Request): WireRequest {
    const bytes = request.postDataBuffer()
    if (!bytes) throw new Error(`SETUP: browser did not expose POST body for ${request.url()}`)
    let body =
        bytes[0] === 0x1f && bytes[1] === 0x8b ? strFromU8(decompressSync(new Uint8Array(bytes))) : bytes.toString()
    if (body.startsWith('data=')) {
        body = Buffer.from(new URLSearchParams(body).get('data')!, 'base64').toString()
    }
    const payload = JSON.parse(body)
    return { url: request.url(), body, events: payload.batch ?? (isArray(payload) ? payload : [payload]) }
}

async function mutate(page: Page, phase: string, add = false) {
    await page.evaluate(
        ({ phase, add }) => {
            let target = document.getElementById('target')!
            if (add) {
                target = target.cloneNode(true) as HTMLElement
                target.id = 'added'
                document.body.append(target)
            }
            target.textContent = `PUBLIC_TEXT_${phase}`
            target.setAttribute('data-private', `SECRET_DATA_${phase}`)
            target.setAttribute('title', `SECRET_TITLE_${phase}`)
            target.setAttribute('aria-label', `SECRET_ARIA_${phase}`)
            if (target.hasAttribute('href')) target.setAttribute('href', `https://example.test/SECRET_HREF_${phase}`)
            if (target.hasAttribute('class')) target.setAttribute('class', `SECRET_CLASS_${phase}`)
        },
        { phase, add }
    )
    await page.locator(add ? '#added' : '#target').click()
}

for (const chainOnly of [false, true]) {
    for (const scenario of [
        { name: 'unmasked passing control', mode: 'none', href: true, classes: true },
        { name: 'selective ordinary attributes', mode: 'selective', href: false, classes: false },
        { name: 'selective href attribute', mode: 'selective', href: true, classes: false },
        { name: 'selective class attribute', mode: 'selective', href: false, classes: true },
        { name: 'all attributes masked with text unmasked', mode: 'all', href: true, classes: true },
    ] as const) {
        test(`${scenario.name}, chainOnly=${chainOnly}: emitted requests across mutations and consent`, async ({
            page,
            context,
        }, testInfo) => {
            test.setTimeout(90_000)
            const requests: WireRequest[] = []
            const decodeErrors: string[] = []
            page.on('request', (request) => {
                if (request.method() === 'POST' && /\/(e|ses)\//.test(new URL(request.url()).pathname)) {
                    try {
                        requests.push(decodeRequest(request))
                    } catch (error) {
                        decodeErrors.push(String(error))
                    }
                }
            })
            const events = () => requests.flatMap((request) => request.events)
            const snapshots = () =>
                events()
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) => event.properties.$snapshot_data)
            const autocaptures = () => events().filter((event) => event.event === '$autocapture')
            const markerKinds = [
                'DATA',
                'TITLE',
                'ARIA',
                ...(scenario.href ? ['HREF'] : []),
                ...(scenario.classes ? ['CLASS'] : []),
            ]
            const results: object[] = []
            const phases = ['INITIAL', 'MUTATED', 'ADDED', 'REOPTED', 'AFTER_REOPT']
            const checkPhase = async (phase: string, snapshotType?: number) => {
                // Positive assertions are hard failures: absence of capture must never count as privacy success.
                await expect.poll(() => decodeErrors, { message: 'SETUP: request bodies must decode' }).toEqual([])
                await expect
                    .poll(
                        () =>
                            JSON.stringify(
                                snapshots().filter((event) => isUndefined(snapshotType) || event.type === snapshotType)
                            ),
                        {
                            timeout: 15_000,
                        }
                    )
                    .toContain(`PUBLIC_TEXT_${phase}`)
                await expect
                    .poll(() => JSON.stringify(autocaptures()), { timeout: 10_000 })
                    .toContain(`PUBLIC_TEXT_${phase}`)
                if (chainOnly) {
                    expect(autocaptures().every((event) => !('$elements' in event.properties))).toBe(true)
                    expect(autocaptures().every((event) => typeof event.properties.$elements_chain === 'string')).toBe(
                        true
                    )
                } else {
                    expect(autocaptures().every((event) => isArray(event.properties.$elements))).toBe(true)
                }
                if (scenario.href) {
                    expect(autocaptures().at(-1)!.properties.$external_click_url).toBe(
                        scenario.mode === 'none' ? `https://example.test/SECRET_HREF_${phase}` : undefined
                    )
                }
                const replayBody = JSON.stringify(events().filter((event) => event.event === '$snapshot'))
                const captureBody = JSON.stringify(autocaptures())
                const replayLeaks = markerKinds.filter((kind) => replayBody.includes(`SECRET_${kind}_${phase}`))
                const autocaptureLeaks = markerKinds.filter((kind) => captureBody.includes(`SECRET_${kind}_${phase}`))
                results.push({ phase, replayLeaks, autocaptureLeaks, requestCount: requests.length })
                if (scenario.mode === 'none') {
                    expect(replayLeaks, `control replay ${phase}`).toEqual(markerKinds)
                    expect(autocaptureLeaks, `control autocapture ${phase}`).toEqual(markerKinds)
                } else {
                    expect.soft(replayLeaks, `replay sensitive attributes ${phase}`).toEqual([])
                    expect.soft(autocaptureLeaks, `autocapture sensitive attributes ${phase}`).toEqual([])
                    if (scenario.mode === 'selective') {
                        expect(replayBody).toContain('[REDACTED]')
                        expect(replayBody).toContain('PUBLIC_ATTRIBUTE')
                        expect(captureBody).toContain('PUBLIC_ATTRIBUTE')
                    }
                }
            }
            try {
                const tag = scenario.href ? 'a' : 'button'
                await context.route('**/attribute-masking.html', (route) =>
                    route.fulfill({
                        contentType: 'text/html',
                        body: `<!doctype html><html><head><title>Attribute masking</title></head><body><${tag} id="target" data-public="PUBLIC_ATTRIBUTE" data-private="SECRET_DATA_INITIAL" title="SECRET_TITLE_INITIAL" aria-label="SECRET_ARIA_INITIAL" ${scenario.href ? 'href="https://example.test/SECRET_HREF_INITIAL"' : ''} ${scenario.classes ? 'class="SECRET_CLASS_INITIAL"' : ''}>PUBLIC_TEXT_INITIAL</${tag}><script src="/dist/array.js"></script></body></html>`,
                    })
                )
                await start(
                    {
                        url: '/attribute-masking.html',
                        initPosthog: false,
                        waitForFlags: false,
                        flagsResponseOverrides: {
                            sessionRecording: { endpoint: '/ses/' },
                            autocapture_opt_out: false,
                            elementsChainAsString: chainOnly,
                        },
                    },
                    page,
                    context
                )
                await page.evaluate(({ mode }) => {
                    // Prevent link navigation without preventing the real document autocapture listener.
                    // This callback runs in the browser and cannot access imported SDK helpers.
                    // oxlint-disable-next-line posthog-js/no-add-event-listener
                    document.addEventListener('click', (event) => event.preventDefault())
                    const selected = ['data-private', 'title', 'aria-label', 'href', 'class']
                    ;(window as WindowWithPostHog).posthog!.init('attribute-masking-test', {
                        api_host: location.origin,
                        opt_out_useragent_filter: true,
                        capture_pageview: false,
                        capture_pageleave: false,
                        request_batching: false,
                        disable_surveys: true,
                        enable_recording_console_log: false,
                        mask_all_text: false,
                        mask_all_element_attributes: mode === 'all',
                        autocapture: { element_attribute_ignorelist: mode === 'selective' ? selected : [] },
                        session_recording: {
                            compress_events: false,
                            maskTextSelector: null,
                            maskAllElementAttributes: mode === 'all',
                            maskAttributeFn:
                                mode === 'selective'
                                    ? (name, value) => (selected.includes(name) ? '[REDACTED]' : value)
                                    : undefined,
                        },
                    })
                }, scenario)
                await waitForSessionRecordingToStart(page)
                await page.locator('#target').click()
                await checkPhase('INITIAL', 2)
                await mutate(page, 'MUTATED')
                await checkPhase('MUTATED', 3)
                await mutate(page, 'ADDED', true)
                await checkPhase('ADDED', 3)

                await page.evaluate(() => (window as WindowWithPostHog).posthog!.opt_out_capturing())
                expect(
                    await page.evaluate(() => (window as WindowWithPostHog).posthog!.has_opted_out_capturing())
                ).toBe(true)
                let lastRequestCount = requests.length
                let quietSince = Date.now()
                await expect
                    .poll(
                        () => {
                            if (requests.length !== lastRequestCount) {
                                lastRequestCount = requests.length
                                quietSince = Date.now()
                            }
                            return Date.now() - quietSince
                        },
                        { message: 'transport settles before opted-out activity', timeout: 5000, intervals: [100] }
                    )
                    .toBeGreaterThanOrEqual(500)
                const countBeforeOptedOutActivity = requests.length
                await mutate(page, 'OPTED_OUT')
                const optedOutWindowStarted = Date.now()
                // Cover the recorder's 2s buffer flush; equality alone would pass immediately.
                await expect
                    .poll(
                        () =>
                            requests.length !== countBeforeOptedOutActivity ||
                            Date.now() - optedOutWindowStarted >= 2500,
                        { timeout: 5000, intervals: [100] }
                    )
                    .toBe(true)
                expect(requests.length, 'no emitted requests during opted-out activity').toBe(
                    countBeforeOptedOutActivity
                )
                expect(JSON.stringify(requests)).not.toContain('PUBLIC_TEXT_OPTED_OUT')
                results.push({ phase: 'OPTED_OUT', noRequests: true })
                // Replace transient opted-out content before opting in; remaining DOM is capturable after consent.
                await mutate(page, 'REOPTED')
                await page.evaluate(() => (window as WindowWithPostHog).posthog!.opt_in_capturing())
                await waitForSessionRecordingToStart(page)
                await page.locator('#target').click()
                // Consent need not create a new full snapshot; assert whichever recorder event is actually emitted.
                await checkPhase('REOPTED')
                await mutate(page, 'AFTER_REOPT')
                await checkPhase('AFTER_REOPT', 3)
                expect(JSON.stringify(requests)).not.toContain('SECRET_DATA_OPTED_OUT')
                expect(
                    JSON.stringify(requests),
                    'transient opted-out DOM must not be emitted after opting back in'
                ).not.toContain('PUBLIC_TEXT_OPTED_OUT')
                expect(decodeErrors, 'all request bodies decoded').toEqual([])
                if (scenario.mode !== 'none') {
                    const wireBody = requests.map((request) => request.body).join('\n')
                    const emittedSecrets = phases.flatMap((phase) =>
                        markerKinds
                            .map((kind) => `SECRET_${kind}_${phase}`)
                            .filter((marker) => wireBody.includes(marker))
                    )
                    expect
                        .soft(emittedSecrets, 'no sensitive values anywhere in serialized e/ or ses/ bodies')
                        .toEqual([])
                }
            } finally {
                const evidencePath = testInfo.outputPath('emitted-requests.json')
                await writeFile(
                    evidencePath,
                    JSON.stringify({ scenario, chainOnly, results, decodeErrors, requests }, null, 2)
                )
                await testInfo.attach('emitted-requests.json', { path: evidencePath, contentType: 'application/json' })
            }
        })
    }
}
