module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check for `toString.call(obj) == '[object Boolean]'`
                if (
                    (node.operator === '==' || node.operator === '===') &&
                    node.left.type === 'CallExpression' &&
                    node.left.callee.property &&
                    node.left.callee.property.name === 'call' &&
                    node.left.callee.object &&
                    node.left.callee.object.name === 'toString' &&
                    node.right.type === 'Literal' &&
                    node.right.value === '[object Boolean]'
                ) {
                    context.report({
                        node,
                        message: 'Use isBoolean instead of direct boolean checks.',
                    })
                }

                // Check for `typeof x === 'boolean'`
                if (
                    node.operator === '===' &&
                    node.left.type === 'UnaryExpression' &&
                    node.left.operator === 'typeof' &&
                    node.right.type === 'Literal' &&
                    node.right.value === 'boolean'
                ) {
                    context.report({
                        node,
                        message: 'Use isBoolean instead of direct boolean checks.',
                    })
                }
            },
        }
    },
}
