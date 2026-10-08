import { ClientRateLimiter } from '../src/rate-limiter'

describe('ClientRateLimiter', () => {
    it('admits the burst, reports one transition, and refills fractionally', () => {
        let now = 0
        const limiter = new ClientRateLimiter(10, 100, () => now)

        for (let index = 0; index < 100; index++) {
            expect(limiter.consume()).toEqual({ allowed: true })
        }
        expect(limiter.consume()).toEqual({ allowed: false, reportDropped: 1 })
        limiter.reported()
        expect(limiter.consume()).toEqual({ allowed: false })

        now = 100
        expect(limiter.consume()).toEqual({ allowed: true })
        expect(limiter.consume()).toEqual({ allowed: false, reportDropped: 2 })
    })

    it('contains hostile and backward clocks', () => {
        let now = 1_000
        let throws = false
        const limiter = new ClientRateLimiter(1, 1, () => {
            if (throws) {
                throw new Error('clock failed')
            }
            return now
        })

        expect(limiter.consume()).toEqual({ allowed: true })
        now = 0
        expect(limiter.consume()).toMatchObject({ allowed: false })
        throws = true
        expect(() => limiter.consume()).not.toThrow()
    })
})
