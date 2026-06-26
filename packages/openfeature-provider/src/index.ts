/**
 * Paradigm-agnostic entry point. The providers themselves are shipped under
 * dedicated subpaths so a node-only or browser-only consumer never has to
 * install the other paradigm's SDK:
 *
 *   - `@posthog/openfeature-provider/server` -> PostHogServerProvider (posthog-node)
 *   - `@posthog/openfeature-provider/web`    -> PostHogWebProvider    (posthog-js)
 *
 * Only the shared, dependency-free pieces are re-exported here.
 */
export { GROUPS_KEY, GROUP_PROPERTIES_KEY, type PostHogFlagResult, type SplitContext } from './mapping'
