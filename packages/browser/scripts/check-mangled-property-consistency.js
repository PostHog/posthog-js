#!/usr/bin/env node

/**
 * Verify the private-property ABI between independently emitted slim cores and
 * extension-bundles.js.
 *
 * module.slim.js and extension-bundles.js share a Terser name cache. The
 * no-external slim build intentionally preserves property names, so properties
 * exchanged with extension bundles must also be reserved there.
 *
 * See https://github.com/PostHog/posthog-js/issues/3313
 */

const fs = require('fs')
const path = require('path')

const { decode } = require('@jridgewell/sourcemap-codec')
const { crossBundlePrivateProperties, knownNonAbiOverlaps } = require('../terser-cross-bundle-properties.cjs')

const DIST = path.resolve(__dirname, '../dist')

function extractPropertyNames(jsFile, mapFile, includeDefinitions = false) {
    const js = fs.readFileSync(jsFile, 'utf8')
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
    const lines = js.split('\n')
    const decoded = decode(map.mappings)
    const mappings = {}

    decoded.forEach((lineSegments, lineIndex) => {
        const line = lines[lineIndex] || ''
        lineSegments.forEach((segment) => {
            if (segment.length < 5) {
                return
            }

            const generatedColumn = segment[0]
            const originalName = map.names[segment[4]]
            if (!originalName || !originalName.startsWith('_') || originalName.startsWith('__')) {
                return
            }

            const previousCharacter = generatedColumn === 0 ? '' : line[generatedColumn - 1]
            const rest = line.substring(generatedColumn)
            const isPropertyAccess = previousCharacter === '.'
            const isMethodDeclaration = /[{},;]/.test(previousCharacter) && /^[a-zA-Z_$][a-zA-Z0-9_$]*\(/.test(rest)
            const isObjectKey = /[{,]/.test(previousCharacter) && /^[a-zA-Z_$][a-zA-Z0-9_$]*:/.test(rest)

            if (!isPropertyAccess && !(includeDefinitions && (isMethodDeclaration || isObjectKey))) {
                return
            }

            const match = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/)
            if (match) {
                if (!mappings[originalName]) {
                    mappings[originalName] = new Set()
                }
                mappings[originalName].add(match[1])
            }
        })
    })

    return Object.fromEntries(
        Object.entries(mappings).map(([originalName, emittedNames]) => [originalName, [...emittedNames].sort()])
    )
}

function readArtifact(fileName, includeDefinitions = false) {
    return extractPropertyNames(path.join(DIST, fileName), path.join(DIST, `${fileName}.map`), includeDefinitions)
}

function findDuplicates(values) {
    return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort()
}

function validatePropertyClassification(observedOverlaps, abiProperties, nonAbiProperties) {
    const errors = []
    const duplicateAbiProperties = findDuplicates(abiProperties)
    const duplicateNonAbiProperties = findDuplicates(nonAbiProperties)
    const abiSet = new Set(abiProperties)
    const nonAbiSet = new Set(nonAbiProperties)
    const observedSet = new Set(observedOverlaps)
    const conflicts = [...abiSet].filter((property) => nonAbiSet.has(property)).sort()
    const classified = new Set([...abiSet, ...nonAbiSet])
    const unknown = [...observedSet].filter((property) => !classified.has(property)).sort()
    const stale = [...classified].filter((property) => !observedSet.has(property)).sort()

    if (duplicateAbiProperties.length > 0) {
        errors.push(`duplicate ABI properties: ${duplicateAbiProperties.join(', ')}`)
    }
    if (duplicateNonAbiProperties.length > 0) {
        errors.push(`duplicate non-ABI properties: ${duplicateNonAbiProperties.join(', ')}`)
    }
    if (conflicts.length > 0) {
        errors.push(`properties classified as both ABI and non-ABI: ${conflicts.join(', ')}`)
    }
    if (unknown.length > 0) {
        errors.push(`unknown private-property overlaps: ${unknown.join(', ')}`)
    }
    if (stale.length > 0) {
        errors.push(`stale private-property classifications: ${stale.join(', ')}`)
    }

    return errors
}

function formatNames(names) {
    return names.length > 0 ? `.${names.join(', .')}` : '(missing from source map)'
}

function checkPair(leftName, left, rightName, right, properties) {
    if (properties.length === 0) {
        console.error(`FAIL: no shared private property mappings found between ${leftName} and ${rightName}`)
        return false
    }

    const mismatches = []
    for (const property of properties) {
        const leftNames = left[property] || []
        const rightNames = right[property] || []
        if (leftNames.length !== 1 || rightNames.length !== 1 || leftNames[0] !== rightNames[0]) {
            mismatches.push({ property, leftNames, rightNames })
        }
    }

    if (mismatches.length > 0) {
        console.error(`FAIL: ${mismatches.length} property name(s) differ between ${leftName} and ${rightName}`)
        mismatches.forEach(({ property, leftNames, rightNames }) => {
            console.error(
                `  .${property}: ${leftName} → ${formatNames(leftNames)} | ${rightName} → ${formatNames(rightNames)}`
            )
        })
        return false
    }

    console.log(
        `OK: ${properties.length} cross-bundle private properties are consistent between ${leftName} and ${rightName}`
    )
    return true
}

function main() {
    const extensionBundleAccesses = readArtifact('extension-bundles.js')
    const slimAccesses = readArtifact('module.slim.js')
    const extensionBundleProperties = readArtifact('extension-bundles.js', true)
    const slimNoExternalProperties = readArtifact('module.slim.no-external.js', true)
    const normalSlimOverlaps = Object.keys(extensionBundleAccesses)
        .filter((property) => slimAccesses[property])
        .sort()
    const noExternalOverlaps = Object.keys(extensionBundleProperties)
        .filter((property) => slimNoExternalProperties[property])
        .sort()

    const classificationErrors = validatePropertyClassification(
        noExternalOverlaps,
        crossBundlePrivateProperties,
        knownNonAbiOverlaps
    )
    if (classificationErrors.length > 0) {
        console.error('FAIL: no-external private-property classification is incomplete')
        classificationErrors.forEach((error) => console.error(`  ${error}`))
    } else {
        console.log(`OK: ${noExternalOverlaps.length} no-external private-property overlaps are classified`)
    }

    const results = [
        classificationErrors.length === 0,
        checkPair('module.slim.js', slimAccesses, 'extension-bundles.js', extensionBundleAccesses, normalSlimOverlaps),
        checkPair(
            'module.slim.no-external.js',
            slimNoExternalProperties,
            'extension-bundles.js',
            extensionBundleProperties,
            crossBundlePrivateProperties
        ),
    ]

    if (results.some((passed) => !passed)) {
        console.error(
            '\nFix: share the Terser property name cache or reserve properties that cross an unmangled artifact boundary.'
        )
        process.exitCode = 1
    }
}

if (require.main === module) {
    main()
}

module.exports = {
    extractPropertyNames,
    validatePropertyClassification,
}
