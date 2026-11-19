/** A non-blank string, as event names and group types require. */
export const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0
/** A distinct ID the SDK accepts: non-blank and not a placeholder such as `undefined` or `null`. */
export const isValidDistinctId = (value: unknown): value is string =>
    isNonEmptyString(value) &&
    !['$posthog_cookieless', 'distinct_id', 'distinctid', 'undefined', 'null'].includes(value.toLowerCase())
