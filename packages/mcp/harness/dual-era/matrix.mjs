// Boots every configuration, runs the assertions, renders the matrix.
//
//   node matrix.mjs                 all 12 rows
//   node matrix.mjs --major v1     the 4 SDK-v1 rows
//   node matrix.mjs --major v2     the 8 SDK-v2 rows
//
// This is the CI gate, not just a report: it exits non-zero when a server fails
// to boot or when the set of red cells differs from expected-failures.json in
// EITHER direction — a regression fails, and so does an unexpected improvement
// (remove the entry to ratchet it in). Servers bind ephemeral ports (PORT=0) and
// announce the chosen port on stdout, so rows cannot collide or reach a dying
// neighbour.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('.', import.meta.url))

/** The build under test and the SDK majors it runs against — resolved, not assumed. */
function versionBanner() {
    // fs reads, not require(): both SDKs' `exports` deny the package.json subpath.
    const version = (rel) => {
        try {
            return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')).version
        } catch {
            return '?'
        }
    }
    const local = version('../../package.json')
    const v1 = version('../../node_modules/@modelcontextprotocol/sdk/package.json')
    const v2 = version('../../node_modules/@modelcontextprotocol/server/package.json')
    return `@posthog/mcp ${local} (workspace build) · sdk v1 ${v1} · v2 ${v2}`
}

const MAJOR = (() => {
    const i = process.argv.indexOf('--major')
    return i === -1 ? 'all' : process.argv[i + 1]
})()

const COLUMNS = [
    ['calls', 5],
    ['errors', 6],
    ['intent', 6],
    ['schema', 6],
    ['session', 7],
    ['client', 6],
    ['protocol', 8],
    ['warnings', 8],
    ['header', 6],
    ['alive', 5],
]

// label, server file, env, lane, conv, header expectation
const V1_ROWS = [
    ['v1  stateful   high', 'v1.mjs', { LEVEL: 'high', MODE: 'stateful' }, '2025', 'off', 'present'],
    ['v1  stateful   low', 'v1.mjs', { LEVEL: 'low', MODE: 'stateful' }, '2025', 'off', 'present'],
    ['v1  stateless  high', 'v1.mjs', { LEVEL: 'high', MODE: 'stateless' }, '2025', 'off', 'token'],
    ['v1  stateless  low', 'v1.mjs', { LEVEL: 'low', MODE: 'stateless' }, '2025', 'off', 'token'],
]
const V2_ROWS = [
    ['v2  high  2025  conv=off', 'v2.mjs', { LEVEL: 'high' }, '2025', 'off'],
    ['v2  high  2025  conv=on', 'v2.mjs', { LEVEL: 'high' }, '2025', 'on'],
    ['v2  high  2026  conv=off', 'v2.mjs', { LEVEL: 'high' }, '2026', 'off'],
    ['v2  high  2026  conv=on', 'v2.mjs', { LEVEL: 'high' }, '2026', 'on'],
    ['v2  low   2025  conv=off', 'v2.mjs', { LEVEL: 'low' }, '2025', 'off'],
    ['v2  low   2025  conv=on', 'v2.mjs', { LEVEL: 'low' }, '2025', 'on'],
    ['v2  low   2026  conv=off', 'v2.mjs', { LEVEL: 'low' }, '2026', 'off'],
    ['v2  low   2026  conv=on', 'v2.mjs', { LEVEL: 'low' }, '2026', 'on'],
]
const ROWS = MAJOR === 'v1' ? V1_ROWS : MAJOR === 'v2' ? V2_ROWS : [...V1_ROWS, null, ...V2_ROWS]

const children = new Set()

/**
 * Boot a server on an ephemeral port and resolve with { child, port } once it
 * announces `MCP_HARNESS_LISTENING port=<n>` on stdout, or { child, port: null }
 * if it never does.
 */
function boot(file, env) {
    return new Promise((resolve) => {
        const child = spawn('node', [`${DIR}servers/${file}`], {
            env: { ...process.env, ...env, PORT: '0' },
            stdio: ['ignore', 'pipe', 'inherit'],
        })
        children.add(child)
        let out = ''
        let settled = false
        const settle = (port) => {
            if (settled) return
            settled = true
            resolve({ child, port })
        }
        child.stdout.on('data', (d) => {
            out += d
            const m = out.match(/MCP_HARNESS_LISTENING port=(\d+)/)
            if (m) settle(Number(m[1]))
        })
        child.on('exit', () => settle(null))
        setTimeout(() => settle(null), 15000)
    })
}
async function stop(child) {
    child.kill('SIGKILL')
    children.delete(child)
    await sleep(100)
}
async function waitUp(port) {
    for (let i = 0; i < 80; i++) {
        try {
            await fetch(`http://localhost:${port}/__events`)
            return true
        } catch {
            await sleep(150)
        }
    }
    return false
}

