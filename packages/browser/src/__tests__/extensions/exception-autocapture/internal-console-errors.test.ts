import { logger, createLogger } from '@posthog/browser-common/utils/logger'
import Config from '@posthog/browser-common/config'
import { getRecordConsolePlugin } from '@posthog/rrweb-plugin-console-record'
import posthogErrorWrappingFunctions from '../../../entrypoints/exception-autocapture'
import '../../../entrypoints/logs'
import { assignableWindow } from '../../../utils/globals'

const { wrapConsoleError } = posthogErrorWrappingFunctions

describe('internal console diagnostics', () => {
    const capture = vi.fn()
    let original: ReturnType<typeof vi.fn>
    let restore: (() => void)[]
    let debug: boolean

    beforeEach(() => {
        debug = Config.DEBUG
        Config.DEBUG = false
        original = vi.fn()
        console.error = original
        restore = []
    })

    afterEach(() => {
        restore.reverse().forEach((stop) => stop())
        Config.DEBUG = debug
    })

    it.each([false, true])('does not capture critical diagnostics with debug=%s', (enabled) => {
        Config.DEBUG = enabled
        restore.push(wrapConsoleError(capture))

        logger.critical('This capture call is ignored due to client rate limiting.')

        expect(capture).not.toHaveBeenCalled()
        expect(original).toHaveBeenCalledWith(
            '[PostHog.js]',
            'This capture call is ignored due to client rate limiting.'
        )
    })

    it.each([logger, createLogger('[Error tracking]'), createLogger('[Replay]').createLogger('[Network]')])(
        'does not capture debug diagnostics containing an application-created Error',
        (internalLogger) => {
            Config.DEBUG = true
            restore.push(wrapConsoleError(capture))
            const error = new Error('application callback failed')

            internalLogger.error('SDK diagnostic', error)
            internalLogger.error(error)

            expect(capture).not.toHaveBeenCalled()
            expect(original).toHaveBeenCalledTimes(2)
            expect(original.mock.calls[0].slice(1)).toEqual(['SDK diagnostic', error])

            console.error(error)
            expect(capture).toHaveBeenCalledTimes(1)
            expect(capture.mock.calls[0][0].$exception_list[0].value).toBe(error.message)
        }
    )

    it.each(['[PostHog.js]', '[PostHog.js] [Legacy extension]', 'rrweb logger error:'])(
        'recognizes diagnostics from separately loaded bundles: %s',
        (prefix) => {
            restore.push(wrapConsoleError(capture))
            const error = new Error('internal failure')

            console.error(prefix, error)

            expect(capture).not.toHaveBeenCalled()
            expect(original).toHaveBeenCalledWith(prefix, error)
        }
    )

    it.each([
        ['[PostHog.js]'],
        ['[PostHog.js] customer message'],
        ['[PostHog.js] [Surveys]'],
        ['[PostHog.js] [Surveys] customer message'],
        ['rrweb logger error:'],
        ['[PostHog.js-extra] customer message'],
        ['[PostHogXjs] customer message'],
        ['customer message mentioning [PostHog.js]'],
        ['customer message', '[PostHog.js]'],
        [new Error('[PostHog.js] customer-created error')],
        [new Error('rrweb logger error: customer-created error')],
        ['rrweb logger error: customer text'],
        [],
    ])('keeps application console errors (%j)', (...args) => {
        restore.push(wrapConsoleError(capture))

        console.error(...args)

        expect(capture).toHaveBeenCalledTimes(1)
        expect(original).toHaveBeenCalledWith(...args)
    })

    it('does not re-enter capture when exception processing logs a failure', () => {
        Config.DEBUG = true
        capture.mockImplementationOnce(() => {
            createLogger('[Error tracking]').error('Failed to capture exception event', new Error('capture failed'))
        })
        restore.push(wrapConsoleError(capture))

        console.error('customer error')

        expect(capture).toHaveBeenCalledTimes(1)
        expect(original).toHaveBeenCalledTimes(2)
    })

    it.each([false, true])('works with replay console recording installed first=%s', (replayFirst) => {
        Config.DEBUG = true
        const replayCapture = vi.fn()
        const plugin = getRecordConsolePlugin({ level: ['error'] })
        const startReplay = () => plugin.observer!(replayCapture, window as any, plugin.options)
        const startExceptions = () => wrapConsoleError(capture)
        restore.push((replayFirst ? startReplay : startExceptions)())
        restore.push((replayFirst ? startExceptions : startReplay)())

        logger.error('internal error', new Error('SDK failure'))
        logger.critical('internal critical')
        console.error('customer error')

        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture.mock.calls[0][0].$exception_list[0].value).toBe('customer error')
        expect(original).toHaveBeenCalledTimes(3)
        expect(replayCapture).toHaveBeenCalled()
    })

    it.each([
        ['exceptions', 'logs', 'replay'],
        ['exceptions', 'replay', 'logs'],
        ['logs', 'exceptions', 'replay'],
        ['logs', 'replay', 'exceptions'],
        ['replay', 'exceptions', 'logs'],
        ['replay', 'logs', 'exceptions'],
    ])('preserves customer errors with wrapper order %s, %s, %s', (...order) => {
        Config.DEBUG = true
        const captureLog = vi.fn()
        const plugin = getRecordConsolePlugin({ level: ['error'] })
        const start: Record<string, () => () => void> = {
            exceptions: () => wrapConsoleError(capture),
            replay: () => plugin.observer!(vi.fn(), window as any, plugin.options),
            logs: () =>
                assignableWindow.__PosthogExtensions__!.logs!.initializeLogs({
                    canCapture: true,
                    getExtension: () => ({ captureConsoleLog: captureLog }),
                } as any),
        }
        order.forEach((name) => restore.push(start[name]()))

        logger.error('internal error', new Error('SDK failure'))
        logger.critical('internal critical')
        console.error('customer error')

        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture.mock.calls[0][0].$exception_list[0].value).toBe('customer error')
        expect(original).toHaveBeenCalledTimes(3)
        expect(captureLog).toHaveBeenCalledWith(expect.objectContaining({ body: '"customer error"' }))
    })

    it('preserves console forwarding when diagnostic classification encounters a throwing getter', () => {
        restore.push(wrapConsoleError(capture))
        const argument = Object.defineProperty({}, Symbol.toStringTag, {
            get() {
                throw new Error('unreachable argument')
            },
        })

        expect(() => console.error(argument)).not.toThrow()
        expect(original).toHaveBeenCalledTimes(1)
        expect(original.mock.calls[0][0] === argument).toBe(true)
    })

    it('keeps the original application error but not a failed replay console record', () => {
        restore.push(wrapConsoleError(capture))
        const plugin = getRecordConsolePlugin({ level: ['error'] })
        restore.push(
            plugin.observer!(
                () => {
                    throw new Error('replay callback failed')
                },
                window as any,
                plugin.options
            )
        )

        console.error('customer error')

        expect(capture).toHaveBeenCalledTimes(1)
        expect(capture.mock.calls[0][0].$exception_list[0].value).toBe('customer error')
        expect(original).toHaveBeenCalledTimes(2)
        expect(original.mock.calls[1][0]).toBe('rrweb logger error:')
    })
})
