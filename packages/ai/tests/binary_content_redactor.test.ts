import { BinaryContentRedactor } from '../src/sanitization/binary_content_redactor'

const redactor = new BinaryContentRedactor()
const redactBinaryContent = <T>(value: T): T => redactor.redact(value)

const placeholder = (mime: string) => `[base64 ${mime} redacted]`
const REDACTED_FILE = '[base64 file redacted]'
const REDACTED_GENERIC = '[base64 redacted]'

const PURE_B64 = 'A'.repeat(2000)
const URL_SAFE_B64 = '-_'.repeat(1000)
const SHORT_B64 = 'A'.repeat(40) // below STRONG_CONTEXT_MIN_LENGTH (64)
const MEDIUM_B64 = 'A'.repeat(80) // above strong threshold, below weak

const containsLargeBase64 = (value: unknown): boolean => JSON.stringify(value).includes('A'.repeat(500))

describe('redactBinaryContent', () => {
  describe('data URLs (always redact, MIME-aware)', () => {
    it.each([
      ['image/png', 'data:image/png;base64,iVBORw0KGgo'],
      ['image/jpeg', 'data:image/jpeg;base64,/9j/abc'],
      ['audio/wav', 'data:audio/wav;base64,UklGR...'],
      ['video/mp4', 'data:video/mp4;base64,AAAAIGZ...'],
      ['application/pdf', 'data:application/pdf;base64,JVBER...'],
    ])('redacts %s data URLs and preserves the specific MIME', (mime, input) => {
      expect(redactBinaryContent(input)).toBe(placeholder(mime))
    })

    it('redacts data URLs even when short', () => {
      expect(redactBinaryContent('data:image/png;base64,A')).toBe(placeholder('image/png'))
    })

    it('redacts data URLs with extra MIME parameters before ;base64', () => {
      expect(redactBinaryContent('data:audio/L16;codec=pcm;rate=24000;base64,UklGR...')).toBe(placeholder('audio/L16'))
    })
  })

  describe('raw base64 with strong context (length >= 64)', () => {
    it.each([
      ['mediaType', 'image/png'],
      ['media_type', 'audio/wav'],
      ['mimeType', 'video/mp4'],
    ])('redacts when sibling has %s', (key, mime) => {
      const out = redactBinaryContent({ data: MEDIUM_B64, [key]: mime })
      expect((out as any).data).toBe(placeholder(mime))
    })

    it('redacts to family-only placeholder when parent.type only carries the family', () => {
      // 'type: image' has no subtype info — falls back to family-only placeholder.
      const out = redactBinaryContent({ type: 'image', data: MEDIUM_B64 })
      expect((out as any).data).toBe(placeholder('image'))
    })

    it('redacts when key matches a known binary key', () => {
      // 'inlineData' is a known binary key — its child string redacts at the strong threshold.
      const out = redactBinaryContent({ inlineData: { data: MEDIUM_B64 } })
      expect((out as any).inlineData.data).toBe(REDACTED_GENERIC)
    })

    it('redacts when sibling.format names an audio format and synthesises the MIME', () => {
      const out = redactBinaryContent({ data: MEDIUM_B64, format: 'wav' })
      expect((out as any).data).toBe(placeholder('audio/wav'))
    })

    it('does not redact below strong threshold even with strong context', () => {
      expect((redactBinaryContent({ data: SHORT_B64, mediaType: 'image/png' }) as any).data).toBe(SHORT_B64)
    })
  })

  describe('raw base64 with weak context (length >= 1024)', () => {
    it('redacts long pure base64 anywhere', () => {
      const out = redactBinaryContent({ unrelatedKey: PURE_B64 })
      expect((out as any).unrelatedKey).toBe(REDACTED_GENERIC)
    })

    it('redacts URL-safe base64 (- and _ alphabet)', () => {
      const out = redactBinaryContent({ unrelatedKey: URL_SAFE_B64 })
      expect((out as any).unrelatedKey).toBe(REDACTED_GENERIC)
    })

    it('does not redact medium base64 without context (avoids JWT/hash false positives)', () => {
      // 80 chars of base64-alphabet, no MIME hint — typical JWT segment territory
      const out = redactBinaryContent({ token: MEDIUM_B64 })
      expect((out as any).token).toBe(MEDIUM_B64)
    })
  })

  describe('Uint8Array / Buffer values', () => {
    it('replaces Uint8Array with placeholder using context', () => {
      const out = redactBinaryContent({ type: 'image', data: new Uint8Array([1, 2, 3]) })
      expect((out as any).data).toBe(placeholder('image'))
    })

    it('replaces Uint8Array with generic placeholder when context is unrelated', () => {
      const out = redactBinaryContent({ payload: new Uint8Array(2000) })
      expect((out as any).payload).toBe(REDACTED_GENERIC)
    })

    it('replaces Uint8Array with file placeholder when key implies a file', () => {
      const out = redactBinaryContent({ file_data: new Uint8Array(10) })
      expect((out as any).file_data).toBe(REDACTED_FILE)
    })
  })

  describe('non-base64 strings', () => {
    it('preserves long human prose (fails alphabet check)', () => {
      const longProse = 'The quick brown fox jumps over the lazy dog. '.repeat(100)
      const out = redactBinaryContent(longProse)
      expect(out).toBe(longProse)
    })

    it('preserves a long sentence with only words and spaces (no punctuation)', () => {
      const sentence = 'the quick brown fox jumps over the lazy dog'.repeat(50)
      expect(redactBinaryContent(sentence)).toBe(sentence)
    })

    it('preserves URLs', () => {
      expect(redactBinaryContent('https://example.com/' + 'abc'.repeat(400))).toContain('https://example.com/')
    })

    it('preserves short strings everywhere', () => {
      expect(redactBinaryContent('hello world')).toBe('hello world')
      expect(redactBinaryContent({ token: 'abc.def.ghi' })).toEqual({ token: 'abc.def.ghi' })
    })
  })

  describe('walking nested structures', () => {
    it('recurses into Anthropic tool_result.content[]', () => {
      const input = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                { type: 'text', text: 'attached' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PURE_B64 } },
              ],
            },
          ],
        },
      ]
      const out = redactBinaryContent(input) as any
      expect(out[0].content[0].content[1].source.data).toBe(placeholder('image/png'))
      expect(containsLargeBase64(out)).toBe(false)
    })

    it('recurses into Vercel V2 tool-result.output.value[]', () => {
      const input = {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc',
            toolName: 't',
            output: {
              type: 'content',
              value: [{ type: 'media', data: PURE_B64, mediaType: 'image/png' }],
            },
          },
        ],
      }
      const out = redactBinaryContent(input) as any
      expect(out.content[0].output.value[0].data).toBe(placeholder('image/png'))
      expect(containsLargeBase64(out)).toBe(false)
    })

    it('recurses into Vercel V3 tool-result.output.value[] (file-data)', () => {
      const input = {
        type: 'tool-result',
        output: {
          type: 'content',
          value: [{ type: 'file-data', data: PURE_B64, mediaType: 'image/jpeg' }],
        },
      }
      const out = redactBinaryContent(input) as any
      expect(out.output.value[0].data).toBe(placeholder('image/jpeg'))
    })

    it('redacts OpenAI input_audio.data via type context', () => {
      const input = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'transcribe' },
            { type: 'input_audio', input_audio: { data: PURE_B64, format: 'wav' } },
          ],
        },
      ]
      const out = redactBinaryContent(input) as any
      // 'format: wav' synthesises 'audio/wav' which carries through to the placeholder.
      expect(out[0].content[1].input_audio.data).toBe(placeholder('audio/wav'))
    })

    it('redacts Gemini content[]-shape inlineData (the wrapper format gap)', () => {
      const input = [
        {
          role: 'user',
          content: [{ text: 'see image' }, { inlineData: { mimeType: 'image/png', data: PURE_B64 } }],
        },
      ]
      const out = redactBinaryContent(input) as any
      expect(out[0].content[1].inlineData.data).toBe(placeholder('image/png'))
    })

    it('redacts OpenAI image_generation_call.result on response output', () => {
      const responseOutput = [
        {
          type: 'image_generation_call',
          id: 'ig_1',
          status: 'completed',
          result: PURE_B64,
        },
      ]
      const out = redactBinaryContent(responseOutput) as any
      // 'result' is a strong-context key — redacts at length 64+
      expect(out[0].result).toBe(REDACTED_GENERIC)
      expect(containsLargeBase64(out)).toBe(false)
    })
  })

  describe('immutability', () => {
    it('returns a new tree without mutating the input', () => {
      const input = { type: 'image', data: PURE_B64 }
      const out = redactBinaryContent(input)
      expect(input.data).toBe(PURE_B64)
      expect((out as any).data).toBe(placeholder('image'))
      expect(out).not.toBe(input)
    })
  })

  describe('cycle guard', () => {
    it('does not stack overflow on circular references', () => {
      const a: any = { name: 'a' }
      const b: any = { name: 'b', back: a }
      a.forward = b
      expect(() => redactBinaryContent(a)).not.toThrow()
    })
  })

  describe('multimodal escape hatch', () => {
    afterEach(() => {
      delete process.env._INTERNAL_LLMA_MULTIMODAL
    })

    it('returns input unchanged when _INTERNAL_LLMA_MULTIMODAL is set', () => {
      process.env._INTERNAL_LLMA_MULTIMODAL = 'true'
      const input = { type: 'image', data: PURE_B64 }
      const out = redactBinaryContent(input)
      expect(out).toBe(input)
    })
  })

  describe('primitives and edge values', () => {
    it.each([null, undefined, 0, 1, true, false])('passes %p through unchanged', (v) => {
      expect(redactBinaryContent(v)).toBe(v)
    })
  })
})
