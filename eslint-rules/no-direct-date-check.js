module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check for `toString.call(obj) == '[object Date]'`
                if (
                    (node.operator === '==' || node.operator === '===') &&
                    node.left.type === 'CallExpression' &&
                    node.left.callee.property &&
                    node.left.callee.property.name === 'call' &&
                    node.left.callee.object &&
                    node.left.callee.object.name === 'toString' &&
                    node.right.type === 'Literal' &&
                    node.right.value === '[object Date]'
                ) {
                    context.report({
                        node,
                        message: 'Use _isDate instead of direct date checks.',
                    })
                }

                // Check for `x instanceof Date`
                if (node.operator === 'instanceof' && node.right.type === 'Identifier' && node.right.name === 'Date') {
                    context.report({
                        node,
                        message: 'Use _isDate instead of direct date checks.',
                    })
                }
            },
        }
    },
}
