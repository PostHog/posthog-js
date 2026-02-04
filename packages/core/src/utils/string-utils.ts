export function includes(str: string, needle: string): boolean
export function includes<T>(arr: T[], needle: T): boolean
export function includes(str: unknown[] | string, needle: unknown): boolean {
  return (str as any).indexOf(needle) !== -1
}

export const trim = function (str: string): string {
  // Previous implementation was using underscore's trim function.
  // When switching to just using the native trim() function, we ran some tests to make sure that it was able to trim both the BOM character \uFEFF and the NBSP character \u00A0.
  // We tested modern Chrome (134.0.6998.118) and Firefox (136.0.2), and IE11 running on Windows 10, and all of them were able to trim both characters.
  // See https://posthog.slack.com/archives/C0113360FFV/p1742811455647359
  return str.trim()
}

// UNDERSCORE
// Embed part of the Underscore Library
export const stripLeadingDollar = function (s: string): string {
  return s.replace(/^\$/, '')
}

export function isDistinctIdStringLike(value: string): boolean {
  return ['distinct_id', 'distinctid'].includes(value.toLowerCase())
}

/**
 * Creates a hash string from distinct_id and person properties.
 * Used to detect if person properties have changed to avoid duplicate $set events.
 */
export function getPersonPropertiesHash(
  distinct_id: string,
  userPropertiesToSet?: Record<string, any>,
  userPropertiesToSetOnce?: Record<string, any>
): string {
  return JSON.stringify({ distinct_id, userPropertiesToSet, userPropertiesToSetOnce })
}
