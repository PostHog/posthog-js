export const POSTHOG_CLI_ANALYTICS_SOURCE = 'posthog_cli_analytics'

export const DEFAULT_INTENT_FLAG = 'intent'

/**
 * Env vars consulted by `consent.ts` to disable telemetry. `DO_NOT_TRACK` is the
 * cross-tool community convention (https://consoledonottrack.com); the
 * PostHog-specific var lets a CLI opt a single product out without affecting
 * other tools.
 */
export const DO_NOT_TRACK_ENV = 'DO_NOT_TRACK'
export const TELEMETRY_DISABLED_ENV = 'POSTHOG_CLI_TELEMETRY_DISABLED'
export const TELEMETRY_DEBUG_ENV = 'POSTHOG_CLI_TELEMETRY_DEBUG'

// All PostHog-owned event names start with `$` per the PostHog convention.
// Non-`$` names would be treated as customer-defined events and confuse the schema.
export const PostHogCliAnalyticsEvent = {
    CommandRun: '$cli_command_run',
    Custom: '$cli_custom',
    Exception: '$exception',
    Identify: '$identify',
} as const

export type PostHogCliAnalyticsEvent = (typeof PostHogCliAnalyticsEvent)[keyof typeof PostHogCliAnalyticsEvent]

export const PostHogCliAnalyticsProperty = {
    // Command shape — flag NAMES only, never values.
    Command: '$cli_command',
    Subcommand: '$cli_subcommand',
    Flags: '$cli_flags',
    ArgsCount: '$cli_args_count',
    // Outcome.
    ExitCode: '$cli_exit_code',
    DurationMs: '$cli_duration_ms',
    IsError: '$cli_is_error',
    // CLI + SDK identity.
    CliName: '$cli_name',
    CliVersion: '$cli_version',
    SdkLanguage: '$cli_sdk_language',
    SdkVersion: '$cli_sdk_version',
    Source: '$cli_source',
    // Runtime environment.
    Os: '$cli_os',
    Arch: '$cli_arch',
    Runtime: '$cli_runtime',
    IsTty: '$cli_is_tty',
    IsCi: '$cli_is_ci',
    // Agent dimension — the differentiator.
    IsAgent: '$cli_is_agent',
    AgentName: '$cli_agent_name',
    AgentSource: '$cli_agent_source',
    // Intent — schema-compatible with the MCP SDK's `$mcp_intent`.
    Intent: '$cli_intent',
    IntentSource: '$cli_intent_source',
    // Session.
    SessionId: '$session_id',
} as const

export type PostHogCliAnalyticsProperty = (typeof PostHogCliAnalyticsProperty)[keyof typeof PostHogCliAnalyticsProperty]
