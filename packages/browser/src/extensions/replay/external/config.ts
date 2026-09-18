import { buildNetworkRequestOptions as buildSharedNetworkRequestOptions } from '@posthog/browser-common/replay/external/config'
import type { NetworkRecordOptions, PostHogConfig } from '../../../types'
import { replayOptionsFromConfig } from '../replay-options'
export * from '@posthog/browser-common/replay/external/config'
export function buildNetworkRequestOptions(
    config: PostHogConfig,
    remote: Parameters<typeof buildSharedNetworkRequestOptions>[1],
    isIngestionEndpoint?: (url: string) => boolean
): NetworkRecordOptions {
    return buildSharedNetworkRequestOptions(() => replayOptionsFromConfig(config), remote, isIngestionEndpoint)
}
