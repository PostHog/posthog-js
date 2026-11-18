import { createPostHog as createDefault } from '../src/composition/npm/core'
import type { IPostHog } from '../src/core/types'
import { recordCapture, recordedEvents, recordingOptions, type RecordedRequest } from './capture-recorder'

describe('runtime configuration', () => {
    let requests: RecordedRequest[]
    let posthog: IPostHog
    let consoleLog: { mockRestore(): void; mock: { calls: unknown[][] } }

    beforeEach(async () => {
        requests = []
        consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
        posthog = await createDefault(recordingOptions(recordCapture(requests)))
    })

    afterEach(async () => {
        await posthog.shutdown()
        consoleLog.mockRestore()
    })

    it('enables and disables diagnostic logs at runtime', () => {
        posthog.debug(true)
        posthog.logger.info('enabled')
        posthog.debug(false)
        posthog.logger.info('disabled')

        expect(consoleLog.mock.calls).toEqual([['[PostHog]', 'enabled']])
    })

    it('enables diagnostic logs when debug is called without an argument', () => {
        posthog.debug()
        posthog.logger.info('enabled')

        expect(consoleLog).toHaveBeenCalledWith('[PostHog]', 'enabled')
    })

    it('applies a debug change to child loggers that already exist', () => {
        const child = posthog.logger.createLogger('[Extension]')

        posthog.setConfig({ debug: true })
        child.info('enabled')
        posthog.setConfig({ debug: false })
        child.info('disabled')

        expect(consoleLog.mock.calls).toEqual([['[PostHog] [Extension]', 'enabled']])
    })

    it('keeps the current debug state when the update omits it', () => {
        posthog.debug()
        posthog.setConfig({})
        posthog.logger.info('still enabled')

        expect(consoleLog).toHaveBeenCalledWith('[PostHog]', 'still enabled')
    })

    it('neither captures nor sends anything when debug changes', async () => {
        const observed: string[] = []
        posthog.onEvent(({ event }) => observed.push(event))

        posthog.debug(true)
        await posthog.flush()

        expect(observed).toEqual([])
        expect(requests).toEqual([])
    })

    it('applies a person-profile policy change to subsequent captures', async () => {
        posthog.capture('before')
        posthog.setConfig({ analytics: { personProfiles: 'always' } })
        posthog.capture('after')
        await posthog.flush()

        expect(recordedEvents(requests).map((event) => [event.event, event.options.process_person_profile])).toEqual([
            ['before', false],
            ['after', true],
        ])
    })

    it('stops person processing after the policy changes to never', async () => {
        posthog.setConfig({ analytics: { personProfiles: 'never' } })
        posthog.identify('user-1')
        posthog.capture('after')
        await posthog.flush()

        expect(posthog.distinctId).not.toBe('user-1')
        expect(recordedEvents(requests).map((event) => event.event)).toEqual(['after'])
        expect(recordedEvents(requests)[0]?.options.process_person_profile).toBe(false)
    })

    it('contains failures from hostile configuration objects', () => {
        const hostile = {
            get debug(): boolean {
                throw new Error('hostile')
            },
        }

        expect(() => posthog.setConfig(hostile)).not.toThrow()
    })
})
