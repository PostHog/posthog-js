import { isArray, isBoolean, isNull, isUndefined } from '@posthog/core'

export interface RecordedEvent {
    readonly event: string
    readonly properties: Readonly<Record<string, unknown>>
}

export interface RecordedRequest {
    readonly kind: 'logical' | 'fetch' | 'beacon'
    readonly url: string
    readonly path: string
    readonly method: string
    readonly headers: Readonly<Record<string, string>>
    readonly query: Readonly<Record<string, string>>
    readonly body: unknown
}

export interface IdentityObservation {
    readonly anonymousId: string
    readonly distinctId: string
    readonly isIdentified: boolean
}

export interface BehaviorSetup {
    readonly optOutByDefault?: boolean
}

export type GeneratedIdRole = 'anonymous' | 'session' | 'window'

export interface GeneratedIdNormalizer {
    remember(role: GeneratedIdRole, value: unknown): void
    normalize(value: unknown, role?: GeneratedIdRole): unknown
}

export const createGeneratedIdNormalizer = (): GeneratedIdNormalizer => {
    const ids: Record<GeneratedIdRole, Map<unknown, string>> = {
        anonymous: new Map(),
        session: new Map(),
        window: new Map(),
    }
    const label = (role: GeneratedIdRole, index: number): string => `<${role}-id-${index}>`
    const remember = (role: GeneratedIdRole, value: unknown): void => {
        if (!isUndefined(value) && !isNull(value) && !ids[role].has(value)) {
            ids[role].set(value, label(role, ids[role].size + 1))
        }
    }

    return {
        remember,
        normalize(value, role = 'anonymous'): unknown {
            if ((role === 'session' || role === 'window') && !isUndefined(value) && !isNull(value)) {
                remember(role, value)
            }
            return ids[role].get(value) ?? value
        },
    }
}

export interface BehaviorClient {
    capture(event: string, properties?: Record<string, unknown> | null): Promise<void>
    identify(distinctId: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): Promise<void>
    group(type: string, key: string, properties?: Record<string, unknown>): Promise<void>
    reset(): void
    optIn(): void
    optOut(): void
    hasOptedOut(): boolean
    identity(): IdentityObservation
    groups(): Readonly<Record<string, string>>
    events(): readonly RecordedEvent[]
    requests(): readonly RecordedRequest[]
    normalizeId(value: unknown, role?: GeneratedIdRole): unknown
    dispose(): Promise<void>
}

export interface BehaviorAdapter {
    readonly name: 'legacy-browser' | 'browser-next'
    create(runtime: ControlledRuntime, setup?: BehaviorSetup): Promise<BehaviorClient>
}

export interface BehaviorScenario<Result> {
    readonly name: string
    /** Current browser-next target. Provisional when an open decision is named in the scenario. */
    readonly expected: Result
    /** Legacy behavior when it is an explicitly tracked product difference. */
    readonly legacyExpected?: Result
    readonly setup?: BehaviorSetup
    run(client: BehaviorClient, runtime: ControlledRuntime): Promise<Result>
}

export interface DifferentialResult<Result> {
    readonly legacy: Result
    readonly next: Result
}

const TEST_NOW = new Date('2026-01-02T03:04:05.000Z').getTime()

export class ControlledRuntime {
    readonly projectToken = 'ph_differential_test'
    private readonly _requests: RecordedRequest[] = []
    private readonly _navigatorDescriptors = new Map<string, PropertyDescriptor | undefined>()
    private readonly _previousLocalStorage = new Map<string, string>()
    private readonly _previousSessionStorage = new Map<string, string>()
    private readonly _windowListeners: Array<{
        type: string
        listener: EventListenerOrEventListenerObject
        capture: boolean
    }> = []
    private _windowAddListenerSpy: jest.SpyInstance | undefined
    private _removeWindowListener: Window['removeEventListener'] | undefined

    readonly navigator = {
        userAgent: 'PostHog Differential Browser',
        webdriver: false,
        sendBeacon: (url: string, data?: BodyInit | null): boolean => {
            this.recordRequest(this._request('beacon', new URL(url), 'POST', {}, data))
            return true
        },
    }

    install(): void {
        if ('clock' in setTimeout) {
            throw new Error('The differential harness must own the Jest timer mode')
        }
        this._snapshotStorage(localStorage, this._previousLocalStorage)
        this._snapshotStorage(sessionStorage, this._previousSessionStorage)
        localStorage.clear()
        sessionStorage.clear()
        jest.useFakeTimers({ now: TEST_NOW })
        this._setNavigatorProperty('userAgent', this.navigator.userAgent)
        this._setNavigatorProperty('webdriver', this.navigator.webdriver)
        this._setNavigatorProperty('sendBeacon', this.navigator.sendBeacon)
        const addWindowListener = window.addEventListener.bind(window)
        this._removeWindowListener = window.removeEventListener.bind(window)
        this._windowAddListenerSpy = jest
            .spyOn(window, 'addEventListener')
            .mockImplementation(
                (
                    type: string,
                    listener: EventListenerOrEventListenerObject,
                    options?: boolean | AddEventListenerOptions
                ): void => {
                    const capture = isBoolean(options) ? options : (options?.capture ?? false)
                    this._windowListeners.push({ type, listener, capture })
                    addWindowListener(type, listener, options)
                }
            )
    }

