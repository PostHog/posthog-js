import {
    personPropertyNames,
    shouldProcessPerson,
    snapshotPersonProfileMode,
    snapshotPersonProperties,
} from '../src/products/analytics/properties/person-processing'
import type { PersonProfileMode } from '../src/products/analytics/analytics-options'

describe('person processing policy', () => {
    it.each([undefined, null, '', 'invalid', 'identified_only'])(
        'defaults an unavailable or unrecognized mode to identified_only: %j',
        (value) => {
            expect(snapshotPersonProfileMode(() => value)).toBe('identified_only')
        }
    )

    it('contains a throwing mode getter', () => {
        expect(
            snapshotPersonProfileMode(() => {
                throw new Error('unavailable')
            })
        ).toBe('identified_only')
    })

    it.each<PersonProfileMode>(['always', 'never', 'identified_only'])(
        'selects processing from mode, identity, groups and explicit enablement: %s',
        (mode) => {
            expect(snapshotPersonProfileMode(() => mode)).toBe(mode)
            for (const identified of [false, true]) {
                for (const grouped of [false, true]) {
                    for (const explicitlyEnabled of [false, true]) {
                        const expected =
                            mode === 'always' ||
                            (mode === 'identified_only' && (identified || grouped || explicitlyEnabled))
                        expect(shouldProcessPerson(mode, identified, grouped, explicitlyEnabled)).toBe(expected)
                    }
                }
            }
        }
    )
})

describe('person property snapshots', () => {
    it('serializes once and scopes duplicate signatures to the current identity', () => {
        const toJSON = vi.fn(() => ({ plan: 'paid' }))
        const snapshot = snapshotPersonProperties('first', { toJSON }, { source: 'docs' })
        expect(toJSON).toHaveBeenCalledOnce()
        expect(snapshot).toEqual({
            signature: '["first",{"plan":"paid"},{"source":"docs"}]',
            set: { plan: 'paid' },
            setOnce: { source: 'docs' },
        })
        expect(snapshot?.signature).not.toBe(
            snapshotPersonProperties('second', { plan: 'paid' }, { source: 'docs' })?.signature
        )
    })

    it('uses empty dictionaries for omitted inputs', () => {
        expect(snapshotPersonProperties('anonymous', undefined, undefined)).toEqual({
            signature: '["anonymous",{},{}]',
            set: {},
            setOnce: {},
        })
    })

    it('ignores cyclic property values', () => {
        const cycle: Record<string, unknown> = {}
        cycle.self = cycle
        expect(snapshotPersonProperties('anonymous', cycle, undefined)).toBeUndefined()
    })

    it('copies readonly unset names and ignores empty names', () => {
        const names = ['plan', '', 'source'] as const
        expect(personPropertyNames(names)).toEqual(['plan', 'source'])
        expect(personPropertyNames(names)).not.toBe(names)
        expect(personPropertyNames('x')).toEqual(['x'])
    })
})
