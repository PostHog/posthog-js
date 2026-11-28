import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const target = process.argv[2] ?? 'src/version.ts'
const temporary = `${target}.${process.pid}.tmp`
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

try {
    // Build and typecheck can generate this file concurrently.
    writeFileSync(temporary, `export const version = ${JSON.stringify(version)}\n`)
    for (let attempt = 0; ; attempt++) {
        try {
            renameSync(temporary, target)
            break
        } catch (error) {
            // Windows can briefly reject replacement while another process has the target open.
            if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt === 7) {
                throw error
            }
            await delay(20 * (attempt + 1))
        }
    }
} finally {
    rmSync(temporary, { force: true })
}
