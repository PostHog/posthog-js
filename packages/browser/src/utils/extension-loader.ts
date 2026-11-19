import type { PostHog } from '../posthog-core'
import { assignableWindow, PostHogExtensionKind } from './globals'

export type LoadExternalDependency = (
    posthog: PostHog,
    kind: PostHogExtensionKind,
    callback: (error?: string | Event, event?: Event) => void
) => void

let bundledLoader: LoadExternalDependency | undefined

export const setBundledExtensionLoader = (loader: LoadExternalDependency | undefined): void => {
    bundledLoader = loader
}

export const getBundledExtensionLoader = (): LoadExternalDependency | undefined => bundledLoader

// Any core on the page can replace the shared global, including one that predates
// require_subresource_integrity, so a hardened instance only uses the loader built into its own bundle.
export const getExtensionLoader = (posthog: PostHog): LoadExternalDependency | undefined =>
    posthog?.config.require_subresource_integrity
        ? posthog.__loadExternalDependency
        : assignableWindow.__PosthogExtensions__?.loadExternalDependency
