import { createPostHog } from '@posthog/browser'
import type { BrowserFetch, Extension, PostHog, RemoteConfig } from '@posthog/browser'

import './style.css'
import { EventQueueVisualizer } from './queue-visualizer'

const TEST_EVENT_PREFIX = 'real_posthog_test_'
const TEST_DISTINCT_ID_PREFIX = 'real-posthog-test-'
const DEFAULT_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
const PROJECT_URL = import.meta.env.VITE_POSTHOG_WEB_URL || 'https://us.posthog.com/project/225020'
const PROJECT_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN || ''
const randomPart = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)
const runId = `real-ph-browser-next-${Date.now()}-${randomPart}`

let client: PostHog | undefined
let deliveryOnline = navigator.onLine
let operation = Promise.resolve()

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
    throw new Error('Missing #app')
}

app.innerHTML = `
    <header class="hero">
        <div>
            <p class="eyebrow">Experimental SDK playground</p>
            <h1>browser-next × real PostHog</h1>
            <p>Exercise bounded Capture V1 delivery against the shared synthetic-data project.</p>
        </div>
        <a class="project-link" href="${PROJECT_URL}" target="_blank" rel="noreferrer">Open PostHog project ↗</a>
    </header>

    <main>
        <section class="status-strip" aria-label="SDK status">
            <div><span>Client</span><strong id="client-status">not initialized</strong></div>
            <div><span>Analytics</span><strong id="analytics-status">not installed</strong></div>
            <div><span>Network</span><strong id="network-status">${navigator.onLine ? 'online' : 'offline'}</strong></div>
            <div><span>Consent</span><strong id="consent-status">—</strong></div>
        </section>

        <section class="panel configuration">
            <div class="section-heading">
                <div><p class="eyebrow">Configuration</p><h2>Delivery controls</h2></div>
                <button id="initialize" class="primary">Initialize / restart</button>
            </div>
            <div class="grid fields">
                <label>API host<input id="host" value="${DEFAULT_HOST}" spellcheck="false" /></label>
                <label>Project token<input id="token" value="${maskToken(PROJECT_TOKEN)}" disabled /></label>
                <label>Flush at<input id="flush-at" type="number" min="1" max="100" value="3" /></label>
                <label>Flush interval (ms)<input id="flush-interval" type="number" min="0" value="3000" /></label>
            </div>
            <div class="checks">
                <label><input id="install-on-init" type="checkbox" /> Install analytics explicitly on initialize</label>
                <label><input id="disable-auto" type="checkbox" /> Disable automatic lazy analytics</label>
                <label><input id="gzip" type="checkbox" checked /> Advertise native gzip</label>
                <label><input id="debug" type="checkbox" checked /> SDK debug logs</label>
            </div>
            <p class="hint">Bot filtering is disabled only for this synthetic playground so headless browsers can send test events. Automatic pageviews are disabled.</p>
        </section>

        <div class="columns">
            <section class="panel">
                <div class="section-heading"><div><p class="eyebrow">Analytics</p><h2>Capture and delivery</h2></div></div>
                <label>Event suffix<input id="event-suffix" value="browser_next_sandbox" spellcheck="false" /></label>
                <label>Event properties<textarea id="properties" rows="5" spellcheck="false">{
  "interaction": "manual"
}</textarea></label>
                <div class="button-grid">
                    <button id="capture" class="primary">Capture one</button>
                    <button id="capture-five">Queue five</button>
                    <button id="capture-large">Capture 16 KiB</button>
                    <button id="flush">Flush now</button>
                </div>
            </section>

            <section class="panel">
                <div class="section-heading"><div><p class="eyebrow">State</p><h2>Identity and lifecycle</h2></div></div>
                <label>Distinct ID suffix<input id="distinct-id-suffix" value="browser-next-${randomPart}" spellcheck="false" /></label>
                <div class="button-grid">
                    <button id="identify">Identify synthetic user</button>
                    <button id="group">Set sandbox group</button>
                    <button id="reset">Reset identity</button>
                    <button id="opt-in">Opt in</button>
                    <button id="opt-out">Opt out + purge</button>
                    <button id="offline">Dispatch offline</button>
                    <button id="online">Dispatch online</button>
                    <button id="pagehide">Dispatch pagehide</button>
                    <button id="shutdown" class="danger">Shutdown</button>
                </div>
                <dl class="identity">
                    <div><dt>Run ID</dt><dd id="run-id"></dd></div>
                    <div><dt>Distinct ID</dt><dd id="distinct-id">—</dd></div>
                    <div><dt>Anonymous ID</dt><dd id="anonymous-id">—</dd></div>
                    <div><dt>Session ID</dt><dd id="session-id">—</dd></div>
                    <div><dt>Window ID</dt><dd id="window-id">—</dd></div>
                </dl>
            </section>
        </div>

        <section class="panel queue-panel">
            <div class="section-heading">
                <div>
                    <p class="eyebrow">Delivery pipeline</p>
                    <h2>Observed event queue</h2>
                </div>
                <div class="queue-actions">
                    <label><input id="show-metadata" type="checkbox" /> Show identity, session, and sent metadata</label>
                    <button id="clear-settled">Clear settled</button>
                </div>
            </div>
            <p class="hint queue-hint">Sandbox-only view inferred from admitted-event notifications and decoded Capture V1 requests. No queue instrumentation is added to the SDK bundle.</p>
            <div class="queue-lanes">
                <section>
                    <h3>Buffered <span id="buffered-count">0</span></h3>
                    <div id="buffered-events" class="queue-list"></div>
                </section>
                <section>
                    <h3>In flight <span id="sending-count">0</span></h3>
                    <div id="sending-events" class="queue-list"></div>
                </section>
                <section>
                    <h3>Settled <span id="settled-count">0</span></h3>
                    <div id="settled-events" class="queue-list"></div>
                </section>
            </div>
        </section>

        <section class="panel logs-panel">
            <div class="section-heading">
                <div><p class="eyebrow">Observability</p><h2>Sandbox and request log</h2></div>
                <button id="clear-log">Clear</button>
            </div>
            <ol id="log" class="log" aria-live="polite"></ol>
        </section>
    </main>
`

