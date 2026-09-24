import type { PostHog } from 'posthog-js'
import { sharedState } from './shared-state'

// Kept in the shared state so the context of every entrypoint reads the client set by the full entrypoint.
export function setDefaultPostHogInstance(instance: PostHog | undefined): void {
    sharedState.defaultPostHogInstance = instance
}

export function getDefaultPostHogInstance(): PostHog | undefined {
    return sharedState.defaultPostHogInstance
}
