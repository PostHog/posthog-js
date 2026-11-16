/* oxlint-disable compat/compat -- This plugin runs in Node.js during builds and tests. */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const moduleId = 'virtual:posthog-loader-methods'
const resolvedModuleId = '\0' + moduleId
const classPath = fileURLToPath(new URL('../src/posthog-core.ts', import.meta.url))

const callableName = (member) => {
    const callable =
        ts.isMethodSignature(member) ||
        (ts.isPropertySignature(member) && member.type && ts.isFunctionTypeNode(member.type))
    return callable && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : undefined
}

export function getLoaderMethods(source) {
    const file = ts.createSourceFile('posthog-core.ts', source, ts.ScriptTarget.Latest, true)
    const api = file.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'PostHog')
    if (!api || !ts.isClassDeclaration(api)) {
        throw new Error('Cannot generate loader methods: PostHog class not found')
    }

    const methods = []
    for (const member of api.members) {
        if (
            ts.getCombinedModifierFlags(member) &
            (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static)
        ) {
            continue
        }
        if (ts.isMethodDeclaration(member) && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) {
            const name = member.name.text
            if (!name.startsWith('_') && name !== 'toString' && name !== 'push') {
                methods.push(name)
            }
        } else if (
            ts.isPropertyDeclaration(member) &&
            member.name.getText(file) === 'people' &&
            member.type &&
            ts.isTypeLiteralNode(member.type)
        ) {
            for (const nested of member.type.members) {
                const nestedName = callableName(nested)
                if (nestedName) {
                    methods.push('people.' + nestedName)
                }
            }
        }
    }
    return [...new Set(methods)].sort()
}

export function loaderMethods(sourcePath = classPath) {
    return {
        name: 'posthog-loader-methods',
        resolveId(id) {
            if (id === moduleId) {
                return resolvedModuleId
            }
        },
        load(id) {
            if (id === resolvedModuleId) {
                this.addWatchFile(sourcePath)
                const methods = getLoaderMethods(fs.readFileSync(sourcePath, 'utf8'))
                return `export default ${JSON.stringify(methods.join(' '))}`
            }
        },
    }
}
