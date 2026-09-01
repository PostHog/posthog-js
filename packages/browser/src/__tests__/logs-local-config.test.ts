import { createPosthogInstance } from './helpers/posthog-instance'
import { assignableWindow } from '../utils/globals'
import { BUFFERED_CONSOLE_LEVELS } from '../logs-types'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

// The extension-level suites build `PostHogLogs` with a mock instance whose config is
// already populated. The real `PostHog` constructs it while `config` is still the
// defaults, so only a full `init` proves the local opt-in is read at all.
describe('logs: captureConsoleLogs set in init()', () => {
    let setupConsoleMethods: Partial<Record<(typeof BUFFERED_CONSOLE_LEVELS)[number], any>>

    beforeEach(() => {
        setupConsoleMethods = {}
        for (const level of BUFFERED_CONSOLE_LEVELS) {
            setupConsoleMethods[level] = assignableWindow.console[level]
            assignableWindow.console[level] = jest.fn()
        }
    })

    afterEach(() => {
        for (const level of BUFFERED_CONSOLE_LEVELS) {
            assignableWindow.console[level] = setupConsoleMethods[level]
        }
    })

    it('reads the local opt-in from init()', async () => {
        const posthog = await createPosthogInstance(uuidv7(), { logs: { captureConsoleLogs: true } })

        expect((posthog.logs as any)._isLogsEnabled).toBe(true)
    })

    it('buffers console calls while the logs script is still loading', async () => {
        // Hold the load open so the recorder is still up when the page logs.
        const realLoader = assignableWindow.__PosthogExtensions__?.loadExternalDependency
        const loadCalls: string[] = []
        assignableWindow.__PosthogExtensions__ = {
            ...assignableWindow.__PosthogExtensions__,
            loadExternalDependency: ((_i: any, name: string) => {
                loadCalls.push(name)
            }) as any,
        }
        try {
            const posthog = await createPosthogInstance(uuidv7(), { logs: { captureConsoleLogs: true } })

            expect(loadCalls).toContain('logs')
            expect((posthog.logs as any)._isRecordingConsole).toBe(true)

            assignableWindow.console.warn('a line the user expects captured')
            expect((posthog.logs as any)._consoleBuffer).toHaveLength(1)
        } finally {
            assignableWindow.__PosthogExtensions__.loadExternalDependency = realLoader
        }
    })

    it('leaves console alone when the option is not set', async () => {
        const originalLog = assignableWindow.console.log
        const posthog = await createPosthogInstance(uuidv7(), {})

        expect((posthog.logs as any)._isLogsEnabled).toBe(false)
        expect((posthog.logs as any)._isRecordingConsole).toBe(false)
        expect(assignableWindow.console.log).toBe(originalLog)
    })

    it('drops the buffer and unpatches console on opt_out_capturing', async () => {
        const originalLog = assignableWindow.console.log
        const ph = await createPosthogInstance(uuidv7(), { logs: { captureConsoleLogs: true } })
        const logs: any = ph.logs
        logs._startConsoleRecorder()
        assignableWindow.console.log('held')
        expect(logs._consoleBuffer.length).toBeGreaterThan(0)

        ph.opt_out_capturing()

        expect(logs._consoleBuffer).toHaveLength(0)
        expect(assignableWindow.console.log).toBe(originalLog)
    })
})
