import type { AutocaptureConfig } from '@posthog/types'

export interface RageclickOptions {
    cssSelectorIgnorelist?: string[]
    contentIgnorelist?: boolean | string[]
    ignoreTextSelection?: boolean
    thresholdPx?: number
    clickCount?: number
    timeoutMs?: number
}

export interface AutocaptureOptions {
    urlAllowlist?: AutocaptureConfig['url_allowlist']
    urlIgnorelist?: AutocaptureConfig['url_ignorelist']
    domEventAllowlist?: AutocaptureConfig['dom_event_allowlist']
    elementAllowlist?: AutocaptureConfig['element_allowlist']
    cssSelectorAllowlist?: string[]
    /** Replaces the default .ph-no-autocapture and [data-ph-no-autocapture] exclusions. */
    cssSelectorIgnorelist?: string[]
    elementAttributeIgnorelist?: string[]
    /** Capture cut/copy/paste interactions. Defaults to false; paste text is never captured. */
    captureCopiedText?: boolean
    /** Defaults to false. Sensitive controls and values remain excluded independently. */
    maskAllElementAttributes?: boolean
    /** Defaults to false. */
    maskAllText?: boolean
    /** Strip URL fragments from captured links. Defaults to true. */
    disableCaptureUrlHashes?: boolean
    getCurrentUrl?: (defaultUrl: string) => string
    /** Defaults to enabled, ignoring stepper/navigation content and text-selection surfaces. */
    rageclick?: boolean | RageclickOptions
}

export type AutocaptureConfiguration = false | AutocaptureOptions

// Preserve callbacks and regular expressions while isolating caller-owned option arrays.
const copyArrays = <T extends object>(options: T): T =>
    Object.fromEntries(
        Object.entries(options).map(([key, value]) => [
            key,
            Array.isArray(value)
                ? value.map((entry: unknown) =>
                      entry instanceof RegExp ? new RegExp(entry.source, entry.flags) : entry
                  )
                : value,
        ])
    ) as T

export const snapshotAutocaptureOptions = (options: AutocaptureOptions = {}): AutocaptureOptions => ({
    ...copyArrays(options),
    ...(typeof options.rageclick === 'object' ? { rageclick: copyArrays(options.rageclick) } : {}),
})
