import { isPlainObject, type JsonType, type PostHogEventProperties } from '@posthog/core'

/** Properties that a default fills one level deep when the event's value and the default are both objects. */
const NESTED_FILL_PROPERTIES: ReadonlySet<string> = new Set(['$set', '$set_once', '$groups', '$group_set'])

/** Properties that are set only when they hold a non-empty string. */
const LIBRARY_PROPERTIES: ReadonlySet<string> = new Set(['$lib', '$lib_version'])

/** One layer of default values, or nothing. */
export type DefaultsLayer = Readonly<Record<string, unknown>> | undefined

function isPresentString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isUnsetValue(key: string, value: unknown): boolean {
  return LIBRARY_PROPERTIES.has(key) ? !isPresentString(value) : value === undefined
}

/**
 * A property is unset when its key is missing or its value is `undefined`; `null` is a value.
 * `$lib` and `$lib_version` are unset unless they hold a non-empty string.
 */
export function isUnsetProperty(properties: PostHogEventProperties, key: string): boolean {
  return isUnsetValue(key, properties[key])
}

/**
 * Fill the SDK's own `$lib` and `$lib_version`, after every other layer. When no layer set
 * `$lib`, both get the SDK's values, replacing a lone `$lib_version`. When `$lib` is the SDK's
 * own name, only a missing `$lib_version` is filled. Any other `$lib` keeps the pair as set.
 */
export function fillLibraryProperties(
  properties: PostHogEventProperties,
  libraryId: string,
  libraryVersion: string
): void {
  if (isUnsetProperty(properties, '$lib')) {
    properties.$lib = libraryId
    properties.$lib_version = libraryVersion
  } else if (properties.$lib === libraryId && isUnsetProperty(properties, '$lib_version')) {
    properties.$lib_version = libraryVersion
  }
}

/** An option is unset when its key is missing or its value is `undefined` or `null`. */
export function isUnsetOption(options: Record<string, unknown>, key: string): boolean {
  return options[key] === undefined || options[key] === null
}

/**
 * Fill the properties the event left unset from each layer in turn, highest layer first, so a
 * value from an earlier layer is never replaced. A layer's `$lib` or `$lib_version` counts only
 * when it is a non-empty string. `$set`, `$set_once`, `$groups` and `$group_set`
 * fill one level deep when both values are objects. Keys in `skipKeys` are never filled.
 */
export function fillProperties(
  properties: PostHogEventProperties,
  layers: readonly DefaultsLayer[],
  skipKeys: readonly string[] = []
): void {
  for (const layer of layers) {
    if (!layer) {
      continue
    }
    for (const [key, value] of Object.entries(layer)) {
      if (isUnsetValue(key, value) || skipKeys.includes(key)) {
        continue
      }
      const existing = properties[key]
      if (isUnsetValue(key, existing)) {
        properties[key] = value as JsonType
      } else if (NESTED_FILL_PROPERTIES.has(key) && isPlainObject(existing) && isPlainObject(value)) {
        properties[key] = fillNested(existing, value)
      }
    }
  }
}

/** Fill the options the event left unset from each layer in turn, highest layer first. */
export function fillOptions(options: Record<string, JsonType>, layers: readonly DefaultsLayer[]): void {
  for (const layer of layers) {
    if (!layer) {
      continue
    }
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined && isUnsetOption(options, key)) {
        options[key] = value as JsonType
      }
    }
  }
}

/** A new object: the event's inner values, plus the default's inner keys the event left unset. */
function fillNested(existing: Record<string, unknown>, defaults: Record<string, unknown>): PostHogEventProperties {
  const filled: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(defaults)) {
    if (filled[key] === undefined && value !== undefined) {
      filled[key] = value
    }
  }
  return filled as PostHogEventProperties
}

/** A shallow copy of a layer read at capture time, or undefined when it is not an object. */
export function snapshotLayer(layer: unknown): Record<string, unknown> | undefined {
  return isPlainObject(layer) ? { ...layer } : undefined
}
