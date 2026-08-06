import { extend, migrateConfigField, stripEmptyProperties } from '../../src/utils/general-utils'

describe('general utils', () => {
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
            const warn = jest.fn()

            migrateConfigField({ oldField: 'old' }, 'newField', 'oldField', 'default', { warn })

            expect(warn).toHaveBeenCalledWith(expect.stringContaining("Config field 'oldField' is deprecated"))
        })
    })
})
