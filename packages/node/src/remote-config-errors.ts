/**
 * PostHog answered a `getRemoteConfigPayload` request with a status outside 200 to 299.
 *
 * Emitted on the client's `error` event; the call itself resolves to `undefined`.
 * Branch on `statusCode`, for example `404` when the flag does not exist or is not a remote
 * config flag, versus `429` or `5xx` when the request should be tried again later.
 */
export class RemoteConfigPayloadError extends Error {
  name = 'RemoteConfigPayloadError'

  constructor(
    /** The key of the flag whose payload was requested. */
    readonly flagKey: string,
    /** The HTTP status PostHog answered with. */
    readonly statusCode: number
  ) {
    super(`Failed to fetch remote config payload for flag "${flagKey}": status=${statusCode}`)
  }
}
