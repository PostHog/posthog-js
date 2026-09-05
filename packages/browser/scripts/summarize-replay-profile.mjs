// oxlint-disable compat/compat -- Node CLI, not SDK runtime
// Resolve production CPU profiles through the browser and rrweb source-map chain.
// Run against the exact build that produced the profiles; see benchmark-replay.md.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode } from '@jridgewell/sourcemap-codec'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = path.resolve(process.argv[2] || path.join(root, 'test-results/replay-benchmark'))
const dist = path.resolve(process.argv[3] || path.join(root, 'dist'))
const maps = new Map()
async function sourceMap(file) {
    if (!maps.has(file)) {
        let parsed
        try {
            parsed = JSON.parse(await readFile(`${file}.map`, 'utf8'))
        } catch (error) {
            if (error.code !== 'ENOENT') throw error
        }
        maps.set(file, parsed ? { ...parsed, decoded: decode(parsed.mappings) } : null)
    }
    return maps.get(file)
}
async function locate(frame) {
    let file = path.join(dist, path.basename(frame.url || ''))
    let line = frame.lineNumber
    let column = frame.columnNumber
    let sourceLine = ''
    let mapped = false
    for (let depth = 0; depth < 8; depth++) {
        const map = await sourceMap(file)
        if (!map) break
        let hit
        for (const segment of map.decoded[line] || []) {
            if (segment[0] > column) break
            if (segment.length >= 4) hit = segment
        }
        if (!hit) break
        mapped = true
        file = path.resolve(path.dirname(file), map.sourceRoot || '', map.sources[hit[1]])
        line = hit[2]
        column = hit[3]
        sourceLine = map.sourcesContent?.[hit[1]]?.split('\n')[line] || ''
    }
    return {
        file,
        line: line + 1,
        sourceLine,
        name: frame.functionName,
        label: mapped
            ? `${path.relative(root, file)}:${line + 1} ${frame.functionName}`
            : frame.functionName || frame.url || '(native)',
    }
}
const results = []
for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.cpuprofile')).sort()) {
    const profile = JSON.parse(await readFile(path.join(directory, filename), 'utf8'))
    assert.equal(profile.samples.length, profile.timeDeltas.length)
    const nodes = new Map()
    const parents = new Map()
    for (const node of profile.nodes) {
        nodes.set(node.id, await locate(node.callFrame))
        for (const child of node.children || []) parents.set(child, node.id)
    }
    const self = new Map()
    const categories = {}
    let mutationInclusiveMs = 0
    for (let i = 0; i < profile.samples.length; i++) {
        const id = profile.samples[i]
        const ms = profile.timeDeltas[i] / 1000
        const location = nodes.get(id)
        self.set(location.label, (self.get(location.label) || 0) + ms)
        const stack = []
        for (let current = id; current; current = parents.get(current)) stack.push(nodes.get(current))
        const mutation = stack.some((frame) => frame.file.endsWith('/record/mutation.ts'))
        if (mutation) mutationInclusiveMs += ms
        // Exclusive categories. GC samples without an attributed stack remain separate.
        const category =
            location.name === '(idle)'
                ? 'idle'
                : location.name === '(garbage collector)'
                  ? 'gc'
                  : stack.some(
                          (frame) =>
                              frame.file.endsWith('/record/mutation.ts') &&
                              /private (processMutation|genAdds) =/.test(frame.sourceLine)
                      )
                    ? 'mutationPreprocessing'
                    : stack.some((frame) => frame.file.endsWith('/rrweb-snapshot/src/snapshot.ts'))
                      ? 'serialization'
                      : stack.some(
                              (frame) =>
                                  /\/gzip\.(ts|mjs)$/.test(frame.file) ||
                                  (frame.file.endsWith('/lazy-loaded-session-recorder.ts') &&
                                      /function (gzip|serializeForCompression|compressEvent)/.test(frame.sourceLine))
                          )
                        ? 'encoding'
                        : mutation
                          ? 'mutationEmitOther'
                          : 'other'
        categories[category] = (categories[category] || 0) + ms
    }
    results.push({
        filename,
        sampledMs: categories,
        mutationInclusiveMs,
        topSelfMs: [...self]
            .filter(([name]) => name !== '(idle)')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25),
    })
}
// oxlint-disable-next-line no-console -- CLI diagnostic output
console.log(
    JSON.stringify(
        {
            note: 'Sampled attribution, not exact wall time. Use matching intermediate source maps. Categories are exclusive; mutationInclusiveMs overlaps them.',
            results,
        },
        null,
        2
    )
)
