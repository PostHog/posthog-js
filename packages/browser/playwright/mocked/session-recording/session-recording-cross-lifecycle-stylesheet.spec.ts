import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {
            compress_events: false,
            full_snapshot_interval_millis: 1500,
        },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cross-lifecycle-stylesheet/index.html',
}

function findLinkNodeId(events: any[], hrefFragment: string): number | undefined {
    function walk(node: any): number | undefined {
        if (
            node?.tagName === 'link' &&
            ((node.attributes?.href && String(node.attributes.href).includes(hrefFragment)) ||
                node.attributes?._cssText)
        ) {
            return node.id
        }
        for (const c of node?.childNodes ?? []) {
            const id = walk(c)
            if (id !== undefined) return id
        }
        return undefined
    }
    for (const event of events) {
        if (event.event !== '$snapshot') continue
        const snapshotData = (event.properties?.$snapshot_data ?? []) as any[]
        for (const item of snapshotData) {
            const root = item.type === 2 ? item.data?.node : (item.data?.adds ?? []).map((a: any) => a.node)
            if (!root) continue
            const roots = Array.isArray(root) ? root : [root]
            for (const r of roots) {
                const id = walk(r)
                if (id !== undefined) return id
            }
        }
    }
    return undefined
}

function countCssTextDeliveries(events: any[], linkId: number): number {
    let count = 0
    for (const event of events) {
        if (event.event !== '$snapshot') continue
        const snapshotData = (event.properties?.$snapshot_data ?? []) as any[]
        for (const item of snapshotData) {
            if (item.type === 3) {
                const attrs = (item.data?.attributes ?? []) as any[]
                for (const a of attrs) {
                    if (a.id === linkId && a.attributes && '_cssText' in a.attributes) {
                        count += 1
                    }
                }
            }
        }
    }
    return count
}

function countFullSnapshots(events: any[]): number {
    let count = 0
    for (const event of events) {
        if (event.event !== '$snapshot') continue
        const snapshotData = (event.properties?.$snapshot_data ?? []) as any[]
        for (const item of snapshotData) {
            if (item.type === 2) count += 1
        }
    }
    return count
}

test.describe('Session recording handles a pending stylesheet across rrweb checkouts', () => {
    let releaseCss: () => void = () => undefined

    test.beforeEach(async ({ page, context }) => {
        const cssRequested = new Promise<void>((r) => {
            releaseCss = r
        })

        await context.route('**/cross-lifecycle/slow.css', async (route) => {
            await cssRequested
            await route.fulfill({
                status: 200,
                contentType: 'text/css',
                body: '.late { color: rebeccapurple; }',
            })
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })
        await waitForSessionRecordingToStart(page)
    })

    test('aborts previous checkout listeners so the late _cssText arrives exactly once', async ({
        page,
        browserName,
    }) => {
        test.skip(
            browserName !== 'chromium',
            'Firefox and WebKit do not populate link.sheet.cssRules from a Playwright-route-fulfilled CSS response within our wait window. The fix being verified here is JS-internal and browser-agnostic — covered by the jsdom unit tests for non-chromium browsers.'
        )

        await page.evaluate(() => {
            const link = document.createElement('link')
            link.rel = 'stylesheet'
            link.href = '/cross-lifecycle/slow.css'
            document.head.appendChild(link)
        })

        await page.locator('[data-cy-input]').type('hello')
        await page.waitForResponse('**/ses/*')

        await page.waitForTimeout(4000)
        await page.locator('[data-cy-input]').type(' again')
        await page.waitForResponse('**/ses/*')

        await page.waitForTimeout(4000)
        await page.locator('[data-cy-input]').type(' once more')
        await page.waitForResponse('**/ses/*')

        releaseCss()

        await page.locator('[data-cy-input]').type(' final')
        await page.waitForResponse('**/ses/*')

        const events = await page.capturedEvents()

        const linkId = findLinkNodeId(events, 'slow.css')
        expect(linkId).toBeDefined()

        const deliveries = countCssTextDeliveries(events, linkId!)
        const fullSnapshotCount = countFullSnapshots(events)

        expect(fullSnapshotCount).toBeGreaterThanOrEqual(3)

        expect(deliveries).toBe(1)
    })
})
