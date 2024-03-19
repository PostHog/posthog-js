import { CapturedNetworkRequest, NetworkRecordOptions, PostHogConfig } from '../../types'
import { _isFunction, _isNullish, _isString, _isUndefined } from '../../utils/type-utils'
import { convertToURL } from '../../utils/request-utils'
import { logger } from '../../utils/logger'
import { shouldCaptureValue } from '../../autocapture-utils'
import { _each } from '../../utils'

const LOGGER_PREFIX = '[SessionRecording]'

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

const HEADER_DENY_LIST = [
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

const PAYLOAD_CONTENT_DENY_LIST = [
    'password',
    'secret',
    'passwd',
    'api_key',
    'apikey',
    'auth',
    'credentials',
    'mysql_pwd',
    'privatekey',
    'private_key',
    'token',
]

// we always remove headers on the deny list because we never want to capture this sensitive data
const removeAuthorizationHeader = (data: CapturedNetworkRequest): CapturedNetworkRequest => {
    _each(Object.keys(data.requestHeaders ?? {}), (header) => {
        if (HEADER_DENY_LIST.includes(header.toLowerCase())) delete data.requestHeaders?.[header]
    })
    return data
}

const POSTHOG_PATHS_TO_IGNORE = ['/s/', '/e/', '/i/']
// want to ignore posthog paths when capturing requests, or we can get trapped in a loop
// because calls to PostHog would be reported using a call to PostHog which would be reported....
const ignorePostHogPaths = (data: CapturedNetworkRequest): CapturedNetworkRequest | undefined => {
    const url = convertToURL(data.name)
    if (url && url.pathname && POSTHOG_PATHS_TO_IGNORE.some((path) => url.pathname.indexOf(path) === 0)) {
        return undefined
    }
    return data
}

function estimateBytes(payload: string): number {
    return new Blob([payload]).size
}

function enforcePayloadSizeLimit(
    payload: string | null | undefined,
    headers: Record<string, any> | undefined,
    limit: number,
    description: string
): string | null | undefined {
    if (_isNullish(payload)) {
        return payload
    }

    let requestContentLength: string | number = headers?.['content-length'] || estimateBytes(payload)
    if (_isString(requestContentLength)) {
        requestContentLength = parseInt(requestContentLength)
    }

    if (requestContentLength > limit) {
        return LOGGER_PREFIX + ` ${description} body too large to record (${requestContentLength} bytes)`
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
            data.requestBody = enforcePayloadSizeLimit(data.requestBody, data.requestHeaders, limit, 'Request')
        }

        if (data?.responseBody) {
            data.responseBody = enforcePayloadSizeLimit(data.responseBody, data.responseHeaders, limit, 'Response')
        }

        return data
    }
}

function scrubPayload(payload: string | null | undefined, label: 'Request' | 'Response'): string | null | undefined {
    if (_isNullish(payload)) {
        return payload
    }
    let scrubbed = payload

    if (!shouldCaptureValue(scrubbed, false)) {
        scrubbed = LOGGER_PREFIX + ' ' + label + ' body redacted'
    }
    _each(PAYLOAD_CONTENT_DENY_LIST, (text) => {
        if (scrubbed?.length && scrubbed?.indexOf(text) !== -1) {
            scrubbed = LOGGER_PREFIX + ' ' + label + ' body redacted as might contain: ' + text
        }
    })

    return scrubbed
}

function scrubPayloads(capturedRequest: CapturedNetworkRequest | undefined): CapturedNetworkRequest | undefined {
    if (_isUndefined(capturedRequest)) {
        return undefined
    }

    capturedRequest.requestBody = scrubPayload(capturedRequest.requestBody, 'Request')
    capturedRequest.responseBody = scrubPayload(capturedRequest.responseBody, 'Response')

    return capturedRequest
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
    const config: NetworkRecordOptions = {
        payloadSizeLimitBytes: defaultNetworkOptions.payloadSizeLimitBytes,
        performanceEntryTypeToObserve: [...defaultNetworkOptions.performanceEntryTypeToObserve],
    }
    // client can always disable despite remote options
    const canRecordHeaders =
        instanceConfig.session_recording.recordHeaders === false ? false : remoteNetworkOptions.recordHeaders
    const canRecordBody =
        instanceConfig.session_recording.recordBody === false ? false : remoteNetworkOptions.recordBody
    const canRecordPerformance =
        instanceConfig.capture_performance === false ? false : remoteNetworkOptions.recordPerformance

    const payloadLimiter = limitPayloadSize(config)

    const enforcedCleaningFn: NetworkRecordOptions['maskRequestFn'] = (d: CapturedNetworkRequest) =>
        scrubPayloads(payloadLimiter(ignorePostHogPaths(removeAuthorizationHeader(d))))

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
        recordInitialRequests: canRecordPerformance
    }
}
