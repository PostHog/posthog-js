import { PostHog } from '../posthog-core'
import { AllExtensions } from '../extensions/extension-bundles'

PostHog.__defaultExtensionClasses = {
    ...AllExtensions,
}
