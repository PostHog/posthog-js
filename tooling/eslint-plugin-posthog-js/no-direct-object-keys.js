module.exports = {
    create(context) {
        return {
            MemberExpression: function (node) {
                // Check if the object is 'Object' and the property is 'keys'
                if (
                    node.object.type === 'Identifier' &&
                    node.object.name === 'Object' &&
                    node.property.type === 'Identifier' &&
                    node.property.name === 'keys'
                ) {
                    context.report({
                        node,
                        message:
                            'Use objectKeys() from @posthog/core instead of Object.keys() for bundle size optimization.',
                    })
                }
            },
        }
    },
}
