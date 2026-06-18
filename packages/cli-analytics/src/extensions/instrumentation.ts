import type { PostHog } from 'posthog-node'
import type {
    AgentInfo,
    CliAnalytics,
    CliAnalyticsOptions,
    CliEvent,
    CommandCaptureData,
    CommandOptions,
    CommandOutcome,
    CommandTracker,
    EnvironmentInfo,
    JsonRecord,
    UserIdentity,
} from '../types'
import { detectAgent } from './agent-detection'
import { isDebugMode, isTelemetryEnabled } from './consent'
import { collectEnvironment } from './environment'
import { CliAnalyticsEventType } from './event-types'
import { captureException } from './exceptions'
import { resolveIdentity } from './identity'
import { resolveIntent } from './intent'
import { log, setLogger } from './logger'
import { newSessionId } from './session'
import { CliEventSink } from './sink'

interface ResolvedIdentityState {
    distinctId: string
    setProperties?: JsonRecord
    groups?: Record<string, string>
    processPersonProfile: boolean
}

/**
 * Per-process analytics context — the CLI analog of the MCP SDK's per-server
 * tracking data. Holds the resolved session, agent, environment, and a memoized
 * identity, and pushes every event through the shared {@link CliEventSink}.
 */
class CliAnalyticsContext {
    private readonly sink: CliEventSink
    private readonly sessionId: string
    private readonly environment: EnvironmentInfo
    private readonly enableExceptionAutocapture: boolean
    private readonly pending = new Set<Promise<void>>()
    private identityPromise?: Promise<ResolvedIdentityState>

    readonly agent: AgentInfo

    constructor(
        private readonly posthog: PostHog,
        private readonly options: CliAnalyticsOptions,
        private readonly anonymousId: string
    ) {
        if (options.logger) {
            setLogger(options.logger)
        }
        this.sessionId = options.sessionId ?? newSessionId()
        this.environment = collectEnvironment()
        this.agent = options.agent === false ? { isAgent: false, source: null } : (options.agent ?? detectAgent())
        this.enableExceptionAutocapture = true
        this.sink = new CliEventSink(posthog, {
            enabled: isTelemetryEnabled(process.env, options.enabled),
            debug: isDebugMode(),
        })
    }

    private resolveIdentityState(): Promise<ResolvedIdentityState> {
        if (!this.identityPromise) {
            this.identityPromise = this.computeIdentity()
        }
        return this.identityPromise
    }

    private async computeIdentity(): Promise<ResolvedIdentityState> {
        const anonymous: ResolvedIdentityState = {
            distinctId: this.anonymousId,
            groups: this.options.groups,
            processPersonProfile: this.options.personProfiles === 'always',
        }

        const identity = await this.runIdentify()
        if (!identity) {
            return anonymous
        }
        return {
            distinctId: identity.distinctId,
            setProperties: identity.properties,
            groups: { ...this.options.groups, ...identity.groups },
            processPersonProfile: true,
        }
    }

    private async runIdentify(): Promise<UserIdentity | null> {
        const { identify } = this.options
        if (!identify) {
            return null
        }
        try {
            return typeof identify === 'function' ? await identify() : identify
        } catch (error) {
            log(`identify() threw; capturing anonymously: ${error}`)
            return null
        }
    }

    /** Schedule a fire-and-forget capture, tracked so {@link flush} can await it. */
    private emit(partial: CliEvent): void {
        const task = this.resolveIdentityState()
            .then((identity) =>
                this.sink.capture(this.materialize(partial, identity), {
                    enableExceptionAutocapture: this.enableExceptionAutocapture,
                    beforeSend: this.options.beforeSend,
                })
            )
            .catch((error) => log(`Failed to capture event: ${error}`))
            .finally(() => {
                this.pending.delete(task)
            })
        this.pending.add(task)
    }

