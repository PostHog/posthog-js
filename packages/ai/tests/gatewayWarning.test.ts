import {
  POSTHOG_AI_GATEWAY_HOSTS,
  isPostHogAiGatewayUrl,
  warnIfPostHogAiGateway,
  warnIfPostHogAiGatewayOtelAttributes,
} from '../src/gatewayWarning'

describe('gatewayWarning', () => {
  describe('isPostHogAiGatewayUrl', () => {
    it.each(POSTHOG_AI_GATEWAY_HOSTS)('detects gateway host %s', (host) => {
      expect(isPostHogAiGatewayUrl(`https://${host}/v1`)).toBe(true)
    })

    it.each([
      'https://gateway.us.posthog.com/v1',
      'https://gateway.us.posthog.com/signals/v1',
      'https://gateway.us.posthog.com/anthropic',
    ])('detects the live production host with a route prefix: %s', (url) => {
      expect(isPostHogAiGatewayUrl(url)).toBe(true)
    })

    it.each([
      ['http scheme', 'http://gateway.us.posthog.com/v1'],
      ['uppercase host', 'https://GATEWAY.US.POSTHOG.COM/v1'],
      ['missing scheme', 'gateway.us.posthog.com/v1'],
    ])('matches a gateway host with %s', (_label, url) => {
      expect(isPostHogAiGatewayUrl(url)).toBe(true)
    })

    it.each([
      ['ingestion host', 'https://us.i.posthog.com'],
      ['app host', 'https://eu.posthog.com'],
      ['openai', 'https://api.openai.com/v1'],
      ['anthropic', 'https://api.anthropic.com'],
      ['look-alike domain', 'https://gateway.us.posthog.com.evil.example/v1'],
    ])('does not match non-gateway URL (%s)', (_label, url) => {
      expect(isPostHogAiGatewayUrl(url)).toBe(false)
    })

    it.each([
      ['empty string', ''],
      ['undefined', undefined],
      ['null', null],
      ['malformed', '::::not a url'],
    ])('does not match %s', (_label, value) => {
      expect(isPostHogAiGatewayUrl(value)).toBe(false)
    })
  })

  describe('warnIfPostHogAiGateway', () => {
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('warns with the double-counting message when pointed at the gateway', () => {
      warnIfPostHogAiGateway('https://gateway.us.posthog.com/v1')

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const message = warnSpy.mock.calls[0][0]
      expect(message).toContain('[PostHog]')
      expect(message).toContain('PostHog AI Gateway')
      expect(message).toContain('$ai_generation')
      expect(message).toContain('double-counted and double-billed')
      expect(message).toContain('https://posthog.com/docs/ai-observability')
    })

    it('warns on every gateway call so the misconfiguration cannot be missed', () => {
      for (let i = 0; i < 5; i++) {
        warnIfPostHogAiGateway('https://gateway.us.posthog.com/v1')
      }

      expect(warnSpy).toHaveBeenCalledTimes(5)
    })

    it('does not warn for non-gateway base URLs', () => {
      warnIfPostHogAiGateway('https://api.openai.com/v1')
      warnIfPostHogAiGateway(undefined)
      warnIfPostHogAiGateway('')

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('warnIfPostHogAiGatewayOtelAttributes', () => {
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it.each([
      ['server.address bare host', { 'server.address': 'gateway.us.posthog.com' }],
      ['url.full full URL', { 'url.full': 'https://gateway.us.posthog.com/v1/chat/completions' }],
    ])('warns when a gateway is detected via %s', (_label, attributes) => {
      warnIfPostHogAiGatewayOtelAttributes(attributes)

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('PostHog AI Gateway')
    })

    it('warns at most once per span even when several attributes point at the gateway', () => {
      warnIfPostHogAiGatewayOtelAttributes({
        'server.address': 'gateway.us.posthog.com',
        'url.full': 'https://gateway.us.posthog.com/v1',
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['a non-gateway host', { 'server.address': 'api.openai.com', 'url.full': 'https://api.openai.com/v1' }],
      ['no relevant attributes', { 'gen_ai.model': 'gpt-4o' }],
      ['undefined attributes', undefined],
    ])('does not warn for %s', (_label, attributes) => {
      warnIfPostHogAiGatewayOtelAttributes(attributes)

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