function element<T extends HTMLElement>(id: string): T {
    const value = document.querySelector<T>(`#${id}`)
    if (!value) {
        throw new Error(`Missing #${id}`)
    }
    return value
}

const logElement = element<HTMLOListElement>('log')
const queue = new EventQueueVisualizer({
    buffered: element<HTMLElement>('buffered-events'),
    sending: element<HTMLElement>('sending-events'),
    settled: element<HTMLElement>('settled-events'),
    bufferedCount: element<HTMLElement>('buffered-count'),
    sendingCount: element<HTMLElement>('sending-count'),
    settledCount: element<HTMLElement>('settled-count'),
})
const runIdElement = element<HTMLElement>('run-id')
runIdElement.textContent = runId
runIdElement.title = 'Click to copy'
runIdElement.addEventListener('click', () => {
    void navigator.clipboard?.writeText(runId)
    log('sandbox', 'Copied run ID')
})

function maskToken(token: string): string {
    return token ? 'configured — not displayed' : 'missing — launch with pnpm dev:real'
}

function log(kind: 'sandbox' | 'event' | 'request' | 'error', message: string): void {
    const item = document.createElement('li')
    const time = document.createElement('time')
    time.textContent = new Date().toLocaleTimeString()
    const badge = document.createElement('span')
    badge.className = `badge ${kind}`
    badge.textContent = kind
    const text = document.createElement('span')
    text.textContent = message
    item.append(time, badge, text)
    logElement.prepend(item)
    while (logElement.childElementCount > 200) {
        logElement.lastElementChild?.remove()
    }
}

function bodyBytes(body: BodyInit | null | undefined): number | undefined {
    if (typeof body === 'string') {
        return new TextEncoder().encode(body).byteLength
    }
    if (body instanceof Blob) {
        return body.size
    }
    if (body instanceof ArrayBuffer) {
        return body.byteLength
    }
    if (ArrayBuffer.isView(body)) {
        return body.byteLength
    }
    return undefined
}

const sandboxFetch: BrowserFetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const observedRequest = queue.observeRequest(url, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const bytes = bodyBytes(init?.body)
    const detail = [
        `${method} ${new URL(url, location.href).pathname}`,
        bytes === undefined ? undefined : `${bytes.toLocaleString()} B`,
        headers.get('content-encoding') ?? 'plain',
        init?.keepalive ? 'keepalive' : undefined,
    ]
        .filter(Boolean)
        .join(' · ')
    log('request', `→ ${detail}`)
    try {
        const response = await globalThis.fetch(input, init)
        queue.observeResponse(observedRequest, response)
        log('request', `← ${response.status} ${response.statusText || 'response'}`)
        return response
    } catch (error) {
        queue.observeFailure(observedRequest, error)
        log('error', `Request failed: ${describeError(error)}`)
        throw error
    }
}