    /** Stamp shared context (identity, session, cli, env, agent, global props) onto an event. */
    private materialize(partial: CliEvent, identity: ResolvedIdentityState): CliEvent {
        return {
            ...partial,
            sessionId: partial.sessionId ?? this.sessionId,
            distinctId: partial.distinctId ?? identity.distinctId,
            setProperties: partial.setProperties ?? identity.setProperties,
            groups: partial.groups ?? identity.groups,
            processPersonProfile: partial.processPersonProfile ?? identity.processPersonProfile,
            cli: this.options.cli,
            environment: this.environment,
            agent: this.agent.isAgent || this.options.agent !== false ? this.agent : undefined,
            properties: mergeProperties(this.options.eventProperties, partial.properties),
        }
    }

    trackCommand(data: CommandCaptureData): void {
        const resolvedIntent = resolveIntent(data.intent, data.intentSource)
        const isError = data.isError ?? (data.exitCode !== undefined && data.exitCode !== 0)
        this.emit({
            eventType: CliAnalyticsEventType.cliCommandRun,
            timestamp: data.timestamp,
            distinctId: data.distinctId,
            sessionId: data.sessionId,
            setProperties: data.setProperties,
            groups: data.groups,
            command: data.command,
            subcommand: data.subcommand,
            flags: data.flags,
            argsCount: data.argsCount,
            exitCode: data.exitCode,
            durationMs: data.durationMs,
            isError,
            error: isError && data.error !== undefined ? captureException(data.error) : null,
            intent: resolvedIntent?.intent,
            intentSource: resolvedIntent?.source,
            properties: data.properties,
        })
    }

    command(command: string, options: CommandOptions = {}): CommandTracker {
        const startedAt = Date.now()
        let finished = false
        return {
            finish: (outcome: CommandOutcome = {}): void => {
                if (finished) {
                    return
                }
                finished = true
                this.trackCommand({
                    command,
                    subcommand: options.subcommand,
                    flags: options.flags,
                    argsCount: options.argsCount,
                    durationMs: Date.now() - startedAt,
                    exitCode: outcome.exitCode,
                    isError: outcome.isError,
                    error: outcome.error,
                    intent: outcome.intent ?? options.intent,
                    intentSource: outcome.intentSource ?? options.intentSource,
                    properties: outcome.properties,
                })
            },
        }
    }

    track(event: string, properties?: JsonRecord): void {
        this.emit({
            eventType: CliAnalyticsEventType.custom,
            eventName: event,
            properties,
        })
    }

    async flush(): Promise<void> {
        await Promise.allSettled([...this.pending])
        try {
            await this.posthog.flush()
        } catch (error) {
            log(`flush() failed: ${error}`)
        }
    }

    async shutdown(): Promise<void> {
        await Promise.allSettled([...this.pending])
        try {
            await this.posthog.shutdown()
        } catch (error) {
            log(`shutdown() failed: ${error}`)
        }
    }
}

function mergeProperties(base: JsonRecord | undefined, extra: JsonRecord | null | undefined): JsonRecord | null {
    if (!base && !extra) {
        return null
    }
    return { ...base, ...extra }
}

/**
 * Instruments a CLI for PostHog analytics. Resolves the anonymous identity,
 * session, agent detection, and runtime environment once, then returns a handle
 * for capturing command runs and custom events. The caller owns the
 * `posthog-node` client (construct it with `flushAt: 1, flushInterval: 0` for a
 * short-lived process) and should `await analytics.shutdown()` at the natural
 * end of the command.
 *
 * Degrades gracefully: a failure to wire up returns a no-op handle so the host
 * CLI keeps working.
 */
export function instrument(posthog: PostHog, options: CliAnalyticsOptions): CliAnalytics {
    try {
        const identity = resolveIdentity(options.cli.name)
        const anonymousId = options.anonymousId ?? identity.anonymousId
        const context = new CliAnalyticsContext(posthog, options, anonymousId)
        return {
            command: (command, commandOptions) => context.command(command, commandOptions),
            trackCommand: (data) => context.trackCommand(data),
            track: (event, properties) => context.track(event, properties),
            agent: context.agent,
            flush: () => context.flush(),
            shutdown: () => context.shutdown(),
        }
    } catch (error) {
        log(`Failed to instrument CLI: ${error}`)
        return {
            command: () => ({ finish: () => undefined }),
            trackCommand: () => undefined,
            track: () => undefined,
            agent: { isAgent: false, source: null },
            flush: async () => undefined,
            shutdown: async () => undefined,
        }
    }
}
