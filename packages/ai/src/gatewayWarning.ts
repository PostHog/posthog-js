/**
 * Detects when an `@posthog/ai` wrapper is pointed at the PostHog AI Gateway and
 * warns once, because that configuration double-captures every generation.
 *
 * The PostHog AI Gateway emits its own `$ai_generation` for every call it routes.
 * If a developer points a wrapper's `base_url` at the gateway, each call is
 * captured twice — once by the wrapper, once by the gateway — and, for billable
 * products, billed twice. We only warn: the wrapper's event carries data the
 * gateway never sees (groups, custom properties, trace hierarchy), so dropping it
 * would lose information. The fix is to pick one or the other.
 */

/**
 * Hosts served by the PostHog AI Gateway. Detection keys on the URL host so it is
 * robust to the path, scheme, and per-product route prefix (e.g.
 * `gateway.us.posthog.com/v1`, `gateway.us.posthog.com/signals/v1`).
 *
 * Maintained by hand — keep in sync with the gateway's deployed hosts (see
 * `services/llm-gateway` and `posthog/llm/gateway_client.py` in the main PostHog
 * repo). `gateway.us.posthog.com` is the live production host today; the regional
 * and `ai-gateway.*` variants are listed defensively so the warning keeps firing
 * if/when traffic moves to them.
 */
export const POSTHOG_AI_GATEWAY_HOSTS: readonly string[] = [
  'gateway.posthog.com',
  'gateway.us.posthog.com',
  'gateway.eu.posthog.com',
  'ai-gateway.us.posthog.com',
  'ai-gateway.eu.posthog.com',
]

// Live LLM analytics docs. Swap for the dedicated AI Gateway page once it ships.
const GATEWAY_DOCS_URL = 'https://posthog.com/docs/llm-analytics'

const extractHost = (baseURL: string): string | undefined => {
  try {
    // Tolerate bare hosts ("gateway.us.posthog.com/v1") that omit a scheme.
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseURL)
    return new URL(hasScheme ? baseURL : `https://${baseURL}`).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** Whether `baseURL`'s host is a known PostHog AI Gateway host. */
export const isPostHogAiGatewayUrl = (baseURL: string | undefined | null): boolean => {
  if (!baseURL) {
    return false
  }
  const host = extractHost(baseURL)
  return host !== undefined && POSTHOG_AI_GATEWAY_HOSTS.includes(host)
}

let hasWarned = false

/**
 * Log a one-time warning when `baseURL` points at the PostHog AI Gateway. Safe to
 * call on every generation: it short-circuits after the first warning and does
 * nothing for non-gateway URLs. Behavior is unchanged beyond the log line.
 */
export const warnIfPostHogAiGateway = (baseURL: string | undefined | null): void => {
  if (hasWarned || !isPostHogAiGatewayUrl(baseURL)) {
    return
  }
  hasWarned = true
  console.warn(
    '[PostHog] The PostHog AI wrapper is pointed at the PostHog AI Gateway. ' +
      'Both capture $ai_generation, so every call is double-counted and double-billed. ' +
      `Use one or the other — see ${GATEWAY_DOCS_URL}.`
  )
}

/** Test-only: reset the once-per-process warning latch. */
export const resetGatewayWarningForTesting = (): void => {
  hasWarned = false
}
