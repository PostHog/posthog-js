import { validatePropertyClassification } from '../../scripts/check-mangled-property-consistency'

describe('mangled property consistency classification', () => {
    const abiProperties = ['_crossesBoundary']
    const nonAbiProperties = ['_artifactLocal']
    const observedOverlaps = [...abiProperties, ...nonAbiProperties]

    it('accepts a complete classification', () => {
        expect(validatePropertyClassification(observedOverlaps, abiProperties, nonAbiProperties)).toEqual([])
    })

    it('rejects unknown overlaps', () => {
        expect(
            validatePropertyClassification([...observedOverlaps, '_unknown'], abiProperties, nonAbiProperties)
        ).toContain('unknown private-property overlaps: _unknown')
    })

    it('rejects stale classifications', () => {
        expect(validatePropertyClassification(abiProperties, abiProperties, nonAbiProperties)).toContain(
            'stale private-property classifications: _artifactLocal'
        )
    })

    it('rejects duplicate and conflicting classifications', () => {
        expect(
            validatePropertyClassification(
                observedOverlaps,
                [...abiProperties, ...abiProperties],
                [...nonAbiProperties, ...nonAbiProperties, ...abiProperties]
            )
        ).toEqual([
            'duplicate ABI properties: _crossesBoundary',
            'duplicate non-ABI properties: _artifactLocal',
            'properties classified as both ABI and non-ABI: _crossesBoundary',
        ])
    })
})
