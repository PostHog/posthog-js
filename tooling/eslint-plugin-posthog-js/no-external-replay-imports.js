module.exports = {
    create(context) {
        const filename = context.getFilename()
        const isAllowedFile =
            filename.includes('src/entrypoints') ||
            filename.includes('src/extensions/replay/external') ||
            filename.includes('__tests__')

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
                if (isRestrictedImport(importPath)) {
                    if (!isAllowedFile) {
                        context.report({
                            node,
                            message:
                                'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, or test files',
                        })
                    }
                }
            },
            ImportExpression(node) {
                if (node.source && node.source.type === 'Literal') {
                    const importPath = node.source.value
                    if (isRestrictedImport(importPath)) {
                        if (!isAllowedFile) {
                            context.report({
                                node,
                                message:
                                    'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, or test files',
                            })
                        }
                    }
                }
            },
        }
    },
}
