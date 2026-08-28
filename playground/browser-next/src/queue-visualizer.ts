type QueueState = 'buffered' | 'sending' | 'retry' | 'delivered' | 'dropped' | 'purged'

interface ObservedEvent {
    id: number
    event: string
    admittedAt: number
    state: QueueState
    uuid?: string
    attempts: number
    detail?: string
    distinctId?: string
    sessionId?: string
    windowId?: string
    sentMetadata?: {
        event: Record<string, unknown>
        request: Record<string, unknown>
    }
}

interface CaptureBatchEvent {
    event: string
    uuid: string
    payload: Record<string, unknown>
}

interface CaptureEnvelope {
    batch: CaptureBatchEvent[]
}

export interface ObservedRequest {
    readonly captureV1: boolean
    readonly keepalive: boolean
    readonly events: Promise<CaptureBatchEvent[]>
}

interface QueueElements {
    buffered: HTMLElement
    sending: HTMLElement
    settled: HTMLElement
    bufferedCount: HTMLElement
    sendingCount: HTMLElement
    settledCount: HTMLElement
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const parseEnvelope = (text: string): CaptureEnvelope | undefined => {
    try {
        const value: unknown = JSON.parse(text)
        if (!isRecord(value) || !Array.isArray(value.batch)) {
            return undefined
        }
        const batch: CaptureBatchEvent[] = []
        for (const item of value.batch) {
            if (!isRecord(item) || typeof item.event !== 'string' || typeof item.uuid !== 'string') {
                return undefined
            }
            batch.push({ event: item.event, uuid: item.uuid, payload: item })
        }
        return { batch }
    } catch {
        return undefined
    }
}

const bodyBlob = (body: BodyInit): Blob | undefined => {
    if (body instanceof Blob) {
        return body
    }
    if (typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        try {
            return new Blob([body as BlobPart])
        } catch {
            return undefined
        }
    }
    return undefined
}

const readRequestBody = async (body: BodyInit | null | undefined, gzip: boolean): Promise<string> => {
    if (typeof body === 'string') {
        return body
    }
    if (!body) {
        return ''
    }
    const blob = bodyBlob(body)
    if (!blob) {
        return ''
    }
    if (!gzip) {
        return blob.text()
    }
    try {
        const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'))
        return await new Response(stream).text()
    } catch {
        return ''
    }
}

const stringValue = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

const shortId = (value: string): string => (value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`)

const formatAge = (timestamp: number): string => {
    const elapsed = Math.max(0, Date.now() - timestamp)
    if (elapsed < 1_000) {
        return '<1s'
    }
    if (elapsed < 60_000) {
        return `${Math.floor(elapsed / 1_000)}s`
    }
    return `${Math.floor(elapsed / 60_000)}m`
}

const isSensitiveMetadataKey = (key: string): boolean => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    return [
        'authorization',
        'auth',
        'token',
        'apikey',
        'password',
        'passwd',
        'secret',
        'privatekey',
        'credential',
    ].some(
        (sensitive) => normalized === sensitive || normalized.startsWith(sensitive) || normalized.endsWith(sensitive)
    )
}

const redactMetadata = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(redactMetadata)
    }
    if (!isRecord(value)) {
        return value
    }
    const redacted: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
        redacted[key] = isSensitiveMetadataKey(key) ? '[redacted]' : redactMetadata(item)
    }
    return redacted
}

const requestMetadata = (url: string, headers: Headers, keepalive: boolean): Record<string, unknown> => ({
    endpoint: new URL(url, location.href).pathname,
    content_type: headers.get('content-type'),
    content_encoding: headers.get('content-encoding') ?? 'plain',
    attempt: headers.get('posthog-attempt'),
    request_id: headers.get('posthog-request-id'),
    request_timestamp: headers.get('posthog-request-timestamp'),
    sdk_info: headers.get('posthog-sdk-info'),
    keepalive,
})

const resultFor = (body: unknown, uuid: string): { result?: string; details?: string } | undefined => {
    if (!isRecord(body) || !isRecord(body.results)) {
        return undefined
    }
    const result = body.results[uuid]
    if (!isRecord(result)) {
        return undefined
    }
    return {
        ...(typeof result.result === 'string' ? { result: result.result } : {}),
        ...(typeof result.details === 'string' ? { details: result.details } : {}),
    }
}

export class EventQueueVisualizer {
    private readonly events: ObservedEvent[] = []
    private readonly byUuid = new Map<string, ObservedEvent>()
    private readonly elements: QueueElements
    private nextId = 0
    private generation = 0
    private showMetadata = false

    constructor(elements: QueueElements) {
        this.elements = elements
        globalThis.setInterval(() => this.render(), 1_000)
        this.render()
    }

    setShowMetadata(show: boolean): void {
        this.showMetadata = show
        this.render()
    }

    admit(event: string, properties: Readonly<Record<string, unknown>> = {}): void {
        this.events.push({
            id: ++this.nextId,
            event,
            admittedAt: Date.now(),
            state: 'buffered',
            attempts: 0,
            distinctId: stringValue(properties.distinct_id),
            sessionId: stringValue(properties.$session_id),
            windowId: stringValue(properties.$window_id),
        })
        if (this.events.length > 200) {
            const removed = this.events.shift()
            if (removed?.uuid) {
                this.byUuid.delete(removed.uuid)
            }
        }
        this.render()
    }

    observeRequest(url: string, init?: RequestInit): ObservedRequest {
        const captureV1 = new URL(url, location.href).pathname === '/i/v1/analytics/events'
        const keepalive = init?.keepalive === true
        if (!captureV1) {
            return { captureV1, keepalive, events: Promise.resolve([]) }
        }
        const headers = new Headers(init?.headers)
        const metadata = requestMetadata(url, headers, keepalive)
        const generation = this.generation
        const events = readRequestBody(init?.body, headers.get('content-encoding') === 'gzip').then((text) => {
            const batch = parseEnvelope(text)?.batch ?? []
            if (generation !== this.generation) {
                return batch
            }
            for (const item of batch) {
                let observed = this.byUuid.get(item.uuid)
                if (!observed) {
                    observed = this.events.find(
                        (candidate) =>
                            candidate.event === item.event &&
                            candidate.uuid === undefined &&
                            (candidate.state === 'buffered' || candidate.state === 'retry')
                    )
                }
                if (!observed) {
                    observed = {
                        id: ++this.nextId,
                        event: item.event,
                        admittedAt: Date.now(),
                        state: keepalive ? 'buffered' : 'sending',
                        attempts: 0,
                    }
                    this.events.push(observed)
                }
                if (observed.state === 'purged') {
                    continue
                }
                observed.uuid = item.uuid
                observed.distinctId = stringValue(item.payload.distinct_id) ?? observed.distinctId
                observed.sessionId = stringValue(item.payload.session_id) ?? observed.sessionId
                observed.windowId = stringValue(item.payload.window_id) ?? observed.windowId
                observed.sentMetadata = {
                    event: redactMetadata(item.payload) as Record<string, unknown>,
                    request: metadata,
                }
                if (keepalive) {
                    if (observed.state === 'buffered' || observed.state === 'retry' || observed.state === 'sending') {
                        observed.detail = 'keepalive handoff attempted; queue retained'
                    }
                } else {
                    observed.state = 'sending'
                    observed.attempts++
                    observed.detail = undefined
                }
                this.byUuid.set(item.uuid, observed)
            }
            this.render()
            return batch
        })
        return { captureV1, keepalive, events }
    }

    observeResponse(request: ObservedRequest, response: Response): void {
        if (!request.captureV1) {
            return
        }
        let responseBody: Promise<unknown>
        try {
            responseBody = response
                .clone()
                .text()
                .then((text) => (text ? (JSON.parse(text) as unknown) : undefined))
                .catch(() => undefined)
        } catch {
            responseBody = Promise.resolve(undefined)
        }
        void Promise.all([request.events, responseBody]).then(([events, body]) => {
            for (const item of events) {
                const observed = this.byUuid.get(item.uuid)
                if (!observed || observed.state === 'purged') {
                    continue
                }
                if (request.keepalive) {
                    if (observed.state === 'buffered' || observed.state === 'retry' || observed.state === 'sending') {
                        observed.detail = `keepalive handoff HTTP ${response.status}; queue retained`
                    }
                    continue
                }
                const outcome = resultFor(body, item.uuid)
                if (response.status >= 200 && response.status < 300) {
                    if (!isRecord(body) || (body.results !== undefined && !isRecord(body.results))) {
                        observed.state = 'dropped'
                        observed.detail = 'unparseable response; sender removed event'
                    } else if (outcome?.result === 'retry') {
                        observed.state = 'retry'
                        observed.detail = outcome.details ?? 'server requested retry'
                    } else if (outcome?.result === 'drop') {
                        observed.state = 'dropped'
                        observed.detail = outcome.details ?? 'server dropped event'
                    } else {
                        observed.state = 'delivered'
                        observed.detail = `${response.status}`
                    }
                } else if ([408, 500, 502, 503, 504].includes(response.status)) {
                    observed.state = 'retry'
                    observed.detail = `HTTP ${response.status}`
                } else {
                    observed.state = 'dropped'
                    observed.detail = `HTTP ${response.status}`
                }
            }
            this.render()
        })
    }

    observeFailure(request: ObservedRequest, error: unknown): void {
        if (!request.captureV1) {
            return
        }
        void request.events.then((events) => {
            for (const item of events) {
                const observed = this.byUuid.get(item.uuid)
                if (!observed || observed.state === 'purged') {
                    continue
                }
                if (request.keepalive) {
                    if (observed.state === 'buffered' || observed.state === 'retry' || observed.state === 'sending') {
                        observed.detail = 'keepalive handoff failed; queue retained'
                    }
                } else {
                    observed.state = 'retry'
                    observed.detail = error instanceof Error ? error.message : 'network failure'
                }
            }
            this.render()
        })
    }

    purgePending(reason = 'purged locally'): void {
        this.generation++
        for (const event of this.events) {
            if (event.state === 'buffered' || event.state === 'sending' || event.state === 'retry') {
                event.state = 'purged'
                event.detail = reason
            }
        }
        this.render()
    }

    clearSettled(): void {
        for (let index = this.events.length - 1; index >= 0; index--) {
            const event = this.events[index]!
            if (event.state === 'delivered' || event.state === 'dropped' || event.state === 'purged') {
                this.events.splice(index, 1)
                if (event.uuid) {
                    this.byUuid.delete(event.uuid)
                }
            }
        }
        this.render()
    }

    private card(event: ObservedEvent): HTMLElement {
        const card = document.createElement('article')
        card.className = `queue-card ${event.state}`
        const heading = document.createElement('strong')
        heading.textContent = event.event
        const meta = document.createElement('span')
        meta.textContent = [
            event.state,
            `age ${formatAge(event.admittedAt)}`,
            event.attempts ? `${event.attempts} attempt${event.attempts === 1 ? '' : 's'}` : undefined,
        ]
            .filter(Boolean)
            .join(' · ')
        card.append(heading, meta)
        const identity = [
            event.distinctId ? `did ${shortId(event.distinctId)}` : undefined,
            event.sessionId ? `sid ${shortId(event.sessionId)}` : undefined,
            event.windowId ? `wid ${shortId(event.windowId)}` : undefined,
        ].filter(Boolean)
        if (identity.length) {
            const ids = document.createElement('small')
            ids.className = 'queue-identities'
            ids.textContent = identity.join(' · ')
            ids.title = [
                event.distinctId ? `distinct_id: ${event.distinctId}` : undefined,
                event.sessionId ? `session_id: ${event.sessionId}` : undefined,
                event.windowId ? `window_id: ${event.windowId}` : undefined,
            ]
                .filter(Boolean)
                .join('\n')
            card.append(ids)
        }
        if (event.uuid || event.detail) {
            const detail = document.createElement('small')
            detail.textContent = [event.uuid ? `${event.uuid.slice(0, 8)}…` : undefined, event.detail]
                .filter(Boolean)
                .join(' · ')
            card.append(detail)
        }
        if (this.showMetadata && event.sentMetadata) {
            const disclosure = document.createElement('details')
            disclosure.className = 'queue-metadata'
            const summary = document.createElement('summary')
            summary.textContent = 'Latest sent metadata'
            const metadata = document.createElement('pre')
            metadata.textContent = JSON.stringify(event.sentMetadata, null, 2)
            disclosure.append(summary, metadata)
            card.append(disclosure)
        }
        return card
    }

    private renderLane(target: HTMLElement, events: ObservedEvent[], empty: string): void {
        if (events.length === 0) {
            const message = document.createElement('p')
            message.className = 'queue-empty'
            message.textContent = empty
            target.replaceChildren(message)
            return
        }
        target.replaceChildren(
            ...events
                .slice(-30)
                .reverse()
                .map((event) => this.card(event))
        )
    }

    private render(): void {
        const buffered = this.events.filter((event) => event.state === 'buffered' || event.state === 'retry')
        const sending = this.events.filter((event) => event.state === 'sending')
        const settled = this.events.filter(
            (event) => event.state === 'delivered' || event.state === 'dropped' || event.state === 'purged'
        )
        this.elements.bufferedCount.textContent = String(buffered.length)
        this.elements.sendingCount.textContent = String(sending.length)
        this.elements.settledCount.textContent = String(settled.length)
        this.renderLane(this.elements.buffered, buffered, 'No buffered events')
        this.renderLane(this.elements.sending, sending, 'No active requests')
        this.renderLane(this.elements.settled, settled, 'No settled events')
    }
}
