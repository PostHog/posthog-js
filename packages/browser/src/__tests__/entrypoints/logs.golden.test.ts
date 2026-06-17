import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'

// Golden / characterization tests for the CURRENT console-capture (OpenTelemetry)
// path. Unlike logs.test.ts, these assert the COMPLETE emitted record and the
// COMPLETE resource attributes (exact `toEqual`), so the planned migration of
// console capture onto the core pipeline can be diffed precisely: every key
// rename, severity-text change, or resource/record move surfaces as a failing
// assertion here rather than silently changing the wire output.

jest.mock('@opentelemetry/api-logs', () => ({
    logs: {
        setGlobalLoggerProvider: jest.fn(),
        getLogger: jest.fn(() => ({ emit: jest.fn() })),
    },
}))

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
    OTLPLogExporter: jest.fn().mockImplementation(() => ({ export: jest.fn(), shutdown: jest.fn() })),
}))

jest.mock('@opentelemetry/sdk-logs', () => ({
    LoggerProvider: jest.fn().mockImplementation(() => ({
        getLogger: jest.fn(() => ({ emit: jest.fn() })),
        shutdown: jest.fn(),
    })),
    BatchLogRecordProcessor: jest.fn().mockImplementation(() => ({ onEmit: jest.fn(), shutdown: jest.fn() })),
}))

jest.mock('@opentelemetry/resources', () => ({
    resourceFromAttributes: jest.fn((attrs) => ({ attributes: attrs })),
}))

// Deterministic session timestamps used in the golden values below.
const SESSION_START = new Date('2023-01-01T10:00:00Z').getTime() // 1672567200000
const LAST_ACTIVITY = new Date('2023-01-01T10:30:00Z').getTime() // 1672569000000

describe('logs entrypoint — golden (current console-capture wire output)', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    let mockEmit: jest.Mock

    const initialize = (instance: PostHog = mockPostHog) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../entrypoints/logs')
        assignableWindow.__PosthogExtensions__.logs.initializeLogs(instance)
    }

    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()

        originalConsole = { ...console }

        mockEmit = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logs } = require('@opentelemetry/api-logs')
        logs.getLogger.mockReturnValue({ emit: mockEmit })

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

    it('builds the exact resource attributes (service.name, host, session.id, window.id)', () => {
        initialize()
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resourceFromAttributes } = require('@opentelemetry/resources')
        expect(resourceFromAttributes).toHaveBeenCalledWith({
            'service.name': 'posthog-browser-logs',
            host: 'example.com',
            'session.id': 'session-123',
            'window.id': 'window-456',
        })
    })

    it('sends to /i/v1/logs with the token and forces text/plain to avoid a preflight', () => {
        initialize()
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http')
        expect(OTLPLogExporter).toHaveBeenCalledWith({
            url: 'https://app.posthog.com/i/v1/logs?token=test-token',
            headers: { 'Content-Type': 'text/plain' },
        })
    })

    it('emits the exact record for a string log', () => {
        initialize()
        assignableWindow.console.log('hello')

        expect(mockEmit).toHaveBeenCalledTimes(1)
        expect(mockEmit.mock.calls[0][0]).toEqual({
            severityText: 'INFO',
            body: '"hello"',
            attributes: {
                'log.source': 'console.log',
                distinct_id: 'user-123',
                'location.href': 'https://example.com/test',
                sessionStartTimestamp: String(SESSION_START),
                lastActivityTimestamp: String(LAST_ACTIVITY),
            },
        })
    })

    it.each([
        ['log', 'INFO'],
        ['info', 'INFO'],
        ['warn', 'WARNING'],
        ['error', 'ERROR'],
        ['debug', 'DEBUG'],
    ] as const)('maps console.%s to severityText %s', (method, severityText) => {
        initialize()
        assignableWindow.console[method]('x')

        expect(mockEmit.mock.calls[0][0]).toMatchObject({
            severityText,
            attributes: expect.objectContaining({ 'log.source': `console.${method}` }),
        })
    })

    it('emits the exact record for an object log, flattening the first arg into attributes', () => {
        initialize()
        assignableWindow.console.warn({ user: { id: 5 }, msg: 'hi' })

        expect(mockEmit.mock.calls[0][0]).toEqual({
            severityText: 'WARNING',
            body: '{"user":{"id":5},"msg":"hi"}',
            attributes: {
                'log.source': 'console.warn',
                distinct_id: 'user-123',
                'location.href': 'https://example.com/test',
                sessionStartTimestamp: String(SESSION_START),
                lastActivityTimestamp: String(LAST_ACTIVITY),
                'user.id': 5,
                msg: 'hi',
            },
        })
    })

    it('honors a configured serviceName for the resource service.name', () => {
        const instance = {
            ...mockPostHog,
            config: { ...mockPostHog.config, logs: { serviceName: 'my-app' } },
        } as unknown as PostHog
        initialize(instance)

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resourceFromAttributes } = require('@opentelemetry/resources')
        expect(resourceFromAttributes).toHaveBeenCalledWith({
            'service.name': 'my-app',
            host: 'example.com',
            'session.id': 'session-123',
            'window.id': 'window-456',
        })
    })
})
