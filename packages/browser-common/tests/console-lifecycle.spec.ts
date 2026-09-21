import type { Mock } from 'vitest'
// @vitest-environment jsdom
import { initializeLogs } from '../src/console-logs'
import { PostHogLogs } from '../src/logs'
import { createTestClient } from './helpers/test-client'

type Kind = 'logs' | 'buffer'
type Running = { start: () => () => void; count: () => number }
const extensions: PostHogLogs[] = []
const makeRunning = (kind: Kind): Running => {
    const capture = vi.fn()
    if (kind === 'logs') {
        const host = {
            console: window.console,
            hostname: 'example.com',
            getCapturingLogs: () => ({ captureConsoleLog: capture }),
        }
        return { start: () => initializeLogs(host), count: () => capture.mock.calls.length }
    }
    const logs = new PostHogLogs(
        {
            get: () => undefined,
            captureHintKey: 'consoleCaptureEnabled',
            remoteConfigWillArrive: true,
        },
        () => ({})
    )
    logs.setup(createTestClient())
    extensions.push(logs)
    return {
        start: () => {
            ;(logs as any)._startConsoleRecorder()
            return () => (logs as any)._stopConsoleRecorder()
        },
        count: () => (logs as any)._consoleBuffer.length,
    }
}
afterEach(() => extensions.splice(0).forEach((logs) => logs.dispose()))

describe('console instrumentation lifecycle', () => {
    let savedConsole: Console
    let nativeLog: Mock
    let nativeReceiver: unknown
    let cleanups: Array<() => void>

    beforeEach(() => {
        savedConsole = window.console
        nativeLog = vi.fn(function (this: unknown) {
            nativeReceiver = this
        })
        window.console = {
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
        window.console = savedConsole
    })

    const start = (running: Running) => {
        const stop = running.start()
        cleanups.push(stop)
        return stop
    }

    // Conventional foreign instrumentation: close over the previous method and
    // forward receiver/args unchanged. It does not speak PostHog's layer protocol.
    const installForeign = (marked: boolean) => {
        const next = window.console.log
        const vendor = vi.fn()
        let active = true
        const wrapped = function (this: unknown, ...args: unknown[]) {
            if (active) vendor(...args)
            return next.apply(this, args)
        }
        if (marked) {
            Object.defineProperty(wrapped, '__rrweb_original__', { value: next })
        }
        window.console.log = wrapped
        const dispose = () => {
            active = false
            if (window.console.log === wrapped) {
                window.console.log = next
            }
        }
        cleanups.push(dispose)
        return Object.assign(vendor, { dispose })
    }

    const emit = (label: string, vendor?: Mock) => {
        nativeLog.mockClear()
        vendor?.mockClear()
        const object = { label }
        window.console.log(label, object)
        expect.soft(nativeLog).toHaveBeenCalledTimes(1)
        expect.soft(nativeLog).toHaveBeenCalledWith(label, object)
        expect.soft(nativeReceiver).toBe(window.console)
        if (vendor) {
            expect.soft(vendor).toHaveBeenCalledTimes(1)
            expect.soft(vendor).toHaveBeenCalledWith(label, object)
        }
    }

    describe.each<Kind>(['logs', 'buffer'])('%s instrumentation', (kind) => {
        it('control: captures once, stops, and restarts without another wrapper', async () => {
            const running = makeRunning(kind)
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
                    const running = makeRunning(kind)
                    let vendor: Mock
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
                const running = makeRunning(kind)
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
    })
})
