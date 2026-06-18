import { window } from './globals'

// When angular patches functions they pass the above `isNativeFunction` check (at least the MutationObserver)
export const isAngularZonePresent = (): boolean => {
    return !!(window as any).Zone
}

export const isDocument = (x: unknown): x is Document => {
    // eslint-disable-next-line posthog-js/no-direct-document-check
    return x instanceof Document
}
