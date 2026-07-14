import { NetworkRecordOptions } from '../../../types'
import { hostnameFromURL } from './sessionrecording-utils'

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
