import type { ErrorTracking } from '@posthog/core'
import type { CliAnalyticsEventType } from './extensions/event-types'
import type { LoggerFn } from './extensions/logger'

export type JsonRecord = Record<string, unknown>
export type MaybePromise<T> = T | Promise<T>

/** PostHog error-tracking properties (`$exception_list`). Re-exported from `@posthog/core`. */
export type ErrorProperties = ErrorTracking.ErrorProperties
/** A single parsed stack frame. Re-exported from `@posthog/core`. */
export type StackFrame = ErrorTracking.StackFrame

/** A fully-built PostHog event payload, ready for `posthog.capture()`. */
export interface PostHogCaptureEvent {
    distinct_id: string
    event: string
    properties: Record<string, unknown>
    timestamp: string
    type: 'capture'
}

/** How a captured intent was obtained. Mirrors the MCP SDK's `$mcp_intent_source`. */
export type CliIntentSource = 'flag' | 'inferred'

/** How an agent was detected — an explicit env var, or a softer heuristic. */
export type AgentDetectionSource = 'env_var' | 'heuristic'

/** Result of {@link detectAgent}: is an AI agent driving the CLI, and which one. */
export interface AgentInfo {
    isAgent: boolean
    /** Canonical agent name (e.g. `claude_code`, `cursor`) when known. */
    agentName?: string
    /** How the determination was made, or `null` when no agent was detected. */
    source: AgentDetectionSource | null
}

/** Static metadata about the CLI being instrumented. */
export interface CliInfo {
    /** The CLI's own name (e.g. `acme`). Stamped as `$cli_name`. */
    name: string
    /** The CLI's own version (e.g. `1.4.2`). Stamped as `$cli_version`. */
    version?: string
}

/** Collected once per process — OS, arch, runtime, TTY/CI flags. */
export interface EnvironmentInfo {
    os: string
    arch: string
    runtime: string
    isTty: boolean
    isCi: boolean
}

/**
 * Identity for the calling user. Returning a value sets `distinct_id` and `$set`
 * on events; omitting it keeps the SDK's anonymous persisted id with person
 * processing disabled (so anonymous installs don't inflate person counts).
 */
export interface UserIdentity {
    /** The person's distinct id (becomes `distinct_id`). */
    distinctId: string
    /** Person properties, written to `$set`. */
    properties?: JsonRecord
    /** PostHog group memberships as `{ groupType: groupKey }` → `$groups`. */
    groups?: Record<string, string>
}

/**
 * Hook invoked for every event just before it is handed to `posthog.capture()`.
 * Return the event (optionally mutated) to send it, or a nullish value to drop
 * it. A throw drops that event. Mirrors posthog-node's `beforeSend`.
 */
export type BeforeSendFn = (event: PostHogCaptureEvent) => MaybePromise<PostHogCaptureEvent | null | undefined>

export interface CliAnalyticsOptions {
    /** Static metadata about the CLI. Stamped on every event. */
    cli: CliInfo
    /**
     * Override agent detection. Pass a precomputed {@link AgentInfo} to skip the
     * built-in env scan, or `false` to omit the agent dimension entirely.
     */
    agent?: AgentInfo | false
    /**
     * Identity for the session. An object is treated as a static identity; a
     * function is resolved lazily on first capture. Omit for anonymous capture.
     */
    identify?: UserIdentity | (() => MaybePromise<UserIdentity | null>) | null
    /** Group memberships applied to every event (`{ groupType: groupKey }`). */
    groups?: Record<string, string>
    /**
     * Person-processing mode. `identified_only` (default) disables person
     * profiles for anonymous capture; `always` creates a profile for the
     * persisted anonymous id too. Mirrors posthog-node.
     */
    personProfiles?: 'always' | 'identified_only'
    /** Inspect/modify/drop each event before capture. Runs at the single sink chokepoint. */
    beforeSend?: BeforeSendFn
    /** Extra properties merged onto every auto-captured event. Values must be JSON-serializable. */
    eventProperties?: JsonRecord
    /** Opt-in logger for SDK-internal warnings. Defaults to a no-op (never writes to stdout). */
    logger?: LoggerFn
    /**
     * Override consent. By default the SDK honors `DO_NOT_TRACK` and
     * `POSTHOG_CLI_TELEMETRY_DISABLED`; pass `false` to force-disable in code.
     */
    enabled?: boolean
    /** Override the session id (defaults to a fresh per-invocation uuid). */
    sessionId?: string
    /** Override the anonymous distinct id (defaults to a persisted machine-local uuid). */
    anonymousId?: string
}

