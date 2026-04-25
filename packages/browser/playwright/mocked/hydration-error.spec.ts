import { expect, test } from './utils/posthog-playwright-test-base'
import { gotoPage } from './utils/setup'

const configResponse = {
    featureFlags: {},
    featureFlagPayloads: {},
    sessionRecording: {
        endpoint: '/ses/',
    },
}

test.describe('SSR hydration compatibility', () => {
    test('does not cause hydration errors when scripts are loaded', async ({ page, context }) => {
        void context.route(/\/array\/[^/]+\/config(\?|$)/, (route) => {
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

    test('default inject target leaves body JSON-LD untouched without explicit config', async ({ page, context }) => {
        void context.route(/\/array\/[^/]+\/config(\?|$)/, (route) => {
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

        const { firstBodyScriptId, jsonldPosition, jsonldScript } = await page.evaluate(() => {
            const bodyScripts = Array.from(document.querySelectorAll('body > script')) as HTMLScriptElement[]
            const jsonldEl = document.getElementById('jsonld-bundle')
            return {
                firstBodyScriptId: bodyScripts[0]?.id || null,
                jsonldPosition: jsonldEl ? bodyScripts.indexOf(jsonldEl as HTMLScriptElement) : -1,
                jsonldScript: jsonldEl
                    ? { type: jsonldEl.getAttribute('type'), text: jsonldEl.textContent?.trim() }
                    : null,
            }
        })
        const headPosthogScriptCount = await page.evaluate(
            () =>
                Array.from(document.querySelectorAll('head > script')).filter((s) => {
                    const src = (s as HTMLScriptElement).src
                    return src?.includes('recorder') || src?.includes('posthog')
                }).length
        )
        const hydrationErrors: string[] = await page.evaluate(() => (window as any).hydrationErrors)

        // SSR-rendered body scripts must keep their original positions — any reorder breaks hydration.
        expect(firstBodyScriptId).toBe('framework-bundle')
        expect(jsonldPosition).toBe(1)
        expect(jsonldScript?.type).toBe('application/ld+json')
        expect(jsonldScript?.text).toContain('@context')
        expect(headPosthogScriptCount).toBeGreaterThan(0)
        expect(hydrationErrors).toEqual([])
    })

    test('appends scripts to head, leaving body untouched for SSR hydration', async ({ page, context }) => {
        void context.route(/\/array\/[^/]+\/config(\?|$)/, (route) => {
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
