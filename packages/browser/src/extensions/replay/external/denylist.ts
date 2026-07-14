import { NetworkRecordOptions } from '../../../types'

function hostnameFromURL(url: string | URL | RequestInfo): string | null {
    try {
        if (typeof url === 'string') {
            return new URL(url).hostname
        }
        if ('url' in url) {
            return new URL(url.url).hostname
        }
        return url.hostname
    } catch {
        return null
    }
}

export function isHostOnDenyList(url: string | URL | Request, options: NetworkRecordOptions) {
    const hostname = hostnameFromURL(url)
    const defaultNotDenied = { hostname, isHostDenied: false }

    if (!options.payloadHostDenyList?.length || !hostname?.trim().length) {
        return defaultNotDenied
    }

    for (const deny of options.payloadHostDenyList) {
        if (hostname.endsWith(deny)) {
            return { hostname, isHostDenied: true }
        }
    }

    return defaultNotDenied
}
