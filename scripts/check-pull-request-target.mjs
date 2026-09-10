import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Workflows triggered by pull_request_target run with a write token on fork PRs, so
// they must never fetch or run PR code. Keep them to plain `run:` steps that read PR
// data through the API and receive event fields through `env`, never `${{ }}`.

const workflowsDir = process.argv[2] || '.github/workflows'
const TRIGGER = /^\s*pull_request_target\s*:|^on:.*\bpull_request_target\b/m
const RULES = [
    [/^\s*(-\s+)?uses:/m, 'uses an action or reusable workflow, which can check out PR code'],
    [
        /\bgit\s+(clone|fetch|checkout|pull|worktree)\b|\bgh\s+(pr\s+checkout|repo\s+clone)\b/,
        'fetches code with git or gh',
    ],
]

function runBlocks(text) {
    const blocks = []
    const lines = text.split('\n')
    lines.forEach((line, i) => {
        const match = line.match(/^(\s*)(-\s+)?run:\s*(.*)$/)
        if (!match) {
            return
        }
        const indent = match[1].length + (match[2] || '').length
        const block = [match[3]]
        for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > indent); j++) {
            block.push(lines[j])
        }
        blocks.push(block.join('\n'))
    })
    return blocks
}

const failures = []
for (const file of readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))) {
    const text = readFileSync(join(workflowsDir, file), 'utf8')
    if (!TRIGGER.test(text)) {
        continue
    }
    for (const [pattern, reason] of RULES) {
        if (pattern.test(text)) {
            failures.push(`${file}: ${reason}`)
        }
    }
    if (runBlocks(text).some((block) => block.includes('${{'))) {
        failures.push(`${file}: interpolates \${{ }} into a run script; pass it through env instead`)
    }
}

if (failures.length) {
    process.stderr.write(
        `Unsafe pull_request_target workflows:\n${failures.map((failure) => `- ${failure}\n`).join('')}`
    )
    process.exit(1)
}

process.stdout.write('pull_request_target workflows are safe.\n')