function runClient(port, sdk, lane, conv, headerExpect) {
    return new Promise((resolve) => {
        const child = spawn(
            'node',
            [
                `${DIR}client/run.mjs`,
                ...['--url', `http://localhost:${port}`, '--sdk', sdk, '--lane', lane],
                ...['--conv', conv, '--header', headerExpect, '--json'],
            ],
            { env: process.env }
        )
        let out = ''
        child.stdout.on('data', (d) => (out += d))
        child.on('close', () => {
            try {
                resolve(JSON.parse(out.trim().split('\n').pop()))
            } catch {
                resolve({ results: {}, error: out.slice(0, 200) })
            }
        })
    })
}

/** Separate boot: does the host server survive a 3-arg custom registration? */
async function checkAlive(file, env) {
    if (file === 'v1.mjs') return null // v1's setRequestHandler has no 3-argument form
    const { child, port } = await boot(file, { ...env, CUSTOM_3ARG: '1' })
    if (!port || !(await waitUp(port))) {
        await stop(child)
        return false
    }
    let ok = false
    try {
        const res = await fetch(`http://localhost:${port}/mcp`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                'mcp-protocol-version': '2026-07-28',
                'mcp-method': 'tools/list',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {
                    _meta: {
                        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                        'io.modelcontextprotocol/clientInfo': { name: 'p', version: '1' },
                        'io.modelcontextprotocol/clientCapabilities': {},
                    },
                },
            }),
        })
        ok = res.status === 200
    } catch {
        ok = false
    }
    await stop(child)
    return ok
}

// ── run ─────────────────────────────────────────────────────────────────────
const rendered = []
for (const row of ROWS) {
    if (row === null) {
        rendered.push(null)
        continue
    }
    const [label, file, env, lane, conv, headerExpect = 'none'] = row
    const sdk = file === 'v1.mjs' ? 'v1' : 'v2'
    const { child, port } = await boot(file, { ...env, CONVERSATION_ID: conv === 'on' ? '1' : '0' })
    if (!port || !(await waitUp(port))) {
        await stop(child)
        rendered.push([label, null])
        continue
    }
    const { results } = await runClient(port, sdk, lane, conv, headerExpect)
    await stop(child)
    results.alive = await checkAlive(file, env)
    rendered.push([label, results])
    process.stderr.write(`  ran ${label}\n`)
}

// ── render ──────────────────────────────────────────────────────────────────
const LABEL_W = 30
const cell = (v) => (v === null || v === undefined ? '·' : v ? '✓' : '✗')
const centre = (s, w) => {
    const pad = w - s.length
    return ' '.repeat(Math.floor(pad / 2)) + s + ' '.repeat(Math.ceil(pad / 2))
}

const groups = [
    ['capture', 4],
    ['identity', 3],
    ['safety', 3],
]
let g1 = ' '.repeat(LABEL_W)
let idx = 0
for (const [name, span] of groups) {
    const w = COLUMNS.slice(idx, idx + span).reduce((a, [, cw]) => a + cw + 1, 0)
    const inner = ` ${name} `
    const dashes = Math.max(0, w - inner.length)
    g1 += '─'.repeat(Math.floor(dashes / 2)) + inner + '─'.repeat(Math.ceil(dashes / 2))
    idx += span
}
const head = ' '.repeat(LABEL_W) + COLUMNS.map(([n, w]) => centre(n, w + 1)).join('')
const rule = '─'.repeat(head.length)

console.log(`\n${g1}\n${head}\n${rule}`)
for (const row of rendered) {
    if (row === null) {
        console.log(rule)
        continue
    }
    const [label, results] = row
    if (!results) {
        console.log(label.padEnd(LABEL_W) + '  server did not start')
        continue
    }
    console.log(label.padEnd(LABEL_W) + COLUMNS.map(([n, w]) => centre(cell(results[n]), w + 1)).join(''))
}
console.log(rule)
console.log(`  ✓ pass    ✗ fail    · not applicable        ${versionBanner()}`)

for (const c of children) c.kill('SIGKILL')

// ── expected-failures reconciliation ────────────────────────────────────────
const norm = (s) => s.replace(/\s+/g, ' ').trim()
const expected = new Set(
    JSON.parse(readFileSync(new URL('./expected-failures.json', import.meta.url), 'utf8'))
        .filter((f) => (MAJOR === 'all' ? true : norm(f.row).startsWith(MAJOR)))
        .map((f) => `${norm(f.row)} · ${f.col}`)
)
const failing = new Set()
let booted = true
for (const row of rendered) {
    if (row === null) continue
    const [label, results] = row
    if (!results) {
        booted = false
        continue
    }
    for (const [n] of COLUMNS) if (results[n] === false) failing.add(`${norm(label)} · ${n}`)
}
const regressed = [...failing].filter((k) => !expected.has(k))
const nowPassing = [...expected].filter((k) => !failing.has(k))

if (!booted) console.error('\na server failed to boot')
if (regressed.length > 0) console.error(`\nregressed: ${regressed.join('  ·  ')}`)
if (nowPassing.length > 0)
    console.error(`\nnow passing — remove from expected-failures.json: ${nowPassing.join('  ·  ')}`)
process.exit(booted && regressed.length === 0 && nowPassing.length === 0 ? 0 : 1)
