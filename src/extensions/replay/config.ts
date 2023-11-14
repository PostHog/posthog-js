import { NetworkRecordOptions, NetworkRequest, PostHogConfig } from '../../types'
import { _isFunction } from '../../utils/type-utils'

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
    maskRequestFn: (data: NetworkRequest) => data,
    recordHeaders: false,
    recordBody: false,
    recordInitialRequests: false,
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

const removeAuthorizationHeader = (data: NetworkRequest): NetworkRequest => {
    Object.keys(data.requestHeaders ?? {}).forEach((header) => {
        if (HEADER_DENYLIST.includes(header.toLowerCase())) delete data.requestHeaders?.[header]
    })
    return data
}

/**
 *  whether a maskRequestFn is provided or not,
 *  we ensure that we remove the Authorization header from requests
 *  we _never_ want to record that header by accident
 *  if someone complains then we'll add an opt-in to let them override it
 */
export const buildNetworkRequestOptions = (
    instanceConfig: PostHogConfig,
    remoteNetworkOptions: Pick<NetworkRecordOptions, 'recordHeaders' | 'recordBody'>
): NetworkRecordOptions => {
    const config = instanceConfig.session_recording as NetworkRecordOptions
    // client can always disable despite remote options
    const canRecordHeaders = config.recordHeaders === false ? false : remoteNetworkOptions.recordHeaders
    const canRecordBody = config.recordBody === false ? false : remoteNetworkOptions.recordBody

    config.maskRequestFn = _isFunction(instanceConfig.session_recording.maskNetworkRequestFn)
        ? (data) => {
              const cleanedRequest = removeAuthorizationHeader(data)
              return instanceConfig.session_recording.maskNetworkRequestFn?.(cleanedRequest) ?? undefined
          }
        : undefined

    if (!config.maskRequestFn) {
        config.maskRequestFn = removeAuthorizationHeader
    }

    return {
        ...defaultNetworkOptions,
        ...config,
        recordHeaders: canRecordHeaders,
        recordBody: canRecordBody,
    }
}
