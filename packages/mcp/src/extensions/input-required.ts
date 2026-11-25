/** `$mcp_input_request_methods` holds at most this many entries. */
const MAX_INPUT_REQUEST_METHODS = 100

/**
 * The method of each request an `input_required` round asks the client to
 * answer, ordered by request key, or `undefined` when `result` is not a round.
 * A round that carries only `requestState` has none.
 */
export function readInputRequestMethods(result: unknown): string[] | undefined {
  if (!result || typeof result !== 'object' || (result as { resultType?: unknown }).resultType !== 'input_required') {
    return undefined
  }
  const requests = (result as { inputRequests?: unknown }).inputRequests
  if (!requests || typeof requests !== 'object' || Array.isArray(requests)) {
    return []
  }
  const byKey = requests as Record<string, { method?: unknown } | undefined>
  return boundInputRequestMethods(
    Object.keys(byKey)
      .sort()
      .map((key) => byKey[key]?.method)
  )
}

/** Keeps the string methods, up to the property's entry limit. */
export function boundInputRequestMethods(methods: readonly unknown[]): string[] {
  return methods.filter((method): method is string => typeof method === 'string').slice(0, MAX_INPUT_REQUEST_METHODS)
}
