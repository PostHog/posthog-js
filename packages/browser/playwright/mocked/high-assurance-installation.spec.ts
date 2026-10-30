import { expect, test, Request } from '@playwright/test'
import type { PostHog } from '../../src/posthog-core'
import type { RemoteConfig } from '../../src/types'

declare global {
    interface Window {
        highAssurancePosthog: PostHog
        highAssuranceFixtureReady: boolean
    }
}

type CapturedEvent = { event: string; properties: Record<string, unknown> }

// Remote enablement must not override the recipe's local restrictions.
const remoteConfig: Partial<RemoteConfig> = {
    hasFeatureFlags: true,
    surveys: true,
    productTours: true,
    conversations: true,
    siteApps: [{ id: '1', url: '/site-app.js' }],
    sessionRecording: { endpoint: '/ses/' },
    capturePerformance: true,
}

for (const bundle of ['core', 'full'] as const) {
    for (const loader of ['absent', 'before', 'after'] as const) {
        test(`${bundle}/no-external recipe with global loader ${loader} keeps JSON, flags and capture without executable downloads`, async ({
            page,
        }) => {
            const events: CapturedEvent[] = []
            const configRequests: Request[] = []
            const flagsRequests: Request[] = []
            const unexpectedRequests: string[] = []
            const scriptRequests: string[] = []
            const errors: string[] = []
            const expectedScripts = [
                `/dist/module.${bundle === 'full' ? 'full.' : ''}no-external.js`,
                ...(loader === 'absent' ? [] : ['/dist/module.mjs']),
            ]
            const origin = 'http://localhost:2345'

            page.on('pageerror', (error) => errors.push(error.message))
            page.on('request', (request) => {
                if (request.resourceType() === 'script') {
                    scriptRequests.push(new URL(request.url()).pathname)
                }
            })
            // Intercept every request so a regression never executes actual vendor content.
            await page.route('**/*', async (route) => {
                const request = route.request()
                const url = new URL(request.url())
                if (
                    url.origin === origin &&
                    (url.pathname === '/playwright/fixtures/high-assurance-installation.html' ||
                        expectedScripts.includes(url.pathname))
                ) {
                    return route.continue()
                }
                if (url.origin === origin && url.pathname === '/ingest/array/phc_high_assurance/config') {
                    configRequests.push(request)
                    return route.fulfill({ json: remoteConfig })
                }
                if (url.origin === origin && url.pathname === '/ingest/flags/') {
                    flagsRequests.push(request)
                    return route.fulfill({
                        json: {
                            featureFlags: { 'checkout-layout': 'reviewed-variant' },
                            featureFlagPayloads: { 'checkout-layout': '{"color":"blue"}' },
                            errorsWhileComputingFlags: false,
                        },
                    })
                }
                if (url.origin === origin && url.pathname === '/ingest/e/' && request.method() === 'POST') {
                    const payload = request.postDataJSON()
                    events.push(...(payload.batch || [payload]))
                    return route.fulfill({ json: {} })
                }
                unexpectedRequests.push(request.url())
                return route.fulfill({ status: 404, body: '' })
            })

            await page.goto(`/playwright/fixtures/high-assurance-installation.html?bundle=${bundle}&loader=${loader}`)
            await page.waitForFunction(() => window.highAssuranceFixtureReady)
            expect(
                await page.evaluate(() => typeof (window as any).__PosthogExtensions__?.loadExternalDependency)
            ).toBe(loader === 'absent' ? 'undefined' : 'function')
            expect(await page.evaluate(() => typeof (window as any).__PosthogExtensions__?.generateSurveys)).toBe(
                bundle === 'full' ? 'function' : 'undefined'
            )

            await expect
                .poll(() =>
                    page.evaluate(() =>
                        window.highAssurancePosthog.getFeatureFlag('checkout-layout', { send_event: false })
                    )
                )
                .toBe('reviewed-variant')
            expect(
                await page.evaluate(() => window.highAssurancePosthog.getFeatureFlagPayload('checkout-layout'))
            ).toEqual({
                color: 'blue',
            })
            await page.evaluate(() => {
                const ph = window.highAssurancePosthog
                ph.capture('checkout opened', { source: 'application' })
                ph.getFeatureFlag('checkout-layout')
                // A public API that would request an unbundled script if the shared loader
                // were allowed to act. The runtime restriction must apply even in full builds.
                ph.loadToolbar({})
            })
            await expect.poll(() => events.filter(({ event }) => event === 'checkout opened')).toHaveLength(1)
            expect(events.find(({ event }) => event === 'checkout opened')?.properties).toMatchObject({
                source: 'application',
                token: 'phc_high_assurance',
            })
            await expect.poll(() => events.filter(({ event }) => event === '$feature_flag_called')).toHaveLength(1)
            expect(events.some(({ event }) => event === '$pageview')).toBe(true)
            expect(configRequests).toHaveLength(1)
            expect(configRequests[0].method()).toBe('GET')
            expect(configRequests[0].postData()).toBeNull()
            expect(configRequests[0].headers().authorization).toBeUndefined()
            expect(flagsRequests).toHaveLength(1)
            expect(flagsRequests[0].method()).toBe('POST')
            expect(flagsRequests[0].postDataJSON()).toMatchObject({ token: 'phc_high_assurance' })

            // Include asynchronous extension setup and any late executable insertion.
            await page.waitForLoadState('networkidle')
            expect(unexpectedRequests).toEqual([])
            expect(scriptRequests.sort()).toEqual(expectedScripts.sort())
            expect(
                await page
                    .locator('script[src]')
                    .evaluateAll((scripts) => scripts.map((script) => script.getAttribute('src')))
            ).toEqual([])
            expect(errors).toEqual([])
        })
    }
}
