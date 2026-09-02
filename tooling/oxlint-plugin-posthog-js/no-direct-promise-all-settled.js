module.exports = {
    meta: {
        type: 'problem',
        messages: {
            noDirectPromiseAllSettled:
                'Use `allSettled` from @posthog/core (packages/core/src/utils) instead of Promise.allSettled — Promise.allSettled can be broken by runtime Promise patching on some RN environments.',
        },
    },
    create(context) {
        return {
            CallExpression(node) {
                const callee = node.callee
                if (
                    callee.type === 'MemberExpression' &&
                    !callee.computed &&
                    callee.object.type === 'Identifier' &&
                    callee.object.name === 'Promise' &&
                    callee.property.type === 'Identifier' &&
                    callee.property.name === 'allSettled'
                ) {
                    context.report({ node, messageId: 'noDirectPromiseAllSettled' })
                }
            },
        }
    },
}
