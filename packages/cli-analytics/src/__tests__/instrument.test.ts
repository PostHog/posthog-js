import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { instrument } from '../extensions/instrumentation'
import type { AgentInfo, CliAnalyticsOptions } from '../types'
import { FakePostHog } from './test-utils/fake-posthog'

const HUMAN: AgentInfo = { isAgent: false, source: null }
const CLAUDE: AgentInfo = { isAgent: true, agentName: 'claude_code', source: 'env_var' }

const OWNED_ENV = [
    'DO_NOT_TRACK',
    'POSTHOG_CLI_TELEMETRY_DISABLED',
    'POSTHOG_CLI_TELEMETRY_DEBUG',
    'POSTHOG_CLI_INTENT',
    'XDG_CONFIG_HOME',
]

describe('instrument', () => {
    let configHome: string
    let savedEnv: Record<string, string | undefined>

    function options(overrides: Partial<CliAnalyticsOptions> = {}): CliAnalyticsOptions {
        return { cli: { name: 'acme', version: '1.2.3' }, agent: HUMAN, ...overrides }
    }

    beforeEach(() => {
        savedEnv = Object.fromEntries(OWNED_ENV.map((key) => [key, process.env[key]]))
        for (const key of OWNED_ENV) {
            delete process.env[key]
        }
        configHome = mkdtempSync(join(tmpdir(), 'ph-cli-instrument-'))
        process.env.XDG_CONFIG_HOME = configHome
    })

    afterEach(() => {
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }
        rmSync(configHome, { recursive: true, force: true })
    })

    it('emits $cli_command_run with measured duration via command().finish()', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())

        const cmd = analytics.command('deploy', { subcommand: 'prod', flags: ['--force'] })
        cmd.finish({ exitCode: 0 })
        await analytics.flush()

        expect(fake.captures).toHaveLength(1)
        const capture = fake.lastCapture()
        expect(capture?.event).toBe('$cli_command_run')
        expect(capture?.properties?.$cli_command).toBe('deploy')
        expect(capture?.properties?.$cli_subcommand).toBe('prod')
        expect(capture?.properties?.$cli_flags).toEqual(['--force'])
        expect(capture?.properties?.$cli_name).toBe('acme')
        expect(typeof capture?.properties?.$cli_duration_ms).toBe('number')
        expect(capture?.properties?.$cli_is_agent).toBe(false)
    })

    it('finish() is idempotent', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())
        const cmd = analytics.command('deploy')
        cmd.finish({ exitCode: 0 })
        cmd.finish({ exitCode: 0 })
        await analytics.flush()
        expect(fake.captures).toHaveLength(1)
    })

    it('infers is_error from a non-zero exit code and emits an $exception sibling', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())
        analytics.trackCommand({ command: 'build', exitCode: 1, error: new Error('compile failed') })
        await analytics.flush()

        expect(fake.events).toEqual(['$cli_command_run', '$exception'])
        expect(fake.captures[0].properties?.$cli_is_error).toBe(true)
    })

    it('stamps the detected agent dimension', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options({ agent: CLAUDE }))
        expect(analytics.agent).toEqual(CLAUDE)
        analytics.trackCommand({ command: 'deploy' })
        await analytics.flush()
        expect(fake.captures[0].properties?.$cli_is_agent).toBe(true)
        expect(fake.captures[0].properties?.$cli_agent_name).toBe('claude_code')
    })

    it('omits the agent dimension when agent is false', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options({ agent: false }))
        analytics.trackCommand({ command: 'deploy' })
        await analytics.flush()
        expect(fake.captures[0].properties?.$cli_is_agent).toBeUndefined()
    })

    it('captures anonymously with person processing disabled by default', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())
        analytics.trackCommand({ command: 'deploy' })
        await analytics.flush()
        const capture = fake.lastCapture()
        expect(capture?.distinctId).toMatch(/^anon_/)
        expect(capture?.properties?.$process_person_profile).toBe(false)
    })

    it('uses an explicit identity for distinct_id, $set, and $groups', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(
            fake.asPostHog(),
            options({
                identify: { distinctId: 'user_9', properties: { plan: 'pro' }, groups: { organization: 'org_1' } },
            })
        )
        analytics.trackCommand({ command: 'deploy' })
        await analytics.flush()
        const capture = fake.lastCapture()
        expect(capture?.distinctId).toBe('user_9')
        expect(capture?.properties?.$set).toEqual({ plan: 'pro' })
        expect(capture?.properties?.$groups).toEqual({ organization: 'org_1' })
        expect(capture?.properties?.$process_person_profile).toBeUndefined()
    })

    it('captures custom events verbatim', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())
        analytics.track('feedback_submitted', { rating: 5 })
        await analytics.flush()
        expect(fake.lastCapture()?.event).toBe('feedback_submitted')
        expect(fake.lastCapture()?.properties?.rating).toBe(5)
    })

    it('reads intent from POSTHOG_CLI_INTENT when not given explicitly', async () => {
        process.env.POSTHOG_CLI_INTENT = 'investigate failing prod deploy'
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())
        analytics.trackCommand({ command: 'logs' })
        await analytics.flush()
        expect(fake.lastCapture()?.properties?.$cli_intent).toBe('investigate failing prod deploy')
        expect(fake.lastCapture()?.properties?.$cli_intent_source).toBe('inferred')
    })

    it('drops all events when opted out via DO_NOT_TRACK', async () => {
        process.env.DO_NOT_TRACK = '1'
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())
        analytics.trackCommand({ command: 'deploy' })
        analytics.track('feedback', {})
        await analytics.flush()
        expect(fake.captures).toHaveLength(0)
    })

    it('flush awaits pending captures before flushing the client', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(
            fake.asPostHog(),
            options({ identify: async () => ({ distinctId: 'user_async' }) })
        )
        analytics.trackCommand({ command: 'deploy' })
        await analytics.flush()
        expect(fake.captures).toHaveLength(1)
        expect(fake.captures[0].distinctId).toBe('user_async')
        expect(fake.flushed).toBe(1)
    })

    it('shutdown tears down the client', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), options())
        analytics.trackCommand({ command: 'deploy' })
        await analytics.shutdown()
        expect(fake.shutdownCalls).toBe(1)
    })
})
