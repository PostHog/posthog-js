import { clampToRange } from '../../utils/number-utils'
import { logger } from '../../utils/logger'

jest.mock('../../utils/logger', () => ({
    logger: {
        warn: jest.fn(),
    },
}))

describe('number-utils', () => {
    describe('clampToRange', () => {
        it.each([
            [
                'returns max when value is not a number',
                {
                    value: null,
                    min: 10,
                    max: 100,
                    expected: 100,
                    fallback: undefined,
                },
            ],
            [
                'returns max when value is not a number',
                {
                    value: 'not-a-number',
                    min: 10,
                    max: 100,
                    expected: 100,
                    fallback: undefined,
                },
            ],
            [
                'returns max when value is greater than max',
                {
                    value: 150,
                    min: 10,
                    max: 100,
                    expected: 100,
                    fallback: undefined,
                },
            ],
            [
                'returns min when value is less than min',
                {
                    value: 5,
                    min: 10,
                    max: 100,
                    expected: 10,
                    fallback: undefined,
                },
            ],
            [
                'returns the value when it is within the range',
                {
                    value: 50,
                    min: 10,
                    max: 100,
                    expected: 50,
                    fallback: undefined,
                },
            ],
            [
                'returns the fallback value when provided is not valid',
                {
                    value: 'invalid',
                    min: 10,
                    max: 100,
                    expected: 20,
                    fallback: 20,
                },
            ],
            [
                'returns the max value when fallback is not valid',
                {
                    value: 'invalid',
                    min: 10,
                    max: 75,
                    expected: 75,
                    fallback: '20',
                },
            ],
        ])('%s', (_description, { value, min, max, expected, fallback }) => {
            const result = clampToRange(value, min, max, 'Test Label', fallback)
            expect(result).toBe(expected)
        })

        it('logs a warning when min is greater than max', () => {
            expect(clampToRange(50, 100, 10, 'Test Label')).toBe(10)
            expect(logger.warn).toHaveBeenCalledWith('min cannot be greater than max.')
        })
    })
})
