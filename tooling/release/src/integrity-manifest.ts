import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseSemver } from './release-utils.ts'

export async function writeIntegrityManifest(directory: string, version: string, files?: string[]): Promise<void> {
    if (!parseSemver(version)) {
        throw new Error(`Invalid integrity manifest version: '${version}'`)
    }
    const entries = files ?? (await fs.readdir(directory, { recursive: true }))
    const scripts = entries.filter((file) => /\.(?:[cm]?js|css|wasm)$/.test(file)).sort()
    if (scripts.length === 0) {
        throw new Error('No assets found for integrity manifest')
    }
    const integrity = Object.fromEntries(
        await Promise.all(
            scripts.map(async (file) => [
                file.split(path.sep).join('/'),
                'sha384-' +
                    createHash('sha384')
                        .update(await fs.readFile(path.join(directory, file)))
                        .digest('base64'),
            ])
        )
    )
    await fs.writeFile(
        path.join(directory, 'integrity.json'),
        JSON.stringify({ version, files: integrity }, null, 2) + '\n'
    )
}
