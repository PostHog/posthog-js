#!/usr/bin/env node
/* eslint-disable no-console, typescript/no-require-imports, posthog-js/no-direct-array-check -- A CommonJS CI check that reports to the terminal. */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const repoRoot = process.cwd()
const tarballDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, 'target')
const tarballs = fs.existsSync(tarballDir)
    ? fs
          .readdirSync(tarballDir)
          .filter((name) => name.endsWith('.tgz'))
          .sort()
    : []

if (tarballs.length === 0) {
    console.error(`No package tarballs found in ${tarballDir}`)
    process.exit(1)
}

const sourceExtensions = new Set(['.js', '.mjs', '.cjs'])
const targetExtensions = ['', '.js', '.mjs', '.cjs', '.json', '.node']
const importPattern =
    /(?:\bimport\s*(?:[\w*{}$\s,]+\s+from\s*)?|\bexport\s*(?:[\w*{}$\s,]+\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/g

const errors = new Set()

function relativeForError(packageRoot, filePath) {
    return path.relative(packageRoot, filePath).split(path.sep).join('/')
}

function resolveRelativeImport(fromFile, specifier) {
    const base = path.resolve(path.dirname(fromFile), specifier)
    const candidates = []
    for (const extension of targetExtensions) candidates.push(base + extension)
    for (const extension of targetExtensions.slice(1)) candidates.push(path.join(base, 'index' + extension))
    return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

function collectPackageTargets(value, targets) {
    if (!value) return
    if (typeof value === 'string') {
        targets.add(value)
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) collectPackageTargets(item, targets)
        return
    }
    if (typeof value === 'object') {
        for (const item of Object.values(value)) collectPackageTargets(item, targets)
    }
}

function isStaticPackageTarget(target) {
    return typeof target === 'string' && target.startsWith('./') && !target.includes('*')
}

function addExistingEntrypoint(packageRoot, entrypoints, target) {
    if (!isStaticPackageTarget(target)) return
    const targetPath = path.join(packageRoot, target)
    if (sourceExtensions.has(path.extname(targetPath)) && fs.existsSync(targetPath)) entrypoints.add(targetPath)
}

function smokeEntrypointGraph(packageRoot, tarball, entrypoint) {
    const visited = new Set()
    const queue = [entrypoint]

    while (queue.length > 0) {
        const filePath = queue.shift()
        if (visited.has(filePath)) continue
        visited.add(filePath)

        const source = fs.readFileSync(filePath, 'utf8')
        importPattern.lastIndex = 0
        for (const match of source.matchAll(importPattern)) {
            const specifier = match[1]
            if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue

            const resolved = resolveRelativeImport(filePath, specifier)
            if (!resolved) {
                errors.add(
                    `${tarball}: ${relativeForError(packageRoot, filePath)} imports missing relative module ${specifier}`
                )
                continue
            }

            if (sourceExtensions.has(path.extname(resolved))) queue.push(resolved)
        }
    }
}

function smokeBundledSkill(packageRoot, tarball, skillName, findDisallowedSkillUrls) {
    const skillDir = path.join(packageRoot, 'skills', skillName)
    const skillMdPath = path.join(skillDir, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) {
        errors.add(`${tarball}: missing skills/${skillName}/SKILL.md`)
        return
    }
    const skillMd = fs.readFileSync(skillMdPath, 'utf8')
    const frontmatterMatch = skillMd.match(/^---\n([\s\S]*?)\n---/)
    if (!frontmatterMatch) {
        errors.add(`${tarball}: skills/${skillName}/SKILL.md missing YAML frontmatter`)
    } else {
        const fm = frontmatterMatch[1]
        if (!new RegExp(`^name:\\s*${skillName}\\s*$`, 'm').test(fm)) {
            errors.add(`${tarball}: skills/${skillName}/SKILL.md frontmatter must declare name: ${skillName}`)
        }
        const descMatch = fm.match(/^description:\s*(.+)$/m)
        if (!descMatch || !descMatch[1].trim() || descMatch[1].trim().length > 1024) {
            errors.add(
                `${tarball}: skills/${skillName}/SKILL.md frontmatter must declare non-empty description <= 1024 chars`
            )
        }
    }

    const refMatches = [...skillMd.matchAll(/\.\/references\/([a-z0-9-]+\.md)/g)]
    if (refMatches.length === 0) {
        errors.add(`${tarball}: skills/${skillName}/SKILL.md lists no ./references/*.md files`)
    }
    for (const match of refMatches) {
        const target = path.join(skillDir, 'references', match[1])
        if (!fs.existsSync(target)) {
            errors.add(`${tarball}: skills/${skillName}/SKILL.md references missing ./references/${match[1]}`)
        }
    }

    const checkDir = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                checkDir(fullPath)
            } else if (entry.name.endsWith('.md')) {
                const bad = findDisallowedSkillUrls(fs.readFileSync(fullPath, 'utf8'))
                if (bad.length > 0) {
                    errors.add(
                        `${tarball}: ${relativeForError(packageRoot, fullPath)} contains disallowed external URL(s): ${bad.join(', ')}`
                    )
                }
            }
        }
    }
    checkDir(skillDir)
}

