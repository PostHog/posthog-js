import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// Every PostHogExtensionKind except `toolbar` and `remote-config`, which are not release-pinned assets.
// src/__tests__/entrypoints/extension-integrity.test.ts keeps this list in sync with the type.
export const EXTENSION_FILES = [
    'conversations.js',
    'crisp-chat-integration.js',
    'dead-clicks-autocapture.js',
    'exception-autocapture.js',
    'intercom-integration.js',
    'lazy-recorder.js',
    'logs.js',
    'product-tours.js',
    'recorder.js',
    'surveys.js',
    'tracing-headers.js',
    'web-vitals-soft-navs.js',
    'web-vitals-with-attribution-soft-navs.js',
    'web-vitals-with-attribution.js',
    'web-vitals.js',
]

// Same length as a real `sha384-` value, so replacing it keeps every source-map column valid.
// `~` and `.` are not base64, so an unreplaced placeholder fails integrity validation closed.
export const placeholderFor = (file) => `sha384-${`~${file}`.padEnd(64, '~')}`

const sha384 = (bytes) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`

const countOccurrences = (text, search) => text.split(search).length - 1

/**
 * Replaces the placeholders in every emitted bundle with the SHA-384 of the final extension bytes.
 * Extensions must not embed the map themselves, otherwise their hashes would be circular.
 */
export function embedExtensionIntegrity(dist) {
    const hashes = Object.fromEntries(
        EXTENSION_FILES.map((file) => [file, sha384(fs.readFileSync(path.join(dist, file)))])
    )
    const placeholders = EXTENSION_FILES.map(placeholderFor)
    const embedded = []
    for (const file of fs.readdirSync(dist).sort()) {
        if (!/\.(?:[cm]?js|map)$/.test(file)) {
            continue
        }
        const filePath = path.join(dist, file)
        const original = fs.readFileSync(filePath, 'utf8')
        const counts = placeholders.map((placeholder) => countOccurrences(original, placeholder))
        if (counts.every((count) => count === 0)) {
            continue
        }
        if (EXTENSION_FILES.includes(file) || EXTENSION_FILES.includes(file.replace(/\.map$/, ''))) {
            throw new Error(`${file} is an integrity-pinned extension and must not include the extension integrity map`)
        }
        if (!file.endsWith('.map') && counts.some((count) => count !== 1)) {
            throw new Error(`${file} must contain each extension integrity placeholder exactly once`)
        }
        let updated = original
        EXTENSION_FILES.forEach((extension, index) => {
            updated = updated.split(placeholders[index]).join(hashes[extension])
        })
        // Only placeholder bytes may change, so mangled names and source-map columns stay identical.
        let masked = updated
        EXTENSION_FILES.forEach((extension, index) => {
            masked = masked.split(hashes[extension]).join(placeholders[index])
        })
        if (masked !== original) {
            throw new Error(`Embedding extension integrity changed bytes outside the placeholders in ${file}`)
        }
        fs.writeFileSync(filePath, updated)
        if (!file.endsWith('.map')) {
            embedded.push(file)
        }
    }
    return { hashes, embedded }
}

/** Returns the extension integrity map embedded in a built bundle, or undefined if it has none. */
export function readEmbeddedIntegrity(code) {
    const result = {}
    for (const file of EXTENSION_FILES) {
        const match = code.match(
            new RegExp(`["']${file.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}["']:["'](sha384-[A-Za-z0-9+/~.-]{64})["']`)
        )
        if (match) {
            result[file] = match[1]
        }
    }
    return Object.keys(result).length ? result : undefined
}

/**
 * Checks that every bundle in `dist` embeds exactly the SHA-384 of the extension files in
 * `extensionsDist` (default: the same directory). The release workflow passes the S3 artifact.
 */
export function verifyEmbeddedIntegrity(dist, extensionsDist = dist) {
    const expected = Object.fromEntries(
        EXTENSION_FILES.map((file) => [file, sha384(fs.readFileSync(path.join(extensionsDist, file)))])
    )
    const checked = []
    for (const file of fs.readdirSync(dist).sort()) {
        if (!/\.[cm]?js$/.test(file)) {
            continue
        }
        const embedded = readEmbeddedIntegrity(fs.readFileSync(path.join(dist, file), 'utf8'))
        if (!embedded) {
            continue
        }
        for (const extension of EXTENSION_FILES) {
            if (embedded[extension] !== expected[extension]) {
                throw new Error(
                    `${file} embeds ${embedded[extension] ?? 'no hash'} for ${extension}, expected ${expected[extension]}`
                )
            }
        }
        checked.push(file)
    }
    if (!checked.length) {
        throw new Error(`No bundle in ${dist} embeds the extension integrity map`)
    }
    return checked
}
