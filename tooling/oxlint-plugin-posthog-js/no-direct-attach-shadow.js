module.exports = {
    meta: {
        type: 'problem',
        messages: {
            noDirectAttachShadow:
                'Use `attachShadowRootSafely` from @posthog/rrweb-snapshot instead of calling attachShadow directly.',
        },
    },
    create(context) {
        return {
            CallExpression(node) {
                const callee = node.callee
                if (
                    callee.type === 'MemberExpression' &&
                    callee.object.type !== 'Super' &&
                    !callee.computed &&
                    callee.property.type === 'Identifier' &&
                    callee.property.name === 'attachShadow'
                ) {
                    context.report({ node, messageId: 'noDirectAttachShadow' })
                }
            },
        }
    },
}
