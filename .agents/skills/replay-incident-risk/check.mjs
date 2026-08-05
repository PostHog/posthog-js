#!/usr/bin/env node
// Advisory checker: matches a diff against past incident classes in risk-map.json.
// Usage:
//   node .agents/skills/replay-incident-risk/check.mjs [base-ref] [--json]
// Defaults to diffing against origin/main (falling back to main). Always exits 0:
// this is a heads-up, not a gate.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillDir = dirname(fileURLToPath(import.meta.url))
const riskMap = JSON.parse(readFileSync(join(skillDir, 'risk-map.json'), 'utf8'))

const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')
const baseArg = args.find((a) => !a.startsWith('--'))

function git(...cmd) {
    return execFileSync('git', cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function resolveBase() {
    for (const candidate of [baseArg, 'origin/main', 'main'].filter(Boolean)) {
        try {
            git('rev-parse', '--verify', '--quiet', `${candidate}^{commit}`)
            return candidate
        } catch {
            /* try next */
        }
    }
    console.error('Could not resolve a base ref. Pass one explicitly, e.g. `check.mjs origin/main`.')
    process.exit(2)
}

const base = resolveBase()
const mergeBase = git('merge-base', base, 'HEAD').trim()

const changedFiles = git('diff', '--name-only', mergeBase, 'HEAD').split('\n').filter(Boolean)

// Added lines per file, so content patterns only fire on what this diff introduces.
const addedLinesByFile = new Map()
{
    const diff = git('diff', '--unified=0', mergeBase, 'HEAD')
    let currentFile = null
    for (const line of diff.split('\n')) {
        const fileHeader = line.match(/^\+\+\+ b\/(.*)$/)
        if (fileHeader) {
            currentFile = fileHeader[1]
            addedLinesByFile.set(currentFile, [])
            continue
        }
        if (currentFile && line.startsWith('+') && !line.startsWith('+++')) {
            addedLinesByFile.get(currentFile).push(line.slice(1))
        }
    }
}

const findings = []
for (const cls of riskMap.classes) {
    const pathRegexes = cls.paths.map((p) => new RegExp(p))
    const contentRegexes = cls.contentPatterns.map((p) => new RegExp(p))

    const pathHits = changedFiles.filter((f) => pathRegexes.some((r) => r.test(f)))

    const defaultScope = /^packages\/(browser|rrweb)\/.*\.(ts|tsx|js|mjs)$/
    const testFile = /(__tests__|__mocks__|\.test\.|\.spec\.|\/playwright\/|\/testcafe\/)/
    const scope = cls.contentScope ? new RegExp(cls.contentScope) : defaultScope

    const contentHits = []
    for (const [file, lines] of addedLinesByFile) {
        // Content patterns are only meaningful inside SDK/rrweb source, not docs or test fixtures.
        if (!scope.test(file) || testFile.test(file)) continue
        for (const regex of contentRegexes) {
            const line = lines.find((l) => regex.test(l))
            if (line) {
                contentHits.push({ file, pattern: regex.source, line: line.trim().slice(0, 160) })
            }
        }
    }

    // Path match alone is enough for high-risk surfaces; content match alone is a weaker signal,
    // so require it to co-occur with at least one changed file in the browser/rrweb packages.
    if (pathHits.length > 0 || contentHits.length > 0) {
        findings.push({
            id: cls.id,
            title: cls.title,
            anchor: cls.anchor,
            why: cls.why,
            pathHits,
            contentHits,
            strength: pathHits.length > 0 ? 'path' : 'content',
        })
    }
}

if (jsonOutput) {
    console.log(JSON.stringify({ base, mergeBase, changedFiles: changedFiles.length, findings }, null, 2))
    process.exit(0)
}

if (findings.length === 0) {
    console.log(`No incident-pattern matches for ${changedFiles.length} changed file(s) vs ${base}.`)
    process.exit(0)
}

const registry = '.agents/skills/replay-incident-risk/INCIDENTS.md'
console.log(`Matched ${findings.length} past incident pattern(s) (diff vs ${base}):\n`)
for (const f of findings) {
    console.log(`## ${f.title} [${f.strength} match]`)
    console.log(f.why)
    if (f.pathHits.length) {
        console.log('  Touched paths:')
        for (const p of f.pathHits) console.log(`    - ${p}`)
    }
    if (f.contentHits.length) {
        console.log('  Added lines matching risk patterns:')
        for (const c of f.contentHits.slice(0, 8)) console.log(`    - ${c.file}: /${c.pattern}/ -> ${c.line}`)
    }
    console.log(`  Read: ${registry}#${f.anchor}\n`)
}
console.log('This check is advisory. It flags resemblance to past incidents, not correctness.')
process.exit(0)
