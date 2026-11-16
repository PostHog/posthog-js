import { initializeLogs, replayConsoleBuffer } from '../src/console-logs'
import type { ConsoleLogsHost } from '../src/console-logs'

const setup = () => {
    const methods = { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const sink = { captureConsoleLog: vi.fn(), captureBufferedConsoleLog: vi.fn() }
    const host: ConsoleLogsHost = {
        console: methods as unknown as Console,
        hostname: 'example.test',
        getCapturingLogs: () => sink,
    }
    return { host, methods, sink }
}

describe('shared console logs runtime', () => {
    it('preserves bounded serialization and buffered capture context', () => {
        const { host, methods, sink } = setup()
        const original = methods.log
        const dispose = initializeLogs(host)
        const circular = { value: 42 } as { value: number; self?: unknown }
        circular.self = circular
        methods.log(circular)
        expect(original).toHaveBeenCalledWith(circular)
        expect(sink.captureConsoleLog).toHaveBeenCalledWith(
            expect.objectContaining({
                level: 'info',
                body: '{"value":42,"self":"[Circular]"}',
                attributes: expect.objectContaining({ host: 'example.test', 'log.source': 'console.log', value: 42 }),
            })
        )
        replayConsoleBuffer(host, [
            { level: 'warn', args: ['prior'], occurredAtMs: 123, context: { distinctId: 'prior-user' } },
        ])
        expect(sink.captureBufferedConsoleLog).toHaveBeenCalledWith(
            expect.objectContaining({ level: 'warn' }),
            { distinctId: 'prior-user' },
            123
        )
        dispose()
        expect(methods.log).toBe(original)
    })

    it('restores installed layers when later console access fails during setup', () => {
        const { host, methods } = setup()
        const original = methods.debug
        Object.defineProperty(methods, 'log', {
            get() {
                throw new Error('hostile console')
            },
        })
        expect(() => initializeLogs(host)).toThrow('hostile console')
        expect(methods.debug).toBe(original)
    })
})
