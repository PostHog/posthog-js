import { expect, Page, test } from '@playwright/test'
import { version } from '../../package.json'
import {
    ASSETS_HOST,
    CSP_NONCE,
    CspPage,
    CspPageOptions,
    CspScenario,
    coreScenarios,
    expectEventCaptured,
    expectNoUnexpectedActivity,
    openCspPage,
    scenarios,
    violationsFor,
    withDirectives,
} from './utils/csp'

// page.waitForFunction polls with string evaluation, which the strict CSP blocks and reports as a violation.
const pagePoll = (state: CspPage, predicate: () => unknown) =>
    expect.poll(() => state.page.evaluate(predicate).then(Boolean)).toBe(true)

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const survey = {
    id: 'csp-survey',
    name: 'CSP survey',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    questions: [{ type: 'open', question: 'CSP question?', id: 'csp-question' }],
}

const tour = {
    id: 'csp-tour',
    name: 'CSP tour',
    tour_type: 'tour',
    auto_launch: true,
    start_date: '2021-01-01T00:00:00Z',
    end_date: null,
    display_frequency: 'until_interacted',
    steps: [{ id: 'step-1', type: 'modal', progressionTrigger: 'button', content: null, contentHtml: '<p>CSP</p>' }],
}

interface ExtensionCase {
    name: string
    options: Omit<CspPageOptions, 'scenario'>
    exercise: (state: CspPage) => Promise<void>
}

const webVitalsCase = (name: string, performance: Record<string, unknown>): ExtensionCase => ({
    name,
    options: {
        config: { capture_performance: { web_vitals: true, web_vitals_delayed_flush_ms: 100, ...performance } },
        remoteConfig: { capturePerformance: { web_vitals: true } },
    },
    exercise: async (state) => {
        await state.page.click('#host-button')
        await expectEventCaptured(state, '$web_vitals')
    },
})

