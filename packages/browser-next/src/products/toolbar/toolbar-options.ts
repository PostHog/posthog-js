import type { BrowserExtension } from '../../core/context/browser-client'
import type { ToolbarParams } from '@posthog/types'

export type { ToolbarParams } from '@posthog/types'

export interface ToolbarOptions {
    /** PostHog app origin the toolbar signs in to. Defaults to the app origin for a PostHog Cloud `apiHost`, otherwise `apiHost`. */
    uiHost?: string
    /** Origin that serves `/static/toolbar.js`. Defaults to the client's asset host. */
    assetHost?: string
    /** Disable toolbar telemetry when the client uses a self-hosted or proxied `apiHost`. */
    disableMetrics?: boolean
    /** Prepare the toolbar script before insertion, for example to apply a CSP nonce. Return `null` to cancel loading. */
    prepareScript?: (script: HTMLScriptElement) => HTMLScriptElement | null
}

export type ToolbarConfiguration = false | ToolbarOptions

export interface ToolbarExtension extends BrowserExtension {
    /** Load the toolbar with the given parameters. Returns false when the toolbar is already running or unavailable. */
    loadToolbar(params?: ToolbarParams): boolean
}
