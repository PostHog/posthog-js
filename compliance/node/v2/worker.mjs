import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createInterface } from 'node:readline'
import { Console } from 'node:console'
import { Binding, routes } from './binding.mjs'
import { LocalObserver } from './local-observer.mjs'
import { packageMetadata } from './package-metadata.mjs'

// stdout is a private framing channel, never an SDK logging sink.
globalThis.console = new Console(process.stderr, process.stderr)
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\n')
try {
    const captureMode = process.env.POSTHOG_CAPTURE_MODE
    if (!['v0', 'v1'].includes(captureMode)) throw new Error('A native capture mode is required')
    const consumer = resolve(process.argv[2])
    if (!existsSync(join(consumer, 'package.json'))) throw new Error('Consumer package.json is required')
    const require = createRequire(join(consumer, 'package.json'))
    const metadata = packageMetadata(require, 'posthog-node')
    const { PostHog } = require('posthog-node')
    const binding = new Binding(PostHog, captureMode)
    send({
        ready: true,
        node_version: process.versions.node,
        sdk_version: metadata.version,
        sdk_identity: metadata,
        capture_mode: captureMode,
        routes,
    })
    const observer = new LocalObserver(metadata.version)
    try {
        for await (const line of createInterface({ input: process.stdin })) {
            const request = JSON.parse(line)
            const invoke = () => binding.invoke(request.route, request.args)
            const response =
                request.route === '/get_feature_flag' &&
                typeof request.args.key === 'string' &&
                request.args.key.length > 0
                    ? await observer.run(request.call_id, invoke)
                    : { completion: await invoke() }
            if (
                request.route === '/setup' &&
                response.completion.kind === 'sdk' &&
                response.completion.outcome.kind === 'void'
            ) {
                observer.attach(binding.client)
            }
            send({ call_id: request.call_id, ...response })
        }
    } finally {
        observer.close()
    }
} catch {
    // Keep arbitrary package/import errors (potentially containing secrets) off the protocol.
    console.error('Node v2 worker failed to load or execute the packaged consumer')
    process.exitCode = 1
}
