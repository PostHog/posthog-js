module.exports = {
    create(context) {
        const filename = context.getFilename()
        const isAllowedFile =
            filename.includes('src/entrypoints') ||
            filename.includes('src/extensions/replay/external') ||
            filename.includes('__tests__')

        return {
            ImportDeclaration(node) {
                const importPath = node.source.value
                if (importPath.includes('extensions/replay/external')) {
                    if (!isAllowedFile) {
                        context.report({
                            node,
                            message:
                                'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, or test files',
                        })
                    }
                }
            },
            CallExpression(node) {
                if (node.callee.type === 'Import') {
                    const importPath = node.arguments[0].value
                    if (importPath.includes('extensions/replay/external')) {
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
