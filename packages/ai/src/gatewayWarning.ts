// Warn when a wrapper's base_url points at the PostHog AI Gateway: the gateway
// emits its own $ai_generation, so each call would be captured (and, for billable
// products, billed) twice. We only warn — the wrapper's event carries data the
// gateway never sees (groups, custom properties, trace hierarchy).

// Keep in sync with the gateway's deployed hosts (see services/llm-gateway in the
// main repo). gateway.us.posthog.com is live today; the rest are listed ahead of
// any traffic moving to them.
export const POSTHOG_AI_GATEWAY_HOSTS: readonly string[] = [
  'gateway.posthog.com',
  'gateway.us.posthog.com',
  'gateway.eu.posthog.com',
  'ai-gateway.us.posthog.com',
  'ai-gateway.eu.posthog.com',
]

// Swap for the dedicated AI Gateway page once it ships.
const GATEWAY_DOCS_URL = 'https://posthog.com/docs/ai-observability'

const extractHost = (baseURL: string): string | undefined => {
  try {
    // Tolerate bare hosts that omit a scheme, e.g. "gateway.us.posthog.com/v1".
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseURL)
    return new URL(hasScheme ? baseURL : `https://${baseURL}`).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

export const isPostHogAiGatewayUrl = (baseURL: string | undefined | null): boolean => {
  if (!baseURL) {
    return false
  }
  const host = extractHost(baseURL)
  return host !== undefined && POSTHOG_AI_GATEWAY_HOSTS.includes(host)
}

// Warns on every gateway call by design: the misconfiguration is impossible to
// miss that way, and a doubled bill is worse than noisy logs.
export const warnIfPostHogAiGateway = (baseURL: string | undefined | null): void => {
  if (!isPostHogAiGatewayUrl(baseURL)) {
    return
  }
  console.warn(
    '[PostHog] The PostHog AI wrapper is pointed at the PostHog AI Gateway. ' +
      'Both capture $ai_generation, so every call is double-counted and double-billed. ' +
      `Use one or the other — see ${GATEWAY_DOCS_URL}.`
  )
}