function remoteConfig(compression: boolean): RemoteConfig {
    return {
        supportedCompression: compression ? ['gzip-js'] : [],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
    } as RemoteConfig
}

function numberValue(id: string, fallback: number): number {
    const value = Number(element<HTMLInputElement>(id).value)
    return Number.isFinite(value) ? value : fallback
}

function safeSuffix(value: string, fallback: string): string {
    const normalized = value
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return normalized || fallback
}

function eventName(): string {
    return `${TEST_EVENT_PREFIX}${safeSuffix(element<HTMLInputElement>('event-suffix').value, 'browser_next_sandbox')}`
}

function syntheticProperties(additional: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ...additional,
        test_run_id: runId,
        source: 'browser-next-sandbox',
        synthetic: true,
        $process_person_profile: false,
    }
}

function configuredProperties(): Record<string, unknown> {
    const parsed: unknown = JSON.parse(element<HTMLTextAreaElement>('properties').value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Event properties must be a JSON object')
    }
    return parsed as Record<string, unknown>
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function enqueue(label: string, action: () => Promise<void> | void): void {
    operation = operation
        .then(async () => {
            await action()
            refreshStatus()
        })
        .catch((error) => {
            log('error', `${label}: ${describeError(error)}`)
            refreshStatus()
        })
}

async function initialize(): Promise<void> {
    if (!PROJECT_TOKEN) {
        throw new Error('Missing VITE_POSTHOG_PROJECT_TOKEN. Start the playground with pnpm dev:real.')
    }
    if (client) {
        await client.shutdown(1_000)
        queue.purgePending('client restarted')
    }
    client = undefined
    deliveryOnline = navigator.onLine

    const host = element<HTMLInputElement>('host').value.trim() || DEFAULT_HOST
    const installExplicitly = element<HTMLInputElement>('install-on-init').checked
    const extensions: Extension[] = []
    if (installExplicitly) {
        const { analytics } = await import('@posthog/browser/analytics')
        extensions.push(
            analytics({
                flushAt: numberValue('flush-at', 3),
                flushInterval: numberValue('flush-interval', 3_000),
            })
        )
    }
    const posthog = await createPostHog({
        projectToken: PROJECT_TOKEN,
        apiHost: host,
        capturePageview: false,
        disableBotDetection: true,
        debug: element<HTMLInputElement>('debug').checked,
        analytics:
            installExplicitly || element<HTMLInputElement>('disable-auto').checked
                ? false
                : {
                      flushAt: numberValue('flush-at', 3),
                      flushInterval: numberValue('flush-interval', 3_000),
                  },
        extensions,
        fetch: sandboxFetch,
        consentPersistenceName: '__ph_browser_next_real_sandbox_consent',
        remoteConfig: remoteConfig(element<HTMLInputElement>('gzip').checked),
    })
    posthog.registerDynamicEventProperties(() => syntheticProperties())
    posthog.onEvent(({ event, properties }) => {
        queue.admit(event, properties)
        log('event', `admitted ${event}`)
    })
    posthog.onNewSession(({ reason, sessionId, windowId }) =>
        log('sandbox', `new ${reason} session ${sessionId.slice(0, 8)}… / window ${windowId.slice(0, 8)}…`)
    )
    client = posthog
    log('sandbox', `Initialized against ${host}`)
}

function requireClient(): PostHog {
    if (!client) {
        throw new Error('Initialize the client first')
    }
    return client
}

function refreshStatus(): void {
    element<HTMLElement>('client-status').textContent = client ? 'ready' : 'not initialized'
    element<HTMLElement>('analytics-status').textContent = client?.getExtension('analytics')
        ? 'installed'
        : 'not installed'
    element<HTMLElement>('network-status').textContent = deliveryOnline ? 'online' : 'paused by offline hint'
    element<HTMLElement>('consent-status').textContent = client ? (client.hasOptedOut() ? 'opted out' : 'allowed') : '—'
    element<HTMLElement>('distinct-id').textContent = client?.distinctId || '—'
    element<HTMLElement>('anonymous-id').textContent = client?.anonymousId || '—'
    element<HTMLElement>('session-id').textContent = client?.session.sessionId || '—'
    element<HTMLElement>('window-id').textContent = client?.session.windowId || '—'
}

element<HTMLButtonElement>('initialize').addEventListener('click', () => enqueue('Initialize', initialize))
element<HTMLButtonElement>('capture').addEventListener('click', () =>
    enqueue('Capture', async () => {
        await requireClient().capture(eventName(), syntheticProperties(configuredProperties()))
    })
)
element<HTMLButtonElement>('capture-five').addEventListener('click', () =>
    enqueue('Queue five', async () => {
        const posthog = requireClient()
        const properties = configuredProperties()
        for (let index = 1; index <= 5; index++) {
            await posthog.capture(eventName(), syntheticProperties({ ...properties, batch_index: index }))
        }
    })
)
element<HTMLButtonElement>('capture-large').addEventListener('click', () =>
    enqueue('Capture large event', async () => {
        await requireClient().capture(
            `${TEST_EVENT_PREFIX}browser_next_large_payload`,
            syntheticProperties({ payload: 'browser-next-compression-'.repeat(700) })
        )
    })
)
element<HTMLButtonElement>('flush').addEventListener('click', () =>
    enqueue('Flush', async () => {
        await requireClient().flush()
        log('sandbox', 'Flush drive completed')
    })
)
element<HTMLButtonElement>('identify').addEventListener('click', () =>
    enqueue('Identify', async () => {
        const suffix = safeSuffix(element<HTMLInputElement>('distinct-id-suffix').value, `browser-next-${randomPart}`)
        await requireClient().identify(
            `${TEST_DISTINCT_ID_PREFIX}${suffix}`,
            syntheticProperties({ sandbox_user: true })
        )
    })
)
element<HTMLButtonElement>('group').addEventListener('click', () =>
    enqueue('Group', async () => {
        await requireClient().group('sandbox_run', runId, syntheticProperties({ sandbox_group: true }))
    })
)
element<HTMLButtonElement>('reset').addEventListener('click', () =>
    enqueue('Reset', () => {
        requireClient().reset()
        log('sandbox', 'Reset identity and session state')
    })
)
element<HTMLButtonElement>('opt-in').addEventListener('click', () =>
    enqueue('Opt in', () => {
        requireClient().optIn()
        log('sandbox', 'Capture opted in')
    })
)
element<HTMLButtonElement>('opt-out').addEventListener('click', () =>
    enqueue('Opt out', () => {
        requireClient().optOut()
        queue.purgePending('consent revoked')
        log('sandbox', 'Capture opted out; queued work purged')
    })
)
element<HTMLButtonElement>('offline').addEventListener('click', () => {
    globalThis.dispatchEvent(new Event('offline'))
    log('sandbox', 'Dispatched offline lifecycle hint')
})
element<HTMLButtonElement>('online').addEventListener('click', () => {
    globalThis.dispatchEvent(new Event('online'))
    log('sandbox', 'Dispatched online lifecycle hint')
})
element<HTMLButtonElement>('pagehide').addEventListener('click', () => {
    globalThis.dispatchEvent(new Event('pagehide'))
    log('sandbox', 'Dispatched pagehide teardown handoff')
})
element<HTMLButtonElement>('shutdown').addEventListener('click', () =>
    enqueue('Shutdown', async () => {
        await requireClient().shutdown(1_000)
        queue.purgePending('client shutdown')
        client = undefined
        log('sandbox', 'Shutdown completed')
    })
)
element<HTMLButtonElement>('clear-log').addEventListener('click', () => {
    logElement.replaceChildren()
})
element<HTMLButtonElement>('clear-settled').addEventListener('click', () => {
    queue.clearSettled()
})
element<HTMLInputElement>('show-metadata').addEventListener('change', () => {
    queue.setShowMetadata(element<HTMLInputElement>('show-metadata').checked)
})

globalThis.addEventListener('online', () => {
    deliveryOnline = true
    refreshStatus()
})
globalThis.addEventListener('offline', () => {
    deliveryOnline = false
    refreshStatus()
})
globalThis.setInterval(refreshStatus, 500)

refreshStatus()
log('sandbox', `Run ID: ${runId}`)
if (PROJECT_TOKEN) {
    enqueue('Initialize', initialize)
} else {
    log('error', 'No project token loaded. Stop this server and run pnpm dev:real.')
}
