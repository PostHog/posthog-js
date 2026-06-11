import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const startOptions = {
    options: {
        sessionRecording: {
            compress_events: false,
        },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/preload-link-leak/index.html',
    runBeforePostHogInit: async (page: import('@playwright/test').Page) => {
        await page.evaluate(() => {
            const w = window as unknown as { __preloadLoadAdds?: number }
            w.__preloadLoadAdds = 0
            const proto = HTMLLinkElement.prototype as unknown as {
                addEventListener: typeof HTMLLinkElement.prototype.addEventListener
            }
            const original = proto.addEventListener
            proto.addEventListener = function (this: HTMLLinkElement, type: string, ...rest: unknown[]) {
                if (type === 'load' && this.getAttribute('rel') === 'preload' && this.getAttribute('as') === 'style') {
                    w.__preloadLoadAdds = (w.__preloadLoadAdds ?? 0) + 1
                }
                return (original as unknown as (...args: unknown[]) => unknown).call(this, type, ...rest)
            } as typeof HTMLLinkElement.prototype.addEventListener
        })
    },
}

test.describe('Session recording does not leak load listeners on preload-as-style <link> elements', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })
        await waitForSessionRecordingToStart(page)
    })

    test('listener count stays bounded across timer cycles and synthetic load events', async ({ page }) => {
        await page.waitForTimeout(6000)

        await page.evaluate(() => {
            document
                .querySelectorAll('link[rel="preload"][as="style"]')
                .forEach((l) => l.dispatchEvent(new Event('load')))
        })

        await page.waitForTimeout(6000)

        const loadAdds = await page.evaluate(() => {
            return (window as unknown as { __preloadLoadAdds?: number }).__preloadLoadAdds ?? 0
        })

        expect(loadAdds).toBe(0)
    })
})
