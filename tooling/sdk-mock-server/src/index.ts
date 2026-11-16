import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { decodeBody, type DecodedBody } from './decode.js'
import {
    defaultState,
    mergeState,
    isObject,
    buildConfigResponse,
    buildFlagsResponse,
    type JsonObject,
    type JsonValue,
    type MockState,
    type Endpoint,
} from './state.js'

export { buildConfigResponse, buildFlagsResponse }
export type { JsonObject, JsonValue, MockState, Endpoint }

export interface RequestRecord {
    id: number
    method: string
    path: string
    query: Record<string, string[]>
    headers: IncomingHttpHeaders
    rawBody: string
    rawBodyBase64: string
    body: JsonValue
    bodyWrapper: DecodedBody['bodyWrapper']
    contentType: string | null
    contentEncoding: string | null
    status: number | null
    responseFinished: boolean
    decodeError?: string
}

export interface MockRequest extends RequestRecord {
    url: URL
    rawBytes: Buffer
    signal: AbortSignal
}

export interface MockResponse {
    status?: number
    headers?: Record<string, string>
    /** JSON response, unless body is supplied. */
    json?: JsonValue
    /** Fixture HTML/JavaScript or other exact response bytes. */
    body?: string | Uint8Array
}

export interface BlockedRequest {
    id: number
    barrier: string
    method: string
    path: string
}

export interface Captured {
    events: JsonValue[]
    snapshots: JsonValue[]
    logs: JsonValue[]
    flags_calls: JsonValue[]
    config_calls: JsonValue[]
}

export interface Inspection extends Captured {
    requests: RequestRecord[]
    blockedRequests: BlockedRequest[]
    errors: string[]
}

export interface AdapterContext {
    /** Fresh state, including control updates made while a response was held. */
    getState(): MockState
    waitForBarrier(name: string): Promise<void>
}

export interface MockServerOptions {
    port?: number
    /** Initial top-level overrides (nested values replace). Live updates deep-merge. */
    state?: JsonObject
    /** Initially closed gates. Reset restores this set. Endpoint gates use Endpoint names. */
    barriers?: string[]
    barrierTimeoutMs?: number
    /** SDK-owned page/CDN routes. Undefined falls through to the backend. Controls cannot be overridden. */
    adapter?: (
        request: MockRequest,
        context: AdapterContext
    ) => MockResponse | undefined | Promise<MockResponse | undefined>
    /** Customize a built-in endpoint response after capture, delay and barrier. */
    respond?: (
        endpoint: Endpoint,
        request: MockRequest,
        response: MockResponse,
        state: MockState
    ) => MockResponse | Promise<MockResponse>
}

export interface MockServer {
    /** Binds only to 127.0.0.1; defaults to an OS-selected port. Idempotent while running. */
    start(): Promise<string>
    /** Terminal, idempotent shutdown: abort waits/delays and close all sockets. */
    stop(): Promise<void>
    /** Restore initial state and gates, clear evidence, and cancel in-flight requests. */
    reset(): void
    getState(): MockState
    updateState(patch: JsonObject): MockState
    inspect(): Inspection
    clearCaptured(): void
    holdBarrier(name: string): void
    releaseBarrier(name: string): void
    barriers(): Record<string, boolean>
}

function emptyCaptured(): Captured {
    return { events: [], snapshots: [], logs: [], flags_calls: [], config_calls: [] }
}

function values(body: JsonValue): JsonValue[] {
    return isObject(body) && Array.isArray(body.batch) ? body.batch : Array.isArray(body) ? body : [body]
}

function endpointFor(method: string, path: string): Endpoint | undefined {
    const normalized = path.replace(/\/+$/, '')
    if (method === 'GET') {
        if (path.startsWith('/array/') && (path.endsWith('/config') || path.endsWith('/config.js'))) return 'config'
        if (normalized === '/api/surveys') return 'surveys'
    }
    if (method === 'POST') {
        if (normalized === '/flags' || normalized === '/decide') return 'flags'
        if (['/batch', '/e', '/i/v0/e'].includes(normalized)) return 'batch'
        if (normalized === '/s' || normalized === '/newS') return 'snapshot'
        if (normalized === '/i/v1/logs') return 'logs'
        if (normalized === '/i/v1/analytics/events') return 'captureV1'
    }
    return undefined
}

