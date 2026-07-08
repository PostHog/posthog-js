import { Page } from '@playwright/test'

import { expect, test } from './utils/posthog-playwright-test-base'

/**
 * The fixture page loads the canonical snippet (snippet/snippet.js) and queues
 * a capture before array.full.js has executed, exactly like a real site on a
 * slow connection. These tests cover the unload fallback end-to-end: the
 * beacon fires while array.js is still loading, and the queued call is never
 * double-processed once array.js arrives.
 */

const FIXTURE_URL = '/playground/snippet-fallback/index.html'

type CapturePost = { url: string; events: any[] }

const decodeCaptureBody = (body: string): any[] => {
    try {
        const decoded = body.startsWith('data=')
            ? JSON.parse(Buffer.from(decodeURIComponent(body.slice('data='.length)), 'base64').toString('utf8'))
            : JSON.parse(body)
        return Array.isArray(decoded) ? decoded : [decoded]
    } catch {
        return []
    }
}

const recordCapturePosts = (page: Page): CapturePost[] => {
    const posts: CapturePost[] = []
    page.on('request', (request) => {
        if (request.method() !== 'POST' || !request.url().includes('/e/')) {
            return
        }
        // sendBeacon bodies are only exposed via postDataBuffer in Chromium
        const body = request.postData() ?? request.postDataBuffer()?.toString('utf8')
        if (body) {
            posts.push({ url: request.url(), events: decodeCaptureBody(body) })
        }
    })
    return posts
}

const eventCount = (posts: CapturePost[], eventName: string): number =>
    posts.flatMap((post) => post.events).filter((e) => e.event === eventName).length

const dispatchPagehide = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('pagehide')))

test.describe('snippet unload fallback', () => {
    test.beforeEach(({ browserName }) => {
        test.skip(
            browserName !== 'chromium',
            'sendBeacon requests are only reliably interceptable in Chromium. The fallback logic itself is browser-agnostic and covered across storage/consent scenarios by the jsdom unit tests (src/__tests__/snippet-fallback.test.ts).'
        )
    })

    test('beacons queued captures when the page unloads before array.js loads, and never double-processes them', async ({
        page,
        context,
    }) => {
        let releaseArrayJs: () => void = () => undefined
        const arrayJsGate = new Promise<void>((resolve) => {
            releaseArrayJs = resolve
        })
        // registered after the auto-mock fixture's route, so it wins and can hold
        // array.full.js back until the test releases it
        await context.route(/^.*\/static\/array\.full\.js(\?.*)?$/, async (route) => {
            await arrayJsGate
            await route.fulfill({ path: './dist/array.full.js' })
        })

        const posts = recordCapturePosts(page)
        // the gated async script would hold back the load event, so only wait for DOM
        await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' })

        const beaconRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/e/'))
        await dispatchPagehide(page)
        await beaconRequest

        await expect.poll(() => posts.length).toBe(1)
        expect(posts[0].url).toBe('https://localhost:1234/e/?compression=base64')
        expect(posts[0].events).toHaveLength(1)
        expect(posts[0].events[0]).toMatchObject({
            event: 'early-event',
            properties: {
                early: 'yes',
                token: 'test_token',
                $lib: 'web-snippet',
                $sent_by_snippet_fallback_on_unload: true,
                $process_person_profile: false,
            },
        })
        expect(typeof posts[0].events[0].properties.distinct_id).toBe('string')

        // the sent capture was spliced out of the stub queue
        const queuedCaptureCount = await page.evaluate(
            () => (window as any).posthog.filter((item: any) => item && item[0] === 'capture').length
        )
        expect(queuedCaptureCount).toBe(0)

        // let array.js arrive late - its drain must not re-send the beaconed capture
        releaseArrayJs()
        await page.waitForFunction(() => (window as any).posthog?.__loaded === true)

        await page.evaluate(() => (window as any).posthog.capture('after-load'))
        await dispatchPagehide(page)

        await expect.poll(() => eventCount(posts, 'after-load')).toBe(1)
        expect(eventCount(posts, 'early-event')).toBe(1)
    })

    test('hands delivery over to the SDK once array.js has loaded, whose beacon flushes are tagged', async ({
        page,
    }) => {
        const posts = recordCapturePosts(page)
        await page.goto(FIXTURE_URL)
        await page.waitForFunction(() => (window as any).posthog?.__loaded === true)

        await dispatchPagehide(page)

        await expect.poll(() => eventCount(posts, 'early-event')).toBe(1)
        const earlyEvents = posts.flatMap((post) => post.events).filter((e) => e.event === 'early-event')
        // delivered by the SDK's own unload flush, not the snippet fallback
        expect(earlyEvents[0].properties.$sent_by_snippet_fallback_on_unload).toBeUndefined()
        expect(earlyEvents[0].properties.$sent_send_beacon).toBe(true)
        expect(earlyEvents[0].properties.$lib).toBe('web')
    })
})
