import type { Mock } from 'vitest'
// @vitest-environment jsdom
import { initializeLogs, replayConsoleBuffer, type ConsoleLogsHost } from '../src/console-logs'
import { PostHogLogs } from '../src/logs'
import type { ConsoleLogsLoader } from '../src/logs-types'
import { createTestClient, type TestClient } from './helpers/test-client'

describe('console recorder handover', () => {
    let client: TestClient
    let host: ConsoleLogsHost
    let logs: PostHogLogs
    let realConsoleLog: Mock
    let mockEmit: Mock
    let capturedBuffered: Mock
    let savedConsole: Console
    beforeEach(() => {
        savedConsole = window.console
        realConsoleLog = vi.fn()
        mockEmit = vi.fn()
        capturedBuffered = vi.fn()
        window.console = {
            log: realConsoleLog,
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as Console
        client = createTestClient({
            distinctId: 'user-123',
            session: { sessionId: 'session-123', windowId: 'window-456', sessionStartTimestamp: 0 },
        })
        client.kv.set('consoleCaptureEnabled', true)
        host = {
            console: window.console,
            hostname: 'example.com',
            getCapturingLogs: () => ({ captureConsoleLog: mockEmit, captureBufferedConsoleLog: capturedBuffered }),
        }
        logs = new (class extends PostHogLogs {
            protected override _getConsoleLoader(): ConsoleLogsLoader {
                return (callback) =>
                    callback(undefined, {
                        initialize: () => initializeLogs(host),
                        replay: (_client, entries) => replayConsoleBuffer(host, entries),
                    })
            }
        })({ get: () => undefined, captureHintKey: 'consoleCaptureEnabled', remoteConfigWillArrive: true }, () => ({
            distinctId: client.distinctId,
            ...client.session,
        }))
    })
    afterEach(() => {
        logs.dispose()
        client.dispose()
        window.console = savedConsole
    })

    it('removes the temporary recorder from the console chain once the entrypoint takes over', () => {
        logs.setup(client)
        expect((logs as any)._isRecordingConsole).toBe(true)
        const recorder: any = host.console.log
        expect(recorder.__posthog_layer__).toBeDefined()

        logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

        expect((logs as any)._isRecordingConsole).toBe(false)
        // The entrypoint's wrapper now sits directly on the real console: the
        // recorder is neither on top of the chain nor buried inside it.
        const wrapper: any = host.console.log
        expect(wrapper).not.toBe(recorder)
        expect(wrapper.__rrweb_original__).toBe(realConsoleLog)
        expect(recorder.__posthog_layer__.next).toBe(realConsoleLog)

        let recorderRan = false
        recorder.__posthog_layer__.next = () => {
            recorderRan = true
        }
        host.console.log('after handover')
        expect(recorderRan).toBe(false)
    })

    it.each(['debug', 'log', 'warn', 'error', 'info'] as const)(
        'maps a buffered console.%s to its log severity',
        (level) => {
            logs.setup(client)
            ;(host.console[level] as any)('early')

            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

            const [options] = capturedBuffered.mock.calls[0]!
            expect(options.attributes['log.source']).toBe(`console.${level}`)
            expect(options.level).toBe(
                { debug: 'debug', log: 'info', warn: 'warn', error: 'error', info: 'info' }[level]
            )
        }
    )

    it('keeps replaying after one entry fails to capture', () => {
        logs.setup(client)
        host.console.log('first')
        host.console.log('second')
        host.console.log('third')

        capturedBuffered.mockImplementation((options: any) => {
            if (options.body.includes('second')) {
                throw new Error('capture blew up')
            }
        })

        logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

        expect(capturedBuffered.mock.calls.map((c: any[]) => c[0].body)).toEqual([
            expect.stringContaining('first'),
            expect.stringContaining('second'),
            expect.stringContaining('third'),
        ])
    })

    it('replays a buffered entry stamped at the console call, not at the handover', () => {
        const nowSpy = vi.spyOn(Date, 'now')
        try {
            logs.setup(client)
            nowSpy.mockReturnValue(1700000000000)
            host.console.log('early')
            nowSpy.mockReturnValue(1700000005000)

            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

            const [, , occurredAtMs] = capturedBuffered.mock.calls[0]!
            expect(occurredAtMs).toBe(1700000000000)
        } finally {
            nowSpy.mockRestore()
        }
    })

    it('replays a buffered entry through the entrypoint serializer with its captured context', () => {
        logs.setup(client)

        const cyclic: any = { name: 'early' }
        cyclic.self = cyclic
        host.console.log('early', cyclic)

        const entry = (logs as any)._consoleBuffer[0]
        expect(entry.context).toEqual(expect.objectContaining({ distinctId: 'user-123', sessionId: 'session-123' }))

        // A later identify must not re-stamp the buffered entry.
        client.distinctId = 'identified-456'

        logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

        expect(capturedBuffered).toHaveBeenCalledTimes(1)
        const [options, context, occurredAtMs] = capturedBuffered.mock.calls[0]!
        expect(options.attributes['log.source']).toBe('console.log')
        expect(options.body).toContain('early')
        // The entrypoint's serializer, not a second copy in the main bundle.
        expect(options.body).toContain('[Circular]')
        expect(context.distinctId).toBe('user-123')
        expect(occurredAtMs).toBe(entry.occurredAtMs)
    })
})
