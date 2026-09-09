import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'

// Asserts the exact `{ level, body, attributes }` record the console wrapper hands
// to the legacy PostHog console capture path, so any attribute rename or change is caught.

// Deterministic session timestamps used in the golden values below.
const SESSION_START = new Date('2023-01-01T10:00:00Z').getTime() // 1672567200000
const LAST_ACTIVITY = new Date('2023-01-01T10:30:00Z').getTime() // 1672569000000

describe('logs entrypoint — golden (console-capture record handed to core)', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    let mockCapture: vi.Mock

    const initialize = async (instance: PostHog = mockPostHog): Promise<void> => {
        await import('../../entrypoints/logs')
        assignableWindow.__PosthogExtensions__.logs.initializeLogs(instance)
    }

    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()

        originalConsole = { ...console }

        mockCapture = vi.fn()

        mockPostHog = {
            config: { api_host: 'https://app.posthog.com', token: 'test-token' },
            sessionManager: {
                checkAndGetSessionAndWindowId: vi.fn(() => ({
                    sessionId: 'session-123',
                    windowId: 'window-456',
                    sessionStartTimestamp: SESSION_START,
                    lastActivityTimestamp: LAST_ACTIVITY,
                })),
            },
            get_distinct_id: vi.fn(() => 'user-123'),
            is_capturing: vi.fn(() => true),
            version: '1.392.0',
            logs: { le: mockCapture },
        } as unknown as PostHog

        Object.defineProperty(assignableWindow, 'location', {
            value: { host: 'example.com', href: 'https://example.com/test' },
            writable: true,
        })
        Object.defineProperty(assignableWindow, 'console', {
            value: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            writable: true,
        })
        assignableWindow.__PosthogExtensions__ = {}
    })

    afterEach(() => {
        Object.assign(console, originalConsole)
    })

    it('emits the exact record for a string log', async () => {
        await initialize()
        assignableWindow.console.log('hello')

        expect(mockCapture).toHaveBeenCalledTimes(1)
        expect(mockCapture.mock.calls[0][0]).toEqual({
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
    ] as const)('maps console.%s to level %s', async (method, level) => {
        await initialize()
        assignableWindow.console[method]('x')

        expect(mockCapture.mock.calls[0][0]).toMatchObject({
            level,
            attributes: expect.objectContaining({ 'log.source': `console.${method}` }),
        })
    })

    it('emits the exact record for an object log, flattening the first arg into attributes', async () => {
        await initialize()
        assignableWindow.console.warn({ user: { id: 5 }, msg: 'hi' })

        expect(mockCapture.mock.calls[0][0]).toEqual({
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

    it('does not include distinct_id or location.href — core adds posthogDistinctId/url.full', async () => {
        await initialize()
        assignableWindow.console.log('hello')

        const attributes = mockCapture.mock.calls[0][0].attributes
        expect(attributes).not.toHaveProperty('distinct_id')
        expect(attributes).not.toHaveProperty('location.href')
    })
})
