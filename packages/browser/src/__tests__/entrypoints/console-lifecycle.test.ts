import { createLogsClient } from '../helpers/logs-client'
import type { Client } from '@posthog/browser-common'
import type { PostHog } from '../../posthog-core'
import { assignableWindow } from '../../utils/globals'

// Source modules are re-evaluated (including their patch dependencies), not mocked
// or replaced with a test implementation. Saved factories model separate bundles.
const loadCopy = async () => {
    vi.resetModules()
    await import('../../entrypoints/logs')
    const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
    const { getRecordConsolePlugin } = await import('../../../../rrweb/plugins/rrweb-plugin-console-record/src')
    const { PostHogLogs } = await import('../../posthog-logs')
    const { patch } = await import('../../extensions/replay/rrweb-plugins/patch')
    const { patch: rrwebPatch } = await import('@posthog/rrweb-utils')
    return { initializeLogs, getRecordConsolePlugin, PostHogLogs, patch, rrwebPatch }
}

type Copy = Awaited<ReturnType<typeof loadCopy>>
type Kind = 'logs' | 'replay' | 'buffer'
type Running = { start: () => () => void; count: () => number }

const makeRunning = (copy: Copy, kind: Kind): Running => {
    const capture = vi.fn()
    if (kind === 'logs') {
        const client = {
            canCapture: true,
            getExtension: () => ({ captureConsoleLog: capture }),
        } as unknown as Client
        return { start: () => copy.initializeLogs(client), count: () => capture.mock.calls.length }
    }
    if (kind === 'replay') {
        const plugin = copy.getRecordConsolePlugin({ level: ['log'], lengthThreshold: 1000 })
        return {
            start: () => plugin.observer!(capture, window as any, plugin.options),
            count: () => capture.mock.calls.length,
        }
    }
    const host = {
        config: { logs: {} },
        is_capturing: () => true,
        get_distinct_id: () => 'user',
        sessionManager: {
            checkAndGetSessionAndWindowId: () => ({ sessionId: 'session', windowId: 'window' }),
        },
    } as unknown as PostHog
    const logs = new copy.PostHogLogs(host)
    logs.setup(createLogsClient(host))
    // Deliberately isolate the temporary instrumentation lifecycle from config,
    // transport, and lazy-load timing. These are real methods, not mocks.
    return {
        start: () => {
            ;(logs as any)._startConsoleRecorder()
            return () => (logs as any)._stopConsoleRecorder()
        },
        count: () => (logs as any)._consoleBuffer.length,
    }
}

