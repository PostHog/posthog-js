import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = new URL('../dist/', import.meta.url)
const allowedExtensions = /\.(?:js|mjs|cjs|json)$/
const forbiddenBareSpecifiers = new Set([
    'next/navigation',
    'next/router',
    'next/headers',
    'next/server',
    'posthog-js/react',
])
const specifierPattern = /\b(?:import|export)\s+(?:[^'"\n]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function listFiles(dirPath) {
    return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
            return listFiles(entryPath)
        }
        return entry.name.endsWith('.js') || entry.name.endsWith('.d.ts') ? [entryPath] : []
    })
}

const distPath = fileURLToPath(distDir)
if (!fs.existsSync(distPath)) {
    throw new Error(`Missing build output at ${distPath}`)
}

const offenders = []

for (const filePath of listFiles(distPath)) {
    const text = fs.readFileSync(filePath, 'utf8')
    for (const match of text.matchAll(specifierPattern)) {
        const specifier = match[1] ?? match[2]
        if (!specifier) {
            continue
        }

        const isRelativeSpecifier = specifier.startsWith('./') || specifier.startsWith('../')
        if (isRelativeSpecifier && !allowedExtensions.test(specifier)) {
            offenders.push(`${path.relative(distPath, filePath)} -> ${specifier}`)
            continue
        }

        if (forbiddenBareSpecifiers.has(specifier)) {
            offenders.push(`${path.relative(distPath, filePath)} -> ${specifier}`)
        }
    }
}

if (offenders.length > 0) {
    console.error('Found relative import/export specifiers without explicit runtime extensions in dist:')
    for (const offender of offenders) {
        console.error(`- ${offender}`)
    }
    process.exit(1)
}
