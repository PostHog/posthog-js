import { Page, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

export const CSP_NONCE = 'cHloLWNzcC10ZXN0'
export const CSP_TOKEN = 'phc_csp_test'
export const CUSTOMER_ORIGIN = 'https://customer.example'
export const API_HOST = 'https://us.i.posthog.com'
export const ASSETS_HOST = 'https://us-assets.i.posthog.com'
const FIRST_PARTY_API_HOST = `${CUSTOMER_ORIGIN}/ingest`

export type Directives = Record<string, string[]>

export interface CspScenario {
    name: string
    directives: Directives
    apiHost: string
    /** Appended to test names so they state what the policy does and does not guarantee. */
    caveat?: string
}

export const serializePolicy = (directives: Directives): string =>
    Object.entries(directives)
        .map(([directive, sources]) => [directive, ...sources].join(' '))
        .join('; ')

const baseDirectives = (): Directives => ({
    'default-src': ["'none'"],
    'script-src': [`'nonce-${CSP_NONCE}'`, ASSETS_HOST],
    'connect-src': [API_HOST, ASSETS_HOST],
    'frame-src': ["'none'"],
    'img-src': ["'self'", 'data:'],
    'style-src': ["'self'", "'unsafe-inline'"],
})

// Path-restricted sources: everything under /static/ is allowed, /array/<token>/config.js is not.
const staticOnlyScriptSrc = [`'nonce-${CSP_NONCE}'`, `${ASSETS_HOST}/static/`]

export const withDirectives = (scenario: CspScenario, name: string, directives: Directives): CspScenario => ({
    ...scenario,
    name,
    directives: { ...scenario.directives, ...directives },
})

export const scenarios = {
    hostAllowlist: (): CspScenario => ({ name: 'host allowlist', directives: baseDirectives(), apiHost: API_HOST }),
    strictDynamic: (): CspScenario => ({
        name: 'nonce + strict-dynamic',
        caveat: 'trust propagates to SDK-inserted scripts, so it is not a host allowlist for them',
        directives: {
            ...baseDirectives(),
            'script-src': [`'nonce-${CSP_NONCE}'`, "'strict-dynamic'"],
        },
        apiHost: API_HOST,
    }),
    firstPartyPath: (): CspScenario => ({
        name: 'first-party api_host path',
        caveat: 'same-origin routing does not verify upstream bytes',
        directives: {
            ...baseDirectives(),
            'script-src': [`'nonce-${CSP_NONCE}'`, "'self'"],
            'connect-src': ["'self'"],
        },
        apiHost: FIRST_PARTY_API_HOST,
    }),
    configScriptBlocked: (): CspScenario => ({
        name: 'config.js blocked by script-src',
        directives: { ...baseDirectives(), 'script-src': staticOnlyScriptSrc },
        apiHost: API_HOST,
    }),
    remoteConfigBlocked: (): CspScenario => ({
        name: 'config.js and JSON config blocked',
        directives: {
            ...baseDirectives(),
            'script-src': staticOnlyScriptSrc,
            'connect-src': [API_HOST],
        },
        apiHost: API_HOST,
    }),
    strictStyle: (): CspScenario => ({
        name: 'strict style-src',
        directives: { ...baseDirectives(), 'style-src': ["'self'", `'nonce-${CSP_NONCE}'`] },
        apiHost: API_HOST,
    }),
}

export const coreScenarios = [scenarios.hostAllowlist(), scenarios.strictDynamic(), scenarios.firstPartyPath()]

export type CoreLoader = 'snippet' | 'loader'
export type CoreBundle = 'array.js' | 'array.full.js' | 'array.full.es5.js'

export interface CspViolation {
    directive: string
    blockedURI: string
    sourceFile: string
}

export interface CapturedEvent {
    event: string
    properties: Record<string, any>
}

export interface CspPageOptions {
    scenario: CspScenario
    loader?: CoreLoader
    bundle?: CoreBundle
    /** JSON-serializable init config, merged over the defaults below. */
    config?: Record<string, unknown>
    /** JavaScript object literal merged after `config`, for options that need functions. */
    configSource?: string
    remoteConfig?: Record<string, unknown>
    flags?: Record<string, boolean | string>
    /** JSON responses for API paths, matched by pathname prefix (for example `/api/surveys/`). */
    apiResponses?: Record<string, unknown>
    extraOrigins?: string[]
    body?: string
}

export interface CspPage {
    page: Page
    scenario: CspScenario
    errors: string[]
    requests: string[]
    events: CapturedEvent[]
    posts: { path: string; body: unknown }[]
    violations: () => Promise<CspViolation[]>
    createdFrames: () => Promise<string[]>
    requestsOutsidePolicy: () => string[]
    waitForLoaded: () => Promise<void>
    remoteConfigApplied: () => Promise<boolean>
}

const dist = path.resolve(__dirname, '../../../dist')

// The snippet customers copy from the getting-started guide.
const documentedSnippet = (() => {
    const guide = readFileSync(path.resolve(__dirname, '../../../docs/getting-started.md'), 'utf8')
    const snippet = guide.match(/!function\(t,e\)\{[\s\S]*?\}\(document,window\.posthog\|\|\[\]\);/)?.[0]
    if (!snippet) {
        throw new Error('Could not find the snippet in docs/getting-started.md')
    }
    return snippet
})()

const defaultConfig = {
    autocapture: false,
    request_batching: false,
    disable_compression: true,
    opt_out_useragent_filter: true,
}

const baseRemoteConfig = {
    supportedCompression: [],
    hasFeatureFlags: true,
    // Marker read by remoteConfigApplied(): only a delivered remote config registers it.
    heatmaps: false,
}

const corsHeaders = {
    'access-control-allow-origin': CUSTOMER_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': '*',
}

const collectorScript = () => {
    const state = { violations: [] as unknown[], frames: [] as string[] }
    ;(window as any).__cspTest = state
    // oxlint-disable-next-line posthog-js/no-add-event-listener -- Init scripts are serialized and cannot import SDK helpers.
    document.addEventListener(
        'securitypolicyviolation',
        (event) => {
            state.violations.push({
                directive: event.effectiveDirective || event.violatedDirective,
                blockedURI: event.blockedURI,
                sourceFile: event.sourceFile,
            })
        },
        true
    )
    // oxlint-disable-next-line posthog-js/no-direct-mutation-observer -- Init scripts are serialized and cannot import SDK helpers.
    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeName === 'IFRAME') {
                    state.frames.push((node as HTMLIFrameElement).src || 'about:blank')
                }
            })
        }
    }).observe(document, { childList: true, subtree: true })
}

