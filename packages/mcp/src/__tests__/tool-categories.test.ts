import { cacheToolCategories, readToolMetaCategory } from '../extensions/instrumentation'

describe('tool category auto-capture from _meta', () => {
  describe('readToolMetaCategory', () => {
    it('reads a string category from a tool _meta block', () => {
      expect(readToolMetaCategory({ category: 'Logs' })).toBe('Logs')
    })

    it('ignores missing, empty, and non-string categories', () => {
      expect(readToolMetaCategory(undefined)).toBeUndefined()
      expect(readToolMetaCategory({})).toBeUndefined()
      expect(readToolMetaCategory({ category: '' })).toBeUndefined()
      expect(readToolMetaCategory({ category: 42 })).toBeUndefined()
      expect(readToolMetaCategory('not-an-object')).toBeUndefined()
    })
  })

  describe('cacheToolCategories', () => {
    it('caches categories from a tools/list response, skipping undeclared tools', () => {
      const cache = new Map<string, string>()

      cacheToolCategories(cache, [
        { name: 'query-logs', inputSchema: { type: 'object' }, _meta: { category: 'Logs' } },
        { name: 'apm-trace-get', inputSchema: { type: 'object' }, _meta: { category: 'Tracing' } },
        { name: 'untagged-tool', inputSchema: { type: 'object' } },
      ])

      expect(cache.get('query-logs')).toBe('Logs')
      expect(cache.get('apm-trace-get')).toBe('Tracing')
      expect(cache.has('untagged-tool')).toBe(false)
    })

    it('no-ops on an undefined tools list', () => {
      const cache = new Map<string, string>()
      cacheToolCategories(cache, undefined)
      expect(cache.size).toBe(0)
    })
  })
})
