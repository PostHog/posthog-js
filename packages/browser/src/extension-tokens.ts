import type { ExtensionToken } from '@posthog/browser-common'

import type { PostHogFeatureFlags } from './posthog-featureflags'
import type { PostHogLogs } from './posthog-logs'
import type { BrowserSurveys } from './browser-surveys'

export { AutocaptureExtension } from '@posthog/browser-common/autocapture'
export const FeatureFlagsExtension = 'featureFlags' as ExtensionToken<PostHogFeatureFlags>
export const LogsExtension = 'logs' as ExtensionToken<PostHogLogs>
export const SurveysExtension = 'surveys' as ExtensionToken<BrowserSurveys>
