import './helpers/posthog-instance'
import { PostHog } from '../posthog-core'
import { PostHogLogs } from '../posthog-logs'
import type { OtlpLogsPayload, PostHogConfig } from '../types'

const options: Partial<PostHogConfig> = {
    __preview_deferred_init_extensions: false,
    advanced_disable_flags: true,
    capture_pageview: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_conversations: true,
    disableDeviceModel: true,
    before_send: () => null,
    logs: { flushIntervalMs: 0 },
}
const bodies = (payload: OtlpLogsPayload) =>
    payload.resourceLogs.flatMap((resource) =>
        resource.scopeLogs.flatMap((scope) => scope.logRecords.map((r) => r.body))
    )
// Public legacy flush is fire-and-forget. Let request adaptation and queue settlement finish without firing retries.
const settle = async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve()
}
let sdk: PostHog
beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    sdk = new PostHog()
})
afterEach(async () => {
    await sdk.shutdown(0)
    vi.restoreAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
})

it('retains logs captured immediately after init through transient failures', async () => {
    sdk.init('logs-same-turn-init', { ...options, logs: { flushIntervalMs: 0, maxBufferSize: 200 } })
    for (let i = 0; i < 100; i++) sdk.captureLog({ body: `message-${i}` })
    await settle()
    expect((sdk.logs as any)._consecutiveStatusZeroFailures).toBe(0)
    expect((sdk.logs as any)._queue).toHaveLength(100)
    const delivered: unknown[] = []
    let attempts = 0
    const send = vi.spyOn(sdk, '_send_request').mockImplementation((request) => {
        const statusCode = ++attempts <= 2 ? 0 : 200
        if (statusCode === 200) delivered.push(...bodies(request.data as OtlpLogsPayload))
        void Promise.resolve().then(() => request.callback?.({ statusCode }))
    })
    for (let i = 1; i <= 2; i++) {
        sdk.logs!.flushLogs()
        await settle()
        expect(send).toHaveBeenCalledTimes(i)
        expect((sdk.logs as any)._queue).toHaveLength(100)
        expect((sdk.logs as any)._consecutiveStatusZeroFailures).toBe(i)
    }
    sdk.logs!.flushLogs()
    await settle()
    expect(send).toHaveBeenCalledTimes(3)
    expect(delivered).toEqual(Array.from({ length: 100 }, (_, i) => ({ stringValue: `message-${i}` })))
    expect((sdk.logs as any)._queue).toHaveLength(0)
})

it('resets the breaker before a reconnect listener registered after SDK construction captures', async () => {
    const onOnline = () => sdk.captureLog({ body: 'online' })
    // oxlint-disable-next-line posthog-js/no-add-event-listener
    window.addEventListener('online', onOnline)
    let online = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    sdk.init('logs-reconnect-order', { ...options, logs: { flushIntervalMs: 0, maxBufferSize: 1 } })
    let healthy = false
    const delivered: unknown[] = []
    const send = vi.spyOn(sdk, '_send_request').mockImplementation((request) => {
        if (healthy) delivered.push(...bodies(request.data as OtlpLogsPayload))
        const statusCode = healthy ? 200 : 0
        void Promise.resolve().then(() => request.callback?.({ statusCode }))
    })
    try {
        sdk.captureLog({ body: 'initial' })
        await settle()
        for (let i = 0; i < 2; i++) {
            sdk.logs!.flushLogs()
            await settle()
        }
        expect(send).toHaveBeenCalledTimes(3)
        expect((sdk.logs as any)._queue).toHaveLength(1)
        expect((sdk.logs as any)._consecutiveStatusZeroFailures).toBe(3)
        online = false
        window.dispatchEvent(new Event('offline'))
        await settle()
        healthy = true
        online = true
        window.dispatchEvent(new Event('online'))
        await settle()
        sdk.logs!.flushLogs()
        await settle()
        expect(delivered).toEqual([{ stringValue: 'initial' }, { stringValue: 'online' }])
        expect((sdk.logs as any)._queue).toHaveLength(0)
    } finally {
        window.removeEventListener('online', onOnline)
    }
})

it('registers reconnect once across construction, capture and setup without eagerly activating the client', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const getClient = vi.spyOn(sdk, '_getBrowserClientAdapter')
    const loader = vi.spyOn(PostHogLogs.prototype as any, '_getConsoleLoader')
    const originalLog = console.log
    const logs = new PostHogLogs(sdk)
    const onlineCalls = () => add.mock.calls.filter(([type]) => type === 'online')
    try {
        expect(onlineCalls()).toHaveLength(1)
        expect(getClient).not.toHaveBeenCalled()
        expect((sdk as any)._browserClientAdapter).toBeUndefined()
        expect(loader).not.toHaveBeenCalled()
        expect(console.log).toBe(originalLog)
        logs.captureLog({ body: 'early' })
        logs.setup(sdk._getBrowserClientAdapter())
        expect(onlineCalls()).toHaveLength(1)
    } finally {
        logs.dispose()
    }
    expect(remove).toHaveBeenCalledWith('online', onlineCalls()[0][1])
})

it('removes the constructor reconnect listener even if setup never runs', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const logs = new PostHogLogs(sdk)
    logs.dispose()
    const calls = add.mock.calls.filter(([type]) => type === 'online')
    expect(calls).toHaveLength(1)
    expect(remove).toHaveBeenCalledWith('online', calls[0][1])
})
