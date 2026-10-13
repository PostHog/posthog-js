import { expect, test } from './utils/posthog-playwright-test-base'
import { gotoPage } from './utils/setup'
import { Page } from '@playwright/test'

async function deferHydration(page: Page) {
    await page.addInitScript(() => {
        // oxlint-disable-next-line posthog-js/no-add-event-listener -- Serialized browser code cannot import the SDK helper.
        document.addEventListener(
            'load',
            (event) => {
                if (
                    event.target instanceof HTMLScriptElement &&
                    /\/(?:lazy-)?recorder\.js(?:\?|$)/.test(event.target.src)
                ) {
                    ;(window as any).__auditRecorderLoaded = true
                }
            },
            true
        )
    })
    await page.route(/\/array\/[^/]+\/config\.js(\?|$)/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' })
    )
    await page.route('**/playground/hydration/index.html', async (route) => {
        const response = await route.fetch()
        const html = await response.text()
        expect(html).toContain('window.performHydration();')
        await route.fulfill({
            response,
            body: html.replace('window.performHydration();', 'window.__hydrateAfterSdkLoad = window.performHydration;'),
        })
    })
}

async function hydrateAfterSdkScript(page: Page) {
    await page.waitForFunction(() => (window as any).__auditRecorderLoaded === true, undefined, { timeout: 10000 })
    await expect(page.locator('head > script[src*="recorder"]')).not.toHaveCount(0)
    expect(await page.locator('body > script[src*="recorder"]').count()).toBe(0)
    await page.evaluate(() => {
        const win = window as any
        const root = document.getElementById('root')!
        win.__beforeHydrationMarkup = root.innerHTML
        win.__hydrateAfterSdkLoad()
        win.__afterHydrationMarkup = root.innerHTML
    })
    await page.waitForFunction(() => (window as any).testComplete === true, undefined, { timeout: 10000 })
    expect(await page.evaluate(() => (window as any).__afterHydrationMarkup)).toBe(
        await page.evaluate(() => (window as any).__beforeHydrationMarkup)
    )
}

const configResponse = {
    featureFlags: {},
    featureFlagPayloads: {},
    sessionRecording: {
        endpoint: '/ses/',
    },
}

test.describe('SSR hydration compatibility', () => {
    test('does not cause hydration errors when scripts are loaded', async ({ page, context }) => {
        await context.route(/\/array\/[^/]+\/config(\?|$)/, (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(configResponse),
            })
        })

        await context.route('**/flags/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(configResponse),
            })
        })

        await context.route(/\/static\/(?:[^/]+\/)?(?:lazy-)?recorder\.js(?:\?|$)/, (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                path: route.request().url().includes('/lazy-recorder.js')
                    ? './dist/lazy-recorder.js'
                    : './dist/recorder.js',
            })
        )

        await deferHydration(page)
        await gotoPage(page, '/playground/hydration/index.html')
        await hydrateAfterSdkScript(page)

        const domMutated = await page.evaluate(() => (window as any).domMutated)
        const newScriptsAdded = await page.evaluate(() => (window as any).__auditRecorderLoaded)
        const hydrationErrors: string[] = await page.evaluate(() => (window as any).hydrationErrors)

        expect(newScriptsAdded).toBe(true)
        expect(domMutated).toBe(false)
        expect(hydrationErrors).toEqual([])
    })

    test('appends scripts to head, leaving body untouched for SSR hydration', async ({ page, context }) => {
        await context.route(/\/array\/[^/]+\/config(\?|$)/, (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(configResponse),
            })
        })

        await context.route('**/flags/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(configResponse),
            })
        })

        await context.route(/\/static\/(?:[^/]+\/)?(?:lazy-)?recorder\.js(?:\?|$)/, (route) => {
            return route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                path: route.request().url().includes('/lazy-recorder.js')
                    ? './dist/lazy-recorder.js'
                    : './dist/recorder.js',
            })
        })

        await deferHydration(page)
        await gotoPage(page, '/playground/hydration/index.html')
        await hydrateAfterSdkScript(page)

        const bodyScripts = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('body > script')) as HTMLScriptElement[]
            return scripts.map((s) => ({
                id: s.id || null,
                src: s.src || null,
                isPosthogScript: s.src?.includes('posthog') || s.src?.includes('recorder') || false,
            }))
        })

        const headScripts = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('head > script')) as HTMLScriptElement[]
            return scripts.map((s) => ({
                src: s.src || null,
                isPosthogScript: s.src?.includes('posthog') || s.src?.includes('recorder') || false,
            }))
        })

        const posthogScriptsInBody = bodyScripts.filter((s) => s.isPosthogScript)
        const posthogScriptsInHead = headScripts.filter((s) => s.isPosthogScript)

        expect(posthogScriptsInBody).toEqual([])
        expect(posthogScriptsInHead.length).toBeGreaterThan(0)
    })
})
