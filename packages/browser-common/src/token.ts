/** Phantom brand carrying the capability type without emitting runtime code. */
declare const extensionTokenType: unique symbol

/**
 * A typed, implementation-free string for resolving an extension that provides
 * a capability. Declared as a shared `const` next to the providing extension's
 * interface:
 *
 * ```ts
 * export interface FeatureFlagsExtension extends Extension { … }
 * export const FeatureFlags = 'posthog.featureFlags' as ExtensionToken<FeatureFlagsExtension>
 * ```
 *
 * A token holds no implementation, so importing one never pulls the provider's
 * code into the consumer's bundle. Its generic brand lets `getExtension` infer
 * the provided type, while its runtime string value remains stable across
 * independently compiled scripts. Token strings must be globally unique and
 * stable for the lifetime of the capability contract.
 */
export type ExtensionToken<T> = string & {
    readonly [extensionTokenType]: T
}
