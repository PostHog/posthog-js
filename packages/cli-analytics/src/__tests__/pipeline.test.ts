import { MAX_EVENT_BYTES } from '../extensions/truncation'
import { CliAnalyticsEventType } from '../extensions/event-types'
import { CliEventSink, processCliEvent } from '../extensions/sink'
import type { CliEvent } from '../types'
import { FakePostHog } from './test-utils/fake-posthog'

function baseEvent(overrides: Partial<CliEvent> = {}): CliEvent {
    return {
        eventType: CliAnalyticsEventType.cliCommandRun,
        sessionId: 'ses_1',
        distinctId: 'anon_1',
        command: 'deploy',
        ...overrides,
    }
}

describe('processCliEvent', () => {
    it('redacts secrets in the intent', async () => {
        const captures = await processCliEvent(baseEvent({ intent: 'deploy using phc_abcdefghijklmnop123 token' }), {
            enableExceptionAutocapture: true,
        })
        expect(captures?.[0].properties.$cli_intent).toBe('deploy using [redacted] token')
    })

    it('redacts secret-looking custom property values and keys', async () => {
        const captures = await processCliEvent(
            baseEvent({ properties: { password: 'hunter2', note: 'token sk-ABCDEFGHIJKLMNOP1234' } }),
            { enableExceptionAutocapture: true }
        )
        expect(captures?.[0].properties.password).toBe('[redacted]')
        expect(captures?.[0].properties.note).toBe('token [redacted]')
    })

    it('caps an oversized event under the byte budget', async () => {
        const huge = 'x'.repeat(MAX_EVENT_BYTES * 2)
        const captures = await processCliEvent(baseEvent({ properties: { blob: huge } }), {
            enableExceptionAutocapture: true,
        })
        const size = Buffer.byteLength(JSON.stringify(captures?.[0]))
        expect(size).toBeLessThanOrEqual(MAX_EVENT_BYTES + 1024)
    })

    it('drops events nullified by beforeSend', async () => {
        const captures = await processCliEvent(baseEvent(), {
            enableExceptionAutocapture: true,
            beforeSend: () => null,
        })
        expect(captures).toEqual([])
    })

    it('lets beforeSend mutate the payload', async () => {
        const captures = await processCliEvent(baseEvent(), {
            enableExceptionAutocapture: true,
            beforeSend: (event) => ({ ...event, properties: { ...event.properties, redacted: true } }),
        })
        expect(captures?.[0].properties.redacted).toBe(true)
    })
})

describe('CliEventSink consent + debug gating', () => {
    it('does not send when disabled', async () => {
        const fake = new FakePostHog()
        const sink = new CliEventSink(fake.asPostHog(), { enabled: false, debug: false })
        await sink.capture(baseEvent(), { enableExceptionAutocapture: true })
        expect(fake.captures).toHaveLength(0)
    })

    it('sends when enabled', async () => {
        const fake = new FakePostHog()
        const sink = new CliEventSink(fake.asPostHog(), { enabled: true, debug: false })
        await sink.capture(baseEvent(), { enableExceptionAutocapture: true })
        expect(fake.captures).toHaveLength(1)
        expect(fake.captures[0].event).toBe('$cli_command_run')
    })

    it('prints to stderr and sends nothing in debug mode', async () => {
        const fake = new FakePostHog()
        const sink = new CliEventSink(fake.asPostHog(), { enabled: true, debug: true })
        const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
        await sink.capture(baseEvent(), { enableExceptionAutocapture: true })
        expect(fake.captures).toHaveLength(0)
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('would capture'))
        stderr.mockRestore()
    })
})
