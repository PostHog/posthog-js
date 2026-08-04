import type { APIPromise as AnthropicAPIPromise } from '@anthropic-ai/sdk'
import type { APIPromise as OpenAIAPIPromise } from 'openai'

interface ProviderPromise<T> extends Promise<T> {
  asResponse?: () => Promise<Response>
  withResponse?: () => Promise<{
    data: unknown
    response: Response
    request_id?: string | null
  }>
}

interface ProviderResponseProps {
  response: Response
  options: unknown
  controller: AbortController
  requestLogID: string
  retryOfRequestLogID: string | undefined
  startTime: number
}

interface ProviderPromiseFacade<T> extends ProviderPromise<T> {
  _thenUnwrap?: <Result>(transform: (data: T, props: ProviderResponseProps) => Result) => ProviderPromiseFacade<Result>
}

interface PreserveProviderPromiseOptions {
  requestIdHeader?: string
}

function addRequestId<Result>(result: Result, response: Response, requestIdHeader: string): Result {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result
  }

  return Object.defineProperty(result, '_request_id', {
    value: response.headers.get(requestIdHeader),
    enumerable: false,
  })
}

function getResponsePropsPromise(parentPromise: object): Promise<ProviderResponseProps> | undefined {
  const responsePromise = (parentPromise as { responsePromise?: unknown }).responsePromise
  if (!responsePromise || typeof (responsePromise as { then?: unknown }).then !== 'function') {
    return undefined
  }
  return responsePromise as Promise<ProviderResponseProps>
}

function decorateProviderPromise<Output>(
  wrappedPromise: Promise<Output>,
  responsePropsPromise: Promise<ProviderResponseProps> | undefined,
  requestIdHeader: string,
  preserveThenUnwrap: boolean
): ProviderPromiseFacade<Output> {
  const providerPromise = wrappedPromise as ProviderPromiseFacade<Output>

  if (responsePropsPromise) {
    providerPromise.asResponse = async () => (await responsePropsPromise).response
    providerPromise.withResponse = async () => {
      const [props, data] = await Promise.all([responsePropsPromise, wrappedPromise])
      return { response: props.response, data, request_id: props.response.headers.get(requestIdHeader) }
    }
  }

  if (preserveThenUnwrap) {
    providerPromise._thenUnwrap = (transform) => {
      if (!responsePropsPromise) {
        throw new Error('The provider promise response metadata is unavailable')
      }

      const transformedPromise = Promise.all([wrappedPromise, responsePropsPromise]).then(([data, props]) =>
        addRequestId(transform(data, props), props.response, requestIdHeader)
      )
      return decorateProviderPromise(transformedPromise, responsePropsPromise, requestIdHeader, true)
    }
  }

  return providerPromise
}

/**
 * Keep the provider SDK helpers on a promise whose resolved value is instrumented.
 * OpenAI's parse helpers compose create calls through `_thenUnwrap`, while both
 * OpenAI and Anthropic expose the raw response through `asResponse` and
 * `withResponse`.
 */
export function preserveProviderPromise<Input, Output>(
  parentPromise: OpenAIAPIPromise<Input>,
  wrappedPromise: Promise<Output>,
  options?: PreserveProviderPromiseOptions
): OpenAIAPIPromise<Output>
export function preserveProviderPromise<Input, Output>(
  parentPromise: AnthropicAPIPromise<Input>,
  wrappedPromise: Promise<Output>,
  options?: PreserveProviderPromiseOptions
): AnthropicAPIPromise<Output>
export function preserveProviderPromise<Input, Output>(
  parentPromise: ProviderPromise<Input>,
  wrappedPromise: Promise<Output>,
  options: PreserveProviderPromiseOptions = {}
): ProviderPromiseFacade<Output> {
  const responsePropsPromise = getResponsePropsPromise(parentPromise)
  const preserveThenUnwrap = typeof (parentPromise as { _thenUnwrap?: unknown })._thenUnwrap === 'function'
  const providerPromise = decorateProviderPromise(
    wrappedPromise,
    responsePropsPromise,
    options.requestIdHeader ?? 'x-request-id',
    preserveThenUnwrap
  )

  if (!responsePropsPromise) {
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
  }

  return providerPromise
}

/**
 * OpenAI's `Responses.parse` dispatches through `this._client.responses.create`.
 * Temporarily use the provider's original `create` implementation so parsing a
 * wrapped response does not capture the same request twice.
 */
export function callWithOriginalCreate<Result>(
  resource: object,
  originalCreate: unknown,
  callback: () => Result
): Result {
  const resourceRecord = resource as Record<string, unknown>
  const hadOwnCreate = Object.prototype.hasOwnProperty.call(resource, 'create')
  const wrappedCreate = resourceRecord['create']
  resourceRecord['create'] = originalCreate

  try {
    return callback()
  } finally {
    if (hadOwnCreate) {
      resourceRecord['create'] = wrappedCreate
    } else {
      delete resourceRecord['create']
    }
  }
}
