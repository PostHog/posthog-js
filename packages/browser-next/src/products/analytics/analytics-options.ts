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

export type LoadStrategy = 'lazy' | 'eager'

/** Automatic analytics loading configured by the default package entrypoint. */
export interface AutomaticAnalyticsOptions extends AnalyticsOptions {
    /** Acquire analytics on demand and load delivery after admission, or acquire and start delivery during initialization. Defaults to `lazy`. */
    load?: LoadStrategy
}

export type AnalyticsConfiguration = false | AutomaticAnalyticsOptions

/** Capture configuration at client creation, independently of when the product loads. */
export const snapshotAutomaticAnalyticsOptions = (
    options: AutomaticAnalyticsOptions = {}
): AutomaticAnalyticsOptions => {
    const snapshot: AutomaticAnalyticsOptions = {}
    for (const key of ['flushAt', 'flushInterval', 'personProfiles', 'load'] as const) {
        try {
            const value = options[key]
            if (value !== undefined) Object.defineProperty(snapshot, key, { value, enumerable: true })
        } catch {
            // A missing value retains the product default.
        }
    }
    return snapshot
}
