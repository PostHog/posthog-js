module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check for `toString.call(x) == '[object String]'`
                if (
                    (node.operator === '==' || node.operator === '===') &&
                    node.left.type === 'CallExpression' &&
                    node.left.callee.property &&
                    node.left.callee.property.name === 'call' &&
                    node.left.callee.object &&
                    node.left.callee.object.name === 'toString' &&
                    node.right.type === 'Literal' &&
                    node.right.value === '[object String]'
                ) {
                    context.report({
                        node,
                        message: 'Use _isString instead of direct string checks.',
                    })
                }

                // Check for `x instanceof String`
                if (
                    node.operator === 'instanceof' &&
                    node.right.type === 'Identifier' &&
                    node.right.name === 'String'
                ) {
                    context.report({
                        node,
                        message: 'Use _isString instead of direct string checks.',
                    })
                }
            },
        }
    },
}
