/**
 * Internal SDK event vocabulary, mapped to PostHog event names in
 * `posthog-events.ts`. Kept separate from the wire-level `$cli_*` names so the
 * observed event shape and the emitted event name can evolve independently.
 */
export const CliAnalyticsEventType = {
    custom: 'posthog:custom',
    identify: 'posthog:identify',
    cliCommandRun: 'cli:command_run',
} as const

export type CliAnalyticsEventType = (typeof CliAnalyticsEventType)[keyof typeof CliAnalyticsEventType]
