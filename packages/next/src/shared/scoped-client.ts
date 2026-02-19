import type { PostHog } from 'posthog-node'

// JSON-compatible type for feature flag payloads (matches @posthog/types JsonType)
type JsonType = string | number | boolean | null | undefined | { [key: string]: JsonType } | JsonType[]

/**
 * A scoped PostHog server client bound to a specific distinct_id.
 *
 * All calls are automatically scoped to the distinct_id extracted
 * from the PostHog cookie.
 *
 * Note that `identify` is not available from the server. Call it
 * from the client.
 */
export interface PostHogServerClient {
    /**
     * Capture an analytics event for this user.
     *
     * @param event - Event name (e.g., 'purchase_completed')
     * @param properties - Optional event properties
     *
     * @example
     * ```ts
     * const client = phServer.getClient(await cookies())
     * client.capture('item_purchased', { item_id: '123', price: 9.99 })
     * ```
     */
    capture(event: string, properties?: Record<string, unknown>): void

    /**
     * Check if a feature flag is enabled for this user.
     *
     * @param flagKey - Feature flag key
     * @returns true/false/undefined
     *
     * @example
     * ```ts
     * if (await client.isFeatureEnabled('new-checkout')) {
     *   // show new checkout
     * }
     * ```
     */
    isFeatureEnabled(flagKey: string): Promise<boolean | undefined>

    /**
     * Get the value of a feature flag for this user.
     *
     * @param flagKey - Feature flag key
     * @returns The flag value (string variant key, boolean, or undefined)
     */
    getFeatureFlag(flagKey: string): Promise<string | boolean | undefined>

    /**
     * Get the JSON payload of a feature flag for this user.
     *
     * @param flagKey - Feature flag key
     * @returns The JSON payload, or undefined
     */
    getFeatureFlagPayload(flagKey: string): Promise<JsonType | undefined>

    /**
     * Get all feature flags and their values for this user.
     *
     * @param flagKeys - Optional list of specific flag keys to evaluate.
     *                   If omitted, evaluates all flags.
     * @returns A record of flag keys to their values
     */
    getAllFlags(flagKeys?: string[]): Promise<Record<string, string | boolean>>

    /**
     * Get all feature flags and their payloads for this user.
     *
     * @param flagKeys - Optional list of specific flag keys to evaluate.
     *                   If omitted, evaluates all flags.
     * @returns An object with featureFlags and featureFlagPayloads records
     */
    getAllFlagsAndPayloads(flagKeys?: string[]): Promise<{
        featureFlags: Record<string, string | boolean>
        featureFlagPayloads: Record<string, JsonType>
    }>

    /**
     * Get the distinct_id this client is scoped to.
     */
    getDistinctId(): string

    /**
     * Flush pending events and shut down the underlying client.
     * Call this in cleanup handlers (e.g., API route finally blocks).
     */
    shutdown(): Promise<void>
}

/**
 * Creates a PostHogServerClient scoped to a specific distinct_id.
 * All calls are automatically bound to that user.
 *
 * Note that `identify` is not available from the server. Call it
 * from the client.
 */
export function createScopedClient(client: PostHog, distinctId: string): PostHogServerClient {
    return {
        capture(event: string, properties?: Record<string, unknown>) {
            client.capture({ distinctId, event, properties })
        },

        async isFeatureEnabled(flagKey: string) {
            return client.isFeatureEnabled(flagKey, distinctId, {})
        },

        async getFeatureFlag(flagKey: string) {
            return client.getFeatureFlag(flagKey, distinctId, {})
        },

        async getFeatureFlagPayload(flagKey: string) {
            return client.getFeatureFlagPayload(flagKey, distinctId)
        },

        async getAllFlags(flagKeys?: string[]) {
            return client.getAllFlags(distinctId, flagKeys ? { flagKeys } : {})
        },

        async getAllFlagsAndPayloads(flagKeys?: string[]) {
            const result = await client.getAllFlagsAndPayloads(distinctId, flagKeys ? { flagKeys } : {})
            return {
                featureFlags: result.featureFlags ?? {},
                featureFlagPayloads: result.featureFlagPayloads ?? {},
            }
        },

        getDistinctId() {
            return distinctId
        },

        async shutdown() {
            return client.shutdown()
        },
    }
}
