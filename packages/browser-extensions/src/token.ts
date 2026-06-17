/**
 * A typed, implementation-free key for resolving an extension that provides a
 * capability. Declared as a shared `const` next to the providing extension's
 * interface:
 *
 * ```ts
 * export interface FeatureFlagsExtension extends Extension { … }
 * export const FeatureFlags: ExtensionToken<FeatureFlagsExtension> = { name: 'featureFlags' }
 * ```
 *
 * A token holds no implementation, so importing one never pulls the provider's
 * code into the consumer's bundle. The registry is keyed by token identity
 * (the shared object reference), so provider and consumer must import the same
 * exported token; `name` is for diagnostics only.
 */
export interface ExtensionToken<T> {
    /** Human-readable capability name used only for diagnostics. */
    readonly name: string
    /** Phantom: carries the provided type for inference; never present at runtime. */
    readonly __provides?: T
}
