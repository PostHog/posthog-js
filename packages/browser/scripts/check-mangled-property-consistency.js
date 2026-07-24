#!/usr/bin/env node

/**
 * Post-build check: verify that property names are consistent between the
 * independently emitted slim cores and extension-bundles.js.
 *
 * module.slim.js and extension-bundles.js enable property mangling and share a
 * Terser nameCache. module.slim.no-external.js intentionally disables property
 * mangling, so every private property crossing that artifact boundary must be
 * reserved in the mangled extension bundle.
 *
 * This script parses source maps to extract original→emitted property mappings
 * and checks both supported pairings. Identity mappings must be retained for
 * the no-external comparison.
 *
 * See https://github.com/PostHog/posthog-js/issues/3313
 */

const fs = require('fs')
const path = require('path')

const { decode } = require('@jridgewell/sourcemap-codec')

const DIST = path.resolve(__dirname, '../dist')

// Private properties intentionally exchanged between the slim core and extension classes.
// The no-external core preserves these names, so the extension bundle must preserve them too.
// Keep this list in sync with the cross-bundle reserved section in rollup.config.mjs.
const CROSS_BUNDLE_PRIVATE_PROPERTIES = [
    '_shouldDisableFlags',
    '_internalEventEmitter',
    '_onRemoteConfig',
    '_send_request',
    '_addCaptureHook',
    '_onIdentityChanged',
    '_onIdentityCleared',
]
const crossBundlePrivateProperties = new Set(CROSS_BUNDLE_PRIVATE_PROPERTIES)

function extractPropertyNames(jsFile, mapFile) {
    const js = fs.readFileSync(jsFile, 'utf8')
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
    const lines = js.split('\n')
    const decoded = decode(map.mappings)
    const mappings = {} // originalName → Set<emittedName>

    decoded.forEach((lineSegments, lineIdx) => {
        const line = lines[lineIdx] || ''
        lineSegments.forEach((seg) => {
            if (seg.length < 5) return
            const genCol = seg[0]
            const nameIdx = seg[4]
            const originalName = map.names[nameIdx]

            // Only check single-underscore-prefixed properties (the mangling regex)
            if (!originalName || !originalName.startsWith('_') || originalName.startsWith('__')) return

            const rest = line.substring(genCol)
            const previousCharacter = genCol === 0 ? '' : line[genCol - 1]
            const isPropertyAccess = previousCharacter === '.'
            // Core calls these methods on an extension instance, so the extension artifact
            // may contain only their class declarations rather than a dotted access.
            const isCrossBundleMethodDeclaration =
                crossBundlePrivateProperties.has(originalName) &&
                /[{},;]/.test(previousCharacter) &&
                /^[a-zA-Z_$][a-zA-Z0-9_$]*\(/.test(rest)

            if (!isPropertyAccess && !isCrossBundleMethodDeclaration) return

            const match = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/)
            if (match) {
                if (!mappings[originalName]) mappings[originalName] = new Set()
                mappings[originalName].add(match[1])
            }
        })
    })

    const result = {}
    for (const [k, v] of Object.entries(mappings)) {
        result[k] = [...v]
    }
    return result
}

function readArtifact(fileName) {
    return extractPropertyNames(path.join(DIST, fileName), path.join(DIST, `${fileName}.map`))
}

function checkPair(leftName, left, rightName, right, requiredProperties) {
    const shared = requiredProperties
        ? [...requiredProperties].sort()
        : Object.keys(right)
              .filter((name) => left[name])
              .sort()

    if (shared.length === 0) {
        console.error(`FAIL: no shared private property mappings found between ${leftName} and ${rightName}`)
        console.error('The consistency check cannot prove that these artifacts are compatible.')
        return false
    }

    const mismatches = []
    for (const name of shared) {
        const leftNames = left[name] || []
        const rightNames = right[name] || []
        // Terser should produce exactly one emitted name per property per compilation unit.
        if (leftNames[0] !== rightNames[0] || leftNames.length !== 1 || rightNames.length !== 1) {
            mismatches.push({ property: name, left: leftNames, right: rightNames })
        }
    }

    if (mismatches.length > 0) {
        console.error(`FAIL: ${mismatches.length} property name(s) differ between ${leftName} and ${rightName}`)
        console.error('The slim core and extension bundles can crash when used together (see #3313)\n')
        mismatches.forEach((mismatch) =>
            console.error(
                `  .${mismatch.property}:  ${leftName} → ${formatNames(mismatch.left)}  |  ${rightName} → ${formatNames(mismatch.right)}`
            )
        )
        console.error(
            '\nFix: share the Terser property nameCache or reserve the property when either artifact disables property mangling'
        )
        return false
    }

    console.log(
        `OK: ${shared.length} cross-bundle private properties are consistent between ${leftName} and ${rightName}`
    )
    return true
}

function formatNames(names) {
    return names.length > 0 ? `.${names.join(', .')}` : '(missing from source map)'
}

const extensionBundles = readArtifact('extension-bundles.js')
const results = [
    checkPair('module.slim.js', readArtifact('module.slim.js'), 'extension-bundles.js', extensionBundles),
    checkPair(
        'module.slim.no-external.js',
        readArtifact('module.slim.no-external.js'),
        'extension-bundles.js',
        extensionBundles,
        CROSS_BUNDLE_PRIVATE_PROPERTIES
    ),
]

if (results.some((passed) => !passed)) {
    process.exit(1)
}
