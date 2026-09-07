export * from '../exports'

import { createModulerModifier } from '../extensions/error-tracking/modifiers/module.node'
import { addSourceContext } from '../extensions/error-tracking/modifiers/context-lines.node'
import { createRelativePathModifier } from '../extensions/error-tracking/modifiers/relative-path.node'

import type { PostHogFetchBodyBytes, PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { PostHogContext } from '../extensions/context/context'
import { gzipCompress } from '../gzip.node'
import { fetchWithConnectTimeout } from '../dispatcher.node'

export class PostHog extends PostHogBackendClient {
  getLibraryId(): string {
    return 'posthog-node'
  }

  protected override defaultFetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
    return fetchWithConnectTimeout(url, options, this.options.connectTimeout)
  }

  protected override compressPayload(payload: string): Promise<PostHogFetchBodyBytes | null> {
    return gzipCompress(payload, this.isDebug)
  }

  protected initializeContext(): PostHogContext {
    return new PostHogContext()
  }

  protected override createErrorPropertiesBuilder(): CoreErrorTracking.ErrorPropertiesBuilder {
    return new CoreErrorTracking.ErrorPropertiesBuilder(
      [
        new CoreErrorTracking.EventCoercer(),
        new CoreErrorTracking.ErrorCoercer(),
        new CoreErrorTracking.ObjectCoercer(),
        new CoreErrorTracking.StringCoercer(),
        new CoreErrorTracking.PrimitiveCoercer(),
      ],
      CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser),
      [
        createModulerModifier(),
        (frames) => addSourceContext(frames, undefined, this._logger),
        createRelativePathModifier(),
      ]
    )
  }
}
