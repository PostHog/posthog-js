import type { CliIntentSource } from '../types'

type EnvLike = Record<string, string | undefined>

/** Env var an agent can set to declare its intent for the command it's about to run. */
export const INTENT_ENV = 'POSTHOG_CLI_INTENT'

export interface ResolvedIntent {
    intent: string
    source: CliIntentSource
}

function normalize(intent: string | null | undefined): string | null {
    if (typeof intent !== 'string') {
        return null
    }
    const trimmed = intent.trim()
    return trimmed ? trimmed : null
}

/**
 * Resolves the intent for a command. An explicitly-provided intent (from a
 * `--intent` flag or the capture API) wins with `source: 'flag'`; otherwise the
 * `POSTHOG_CLI_INTENT` env var is used with `source: 'inferred'`. The source
 * values mirror the MCP SDK's `$mcp_intent_source` so both feed one clustering
 * pipeline.
 */
export function resolveIntent(
    explicit: string | undefined,
    explicitSource: CliIntentSource | undefined,
    env: EnvLike = process.env
): ResolvedIntent | null {
    const explicitIntent = normalize(explicit)
    if (explicitIntent) {
        return { intent: explicitIntent, source: explicitSource ?? 'flag' }
    }
    const envIntent = normalize(env[INTENT_ENV])
    if (envIntent) {
        return { intent: envIntent, source: 'inferred' }
    }
    return null
}
