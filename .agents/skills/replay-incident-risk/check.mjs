#!/usr/bin/env node
// Advisory checker: matches a diff against past incident classes in risk-map.json.
// Usage:
//   node .agents/skills/replay-incident-risk/check.mjs [base-ref] [head-ref] [--json]
//   node .agents/skills/replay-incident-risk/check.mjs --validate
// Defaults to diffing HEAD against origin/main (falling back to main).
// Advisory mode always exits 0, even on internal errors: this is a heads-up, not a gate.
// --validate lints risk-map.json itself (dead path patterns, broken anchors) and DOES
// exit non-zero on failure, so config rot is caught deterministically.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillDir = dirname(fileURLToPath(import.meta.url))
const MAX_HITS_SHOWN = 8

const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')
const validateMode = args.includes('--validate')
const positional = args.filter((a) => !a.startsWith('--'))
const baseArg = positional[0]
const headRef = positional[1] ?? 'HEAD'

function git(...cmd) {
    return execFileSync('git', cmd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function loadRiskMap() {
    return JSON.parse(readFileSync(join(skillDir, 'risk-map.json'), 'utf8'))
}

// Matches GitHub's heading-to-anchor slugging closely enough for our headings.
function slugify(heading) {
    return heading
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
}

function validate() {
    const riskMap = loadRiskMap()
    const files = git('ls-files').split('\n').filter(Boolean)
    const incidentsDoc = readFileSync(join(skillDir, 'INCIDENTS.md'), 'utf8')
    const anchors = new Set(
        incidentsDoc
            .split('\n')
            .filter((line) => line.startsWith('#'))
            .map((line) => slugify(line.replace(/^#+\s*/, '')))
    )

    const problems = []
    for (const cls of riskMap.classes) {
        for (const pattern of cls.paths) {
            let regex
            try {
                regex = new RegExp(pattern)
            } catch (error) {
                problems.push(`${cls.id}: path pattern does not compile: /${pattern}/ (${error.message})`)
                continue
            }
            if (!files.some((f) => regex.test(f))) {
                problems.push(`${cls.id}: path pattern matches no tracked file: /${pattern}/`)
            }
        }
        for (const pattern of cls.contentPatterns) {
            try {
                new RegExp(pattern)
            } catch (error) {
                problems.push(`${cls.id}: content pattern does not compile: /${pattern}/ (${error.message})`)
            }
        }
        if (cls.contentScope) {
            try {
                new RegExp(cls.contentScope)
            } catch (error) {
                problems.push(`${cls.id}: contentScope does not compile: /${cls.contentScope}/ (${error.message})`)
            }
        }
        if (!anchors.has(cls.anchor)) {
            problems.push(`${cls.id}: anchor #${cls.anchor} does not resolve to a heading in INCIDENTS.md`)
        }
    }

    if (problems.length > 0) {
        console.error(`risk-map.json validation failed (${problems.length} problem(s)):`)
        for (const p of problems) console.error(`  - ${p}`)
        process.exit(1)
    }
    console.log(`risk-map.json OK: ${riskMap.classes.length} classes, all path patterns match, all anchors resolve.`)
    process.exit(0)
}

function skip(reason) {
    if (jsonOutput) {
        console.log(JSON.stringify({ skipped: true, reason, findings: [] }, null, 2))
    } else {
        console.log(`Incident-pattern check skipped: ${reason}`)
    }
    process.exit(0)
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
    return null
}

function run() {
    const riskMap = loadRiskMap()
    const base = resolveBase()
    if (!base) {
        skip('could not resolve a base ref; pass one explicitly, e.g. `check.mjs origin/main`')
    }
    const mergeBase = git('merge-base', base, headRef).trim()

    const changedFiles = git('diff', '--name-only', mergeBase, headRef).split('\n').filter(Boolean)

    // Added lines per file, so content patterns only fire on what this diff introduces.
    const addedLinesByFile = new Map()
    {
        const diff = git('diff', '--unified=0', mergeBase, headRef)
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

        const defaultScope = /^packages\/(browser|rrweb)\/.*\.(ts|tsx|js|mjs)$/
        const testFile = /(__tests__|__mocks__|\.test\.|\.spec\.|\/playwright\/|\/testcafe\/)/
        const scope = cls.contentScope ? new RegExp(cls.contentScope) : defaultScope

        const pathHits = changedFiles.filter((f) => pathRegexes.some((r) => r.test(f)))

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
        return
    }

    if (findings.length === 0) {
        console.log(`No incident-pattern matches for ${changedFiles.length} changed file(s) vs ${base}.`)
        return
    }

    const registry = '.agents/skills/replay-incident-risk/INCIDENTS.md'
    console.log(`Matched ${findings.length} past incident pattern(s) (diff vs ${base}):\n`)
    for (const f of findings) {
        console.log(`## ${f.title} [${f.strength} match]`)
        console.log(f.why)
        if (f.pathHits.length) {
            console.log('  Touched paths:')
            for (const p of f.pathHits.slice(0, MAX_HITS_SHOWN)) console.log(`    - ${p}`)
            if (f.pathHits.length > MAX_HITS_SHOWN) {
                console.log(`    - ...and ${f.pathHits.length - MAX_HITS_SHOWN} more`)
            }
        }
        if (f.contentHits.length) {
            console.log('  Added lines matching risk patterns:')
            for (const c of f.contentHits.slice(0, MAX_HITS_SHOWN)) {
                console.log(`    - ${c.file}: /${c.pattern}/ -> ${c.line}`)
            }
            if (f.contentHits.length > MAX_HITS_SHOWN) {
                console.log(`    - ...and ${f.contentHits.length - MAX_HITS_SHOWN} more`)
            }
        }
        console.log(`  Read: ${registry}#${f.anchor}\n`)
    }
    console.log('This check is advisory. It flags resemblance to past incidents, not correctness.')
    console.log('For a judgment pass on whether this diff has the same failure mode, run the')
    console.log('`replay-incident-risk` skill in a Claude session from the repo root, or answer the')
    console.log(`review questions in the matched sections of ${registry} yourself.`)
}

if (validateMode) {
    validate()
} else {
    try {
        run()
    } catch (error) {
        // Advisory by design: an internal failure must not gate the build.
        console.error(`Incident-pattern check errored: ${error.message}`)
        skip('internal error, see stderr')
    }
}
process.exit(0)
