import { some } from '../../utils'

describe('utils/index', () => {
    describe('some', () => {
        it('should iterate over an array', () => {
            expect(some([1, 2, 3], (x) => x === 2)).toBe(true)
            expect(some([1, 2, 3], (x) => x === 4)).toBe(false)
        })
        it('should short circuit when a match is found', () => {
            const spy = jest.fn()
            some([1, 2, 3], (x) => {
                spy()
                return x === 2
            })
            expect(spy).toHaveBeenCalledTimes(2)
        })
    })
})