const extensionCases: ExtensionCase[] = [
    {
        name: 'session recording (lazy-recorder)',
        options: { remoteConfig: { sessionRecording: { endpoint: '/s/' } } },
        exercise: async (state) => {
            await pagePoll(state, () => (window as any).posthog.sessionRecording?.started)
            await state.page.click('#host-button')
            await expect
                .poll(() =>
                    state.events
                        .filter(({ event }) => event === '$snapshot')
                        .flatMap(({ properties }) => properties.$snapshot_data.map((s: { type: number }) => s.type))
                )
                .toContain(2)
        },
    },
    {
        name: 'surveys',
        options: {
            remoteConfig: { surveys: true },
            apiResponses: { '/api/surveys/': { surveys: [survey] } },
        },
        exercise: async (state) => {
            await expect(state.page.locator('.PostHogSurvey-csp-survey').locator('.survey-form')).toBeVisible()
        },
    },
    webVitalsCase('web-vitals', { web_vitals_attribution: false }),
    webVitalsCase('web-vitals-with-attribution', { web_vitals_attribution: true }),
    webVitalsCase('web-vitals-soft-navs', { web_vitals_attribution: false, __preview_web_vitals_soft_navs: true }),
    webVitalsCase('web-vitals-with-attribution-soft-navs', {
        web_vitals_attribution: true,
        __preview_web_vitals_soft_navs: true,
    }),
    {
        name: 'exception autocapture',
        options: {
            remoteConfig: { autocaptureExceptions: true },
            body: `<button id="throw-button">Throw</button><script nonce="${CSP_NONCE}">
                document.getElementById('throw-button').addEventListener('click', function () {
                    throw new Error('csp test error')
                })</script>`,
        },
        exercise: async (state) => {
            await pagePoll(
                state,
                () =>
                    (window as any).posthog.exceptionObserver?.isEnabled &&
                    !!(window as any).__PosthogExtensions__?.errorWrappingFunctions?.wrapOnError
            )
            await state.page.click('#throw-button')
            await expectEventCaptured(state, '$exception')
        },
    },
    {
        name: 'dead clicks autocapture',
        options: {
            remoteConfig: { captureDeadClicks: true },
            body: '<div id="dead-target" style="width:200px;height:50px">nothing happens here</div>',
        },
        exercise: async (state) => {
            await pagePoll(
                state,
                () => !!(window as any).posthog.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
            )
            await expect
                .poll(
                    async () => {
                        await state.page.click('#dead-target')
                        return state.events.some(({ event }) => event === '$dead_click')
                    },
                    { timeout: 15000, intervals: [1500] }
                )
                .toBe(true)
        },
    },
    {
        name: 'tracing headers',
        options: { config: { tracing_headers: ['customer.example'] } },
        exercise: async (state) => {
            await pagePoll(state, () => !!(window as any).__PosthogExtensions__?.tracingHeadersPatchFns)
            const sent = state.page.waitForRequest('https://customer.example/api/data')
            await state.page.evaluate(() => fetch('/api/data'))
            expect((await sent).headers()['x-posthog-session-id']).toBeTruthy()
        },
    },
    {
        name: 'logs',
        options: { remoteConfig: { logs: { captureConsoleLogs: true } } },
        exercise: async (state) => {
            await pagePoll(state, () => !!(window as any).__PosthogExtensions__?.logs)
            await state.page.evaluate(() => {
                // oxlint-disable-next-line no-console -- The logs extension captures console output.
                console.warn('csp-log-line')
                ;(window as any).posthog.logs.flushLogs()
            })
            await expect
                .poll(() =>
                    state.posts.some(
                        ({ path, body }) =>
                            path.startsWith('/i/v1/logs') && JSON.stringify(body).includes('csp-log-line')
                    )
                )
                .toBe(true)
        },
    },
    {
        name: 'conversations',
        options: {
            remoteConfig: {
                conversations: { enabled: true, token: 'csp-token', widgetEnabled: true, color: '#1d4ed8' },
            },
        },
        exercise: async (state) => {
            await expect(
                state.page.locator('#ph-conversations-widget-container button[aria-label^="Open chat"]')
            ).toBeVisible()
        },
    },
    {
        name: 'product tours',
        options: {
            remoteConfig: { productTours: true },
            apiResponses: { '/api/product_tours/': { product_tours: [tour] } },
        },
        exercise: async (state) => {
            await expect(state.page.locator('.ph-product-tour-container-csp-tour .ph-tour-content')).toContainText(
                'CSP'
            )
        },
    },
]

// The customer's own endpoint used by the tracing-headers check is first-party.
const allowSelfConnect = (scenario: CspScenario) =>
    scenario.directives['connect-src'].includes("'self'")
        ? scenario
        : withDirectives(scenario, scenario.name, {
              'connect-src': ["'self'", ...scenario.directives['connect-src']],
          })

