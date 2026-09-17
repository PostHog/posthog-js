import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Read metadata beside the resolved public entry; package.json need not be exported.
export function packageMetadata(require, name) {
    const entry = require.resolve(name)
    let directory = dirname(entry)
    while (true) {
        const path = join(directory, 'package.json')
        if (existsSync(path)) {
            const bytes = readFileSync(path)
            const metadata = JSON.parse(bytes)
            if (metadata.name === name) {
                if (typeof metadata.version !== 'string' || !metadata.version.trim()) {
                    throw new Error('Installed package has no version')
                }
                const hash = (value) => createHash('sha256').update(value).digest('hex')
                return { name, version: metadata.version, metadata_sha256: hash(bytes), entry_sha256: hash(readFileSync(entry)) }
            }
        }
        const parent = dirname(directory)
        if (parent === directory) throw new Error('Cannot identify installed package')
        directory = parent
    }
}
