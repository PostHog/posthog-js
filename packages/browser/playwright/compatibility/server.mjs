import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMockServer, buildConfigResponse } from '@posthog-tooling/sdk-mock-server'
import { interactionScenarios } from './interaction-cases.mjs'
import { replayMinimumDurationMs } from './replay-cases.mjs'
import { replayNetworkCases, replayNetworkHeaders, replayNetworkPath } from './replay-network.mjs'

export const survey = {
    id: 'compat-survey',
    name: 'Compatibility survey',
    type: 'popover',
    start_date: '2020-01-01T00:00:00Z',
    questions: [{ id: 'question-1', type: 'open', question: 'How was your experience?', buttonText: 'Submit' }],
    appearance: { thankYouMessageHeader: 'Thank you!', displayThankYouMessage: true },
}

// Keep the lab's behavioral projection separate from complete raw HTTP evidence.
export function observations(server) {
    const { events, snapshots, logs, requests, blockedRequests, errors } = server.inspect()
    const ignored =
        /^\/(?:$|after$|player$|favicon\.ico$|harness\.js$|snippet\.js$|consumer\.js$|player\.js$|__compat\/)/
    return {
        events,
        snapshots,
        logs,
        errors,
        blockedRequests: blockedRequests.map(({ barrier, method, path }) => ({ barrier, method, path })),
        requests: requests
            .filter((r) => r.status !== null && !ignored.test(r.path))
            .map((r) => ({
                method: r.method,
                path: r.method === 'POST' ? r.path.replace(/\/$/, '') : r.path,
                query: r.query,
                status: r.status,
                ...(r.method === 'POST'
                    ? { body: r.body, contentType: r.contentType, contentEncoding: r.contentEncoding }
                    : {}),
            })),
    }
}

export function compatibilityServer(settings) {
    const surveysEnabled = [
        'surveys',
        'surveys-auto',
        'extension-failure',
        'delayed-loading',
        'version-fallback',
    ].includes(settings.scenario)
    let flagSequence = 0
    const server = createMockServer({
        barriers: [
            'config',
            'flags',
            'extensions',
            'surveys',
            ...(['snippet', 'loader'].includes(settings.mode) ? ['core'] : []),
        ],
        state: {
            sessionReplayEnabled: settings.scenario.startsWith('replay'),
            minimumDurationMilliseconds:
                settings.scenario === 'replay-minimum-duration' ? replayMinimumDurationMs : null,
            surveysEnabled,
            surveys: [survey],
            flags: { 'compat-enabled': true, 'compat-variant': 'blue' },
            projectToken: 'phc_COMPAT',
            configOverrides: {
                supportedCompression: [],
                capturePerformance:
                    settings.scenario === 'web-vitals'
                        ? { web_vitals: true, web_vitals_allowed_metrics: ['FCP'] }
                        : false,
                captureDeadClicks: settings.scenario === 'dead-clicks',
                heatmaps: settings.scenario === 'heatmaps',
                errorTracking: { autocaptureExceptions: false },
                analytics: { endpoint: '/e/' },
                surveys: surveysEnabled ? [survey] : false,
                logs: { captureConsoleLogs: settings.scenario === 'logs' },
                sessionRecording: settings.scenario.startsWith('replay')
                    ? { endpoint: '/s/', consoleLogRecordingEnabled: false, recordCanvas: false }
                    : false,
            },
        },
        respond(endpoint, _request, response, state) {
            if (endpoint === 'flags')
                return {
                    json: {
                        ...response.json,
                        ...buildConfigResponse(state),
                        requestId: `00000000-0000-4000-8000-${String(++flagSequence).padStart(12, '0')}`,
                        evaluatedAt: 1704067200,
                    },
                }
            if (['batch', 'snapshot', 'logs'].includes(endpoint)) return { json: { status: 1 } }
            return response
        },
        async adapter(request, context) {
            const path = request.path
            const networkSample = replayNetworkCases.find((sample) => path === `${replayNetworkPath}/${sample.name}`)
            if (settings.scenario === 'replay' && request.method === 'POST' && networkSample)
                return { body: networkSample.responseBody, headers: replayNetworkHeaders.response }
            if (path === '/__compat/received') return { json: observations(server) }
            if (path === '/__compat/barriers') return { json: server.barriers() }
            if (path === '/__compat/release' && request.method === 'POST') {
                for (const name of request.body.barriers) server.releaseBarrier(name)
                return { json: { released: request.body.barriers } }
            }
            if (['/', '/after', '/player'].includes(path)) {
                let body = readFileSync(
                    new URL(
                        `./fixtures/${path === '/' && interactionScenarios.includes(settings.scenario) ? 'interactions' : path === '/' && settings.scenario === 'replay-css' ? 'styles' : 'page'}.html`,
                        import.meta.url
                    ),
                    'utf8'
                )
                if (
                    path === '/' &&
                    ['replay-idle', 'replay-rotation', 'replay-minimum-duration'].includes(settings.scenario)
                ) {
                    body = body.replace(
                        '</head>',
                        '<style>#action { display: block; width: 80px; height: 40px; }</style></head>'
                    )
                    body +=
                        '<script>document.getElementById("action").addEventListener("mousedown", (event) => event.preventDefault())</script>'
                }
                if (path === '/') {
                    body += '<script src="/harness.js"></script>'
                    if (settings.mode !== 'loader')
                        body += `<script src="/${settings.mode === 'snippet' ? 'snippet' : 'consumer'}.js"></script>`
                }
                if (path === '/player') body += '<script src="/player.js"></script>'
                return { body: body + '</body></html>', headers: { 'Content-Type': 'text/html' } }
            }
            const fixed = {
                '/harness.js': settings.harness,
                '/snippet.js': settings.snippet,
                '/consumer.js': settings.fixture,
                '/player.js': settings.player,
            }
            if (fixed[path]) return { body: readFileSync(fixed[path]), headers: { 'Content-Type': 'text/javascript' } }
            if (path === '/favicon.ico') return { status: 204, body: '', headers: { 'Content-Type': 'image/x-icon' } }
            if (path.startsWith('/static/')) {
                const parts = path.split('/'),
                    filename = parts.at(-1)
                if (
                    ![3, 4].includes(parts.length) ||
                    (parts.length === 4 && parts[2] !== settings.coreVersion) ||
                    !settings.allowedAssets.includes(filename)
                )
                    return { status: 404, json: { error: 'Unknown artifact' } }
                const isCore = filename === 'array.js'
                const isLoader = filename === 'loader.js'
                if (!isLoader) await context.waitForBarrier(isCore ? 'core' : 'extensions')
                const failure = settings.scenario === 'extension-failure' && filename === 'surveys.js'
                const fallback = settings.scenario === 'version-fallback' && parts.length === 4 && !isCore && !isLoader
                if (failure || fallback)
                    return { status: failure ? 503 : 404, json: { error: 'Controlled extension failure' } }
                return {
                    body: readFileSync(join(isCore || isLoader ? settings.coreDist : settings.extensionDist, filename)),
                    headers: { 'Content-Type': 'text/javascript' },
                }
            }
            return undefined
        },
    })
    return server
}
