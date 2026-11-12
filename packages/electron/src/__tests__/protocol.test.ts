import { describe, expect, it } from 'vitest'
import { MAX_MESSAGE_BYTES, trustedUrl, validateRequest } from '../shared/protocol'

const request = (command: unknown) => ({ version: 1, sequence: 1, generation: 0, command })

describe('Electron bridge protocol', () => {
    it('accepts only the supported commands and JSON properties', () => {
        expect(() =>
            validateRequest(request({ type: 'capture', event: 'clicked', properties: { count: 1 } }))
        ).not.toThrow()
        for (const command of [
            { type: 'capture', event: '$snapshot' },
            { type: 'capture', event: '$exception' },
            { type: 'capture', event: '' },
            { type: 'identify', distinctId: ' ' },
            { type: 'capture', event: 'clicked', properties: { bad: Infinity } },
            { type: 'request', url: 'https://evil.example' },
            { type: 'startSessionRecording' },
        ])
            expect(() => validateRequest(request(command))).toThrow()
    })
    it('rejects oversized, cyclic, deep and prototype-poisoning inputs', () => {
        expect(() =>
            validateRequest(
                request({ type: 'capture', event: 'x', properties: { text: 'x'.repeat(MAX_MESSAGE_BYTES) } })
            )
        ).toThrow('256 KiB')
        const cyclic: Record<string, unknown> = {}
        cyclic.self = cyclic
        expect(() => validateRequest(request({ type: 'register', properties: cyclic }))).toThrow()
        expect(() =>
            validateRequest(request({ type: 'register', properties: JSON.parse('{"__proto__":{"polluted":true}}') }))
        ).toThrow('Unsafe')
        expect(() => validateRequest({ ...request({ type: 'hello' }), sequence: 0 })).toThrow('Invalid')
        expect(() => validateRequest({ ...request({ type: 'hello' }), version: 2 })).toThrow('Invalid')
    })
    it('matches exact file and remote URLs rather than trusting opaque or shared origins', () => {
        expect(trustedUrl('file:///app/index.html#settings', ['file:///app/index.html'])).toBe(true)
        expect(trustedUrl('file:///tmp/evil.html', ['file:///app/index.html'])).toBe(false)
        expect(trustedUrl('https://app.example.evil/page', ['https://app.example/page'])).toBe(false)
        expect(trustedUrl('https://app.example/other', ['https://app.example/page'])).toBe(false)
        expect(trustedUrl('bad URL', ['https://app.example/page'])).toBe(false)
    })
})
