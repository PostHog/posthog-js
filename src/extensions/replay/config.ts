import { CapturedNetworkRequest, NetworkRecordOptions, PostHogConfig, Body } from '../../types'
import { _isFunction, _isUndefined } from '../../utils/type-utils'
import { convertToURL } from '../../utils/request-utils'
import { logger } from '../../utils/logger'

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
    payloadSizeLimitBytes: 1000000,
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

// we always remove headers on the deny list because we never want to capture this sensitive data
const removeAuthorizationHeader = (data: CapturedNetworkRequest): CapturedNetworkRequest => {
    Object.keys(data.requestHeaders ?? {}).forEach((header) => {
        if (HEADER_DENYLIST.includes(header.toLowerCase())) delete data.requestHeaders?.[header]
    })
    return data
}

const POSTHOG_PATHS_TO_IGNORE = ['/s/', '/e/', '/i/vo/e/']
// want to ignore posthog paths when capturing requests, or we can get trapped in a loop
// because calls to PostHog would be reported using a call to PostHog which would be reported....
const ignorePostHogPaths = (data: CapturedNetworkRequest): CapturedNetworkRequest | undefined => {
    const url = convertToURL(data.name)
    if (url && url.pathname && POSTHOG_PATHS_TO_IGNORE.includes(url.pathname)) {
        return undefined
    }
    return data
}

function redactPayload(
    payload: Body,
    headers: Record<string, any> | undefined,
    limit: number,
    description: string
): Body {
    const requestContentLength = headers?.['content-length']
    if (_isUndefined(requestContentLength)) {
        return `[SessionReplay] no content-length header for ${description}, cannot determine payload size`
    }
    if (requestContentLength && parseInt(requestContentLength) > limit) {
        return `[SessionReplay] ${description} body too large to record`
    }
    return payload
}

// people can have arbitrarily large payloads on their site, but we don't want to ingest them
const limitPayloadSize = (
    options: NetworkRecordOptions
): ((data: CapturedNetworkRequest | undefined) => CapturedNetworkRequest | undefined) => {
    // the smallest of 1MB or the specified limit if there is one
    const limit = Math.min(1000000, options.payloadSizeLimitBytes ?? 1000000)

    return (data) => {
        if (data?.requestBody) {
            data.requestBody = redactPayload(data.requestBody, data.requestHeaders, limit, 'Request')
        }

        if (data?.responseBody) {
            data.responseBody = redactPayload(data.responseBody, data.responseHeaders, limit, 'Response')
        }

        return data
    }
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

    const payloadLimiter = limitPayloadSize(config)

    const enforcedCleaningFn: NetworkRecordOptions['maskRequestFn'] = (d: CapturedNetworkRequest) =>
        payloadLimiter(ignorePostHogPaths(removeAuthorizationHeader(d)))

    const hasDeprecatedMaskFunction = _isFunction(instanceConfig.session_recording.maskNetworkRequestFn)

    if (hasDeprecatedMaskFunction && _isFunction(instanceConfig.session_recording.maskCapturedNetworkRequestFn)) {
        logger.warn(
            'Both `maskNetworkRequestFn` and `maskCapturedNetworkRequestFn` are defined. `maskNetworkRequestFn` will be ignored.'
        )
    }

    if (hasDeprecatedMaskFunction) {
        instanceConfig.session_recording.maskCapturedNetworkRequestFn = (data: CapturedNetworkRequest) => {
            const cleanedURL = instanceConfig.session_recording.maskNetworkRequestFn!({ url: data.name })
            return {
                ...data,
                name: cleanedURL?.url,
            } as CapturedNetworkRequest
        }
    }

    config.maskRequestFn = _isFunction(instanceConfig.session_recording.maskCapturedNetworkRequestFn)
        ? (data) => {
              const cleanedRequest = enforcedCleaningFn(data)
              return cleanedRequest
                  ? instanceConfig.session_recording.maskCapturedNetworkRequestFn?.(cleanedRequest) ?? undefined
                  : undefined
          }
        : undefined

    if (!config.maskRequestFn) {
        config.maskRequestFn = enforcedCleaningFn
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
