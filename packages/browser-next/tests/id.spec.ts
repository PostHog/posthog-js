import { createId, createTimeId } from '../src/primitives/id'

describe('createId', () => {
    it('returns a UUID when browser randomness throws', () => {
        const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
        const random = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('randomness unavailable')
        })
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                randomUUID() {
                    throw new Error('randomUUID unavailable')
                },
                getRandomValues() {
                    throw new Error('getRandomValues unavailable')
                },
            },
        })

        try {
            const first = createId()
            const second = createId()
            expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
            expect(second).not.toBe(first)
        } finally {
            random.mockRestore()
            if (cryptoDescriptor) {
                Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
            } else {
                delete (globalThis as { crypto?: Crypto }).crypto
            }
        }
    })
})

describe('createTimeId', () => {
    it('returns a UUIDv7 that encodes the timestamp', () => {
        const timestamp = Date.UTC(2026, 10, 20, 12, 0, 0, 123)
        const id = createTimeId(timestamp)
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(timestamp)
    })

    it('encodes an invalid timestamp as zero', () => {
        expect(createTimeId(Number.NaN).slice(0, 13)).toBe('00000000-0000')
    })
})
