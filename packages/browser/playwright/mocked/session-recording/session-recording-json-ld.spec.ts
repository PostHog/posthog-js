import { decompressSync, strFromU8 } from 'fflate'
import { test, expect } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { CaptureResult } from '@/types'
import type { AssignableWindow } from '@/utils/globals'

const options = {
    api_host: 'https://localhost:1234',
    persistence: 'localStorage' as const,
    request_batching: false,
    session_recording: { captureJsonLd: true },
}
const remoteConfig = { sessionRecording: { endpoint: '/ses/' } }

test('sends initial JSON-LD with its full snapshot, including a cached start with delayed config', async ({
    page,
    context,
}) => {
    const requests: CaptureResult[][] = []
    await context.route('**/ses/**', async (route) => {
        const bytes = new Uint8Array(route.request().postDataBuffer()!)
        const body = JSON.parse(strFromU8(bytes[0] === 0x1f ? decompressSync(bytes) : bytes))
        requests.push(Array.isArray(body) ? body : [body])
        await route.fulfill({ status: 200, body: '1' })
    })
    await page.addInitScript(() => {
        // oxlint-disable-next-line posthog-js/no-add-event-listener
        document.addEventListener('DOMContentLoaded', () => {
            const product = document.createElement('div')
            product.id = 'product'
            document.body.append(product)
            for (const type of ['Product', 'WebPage']) {
                const script = document.createElement('script')
                script.type = 'application/ld+json'
                script.textContent = JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': type,
                    '@id': '#product',
                })
                document.head.append(script)
            }
        })
    })

    await start({ options, flagsResponseOverrides: remoteConfig, url: '/playground/cypress/index.html' }, page, context)
    for (const cachedStart of [false, true]) {
        let releaseConfig = () => {}
        if (cachedStart) {
            await start(
                {
                    url: '/playground/cypress/index.html',
                    initPosthog: false,
                    waitForFlags: false,
                    flagsResponseOverrides: remoteConfig,
                },
                page,
                context
            )
            requests.length = 0
            const configGate = new Promise<void>((resolve) => {
                releaseConfig = resolve
            })
            let requestedConfig = false
            await context.route(/\/array\/[^/]+\/config(\?|$)/, async (route) => {
                requestedConfig = true
                await configGate
                await route.fulfill({ json: remoteConfig })
            })
            await page.evaluate((config) => (window as AssignableWindow).posthog!.init('test token', config), options)
            await expect.poll(() => requestedConfig).toBe(true)
            releaseConfig()
        }
        await waitForSessionRecordingToStart(page)
        await page.locator('[data-cy-input]').fill(cachedStart ? 'cached start' : 'fresh start')
        const envelopes = () => requests.flat().filter((event) => event.event === '$snapshot')
        const jsonLdEvents = () =>
            envelopes()
                .flatMap((event) => event.properties.$snapshot_data)
                .filter((event) => event.type === 5 && event.data.tag === '$json_ld')
        await expect.poll(() => jsonLdEvents().length).toBe(2)
        for (const jsonLd of jsonLdEvents()) {
            const envelope = envelopes().find((event) => event.properties.$snapshot_data.includes(jsonLd))!
            expect(envelope.properties.$snapshot_data).toContainEqual(
                expect.objectContaining({ type: 2, timestamp: jsonLd.timestamp })
            )
            expect(jsonLd.data.href).toBe(page.url())
            expect(jsonLd.data.payload['@id']).toBe('product')
        }
        await page.evaluate(() => (window as AssignableWindow).__PosthogExtensions__!.rrweb!.record.takeFullSnapshot())
        await expect
            .poll(
                () =>
                    envelopes()
                        .flatMap((event) => event.properties.$snapshot_data)
                        .filter((event) => event.type === 2).length
            )
            .toBeGreaterThan(1)
        expect(jsonLdEvents()).toHaveLength(2)
        await page.evaluate(() => {
            window.history.pushState({}, '', '/catalog/updated')
            document.querySelector('script[type="application/ld+json"]')!.textContent = JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: 'Updated product',
            })
            ;(window as AssignableWindow).__PosthogExtensions__!.rrweb!.record.takeFullSnapshot()
        })
        await expect.poll(() => jsonLdEvents().length).toBe(3)
        const updated = jsonLdEvents()[2]
        const updatedEnvelope = envelopes().find((event) => event.properties.$snapshot_data.includes(updated))!
        expect(updatedEnvelope.properties.$snapshot_data).toContainEqual(
            expect.objectContaining({ type: 2, timestamp: updated.timestamp })
        )
        expect(updated.data.href).toBe(page.url())
        expect(updated.data.payload.name).toBe('Updated product')
    }
})
