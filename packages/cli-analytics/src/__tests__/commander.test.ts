import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CommanderCommandLike, instrumentCommander } from '../adapters/commander'
import { instrument } from '../extensions/instrumentation'
import type { AgentInfo } from '../types'
import { FakePostHog } from './test-utils/fake-posthog'

const HUMAN: AgentInfo = { isAgent: false, source: null }

type Listener = (thisCommand: CommanderCommandLike, actionCommand: CommanderCommandLike) => void

/** Minimal Commander stand-in that records hooks and lets a test fire them. */
class FakeCommand implements CommanderCommandLike {
    parent: CommanderCommandLike | null = null
    private listeners: Record<string, Listener[]> = {}

    constructor(
        private readonly _name: string,
        private readonly _opts: Record<string, unknown> = {},
        public args: string[] = []
    ) {}

    name(): string {
        return this._name
    }
    opts(): Record<string, unknown> {
        return this._opts
    }
    hook(event: 'preAction' | 'postAction', listener: Listener): CommanderCommandLike {
        ;(this.listeners[event] ??= []).push(listener)
        return this
    }
    fire(event: 'preAction' | 'postAction', actionCommand: CommanderCommandLike): void {
        for (const listener of this.listeners[event] ?? []) {
            listener(this, actionCommand)
        }
    }
}

describe('instrumentCommander', () => {
    let configHome: string
    let priorXdg: string | undefined

    beforeEach(() => {
        configHome = mkdtempSync(join(tmpdir(), 'ph-cli-commander-'))
        priorXdg = process.env.XDG_CONFIG_HOME
        process.env.XDG_CONFIG_HOME = configHome
    })

    afterEach(() => {
        if (priorXdg === undefined) {
            delete process.env.XDG_CONFIG_HOME
        } else {
            process.env.XDG_CONFIG_HOME = priorXdg
        }
        rmSync(configHome, { recursive: true, force: true })
    })

    it('captures a command run from pre/post action hooks with flag names and subcommand path', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), { cli: { name: 'acme' }, agent: HUMAN })

        const program = new FakeCommand('acme')
        const deploy = new FakeCommand('deploy', {}, [])
        const prod = new FakeCommand('prod', { force: true, yes: true }, ['service-a'])
        deploy.parent = program
        prod.parent = deploy

        instrumentCommander(program, analytics)
        program.fire('preAction', prod)
        program.fire('postAction', prod)
        await analytics.flush()

        expect(fake.captures).toHaveLength(1)
        const capture = fake.lastCapture()
        expect(capture?.event).toBe('$cli_command_run')
        expect(capture?.properties?.$cli_command).toBe('deploy')
        expect(capture?.properties?.$cli_subcommand).toBe('prod')
        expect(capture?.properties?.$cli_flags).toEqual(['force', 'yes'])
        expect(capture?.properties?.$cli_args_count).toBe(1)
        expect(typeof capture?.properties?.$cli_duration_ms).toBe('number')
    })

    it('reads intent via intentFrom', async () => {
        const fake = new FakePostHog()
        const analytics = instrument(fake.asPostHog(), { cli: { name: 'acme' }, agent: HUMAN })

        const program = new FakeCommand('acme')
        const logs = new FakeCommand('logs', { intent: 'debug prod outage' })
        logs.parent = program

        instrumentCommander(program, analytics, { intentFrom: (cmd) => cmd.opts().intent as string | undefined })
        program.fire('preAction', logs)
        program.fire('postAction', logs)
        await analytics.flush()

        expect(fake.lastCapture()?.properties?.$cli_intent).toBe('debug prod outage')
        expect(fake.lastCapture()?.properties?.$cli_intent_source).toBe('flag')
    })
})