function decodeBody(buffer: Buffer | null): unknown {
    if (!buffer) {
        return undefined
    }
    const raw = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(new Uint8Array(buffer)) : buffer
    try {
        return JSON.parse(raw.toString())
    } catch {
        return raw.toString()
    }
}

function flagsResponse(flags: Record<string, boolean | string>) {
    return {
        flags: Object.fromEntries(
            Object.entries(flags).map(([key, value]) => [
                key,
                {
                    key,
                    enabled: !!value,
                    variant: typeof value === 'string' ? value : undefined,
                    reason: { code: 'condition_match', condition_index: 0, description: 'Matched' },
                    metadata: { id: 1, version: 1, description: undefined, payload: undefined },
                },
            ])
        ),
        featureFlags: flags,
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
    }
}

function renderHtml(options: Required<Pick<CspPageOptions, 'scenario' | 'loader' | 'bundle'>> & CspPageOptions) {
    const { scenario, loader, bundle } = options
    const config = { ...defaultConfig, api_host: scenario.apiHost, ...options.config }
    const hostPage = `
        document.getElementById('host-button').addEventListener('click', function () {
            document.getElementById('host-output').textContent = 'host page works'
        })`
    const body = `<p>CSP test page</p>
        <button id="host-button">Host button</button><span id="host-output"></span>
        ${options.body ?? ''}`
    const init = `posthog.init(${JSON.stringify(CSP_TOKEN)}, Object.assign(${JSON.stringify(config)}, ${options.configSource ?? '{}'}))`
    if (loader === 'loader') {
        const assetBase = scenario.apiHost === API_HOST ? ASSETS_HOST : scenario.apiHost
        // Functions cannot travel in data-config, so hooks use deferred initialization instead.
        const tag = options.configSource
            ? `<script nonce="${CSP_NONCE}" src="${assetBase}/static/loader.js" data-defer-init="true" crossorigin="anonymous"></script>
               <script nonce="${CSP_NONCE}">${init}</script>`
            : `<script nonce="${CSP_NONCE}" src="${assetBase}/static/loader.js?project_token=${CSP_TOKEN}"
                data-api-host="${scenario.apiHost}" data-config='${JSON.stringify(config)}' crossorigin="anonymous"></script>`
        return `<!doctype html><html><head>${tag}</head><body>${body}<script nonce="${CSP_NONCE}">${hostPage}</script></body></html>`
    }
    const snippet = documentedSnippet.replace('/static/array.js', `/static/${bundle}`)
    return `<!doctype html><html><head><script nonce="${CSP_NONCE}">
        ${snippet}
        ${init}
        </script></head><body>${body}<script nonce="${CSP_NONCE}">${hostPage}</script></body></html>`
}

