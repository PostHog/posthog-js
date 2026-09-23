import { createLogsClient } from '../helpers/logs-client'
import { assignableWindow } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { PostHogLogs } from '../../posthog-logs'
import { patch as rrwebPatch } from '@posthog/rrweb-utils'
import { LOGS_CAPTURE_ENABLED_SERVER_SIDE } from '../../constants'

const loadLogsEntrypoint = async (): Promise<void> => {
    await import('../../entrypoints/logs')
}

describe('logs entrypoint', () => {
    let mockPostHog: PostHog
    let originalConsole: Console
    // Legacy PostHog capture routes through its historical console capture ABI.
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
            logs: { le: mockEmit },
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

    describe('core capture routing', () => {
        beforeEach(loadLogsEntrypoint)

        it('routes legacy PostHog capture through its historical console method with the mapped level', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.warn('uh oh')

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: 'warn',
                    body: '"uh oh"',
                    attributes: expect.objectContaining({
                        'log.source': 'console.warn',
                    }),
                })
            )
        })

        it.each([
            ['1.410.4', 'le'],
            ['1.410.10', 'de'],
            ['1.418.3', 'he'],
            ['1.418.10', 'ui'],
            ['1.418.14', 'ci'],
            ['1.419.2', 'vi'],
            ['1.420.0', 'captureConsoleLog'],
            ['1.434.0', 'captureConsoleLog'],
        ])('adapts the historical %s host without owning its logs lifecycle', (version, method) => {
            const setup = vi.fn()
            const disposeLogs = vi.fn()
            mockPostHog.version = version
            mockPostHog.logs = { [method]: mockEmit, setup, dispose: disposeLogs } as any
            const stop = assignableWindow.__PosthogExtensions__.logs.initializeLogs(mockPostHog)
            assignableWindow.console.log('captured')
            expect(mockEmit).toHaveBeenCalledTimes(1)
            expect(setup).not.toHaveBeenCalled()
            stop()
            assignableWindow.console.log('after cleanup')
            expect(mockEmit).toHaveBeenCalledTimes(1)
            expect(disposeLogs).not.toHaveBeenCalled()
        })

        it('reads the current host logs reference for each capture', () => {
            mockPostHog.version = '1.434.0'
            const logs = { captureConsoleLog: mockEmit } as any
            mockPostHog.logs = logs
            const stop = assignableWindow.__PosthogExtensions__.logs.initializeLogs(mockPostHog)
            assignableWindow.console.log('captured')
            mockPostHog.logs = undefined
            assignableWindow.console.log('unavailable')
            expect(mockEmit).toHaveBeenCalledTimes(1)
            mockPostHog.logs = logs
            assignableWindow.console.log('available')
            expect(mockEmit).toHaveBeenCalledTimes(2)
            stop()
            assignableWindow.console.log('after cleanup')
            expect(mockEmit).toHaveBeenCalledTimes(2)
        })

        it('does not set distinct_id or location.href — core adds posthogDistinctId/url.full downstream', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('hello')

            const attributes = mockEmit.mock.calls[0][0].attributes
            expect(attributes).not.toHaveProperty('distinct_id')
            expect(attributes).not.toHaveProperty('location.href')
        })

        it('sets host on the captured record', () => {
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('hello')

            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    attributes: expect.objectContaining({ host: 'example.com' }),
                })
            )
        })

        it.each(['window.id', 'sessionStartTimestamp', 'lastActivityTimestamp'])(
            'does not set %s — core adds session attributes from the SDK context downstream',
            (attribute) => {
                const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
                initializeLogs(mockPostHog)

                assignableWindow.console.log('hello')

                expect(mockEmit.mock.calls[0][0].attributes).not.toHaveProperty(attribute)
            }
        )
    })

    describe('consent / opt-out handling', () => {
        beforeEach(loadLogsEntrypoint)

        it('should not emit logs when capturing is opted out', () => {
            const originalConsoleLog = assignableWindow.console.log as vi.Mock
            ;(mockPostHog.is_capturing as vi.Mock).mockReturnValue(false)

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('should not be captured')

            expect(mockEmit).not.toHaveBeenCalled()
            // the original console method must still be called so local output isn't suppressed
            expect(originalConsoleLog).toHaveBeenCalledWith('should not be captured')
        })

        it('should resume emitting once capturing is opted back in', () => {
            const isCapturing = mockPostHog.is_capturing as vi.Mock
            isCapturing.mockReturnValue(false)

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('while opted out')
            expect(mockEmit).not.toHaveBeenCalled()

            isCapturing.mockReturnValue(true)
            assignableWindow.console.log('after opt back in')

            expect(mockEmit).toHaveBeenCalledTimes(1)
            expect(mockEmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: '"after opt back in"',
                })
            )
        })

        it('should check capturing status on every log, not just at init', () => {
            const isCapturing = mockPostHog.is_capturing as vi.Mock

            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            initializeLogs(mockPostHog)

            assignableWindow.console.log('captured')
            expect(mockEmit).toHaveBeenCalledTimes(1)

            isCapturing.mockReturnValue(false)
            assignableWindow.console.log('not captured')
            expect(mockEmit).toHaveBeenCalledTimes(1)
        })
    })

    describe('teardown under another console wrapper', () => {
        beforeEach(loadLogsEntrypoint)

        it('splices itself out when a later wrapper sits on top', () => {
            const realLog = assignableWindow.console.log as vi.Mock
            const initializeLogs = assignableWindow.__PosthogExtensions__.logs.initializeLogs
            const dispose = initializeLogs(mockPostHog)
            const ourWrapper = assignableWindow.console.log

            // Session replay's console plugin, or any other library, wrapping after us.
            rrwebPatch(
                assignableWindow.console,
                'log',
                (next: any) =>
                    (...args: any[]) =>
                        next.apply(assignableWindow.console, args)
            )
            const outerLayer = (assignableWindow.console.log as any).__rrweb_layer__
            expect(outerLayer.next).toBe(ourWrapper)

            dispose()

            expect(outerLayer.next).toBe(realLog)
            realLog.mockClear()
            assignableWindow.console.log('after teardown')
            expect(realLog).toHaveBeenCalledTimes(1)
        })
    })

    describe('handover from the main-bundle console recorder', () => {
        // Runs the real recorder against the real entrypoint wrapper — mocking either
        // side hides whether the handover leaves the console chain clean.
        // The entrypoint reaches capture through `getCapturingLogs`, which uses the
        // Client path; `loadIfEnabled` hands it `this._client`, so drive it the same way.
        const logsClient = () =>
            createLogsClient(mockPostHog, {
                getExtension: () => (mockPostHog as any).logs,
            })
        let logs: PostHogLogs
        let realConsoleLog: vi.Mock
        let capturedBuffered: vi.Mock

        beforeEach(async () => {
            await loadLogsEntrypoint()

            realConsoleLog = assignableWindow.console.log as vi.Mock
            capturedBuffered = vi.fn()
            ;(mockPostHog as any).config = { logs: {} }
            ;(mockPostHog as any).persistence = {
                register: vi.fn(),
                props: { [LOGS_CAPTURE_ENABLED_SERVER_SIDE]: true },
            }
            ;(mockPostHog as any).logs = {
                captureConsoleLog: mockEmit,
                captureBufferedConsoleLog: capturedBuffered,
            }
            assignableWindow.__PosthogExtensions__.loadExternalDependency = vi.fn(
                (_instance: any, _name: any, callback: any) => callback(null)
            ) as any

            logs = new PostHogLogs(mockPostHog)
        })

        afterEach(() => {
            logs?.reset()
        })

        it('writes to the real console once and captures once after handover', () => {
            logs.setup(logsClient())
            logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } } as any)

            realConsoleLog.mockClear()
            mockEmit.mockClear()

            assignableWindow.console.log('live message')

            expect(realConsoleLog).toHaveBeenCalledTimes(1)
            expect(mockEmit).toHaveBeenCalledTimes(1)
        })
    })
})
