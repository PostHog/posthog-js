import { CapturedNetworkRequest, NetworkRecordOptions, PostHogConfig } from '../../types'
import { _isFunction } from '../../utils/type-utils'
import { convertToURL } from '../../utils/request-utils'

export const defaultNetworkOptions: NetworkRecordOptions = {
    initiatorTypes: [
        'audio',
        'beacon',
        'body',
        'css',
        'early-hint',
        'embed',
        'fetch',
        'frame',
        'iframe',
        'icon',
        'image',
        'img',
        'input',
        'link',
        'navigation',
        'object',
        'ping',
        'script',
        'track',
        'video',
        'xmlhttprequest',
    ],
    maskRequestFn: (data: CapturedNetworkRequest) => data,
    recordHeaders: false,
    recordBody: false,
    recordInitialRequests: false,
    recordPerformance: false,
    performanceEntryTypeToObserve: [
        // 'event', // This is too noisy as it covers all browser events
        'first-input',
        // 'mark', // Mark is used too liberally. We would need to filter for specific marks
        // 'measure', // Measure is used too liberally. We would need to filter for specific measures
        'navigation',
        'paint',
        'resource',
    ],
}

const HEADER_DENYLIST = [
    'authorization',
    'x-forwarded-for',
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-real-ip',
    'remote-addr',
    'forwarded',
    'proxy-authorization',
    'x-csrf-token',
    'x-csrftoken',
    'x-xsrf-token',
]

const removeAuthorizationHeader = (data: CapturedNetworkRequest): CapturedNetworkRequest => {
    Object.keys(data.requestHeaders ?? {}).forEach((header) => {
        if (HEADER_DENYLIST.includes(header.toLowerCase())) delete data.requestHeaders?.[header]
    })
    return data
}

const POSTHOG_PATHS_TO_IGNORE = ['/s/', '/e/', '/i/vo/e/']
// want to ignore posthog paths when capturing requests, or we can get trapped in a loop
const ignorePostHogPaths = (data: CapturedNetworkRequest): CapturedNetworkRequest | undefined => {
    const url = convertToURL(data.name)
    if (url && url.pathname && POSTHOG_PATHS_TO_IGNORE.includes(url.pathname)) {
        return undefined
    }
    return data
}

/**
 *  whether a maskRequestFn is provided or not,
 *  we ensure that we remove the denied header from requests
 *  we _never_ want to record that header by accident
 *  if someone complains then we'll add an opt-in to let them override it
 */
export const buildNetworkRequestOptions = (
    instanceConfig: PostHogConfig,
    remoteNetworkOptions: Pick<NetworkRecordOptions, 'recordHeaders' | 'recordBody' | 'recordPerformance'>
): NetworkRecordOptions => {
    const config = instanceConfig.session_recording as NetworkRecordOptions
    // client can always disable despite remote options
    const canRecordHeaders = config.recordHeaders === false ? false : remoteNetworkOptions.recordHeaders
    const canRecordBody = config.recordBody === false ? false : remoteNetworkOptions.recordBody
    const canRecordPerformance = config.recordPerformance === false ? false : remoteNetworkOptions.recordPerformance

    config.maskRequestFn = _isFunction(instanceConfig.session_recording.maskCapturedNetworkRequestFn)
        ? (data) => {
              const cleanedRequest = ignorePostHogPaths(removeAuthorizationHeader(data))
              return cleanedRequest
                  ? instanceConfig.session_recording.maskCapturedNetworkRequestFn?.(cleanedRequest) ?? undefined
                  : undefined
          }
        : undefined

    if (!config.maskRequestFn) {
        config.maskRequestFn = (data) => ignorePostHogPaths(removeAuthorizationHeader(data))
    }

    return {
        ...defaultNetworkOptions,
        ...config,
        recordHeaders: canRecordHeaders,
        recordBody: canRecordBody,
        recordPerformance: canRecordPerformance,
        recordInitialRequests: canRecordPerformance,
    }
}
