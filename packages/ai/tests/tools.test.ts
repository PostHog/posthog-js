import {
  extractAvailableToolCalls,
  formatResponseOpenAI,
  formatResponseAnthropic,
  formatResponseGemini,
} from '../src/utils'

describe('Tool Handling Tests', () => {
  describe('extractAvailableToolCalls', () => {
    it('should extract tools from OpenAI params', () => {
      const params = {
        model: 'gpt-4',
        messages: [],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
              },
            },
          },
        ],
      }

      const tools = extractAvailableToolCalls('openai', params)
      expect(tools).toEqual(params.tools)
    })

    it('should extract tools from Anthropic params', () => {
      const params = {
        model: 'claude-3-opus',
        messages: [],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather for a location',
            input_schema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        ],
      }

      const tools = extractAvailableToolCalls('anthropic', params)
      expect(tools).toEqual(params.tools)
    })

    it('should extract tools from Gemini params', () => {
      const params = {
        model: 'gemini-pro',
        contents: [],
        config: {
          tools: [
            {
              function_declarations: [
                {
                  name: 'get_weather',
                  description: 'Get the weather for a location',
                  parameters: {
                    type: 'object',
                    properties: {
                      location: { type: 'string' },
                    },
                  },
                },
              ],
            },
          ],
        },
      }

      const tools = extractAvailableToolCalls('gemini', params)
      expect(tools).toEqual(params.config.tools)
    })

    it('should extract tools from Vercel AI SDK params', () => {
      const params = {
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
          {
            name: 'search',
            description: 'Search for information',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        ],
        prompt: [],
        inputFormat: 'messages',
      }

      const tools = extractAvailableToolCalls('vercel', params)
      expect(tools).toEqual(params.tools)
    })

    it('should return null for Vercel AI SDK when no tools are present', () => {
      const params = {
        prompt: [],
        inputFormat: 'messages',
      }

      const tools = extractAvailableToolCalls('vercel', params)
      expect(tools).toBeNull()
    })

    it('should return null for Vercel AI SDK when tools is undefined', () => {
      const params = {
        prompt: [],
        inputFormat: 'messages',
        tools: undefined,
      }

      const tools = extractAvailableToolCalls('vercel', params)
      expect(tools).toBeNull()
    })

    it('should return null when no tools are present', () => {
      expect(extractAvailableToolCalls('openai', {})).toBeNull()
      expect(extractAvailableToolCalls('anthropic', {})).toBeNull()
      expect(extractAvailableToolCalls('gemini', {})).toBeNull()
      expect(extractAvailableToolCalls('vercel', {})).toBeNull()
    })
  })

  describe('formatResponseOpenAI', () => {
    it('should format response with text and tool calls', () => {
      const response = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'I will help you with that.',
              tool_calls: [
                {
                  id: 'call_123',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "San Francisco"}',
                  },
                },
              ],
            },
          },
        ],
      }

      const formatted = formatResponseOpenAI(response)
      expect(formatted).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will help you with that.' },
            {
              type: 'function',
              id: 'call_123',
              function: {
                name: 'get_weather',
                arguments: '{"location": "San Francisco"}',
              },
            },
          ],
        },
      ])
    })

    it('should format response with only tool calls', () => {
      const response = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_456',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "New York"}',
                  },
                },
              ],
            },
          },
        ],
      }

      const formatted = formatResponseOpenAI(response)
      expect(formatted).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'function',
              id: 'call_456',
              function: {
                name: 'get_weather',
                arguments: '{"location": "New York"}',
              },
            },
          ],
        },
      ])
    })
  })

  describe('formatResponseAnthropic', () => {
    it('should format response with text and tool use', () => {
      const response = {
        content: [
          { type: 'text', text: 'I will check the weather for you.' },
          {
            type: 'tool_use',
            id: 'tool_abc',
            name: 'get_weather',
            input: { location: 'Paris' },
          },
        ],
      }

      const formatted = formatResponseAnthropic(response)
      expect(formatted).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will check the weather for you.' },
            {
              type: 'function',
              id: 'tool_abc',
              function: {
                name: 'get_weather',
                arguments: { location: 'Paris' },
              },
            },
          ],
        },
      ])
    })

    it('should format response with only tool use', () => {
      const response = {
        content: [
          {
            type: 'tool_use',
            id: 'tool_def',
            name: 'calculate',
            input: { expression: '2+2' },
          },
        ],
      }

      const formatted = formatResponseAnthropic(response)
      expect(formatted).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'function',
              id: 'tool_def',
              function: {
                name: 'calculate',
                arguments: { expression: '2+2' },
              },
            },
          ],
        },
      ])
    })
  })

  describe('formatResponseGemini', () => {
    it('should format response with text and function call', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Let me get the weather information.' },
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { location: 'Tokyo' },
                  },
                },
              ],
            },
          },
        ],
      }

      const formatted = formatResponseGemini(response)
      expect(formatted).toEqual([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me get the weather information.' },
            {
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: { location: 'Tokyo' },
              },
            },
          ],
        },
      ])
    })

    it('should format response with only text', () => {
      const response = {
        text: 'Here is the weather information.',
      }

      const formatted = formatResponseGemini(response)
      expect(formatted).toEqual([
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is the weather information.' }],
        },
      ])
    })

    it('should convert Uint8Array inline data to base64', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      const response = {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: bytes } }],
            },
          },
        ],
      }

      const formatted = formatResponseGemini(response)
      expect(formatted).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'audio',
              mime_type: 'audio/pcm',
              data: 'SGVsbG8=', // base64 of "Hello"
            },
          ],
        },
      ])
    })
  })
})
