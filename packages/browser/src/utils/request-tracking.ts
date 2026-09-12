import { convertToURL } from '@posthog/browser-common/utils/request-utils'

const activePostHogRequests = new Map<string, number>()

const requestKey = (url: string): string => {
    try {
        return convertToURL(url)?.href || url
    } catch {
        return url
    }
}

/**
 * Marks a request while the browser transport is being called. This is shared
 * by all PostHog instances so layered observers can identify SDK traffic even
 * when instances use different hosts.
 */
export const markPostHogRequest = (url: string): void => {
    const key = requestKey(url)
    activePostHogRequests.set(key, (activePostHogRequests.get(key) || 0) + 1)
}

export const unmarkPostHogRequest = (url: string): void => {
    const key = requestKey(url)
    const count = activePostHogRequests.get(key)
    if (count && count > 1) {
        activePostHogRequests.set(key, count - 1)
    } else {
        activePostHogRequests.delete(key)
    }
}

export const isMarkedPostHogRequest = (url: string): boolean => activePostHogRequests.has(requestKey(url))