test.describe('strict CSP: core', () => {
    for (const scenario of coreScenarios) {
        for (const loader of ['snippet', 'loader'] as const) {
            test(`core via ${loader} under ${scenario.name}${scenario.caveat ? ` (${scenario.caveat})` : ''}`, async ({
                page,
            }) => {
                const state = await openCspPage(page, { scenario, loader, flags: { 'csp-flag': true } })
                await state.waitForLoaded()
                await page.evaluate(() => (window as any).posthog.capture('csp event'))
                await expectEventCaptured(state, 'csp event')
                await expect.poll(() => state.remoteConfigApplied()).toBe(true)
                await expect
                    .poll(() => page.evaluate(() => (window as any).posthog.isFeatureEnabled('csp-flag')))
                    .toBe(true)
                expect(state.requests.some((url) => url.includes('/flags/'))).toBe(true)
                await expectNoUnexpectedActivity(state)
            })
        }
    }

    // strict-dynamic ignores host sources, so a script the SDK inserts from a host the policy never
    // lists still runs. The policy does not constrain where SDK-inserted scripts come from.
    test('strict-dynamic trusts an SDK-inserted script from an unlisted host', async ({ page }) => {
        const unlistedHost = 'https://cdn.unlisted.example'
        const state = await openCspPage(page, {
            scenario: scenarios.strictDynamic(),
            config: { asset_host: unlistedHost },
            remoteConfig: { sessionRecording: { endpoint: '/s/' } },
            extraOrigins: [unlistedHost],
        })
        await state.waitForLoaded()
        await pagePoll(state, () => (window as any).posthog.sessionRecording?.started)
        expect(state.requests).toContain(`${unlistedHost}/static/${version}/lazy-recorder.js`)
        await expectNoUnexpectedActivity(state)
    })

    // Documented exception: the loaders copy their nonce onto array.js, but extension scripts are
    // inserted without one. A nonce-only script-src (no host, no strict-dynamic) blocks
    // them unless prepare_external_dependency_script copies the nonce.
    for (const copyNonce of [false, true]) {
        test(`nonce-only script-src ${copyNonce ? 'loads extensions when prepare_external_dependency_script sets the nonce' : 'blocks extension scripts inserted without a nonce'}`, async ({
            page,
        }) => {
            const state = await openCspPage(page, {
                scenario: withDirectives(scenarios.hostAllowlist(), 'nonce-only', {
                    'script-src': [`'nonce-${CSP_NONCE}'`],
                }),
                loader: 'loader',
                remoteConfig: { sessionRecording: { endpoint: '/s/' } },
                configSource: copyNonce
                    ? `{ prepare_external_dependency_script: function (script) { script.nonce = '${CSP_NONCE}'; return script } }`
                    : undefined,
            })
            await state.waitForLoaded()
            await page.evaluate(() => (window as any).posthog.capture('csp event'))
            await expectEventCaptured(state, 'csp event')
            await expect.poll(() => state.remoteConfigApplied()).toBe(true)
            if (copyNonce) {
                await pagePoll(state, () => (window as any).posthog.sessionRecording?.started)
                await expectNoUnexpectedActivity(state)
                return
            }
            await expect
                .poll(async () => (await violationsFor(state, 'script-src', ASSETS_HOST)).map((v) => v.blockedURI))
                .toEqual([
                    `${ASSETS_HOST}/static/${version}/lazy-recorder.js`,
                    `${ASSETS_HOST}/static/lazy-recorder.js?v=${version}`,
                ])
            expect(await page.evaluate(() => (window as any).posthog.sessionRecording?.started)).toBeFalsy()
            await expectNoUnexpectedActivity(state, { allowed: [{ directive: 'script-src', blockedURI: ASSETS_HOST }] })
        })
    }

    for (const bundle of ['array.full.js', 'array.full.es5.js'] as const) {
        test(`${bundle} under ${coreScenarios[0].name}`, async ({ page }) => {
            const state = await openCspPage(page, {
                scenario: coreScenarios[0],
                bundle,
                remoteConfig: { sessionRecording: { endpoint: '/s/' }, autocaptureExceptions: true },
            })
            await state.waitForLoaded()
            await page.evaluate(() => (window as any).posthog.capture('csp event'))
            await expectEventCaptured(state, 'csp event')
            if (bundle === 'array.full.js') {
                await pagePoll(state, () => (window as any).posthog.sessionRecording?.started)
            }
            // The ES5 globalThis polyfill only reaches Function("return this") when globalThis, window and
            // self are all missing, which never happens in a browser, so no eval violation is expected.
            expect(await violationsFor(state, 'script-src', 'eval')).toEqual([])
            // Full bundles include their extensions, so nothing else is fetched from /static/.
            expect(state.requests.filter((url) => /\/static\/(?!array)/.test(url))).toEqual([])
            await expectNoUnexpectedActivity(state)
        })
    }
})

test.describe('strict CSP: lazy extensions', () => {
    for (const scenario of coreScenarios) {
        for (const extension of extensionCases) {
            test(`${extension.name} under ${scenario.name}`, async ({ page }) => {
                const state = await openCspPage(page, {
                    ...extension.options,
                    scenario: extension.name === 'tracing headers' ? allowSelfConnect(scenario) : scenario,
                })
                await state.waitForLoaded()
                await extension.exercise(state)
                await expectNoUnexpectedActivity(state, {
                    allowedErrors: extension.name === 'exception autocapture' ? ['csp test error'] : [],
                })
            })
        }
    }
})

