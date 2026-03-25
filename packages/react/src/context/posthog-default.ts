import type { PostHog } from 'posthog-js'

let defaultPostHogInstance: PostHog | undefined

export function setDefaultPostHogInstance(instance: PostHog): void {
    defaultPostHogInstance = instance
}

export function getDefaultPostHogInstance(): PostHog | undefined {
    return defaultPostHogInstance
}
