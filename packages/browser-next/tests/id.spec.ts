import { createId } from '../src/id'

describe('createId', () => {
    it('returns a UUID when browser randomness throws', () => {
        const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
        const random = jest.spyOn(Math, 'random').mockImplementation(() => {
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
