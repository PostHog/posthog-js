import type {
    PerformanceCaptureConfig,
    SessionRecordingCanvasOptions,
    SessionRecordingOptions,
    ToolbarParams,
} from '@posthog/types'

import type { Compression } from './compression'
import type { NetworkRecordOptions } from './network-recording'
import type { PropertyMatchType, Survey } from './surveys'

export type FlagVariant = { flag: string; variant: string }

export interface SessionRecordingUrlTrigger {
    url: string
    matching: 'regex'
}

/**
 * V2 event trigger - always an object with name, optionally with property filters.
 * The server normalizes bare event name strings to this shape before sending.
 */
export interface SessionRecordingEventTrigger {
    name: string
    properties?: SessionRecordingTriggerPropertyFilter[]
}

export interface SessionRecordingTriggerPropertyFilter {
    key: string
    type: 'event' | 'person'
    operator?: 'exact' | 'is_not' | 'icontains' | 'not_icontains' | 'regex' | 'not_regex' | 'gt' | 'lt'
    value?: string | number | boolean | string[]
}

/**
 * V2 Trigger Group - represents a single trigger group with its own conditions and sample rate
 */
export interface SessionRecordingTriggerGroup {
    id: string
    name: string
    sampleRate: number
    minDurationMs?: number
    conditions: {
        matchType: 'any' | 'all'
        events?: SessionRecordingEventTrigger[]
        urls?: SessionRecordingUrlTrigger[]
        flag?: string | FlagVariant
        properties?: SessionRecordingTriggerPropertyFilter[]
    }
}

export type SessionRecordingRemoteConfig = SessionRecordingCanvasOptions & {
    endpoint?: string
    consoleLogRecordingEnabled?: boolean
    // The API returns a decimal between 0 and 1 as a string.
    sampleRate?: string | null
    minimumDurationMilliseconds?: number
    linkedFlag?: string | FlagVariant | null
    networkPayloadCapture?: Pick<NetworkRecordOptions, 'recordBody' | 'recordHeaders'>
    masking?: Pick<SessionRecordingOptions, 'maskAllInputs' | 'maskTextSelector' | 'blockSelector'>
    urlTriggers?: SessionRecordingUrlTrigger[]
    scriptConfig?: { script?: string | undefined }
    urlBlocklist?: SessionRecordingUrlTrigger[]
    eventTriggers?: string[]
    /**
     * Controls how event, URL, sampling, and linked flag triggers are combined.
     *
     * `any` means that if any of the triggers match, the session will be recorded.
     * `all` means that all the triggers must match for the session to be recorded.
     */
    triggerMatchType?: 'any' | 'all'
    /**
     * Config version - defaults to 1 (legacy).
     * When version is 2, triggerGroups is used instead of individual trigger fields.
     */
    version?: 1 | 2
    /**
     * V2 Trigger Groups - multiple named trigger groups with their own conditions and sample rates.
     * Only used when version === 2.
     */
    triggerGroups?: SessionRecordingTriggerGroup[]
}

export interface ErrorTrackingSuppressionRule {
    type: 'AND' | 'OR'
    values: ErrorTrackingSuppressionRuleValue[]
}

export interface ErrorTrackingSuppressionRuleValue {
    key: '$exception_types' | '$exception_values'
    operator: PropertyMatchType
    value: string | string[]
    type: string
}

/** Position of the conversations widget on the screen. */
export type WidgetPosition = 'bottom_left' | 'bottom_right' | 'top_left' | 'top_right'

/** Remote configuration for conversations from the PostHog server. */
export interface ConversationsRemoteConfig {
    /** Whether conversations are enabled for this team. */
    enabled: boolean
    /** Whether the widget UI should be shown. */
    widgetEnabled?: boolean
    /** Public token for authenticating conversations API requests. */
    token: string
    /** Greeting text to show when the widget is first opened. */
    greetingText?: string
    /** Primary color for the widget UI. */
    color?: string
    /** Placeholder text for the message input. */
    placeholderText?: string
    /** Whether to require an email address before starting a conversation. */
    requireEmail?: boolean
    /** Whether to show the name field in the identification form. */
    collectName?: boolean
    /** Title for the identification form. */
    identificationFormTitle?: string
    /** Description for the identification form. */
    identificationFormDescription?: string
    /** Domains where the widget may be shown. */
    domains?: string[]
    /** Position of the widget on the screen. */
    widgetPosition?: WidgetPosition
}

/**
 * Remote configuration for a PostHog browser client.
 *
 * These settings can be configured in PostHog. Configuration set directly on
 * the client takes precedence over values from the server.
 */
export interface RemoteConfig {
    /** Supported compression algorithms. */
    supportedCompression: Compression[]

    /**
     * If true, disables autocapture. When absent or not a boolean, the SDK
     * keeps the last known server value; a visitor with no stored value keeps
     * autocapture off until a response containing the field arrives.
     */
    autocapture_opt_out?: boolean

    /** Performance capture configuration shared by replay and web vitals. */
    capturePerformance?: boolean | PerformanceCaptureConfig

    /** Custom endpoint configuration for analytics events. */
    analytics?: {
        endpoint?: string
    }

    /** Whether `$elements_chain` is sent as a string rather than an array. */
    elementsChainAsString?: boolean

    /** Error tracking configuration. */
    errorTracking?: {
        autocaptureExceptions?: boolean
        captureExtensionExceptions?: boolean
        suppressionRules?: ErrorTrackingSuppressionRule[]
    }

    /** Log capture configuration. */
    logs?: {
        captureConsoleLogs?: boolean
    }

    /** Exception autocapture configuration. */
    autocaptureExceptions?: boolean | { endpoint?: string }

    /** Session recording configuration. */
    sessionRecording?: SessionRecordingRemoteConfig | false

    /** Whether surveys are enabled, optionally including their definitions. */
    surveys?: boolean | Survey[]

    /** Whether product tours are enabled. */
    productTours?: boolean

    /** Parameters for the toolbar. */
    toolbarParams: ToolbarParams

    /** @deprecated Renamed to `toolbarParams`; still present on older API responses. */
    editorParams?: ToolbarParams

    /** @deprecated Moved to `toolbarParams`. */
    toolbarVersion: 'toolbar'

    /** Whether the current user is authenticated. */
    isAuthenticated: boolean

    /** Site apps available to the client. */
    siteApps: { id: string; url: string }[]

    /** Whether heatmaps are enabled. */
    heatmaps?: boolean

    /** Whether to capture only identified users by default. */
    defaultIdentifiedOnly?: boolean

    /** Whether to capture dead clicks. */
    captureDeadClicks?: boolean

    /** Whether the team has any feature flags enabled. */
    hasFeatureFlags?: boolean

    /** Conversations widget configuration. */
    conversations?: boolean | ConversationsRemoteConfig
}