describe('console instrumentation lifecycle', () => {
    let savedConsole: Console
    let nativeLog: ReturnType<typeof vi.fn>
    let nativeReceiver: unknown
    let cleanups: Array<() => void>

    beforeEach(() => {
        savedConsole = assignableWindow.console
        nativeLog = vi.fn(function (this: unknown) {
            nativeReceiver = this
        })
        assignableWindow.console = {
            log: nativeLog,
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        } as unknown as Console
        cleanups = []
    })

    afterEach(() => {
        cleanups.reverse().forEach((stop) => stop())
        assignableWindow.console = savedConsole
    })

    const start = (running: Running) => {
        const stop = running.start()
        cleanups.push(stop)
        return stop
    }

    // Conventional foreign instrumentation: close over the previous method and
    // forward receiver/args unchanged. It does not speak PostHog's layer protocol.
    const installForeign = (marked: boolean) => {
        const next = assignableWindow.console.log
        const vendor = vi.fn()
        let active = true
        const wrapped = function (this: unknown, ...args: unknown[]) {
            if (active) vendor(...args)
            return next.apply(this, args)
        }
        if (marked) {
            Object.defineProperty(wrapped, '__rrweb_original__', { value: next })
        }
        assignableWindow.console.log = wrapped
        const dispose = () => {
            active = false
            if (assignableWindow.console.log === wrapped) {
                assignableWindow.console.log = next
            }
        }
        cleanups.push(dispose)
        return Object.assign(vendor, { dispose })
    }

    const emit = (label: string, vendor?: ReturnType<typeof vi.fn>) => {
        nativeLog.mockClear()
        vendor?.mockClear()
        const object = { label }
        assignableWindow.console.log(label, object)
        expect.soft(nativeLog).toHaveBeenCalledTimes(1)
        expect.soft(nativeLog).toHaveBeenCalledWith(label, object)
        expect.soft(nativeReceiver).toBe(assignableWindow.console)
        if (vendor) {
            expect.soft(vendor).toHaveBeenCalledTimes(1)
            expect.soft(vendor).toHaveBeenCalledWith(label, object)
        }
    }

    describe.each<Kind>(['logs', 'replay', 'buffer'])('%s instrumentation', (kind) => {
        it('control: captures once, stops, and restarts without another wrapper', async () => {
            const running = makeRunning(await loadCopy(), kind)
            const stop = start(running)
            emit('active')
            expect(running.count()).toBe(1)
            stop()
            const stoppedCount = running.count()
            emit('stopped')
            expect(running.count()).toBe(stoppedCount)
            const stopAgain = start(running)
            const restartedCount = running.count()
            emit('restarted')
            expect(running.count() - restartedCount).toBe(1)
            stopAgain()
        })

        describe.each([false, true])('foreign original marker: %s', (marked) => {
            it.each(['foreign-first', 'posthog-first'] as const)(
                '%s: keeps vendor/output alive and disables capture across stop/restart',
                async (order) => {
                    const running = makeRunning(await loadCopy(), kind)
                    let vendor: ReturnType<typeof vi.fn>
                    let stop: () => void
                    if (order === 'foreign-first') {
                        vendor = installForeign(marked)
                        stop = start(running)
                    } else {
                        stop = start(running)
                        vendor = installForeign(marked)
                    }
                    emit('active', vendor)
                    expect.soft(running.count()).toBe(1)
                    stop()
                    const stoppedCount = running.count()
                    emit('stopped', vendor)
                    expect.soft(running.count() - stoppedCount, 'capture after teardown').toBe(0)
                    const stopAgain = start(running)
                    const restartedCount = running.count()
                    emit('restarted', vendor)
                    expect.soft(running.count() - restartedCount, 'captures per call after restart').toBe(1)
                    stopAgain()
                    const finalCount = running.count()
                    emit('stopped again', vendor)
                    expect.soft(running.count() - finalCount, 'capture after second teardown').toBe(0)
                }
            )
        })

        it.each(['foreign-first', 'posthog-first'] as const)(
            'control: foreign teardown before PostHog, installed %s',
            async (order) => {
                const running = makeRunning(await loadCopy(), kind)
                const vendor = order === 'foreign-first' ? installForeign(false) : undefined
                const stop = start(running)
                const foreign = vendor ?? installForeign(false)
                emit('both active', foreign)
                expect(running.count()).toBe(1)
                foreign.dispose()
                foreign.mockClear()
                emit('only PostHog active')
                expect(foreign).not.toHaveBeenCalled()
                expect(running.count()).toBe(2)
                stop()
                const stoppedCount = running.count()
                emit('neither active')
                expect(foreign).not.toHaveBeenCalled()
                expect(running.count()).toBe(stoppedCount)
            }
        )

        it.each(['older-first', 'newer-first'] as const)(
            'independent copies: one capture per active instance, teardown %s',
            async (order) => {
                const first = await loadCopy()
                const second = await loadCopy()
                expect(first.initializeLogs).not.toBe(second.initializeLogs)
                expect(first.getRecordConsolePlugin).not.toBe(second.getRecordConsolePlugin)
                expect(first.PostHogLogs).not.toBe(second.PostHogLogs)
                expect(first.patch).not.toBe(second.patch)
                expect(first.rrwebPatch).not.toBe(second.rrwebPatch)
                const a = makeRunning(first, kind)
                const b = makeRunning(second, kind)
                const stopA = start(a)
                const stopB = start(b)
                emit('both active')
                // Two configured instances legitimately capture twice in total.
                expect(a.count()).toBe(1)
                expect(b.count()).toBe(1)
                const [stopped, active, stopFirst, stopLast] =
                    order === 'older-first' ? [a, b, stopA, stopB] : [b, a, stopB, stopA]
                stopFirst()
                const stoppedCount = stopped.count()
                emit('one active')
                expect(stopped.count()).toBe(stoppedCount)
                expect(active.count()).toBe(2)
                const stopRestarted = start(stopped)
                const restartCount = stopped.count()
                emit('both active again')
                expect(stopped.count() - restartCount).toBe(1)
                expect(active.count()).toBe(3)
                stopLast()
                stopRestarted()
                const counts = [a.count(), b.count()]
                emit('both stopped')
                expect([a.count(), b.count()]).toEqual(counts)
            }
        )
    })

    it.each(['none', 'foreign-first', 'posthog-first'] as const)(
        'public buffer lifecycle: setup/reset/config/handover with %s',
        async (order) => {
            const copy = await loadCopy()
            const live = vi.fn()
            const buffered = vi.fn()
            const client = {
                canCapture: true,
                getExtension: () => ({ captureConsoleLog: live, captureBufferedConsoleLog: buffered }),
                onRemoteConfig: () => ({ dispose: vi.fn() }),
            } as unknown as Client
            const host = {
                config: { logs: { captureConsoleLogs: true } },
                is_capturing: () => true,
                get_distinct_id: () => 'user',
            } as unknown as PostHog
            let loaded: (error?: Error) => void
            // Hold only delivery of the lazy script; both instrumentation modules run.
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn((_host, _name, callback) => {
                loaded = callback
            }) as any
            const logs = new copy.PostHogLogs(host)
            cleanups.push(() => logs.dispose())
            let vendor: ReturnType<typeof vi.fn> | undefined
            if (order === 'foreign-first') vendor = installForeign(false)
            logs.setup(
                createLogsClient(host, { getExtension: client.getExtension, onRemoteConfig: client.onRemoteConfig })
            )
            if (order === 'posthog-first') vendor = installForeign(false)
            emit('before reset', vendor)
            expect((logs as any)._consoleBuffer).toHaveLength(1)
            logs.reset()
            emit('after reset before config', vendor)
            expect((logs as any)._consoleBuffer).toHaveLength(0)
            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)
            emit('after restart before handover', vendor)
            expect.soft((logs as any)._consoleBuffer, 'one buffered entry after restart').toHaveLength(1)
            loaded!()
            expect.soft(buffered, 'one replayed console entry, not duplicates').toHaveBeenCalledTimes(1)
            expect
                .soft(buffered.mock.calls.every(([options]) => options.body.includes('after restart before handover')))
                .toBe(true)
            emit('live after handover', vendor)
            expect(live).toHaveBeenCalledTimes(1)
            expect((logs as any)._consoleBuffer).toHaveLength(0)
            logs.dispose()
            emit('after dispose', vendor)
            expect(live).toHaveBeenCalledTimes(1)
        }
    )

    it.each(['logs', 'replay'] as const)(
        'control: actual logs + replay observers, %s installed first, older removed first',
        async (firstKind) => {
            const first = makeRunning(await loadCopy(), firstKind)
            const second = makeRunning(await loadCopy(), firstKind === 'logs' ? 'replay' : 'logs')
            const stopFirst = start(first)
            const stopSecond = start(second)
            emit('both active')
            expect([first.count(), second.count()]).toEqual([1, 1])
            stopFirst()
            emit('only newer active')
            expect([first.count(), second.count()]).toEqual([1, 2])
            const stopRestarted = start(first)
            emit('both restarted')
            expect([first.count(), second.count()]).toEqual([2, 3])
            stopSecond()
            stopRestarted()
            emit('both stopped')
            expect([first.count(), second.count()]).toEqual([2, 3])
        }
    )
})
