import {
    EvaluationItem,
    EvaluationResult,
    type EvaluationItemOptions,
    type EvaluationResultOptions,
} from '../../src/evaluations'
import { bytes, count, decode, encode, json, timestamp } from '../../src/evaluations/serialization'
import { ITEM, VERSION } from './helpers'
const result = (options: Record<string, unknown> = {}) =>
    new EvaluationResult({ item: ITEM, scorerVersionId: VERSION, value: false, ...options } as EvaluationResultOptions)

describe('immutable declarations and JavaScript JSON edge cases', () => {
    it('Saved declarations survive process reconstruction', () => {
        const input = { nested: [false, 0, null, ''] }
        const item = new EvaluationItem({ id: ITEM, input })
        const original = new EvaluationResult({ item, scorerVersionId: VERSION, value: ['b', 'a'] })
        const savedItem = item.toJSON(),
            savedResult = original.toJSON()
        const restoredItem = EvaluationItem.fromJSON(savedItem)
        const restored = EvaluationResult.fromJSON(savedResult, { item: restoredItem })
        input.nested.push('mutated')
        ;(savedItem.payload as Record<string, unknown>).input = 'mutated'
        savedResult.value = false
        expect(restored.item).toBe(restoredItem)
        expect(restored.toJSON().value).toEqual(['a', 'b'])
        expect(restoredItem.toJSON()).toEqual(item.toJSON())
        expect(() => EvaluationResult.fromJSON(original.toJSON(), { item: new EvaluationItem() })).toThrow()
        expect(() => EvaluationItem.fromJSON({ input: 'missing id' })).toThrow()
        expect(() => Object.assign(item, { id: VERSION })).toThrow()
    })
    it('Missing and null payload values differ', () => {
        expect(new EvaluationItem().toJSON()).not.toHaveProperty('payload')
        expect(new EvaluationItem({ payload: {} }).toJSON().payload).toEqual({})
        expect(new EvaluationItem({ output: null }).toJSON().payload).toEqual({ output: null })
        expect(new EvaluationItem({ input: undefined }).toJSON()).not.toHaveProperty('payload')
        expect(() => new EvaluationItem({ payload: {}, input: null } as unknown as EvaluationItemOptions)).toThrow()
    })
    it.each([
        undefined,
        NaN,
        Infinity,
        -Infinity,
        1n,
        () => 1,
        Symbol('x'),
        new Date(),
        new Map(),
        new Set(),
        new Uint8Array(1),
        /x/,
        Object.create({ inherited: 1 }),
    ])('rejects unsupported payload value %#', (value) => {
        expect(() => new EvaluationItem({ payload: { input: value } } as EvaluationItemOptions)).toThrow(TypeError)
    })
    it.each(['\u0000', '\ud800', '\udfff', 'ok\ud800end'])('rejects invalid Unicode %#', (value) => {
        expect(() => new EvaluationItem({ input: value })).toThrow(TypeError)
        expect(() => new EvaluationItem({ input: { [value]: 1 } })).toThrow(TypeError)
    })
    it('rejects cycles, holes, symbols, accessors, and toJSON coercion without invoking getters', () => {
        const cycle: unknown[] = []
        cycle.push(cycle)
        const getter = vi.fn(() => 'secret')
        const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter })
        for (const value of [cycle, new Array(2), accessor, { [Symbol('key')]: 1 }, { toJSON: getter }])
            expect(() => json(value)).toThrow()
        expect(getter).not.toHaveBeenCalled()
    })
    it('Invalid payloads fail locally', () => {
        expect(() => new EvaluationItem({ input: NaN })).toThrow()
        expect(() => new EvaluationItem({ payload: { invalid: true } } as unknown as EvaluationItemOptions)).toThrow()
        expect(() => new EvaluationItem({ metadata: [] } as unknown as EvaluationItemOptions)).toThrow()
    })
    it('enforces the real 32-container and UTF-8 payload limits', () => {
        let nested: unknown = 'leaf'
        for (let i = 0; i < 31; i++) nested = [nested]
        expect(() => new EvaluationItem({ input: nested } as EvaluationItemOptions)).not.toThrow()
        expect(() => new EvaluationItem({ input: [nested] } as EvaluationItemOptions)).toThrow()
        const overhead = bytes('{"input":""}')
        expect(() => new EvaluationItem({ input: 'x'.repeat(1024 * 1024 - overhead) })).not.toThrow()
        expect(() => new EvaluationItem({ input: 'é'.repeat(512 * 1024) })).toThrow()
        expect(() => result({ reasoning: 'x'.repeat(256 * 1024) })).toThrow()
    })
    it('preserves prototype-shaped user keys without prototype pollution', () => {
        const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":0}')
        expect(new EvaluationItem({ input }).toJSON().payload).toEqual({ input })
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
    it('A false score is still a successful evaluator outcome', () => {
        expect(result().toJSON()).toMatchObject({ status: 'ok', value: false })
    })
    it.each(['error', 'skipped', 'not_applicable'])('A non-ok outcome cannot carry a score: %s', (status) => {
        expect(() => result({ status, value: 0 })).toThrow()
        expect(result({ status, value: undefined }).toJSON()).not.toHaveProperty('value')
    })
    it.each([null, undefined, NaN, Infinity, [], ['a', 'a'], [''], [1], 'pass', 9007199254740992, 9007199254740993n])(
        'rejects invalid score %#',
        (value) => expect(() => result({ value })).toThrow()
    )
    it.each([9007199254740992n, 9007199254740994n, 2n ** 100n, -(2n ** 100n)])(
        'supports exact large Python integer score %s',
        (value) => {
            const declaration = result({ value })
            expect(declaration.toJSON().value).toBe(Number(value))
            expect(EvaluationResult.fromJSON(declaration.toJSON()).toJSON()).toEqual(declaration.toJSON())
        }
    )
    it('Numeric score precision cannot be silently lost', () => {
        expect(() => result({ value: 9007199254740993n })).toThrow()
        expect(() => result({ value: Number('9007199254740993') })).toThrow()
    })
    it.each([
        { errorCode: 'bad' },
        { errorMessage: 'bad' },
        { status: 'skipped', value: undefined, errorMessage: 'bad' },
    ])('restricts error fields %#', (options) => expect(() => result(options)).toThrow())
    it('normalizes timestamps without losing Python microseconds', () => {
        expect(timestamp('2026-10-02T14:00:00.123456+02:00')).toBe('2026-10-02T12:00:00.123456Z')
        for (const value of [
            '2026-10-02',
            '2026-10-02T12:00:00',
            '2026-02-30T00:00:00Z',
            '2026-01-01T24:00:00Z',
            new Date(NaN),
        ])
            expect(() => timestamp(value)).toThrow()
    })
    it('round trips int64 counts and JSON punctuation without changing strings or prototypes', () => {
        const value = {
            count: 9223372036854775807n,
            nested: ['9223372036854775807', 'quote"\\\n', false, null, -1.25, []],
            '__proto__': null,
        }
        expect(decode(encode(value))).toEqual(value)
        expect(count(9223372036854775807n)).toBe(9223372036854775807n)
        expect(count(1n)).toBe(1)
        for (const bad of [-1, -1n, 9223372036854775808n, 9007199254740992, true, 1.5])
            expect(() => count(bad)).toThrow()
        for (const bad of ['', '{', '[1,]', '{"a":NaN}', 'true false']) expect(() => decode(bad)).toThrow()
    })
})

it('rejects huge sparse arrays before allocating a copy and rejects non-index array keys', () => {
    const huge = new Array(2 ** 32 - 1)
    expect(() => new EvaluationItem({ input: huge })).toThrow('Sparse')
    const array: unknown[] = []
    Object.defineProperty(array, '4294967295', { value: 1, enumerable: true })
    expect(() => json(array)).toThrow('Unexpected')
})
