/**
 * Official PostHog provider for the OpenFeature **web** SDK
 * (`@openfeature/web-sdk`), backed by `posthog-js`.
 *
 *   import { PostHogWebProvider } from '@posthog/openfeature-web'
 */
export { PostHogWebProvider, type PostHogWebProviderOptions } from './provider'
export { GROUPS_KEY, GROUP_PROPERTIES_KEY, type PostHogFlagResult, type SplitContext } from './mapping'
