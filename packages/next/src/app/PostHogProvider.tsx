import React from 'react'
import type { PostHogConfig } from 'posthog-js'
import { ClientPostHogProvider } from '../client/ClientPostHogProvider'
import type { BootstrapConfig } from '../client/ClientPostHogProvider'
import { cookies } from 'next/headers'
import { PostHogServer } from '../server/PostHogServer'
import { NEXTJS_CLIENT_DEFAULTS, resolveApiKey } from '../shared/config'
import { readPostHogCookie } from '../shared/cookie'
import type { AllFlagsOptions } from '../shared/scoped-client'

export interface BootstrapFlagsConfig {
    /** Specific flag keys to evaluate. If omitted, evaluates all flags. */
    flags?: string[]
    /** Groups to evaluate flags for (e.g., `{ company: 'posthog' }`). */
    groups?: AllFlagsOptions['groups']
    /** Known person properties to use for flag evaluation. */
    personProperties?: AllFlagsOptions['personProperties']
    /** Known group properties to use for flag evaluation, keyed by group type. */
    groupProperties?: AllFlagsOptions['groupProperties']
}

export interface PostHogProviderProps {
    /**
     * PostHog project API key (starts with phc_).
     * If omitted, reads from `NEXT_PUBLIC_POSTHOG_KEY` env var.
     */
    apiKey?: string
    /** Optional posthog-js configuration overrides */
    options?: Partial<PostHogConfig>
    /**
     * Enable server-side feature flag evaluation for bootstrap.
     *
     * When enabled, the provider calls `cookies()` to read the user's
     * identity and evaluates flags via `posthog-node`. This opts the
     * route into **dynamic rendering** (incompatible with static
     * generation / ISR).
     *
     * When omitted or falsy (default), no dynamic APIs are called and
     * the provider is safe for static rendering and PPR.
     */
    bootstrapFlags?: boolean | BootstrapFlagsConfig
    children: React.ReactNode
}

/**
 * PostHog provider for Next.js App Router.
 *
 * By default this component is **static-safe** — it does not call any
 * dynamic APIs (`cookies()`, `headers()`) and is compatible with static
 * generation, ISR, and Partial Prerendering (PPR).
 *
 * When `bootstrapFlags` is enabled, the provider evaluates feature flags
 * on the server and bootstraps the client SDK, which opts the route into
 * dynamic rendering.
 *
 * All PostHog hooks (`usePostHog`, `useFeatureFlagEnabled`, etc.)
 * require this provider as an ancestor.
 */
export async function PostHogProvider({ apiKey: apiKeyProp, options, bootstrapFlags, children }: PostHogProviderProps) {
    const apiKey = resolveApiKey(apiKeyProp)
    if (!apiKey.startsWith('phc_')) {
        console.warn(`[PostHog Next.js] apiKey "${apiKey}" does not start with "phc_". This may not be a valid PostHog project API key.`)
    }

    const host = options?.api_host ?? process.env.NEXT_PUBLIC_POSTHOG_HOST
    const resolvedOptions: Partial<PostHogConfig> = {
        ...NEXTJS_CLIENT_DEFAULTS,
        ...options,
        ...(host ? { api_host: host } : {}),
    }

    let bootstrap: BootstrapConfig | undefined

    if (bootstrapFlags) {
        try {
            bootstrap = await evaluateFlags(apiKey, resolvedOptions, bootstrapFlags)

            // Considering we've just evaluated flags via SSR, there's no need to immediately
            // reload them from the client.
            resolvedOptions.advanced_disable_feature_flags_on_first_load = true
        } catch (error) {
            console.warn('[PostHog Next.js] Failed to evaluate bootstrap flags:', error)
        }
    }

    return (
        <ClientPostHogProvider apiKey={apiKey} options={resolvedOptions} bootstrap={bootstrap}>
            {children}
        </ClientPostHogProvider>
    )
}

// Module-level cache for PostHogServer instances, keyed by "apiKey:host".
// Avoids creating a new posthog-node client (with its poller and flush queue)
// on every render.
const serverCache = new Map<string, PostHogServer>()

function getOrCreateServer(apiKey: string, host: string | undefined) {
    const cacheKey = `${apiKey}:${host ?? ''}`
    let server = serverCache.get(cacheKey)
    if (!server) {
        server = new PostHogServer(apiKey, { host })
        serverCache.set(cacheKey, server)
    }
    return server
}

/**
 * React.cache-wrapped flag evaluation.
 *
 * Deduplicates posthog-node calls within a single RSC render pass.
 * All arguments are primitives so React.cache's reference-equality
 * check works correctly. The `optionsJson` parameter is a serialized
 * options object forwarded to posthog-node's getAllFlagsAndPayloads.
 */
const cachedFetchFlags = React.cache(
    async (apiKey: string, host: string, distinctId: string, optionsJson: string) => {
        const server = getOrCreateServer(apiKey, host || undefined)
        const client = server.getClientForDistinctId(distinctId)
        const options = JSON.parse(optionsJson)
        return client.getAllFlagsAndPayloads(options)
    }
)

async function evaluateFlags(
    apiKey: string,
    options: Partial<PostHogConfig> | undefined,
    bootstrapFlags: boolean | BootstrapFlagsConfig
): Promise<BootstrapConfig | undefined> {
    const cookieStore = await cookies()
    const cookieState = readPostHogCookie(cookieStore, apiKey)
    if (!cookieState) {
        return undefined
    }

    const { flags: flagKeys, ...flagOptions } = typeof bootstrapFlags === 'object' ? bootstrapFlags : {}
    const allFlagsOptions: AllFlagsOptions = { ...flagOptions, ...(flagKeys ? { flagKeys } : {}) }
    return cachedFetchFlags(
        apiKey,
        options?.api_host ?? '',
        cookieState.distinctId,
        JSON.stringify(allFlagsOptions)
    )
}
