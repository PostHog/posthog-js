import type { PostHog } from 'posthog-js'

// Process-level singleton, mirroring the posthog-js default export which is
// itself a module-level singleton. Safe because setDefaultPostHogInstance is
// only called once at module evaluation time by src/index.ts.
let defaultPostHogInstance: PostHog | undefined

export function setDefaultPostHogInstance(instance: PostHog | undefined): void {
    defaultPostHogInstance = instance
}

export function getDefaultPostHogInstance(): PostHog | undefined {
    return defaultPostHogInstance
}
