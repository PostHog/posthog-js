// Integration tests for Gemini generateContent.
// These tests require a real GEMINI_API_KEY and proper ESM transform configuration.
// They are skipped entirely when no API key is present.
//
// To run: GEMINI_API_KEY=<key> jest --testPathPattern=gemini.integration \
//   --transformIgnorePatterns='node_modules/(?!(@google/genai|p-retry|is-network-error)/)'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

if (!GEMINI_API_KEY) {
  test.skip('Gemini integration tests require GEMINI_API_KEY', () => {})
} else {
  // Dynamic imports to avoid ESM parse failures when @google/genai
  // transitive deps are not configured in transformIgnorePatterns.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PostHog } = require('posthog-node')

  jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
      capture: jest.fn(),
      captureImmediate: jest.fn(),
      privacyMode: false,
    })),
  }))

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PostHogGemini = require('../src/gemini').default

  describe('Gemini Integration Tests', () => {
    let mockPostHogClient: any
    let client: any

    beforeEach(() => {
      mockPostHogClient = new PostHog('test-key')
      client = new PostHogGemini({
        apiKey: GEMINI_API_KEY,
        posthog: mockPostHogClient,
      })
    })

    test('generateContent captures stop_reason', async () => {
      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'Say hi',
        posthogDistinctId: 'test-id',
      })

      expect(response.text).toBeDefined()

      const captureCall = mockPostHogClient.capture.mock.calls.find(
        (call: any[]) => call[0].event === '$ai_generation'
      )
      expect(captureCall).toBeDefined()
      const props = captureCall![0].properties
      expect(props.$ai_provider).toBe('gemini')
      expect(props.$ai_stop_reason).toBeDefined()
      expect(typeof props.$ai_stop_reason).toBe('string')
      expect(props.$ai_input_tokens).toBeGreaterThan(0)
    })
  })
}