test.describe('strict CSP: toolbar', () => {
    test('toolbar.js loads when its host is allowed by script-src', async ({ page }) => {
        const state = await openCspPage(page, { scenario: scenarios.hostAllowlist() })
        await state.waitForLoaded()
        await page.evaluate(() => (window as any).posthog.loadToolbar({}))
        await pagePoll(state, () => (window as any).__cspToolbarLoaded)
        await expectNoUnexpectedActivity(state)
    })

    // Only the SDK's own toolbar.js request is covered. The real toolbar's module graph is built in
    // PostHog/posthog and is out of scope here.
    // Documented exception: with the default strict_script_versioning 'fallback', a CSP-blocked versioned
    // toolbar.js is retried once at the legacy mutable /static/toolbar.js URL, so there are two violations.
    test('toolbar.js is governed by script-src and the blocked load retries the legacy URL once', async ({ page }) => {
        const state = await openCspPage(page, {
            scenario: withDirectives(scenarios.hostAllowlist(), 'toolbar blocked', {
                'script-src': [`'nonce-${CSP_NONCE}'`, `${ASSETS_HOST}/static/array.js`, `${ASSETS_HOST}/array/`],
            }),
        })
        await state.waitForLoaded()
        await page.evaluate(() => (window as any).posthog.loadToolbar({}))
        await expect
            .poll(async () =>
                (await violationsFor(state, 'script-src', `${ASSETS_HOST}/static/`)).map((v) => v.blockedURI)
            )
            .toEqual([
                `${ASSETS_HOST}/static/${version}/toolbar.js`,
                expect.stringMatching(
                    new RegExp(`^${escapeRegExp(`${ASSETS_HOST}/static/toolbar.js?v=${version}&t=`)}\\d+$`)
                ),
            ])
        expect(await page.evaluate(() => (window as any).__cspToolbarLoaded)).toBeUndefined()
        expect(state.requests.filter((url) => url.includes('toolbar'))).toEqual([])
        await page.evaluate(() => (window as any).posthog.capture('after toolbar'))
        await expectEventCaptured(state, 'after toolbar')
        await expectNoUnexpectedActivity(state, {
            allowed: [{ directive: 'script-src', blockedURI: `${ASSETS_HOST}/static/` }],
        })
    })
})

