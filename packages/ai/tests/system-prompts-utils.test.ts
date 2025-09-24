/**
 * Tests for system prompt utility functions.
 *
 * This test suite specifically tests the utility functions that handle
 * system prompt extraction and formatting.
 */

import { formatOpenAIResponsesInput, mergeSystemPrompt } from '../src/utils'

describe('System Prompt Utility Functions', () => {
  const testSystemPrompt = 'You are a helpful AI assistant.'
  const testUserMessage = 'Hello, how are you?'

  describe('formatOpenAIResponsesInput', () => {
    test('should handle instructions parameter by converting to system message', () => {
      const input = [{ role: 'user', content: testUserMessage }]
      const instructions = testSystemPrompt

      const result = formatOpenAIResponsesInput(input, instructions)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'system',
        content: testSystemPrompt,
      })
      expect(result[1]).toEqual({
        role: 'user',
        content: testUserMessage,
      })
    })

    test('should handle input without instructions parameter', () => {
      const input = [{ role: 'user', content: testUserMessage }]

      const result = formatOpenAIResponsesInput(input)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        role: 'user',
        content: testUserMessage,
      })
    })

    test('should handle string input with instructions', () => {
      const input = testUserMessage
      const instructions = testSystemPrompt

      const result = formatOpenAIResponsesInput(input, instructions)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'system',
        content: testSystemPrompt,
      })
      expect(result[1]).toEqual({
        role: 'user',
        content: testUserMessage,
      })
    })

    test('should handle complex input objects', () => {
      const input = [{ role: 'user', content: 'First message' }, { text: 'Second message' }, 'Third message']
      const instructions = testSystemPrompt

      const result = formatOpenAIResponsesInput(input, instructions)

      expect(result).toHaveLength(4) // system + 3 user messages
      expect(result[0]).toEqual({
        role: 'system',
        content: testSystemPrompt,
      })
      expect(result[1]).toEqual({
        role: 'user',
        content: 'First message',
      })
      expect(result[2]).toEqual({
        role: 'user',
        content: 'Second message',
      })
      expect(result[3]).toEqual({
        role: 'user',
        content: 'Third message',
      })
    })
  })

  describe('mergeSystemPrompt', () => {
    test('should merge system parameter into messages for Anthropic', () => {
      const params = {
        messages: [{ role: 'user', content: testUserMessage }],
        system: testSystemPrompt,
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
      }

      const result = mergeSystemPrompt(params as any, 'anthropic')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        role: 'system',
        content: testSystemPrompt,
      })
      expect(result[1]).toEqual({
        role: 'user',
        content: testUserMessage,
      })
    })

    test('should return messages unchanged when no system parameter', () => {
      const params = {
        messages: [{ role: 'user', content: testUserMessage }],
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
      }

      const result = mergeSystemPrompt(params as any, 'anthropic')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        role: 'user',
        content: testUserMessage,
      })
    })

    test('should return messages unchanged for non-anthropic providers', () => {
      const params = {
        messages: [{ role: 'user', content: testUserMessage }],
        system: testSystemPrompt,
        model: 'gpt-4',
      }

      const result = mergeSystemPrompt(params as any, 'openai')

      expect(result).toEqual(params.messages)
    })
  })
})