    advanceTime(milliseconds: number): void {
        jest.setSystemTime(Date.now() + milliseconds)
    }

    recordRequest(request: RecordedRequest): void {
        this._requests.push(request)
    }

    requests(): readonly RecordedRequest[] {
        return this._requests.map((request) => ({ ...request }))
    }

    storage(): Readonly<Record<string, string>> {
        const values: Record<string, string> = {}
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index)
            if (typeof key === 'string') {
                values[key] = localStorage.getItem(key) ?? ''
            }
        }
        return values
    }

    readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        const url = new URL(String(input))
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
        this.recordRequest(this._request('fetch', url, init.method ?? 'GET', new Headers(init.headers), body))

        let responseBody: unknown = {}
        if (url.pathname === '/i/v1/analytics/events' && body && typeof body === 'object' && 'batch' in body) {
            const batch = isArray(body.batch) ? body.batch : []
            responseBody = {
                results: Object.fromEntries(
                    batch.flatMap((event) =>
                        event && typeof event === 'object' && 'uuid' in event && typeof event.uuid === 'string'
                            ? [[event.uuid, { result: 'ok' }]]
                            : []
                    )
                ),
            }
        }
        return {
            status: 200,
            headers: new Headers({ 'Content-Type': 'application/json' }),
            text: async () => JSON.stringify(responseBody),
        } as Response
    }

    restore(): void {
        for (const { type, listener, capture } of this._windowListeners) {
            this._removeWindowListener?.(type, listener, capture)
        }
        this._windowListeners.splice(0)
        this._windowAddListenerSpy?.mockRestore()
        this._windowAddListenerSpy = undefined
        this._removeWindowListener = undefined
        for (const [name, descriptor] of this._navigatorDescriptors) {
            if (descriptor) {
                Object.defineProperty(globalThis.navigator, name, descriptor)
            } else {
                delete (globalThis.navigator as unknown as Record<string, unknown>)[name]
            }
        }
        this._navigatorDescriptors.clear()
        jest.useRealTimers()
        this._restoreStorage(localStorage, this._previousLocalStorage)
        this._restoreStorage(sessionStorage, this._previousSessionStorage)
    }

    private _snapshotStorage(storage: Storage, destination: Map<string, string>): void {
        for (let index = 0; index < storage.length; index++) {
            const key = storage.key(index)
            if (typeof key === 'string') {
                destination.set(key, storage.getItem(key) ?? '')
            }
        }
    }

    private _restoreStorage(storage: Storage, source: Map<string, string>): void {
        storage.clear()
        for (const [key, value] of source) {
            storage.setItem(key, value)
        }
        source.clear()
    }

    private _setNavigatorProperty(name: string, value: unknown): void {
        this._navigatorDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis.navigator, name))
        Object.defineProperty(globalThis.navigator, name, { configurable: true, value })
    }

    private _request(
        kind: RecordedRequest['kind'],
        url: URL,
        method: string,
        headers: Headers | Record<string, string>,
        body: unknown
    ): RecordedRequest {
        return {
            kind,
            url: url.toString(),
            path: url.pathname,
            method,
            headers: Object.fromEntries(new Headers(headers).entries()),
            query: Object.fromEntries(url.searchParams.entries()),
            body,
        }
    }
}

const runWithAdapter = async <Result>(
    adapter: BehaviorAdapter,
    scenario: BehaviorScenario<Result>
): Promise<Result> => {
    const runtime = new ControlledRuntime()
    runtime.install()
    let client: BehaviorClient | undefined
    try {
        client = await adapter.create(runtime, scenario.setup)
        return await scenario.run(client, runtime)
    } finally {
        try {
            await client?.dispose()
        } finally {
            runtime.restore()
        }
    }
}

export const runDifferentialScenario = async <Result>(
    adapters: { legacy: BehaviorAdapter; next: BehaviorAdapter },
    scenario: BehaviorScenario<Result>
): Promise<DifferentialResult<Result>> => ({
    legacy: await runWithAdapter(adapters.legacy, scenario),
    next: await runWithAdapter(adapters.next, scenario),
})

export const expectScenario = <Result>(
    scenario: BehaviorScenario<Result>,
    result: DifferentialResult<Result>
): void => {
    expect(result.legacy).toEqual(scenario.legacyExpected ?? scenario.expected)
    expect(result.next).toEqual(scenario.expected)
}
