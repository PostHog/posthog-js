module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check for `toString.call(x) == '[object FormData]'`
                if (
                    (node.operator === '==' || node.operator === '===') &&
                    node.left.type === 'CallExpression' &&
                    node.left.callee.property &&
                    node.left.callee.property.name === 'call' &&
                    node.left.callee.object &&
                    node.left.callee.object.name === 'toString' &&
                    node.right.type === 'Literal' &&
                    node.right.value === '[object FormData]'
                ) {
                    context.report({
                        node,
                        message: 'Use _isFormData instead of direct type checks.',
                    })
                }

                // Check for `x instanceof FormData`
                if (
                    node.operator === 'instanceof' &&
                    node.right.type === 'Identifier' &&
                    node.right.name === 'FormData'
                ) {
                    context.report({
                        node,
                        message: 'Use _isFormData instead of direct checks.',
                    })
                }
            },
        }
    },
}
