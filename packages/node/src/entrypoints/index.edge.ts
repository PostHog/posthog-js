export * from '../exports'

import ErrorTracking from '../extensions/error-tracking'

import { PostHogBackendClient } from '../client'
import { createStackParser } from '../extensions/error-tracking/stack-parser'

ErrorTracking.stackParser = createStackParser()
ErrorTracking.frameModifiers = []

export class PostHog extends PostHogBackendClient {
  getLibraryId(): string {
    return 'posthog-edge'
  }
}