/** Fields shared by every capture call. */
export interface CliCaptureCommon {
    /** Resolved distinct id. Defaults to the session/anonymous id when omitted. */
    distinctId?: string
    /** Session id → `$session_id`. */
    sessionId?: string
    /** Person properties → `$set`. */
    setProperties?: JsonRecord
    /** Group memberships → `$groups`. */
    groups?: Record<string, string>
    /** Extra event properties, merged verbatim. */
    properties?: JsonRecord
    /** Event timestamp. Defaults to now. */
    timestamp?: Date
}

/** Payload for capturing a command invocation. Emits `$cli_command_run`. */
export interface CommandCaptureData extends CliCaptureCommon {
    /** Top-level command (e.g. `deploy`) → `$cli_command`. */
    command: string
    /** Subcommand (e.g. `prod`) → `$cli_subcommand`. */
    subcommand?: string
    /** Flag NAMES used (never values) → `$cli_flags`. */
    flags?: string[]
    /** Positional argument count → `$cli_args_count`. */
    argsCount?: number
    /** Process exit code → `$cli_exit_code`. */
    exitCode?: number
    /** Wall-clock duration → `$cli_duration_ms`. */
    durationMs?: number
    /** Whether the command failed → `$cli_is_error`. Inferred from a non-zero exit code when omitted. */
    isError?: boolean
    /** The thrown value, turned into an `$exception` sibling when `isError`. */
    error?: unknown
    /** Agent intent → `$cli_intent`. */
    intent?: string
    /** How the intent was obtained → `$cli_intent_source`. */
    intentSource?: CliIntentSource
}

/** A live handle for a single command, opened with {@link CliAnalytics.command}. */
export interface CommandTracker {
    /**
     * Finish the command: stamps duration (since the tracker was opened) and emits
     * `$cli_command_run`. Idempotent — only the first call records an event.
     */
    finish(outcome?: CommandOutcome): void
}

export interface CommandOutcome {
    exitCode?: number
    isError?: boolean
    error?: unknown
    intent?: string
    intentSource?: CliIntentSource
    /** Extra event properties merged onto this command's event. */
    properties?: JsonRecord
}

/** Options accepted when opening a command tracker. */
export interface CommandOptions {
    subcommand?: string
    flags?: string[]
    argsCount?: number
    intent?: string
    intentSource?: CliIntentSource
}

/** Handle returned by {@link instrument}. */
export interface CliAnalytics {
    /**
     * Open a command tracker. Call `.finish()` when the command completes to emit
     * `$cli_command_run` with the measured duration.
     */
    command(command: string, options?: CommandOptions): CommandTracker
    /** One-shot command capture (when you already know duration + outcome). */
    trackCommand(data: CommandCaptureData): void
    /** Capture a custom event (sent verbatim — not `$`-prefixed). */
    track(event: string, properties?: JsonRecord): void
    /** The resolved agent detection result for this process. */
    readonly agent: AgentInfo
    /** Flush queued events. Resolves once they're sent (or the timeout elapses). */
    flush(): Promise<void>
    /** Flush and tear down. Call at the natural end of the command. */
    shutdown(): Promise<void>
}

/** A partially-built CLI event as it flows through the SDK before capture. */
export interface CliEvent {
    id?: string
    eventType: CliAnalyticsEventType
    /** Explicit PostHog event name; overrides the name derived from `eventType`. */
    eventName?: string
    timestamp?: Date
    sessionId?: string
    /** Resolved distinct id. */
    distinctId?: string
    /** Person properties → `$set`. */
    setProperties?: JsonRecord
    /** Group memberships → `$groups`. */
    groups?: Record<string, string>
    /** Whether to create a person profile for this event's distinct id. */
    processPersonProfile?: boolean
    command?: string
    subcommand?: string
    flags?: string[]
    argsCount?: number
    exitCode?: number
    durationMs?: number
    isError?: boolean
    error?: ErrorProperties | null
    intent?: string
    intentSource?: CliIntentSource
    cli?: CliInfo
    environment?: EnvironmentInfo
    agent?: AgentInfo
    properties?: JsonRecord | null
}
