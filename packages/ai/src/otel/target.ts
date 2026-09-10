const DEFAULT_OTEL_HOST = 'https://us.i.posthog.com'

export type PostHogOtlpOptions = {
  /**
   * Your PostHog project token (the `phc_...` key). Required; a blank token
   * disables export as a defensive no-op.
   */
  projectToken: string

  /**
   * PostHog host URL. Defaults to `https://us.i.posthog.com`.
   */
  host?: string
}

/**
 * Resolves the PostHog OTLP ingest URL and auth header, or `null` when the
 * project token is missing or blank. A blank token skips host validation too,
 * so a disabled integration never throws on a malformed host.
 */
export function resolveOtlpTarget(
  options: PostHogOtlpOptions
): { url: string; headers: Record<string, string> } | null {
  const token = typeof options.projectToken === 'string' ? options.projectToken.trim() : ''
  if (!token) {
    return null
  }
  const configuredHost = typeof options.host === 'string' ? options.host.trim() : ''
  const host = new URL(configuredHost || DEFAULT_OTEL_HOST).origin
  return {
    url: `${host}/i/v0/ai/otel`,
    headers: { Authorization: `Bearer ${token}` },
  }
}
