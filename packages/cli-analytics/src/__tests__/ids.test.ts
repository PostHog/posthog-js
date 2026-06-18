import { deterministicPrefixedId, newPrefixedId } from '../extensions/ids'

describe('ids', () => {
    it('prefixes generated ids', () => {
        expect(newPrefixedId('evt')).toMatch(/^evt_/)
        expect(newPrefixedId('ses')).toMatch(/^ses_/)
        expect(newPrefixedId('anon')).toMatch(/^anon_/)
    })

    it('generates unique ids', () => {
        const ids = new Set(Array.from({ length: 100 }, () => newPrefixedId('evt')))
        expect(ids.size).toBe(100)
    })

    it('derives a stable 32-hex id from an input', () => {
        const id = deterministicPrefixedId('ses', 'mcp-session-123')
        expect(id).toMatch(/^ses_[0-9a-f]{32}$/)
        expect(deterministicPrefixedId('ses', 'mcp-session-123')).toBe(id)
    })

    it('produces different ids for different inputs', () => {
        expect(deterministicPrefixedId('ses', 'a')).not.toBe(deterministicPrefixedId('ses', 'b'))
    })
})
