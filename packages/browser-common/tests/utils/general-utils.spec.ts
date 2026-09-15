import { runInNewContext } from 'node:vm'
import {
    _copyAndTruncateStrings,
    extend,
    migrateConfigField,
    stripEmptyProperties,
    trySafe,
} from '../../src/utils/general-utils'

describe('general utils', () => {
    it('keeps trySafe available from the general utils export', () => {
        expect(trySafe(() => false)).toBe(false)
        expect(
            trySafe(() => {
                throw new Error('unavailable')
            })
        ).toBeUndefined()
    })

    describe('_copyAndTruncateStrings', () => {
        it.each([
            ['same-realm', () => new TypeError('long error message')],
            ['cross-realm', () => runInNewContext('new TypeError("long error message")') as Error],
        ])('preserves and truncates %s Error details without mutating inputs', (_realm, createError) => {
            const error = Object.assign(createError(), { code: 'long custom code' })
            const stack = error.stack

            expect(_copyAndTruncateStrings({ nested: [{ error }] }, 10)).toEqual({
                nested: [
                    {
                        error: {
                            name: 'TypeError',
                            message: 'long error',
                            stack: stack?.slice(0, 10),
                            code: 'long custo',
                        },
                    },
                ],
            })
            expect(error.message).toBe('long error message')
            expect(error.stack).toBe(stack)
            expect(Object.keys(error)).toEqual(['code'])
        })

        it('preserves causes and aggregate errors while truncating nested strings', () => {
            const cause = new Error('root cause')
            const error = new AggregateError([new Error('nested error'), 'other reason'], 'aggregate', { cause })

            expect(_copyAndTruncateStrings({ error }, 5)).toEqual({
                error: {
                    name: 'Aggre',
                    message: 'aggre',
                    stack: error.stack?.slice(0, 5),
                    cause: { name: 'Error', message: 'root ', stack: cause.stack?.slice(0, 5) },
                    errors: [{ name: 'Error', message: 'neste', stack: error.errors[0].stack.slice(0, 5) }, 'other'],
                },
            })
        })

        it('omits circular causes without dropping other Error details', () => {
            const error = new Error('circular')
            Object.defineProperty(error, 'cause', { value: error })

            expect(_copyAndTruncateStrings({ error }, 1000)).toEqual({
                error: { name: error.name, message: error.message, stack: error.stack?.slice(0, 1000) },
            })
        })

        it.each(['name', 'message', 'stack', 'cause', 'errors'] as const)(
            'omits an unreadable Error %s without discarding sibling properties',
            (detail) => {
                const error = Object.assign(new Error('additional'), { code: 'E_TEST' })
                error.stack = 'safe stack'
                const expected: Record<string, unknown> = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    code: error.code,
                }
                delete expected[detail]
                Object.defineProperty(error, detail, {
                    get: () => {
                        throw new Error('unreadable')
                    },
                })

                expect(_copyAndTruncateStrings({ error, kept: true }, 100)).toEqual({ error: expected, kept: true })
            }
        )
    })

    describe('extend', () => {
        it('overwrites existing values but preserves existing values when source is undefined', () => {
            expect(extend({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
            expect(extend({ a: 1 }, { a: undefined })).toEqual({ a: 1 })
        })

        it('keeps falsy defined values', () => {
            expect(extend({ a: 1, b: true, c: 'valid' }, { a: 0, b: false, c: '' })).toEqual({
                a: 0,
                b: false,
                c: '',
            })
        })
    })

    describe('stripEmptyProperties', () => {
        it('keeps non-empty strings and numbers', () => {
            expect(stripEmptyProperties({ a: 'value', b: '', c: 0, d: false, e: null })).toEqual({
                a: 'value',
                c: 0,
            })
        })
    })

    describe('migrateConfigField', () => {
        it('prefers the new field and falls back to the old field', () => {
            expect(migrateConfigField({ newField: 'new', oldField: 'old' }, 'newField', 'oldField', 'default')).toBe(
                'new'
            )
            expect(migrateConfigField({ oldField: 'old' }, 'newField', 'oldField', 'default')).toBe('old')
            expect(migrateConfigField({}, 'newField', 'oldField', 'default')).toBe('default')
        })

        it('warns when using the old field', () => {
            const warn = vi.fn()

            migrateConfigField({ oldField: 'old' }, 'newField', 'oldField', 'default', { warn })

            expect(warn).toHaveBeenCalledWith(expect.stringContaining("Config field 'oldField' is deprecated"))
        })
    })
})
