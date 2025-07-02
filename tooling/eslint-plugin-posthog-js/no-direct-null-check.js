module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check if either the left or right operand is a null literal
                if (
                    (node.left.type === 'Literal' && node.left.value === null) ||
                    (node.right.type === 'Literal' && node.right.value === null)
                ) {
                    // Check the operator to ensure it's a comparison (you can expand this list if needed)
                    if (node.operator === '===' || node.operator === '!==') {
                        context.report({
                            node,
                            message: 'Use isNull() instead of direct null checks.',
                        })
                    }
                }
            },
        }
    },
}
