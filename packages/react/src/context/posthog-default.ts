import type { PostHog } from 'posthog-js'
import { sharedState } from './shared-state'

// Each full entrypoint keeps its own default client, so PostHogProvider initializes the posthog-js copy
// bundled with it. The first one is also shared, as the fallback for a context created by another entrypoint.
let defaultPostHogInstance: PostHog | undefined

export function setDefaultPostHogInstance(instance: PostHog | undefined): void {
    if (!sharedState.defaultPostHogInstance || sharedState.defaultPostHogInstance === defaultPostHogInstance) {
        sharedState.defaultPostHogInstance = instance
    }
    defaultPostHogInstance = instance
}

export function getDefaultPostHogInstance(): PostHog | undefined {
    return defaultPostHogInstance
}
