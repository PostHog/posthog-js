module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow direct use of requestIdleCallback and enforce importing _requestIdleCallback from globals.ts',
            category: 'Best Practices',
            recommended: false,
        },
        schema: [],
        messages: {
            noDirectRequestIdleCallback:
                'Direct use of requestIdleCallback is not allowed. Use _requestIdleCallback from globals.ts instead.',
            noDirectCancelIdleCallback:
                'Direct use of cancelIdleCallback is not allowed. Use _cancelIdleCallback from globals.ts instead.',
        },
    },
    create(context) {
        return {
            CallExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'requestIdleCallback') {
                    context.report({
                        node,
                        messageId: 'noDirectRequestIdleCallback',
                    })
                }
                if (node.callee.type === 'Identifier' && node.callee.name === 'cancelIdleCallback') {
                    context.report({
                        node,
                        messageId: 'noDirectCancelIdleCallback',
                    })
                }
                if (
                    node.callee.type === 'MemberExpression' &&
                    node.callee.property.type === 'Identifier' &&
                    node.callee.property.name === 'requestIdleCallback'
                ) {
                    context.report({
                        node,
                        messageId: 'noDirectRequestIdleCallback',
                    })
                }
                if (
                    node.callee.type === 'MemberExpression' &&
                    node.callee.property.type === 'Identifier' &&
                    node.callee.property.name === 'cancelIdleCallback'
                ) {
                    context.report({
                        node,
                        messageId: 'noDirectCancelIdleCallback',
                    })
                }
            },
        }
    },
}