async function main() {
    const { findDisallowedSkillUrls } = await import('./sdk-reference-helpers.mjs')

    for (const tarball of tarballs) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-tarball-smoke-'))
        try {
            execFileSync('tar', ['-xzf', path.join(tarballDir, tarball), '-C', tmpDir], { stdio: 'ignore' })
            const packageRoot = path.join(tmpDir, 'package')
            if (!fs.existsSync(packageRoot)) {
                errors.add(`${tarball}: missing package/ root in tarball`)
                continue
            }

            const packageJsonPath = path.join(packageRoot, 'package.json')
            if (!fs.existsSync(packageJsonPath)) {
                errors.add(`${tarball}: missing package.json`)
                continue
            }

            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
            if (packageJson.name === '@posthog/core') {
                const licensePath = path.join(packageRoot, 'LICENSE')
                if (!fs.existsSync(licensePath)) {
                    errors.add(`${tarball}: missing LICENSE`)
                } else if (!fs.readFileSync(licensePath).equals(fs.readFileSync(path.join(repoRoot, 'LICENSE')))) {
                    errors.add(`${tarball}: LICENSE does not match the root LICENSE`)
                }
            }

            if (packageJson.name === 'posthog-js') {
                smokeBundledSkill(packageRoot, tarball, 'posthog-js', findDisallowedSkillUrls)
            }

            const packageTargets = new Set()
            collectPackageTargets(packageJson.exports, packageTargets)
            collectPackageTargets(packageJson.bin, packageTargets)

            for (const field of ['main', 'module', 'types']) {
                if (typeof packageJson[field] === 'string') {
                    const target = path.join(packageRoot, packageJson[field])
                    if (!fs.existsSync(target))
                        errors.add(`${tarball}: package.json ${field} points to missing ${packageJson[field]}`)
                }
            }

            for (const target of packageTargets) {
                if (!isStaticPackageTarget(target)) continue
                const targetPath = path.join(packageRoot, target)
                if (!fs.existsSync(targetPath))
                    errors.add(`${tarball}: package.json exports/bin points to missing ${target}`)
            }

            const entrypoints = new Set()
            for (const field of ['main', 'module', 'browser'])
                addExistingEntrypoint(packageRoot, entrypoints, packageJson[field])
            for (const target of packageTargets) addExistingEntrypoint(packageRoot, entrypoints, target)

            for (const entrypoint of entrypoints) smokeEntrypointGraph(packageRoot, tarball, entrypoint)
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true })
        }
    }

    if (errors.size > 0) {
        console.error('Package tarball smoke test failed:')
        for (const error of errors) console.error(`- ${error}`)
        process.exit(1)
    }

    console.log(`Package tarball smoke test passed for ${tarballs.length} tarballs.`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
