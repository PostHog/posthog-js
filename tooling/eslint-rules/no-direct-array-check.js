module.exports = {
    create(context) {
        return {
            MemberExpression: function (node) {
                // Check if the object is 'Array' and the property is 'isArray'
                if (
                    node.object.type === 'Identifier' &&
                    node.object.name === 'Array' &&
                    node.property.type === 'Identifier' &&
                    node.property.name === 'isArray'
                ) {
                    context.report({
                        node,
                        message: 'Use isArray() instead of direct array checks.',
                    })
                }
            },
        }
    },
}
