import path from 'node:path'
import { embedExtensionIntegrity, verifyEmbeddedIntegrity } from './extension-integrity.mjs'

const dist = path.resolve(import.meta.dirname, '../dist')
const [command, extensionsDist] = process.argv.slice(2)

if (command === 'verify') {
    // Fails if the bundles in dist embed hashes other than those of the extensions in extensionsDist,
    // e.g. the npm build against the S3 artifact.
    const checked = verifyEmbeddedIntegrity(dist, extensionsDist ? path.resolve(extensionsDist) : dist)
    // oxlint-disable-next-line no-console
    console.log(`Extension integrity matches in ${checked.join(', ')}`)
} else {
    const { embedded } = embedExtensionIntegrity(dist)
    verifyEmbeddedIntegrity(dist)
    // oxlint-disable-next-line no-console
    console.log(`Embedded extension integrity in ${embedded.join(', ')}`)
}
