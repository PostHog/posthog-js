module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check for `toString.call(x) == '[object File]'`
                if (
                    (node.operator === '==' || node.operator === '===') &&
                    node.left.type === 'CallExpression' &&
                    node.left.callee.property &&
                    node.left.callee.property.name === 'call' &&
                    node.left.callee.object &&
                    node.left.callee.object.name === 'toString' &&
                    node.right.type === 'Literal' &&
                    node.right.value === '[object File]'
                ) {
                    context.report({
                        node,
                        message: 'Use _isFile instead of direct type checks.',
                    })
                }

                // Check for `x instanceof File`
                if (node.operator === 'instanceof' && node.right.type === 'Identifier' && node.right.name === 'File') {
                    context.report({
                        node,
                        message: 'Use _isFile instead of direct checks.',
                    })
                }
            },
        }
    },
}
