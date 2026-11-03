import fs from 'node:fs/promises'
import path from 'node:path'
import { writeIntegrityManifest } from '../../../tooling/release/src/integrity-manifest.ts'

const directory = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
await writeIntegrityManifest(path.join(directory, 'dist'), version)
