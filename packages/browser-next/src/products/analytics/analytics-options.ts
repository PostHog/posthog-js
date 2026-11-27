export type PersonProfileMode = 'always' | 'never' | 'identified_only'

/** Options owned by the analytics product, whether loaded automatically or explicitly composed. */
export interface AnalyticsOptions {
    /** Controls person processing. Defaults to `identified_only`. */
    personProfiles?: PersonProfileMode
    /** Number of queued events that triggers delivery. Defaults to 20; clamped to the V1 limit of 100. */
    flushAt?: number
    /** Maximum delay in milliseconds before queued events are delivered. Defaults to 3000; 0 disables it. */
    flushInterval?: number
}
