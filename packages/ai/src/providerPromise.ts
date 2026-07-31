interface ProviderPromise<T> extends Promise<T> {
  asResponse?: () => Promise<Response>
  withResponse?: () => Promise<{
    data: unknown
    response: Response
    request_id?: string | null
  }>
  _thenUnwrap?: <Result>(transform: (data: T) => Result) => ProviderPromise<Result>
}

/**
 * Keep the provider SDK helpers on a promise whose resolved value is instrumented.
 * OpenAI's parse helpers compose create calls through `_thenUnwrap`, while both
 * OpenAI and Anthropic expose the raw response through `asResponse` and
 * `withResponse`.
 */
export function preserveProviderPromise<Input, Output>(
  parentPromise: ProviderPromise<Input>,
  wrappedPromise: Promise<Output>
): ProviderPromise<Output> {
  const providerPromise = wrappedPromise as ProviderPromise<Output>

  const asResponse = parentPromise.asResponse?.bind(parentPromise)
  if (asResponse) {
    providerPromise.asResponse = asResponse
  }

  const withResponse = parentPromise.withResponse?.bind(parentPromise)
  if (withResponse) {
    providerPromise.withResponse = async () => {
      const [response, data] = await Promise.all([withResponse(), wrappedPromise])
      return { ...response, data }
    }
  }

  if (typeof parentPromise._thenUnwrap === 'function') {
    providerPromise._thenUnwrap = <Unwrapped>(transform: (data: Output) => Unwrapped) =>
      preserveProviderPromise<Output, Unwrapped>(providerPromise, wrappedPromise.then(transform))
  }

  return providerPromise
}
