import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'

// Asserts the exact `{ level, body, attributes }` record the console wrapper hands
// to `posthog.logs._captureConsoleLog`, so any attribute rename or change is caught.

// Deterministic session timestamps used in the golden values below.
const SESSION_START = new Date('2023-01-01T10:00:00Z').getTime() // 1672567200000
const LAST_ACTIVITY = new Date('2023-01-01T10:30:00Z').getTime() // 1672569000000

describe('logs entrypoint — golden (console-capture record handed to core)', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    let mockCapture: jest.Mock

    const initialize = (instance: PostHog = mockPostHog) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../entrypoints/logs')
        assignableWindow.__PosthogExtensions__.logs.initializeLogs(instance)
    }

    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()

        originalConsole = { ...console }

        mockCapture = jest.fn()

        mockPostHog = {
            config: { api_host: 'https://app.posthog.com', token: 'test-token' },
            sessionManager: {
                checkAndGetSessionAndWindowId: jest.fn(() => ({
                    sessionId: 'session-123',
                    windowId: 'window-456',
                    sessionStartTimestamp: SESSION_START,
                    lastActivityTimestamp: LAST_ACTIVITY,
                })),
            },
            get_distinct_id: jest.fn(() => 'user-123'),
            is_capturing: jest.fn(() => true),
            logs: { _captureConsoleLog: mockCapture },
        } as unknown as PostHog

        Object.defineProperty(assignableWindow, 'location', {
            value: { host: 'example.com', href: 'https://example.com/test' },
            writable: true,
        })
        Object.defineProperty(assignableWindow, 'console', {
            value: { log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            writable: true,
        })
        assignableWindow.__PosthogExtensions__ = {}
    })

    afterEach(() => {
        Object.assign(console, originalConsole)
    })

    it('emits the exact record for a string log', () => {
        initialize()
        assignableWindow.console.log('hello')

        expect(mockCapture).toHaveBeenCalledTimes(1)
        expect(mockCapture.mock.calls[0][0]).toEqual({
            level: 'info',
            body: '"hello"',
            attributes: {
                'log.source': 'console.log',
                host: 'example.com',
                'window.id': 'window-456',
                sessionStartTimestamp: String(SESSION_START),
                lastActivityTimestamp: String(LAST_ACTIVITY),
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
        assignableWindow.console[method]('x')

        expect(mockCapture.mock.calls[0][0]).toMatchObject({
            level,
            attributes: expect.objectContaining({ 'log.source': `console.${method}` }),
        })
    })

    it('emits the exact record for an object log, flattening the first arg into attributes', () => {
        initialize()
        assignableWindow.console.warn({ user: { id: 5 }, msg: 'hi' })

        expect(mockCapture.mock.calls[0][0]).toEqual({
            level: 'warn',
            body: '{"user":{"id":5},"msg":"hi"}',
            attributes: {
                'log.source': 'console.warn',
                host: 'example.com',
                'window.id': 'window-456',
                sessionStartTimestamp: String(SESSION_START),
                lastActivityTimestamp: String(LAST_ACTIVITY),
                'user.id': 5,
                msg: 'hi',
            },
        })
    })

    it('does not include distinct_id or location.href — core adds posthogDistinctId/url.full', () => {
        initialize()
        assignableWindow.console.log('hello')

        const attributes = mockCapture.mock.calls[0][0].attributes
        expect(attributes).not.toHaveProperty('distinct_id')
        expect(attributes).not.toHaveProperty('location.href')
    })
})
