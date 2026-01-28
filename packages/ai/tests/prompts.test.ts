import { Prompts } from '../src/prompts'
import type { PromptApiResponse } from '../src/types'

// Mock fetch globally
const mockFetch = jest.fn()
global.fetch = mockFetch

// Mock console.warn to capture warnings
const originalWarn = console.warn
let consoleWarnSpy: jest.SpyInstance

describe('Prompts', () => {
  const mockPromptResponse: PromptApiResponse = {
    id: 1,
    name: 'test-prompt',
    prompt: 'Hello, {{name}}! You are a helpful assistant for {{company}}.',
    version: 1,
    created_by: 'user@example.com',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    deleted: false,
  }

  const createMockPostHog = (options: { personalApiKey?: string; host?: string } = {}) => {
    return {
      options: {
        personalApiKey: 'personalApiKey' in options ? options.personalApiKey : 'phx_test_key',
        host: options.host ?? 'https://us.i.posthog.com',
      },
    } as any
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.useRealTimers()
    consoleWarnSpy.mockRestore()
    console.warn = originalWarn
  })

  describe('get()', () => {
    it('should successfully fetch a prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = await prompts.get('test-prompt')

      expect(result).toBe(mockPromptResponse.prompt)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://us.i.posthog.com/api/projects/@current/llm_prompts/name/test-prompt/',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer phx_test_key',
            'Content-Type': 'application/json',
          },
        }
      )
    })

    it('should return cached prompt when fresh', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      // First call - fetches from API
      const result1 = await prompts.get('test-prompt', { cacheTtlSeconds: 300 })
      expect(result1).toBe(mockPromptResponse.prompt)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time by 60 seconds (still within TTL)
      jest.advanceTimersByTime(60 * 1000)

      // Second call - should use cache
      const result2 = await prompts.get('test-prompt', { cacheTtlSeconds: 300 })
      expect(result2).toBe(mockPromptResponse.prompt)
      expect(mockFetch).toHaveBeenCalledTimes(1) // No additional fetch
    })

    it('should refetch when cache is stale', async () => {
      const updatedPromptResponse = {
        ...mockPromptResponse,
        prompt: 'Updated prompt: Hello, {{name}}!',
      }

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPromptResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(updatedPromptResponse),
        })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      // First call - fetches from API
      const result1 = await prompts.get('test-prompt', { cacheTtlSeconds: 60 })
      expect(result1).toBe(mockPromptResponse.prompt)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past TTL
      jest.advanceTimersByTime(61 * 1000)

      // Second call - should refetch
      const result2 = await prompts.get('test-prompt', { cacheTtlSeconds: 60 })
      expect(result2).toBe(updatedPromptResponse.prompt)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should use stale cache on fetch failure with warning', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPromptResponse),
        })
        .mockRejectedValueOnce(new Error('Network error'))

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      // First call - populates cache
      const result1 = await prompts.get('test-prompt', { cacheTtlSeconds: 60 })
      expect(result1).toBe(mockPromptResponse.prompt)

      // Advance time past TTL
      jest.advanceTimersByTime(61 * 1000)

      // Second call - should use stale cache
      const result2 = await prompts.get('test-prompt', { cacheTtlSeconds: 60 })
      expect(result2).toBe(mockPromptResponse.prompt)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch prompt "test-prompt", using stale cache:'),
        expect.any(Error)
      )
    })

    it('should use fallback when no cache and fetch fails with warning', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const fallback = 'Default system prompt.'
      const result = await prompts.get('test-prompt', { fallback })

      expect(result).toBe(fallback)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch prompt "test-prompt", using fallback:'),
        expect.any(Error)
      )
    })

    it('should throw when no cache, no fallback, and fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      await expect(prompts.get('test-prompt')).rejects.toThrow('Network error')
    })

    it('should handle 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      await expect(prompts.get('nonexistent-prompt')).rejects.toThrow(
        '[PostHog Prompts] Prompt "nonexistent-prompt" not found'
      )
    })

    it('should handle 403 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      await expect(prompts.get('restricted-prompt')).rejects.toThrow(
        '[PostHog Prompts] Access denied for prompt "restricted-prompt"'
      )
    })

    it('should throw when no personalApiKey is configured', async () => {
      const posthog = createMockPostHog({ personalApiKey: undefined })
      const prompts = new Prompts({ posthog })

      await expect(prompts.get('test-prompt')).rejects.toThrow(
        '[PostHog Prompts] personalApiKey is required to fetch prompts'
      )
    })

    it('should throw when API returns invalid response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ invalid: 'response' }),
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      await expect(prompts.get('test-prompt')).rejects.toThrow(
        '[PostHog Prompts] Invalid response format for prompt "test-prompt"'
      )
    })

    it('should use custom host from PostHog options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const posthog = createMockPostHog({ host: 'https://eu.i.posthog.com' })
      const prompts = new Prompts({ posthog })

      await prompts.get('test-prompt')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://eu.i.posthog.com/api/projects/@current/llm_prompts/name/test-prompt/',
        expect.any(Object)
      )
    })

    it('should use default cache TTL when not specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      // First call
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time by 4 minutes (within default 5-minute TTL)
      jest.advanceTimersByTime(4 * 60 * 1000)

      // Second call - should use cache
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past 5-minute TTL
      jest.advanceTimersByTime(2 * 60 * 1000)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      // Third call - should refetch
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should use custom default cache TTL from constructor', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog, defaultCacheTtlSeconds: 60 })

      // First call
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past custom TTL
      jest.advanceTimersByTime(61 * 1000)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      // Second call - should refetch
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should URL-encode prompt names with special characters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      await prompts.get('prompt with spaces/and/slashes')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://us.i.posthog.com/api/projects/@current/llm_prompts/name/prompt%20with%20spaces%2Fand%2Fslashes/',
        expect.any(Object)
      )
    })

    it('should work with direct options (no PostHog client)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const prompts = new Prompts({
        personalApiKey: 'phx_direct_key',
      })

      const result = await prompts.get('test-prompt')

      expect(result).toBe(mockPromptResponse.prompt)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://us.i.posthog.com/api/projects/@current/llm_prompts/name/test-prompt/',
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer phx_direct_key',
            'Content-Type': 'application/json',
          },
        }
      )
    })

    it('should use custom host from direct options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const prompts = new Prompts({
        personalApiKey: 'phx_direct_key',
        host: 'https://eu.i.posthog.com',
      })

      await prompts.get('test-prompt')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://eu.i.posthog.com/api/projects/@current/llm_prompts/name/test-prompt/',
        expect.any(Object)
      )
    })

    it('should use custom default cache TTL from direct options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      const prompts = new Prompts({
        personalApiKey: 'phx_direct_key',
        defaultCacheTtlSeconds: 60,
      })

      // First call
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past custom TTL
      jest.advanceTimersByTime(61 * 1000)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockPromptResponse),
      })

      // Second call - should refetch
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('compile()', () => {
    it('should replace a single variable', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('Hello, {{name}}!', { name: 'World' })

      expect(result).toBe('Hello, World!')
    })

    it('should replace multiple variables', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('Hello, {{name}}! Welcome to {{company}}. Your tier is {{tier}}.', {
        name: 'John',
        company: 'Acme Corp',
        tier: 'premium',
      })

      expect(result).toBe('Hello, John! Welcome to Acme Corp. Your tier is premium.')
    })

    it('should handle numbers', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('You have {{count}} items.', { count: 42 })

      expect(result).toBe('You have 42 items.')
    })

    it('should handle booleans', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('Feature enabled: {{enabled}}', { enabled: true })

      expect(result).toBe('Feature enabled: true')
    })

    it('should leave unmatched variables unchanged', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('Hello, {{name}}! Your {{unknown}} is ready.', { name: 'World' })

      expect(result).toBe('Hello, World! Your {{unknown}} is ready.')
    })

    it('should handle prompts with no variables', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('You are a helpful assistant.', {})

      expect(result).toBe('You are a helpful assistant.')
    })

    it('should handle empty variables object', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('Hello, {{name}}!', {})

      expect(result).toBe('Hello, {{name}}!')
    })

    it('should handle multiple occurrences of the same variable', () => {
      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      const result = prompts.compile('Hello, {{name}}! Goodbye, {{name}}!', { name: 'World' })

      expect(result).toBe('Hello, World! Goodbye, World!')
    })
  })

  describe('clearCache()', () => {
    it('should clear a specific prompt from cache', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPromptResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...mockPromptResponse, name: 'other-prompt' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPromptResponse),
        })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      // Populate cache with two prompts
      await prompts.get('test-prompt')
      await prompts.get('other-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Clear only test-prompt
      prompts.clearCache('test-prompt')

      // test-prompt should be refetched
      await prompts.get('test-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(3)

      // other-prompt should still be cached
      await prompts.get('other-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should clear all prompts from cache when no name is provided', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPromptResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...mockPromptResponse, name: 'other-prompt' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockPromptResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...mockPromptResponse, name: 'other-prompt' }),
        })

      const posthog = createMockPostHog()
      const prompts = new Prompts({ posthog })

      // Populate cache with two prompts
      await prompts.get('test-prompt')
      await prompts.get('other-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Clear all cache
      prompts.clearCache()

      // Both prompts should be refetched
      await prompts.get('test-prompt')
      await prompts.get('other-prompt')
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })
  })
})
