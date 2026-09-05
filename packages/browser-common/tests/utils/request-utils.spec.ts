import {
    _getHashParam,
    formDataToQuery,
    getQueryParam,
    jsonStringify,
    maskQueryParams,
} from '../../src/utils/request-utils'

describe('request utils', () => {
    describe('jsonStringify', () => {
        it('serializes bigint values as strings', () => {
            expect(jsonStringify({ count: BigInt(42) })).toBe('{"count":"42"}')
        })

        it('serializes Error details and enumerable custom fields, including shared references', () => {
            const error = Object.assign(new TypeError('additional error'), { code: 'E_TEST', count: BigInt(42) })
            const expected = {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: 'E_TEST',
                count: '42',
            }

            expect(JSON.parse(jsonStringify({ error, nested: [error] }))).toEqual({
                error: expected,
                nested: [expected],
            })
            expect(Object.keys(error)).toEqual(['code', 'count'])
        })

        it.each(['name', 'message', 'stack'] as const)(
            'omits an unreadable non-enumerable Error %s without discarding sibling properties',
            (detail) => {
                const error = Object.assign(new Error('additional'), { code: 'E_TEST' })
                // Avoid lazy stack formatting reading name/message while testing each getter independently.
                error.stack = 'safe stack'
                const expected: Record<string, unknown> = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    code: error.code,
                }
                delete expected[detail]
                const getter = vi.fn(() => {
                    throw new Error(`unreadable ${detail}`)
                })
                Object.defineProperty(error, detail, { enumerable: false, get: getter })

                expect(JSON.parse(jsonStringify({ error, shared: error, kept: true }))).toEqual({
                    error: expected,
                    shared: expected,
                    kept: true,
                })
                expect(getter).toHaveBeenCalledTimes(1)
                expect(Object.getOwnPropertyDescriptor(error, detail)?.get).toBe(getter)
            }
        )

        it('preserves ordinary JSON values and formatting', () => {
            const value = {
                date: new Date('2025-01-02T03:04:05.000Z'),
                invalidDate: new Date(NaN),
                array: [true, null, undefined, NaN, () => undefined, Symbol('test')],
                nested: { value: 'kept', missing: undefined },
            }
            expect(jsonStringify(value, 2)).toBe(JSON.stringify(value, null, 2))
        })

        it('preserves native toJSON semantics and formatting', () => {
            class ErrorWithToJSON extends Error {
                toJSON(key: string) {
                    return { key, message: this.message }
                }
            }
            const date = new Date('2025-01-02T03:04:05.000Z')
            date.toJSON = () => 'custom date'
            const value = { error: new ErrorWithToJSON('custom error'), date, nested: [true, null, undefined] }

            expect(jsonStringify(value, 2)).toBe(JSON.stringify(value, null, 2))
        })

        it('retains the existing fallback for circular Errors without repeatedly copying them', () => {
            const error = new Error('circular error')
            const getSelf = vi.fn(() => error)
            Object.defineProperty(error, 'self', { enumerable: true, get: getSelf })

            expect(JSON.parse(jsonStringify({ error }))).toEqual({
                error: { name: error.name, message: error.message, stack: error.stack },
            })
            expect(getSelf.mock.calls.length).toBeLessThanOrEqual(2)
        })

        it('keeps the existing fallback behavior for throwing getters and toJSON', () => {
            const error = new Error('additional error')
            Object.defineProperty(error, 'custom', {
                enumerable: true,
                get() {
                    throw new Error('cannot read custom property')
                },
            })
            // The existing circular-safe fallback can still serialize Error details.
            expect(JSON.parse(jsonStringify({ error }))).toEqual({
                error: { name: error.name, message: error.message, stack: error.stack },
            })
            expect(() =>
                jsonStringify({
                    toJSON() {
                        throw new Error('cannot serialize')
                    },
                })
            ).toThrow('cannot serialize')
        })

        it('falls back to circular-safe serialization', () => {
            const value: Record<string, any> = { name: 'root' }
            value.self = value

            expect(jsonStringify(value)).toBe('{"name":"root","self":"[Circular]"}')
        })
    })

    describe('formDataToQuery', () => {
        it('builds a query string from an object', () => {
            expect(formDataToQuery({ x: 'y', a: 'b' })).toBe('x=y&a=b')
        })

        it('skips undefined values and undefined keys', () => {
            expect(formDataToQuery({ x: 'y', a: undefined, undefined: 'c' })).toBe('x=y')
        })

        it('handles FormData', () => {
            const formData = new FormData()
            formData.append('x', 'y')
            formData.append('a', 'b')

            expect(formDataToQuery(formData)).toBe('x=y&a=b')
        })
    })

    describe('getQueryParam', () => {
        it('gets and decodes a query param', () => {
            expect(getQueryParam('https://example.com/?q=hello%20world&x=y', 'q')).toBe('hello world')
        })

        it('handles plus as spaces and ignores hash params', () => {
            expect(getQueryParam('https://example.com/?q=hello+world#q=ignored', 'q')).toBe('hello world')
        })

        it('returns empty string for missing params', () => {
            expect(getQueryParam('https://example.com/?x=y', 'q')).toBe('')
        })
    })

    describe('maskQueryParams', () => {
        it('masks selected query params while preserving order and hash', () => {
            expect(
                maskQueryParams('https://example.com/?token=secret&x=y&token=again#section', ['token'], '<redacted>')
            ).toBe('https://example.com/?token=<redacted>&x=y&token=<redacted>#section')
        })

        it('returns the original value when there is nothing to mask', () => {
            expect(maskQueryParams('https://example.com/?token=secret', [], '<redacted>')).toBe(
                'https://example.com/?token=secret'
            )
            expect(maskQueryParams(undefined, ['token'], '<redacted>')).toBeUndefined()
        })
    })

    describe('_getHashParam', () => {
        it('extracts hash params', () => {
            expect(_getHashParam('#access_token=abc&state=xyz', 'access_token')).toBe('abc')
        })
    })
})
