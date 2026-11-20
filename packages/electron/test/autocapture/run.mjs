import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const directory = await mkdtemp(join(tmpdir(), 'posthog-electron-autocapture-'))
try {
    const bundle = join(directory, 'renderer.js')
    await build({
        entryPoints: [fileURLToPath(new URL('./renderer.mjs', import.meta.url))],
        outfile: bundle,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        target: 'chrome145',
        metafile: true,
    }).then(({ metafile }) => {
        const inputs = Object.values(metafile.outputs).flatMap((output) =>
            Object.entries(output.inputs)
                .filter(([, info]) => info.bytesInOutput > 0)
                .map(([input]) => input)
        )
        if (inputs.some((input) => /rrweb|packages\/browser\/|recorder|browser-common\/dist\/surveys/.test(input))) {
            throw new Error('Autocapture renderer unexpectedly includes an unsupported product: ' + inputs.join(', '))
        }
    })
    const electron = createRequire(import.meta.url)('electron')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    await new Promise((resolve, reject) => {
        const child = spawn(electron, [fileURLToPath(new URL('./main.cjs', import.meta.url)), directory, bundle], {
            env,
            stdio: 'inherit',
        })
        const timer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error('Electron autocapture test timed out'))
        }, 60_000)
        child.once('error', (error) => {
            clearTimeout(timer)
            reject(error)
        })
        child.once('exit', (code) => {
            clearTimeout(timer)
            code === 0 ? resolve() : reject(new Error(`Electron exited ${code}`))
        })
    })
} finally {
    await rm(directory, { recursive: true, force: true })
}
