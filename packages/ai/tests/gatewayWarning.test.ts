import {
  POSTHOG_AI_GATEWAY_HOSTS,
  isPostHogAiGatewayUrl,
  warnIfPostHogAiGateway,
  resetGatewayWarningForTesting,
} from '../src/gatewayWarning'

describe('gatewayWarning', () => {
  describe('isPostHogAiGatewayUrl', () => {
    it('detects every maintained gateway host', () => {
      for (const host of POSTHOG_AI_GATEWAY_HOSTS) {
        expect(isPostHogAiGatewayUrl(`https://${host}/v1`)).toBe(true)
      }
    })

    it('detects the live production host with a per-product route prefix', () => {
      expect(isPostHogAiGatewayUrl('https://gateway.us.posthog.com/v1')).toBe(true)
      expect(isPostHogAiGatewayUrl('https://gateway.us.posthog.com/signals/v1')).toBe(true)
      expect(isPostHogAiGatewayUrl('https://gateway.us.posthog.com/anthropic')).toBe(true)
    })

    it('matches the host regardless of scheme, casing, or a missing scheme', () => {
      expect(isPostHogAiGatewayUrl('http://gateway.us.posthog.com/v1')).toBe(true)
      expect(isPostHogAiGatewayUrl('https://GATEWAY.US.POSTHOG.COM/v1')).toBe(true)
      expect(isPostHogAiGatewayUrl('gateway.us.posthog.com/v1')).toBe(true)
    })

    it('does not match non-gateway PostHog hosts or other providers', () => {
      expect(isPostHogAiGatewayUrl('https://us.i.posthog.com')).toBe(false)
      expect(isPostHogAiGatewayUrl('https://eu.posthog.com')).toBe(false)
      expect(isPostHogAiGatewayUrl('https://api.openai.com/v1')).toBe(false)
      expect(isPostHogAiGatewayUrl('https://api.anthropic.com')).toBe(false)
      // A look-alike host on a different domain must not match.
      expect(isPostHogAiGatewayUrl('https://gateway.us.posthog.com.evil.example/v1')).toBe(false)
    })

    it('does not match empty, missing, or malformed values', () => {
      expect(isPostHogAiGatewayUrl('')).toBe(false)
      expect(isPostHogAiGatewayUrl(undefined)).toBe(false)
      expect(isPostHogAiGatewayUrl(null)).toBe(false)
      expect(isPostHogAiGatewayUrl('::::not a url')).toBe(false)
    })
  })

  describe('warnIfPostHogAiGateway', () => {
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      resetGatewayWarningForTesting()
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('warns once with the double-counting message when pointed at the gateway', () => {
      warnIfPostHogAiGateway('https://gateway.us.posthog.com/v1')

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const message = warnSpy.mock.calls[0][0]
      expect(message).toContain('[PostHog]')
      expect(message).toContain('PostHog AI Gateway')
      expect(message).toContain('$ai_generation')
      expect(message).toContain('double-counted and double-billed')
      expect(message).toContain('https://posthog.com/docs/llm-analytics')
    })

    it('warns only once across many gateway calls', () => {
      for (let i = 0; i < 5; i++) {
        warnIfPostHogAiGateway('https://gateway.us.posthog.com/v1')
      }
      // A second host should not re-trigger the warning either.
      warnIfPostHogAiGateway('https://gateway.eu.posthog.com/v1')

      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('does not warn for non-gateway base URLs', () => {
      warnIfPostHogAiGateway('https://api.openai.com/v1')
      warnIfPostHogAiGateway(undefined)
      warnIfPostHogAiGateway('')

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
