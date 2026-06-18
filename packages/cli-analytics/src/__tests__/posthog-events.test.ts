import { PostHogCliAnalyticsEvent, PostHogCliAnalyticsProperty as Prop } from '../extensions/constants'
import { CliAnalyticsEventType } from '../extensions/event-types'
import { captureException } from '../extensions/exceptions'
import { buildPostHogCaptureEvents } from '../extensions/posthog-events'
import type { CliEvent } from '../types'

function commandEvent(overrides: Partial<CliEvent> = {}): CliEvent {
    return {
        eventType: CliAnalyticsEventType.cliCommandRun,
        sessionId: 'ses_1',
        distinctId: 'anon_1',
        command: 'deploy',
        cli: { name: 'acme', version: '1.2.3' },
        environment: { os: 'darwin', arch: 'arm64', runtime: 'node/20', isTty: true, isCi: false },
        agent: { isAgent: true, agentName: 'claude_code', source: 'env_var' },
        processPersonProfile: false,
        ...overrides,
    }
}

describe('buildPostHogCaptureEvents', () => {
    it('maps a command run to $cli_command_run with the core properties', () => {
        const [event] = buildPostHogCaptureEvents(
            commandEvent({ subcommand: 'prod', flags: ['--force', '--yes'], argsCount: 1, exitCode: 0, durationMs: 42 })
        )

        expect(event.event).toBe(PostHogCliAnalyticsEvent.CommandRun)
        expect(event.distinct_id).toBe('anon_1')
        expect(event.properties).toMatchObject({
            [Prop.Source]: 'posthog_cli_analytics',
            [Prop.SessionId]: 'ses_1',
            [Prop.Command]: 'deploy',
            [Prop.Subcommand]: 'prod',
            [Prop.Flags]: ['--force', '--yes'],
            [Prop.ArgsCount]: 1,
            [Prop.ExitCode]: 0,
            [Prop.DurationMs]: 42,
            [Prop.CliName]: 'acme',
            [Prop.CliVersion]: '1.2.3',
            [Prop.SdkLanguage]: 'TypeScript',
            [Prop.Os]: 'darwin',
            [Prop.Arch]: 'arm64',
        })
    })

    it('stamps the agent dimension', () => {
        const [event] = buildPostHogCaptureEvents(commandEvent())
        expect(event.properties[Prop.IsAgent]).toBe(true)
        expect(event.properties[Prop.AgentName]).toBe('claude_code')
        expect(event.properties[Prop.AgentSource]).toBe('env_var')
    })

    it('disables person processing for anonymous capture', () => {
        const [event] = buildPostHogCaptureEvents(commandEvent())
        expect(event.properties.$process_person_profile).toBe(false)
    })

    it('writes $set and $groups and keeps person processing when identified', () => {
        const [event] = buildPostHogCaptureEvents(
            commandEvent({
                distinctId: 'user_9',
                processPersonProfile: true,
                setProperties: { plan: 'enterprise' },
                groups: { organization: 'org_1' },
            })
        )
        expect(event.distinct_id).toBe('user_9')
        expect(event.properties.$set).toEqual({ plan: 'enterprise' })
        expect(event.properties.$groups).toEqual({ organization: 'org_1' })
        expect(event.properties.$process_person_profile).toBeUndefined()
    })

    it('emits an $exception sibling on error', () => {
        const events = buildPostHogCaptureEvents(
            commandEvent({ exitCode: 1, isError: true, error: captureException(new Error('boom')) })
        )
        expect(events).toHaveLength(2)
        const exception = events[1]
        expect(exception.event).toBe(PostHogCliAnalyticsEvent.Exception)
        expect(exception.properties.$exception_list).toBeDefined()
        expect(exception.properties[Prop.Command]).toBe('deploy')
    })

    it('does not emit an $exception sibling when autocapture is disabled', () => {
        const events = buildPostHogCaptureEvents(
            commandEvent({ isError: true, error: captureException(new Error('boom')) }),
            { enableExceptionAutocapture: false }
        )
        expect(events).toHaveLength(1)
    })

    it('emits custom events under the given name with merged properties', () => {
        const [event] = buildPostHogCaptureEvents({
            eventType: CliAnalyticsEventType.custom,
            eventName: 'feedback_submitted',
            sessionId: 'ses_1',
            distinctId: 'anon_1',
            properties: { rating: 5 },
        })
        expect(event.event).toBe('feedback_submitted')
        expect(event.properties.rating).toBe(5)
    })
})
