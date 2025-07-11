export * from '../exports'

import { createGetModuleFromFilename } from '../extensions/error-tracking/get-module.node'
import { addSourceContext } from '../extensions/error-tracking/context-lines.node'
import ErrorTracking from '../extensions/error-tracking'

import { PostHogBackendClient } from '../client'
import { createStackParser } from '../extensions/error-tracking/stack-parser'

ErrorTracking.stackParser = createStackParser(createGetModuleFromFilename())
ErrorTracking.frameModifiers = [addSourceContext]

export class PostHog extends PostHogBackendClient {
  getLibraryId(): string {
    return 'posthog-node'
  }
}
