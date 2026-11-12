import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../', import.meta.url))
for (const fixture of ['composed', 'scheme', 'partitions', 'platform']) {
    await new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['smoke-test.mjs', `--fixture=${fixture}`, ...(fixture === 'platform' ? ['--asar'] : [])],
            {
                cwd: directory,
                stdio: 'inherit',
            }
        )
        child.once('error', reject)
        child.once('close', (code, signal) => {
            if (code === 0) resolve()
            else reject(new Error(`${fixture} fixture failed: code ${code}, signal ${signal}`))
        })
    })
}