export function createMockServer(options: MockServerOptions = {}): MockServer {
    const initialPatch = structuredClone(options.state ?? {})
    const initialBarriers = [...(options.barriers ?? [])]
    const initialState = (): MockState => ({ ...defaultState(), ...structuredClone(initialPatch) })
    let state = initialState()
    let captured = emptyCaptured()
    let requests: RequestRecord[] = []
    let errors: string[] = []
    const blocked = new Set<BlockedRequest>()
    const gates = new Map<string, { released: boolean; waiters: Set<() => void> }>()
    const controllers = new Set<AbortController>()
    let sequence = 0
    let origin: string | undefined
    let stopped = false
    let startPromise: Promise<string> | undefined
    let stopPromise: Promise<void> | undefined

    const holdBarrier = (name: string): void => {
        const gate = gates.get(name)
        if (gate) gate.released = false
        else gates.set(name, { released: false, waiters: new Set() })
    }
    const releaseBarrier = (name: string): void => {
        const gate = gates.get(name)
        if (gate) {
            gate.released = true
            for (const release of gate.waiters) release()
            gate.waiters.clear()
        } else gates.set(name, { released: true, waiters: new Set() })
    }
    for (const name of initialBarriers) holdBarrier(name)

    async function waitForBarrier(name: string, request: MockRequest): Promise<void> {
        request.signal.throwIfAborted()
        const gate = gates.get(name)
        if (!gate || gate.released) return
        const entry = { id: request.id, barrier: name, method: request.method, path: request.path }
        blocked.add(entry)
        try {
            await new Promise<void>((resolve, reject) => {
                const finish = (error?: Error): void => {
                    clearTimeout(timer)
                    request.signal.removeEventListener('abort', abort)
                    gate.waiters.delete(release)
                    if (error) reject(error)
                    else resolve()
                }
                const release = (): void => finish()
                const abort = (): void => finish(new Error('Request cancelled'))
                const timer = setTimeout(
                    () => finish(new Error(`Barrier timed out: ${name}`)),
                    options.barrierTimeoutMs ?? 45_000
                )
                gate.waiters.add(release)
                request.signal.addEventListener('abort', abort, { once: true })
            })
        } finally {
            blocked.delete(entry)
        }
    }

    const getState = (): MockState => structuredClone(state)
    const updateState = (patch: JsonObject): MockState => {
        mergeState(state, patch)
        return getState()
    }
    const clearCaptured = (): void => {
        captured = emptyCaptured()
        requests = []
        errors = []
    }
    const reset = (): void => {
        for (const controller of controllers) controller.abort()
        blocked.clear()
        gates.clear()
        for (const name of initialBarriers) holdBarrier(name)
        state = initialState()
        clearCaptured()
        sequence = 0
    }
    const inspect = (): Inspection => structuredClone({ ...captured, requests, blockedRequests: [...blocked], errors })
    const barriers = (): Record<string, boolean> =>
        Object.fromEntries([...gates].map(([key, gate]) => [key, gate.released]))

    function send(response: ServerResponse, value: MockResponse, record?: RequestRecord): void {
        if (response.destroyed || response.writableEnded) return
        const status = value.status ?? 200
        const bytes = value.body === undefined ? Buffer.from(JSON.stringify(value.json ?? {})) : Buffer.from(value.body)
        response.writeHead(status, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Cache-Control': 'no-store',
            'Content-Type': value.body === undefined ? 'application/json' : 'application/octet-stream',
            ...value.headers,
            'Content-Length': status === 204 ? 0 : bytes.length,
        })
        if (record) {
            record.status = status
            response.once('finish', () => {
                record.responseFinished = true
            })
        }
        response.end(status === 204 ? undefined : bytes)
    }

    function control(method: string, url: URL, body: JsonValue): MockResponse | undefined {
        const path = url.pathname
        if (method === 'GET' && path === '/__control/state') return { json: getState() }
        if (method === 'POST' && path === '/__control/state') {
            if (!isObject(body)) return { status: 400, json: { error: 'patch must be a JSON object' } }
            return { json: updateState(body) }
        }
        if (method === 'POST' && path === '/__control/reset') {
            reset()
            return { json: { reset: true } }
        }
        if (method === 'GET' && path === '/__control/barriers') return { json: barriers() }
        if (method === 'POST' && path === '/__control/release') {
            if (
                !isObject(body) ||
                !Array.isArray(body.barriers) ||
                !body.barriers.every((name) => typeof name === 'string')
            ) {
                return { status: 400, json: { error: 'barriers must be an array of names' } }
            }
            for (const name of body.barriers) releaseBarrier(name as string)
            return { json: { released: body.barriers } }
        }
        if (method === 'DELETE' && path === '/__captured') {
            clearCaptured()
            return { json: { cleared: true } }
        }
        if (method === 'GET' && path === '/__captured') {
            return { json: Object.fromEntries(Object.entries(captured).map(([key, items]) => [key, items.length])) }
        }
        if (method === 'GET' && path === '/__captured/all') return { json: inspect() as unknown as JsonObject }
        if (method === 'GET' && path.startsWith('/__captured/')) {
            const key = path.slice('/__captured/'.length)
            const all = inspect()
            if (Object.hasOwn(all, key)) {
                const list = all[key as keyof Inspection]
                const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10)
                return { json: list.slice(Number.isNaN(since) ? 0 : since) as JsonValue[] }
            }
        }
        return undefined
    }

    async function backend(endpoint: Endpoint, request: MockRequest): Promise<MockResponse> {
        await waitForBarrier(endpoint, request)
        const seconds = Number(state.delays[endpoint] ?? 0)
        if (seconds > 0) await delay(seconds * 1000, undefined, { signal: request.signal })
        request.signal.throwIfAborted()
        let response: MockResponse = { json: { status: 'ok' } }
        if (endpoint === 'config') {
            captured.config_calls.push({ ts: new Date().toISOString() })
            const config = buildConfigResponse(state)
            response = request.path.endsWith('/config.js')
                ? {
                      headers: { 'Content-Type': 'text/javascript' },
                      body: `window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {}; window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(state.projectToken)}] = {config: ${JSON.stringify(config)}};`,
                  }
                : { json: config }
        } else if (endpoint === 'flags') {
            captured.flags_calls.push(request.body)
            response = { json: buildFlagsResponse(state) }
        } else if (endpoint === 'surveys') {
            response = { json: { surveys: state.surveysEnabled ? state.surveys : [] } }
        } else if (endpoint === 'logs') {
            captured.logs.push(request.body)
        } else if (endpoint === 'snapshot') {
            captured.snapshots.push(...values(request.body))
        } else {
            const events = values(request.body)
            captured.events.push(...events)
            if (endpoint === 'captureV1') {
                response = {
                    json: {
                        results: Object.fromEntries(
                            events
                                .filter(isObject)
                                .filter((event) => typeof event.uuid === 'string')
                                .map((event) => [event.uuid, { result: 'ok' }])
                        ),
                    },
                }
            } else if (request.path.replace(/\/+$/, '') !== '/batch') response = { json: { status: 1 } }
        }
        if (state.force500[endpoint]) response = { status: 500, json: { status: 'forced_500' } }
        return options.respond ? options.respond(endpoint, request, response, getState()) : response
    }

    const server = createServer(async (incoming, response) => {
        const method = incoming.method ?? 'GET'
        let record: RequestRecord | undefined
        const controller = new AbortController()
        const isControl = incoming.url?.startsWith('/__control/') || incoming.url?.startsWith('/__captured')
        if (!isControl) controllers.add(controller)
        const cancel = (): void => controller.abort()
        response.once('close', cancel)
        try {
            const url = new URL(incoming.url ?? '/', origin)
            // This server can be used as a deny-only browser proxy. It never forwards traffic.
            if (incoming.headers.host !== new URL(origin!).host || url.origin !== origin) {
                errors.push(`Blocked proxy destination: ${incoming.headers.host ?? url.host}`)
                incoming.resume()
                send(response, { status: 403, json: { error: 'Outbound network blocked' } })
                return
            }
            if (method === 'OPTIONS') {
                incoming.resume()
                send(response, {
                    status: 204,
                    headers: {
                        'Access-Control-Allow-Headers': String(
                            incoming.headers['access-control-request-headers'] ?? '*'
                        ),
                        'Access-Control-Max-Age': '86400',
                    },
                })
                return
            }
            const chunks: Buffer[] = []
            for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
            controller.signal.throwIfAborted()
            const rawBytes = Buffer.concat(chunks)
            record = {
                id: ++sequence,
                method,
                path: url.pathname,
                query: Object.fromEntries(
                    [...new Set(url.searchParams.keys())].map((key) => [key, url.searchParams.getAll(key)])
                ),
                headers: { ...incoming.headers },
                rawBody: rawBytes.toString('utf8'),
                rawBodyBase64: rawBytes.toString('base64'),
                body: null,
                bodyWrapper: 'empty',
                contentType: incoming.headers['content-type'] ?? null,
                contentEncoding: incoming.headers['content-encoding'] ?? null,
                status: null,
                responseFinished: false,
            }
            if (!isControl) requests.push(record)
            try {
                Object.assign(record, decodeBody(rawBytes, incoming.headers, url))
            } catch (error) {
                record.decodeError = error instanceof Error ? error.message : String(error)
                throw error
            }
            const controlled = control(method, url, record.body)
            if (controlled) {
                send(response, controlled)
                return
            }
            const request: MockRequest = { ...record, url, rawBytes, signal: controller.signal }
            const context: AdapterContext = { getState, waitForBarrier: (name) => waitForBarrier(name, request) }
            const adapted = await options.adapter?.(request, context)
            controller.signal.throwIfAborted()
            const endpoint = endpointFor(method, url.pathname)
            const value = adapted ?? (endpoint ? await backend(endpoint, request) : undefined)
            controller.signal.throwIfAborted()
            if (value) send(response, value, record)
            else {
                errors.push(`Unexpected ${method}: ${url.pathname}`)
                send(response, { status: 404, json: { error: 'Unknown path' } }, record)
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (!controller.signal.aborted) errors.push(message)
            send(response, { status: controller.signal.aborted ? 503 : 400, json: { error: message } }, record)
        } finally {
            controllers.delete(controller)
            response.removeListener('close', cancel)
        }
    })
    server.on('connect', (incoming, socket) => {
        errors.push(`Blocked proxy CONNECT: ${incoming.url}`)
        socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    })

    return {
        start() {
            if (stopped) return Promise.reject(new Error('Mock server has stopped'))
            if (!startPromise)
                startPromise = new Promise<string>((resolve, reject) => {
                    server.once('error', reject)
                    server.listen(options.port ?? 0, '127.0.0.1', () => {
                        server.removeListener('error', reject)
                        const address = server.address()
                        if (!address || typeof address === 'string') return reject(new Error('No server address'))
                        origin = `http://127.0.0.1:${address.port}`
                        resolve(origin)
                    })
                })
            return startPromise
        },
        stop() {
            if (!stopPromise)
                stopPromise = (async () => {
                    stopped = true
                    if (startPromise) await startPromise.catch(() => {})
                    for (const controller of controllers) controller.abort()
                    await new Promise<void>((resolve, reject) => {
                        if (!server.listening) return resolve()
                        server.close((error) => (error ? reject(error) : resolve()))
                        server.closeAllConnections()
                    })
                    blocked.clear()
                })()
            return stopPromise
        },
        reset,
        getState,
        updateState,
        inspect,
        clearCaptured,
        holdBarrier,
        releaseBarrier,
        barriers,
    }
}