export async function openCspPage(page: Page, options: CspPageOptions): Promise<CspPage> {
    const resolved = { loader: 'snippet' as const, bundle: 'array.js' as const, ...options }
    const { scenario } = resolved
    const remoteConfig = { ...baseRemoteConfig, ...options.remoteConfig }
    const errors: string[] = []
    const requests: string[] = []
    const events: CapturedEvent[] = []
    const posts: { path: string; body: unknown }[] = []
    const allowedOrigins = new Set([
        CUSTOMER_ORIGIN,
        ...(scenario.apiHost === API_HOST ? [API_HOST, ASSETS_HOST] : []),
        ...(options.extraOrigins ?? []),
    ])

    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(collectorScript)

    await page.route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        // Recorded here rather than via page.on('request'), which also reports requests the CSP blocked.
        requests.push(request.url())
        if (request.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: corsHeaders })
        }
        if (url.origin === CUSTOMER_ORIGIN && url.pathname === '/') {
            return route.fulfill({
                contentType: 'text/html',
                headers: { 'content-security-policy': serializePolicy(scenario.directives) },
                body: renderHtml(resolved),
            })
        }
        const pathname = url.origin === CUSTOMER_ORIGIN ? url.pathname.replace(/^\/ingest(?=\/)/, '') : url.pathname

        const staticFile = pathname.match(/^\/static\/(?:[^/]+\/)?([\w.-]+\.js)$/)?.[1]
        if (staticFile === 'toolbar.js') {
            // The real toolbar is built in PostHog/posthog; this stands in for its first script only.
            return route.fulfill({
                contentType: 'application/javascript',
                headers: corsHeaders,
                body: 'window.ph_load_toolbar = function () { window.__cspToolbarLoaded = true }',
            })
        }
        if (staticFile && existsSync(path.join(dist, staticFile))) {
            return route.fulfill({ path: path.join(dist, staticFile), headers: corsHeaders })
        }
        if (pathname === `/array/${CSP_TOKEN}/config.js`) {
            return route.fulfill({
                contentType: 'application/javascript',
                headers: corsHeaders,
                body: `(function () {
                    window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {};
                    window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(CSP_TOKEN)}] = {
                        config: ${JSON.stringify(remoteConfig)},
                        siteApps: []
                    };
                })();`,
            })
        }
        if (pathname === `/array/${CSP_TOKEN}/config`) {
            return route.fulfill({ json: remoteConfig, headers: corsHeaders })
        }
        if (pathname.startsWith('/flags/')) {
            return route.fulfill({ json: flagsResponse(options.flags ?? {}), headers: corsHeaders })
        }
        if (request.method() === 'POST') {
            const body = decodeBody(request.postDataBuffer())
            posts.push({ path: pathname, body })
            if (/^\/(e|s|i\/v0\/e)\/$/.test(pathname) && body && typeof body === 'object') {
                const payload = body as any
                events.push(...(Array.isArray(payload) ? payload : payload.batch || [payload]))
            }
        }
        const apiResponse = Object.entries(options.apiResponses ?? {}).find(([prefix]) => pathname.startsWith(prefix))
        if (apiResponse) {
            return route.fulfill({ json: apiResponse[1], headers: corsHeaders })
        }
        if (allowedOrigins.has(url.origin)) {
            return route.fulfill({ json: {}, headers: corsHeaders })
        }
        return route.fulfill({ status: 404, body: '', headers: corsHeaders })
    })

    await page.goto(`${CUSTOMER_ORIGIN}/`, { waitUntil: 'domcontentloaded' })

    return {
        page,
        scenario,
        errors,
        requests,
        events,
        posts,
        violations: () => page.evaluate(() => (window as any).__cspTest.violations as CspViolation[]),
        createdFrames: () => page.evaluate(() => (window as any).__cspTest.frames as string[]),
        requestsOutsidePolicy: () => requests.filter((url) => !allowedOrigins.has(new URL(url).origin)),
        waitForLoaded: async () => {
            await expect.poll(() => page.evaluate(() => !!(window as any).posthog?.__loaded)).toBe(true)
        },
        remoteConfigApplied: () =>
            page.evaluate(
                () => (window as any).posthog?.persistence?.props?.$heatmaps_enabled_server_side !== undefined
            ),
    }
}

export async function expectEventCaptured(state: CspPage, name: string, timeout?: number) {
    await expect.poll(() => state.events.some(({ event }) => event === name), { timeout }).toBe(true)
}

const normalizeDirective = (directive: string) => directive.replace(/-(elem|attr)$/, '')

/** Asserts the run stayed inside the policy: no violations other than `allowed`, frames, stray hosts or page errors. */
export async function expectNoUnexpectedActivity(
    state: CspPage,
    { allowed = [], allowedErrors = [] }: { allowed?: Partial<CspViolation>[]; allowedErrors?: string[] } = {}
) {
    const violations = (await state.violations()).filter(
        (violation) =>
            !allowed.some(
                (expected) =>
                    (!expected.directive ||
                        normalizeDirective(expected.directive) === normalizeDirective(violation.directive)) &&
                    (!expected.blockedURI || violation.blockedURI.startsWith(expected.blockedURI))
            )
    )
    expect(violations).toEqual([])
    expect(await state.createdFrames()).toEqual([])
    expect(await state.page.locator('iframe').count()).toBe(0)
    expect(state.requestsOutsidePolicy()).toEqual([])
    expect(state.errors.filter((error) => !allowedErrors.includes(error))).toEqual([])
}

/** Violations matching a directive (ignoring -elem/-attr suffixes) and a blocked-URI prefix. */
export async function violationsFor(state: CspPage, directive: string, blockedURI = '') {
    return (await state.violations()).filter(
        (violation) =>
            normalizeDirective(violation.directive) === normalizeDirective(directive) &&
            violation.blockedURI.startsWith(blockedURI)
    )
}
