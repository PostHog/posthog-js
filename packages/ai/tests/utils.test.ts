import { toContentString } from '../src/utils'

describe('toContentString', () => {
  describe('string inputs', () => {
    it('should return strings as-is', () => {
      expect(toContentString('hello world')).toBe('hello world')
    })

    it('should return empty strings as-is', () => {
      expect(toContentString('')).toBe('')
    })

    it('should handle strings with special characters', () => {
      const input = 'Hello "world" with\nnewlines and\ttabs'
      expect(toContentString(input)).toBe(input)
    })
  })

  describe('primitive inputs', () => {
    it('should convert numbers to strings', () => {
      expect(toContentString(123)).toBe('123')
      expect(toContentString(0)).toBe('0')
      expect(toContentString(-42.5)).toBe('-42.5')
    })

    it('should convert booleans to strings', () => {
      expect(toContentString(true)).toBe('true')
      expect(toContentString(false)).toBe('false')
    })

    it('should convert null to string', () => {
      expect(toContentString(null)).toBe('null')
    })

    it('should convert undefined to string', () => {
      expect(toContentString(undefined)).toBe('undefined')
    })
  })

  describe('object inputs', () => {
    it('should JSON.stringify simple objects', () => {
      const input = { foo: 'bar', baz: 42 }
      expect(toContentString(input)).toBe('{"foo":"bar","baz":42}')
    })

    it('should JSON.stringify nested objects', () => {
      const input = {
        level1: {
          level2: {
            value: 'deep',
          },
        },
      }
      expect(toContentString(input)).toBe('{"level1":{"level2":{"value":"deep"}}}')
    })

    it('should JSON.stringify objects with null values', () => {
      const input = { key: null }
      expect(toContentString(input)).toBe('{"key":null}')
    })

    it('should handle the [object Object] case', () => {
      const input = { type: 'text', text: 'Hello world' }
      const result = toContentString(input)
      expect(result).toBe('{"type":"text","text":"Hello world"}')
      expect(result).not.toBe('[object Object]')
    })
  })

  describe('array inputs', () => {
    it('should JSON.stringify simple arrays', () => {
      expect(toContentString([1, 2, 3])).toBe('[1,2,3]')
    })

    it('should JSON.stringify string arrays', () => {
      expect(toContentString(['a', 'b', 'c'])).toBe('["a","b","c"]')
    })

    it('should JSON.stringify arrays of objects', () => {
      const input = [{ type: 'text', text: 'Hello' }]
      expect(toContentString(input)).toBe('[{"type":"text","text":"Hello"}]')
    })

    it('should handle structured content format (the main bug case)', () => {
      const input = [
        {
          type: 'output_text',
          text: 'Hi there! How are you today?',
        },
      ]
      const result = toContentString(input)
      expect(result).toBe('[{"type":"output_text","text":"Hi there! How are you today?"}]')
      expect(result).not.toBe('[object Object]')
    })

    it('should handle multiple content items', () => {
      const input = [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ]
      expect(toContentString(input)).toBe('[{"type":"text","text":"Hello"},{"type":"text","text":"World"}]')
    })

    it('should handle empty arrays', () => {
      expect(toContentString([])).toBe('[]')
    })
  })

  describe('OpenAI Response API format', () => {
    it('should handle output_text format', () => {
      const input = [
        {
          type: 'output_text',
          text: "I'm just a friendly AI, so I don't have feelings, but I'm here and ready to help.",
        },
      ]
      const result = toContentString(input)
      expect(result).toContain('"type":"output_text"')
      expect(result).toContain('"text":"I\'m just a friendly AI')
      expect(result).not.toBe('[object Object]')
    })

    it('should handle input_text format', () => {
      const input = [
        {
          type: 'input_text',
          text: 'Hello!',
        },
      ]
      expect(toContentString(input)).toBe('[{"type":"input_text","text":"Hello!"}]')
    })
  })

  describe('Anthropic format', () => {
    it('should handle text content blocks', () => {
      const input = [
        {
          type: 'text',
          text: 'Hello from Anthropic',
        },
      ]
      expect(toContentString(input)).toBe('[{"type":"text","text":"Hello from Anthropic"}]')
    })
  })

  describe('edge cases', () => {
    it('should handle objects with special characters in values', () => {
      const input = {
        message: 'Line 1\nLine 2\tTabbed',
        quote: 'He said "hello"',
      }
      const result = toContentString(input)
      expect(result).toContain('Line 1\\nLine 2\\tTabbed')
      expect(result).toContain('He said \\"hello\\"')
    })

    it('should handle arrays with mixed types', () => {
      const input = [1, 'two', { three: 3 }, null, true]
      expect(toContentString(input)).toBe('[1,"two",{"three":3},null,true]')
    })

    it('should handle functions by converting to undefined in JSON', () => {
      const input = { fn: () => {} }
      expect(toContentString(input)).toBe('{}')
    })

    it('should handle dates by converting to ISO string', () => {
      const date = new Date('2024-01-01T00:00:00.000Z')
      const input = { timestamp: date }
      expect(toContentString(input)).toBe('{"timestamp":"2024-01-01T00:00:00.000Z"}')
    })

    it('should handle circular references gracefully', () => {
      const obj: any = { name: 'test' }
      obj.self = obj // Create circular reference
      const result = toContentString(obj)
      expect(result).toBe('[object Object]') // Falls back to String()
    })

    it('should handle BigInt gracefully', () => {
      const input = { big: BigInt(9007199254740991) }
      const result = toContentString(input)
      expect(result).toBe('[object Object]') // Falls back to String()
    })
  })
})
