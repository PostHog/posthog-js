import { expect, test } from './utils/posthog-playwright-test-base'
import { gotoPage } from './utils/setup'

test.describe('SSR hydration compatibility', () => {
    test('does not cause hydration errors when scripts are loaded', async ({ page, context }) => {
        await context.route('**/flags/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    featureFlags: {},
                    featureFlagPayloads: {},
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                }),
            })
        })

        await context.route('**/static/recorder.js*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: 'console.log("recorder loaded"); window.__PosthogExtensions__ = window.__PosthogExtensions__ || {}; window.__PosthogExtensions__.rrweb = {};',
            })
        })

        await gotoPage(page, '/playground/hydration/index.html')
        await page.waitForFunction(() => (window as any).testComplete === true, { timeout: 10000 })

        const domMutated = await page.evaluate(() => (window as any).domMutated)
        const newScriptsAdded = await page.evaluate(() => (window as any).newScriptsAdded)
        const hydrationErrors: string[] = await page.evaluate(() => (window as any).hydrationErrors)

        expect(newScriptsAdded).toBe(true)
        expect(domMutated).toBe(false)
        expect(hydrationErrors).toEqual([])
    })

    test('appends scripts to head, leaving body untouched for SSR hydration', async ({ page, context }) => {
        await context.route('**/flags/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    featureFlags: {},
                    featureFlagPayloads: {},
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                }),
            })
        })

        await context.route('**/static/recorder.js*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: `
                    console.log("recorder loaded");
                    window.__PosthogExtensions__ = window.__PosthogExtensions__ || {};
                    window.__PosthogExtensions__.rrweb = {};
                    window.__PosthogExtensions__.rrwebPlugins = { getRecordConsolePlugin: function() { return {}; } };
                `,
            })
        })

        await gotoPage(page, '/playground/hydration/index.html')
        await page.waitForFunction(() => (window as any).testComplete === true, { timeout: 10000 })

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
