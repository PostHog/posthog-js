/**
 * Official PostHog provider for the OpenFeature **server** SDK
 * (`@openfeature/server-sdk`), backed by `posthog-node`.
 *
 *   import { PostHogServerProvider } from '@posthog/openfeature-node-provider'
 */
export { PostHogServerProvider, type PostHogServerProviderOptions } from './provider'
export { GROUPS_KEY, GROUP_PROPERTIES_KEY, type PostHogFlagResult, type SplitContext } from './mapping'
