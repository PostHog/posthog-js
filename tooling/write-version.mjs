import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const target = process.argv[2] ?? 'src/version.ts'
const temporary = `${target}.${process.pid}.tmp`
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

try {
    // Build and typecheck can generate this file concurrently.
    writeFileSync(temporary, `export const version = ${JSON.stringify(version)}\n`)
    renameSync(temporary, target)
} finally {
    rmSync(temporary, { force: true })
}
