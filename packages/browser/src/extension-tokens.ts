import type { ExtensionToken } from '@posthog/browser-common'

import type { Autocapture } from './autocapture'
import type { PostHogFeatureFlags } from './posthog-featureflags'
import type { PostHogLogs } from './posthog-logs'
import type { PostHogSurveys } from './posthog-surveys'

export const AutocaptureExtension = 'autocapture' as ExtensionToken<Autocapture>
export const FeatureFlagsExtension = 'featureFlags' as ExtensionToken<PostHogFeatureFlags>
export const LogsExtension = 'logs' as ExtensionToken<PostHogLogs>
export const SurveysExtension = 'surveys' as ExtensionToken<PostHogSurveys>
