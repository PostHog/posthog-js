module.exports = {
    create(context) {
        return {
            BinaryExpression: function (node) {
                // Check for `toString.call(obj) == '[object Number]'`
                if (
                    (node.operator === '==' || node.operator === '===') &&
                    node.left.type === 'CallExpression' &&
                    node.left.callee.property &&
                    node.left.callee.property.name === 'call' &&
                    node.left.callee.object &&
                    node.left.callee.object.name === 'toString' &&
                    node.right.type === 'Literal' &&
                    node.right.value === '[object Number]'
                ) {
                    context.report({
                        node,
                        message: 'Use _isNumber instead of direct number checks.',
                    })
                }

                // Check for `typeof x === 'number'`
                if (
                    node.operator === '===' &&
                    node.left.type === 'UnaryExpression' &&
                    node.left.operator === 'typeof' &&
                    node.right.type === 'Literal' &&
                    node.right.value === 'number'
                ) {
                    context.report({
                        node,
                        message: 'Use _isNumber instead of direct number checks.',
                    })
                }
            },
        }
    },
}
