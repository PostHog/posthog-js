export * from '../exports'

import { createModulerModifier } from '../extensions/error-tracking/modifiers/module.node'
import { addSourceContext } from '../extensions/error-tracking/modifiers/context-lines.node'
import { createRelativePathModifier } from '../extensions/error-tracking/modifiers/relative-path.node'

import type { PostHogFetchBodyBytes } from '@posthog/core'
import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import type { SpanContextManager } from '@posthog/core'
import { PostHogContext } from '../extensions/context/context'
import { AsyncLocalStorageSpanContextManager } from '../extensions/context/span-context.node'
import { gzipCompress } from '../gzip.node'

export class PostHog extends PostHogBackendClient {
  getLibraryId(): string {
    return 'posthog-node'
  }

  protected override compressPayload(payload: string): Promise<PostHogFetchBodyBytes | null> {
    return gzipCompress(payload, this.isDebug)
  }

  protected initializeContext(): PostHogContext {
    return new PostHogContext()
  }

  protected override initializeSpanContextManager(): SpanContextManager {
    return new AsyncLocalStorageSpanContextManager()
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