test.describe('strict CSP: blocked remote config', () => {
    test('without site apps, config loads as JSON and config.js is never requested', async ({ page }) => {
        const state = await openCspPage(page, {
            scenario: scenarios.configScriptBlocked(),
            remoteConfig: { surveys: true },
            apiResponses: { '/api/surveys/': { surveys: [survey] } },
        })
        await state.waitForLoaded()
        await expect.poll(() => state.remoteConfigApplied()).toBe(true)
        await expect(page.locator('.PostHogSurvey-csp-survey').locator('.survey-form')).toBeVisible()
        expect(state.requests.filter((url) => url.endsWith('/array/phc_csp_test/config'))).toHaveLength(1)
        await expectNoUnexpectedActivity(state)
    })

    test('with site apps, a blocked config.js falls back to the JSON config', async ({ page }) => {
        const state = await openCspPage(page, {
            scenario: scenarios.configScriptBlocked(),
            config: { opt_in_site_apps: true },
            remoteConfig: { surveys: true },
            apiResponses: { '/api/surveys/': { surveys: [survey] } },
        })
        await state.waitForLoaded()
        await expect.poll(() => state.remoteConfigApplied()).toBe(true)
        await expect(page.locator('.PostHogSurvey-csp-survey').locator('.survey-form')).toBeVisible()
        expect(await violationsFor(state, 'script-src', `${ASSETS_HOST}/array/`)).toEqual([
            expect.objectContaining({ blockedURI: expect.stringContaining('/array/phc_csp_test/config.js') }),
        ])
        expect(state.requests.filter((url) => url.endsWith('/array/phc_csp_test/config'))).toHaveLength(1)
        await expectNoUnexpectedActivity(state, {
            allowed: [{ directive: 'script-src', blockedURI: `${ASSETS_HOST}/array/` }],
        })
    })

    for (const siteApps of [false, true]) {
        test(`blocked remote config falls back to defaults and keeps capturing ${siteApps ? 'with' : 'without'} site apps`, async ({
            page,
        }) => {
            await expectBlockedRemoteConfigFallsBack(page, siteApps)
        })
    }

    async function expectBlockedRemoteConfigFallsBack(page: Page, siteApps: boolean) {
        const state = await openCspPage(page, {
            scenario: scenarios.remoteConfigBlocked(),
            config: { opt_in_site_apps: siteApps },
            remoteConfig: { surveys: true, sessionRecording: { endpoint: '/s/' } },
            flags: { 'csp-flag': true },
        })
        await state.waitForLoaded()
        await page.click('#host-button')
        await expect(page.locator('#host-output')).toHaveText('host page works')
        await page.evaluate(() => (window as any).posthog.capture('csp event'))
        await expectEventCaptured(state, 'csp event')
        await expect.poll(() => page.evaluate(() => (window as any).posthog.isFeatureEnabled('csp-flag'))).toBe(true)
        await expect.poll(() => violationsFor(state, 'connect-src', `${ASSETS_HOST}/array/`)).toHaveLength(1)
        // Without site apps the SDK never inserts config.js, so script-src is never involved.
        expect(await violationsFor(state, 'script-src', `${ASSETS_HOST}/array/`)).toHaveLength(siteApps ? 1 : 0)
        expect(await state.remoteConfigApplied()).toBe(false)
        expect(await page.evaluate(() => (window as any).posthog.sessionRecording?.started)).toBeFalsy()
        await expectNoUnexpectedActivity(state, {
            allowed: [
                { directive: 'script-src', blockedURI: `${ASSETS_HOST}/array/` },
                { directive: 'connect-src', blockedURI: `${ASSETS_HOST}/array/` },
            ],
        })
    }
})

const uiExtensionScripts = ['surveys.js', 'product-tours.js', 'conversations.js']

// Informational: records how UI extensions behave under a strict style-src. It only hard-fails when the
// SDK throws or a UI stops rendering, so product styling changes do not block CI. Findings are attached as
// annotations; exclude with --grep-invert @informational.
test.describe('strict CSP: strict style-src', { tag: '@informational' }, () => {
    for (const nonceHook of [false, true]) {
        test(`UI extensions ${nonceHook ? 'with' : 'without'} a nonce from prepare_external_dependency_stylesheet`, async ({
            page,
        }, testInfo) => {
            const state = await openCspPage(page, {
                scenario: scenarios.strictStyle(),
                remoteConfig: {
                    surveys: true,
                    productTours: true,
                    conversations: { enabled: true, token: 'csp-token', widgetEnabled: true, color: '#1d4ed8' },
                },
                apiResponses: {
                    '/api/surveys/': { surveys: [survey] },
                    '/api/product_tours/': { product_tours: [tour] },
                },
                configSource: nonceHook
                    ? `{ prepare_external_dependency_stylesheet: function (style) { style.nonce = '${CSP_NONCE}'; return style } }`
                    : undefined,
            })
            await state.waitForLoaded()
            await expect(page.locator('.PostHogSurvey-csp-survey').locator('.survey-form')).toBeAttached()
            await expect(page.locator('.ph-product-tour-container-csp-tour')).toBeAttached()
            await expect(page.locator('#ph-conversations-widget-container button').first()).toBeAttached()

            const styleViolations = await violationsFor(state, 'style-src')
            for (const script of uiExtensionScripts) {
                const blocked = styleViolations.filter((v) => v.sourceFile.includes(script)).length
                testInfo.annotations.push({ type: 'style-src', description: `${script}: ${blocked} blocked <style>` })
            }
            expect(state.errors).toEqual([])
        })
    }
})
