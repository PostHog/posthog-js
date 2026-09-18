import type { Client } from '@posthog/browser-common'

import { assignableWindow } from '../../utils/globals'
import { LogsExtension } from '../../extension-tokens'
import { PostHog } from '../../posthog-core'

describe('logs entrypoint', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    // Console capture routes through the core logs API; assert against that seam.
    let mockEmit: vi.Mock

    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()

        // Store original console
        originalConsole = { ...console }

        // Set up capture spy
        mockEmit = vi.fn()

        // Mock PostHog instance
        mockPostHog = {
            config: {
                api_host: 'https://app.posthog.com',
                token: 'test-token',
            },
            sessionManager: {
                checkAndGetSessionAndWindowId: vi.fn(() => ({
                    sessionId: 'session-123',
                    windowId: 'window-456',
                    sessionStartTimestamp: new Date('2023-01-01T10:00:00Z').getTime(),
                    lastActivityTimestamp: new Date('2023-01-01T10:30:00Z').getTime(),
                })),
            },
            get_distinct_id: vi.fn(() => 'user-123'),
            is_capturing: vi.fn(() => true),
            version: '1.392.0',
            logs: { captureLog: mockEmit, captureConsoleLog: mockEmit, le: mockEmit },
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
                log: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
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

    describe('module loading', () => {
        it('should initialize PostHog extensions when imported', async () => {
            await import('../../entrypoints/logs')

            expect(assignableWindow.__PosthogExtensions__).toBeDefined()
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
            expect(typeof assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBe('function')
        })

        it('should preserve existing PostHog extensions', async () => {
            const existingExtension = vi.fn()
            assignableWindow.__PosthogExtensions__ = { logs: { initializeLogs: undefined } } as any
            ;(assignableWindow.__PosthogExtensions__ as any).existingExtension = existingExtension

            await import('../../entrypoints/logs')

            expect((assignableWindow.__PosthogExtensions__ as any).existingExtension).toBe(existingExtension)
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
        })
    })

    describe('initializeLogs function', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
        })

        it('should be available as a PostHog extension', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(initializeLogs).toBeDefined()
            expect(typeof initializeLogs).toBe('function')
        })

        it('should not throw when called without a session manager', () => {
            const postHogWithoutSession = {
                ...mockPostHog,
                sessionManager: null,
            } as unknown as PostHog

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(() => initializeLogs(postHogWithoutSession)).not.toThrow()
        })

        it('should not throw and should not capture when posthog.logs is undefined', () => {
            const postHogWithoutLogs = {
                ...mockPostHog,
                logs: undefined,
            } as unknown as PostHog

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(postHogWithoutLogs)

            expect(() => assignableWindow.console.log('test')).not.toThrow()
            expect(mockEmit).not.toHaveBeenCalled()
        })

        it.each(['1.391.3', '1.410.5-canary', '1.410.11', '1.418.10-invalid', '1.418.18', '1.419.3', '1.420.0'])(
            'should not select a capture method for unsupported PostHog version %s',
            (version) => {
                const captures = {
                    captureLog: vi.fn(),
                    captureConsoleLog: vi.fn(),
                    le: vi.fn(),
                    de: vi.fn(),
                    he: vi.fn(),
                    ui: vi.fn(),
                    ci: vi.fn(),
                    vi: vi.fn(),
                }
                const legacyPostHog = {
                    ...mockPostHog,
                    version,
                    logs: captures,
                } as unknown as PostHog
                const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
                initializeLogs(legacyPostHog)

                assignableWindow.console.warn('not captured')

                for (const capture of Object.values(captures)) {
                    expect(capture).not.toHaveBeenCalled()
                }
            }
        )

        it('should resolve the console capture path from a shared client', () => {
            const captureLog = vi.fn()
            const captureConsoleLog = vi.fn()
            const client = {
                canCapture: true,
                getExtension: vi.fn(() => ({ captureLog, captureConsoleLog })),
            } as unknown as Client
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(client)

            assignableWindow.console.warn('from shared client')

            expect(client.getExtension).toHaveBeenCalledWith(LogsExtension)
            expect(captureConsoleLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'warn',
                    body: '"from shared client"',
                })
            )
            expect(captureLog).not.toHaveBeenCalled()
            expect(mockPostHog.is_capturing).not.toHaveBeenCalled()
        })

        it('should skip extension lookup for empty and re-entrant console calls', () => {
            const captureConsoleLog = vi.fn(() => {
                assignableWindow.console.warn('nested call')
            })
            const client = {
                canCapture: true,
                getExtension: vi.fn(() => ({ captureConsoleLog })),
            } as unknown as Client
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(client)

            assignableWindow.console.warn()
            expect(client.getExtension).not.toHaveBeenCalled()

            assignableWindow.console.warn('outer call')
            expect(client.getExtension).toHaveBeenCalledTimes(1)
            expect(client.getExtension).toHaveBeenCalledWith(LogsExtension)
            expect(captureConsoleLog).toHaveBeenCalledTimes(1)
        })

        it('should not resolve the logs extension when a shared client cannot capture', () => {
            const client = {
                canCapture: false,
                getExtension: vi.fn(() => mockPostHog.logs),
            } as unknown as Client
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(client)

            assignableWindow.console.log('not captured')

            expect(client.getExtension).not.toHaveBeenCalled()
            expect(mockEmit).not.toHaveBeenCalled()
        })
    })

    describe('session information', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
        })

        it('sets host on the captured record', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('Test message')

            expect(mockEmit).toHaveBeenCalledWith({
                level: 'info',
                body: '"Test message"',
                attributes: expect.objectContaining({ host: 'example.com' }),
            })
        })

        it.each(['window.id', 'sessionStartTimestamp', 'lastActivityTimestamp'])(
            'does not set %s — core adds session attributes from the SDK context downstream',
            (attribute) => {
                const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
                initializeLogs(mockPostHog)

                assignableWindow.console.log('Test message')

                expect(mockEmit.mock.calls[0][0].attributes).not.toHaveProperty(attribute)
            }
        )

        it('should work without session manager', () => {
            const postHogWithoutSession = {
                ...mockPostHog,
                sessionManager: null,
            } as unknown as PostHog

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            expect(() => initializeLogs(postHogWithoutSession)).not.toThrow()
        })
    })

    describe('PostHog extensions setup', () => {
        it('should initialize PostHog extensions object if not present', async () => {
            delete (assignableWindow as any).__PosthogExtensions__

            await import('../../entrypoints/logs')

            expect(assignableWindow.__PosthogExtensions__).toBeDefined()
            expect(assignableWindow.__PosthogExtensions__.logs.initializeLogs).toBeDefined()
        })
    })

    describe('integration with PostHog core', () => {
        beforeEach(async () => {
            await import('../../entrypoints/logs')
        })

        it.each([
            ['1.392.0', 'le'],
            ['1.410.4', 'le'],
            ['1.410.5', 'de'],
            ['1.410.10', 'de'],
            ['1.411.0', 'he'],
            ['1.418.3', 'he'],
            ['1.418.4', 'ui'],
            ['1.418.10', 'ui'],
            ['1.418.11', 'ci'],
            ['1.418.14', 'ci'],
            ['1.418.15', 'vi'],
            ['1.418.17', 'vi'],
            ['1.419.0', 'vi'],
            ['1.419.2', 'vi'],
        ] as const)('should route PostHog %s through the historical %s console method', (version, expectedName) => {
            const captureLog = vi.fn()
            const currentConsoleCapture = vi.fn()
            const historicalCaptures = {
                le: vi.fn(),
                de: vi.fn(),
                he: vi.fn(),
                ui: vi.fn(),
                ci: vi.fn(),
                vi: vi.fn(),
            }
            mockPostHog.version = version
            mockPostHog.logs = {
                captureLog,
                captureConsoleLog: currentConsoleCapture,
                ...historicalCaptures,
            } as unknown as NonNullable<PostHog['logs']>
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('Test message')

            expect(captureLog).not.toHaveBeenCalled()
            expect(currentConsoleCapture).not.toHaveBeenCalled()
            expect(historicalCaptures[expectedName]).toHaveBeenCalledTimes(1)
            expect(historicalCaptures[expectedName]).toHaveBeenCalledWith({
                level: 'info',
                body: '"Test message"',
                attributes: expect.objectContaining({
                    'log.source': 'console.log',
                }),
            })
            for (const [name, capture] of Object.entries(historicalCaptures)) {
                if (name !== expectedName) {
                    expect(capture).not.toHaveBeenCalled()
                }
            }
        })

        it('should not set distinct_id or location.href — core adds posthogDistinctId/url.full', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('Test message')

            const attributes = mockEmit.mock.calls[0][0].attributes
            expect(attributes).not.toHaveProperty('distinct_id')
            expect(attributes).not.toHaveProperty('location.href')
        })
    })
})
