module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                if (
                    (node.left.type === 'Identifier' && node.left.name === 'undefined') ||
                    (node.right.type === 'Identifier' && node.right.name === 'undefined')
                ) {
                    // Check the operator to ensure it's a comparison (you can expand this list if needed)
                    if (node.operator === '===' || node.operator === '!==') {
                        context.report({
                            node,
                            message: 'Use isUndefined() instead of direct undefined checks.',
                        })
                    }
                }
            },
        }
    },
}
