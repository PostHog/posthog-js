export * from '../exports'

import { createModulerModifier } from '../extensions/error-tracking/modifiers/module.node'
import { addSourceContext } from '../extensions/error-tracking/modifiers/context-lines.node'
import ErrorTracking from '../extensions/error-tracking'

import { PostHogBackendClient } from '../client'
import { ErrorTracking as CoreErrorTracking } from '@posthog/core'
import { PostHogContext } from '../extensions/context/context'

ErrorTracking.errorPropertiesBuilder = new CoreErrorTracking.ErrorPropertiesBuilder(
  [
    new CoreErrorTracking.EventCoercer(),
    new CoreErrorTracking.ErrorCoercer(),
    new CoreErrorTracking.ObjectCoercer(),
    new CoreErrorTracking.StringCoercer(),
    new CoreErrorTracking.PrimitiveCoercer(),
  ],
  CoreErrorTracking.createStackParser('node:javascript', CoreErrorTracking.nodeStackLineParser),
  [createModulerModifier(), addSourceContext]
)

export class PostHog extends PostHogBackendClient {
  getLibraryId(): string {
    return 'posthog-node'
  }

  protected initializeContext(): PostHogContext {
    return new PostHogContext()
  }
}
