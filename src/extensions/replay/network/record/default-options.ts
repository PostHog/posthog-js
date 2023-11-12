import { NetworkRequest, PostHogConfig } from '../../../../types'
import { defaultNetworkOptions, NetworkRecordOptions } from './index'
import { _isFunction } from '../../../../utils/type-utils'

const removeAuthorizationHeader = (data: NetworkRequest): NetworkRequest => {
    delete data.requestHeaders?.['Authorization']
    return data
}

/**
 *  whether a maskRequestFn is provided or not,
 *  we ensure that we remove the Authorization header from requests
 *  we _never_ want to record that header by accident
 *  if someone complains then we'll add an opt-in to let them override it
 */
export const buildNetworkRequestOptions = (instanceConfig: PostHogConfig): NetworkRecordOptions => {
    const config = instanceConfig.session_recording as NetworkRecordOptions
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
    }
}
