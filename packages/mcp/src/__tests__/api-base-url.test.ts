import { PostHogMCP } from '../extensions/client'
import type { MCPAnalyticsOptions } from '../types'

describe('MCPAnalyticsOptions host', () => {
  it('should accept host as an optional string property', () => {
    const options: MCPAnalyticsOptions = {
      host: 'https://custom.example.com',
    }
    expect(options.host).toBe('https://custom.example.com')
  })

  it('should be undefined when not set', () => {
    const options: MCPAnalyticsOptions = {}
    expect(options.host).toBeUndefined()
  })
})

describe('PostHogMCP construction', () => {
  it('reports the library id and version on the client', () => {
    const client = new PostHogMCP('phc_test')
    expect(client.getLibraryId()).toBe('posthog-mcp')
    expect(client.getLibraryVersion()).toMatch(/^\d+\.\d+\.\d+/)
    expect(client.getCustomUserAgent()).toBe(`posthog-mcp/${client.getLibraryVersion()}`)
  })

  it('accepts a custom host without throwing', () => {
    expect(() => new PostHogMCP('phc_test', { host: 'https://custom.example.com' })).not.toThrow()
  })

  it('accepts no host (defaults to the US ingestion host)', () => {
    expect(() => new PostHogMCP('phc_test')).not.toThrow()
  })
})
