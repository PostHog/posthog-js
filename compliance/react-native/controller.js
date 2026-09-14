/** HTTP bridge to an installed Android RN app; this process never imports the SDK. */
const express = require('express')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)
const serial = process.env.ANDROID_SERIAL
if (!serial) throw new Error('ANDROID_SERIAL must select the owned emulator')
const appId = 'com.posthog.compliance.rn'
const app = express()
app.use(express.json())
let health
let polling
let nextId = 0
const commands = []
const results = new Map()
const adb = (...args) => run('adb', ['-s', serial, ...args])

async function restart() {
    health = undefined
    await adb('shell', 'am', 'force-stop', appId)
    if (polling) {
        polling.status(204).end()
        polling = undefined
    }
    commands.length = 0
    await adb('shell', 'am', 'start', '-n', `${appId}/.MainActivity`)
    const deadline = Date.now() + 30000
    while (!health && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    if (!health) throw new Error('Native app did not become ready within 30s')
}
function dispatch() {
    if (polling && commands.length) {
        const response = polling
        polling = undefined
        response.json(commands.shift())
    }
}
app.post('/native/ready', (req, res) => {
    if (req.body.platform !== 'android' || !['Hermes', 'JavaScriptCore'].includes(req.body.runtime)) {
        return res.status(400).json({ error: 'Expected genuine Android RN runtime' })
    }
    health = req.body
    res.json({ success: true })
})
app.get('/native/command', (_req, res) => {
    polling = res
    const timer = setTimeout(() => {
        if (polling === res) polling = undefined
        res.status(204).end()
    }, 10000)
    res.on('close', () => {
        clearTimeout(timer)
        if (polling === res) polling = undefined
    })
    dispatch()
})
app.post('/native/result', (req, res) => {
    results.get(req.body.id)?.(req.body)
    res.json({ success: true })
})
app.get('/health', (_req, res) =>
    health ? res.json(health) : res.status(503).json({ error: 'Native runtime not ready' })
)
app.post('/reset', async (_req, res) => {
    await restart()
    res.json({ success: true })
})
for (const action of ['init', 'capture', 'flush', 'get_feature_flag', 'state']) {
    app[action === 'state' ? 'get' : 'post'](`/${action}`, async (req, res) => {
        const id = ++nextId
        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                results.delete(id)
                reject(new Error(`Native ${action} timed out`))
            }, 45000)
            results.set(id, (value) => {
                clearTimeout(timer)
                results.delete(id)
                resolve(value)
            })
            commands.push({ id, action, input: req.body || {} })
            dispatch()
        })
        res.status(result.status).json(result.result)
    })
}
app.use((error, _req, res, _next) => res.status(500).json({ success: false, error: error.message }))
app.listen(process.env.PORT || 18213, () => {
    restart().catch((error) => {
        console.error(error)
        process.exit(1)
    })
})
