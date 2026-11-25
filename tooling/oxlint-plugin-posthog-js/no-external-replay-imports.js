module.exports = {
    create(context) {
        const filename = context.filename
        const isAllowedFile =
            filename.includes('src/entrypoints') ||
            filename.includes('src/extensions/replay/external') ||
            filename.includes('__tests__') ||
            filename.includes('/playwright/')

        // the browser-common replay modules came from src/extensions/replay/external; other packages own their boundaries
        const isSharedReplayOwner = /[\\/]packages[\\/](browser-common|browser-next)[\\/]/.test(filename)

        function isRestrictedSharedReplayImport(node) {
            const importPath = node.source.value
            if (isSharedReplayOwner || typeof importPath !== 'string') {
                return false
            }
            if (!importPath.startsWith('@posthog/browser-common/replay/') || importPath.endsWith('/replay-constants')) {
                return false
            }
            const typeOnly =
                node.importKind === 'type' ||
                (node.specifiers?.length > 0 && node.specifiers.every((specifier) => specifier.importKind === 'type'))
            return !typeOnly
        }

        function isRestrictedImport(importPath) {
            // Handle absolute paths with aliases
            if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
                return importPath.includes('extensions/replay/external')
            }

            // Handle relative paths
            if (importPath.startsWith('./') || importPath.startsWith('../')) {
                // For relative paths, check if they contain 'external'
                // This matches the test case behavior
                return importPath.includes('replay/external')
            }

            return false
        }

        return {
            ImportDeclaration(node) {
                const importPath = node.source.value
                if (isRestrictedImport(importPath) || isRestrictedSharedReplayImport(node)) {
                    if (!isAllowedFile) {
                        context.report({
                            node,
                            message:
                                'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, test files, or playwright specs',
                        })
                    }
                }
            },
            ImportExpression(node) {
                if (node.source && node.source.type === 'Literal') {
                    const importPath = node.source.value
                    if (isRestrictedImport(importPath) || isRestrictedSharedReplayImport(node)) {
                        if (!isAllowedFile) {
                            context.report({
                                node,
                                message:
                                    'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, test files, or playwright specs',
                            })
                        }
                    }
                }
            },
        }
    },
}
