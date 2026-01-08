import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'

// Mock external OpenTelemetry dependencies
jest.mock('@opentelemetry/api-logs', () => ({
    logs: {
        setGlobalLoggerProvider: jest.fn(),
        getLogger: jest.fn(() => ({
            emit: jest.fn(),
        })),
    },
}))

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
    OTLPLogExporter: jest.fn().mockImplementation(() => ({
        export: jest.fn(),
        shutdown: jest.fn(),
    })),
}))

jest.mock('@opentelemetry/sdk-logs', () => ({
    LoggerProvider: jest.fn().mockImplementation(() => ({
        getLogger: jest.fn(() => ({
            emit: jest.fn(),
        })),
        shutdown: jest.fn(),
    })),
    BatchLogRecordProcessor: jest.fn().mockImplementation(() => ({
        onEmit: jest.fn(),
        shutdown: jest.fn(),
    })),
}))

jest.mock('@opentelemetry/resources', () => ({
    resourceFromAttributes: jest.fn((attrs) => ({
        attributes: attrs,
    })),
}))

describe('logs entrypoint', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    let mockLogger: any
    let mockEmit: jest.Mock

    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()

        // Store original console
        originalConsole = { ...console }

        // Set up mock logger
        mockEmit = jest.fn()
        mockLogger = { emit: mockEmit }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { logs } = require('@opentelemetry/api-logs')
        logs.getLogger.mockReturnValue(mockLogger)

        // Mock PostHog instance
        mockPostHog = {
            config: {
                api_host: 'https://app.posthog.com',
                token: 'test-token',
            },
            sessionManager: {
                checkAndGetSessionAndWindowId: jest.fn(() => ({
                    sessionId: 'session-123',
                    windowId: 'window-456',
                    sessionStartTimestamp: new Date('2023-01-01T10:00:00Z').getTime(),
                    lastActivityTimestamp: new Date('2023-01-01T10:30:00Z').getTime(),
                })),
            },
            get_distinct_id: jest.fn(() => 'user-123'),
        } as unknown as PostHog

        // Mock assignableWindow
        Object.defineProperty(assignableWindow, 'location', {
            value: {
                host: 'example.com',
                href: 'https://example.com/test',
            },
            writable: true,
        })

        Object.defineProperty(assignableWindow, 'console', {
            value: {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            },
            writable: true,
        })

        // Clear existing extensions
        assignableWindow.__PosthogExtensions__ = {}
    })

    afterEach(() => {
        // Restore console
        Object.assign(console, originalConsole)
    })

    describe('configuration handling', () => {
        beforeEach(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../../entrypoints/logs')
        })

        it('should use PostHog config for exporter URL', () => {
            const customPostHog = {
                ...mockPostHog,
                config: {
                    api_host: 'https://custom.example.com',
                    token: 'custom-token-123',
                },
            }

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(customPostHog)

            expect(OTLPLogExporter).toHaveBeenCalledWith({
                url: 'https://custom.example.com/i/v1/logs?token=custom-token-123',
            })
        })

        it('should use current location host in resource attributes', () => {
            Object.defineProperty(assignableWindow, 'location', {
                value: { host: 'different.example.com', href: 'https://different.example.com' },
                writable: true,
            })

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { resourceFromAttributes } = require('@opentelemetry/resources')
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            expect(resourceFromAttributes).toHaveBeenCalledWith(
                expect.objectContaining({
                    host: 'different.example.com',
                })
            )
        })
    })
})
