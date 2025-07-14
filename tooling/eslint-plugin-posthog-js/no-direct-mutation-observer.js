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
        },
    },
    create(context) {
        return {
            NewExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'MutationObserver') {
                    context.report({
                        node,
                        messageId: 'noDirectMutationObserver',
                    })
                }
            },
        }
    },
}
