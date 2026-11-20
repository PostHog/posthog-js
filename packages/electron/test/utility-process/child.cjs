const assert = require('node:assert/strict')
const { init } = require('@posthog/electron/utility')

async function run() {
    const client = await init()
    await Promise.all([client.ready(), client.ready()])
    await client.ready()
    const port = process.parentPort
    port.on('message', async ({ data }) => {
        if (data.fixture !== 'command') return
        try {
            switch (data.action) {
                case 'identity':
                    if (client.getDistinctId() !== data.value)
                        await new Promise((resolve) => {
                            const unsubscribe = client.onStateChange((state) => {
                                if (state.distinctId === data.value) {
                                    unsubscribe()
                                    resolve()
                                }
                            })
                        })
                    break
                case 'identify':
                    await client.identify('utility-user')
                    break
                case 'capture':
                    await client.capture(data.value, { $electron_process: 'spoof', $utility_process_id: 'spoof' })
                    break
                case 'burst': {
                    for (let i = 0; i < 110; i++) {
                        try {
                            await client.capture(`burst-${i}`)
                        } catch (error) {
                            assert.match(error.message, /rate limit/)
                        }
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1100))
                    await client.capture('after-rate-window')
                    await client.flush()
                    break
                }
                case 'exception':
                    await client.captureException(new Error('handled utility fixture'))
                    break
                case 'optOut':
                    await client.optOut()
                    break
                case 'reset':
                    await client.reset()
                    break
                case 'flags':
                    await client.reloadFeatureFlags()
                    if (client.getFeatureFlag('test') !== 'variant') throw new Error('missing utility flag')
                    assert.deepEqual(
                        client.getFeatureFlagPayload('test'),
                        JSON.parse('{"color":"blue","constructor":{"prototype":true},"__proto__":{"canary":1}}')
                    )
                    client.getFeatureFlag('test')
                    await client.flush()
                    break
                case 'slowFlush': {
                    let timedOut = false
                    try {
                        await client.flush()
                    } catch (error) {
                        assert.match(error.message, /timed out/)
                        timedOut = true
                    }
                    assert.equal(timedOut, true)
                    await client.capture('after-slow-flush')
                    break
                }
                case 'pending':
                    port.postMessage({ fixture: 'pending' })
                    await client.flush()
                    throw new Error('pending request unexpectedly resolved')
                case 'exit':
                    process.exit(23)
                    break
                default:
                    throw new Error('unknown fixture action')
            }
            port.postMessage({ fixture: 'response', id: data.id, state: client.getState() })
        } catch (error) {
            port.postMessage({ fixture: 'response', id: data.id, error: error.message })
        }
    })
    port.postMessage({ fixture: 'ready', state: client.getState() })
}
run().catch((error) => {
    console.error(error)
    process.exit(1)
})
