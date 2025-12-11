import {
  redactBase64DataUrl,
  sanitizeOpenAI,
  sanitizeOpenAIResponse,
  sanitizeAnthropic,
  sanitizeGemini,
  sanitizeLangChain,
} from '../src/sanitization'

const sanitize = (data: unknown, provider: string): unknown => {
  switch (provider) {
    case 'openai-chat-completions':
      return sanitizeOpenAI(data)
    case 'openai-response':
      return sanitizeOpenAIResponse(data)
    case 'anthropic':
      return sanitizeAnthropic(data)
    case 'gemini':
      return sanitizeGemini(data)
    case 'langchain':
      return sanitizeLangChain(data)
  }
}

describe('Base64 image redaction', () => {
  const sampleBase64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...'
  const sampleBase64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...'

  describe('redactBase64DataUrl', () => {
    it('should redact base64 data URLs', () => {
      expect(redactBase64DataUrl(sampleBase64Image)).toBe('[base64 image redacted]')
      expect(redactBase64DataUrl(sampleBase64Png)).toBe('[base64 image redacted]')
    })

    it('should preserve regular URLs', () => {
      const url = 'https://example.com/image.jpg'
      expect(redactBase64DataUrl(url)).toBe('https://example.com/image.jpg')
    })

    it('should handle non-string inputs', () => {
      expect(redactBase64DataUrl(null as any)).toBe(null)
      expect(redactBase64DataUrl(undefined as any)).toBe(undefined)
      expect(redactBase64DataUrl(123 as any)).toBe(123)
    })

    it('should handle raw base64 edge cases', () => {
      // Exactly 20 characters - should not be redacted (at boundary)
      const exactly20Chars = 'A'.repeat(20)
      expect(redactBase64DataUrl(exactly20Chars)).toBe(exactly20Chars)

      // 21 characters of valid base64 - should be redacted
      const twentyOneChars = 'A'.repeat(21)
      expect(redactBase64DataUrl(twentyOneChars)).toBe('[base64 image redacted]')

      // Raw base64 with padding - longer than 20 chars
      const rawBase64WithPadding = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUl=='
      expect(redactBase64DataUrl(rawBase64WithPadding)).toBe('[base64 image redacted]')

      // Short base64-like string - should not be redacted (under 20 chars)
      const shortBase64 = 'SGVsbG8='
      expect(redactBase64DataUrl(shortBase64)).toBe(shortBase64)

      // URL with protocol should not be redacted
      const urlWithProtocol = 'https://example.com/' + 'A'.repeat(30)
      expect(redactBase64DataUrl(urlWithProtocol)).toBe(urlWithProtocol)

      // Path-like base64 should not be redacted
      const pathLikeBase64 = '/path/to/' + 'A'.repeat(30)
      expect(redactBase64DataUrl(pathLikeBase64)).toBe(pathLikeBase64)
    })

    it('should handle malformed base64 strings', () => {
      // String with invalid base64 characters - should not be redacted
      const invalidChars = 'A'.repeat(21) + '!@#$%'
      expect(redactBase64DataUrl(invalidChars)).toBe(invalidChars)

      // URL that starts with http but contains base64-like content - should not be redacted
      const httpWithBase64 = 'http://example.com/' + 'A'.repeat(60)
      expect(redactBase64DataUrl(httpWithBase64)).toBe(httpWithBase64)

      // Mixed content with spaces - should not be redacted
      const withSpaces = 'AAAA BBBB CCCC DDDD'.repeat(5)
      expect(redactBase64DataUrl(withSpaces)).toBe(withSpaces)

      // Data URL with non-base64 encoding - should not be redacted
      const nonBase64DataUrl = 'data:text/plain;charset=utf-8,Hello%20World'
      expect(redactBase64DataUrl(nonBase64DataUrl)).toBe(nonBase64DataUrl)

      // Domain-like patterns without protocol won't be caught by URL constructor
      // but also won't match base64 pattern due to the dot
      const domainLike = 'AAA.com/AAAAAAAAAAAAAAAAAAA'
      expect(redactBase64DataUrl(domainLike)).toBe(domainLike)

      const relativeUrl = './files/' + 'A'.repeat(30)
      expect(redactBase64DataUrl(relativeUrl)).toBe(relativeUrl)

      const fileUrl = 'file:///Users/' + 'A'.repeat(30)
      expect(redactBase64DataUrl(fileUrl)).toBe(fileUrl)
    })
  })

  describe('sanitize openai-chat-completions', () => {
    it('should redact base64 images in OpenAI message format', () => {
      const input = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What is in this image?',
            },
            {
              type: 'image_url',
              image_url: {
                url: sampleBase64Image,
                detail: 'high',
              },
            },
          ],
        },
      ]

      const result = sanitize(input, 'openai-chat-completions') as any

      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: 'What is in this image?',
      })
      expect(result[0].content[1].image_url.url).toBe('[base64 image redacted]')
      expect(result[0].content[1].image_url.detail).toBe('high')
    })

    it('should preserve regular URLs in OpenAI format', () => {
      const input = [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'https://example.com/image.jpg',
              },
            },
          ],
        },
      ]

      const result = sanitize(input, 'openai-chat-completions') as any
      expect(result[0].content[0].image_url.url).toBe('https://example.com/image.jpg')
    })

    it('should handle messages without content arrays', () => {
      const input = [
        {
          role: 'user',
          content: 'Just text',
        },
      ]

      const result = sanitize(input, 'openai-chat-completions')
      expect(result).toEqual(input)
    })

    it('should handle non-array inputs', () => {
      expect(sanitize(null, 'openai-chat-completions')).toBe(null)
      expect(sanitize(undefined, 'openai-chat-completions')).toBe(undefined)
      expect(sanitize('string', 'openai-chat-completions')).toBe('string')
    })

    it('should handle single message object with base64 image', () => {
      const input = {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: sampleBase64Image,
            },
          },
        ],
      }

      const result = sanitize(input, 'openai-chat-completions') as any
      expect(result.content[0].image_url.url).toBe('[base64 image redacted]')
    })

    it('should handle content as single object with image_url', () => {
      const input = {
        role: 'user',
        content: {
          type: 'image_url',
          image_url: {
            url: sampleBase64Image,
          },
        },
      }

      const result = sanitize(input, 'openai-chat-completions') as any
      expect(result.content.image_url.url).toBe('[base64 image redacted]')
    })

    it('should not affect single object content without image_url type', () => {
      const input = {
        role: 'user',
        content: {
          type: 'text',
          text: 'Some text content',
        },
      }

      const result = sanitize(input, 'openai-chat-completions')
      expect(result).toEqual(input)
    })
  })

  describe('sanitize openai-response', () => {
    it('should handle input_image format in arrays and single messages', () => {
      // Test array of messages
      const arrayInput = [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: sampleBase64Png,
            },
          ],
        },
      ]
      const arrayResult = sanitize(arrayInput, 'openai-response') as any
      expect(arrayResult[0].content[0].image_url).toBe('[base64 image redacted]')

      // Test single message object
      const singleInput = {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: sampleBase64Image,
          },
        ],
      }
      const singleResult = sanitize(singleInput, 'openai-response') as any
      expect(singleResult.content[0].image_url).toBe('[base64 image redacted]')
    })

    it('should handle content as single object with input_image', () => {
      const input = {
        role: 'user',
        content: {
          type: 'input_image',
          image_url: sampleBase64Image,
        },
      }

      const result = sanitize(input, 'openai-response') as any
      expect(result.content.image_url).toBe('[base64 image redacted]')
    })
  })

  describe('sanitize anthropic', () => {
    it('should redact base64 images in Anthropic format', () => {
      const input = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Describe this image',
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAUA...',
              },
            },
          ],
        },
      ]

      const result = sanitize(input, 'anthropic') as any

      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: 'Describe this image',
      })
      expect(result[0].content[1].source.data).toBe('[base64 image redacted]')
      expect(result[0].content[1].source.type).toBe('base64')
      expect(result[0].content[1].source.media_type).toBe('image/jpeg')
    })

    it('should handle non-array inputs', () => {
      expect(sanitize(null, 'anthropic')).toBe(null)
      expect(sanitize(undefined, 'anthropic')).toBe(undefined)
      expect(sanitize('string', 'anthropic')).toBe('string')
    })

    it('should handle messages without content arrays', () => {
      const input = [
        {
          role: 'user',
          content: 'Just text',
        },
      ]

      const result = sanitize(input, 'anthropic')
      expect(result).toEqual(input)
    })

    it('should handle single message object with base64 image', () => {
      const input = {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAUA...',
            },
          },
        ],
      }

      const result = sanitize(input, 'anthropic') as any
      expect(result.content[0].source.data).toBe('[base64 image redacted]')
    })

    it('should handle content as single object with image', () => {
      const input = {
        role: 'user',
        content: {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: 'base64data',
          },
        },
      }

      const result = sanitize(input, 'anthropic') as any
      expect(result.content.source.data).toBe('[base64 image redacted]')
    })
  })

  describe('sanitize gemini', () => {
    it('should redact base64 images in Gemini format', () => {
      const input = [
        {
          parts: [
            {
              text: 'Analyze this image',
            },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: '/9j/4AAQSkZJRgABAQAAAQ...',
              },
            },
          ],
        },
      ]

      const result = sanitize(input, 'gemini') as any

      expect(result[0].parts[0]).toEqual({
        text: 'Analyze this image',
      })
      expect(result[0].parts[1]).toEqual({
        inlineData: {
          mimeType: 'image/jpeg',
          data: '[base64 image redacted]',
        },
      })
    })

    it('should handle contents without parts', () => {
      const input = [
        {
          text: 'Just text',
        },
      ]

      const result = sanitize(input, 'gemini')
      expect(result).toEqual(input)
    })

    it('should handle non-array inputs', () => {
      expect(sanitize(null, 'gemini')).toBe(null)
      expect(sanitize(undefined, 'gemini')).toBe(undefined)
      expect(sanitize('string', 'gemini')).toBe('string')
    })

    it('should handle single content object with parts array', () => {
      const input = {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: 'base64imagedata',
            },
          },
        ],
      }

      const result = sanitize(input, 'gemini') as any
      expect(result.parts[0].inlineData.data).toBe('[base64 image redacted]')
    })

    it('should handle parts as single object with inlineData', () => {
      const input = {
        parts: {
          inlineData: {
            mimeType: 'image/jpeg',
            data: 'base64data',
          },
        },
      }

      const result = sanitize(input, 'gemini') as any
      expect(result.parts.inlineData.data).toBe('[base64 image redacted]')
    })
  })

  describe('sanitize langchain', () => {
    it('should redact base64 images in OpenAI image_url format', () => {
      const input = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is in this image?',
          },
          {
            type: 'image_url',
            image_url: {
              url: sampleBase64Image,
            },
          },
        ],
      }

      const result = sanitize(input, 'langchain') as any
      expect(result.content[0].text).toBe('What is in this image?')
      expect(result.content[1].image_url.url).toBe('[base64 image redacted]')
    })

    it('should redact base64 images in direct image format', () => {
      const input = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this',
            },
            {
              type: 'image',
              data: sampleBase64Image,
            },
          ],
        },
      ]

      const result = sanitize(input, 'langchain') as any
      expect(result[0].content[1].data).toBe('[base64 image redacted]')
    })

    it('should redact base64 images in Anthropic source format', () => {
      const input = {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              data: sampleBase64Png,
            },
          },
        ],
      }

      const result = sanitize(input, 'langchain') as any
      expect(result.content[0].source.data).toBe('[base64 image redacted]')
    })

    it('should redact base64 images in Google media format', () => {
      const input = [
        {
          role: 'user',
          content: [
            {
              type: 'media',
              data: sampleBase64Image,
              mime_type: 'image/jpeg',
            },
          ],
        },
      ]

      const result = sanitize(input, 'langchain') as any
      expect(result[0].content[0].data).toBe('[base64 image redacted]')
    })

    it('should preserve text content in messages', () => {
      const input = {
        role: 'assistant',
        content: 'This is a text response',
      }

      const result = sanitize(input, 'langchain') as any
      expect(result.content).toBe('This is a text response')
    })

    it('should handle arrays of messages', () => {
      const input = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Check this' },
            { type: 'image_url', image_url: { url: sampleBase64Image } },
          ],
        },
      ]

      const result = sanitize(input, 'langchain') as any
      expect(result[0].content).toBe('Hello')
      expect(result[1].content).toBe('Hi there!')
      expect(result[2].content[0].text).toBe('Check this')
      expect(result[2].content[1].image_url.url).toBe('[base64 image redacted]')
    })

    it('should handle edge cases', () => {
      expect(sanitize(null, 'langchain')).toBe(null)
      expect(sanitize(undefined, 'langchain')).toBe(undefined)
      expect(sanitize('string', 'langchain')).toBe('string')
      expect(sanitize([], 'langchain')).toEqual([])
      expect(sanitize({}, 'langchain')).toEqual({})
    })

    it('should not affect non-base64 URLs', () => {
      const input = {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
            },
          },
        ],
      }

      const result = sanitize(input, 'langchain') as any
      expect(result.content[0].image_url.url).toBe('https://example.com/image.jpg')
    })
  })

  describe('Multimodal environment variable control', () => {
    beforeEach(() => {
      delete process.env._INTERNAL_LLMA_MULTIMODAL
    })

    afterEach(() => {
      delete process.env._INTERNAL_LLMA_MULTIMODAL
    })

    describe('Flag value handling', () => {
      it('should redact images when _INTERNAL_LLMA_MULTIMODAL is not set', () => {
        const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...'
        const result = redactBase64DataUrl(base64Image)
        expect(result).toBe('[base64 image redacted]')
      })

      it('should preserve images when _INTERNAL_LLMA_MULTIMODAL is "true"', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...'
        const result = redactBase64DataUrl(base64Image)
        expect(result).toBe(base64Image)
      })

      it('should preserve images when _INTERNAL_LLMA_MULTIMODAL is "1"', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = '1'
        const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...'
        const result = redactBase64DataUrl(base64Image)
        expect(result).toBe(base64Image)
      })

      it('should preserve images when _INTERNAL_LLMA_MULTIMODAL is "yes"', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'yes'
        const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...'
        const result = redactBase64DataUrl(base64Image)
        expect(result).toBe(base64Image)
      })

      it('should redact images when _INTERNAL_LLMA_MULTIMODAL is "false"', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'false'
        const base64Image = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...'
        const result = redactBase64DataUrl(base64Image)
        expect(result).toBe('[base64 image redacted]')
      })
    })

    describe('OpenAI provider', () => {
      it('should preserve images when flag is enabled', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const input = [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...' },
              },
            ],
          },
        ]

        const result = sanitize(input, 'openai-chat-completions') as any
        expect(result[0].content[0].image_url.url).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...')
      })

      it('should redact audio when flag is disabled', () => {
        delete process.env._INTERNAL_LLMA_MULTIMODAL
        const input = [
          {
            role: 'assistant',
            content: [{ type: 'audio', data: 'base64audiodata', id: 'audio_123' }],
          },
        ]

        const result = sanitize(input, 'openai-chat-completions') as any
        expect(result[0].content[0].data).toBe('[base64 image redacted]')
        expect(result[0].content[0].id).toBe('audio_123')
      })

      it('should preserve audio when flag is enabled', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const input = [
          {
            role: 'assistant',
            content: [{ type: 'audio', data: 'base64audiodata', id: 'audio_123' }],
          },
        ]

        const result = sanitize(input, 'openai-chat-completions') as any
        expect(result[0].content[0].data).toBe('base64audiodata')
      })
    })

    describe('Anthropic provider', () => {
      it('should preserve images when flag is enabled', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const input = [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: 'base64data',
                },
              },
            ],
          },
        ]

        const result = sanitize(input, 'anthropic') as any
        expect(result[0].content[0].source.data).toBe('base64data')
      })

      it('should preserve PDFs/documents when flag is enabled', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const input = [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: 'base64pdfdata',
                },
              },
            ],
          },
        ]

        const result = sanitize(input, 'anthropic') as any
        expect(result[0].content[0].source.data).toBe('base64pdfdata')
      })

      it('should redact documents when flag is disabled', () => {
        delete process.env._INTERNAL_LLMA_MULTIMODAL
        const input = [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: 'base64pdfdata',
                },
              },
            ],
          },
        ]

        const result = sanitize(input, 'anthropic') as any
        expect(result[0].content[0].source.data).toBe('[base64 image redacted]')
      })
    })

    describe('Gemini provider', () => {
      it('should preserve images when flag is enabled', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const input = [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'base64data' } }] }]

        const result = sanitize(input, 'gemini') as any
        expect(result[0].parts[0].inlineData.data).toBe('base64data')
      })

      it('should redact audio when flag is disabled', () => {
        delete process.env._INTERNAL_LLMA_MULTIMODAL
        const input = [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/L16;codec=pcm;rate=24000',
                  data: 'base64audiodata',
                },
              },
            ],
          },
        ]

        const result = sanitize(input, 'gemini') as any
        expect(result[0].parts[0].inlineData.data).toBe('[base64 image redacted]')
      })

      it('should preserve audio when flag is enabled', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const input = [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/L16;codec=pcm;rate=24000',
                  data: 'base64audiodata',
                },
              },
            ],
          },
        ]

        const result = sanitize(input, 'gemini') as any
        expect(result[0].parts[0].inlineData.data).toBe('base64audiodata')
      })
    })

    describe('LangChain provider', () => {
      it('should preserve Anthropic-style images when flag is enabled', () => {
        process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
        const input = [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { data: 'base64data' },
              },
            ],
          },
        ]

        const result = sanitize(input, 'langchain') as any
        expect(result[0].content[0].source.data).toBe('base64data')
      })

      it('should redact Anthropic-style images when flag is disabled', () => {
        delete process.env._INTERNAL_LLMA_MULTIMODAL
        const input = [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { data: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...' },
              },
            ],
          },
        ]

        const result = sanitize(input, 'langchain') as any
        expect(result[0].content[0].source.data).toBe('[base64 image redacted]')
      })
    })
  })
})
