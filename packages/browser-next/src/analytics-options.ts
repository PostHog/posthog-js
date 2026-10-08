/** Scheduling options shared by automatic and explicitly composed analytics delivery. */
export interface AnalyticsOptions {
    /** Number of queued events that triggers delivery. Defaults to 20; clamped to the V1 limit of 100. */
    flushAt?: number
    /** Maximum delay in milliseconds before queued events are delivered. Defaults to 3000; 0 disables it. */
    flushInterval?: number
}

export type LoadStrategy = 'lazy' | 'eager'

/** Automatic analytics loading configured by the default package entrypoint. */
export interface AutomaticAnalyticsOptions extends AnalyticsOptions {
    /** Load after the first admitted event, or while the client initializes. Defaults to `lazy`. */
    load?: LoadStrategy
}

export type AnalyticsConfiguration = false | AutomaticAnalyticsOptions
