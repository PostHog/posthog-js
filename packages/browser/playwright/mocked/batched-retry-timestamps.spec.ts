import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

// This regression exercises the updated core, not old-core/lazy-extension compatibility.
test.use({ staticOverrides: {} })

for (const transport of ['fetch', 'XHR'] as const) {
    test(`preserves batched event timestamps after a lost ${transport} response`, async ({ page, context }) => {
        const bodies: {
            batch: { uuid: string; timestamp: string; offset?: number; properties: { target: string } }[]
            sent_at: string
        }[] = []
        const urls: string[] = []
        await context.route('**/e/**', async (route) => {
            bodies.push(route.request().postDataJSON())
            urls.push(route.request().url())
            if (bodies.length === 1) {
                await route.abort('failed')
            } else {
                await route.fulfill({ status: 200, json: { status: 1 } })
            }
        })

        const captureTime = new Date('2026-01-31T23:59:50.000Z')
        await page.clock.install({ time: new Date(captureTime.getTime() - 60_000) })
        await start(
            {
                options: {
                    capture_pageview: false,
                    capture_pageleave: false,
                    request_batching: true,
                    disable_compression: true,
                    disable_session_recording: true,
                    api_transport: transport,
                },
            },
            page,
            context
        )
        await page.clock.pauseAt(captureTime)
        await page.evaluate(() => {
            window.posthog.capture('first click', { target: 'alpha' })
            window.posthog.capture('second click', { target: 'beta' })
        })
        const retryQueued = page.waitForEvent('console', (message) =>
            message.text().includes('Enqueued failed request for retry')
        )
        await page.clock.runFor(3000)
        await retryQueued
        expect(bodies).toHaveLength(1)

        const successfulRetry = page.waitForResponse((response) => response.url().includes('retry_count=1'))
        await page.clock.setSystemTime(new Date('2026-02-01T08:00:00.000Z'))
        await page.clock.runFor(6000)
        await (await successfulRetry).finished()
        expect(bodies).toHaveLength(2)

        expect(bodies[0].batch).toHaveLength(2)
        expect(bodies[0].batch[0].uuid).not.toBe(bodies[0].batch[1].uuid)
        expect(bodies[1].batch).toEqual(bodies[0].batch)
        expect(bodies[0].batch.map((event) => event.properties.target)).toEqual(['alpha', 'beta'])
        for (const body of bodies) {
            for (const event of body.batch) {
                expect(event.timestamp).toBe(captureTime.toISOString())
                expect(event).not.toHaveProperty('offset')
            }
        }
        expect(Date.parse(bodies[1].sent_at) - Date.parse(bodies[0].sent_at)).toBeGreaterThan(8 * 60 * 60 * 1000)
        expect(urls[0]).not.toContain('retry_count')
        expect(urls[1]).toContain('retry_count=1')
    })
}
