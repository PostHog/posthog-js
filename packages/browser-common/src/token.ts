/** Phantom brand carrying an extension type without emitting runtime code. */
declare const extensionTokenType: unique symbol

/**
 * A typed stable name for resolving an installed extension.
 *
 * Tokens are plain strings at runtime, so independently compiled scripts can
 * share them without a registry or object-identity contract. The generic brand
 * lets `Client.getExtension` infer the extension type. A token's string
 * value must match an installed extension's stable `name` or one of its `bindings` keys.
 */
export type ExtensionToken<T> = string & {
    readonly [extensionTokenType]: T
}
