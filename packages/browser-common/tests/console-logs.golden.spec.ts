import type { Mock } from 'vitest'
import { initializeLogs } from '../src/console-logs'
import type { ConsoleLogsHost } from '../src/console-logs'

describe('shared console logs', () => {
    let host: ConsoleLogsHost
    let mockEmit: Mock
    const disposers: Array<() => void> = []
    const initialize = () => {
        const dispose = initializeLogs(host)
        disposers.push(dispose)
        return dispose
    }
    beforeEach(() => {
        mockEmit = vi.fn()
        host = {
            console: {
                log: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            } as unknown as Console,
            hostname: 'example.com',
            getCapturingLogs: () => ({ captureConsoleLog: mockEmit }),
        }
    })
    afterEach(() => {
        disposers
            .splice(0)
            .reverse()
            .forEach((dispose) => dispose())
    })

    it('emits the exact record for a string log', () => {
        initialize()
        host.console.log('hello')

        expect(mockEmit).toHaveBeenCalledTimes(1)
        expect(mockEmit.mock.calls[0]![0]).toEqual({
            level: 'info',
            body: '"hello"',
            attributes: {
                'log.source': 'console.log',
                host: 'example.com',
            },
        })
    })

    it.each([
        ['log', 'info'],
        ['info', 'info'],
        ['warn', 'warn'],
        ['error', 'error'],
        ['debug', 'debug'],
    ] as const)('maps console.%s to level %s', (method, level) => {
        initialize()
        host.console[method]('x')

        expect(mockEmit.mock.calls[0]![0]).toMatchObject({
            level,
            attributes: expect.objectContaining({ 'log.source': `console.${method}` }),
        })
    })

    it('emits the exact record for an object log, flattening the first arg into attributes', () => {
        initialize()
        host.console.warn({ user: { id: 5 }, msg: 'hi' })

        expect(mockEmit.mock.calls[0]![0]).toEqual({
            level: 'warn',
            body: '{"user":{"id":5},"msg":"hi"}',
            attributes: {
                'log.source': 'console.warn',
                host: 'example.com',
                'user.id': 5,
                msg: 'hi',
            },
        })
    })

    it('does not include distinct_id or location.href — core adds posthogDistinctId/url.full', () => {
        initialize()
        host.console.log('hello')

        const attributes = mockEmit.mock.calls[0]![0].attributes
        expect(attributes).not.toHaveProperty('distinct_id')
        expect(attributes).not.toHaveProperty('location.href')
    })
})
