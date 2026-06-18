import { MAX_EVENT_BYTES, MAX_STRING_LENGTH, normalize, truncateEvent } from '../extensions/truncation'
import { CliAnalyticsEventType } from '../extensions/event-types'
import type { CliEvent } from '../types'

describe('normalize', () => {
    it('truncates over-long strings', () => {
        const result = normalize('x'.repeat(MAX_STRING_LENGTH + 100)) as string
        expect(result.endsWith('...')).toBe(true)
        expect(result.length).toBe(MAX_STRING_LENGTH + 3)
    })

    it('coerces non-serializable values', () => {
        expect(normalize(undefined)).toBe('[undefined]')
        expect(normalize(Number.NaN)).toBe('[NaN]')
        expect(normalize(Number.POSITIVE_INFINITY)).toBe('[Infinity]')
        expect(normalize(() => 1)).toMatch(/^\[Function:/)
        expect(normalize(10n)).toBe('[BigInt: 10]')
    })

    it('breaks circular references', () => {
        const obj: Record<string, unknown> = { name: 'root' }
        obj.self = obj
        const result = normalize(obj) as Record<string, unknown>
        expect(result.name).toBe('root')
        expect(result.self).toBe('[Circular ~]')
    })

    it('bounds depth', () => {
        const deep = { a: { b: { c: { d: { e: 1 } } } } }
        expect(normalize(deep, 2)).toEqual({ a: { b: '[Object]' } })
    })
})

describe('truncateEvent', () => {
    function event(overrides: Partial<CliEvent>): CliEvent {
        return { eventType: CliAnalyticsEventType.cliCommandRun, command: 'deploy', ...overrides }
    }

    it('caps intent length', () => {
        const result = truncateEvent(event({ intent: 'i'.repeat(5000) }))
        expect((result.intent as string).length).toBe(2048 + 3)
    })

    it('caps the flags array length', () => {
        const flags = Array.from({ length: 250 }, (_, i) => `--flag-${i}`)
        const result = truncateEvent(event({ flags }))
        expect(result.flags).toHaveLength(100)
    })

    it('shrinks an oversized event under the byte budget', () => {
        const result = truncateEvent(event({ properties: { blob: 'z'.repeat(MAX_EVENT_BYTES * 3) } }))
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MAX_EVENT_BYTES + 1024)
    })
})
