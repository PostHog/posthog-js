import React from 'react'
import type { PostHogConfig } from 'posthog-js'
import { ClientPostHogProvider } from '../client/ClientPostHogProvider'
import type { BootstrapConfig } from '../client/ClientPostHogProvider'
import { cookies } from 'next/headers'
import type { PostHogOptions } from 'posthog-node'
import { getOrCreateNodeClient } from '../server/nodeClientCache'
import { NEXTJS_CLIENT_DEFAULTS, resolveApiKey } from '../shared/config'
import { readPostHogCookie, isOptedOut } from '../shared/cookie'

type AllFlagsOptions = {
    groups?: Record<string, string>
    personProperties?: Record<string, string>
    groupProperties?: Record<string, Record<string, string>>
    onlyEvaluateLocally?: boolean
    disableGeoip?: boolean
    flagKeys?: string[]
}

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
    /** Optional posthog-js configuration overrides. */
    clientOptions?: Partial<PostHogConfig>
    /** Options passed to the posthog-node client used for server-side flag evaluation. */
    serverOptions?: Partial<PostHogOptions>
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
export async function PostHogProvider({
    apiKey: apiKeyProp,
    clientOptions,
    serverOptions,
    bootstrapFlags,
    children,
}: PostHogProviderProps) {
    const apiKey = resolveApiKey(apiKeyProp)
    if (!apiKey.startsWith('phc_')) {
        console.warn(
            `[PostHog Next.js] apiKey "${apiKey}" does not start with "phc_". This may not be a valid PostHog project API key.`
        )
    }

    const host = clientOptions?.api_host ?? process.env.NEXT_PUBLIC_POSTHOG_HOST
    const resolvedOptions: Partial<PostHogConfig> = {
        ...NEXTJS_CLIENT_DEFAULTS,
        ...clientOptions,
        ...(host ? { api_host: host } : {}),
    }

    let bootstrap: BootstrapConfig | undefined

    if (bootstrapFlags) {
        try {
            bootstrap = await evaluateFlags(apiKey, resolvedOptions, bootstrapFlags, serverOptions)

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

async function evaluateFlags(
    apiKey: string,
    options: Partial<PostHogConfig> | undefined,
    bootstrapFlags: boolean | BootstrapFlagsConfig,
    serverOptions?: Partial<PostHogOptions>
): Promise<BootstrapConfig | undefined> {
    const cookieStore = await cookies()

    if (isOptedOut(cookieStore, apiKey, options)) {
        return undefined
    }

    const cookieState = readPostHogCookie(cookieStore, apiKey)
    if (!cookieState) {
        return undefined
    }

    const host = serverOptions?.host ?? process.env.NEXT_PUBLIC_POSTHOG_HOST
    const nodeOptions: Partial<PostHogOptions> = { ...serverOptions, ...(host ? { host } : {}) }
    const client = await getOrCreateNodeClient(apiKey, nodeOptions)

    const { flags: flagKeys, ...flagOptions } = typeof bootstrapFlags === 'object' ? bootstrapFlags : {}
    const allFlagsOptions: AllFlagsOptions = { ...flagOptions, ...(flagKeys ? { flagKeys } : {}) }
    return client.getAllFlagsAndPayloads(cookieState.distinctId, allFlagsOptions)
}
