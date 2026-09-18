import fs from 'fs'
import os from 'os'
import path from 'path'
import { encode } from '@jridgewell/sourcemap-codec'
import { extractPropertyNames, validatePropertyClassification } from '../../scripts/check-mangled-property-consistency'

describe('mangled property extraction', () => {
    it.each(['name', 'parenthesis'])('includes class methods mapped at the %s', (mappingPosition) => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-property-map-'))
        const jsPath = path.join(directory, 'bundle.js')
        const mapPath = `${jsPath}.map`
        const code = 'class A{constructor(){}_onOptOut(){}}'
        fs.writeFileSync(jsPath, code)
        fs.writeFileSync(
            mapPath,
            JSON.stringify({
                names: ['_onOptOut'],
                mappings: encode([
                    [
                        [
                            code.indexOf('_onOptOut') + (mappingPosition === 'parenthesis' ? '_onOptOut'.length : 0),
                            0,
                            0,
                            0,
                            0,
                        ],
                    ],
                ]),
            })
        )
        try {
            expect(extractPropertyNames(jsPath, mapPath, true)).toEqual({ _onOptOut: ['_onOptOut'] })
            expect(extractPropertyNames(jsPath, mapPath)).toEqual({})
        } finally {
            fs.rmSync(directory, { recursive: true, force: true })
        }
    })
})

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
