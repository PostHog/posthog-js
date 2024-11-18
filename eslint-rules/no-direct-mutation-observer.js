module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow direct use of MutationObserver and enforce importing NativeMutationObserver from global.ts',
            category: 'Best Practices',
            recommended: false,
        },
        schema: [],
        messages: {
            noDirectMutationObserver:
                'Direct use of MutationObserver is not allowed. Use NativeMutationObserver from global.ts instead.',
            missingNativeMutationObserver:
                'You must import NativeMutationObserver from global.ts to use MutationObserver functionality.',
        },
    },
    create(context) {
        let importedNativeMutationObserver = false
        const targetFileName = 'utils/global'

        return {
            ImportDeclaration(node) {
                // Check if 'NativeMutationObserver' is imported from 'global.ts'
                if (node.source.value.includes(targetFileName)) {
                    const importedSpecifiers = node.specifiers.map(
                        (specifier) => specifier.imported && specifier.imported.name
                    )
                    if (importedSpecifiers.includes('NativeMutationObserver')) {
                        importedNativeMutationObserver = true
                    }
                }
            },
            NewExpression(node) {
                // Check if `MutationObserver` is used
                if (node.callee.type === 'Identifier' && node.callee.name === 'MutationObserver') {
                    if (!importedNativeMutationObserver) {
                        context.report({
                            node,
                            messageId: 'noDirectMutationObserver',
                        })
                    }
                }
            },
            Identifier(node) {
                // Warn if `MutationObserver` is directly referenced outside of a `new` expression (rare cases)
                if (node.name === 'MutationObserver' && node.parent.type !== 'NewExpression') {
                    if (!importedNativeMutationObserver) {
                        context.report({
                            node,
                            messageId: 'missingNativeMutationObserver',
                        })
                    }
                }
            },
        }
    },
}
